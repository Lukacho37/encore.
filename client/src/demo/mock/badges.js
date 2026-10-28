// Jumeau de démo du module « badges » (server/badges.js, P1-F, PLAN.md 4.2.6, 5.7) : mêmes routes, mêmes formes.
//   GET  /badges                   → { families: [médaille], earned, total } (gagnées avec la date, à gagner avec la progression)
//   GET  /users/:username/badges   → { families, earned, total: null } (gagnées seulement ; Studio privé, blocages)
//   POST /badges/seen              → { items } (badges gagnés depuis le dernier message « Nouvelle médaille ! »)
// Données : db.badges = { <joueur>: { <clé badge:famille[:variante]:palier>: { at, value, backfill? } } } (le cœur de
// la démo ne garde dans db.achievements que les albums et les artistes), db.badgeMarks = { <joueur>: { backfilled,
// seenAt } }, db.playLog = { <joueur>: [{ id, at, correct }] } (parties de blind test finies, que le cœur oublie après
// deux jours), db.badgesSince (mise en service).
// La démo n'a pas de bus d'événements : toutes les familles sont réévaluées à chaque état renvoyé au site (`counts`,
// appelé par chaque action et par GET /state) et après chaque vote ou quête ; la démo est petite (20 albums), c'est
// immédiat. Mêmes seuils, mêmes récompenses que le serveur (shared/badges.js) : XP, royalties, booster bonus, titre au
// dernier palier, notification badge_earned (la cloche monte, le site affiche « Nouvelle médaille ! »). Les joueurs
// fictifs et les comptes d'avant les badges reçoivent en silence ce que leur historique leur vaut déjà (une seule
// notification) ; un compte créé ensuite gagne ses médailles une par une, avec leur message.
import {
  BADGE_DECADES, BADGE_GENRES, FAMILIES, FRIENDLY_SCORE, PEN_MIN_CHARS, badgeKey, parseBadgeKey, rewardFor, tierMetric, tierProgress,
  tierRank,
} from '@shared/badges.js';
import { decadeOf } from '@shared/battles.js';
import { notify, unreadCount } from './notifications.js';

export const name = 'badges';

const DAY = 86_400_000;
const PERFECT = 5;
const PLAY_LOG = 120;
const PLAY_LOG_MS = 40 * DAY;

function ensure(db) {
  if (!db.badges || typeof db.badges !== 'object' || Array.isArray(db.badges)) db.badges = {};
  if (!db.badgeMarks || typeof db.badgeMarks !== 'object' || Array.isArray(db.badgeMarks)) db.badgeMarks = {};
  if (!db.playLog || typeof db.playLog !== 'object' || Array.isArray(db.playLog)) db.playLog = {};
  if (!Number.isFinite(db.badgesSince)) db.badgesSince = Date.now();
}

const badgesOf = (db, uid) => (db.badges[uid] ||= {});
const markOf = (db, uid) => (db.badgeMarks[uid] ||= {});

/**
 * Parties de blind test finies du joueur, gardées 40 jours (le cœur de la démo n'en garde que deux) : relevées à
 * chaque évaluation. Partagé avec mock/quests.js (« Fais un blind test », « 4/5 ou mieux »).
 */
export function playLog(db, uid) {
  ensure(db);
  const log = (db.playLog[uid] ||= []);
  const known = new Set(log.map((g) => g.id));
  for (const g of Object.values(db.games || {})) {
    if (g?.userId === uid && g.finishedAt && !known.has(g.id)) log.push({ id: g.id, at: g.finishedAt, correct: g.correct || 0 });
  }
  const cutoff = Date.now() - PLAY_LOG_MS;
  db.playLog[uid] = log.filter((g) => g.at >= cutoff).sort((a, b) => a.at - b.at).slice(-PLAY_LOG);
  return db.playLog[uid];
}

// ----- mesures : les mêmes que server/badges.js, sur les données de la démo -------------------------------------

/** Mesures de toutes les familles d'un joueur : Map « famille|variante » → valeurs. */
function measureAll(ctx, uid) {
  const { db } = ctx;
  const owned = ctx.collection.ownedSet(uid);
  const ach = ctx.collection.achOf(uid);
  const completed = Object.keys(ach).filter((k) => k.startsWith('album:')).map((k) => k.slice(6)).filter((id) => ctx.ALBUM.has(id));
  const started = new Set();
  for (const t of owned) {
    const albumId = ctx.TRACK.get(t)?.albumId;
    if (albumId) started.add(albumId);
  }
  const album = (id) => ctx.ALBUM.get(id);
  const rarityCount = (rarity) => [...owned].filter((t) => ctx.TRACK.get(t)?.rarity === rarity).length;
  const ratings = db.ratings.filter((r) => r.userId === uid);
  const reviews = ratings.filter((r) => r.review && !r.hiddenAt);
  const trackRated = new Map();
  for (const r of ratings) {
    if (r.type !== 'track') continue;
    const albumId = ctx.TRACK.get(r.id)?.albumId;
    if (albumId) trackRated.set(albumId, (trackRated.get(albumId) || 0) + 1);
  }
  const lists = (Array.isArray(db.lists) ? db.lists : []).filter((l) => l.userId === uid && !l.hiddenAt);
  const friends = new Set(db.friendships.filter((f) => f.status === 'accepted' && (f.requester === uid || f.addressee === uid))
    .map((f) => (f.requester === uid ? f.addressee : f.requester)));
  // Taste Match calculés par le jumeau de match (P1-E), s'il les garde : [{ userA, userB, score }].
  const matches = (Array.isArray(db.tasteMatches) ? db.tasteMatches : []).filter((m) => m && m.score >= FRIENDLY_SCORE);
  const friendly = new Set(matches.map((m) => {
    const [a, b] = [m.userA ?? m.a, m.userB ?? m.b];
    return a === uid ? b : b === uid ? a : null;
  }).filter((id) => id != null && friends.has(id)));
  const dailyClaimed = new Map();
  for (const q of Array.isArray(db.userQuests) ? db.userQuests : []) {
    if (q.userId === uid && String(q.periodKey).startsWith('d:') && q.slot < 3 && q.claimedAt) dailyClaimed.set(q.periodKey, (dailyClaimed.get(q.periodKey) || 0) + 1);
  }
  const out = new Map([
    ['vinyl|', { value: completed.length }],
    ['first_press|', { value: completed.some((id) => (ctx.collection.rankOf(uid, `album:${id}`) ?? Infinity) <= 10) ? 1 : 0 }],
    ['master|', { value: Object.keys(ach).filter((k) => k.startsWith('artist:')).length }],
    ['legendary|', { value: rarityCount('legendary') }],
    ['promo|', { value: rarityCount('promo') }],
    ['eclectic|', { value: new Set([...started].map((id) => album(id)?.genre).filter(Boolean)).size }],
    ['deluxe|', { value: Object.keys(ach).filter((k) => k.startsWith('deluxe:')).length }],
    ['critic|', { value: ratings.filter((r) => r.type === 'album').length }],
    ['pen|', { value: reviews.filter((r) => [...r.review].length >= PEN_MIN_CHARS).length }],
    ['popular_review|', { value: Math.max(0, ...reviews.map((r) => r.likeCount || 0)) }],
    ['fine_ear|', { value: [...trackRated.entries()].filter(([id, n]) => n >= ctx.staticCatalog.albumTrackIds(id).length).length }],
    ['curator|', { value: Math.max(0, ...lists.filter((l) => l.kind === 'list' && l.visibility === 'public').map((l) => l.likeCount || 0)) }],
    ['nine|', { value: lists.filter((l) => l.kind === 'grid9' && (l.items?.length || l.itemCount || 0) >= 9 && l.visibility !== 'private').length }],
    ['friendly|', { value: friendly.size }],
    ['blindtest|', { value: playLog(db, uid).filter((g) => g.correct >= PERFECT).length }],
    ['judge|', { value: (Array.isArray(db.battleVotes) ? db.battleVotes : []).filter((v) => v.userId === uid && v.counted).length }],
    ['steady|', { value: [...dailyClaimed.values()].filter((n) => n >= 3).length }],
  ]);
  for (const d of BADGE_DECADES) {
    const inDecade = (id) => decadeOf(album(id)?.year) === d;
    out.set(`explorer|${d}`, { albums: [...started].filter(inDecade).length, completed: completed.filter(inDecade).length });
  }
  for (const g of BADGE_GENRES) out.set(`genre_fan|${g}`, { value: completed.filter((id) => album(id)?.genre === g).length });
  return out;
}

const variantOf = (raw) => (raw === '' ? null : BADGE_DECADES.includes(Number(raw)) ? Number(raw) : raw);

// ----- attribution -------------------------------------------------------------------------------------------------

/** Donne les paliers atteints et pas encore gagnés, avec leur récompense. `quiet` : rattrapage silencieux. */
function grantReached(ctx, uid, measured, { quiet = false } = {}) {
  const { db } = ctx;
  const u = ctx.userById(uid);
  if (!u) return [];
  const have = badgesOf(db, uid);
  const now = Date.now();
  const won = [];
  for (const [k, values] of measured) {
    const [family, raw] = k.split('|');
    const variant = variantOf(raw);
    for (const p of tierProgress(family, values)) {
      const key = badgeKey(family, variant, p.tier);
      if (!p.reached || have[key]) continue;
      have[key] = { at: now, value: p.progress, ...(quiet ? { backfill: true } : {}) };
      const reward = rewardFor(family, p.tier);
      u.royalties += reward.royalties || 0;
      u.bonusPacks += reward.boosters || 0;
      if (reward.cosmetic) ctx.collection.grantCosmetic(uid, reward.cosmetic, `badge:${family}`);
      if (reward.xp) ctx.collection.addXp(uid, reward.xp, 'badge');
      won.push({ key, family, variant, tier: p.tier, reward });
    }
  }
  if (!won.length || u.bot) return won;
  const day = new Date(now).toISOString().slice(0, 10);
  if (quiet) {
    notify(db, uid, 'badge_earned', { targetType: 'user', targetId: uid, groupKey: `badge:${day}`, data: { count: won.length, backfill: true }, at: now });
  } else {
    for (const b of won) {
      notify(db, uid, 'badge_earned', {
        targetType: 'user', targetId: uid, groupKey: `badge:${day}`, data: { key: b.key, family: b.family, variant: b.variant, tier: b.tier }, at: now,
      });
    }
  }
  return won;
}

/** Rattrapage silencieux, une fois, pour les joueurs fictifs et les comptes d'avant les badges. */
function backfill(ctx, uid) {
  const { db } = ctx;
  ensure(db);
  const mark = markOf(db, uid);
  if (mark.backfilled) return;
  mark.backfilled = true;
  mark.seenAt ??= Date.now();
  const u = ctx.userById(uid);
  if (!u || (!u.bot && (u.createdAt ?? 0) >= db.badgesSince)) return;
  grantReached(ctx, uid, measureAll(ctx, uid), { quiet: true });
}

/** Badges gagnés depuis `since` (hors rattrapage) : [{ key, family, variant, tier, at, reward }]. */
function earnedSince(db, uid, since) {
  return Object.entries({ ...badgesOf(db, uid), ...externalOf(db, uid) })
    .filter(([, b]) => b.at >= (Number(since) || 0) && !b.backfill)
    .sort((a, b) => a[1].at - b[1].at || (a[0] < b[0] ? -1 : 1))
    .slice(0, 20)
    .map(([key, b]) => {
      const parsed = parseBadgeKey(key);
      return parsed ? { key, ...parsed, at: b.at, reward: rewardFor(parsed.family, parsed.tier) } : null;
    })
    .filter(Boolean);
}

/**
 * Réévalue toutes les familles d'un joueur (l'équivalent des abonnés du bus du serveur) ; rattrapage d'abord.
 * Renvoie les badges gagnés depuis `since` (pour `badgesEarned` des réponses), ou ceux de cet appel sans `since`.
 */
export function evaluateBadges(ctx, uid, { since = null } = {}) {
  ensure(ctx.db);
  backfill(ctx, uid);
  const won = grantReached(ctx, uid, measureAll(ctx, uid));
  if (since == null) return won;
  return earnedSince(ctx.db, uid, since);
}

// ----- lecture -----------------------------------------------------------------------------------------------------

/**
 * Badges des coffrets et des événements (familles externes « set » et « event ») : gardés par le jumeau des coffrets
 * (db.setBadges = { joueur: { clé: date } }), lus ici sous la forme de db.badges.
 */
const externalOf = (db, uid) => Object.fromEntries(Object.entries(db.setBadges?.[uid] || {})
  .filter(([key, at]) => Number.isFinite(at) && parseBadgeKey(key))
  .map(([key, at]) => [key, { at }]));

/** Badges gagnés : Map « famille|variante » → Map palier → date. */
function earnedOf(db, uid) {
  const out = new Map();
  for (const [key, b] of Object.entries({ ...badgesOf(db, uid), ...externalOf(db, uid) })) {
    const parsed = parseBadgeKey(key);
    if (!parsed) continue;
    const k = `${parsed.family}|${parsed.variant ?? ''}`;
    if (!out.has(k)) out.set(k, new Map());
    out.get(k).set(parsed.tier, b.at);
  }
  return out;
}

/** Médaille : { id, variant, group, icon, tiers: [{ tier, target, metric, progress?, earnedAt }], best, earnedAt }. */
function medalView(f, variant, earned, values) {
  const progress = values ? tierProgress(f.id, values) : null;
  const tiers = f.tiers.map((t, i) => {
    const earnedAt = earned?.get(t.tier) ?? null;
    const p = progress?.[i];
    return { tier: t.tier, target: t.target, metric: tierMetric(t), earnedAt, ...(p ? { progress: earnedAt ? t.target : p.progress } : {}) };
  });
  const best = tiers.filter((t) => t.earnedAt).sort((a, b) => tierRank(b.tier) - tierRank(a.tier))[0] || null;
  return { id: f.id, variant: variant ?? null, group: f.group, icon: f.icon, tiers, best: best?.tier ?? null, earnedAt: best?.earnedAt ?? null };
}

/** Médailles d'une famille externe : une par coffret ou événement gagné ; sinon, avec `placeholder`, la verrouillée. */
function externalViews(f, earned, { placeholder = false } = {}) {
  const views = [];
  for (const [k, tiers] of earned) if (k.startsWith(`${f.id}|`)) views.push(medalView(f, k.slice(f.id.length + 1), tiers, null));
  views.sort((a, b) => (b.earnedAt || 0) - (a.earnedAt || 0));
  if (!views.length && placeholder) views.push(medalView(f, null, null, null));
  return views;
}

function mine(ctx, uid) {
  evaluateBadges(ctx, uid);
  const measured = measureAll(ctx, uid);
  const earned = earnedOf(ctx.db, uid);
  const families = [];
  for (const f of FAMILIES) {
    if (f.external) {
      families.push(...externalViews(f, earned, { placeholder: true }));
      continue;
    }
    if (!f.variants) {
      families.push(medalView(f, null, earned.get(`${f.id}|`), measured.get(`${f.id}|`)));
      continue;
    }
    let shown = f.variants.map((v) => [v, measured.get(`${f.id}|${v}`)]);
    if (f.hiddenUntilEarned) {
      // « Fan de… » : les genres gagnés, plus le genre le plus avancé.
      const won = shown.filter(([v]) => earned.has(`${f.id}|${v}`));
      const next = shown.filter(([v, val]) => !earned.has(`${f.id}|${v}`) && val.value > 0).sort((a, b) => b[1].value - a[1].value)[0];
      shown = next ? [...won, next] : won;
    }
    for (const [variant, values] of shown) families.push(medalView(f, variant, earned.get(`${f.id}|${variant}`), values));
  }
  return { families, earned: families.filter((m) => m.best).length, total: families.length };
}

const privacyOf = (u) => u?.profileVisibility || u?.privacy || 'public';
const isBlocked = (db, a, b) => (db.blocks || []).some((x) => (x.blocker === a && x.blocked === b) || (x.blocker === b && x.blocked === a));
const areFriends = (db, a, b) => db.friendships.some((f) => f.status === 'accepted'
  && ((f.requester === a && f.addressee === b) || (f.requester === b && f.addressee === a)));

function ofUser(ctx, viewer, username) {
  const { db } = ctx;
  const target = ctx.userByName(username);
  if (!target || (!target.verified && !target.bot) || (target.id !== viewer.id && isBlocked(db, viewer.id, target.id))) ctx.fail(404, 'user_not_found');
  if (target.id === viewer.id) return mine(ctx, viewer.id);
  const privacy = privacyOf(target);
  if (privacy === 'private' || (privacy === 'friends' && !areFriends(db, viewer.id, target.id))) ctx.fail(403, 'profile_private');
  evaluateBadges(ctx, target.id);
  const earned = earnedOf(db, target.id);
  const families = [];
  for (const f of FAMILIES) {
    if (f.external) {
      families.push(...externalViews(f, earned));
      continue;
    }
    for (const variant of f.variants || [null]) {
      const got = earned.get(`${f.id}|${variant ?? ''}`);
      if (!got) continue;
      const view = medalView(f, variant, got, null);
      view.tiers = view.tiers.filter((t) => t.earnedAt);
      families.push(view);
    }
  }
  return { families, earned: families.length, total: null };
}

function seen(ctx, uid) {
  const { db } = ctx;
  evaluateBadges(ctx, uid);
  const mark = markOf(db, uid);
  const since = mark.seenAt ?? Date.now() - DAY;
  mark.seenAt = Date.now();
  return { items: earnedSince(db, uid, since) };
}

export const routes = [
  ['GET', /^\/badges$/, ({ ctx }) => mine(ctx, ctx.me().id)],
  ['POST', /^\/badges\/seen$/, ({ ctx }) => seen(ctx, ctx.me().id)],
  ['GET', /^\/users\/([^/]+)\/badges$/, ({ params, ctx }) => {
    let name = '';
    try {
      name = decodeURIComponent(params[0]);
    } catch {
      ctx.fail(404, 'user_not_found');
    }
    return ofUser(ctx, ctx.me(), name);
  }],
];

/**
 * Pastilles de state.counts (contrat de mockServer.js), appelées à chaque état renvoyé : c'est ici que les badges
 * gagnés par une action du cœur (booster qui complète un album, note, partie de blind test…) sont attribués. Le
 * nombre de notifications non lues est relu après coup (une médaille en ajoute une).
 */
export function counts(db, ctx, uid) {
  if (!ctx.userById(uid)) return {};
  const won = evaluateBadges(ctx, uid);
  return won.length ? { unread: unreadCount(db, uid) } : {};
}

export function seed(db) {
  ensure(db);
}

export function migrate(db) {
  // Une sauvegarde d'avant les badges : ses comptes sont « d'avant », rattrapés en silence à leur première lecture.
  ensure(db);
}
