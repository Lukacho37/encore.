// Jumeau de démo du module « quests » (server/quests.js, P1-F, PLAN.md 4.2.6, 5.6, 6.7) : mêmes routes, mêmes formes.
//   GET  /quests                               → { daily, weekly, firstSteps, event?, events, serverTime } (événements
//                                                 en cours : mock/events.js)
//   POST /quests/:periodKey/:slot/claim        → { reward, quest, levelUp, badgesEarned, state }
//   POST /quests/:periodKey/:slot/reroll       → { quest, rerollsLeft } (une relance gratuite par jour)
//   POST /quests/bonus/:periodKey              → { reward, badgesEarned, state } (les 3 quêtes de la période réclamées)
// Données : db.userQuests = [{ userId, periodKey, slot, questId, rerolled, claimedAt, reward, createdAt, base,
// headStart }] (slot 9 : le bonus de la période, comme BONUS_SLOT). Mêmes tirages que le serveur (shared/quests.js,
// graine hash(joueur, période), heure de Paris), mêmes récompenses ; la progression est recomptée à chaque lecture
// depuis les données de la démo (cartes et leur date, succès, notes, critiques, votes, parties de blind test, listes,
// posts, commentaires). Deux différences, propres à la démo :
//   - les boosters ouverts n'y ont pas de journal : la quête compte les ouvertures depuis son tirage (u.openings) ;
//   - coup de pouce de bienvenue : un compte de moins de deux jours trouve ses premières quêtes du jour et de la semaine
//     déjà entamées (un tiers de la cible, jamais finies), pour voir tout de suite des quêtes en cours.
import {
  BLINDTEST_GOOD, BONUS_REWARDS, BONUS_SLOT, FIRST_KEY, FIRST_STEPS, FREE_REROLLS, QUEST_SLOTS, metricParams, parseQuest,
  rerollQuest as rerollId, reviewCounts, rewardOf, rollQuests, scopeOfKey,
} from '@shared/quests.js';
import { currentPeriod, periodBounds } from '@shared/periods.js';
import { evaluateBadges, playLog } from './badges.js';
import { questEvents } from './events.js';

export const name = 'quests';

const DAY = 86_400_000;
const FAR = Number.MAX_SAFE_INTEGER;
const SLOT_RE = /^\d{1,2}$/;
const HEAD_START_MS = 2 * DAY;

function ensure(db) {
  if (!Array.isArray(db.userQuests)) db.userQuests = [];
}

const decode = (raw) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
};

// ----- périodes -----------------------------------------------------------------------------------------------

const current = (now = Date.now()) => ({ daily: currentPeriod('daily', now), weekly: currentPeriod('weekly', now) });
const windowOf = (periodKey) => (periodKey === FIRST_KEY ? { start: 0, end: FAR } : periodBounds(periodKey));

/** Portée d'une clé reçue, si elle est en cours ; 400 si elle est illisible, 410 si elle est finie. */
function liveScope(ctx, periodKey) {
  const scope = scopeOfKey(periodKey);
  if (!scope || scope === 'event') ctx.fail(400, 'invalid_input', { field: 'periodKey' });
  if (scope === 'first') return scope;
  if (current()[scope].key !== periodKey) ctx.fail(410, 'period_over');
  return scope;
}

// ----- progression : recomptée depuis les données de la démo -------------------------------------------------------

const inWin = (t, w) => Number.isFinite(t) && t >= w.start && t < w.end;

/** Première date de chaque morceau possédé (toutes variantes). */
function firstCards(ctx, uid) {
  const cards = ctx.db.cards[uid] || {};
  const first = new Map();
  for (const [k, v] of Object.entries(cards)) {
    const t = k.split('|')[0];
    if (!first.has(t) || v.at < first.get(t).at) first.set(t, { at: v.at, r: v.r });
  }
  return first;
}

function newCards(ctx, uid, params, w) {
  let n = 0;
  for (const [t, c] of firstCards(ctx, uid)) {
    if (!inWin(c.at, w)) continue;
    const track = ctx.TRACK.get(t);
    if (!track) continue;
    if (params.genre && track.genre !== params.genre) continue;
    if (params.decade && !(track.year >= params.decade && track.year < params.decade + 10)) continue;
    if (params.rarities && !params.rarities.includes(c.r || track.rarity)) continue;
    n += 1;
  }
  return n;
}

/** Artistes dont le premier album commencé l'a été dans la fenêtre. */
function newArtists(ctx, uid, w) {
  const first = new Map();
  for (const [t, c] of firstCards(ctx, uid)) {
    const track = ctx.TRACK.get(t);
    if (!track?.albumId) continue;
    if (!first.has(track.artistId) || c.at < first.get(track.artistId)) first.set(track.artistId, c.at);
  }
  return [...first.values()].filter((at) => inWin(at, w)).length;
}

const COUNTERS = {
  open_boosters: (ctx, u, _p, w, row) => (row?.periodKey === FIRST_KEY || !row ? u.openings || 0 : Math.max(0, (u.openings || 0) - (row.base?.openings ?? u.openings ?? 0))),
  new_cards: (ctx, u, p, w) => newCards(ctx, u.id, p, w),
  new_artist: (ctx, u, _p, w) => newArtists(ctx, u.id, w),
  complete_album: (ctx, u, _p, w) => Object.entries(ctx.collection.achOf(u.id)).filter(([k, at]) => k.startsWith('album:') && inWin(at, w)).length,
  rate_albums: (ctx, u, _p, w) => ctx.db.ratings.filter((r) => r.userId === u.id && r.type === 'album' && inWin(r.createdAt, w)).length,
  rate_tracks: (ctx, u, _p, w) => ctx.db.ratings.filter((r) => r.userId === u.id && r.type === 'track' && inWin(r.createdAt, w)).length,
  write_review: (ctx, u, _p, w) => ctx.db.ratings.filter((r) => r.userId === u.id && r.review && !r.hiddenAt
    && inWin(r.reviewAt ?? r.updatedAt, w) && reviewCounts(r.review)).length,
  rate_genres: (ctx, u, _p, w) => new Set(ctx.db.ratings.filter((r) => r.userId === u.id && r.type === 'album' && inWin(r.createdAt, w))
    .map((r) => ctx.ALBUM.get(r.id)?.genre).filter(Boolean)).size,
  battle_votes: (ctx, u, _p, w) => (ctx.db.battleVotes || []).filter((v) => v.userId === u.id && v.counted && inWin(v.createdAt, w)).length,
  blindtest_play: (ctx, u, _p, w) => playLog(ctx.db, u.id).filter((g) => inWin(g.at, w)).length,
  blindtest_score: (ctx, u, _p, w) => playLog(ctx.db, u.id).filter((g) => inWin(g.at, w) && g.correct >= BLINDTEST_GOOD).length,
  add_to_list: (ctx, u, _p, w) => (Array.isArray(ctx.db.lists) ? ctx.db.lists : [])
    .filter((l) => l.userId === u.id && (l.kind === 'list' || l.kind === 'grid9'))
    .reduce((n, l) => n + (l.items || []).filter((it) => inWin(it.addedAt, w)).length, 0),
  post: (ctx, u, _p, w) => (ctx.db.posts || []).filter((p) => p.userId === u.id && !p.hiddenAt && inWin(p.createdAt, w)).length,
  comment: (ctx, u, _p, w) => (ctx.db.comments || []).filter((c) => c.userId === u.id && !c.hiddenAt && !c.deletedAt && inWin(c.createdAt, w)).length,
  // Profil musical rempli (un genre ou un artiste favori), pas seulement l'accueil passé.
  onboarded: (ctx, u) => {
    const f = ctx.db.favorites?.[u.id] || {};
    return (Array.isArray(f.genre) && f.genre.length) || (Array.isArray(f.artist) && f.artist.length) ? 1 : 0;
  },
  add_friend: (ctx, u) => (ctx.db.friendships.some((f) => f.status === 'accepted' && (f.requester === u.id || f.addressee === u.id)) ? 1 : 0),
};

/** Progression d'une quête du joueur, bornée à sa cible (coup de pouce de bienvenue compris). */
function progressOf(ctx, u, parsed, w, row) {
  const counter = COUNTERS[parsed.def.metric];
  const real = counter ? counter(ctx, u, metricParams(parsed), w, row) : 0;
  return Math.min(parsed.def.target, real + (row?.headStart || 0));
}

// ----- tirage et lecture ---------------------------------------------------------------------------------------

/** Contexte du tirage : a-t-il des amis (quêtes sociales) ; ses genres favoris (ceux de ses cartes). */
function contextOf(ctx, u) {
  const hasFriends = !!COUNTERS.add_friend(ctx, u);
  const byGenre = new Map();
  for (const t of ctx.collection.ownedSet(u.id)) {
    const g = ctx.TRACK.get(t)?.genre;
    if (g) byGenre.set(g, (byGenre.get(g) || 0) + 1);
  }
  const genres = [...byGenre.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([g]) => g);
  return { hasFriends, genres };
}

const rowsOf = (db, uid, periodKey) => db.userQuests.filter((r) => r.userId === uid && r.periodKey === periodKey).sort((a, b) => a.slot - b.slot);

/** Coup de pouce de bienvenue (démo) : un tiers de la cible pour les premières quêtes d'un compte neuf. */
function headStartOf(u, def, now) {
  if (u.bot || def.scope === 'first' || def.target < 2 || now - (u.createdAt ?? 0) > HEAD_START_MS) return 0;
  return Math.max(1, Math.floor(def.target / 3));
}

/** Lignes de la période ; les quêtes manquantes sont tirées et écrites à la première lecture. */
function ensureRows(ctx, u, periodKey, scope) {
  const { db } = ctx;
  ensure(db);
  const rows = rowsOf(db, u.id, periodKey);
  const wanted = scope === 'first' ? FIRST_STEPS.length : QUEST_SLOTS;
  const have = new Set(rows.filter((r) => r.slot < BONUS_SLOT).map((r) => r.slot));
  if (have.size >= wanted) return rows;
  const rolled = rollQuests(u.id, periodKey, scope, scope === 'first' ? {} : contextOf(ctx, u));
  const now = Date.now();
  for (const r of rolled) {
    if (have.has(r.slot)) continue;
    const parsed = parseQuest(r.questId);
    db.userQuests.push({
      userId: u.id, periodKey, slot: r.slot, questId: r.questId, rerolled: false, claimedAt: null, reward: null, createdAt: now,
      base: { openings: u.openings || 0 }, headStart: parsed ? headStartOf(u, parsed.def, now) : 0,
    });
  }
  return rowsOf(db, u.id, periodKey);
}

/** Quest (PLAN.md 4.2.6) d'une ligne ; null si la quête n'existe plus. */
function questView(ctx, u, row, w) {
  const parsed = parseQuest(row.questId);
  if (!parsed) return null;
  const { def, vars } = parsed;
  const claimed = row.claimedAt != null;
  const progress = claimed ? def.target : progressOf(ctx, u, parsed, w, row);
  return {
    slot: row.slot,
    id: row.questId,
    defId: def.id,
    scope: def.scope,
    category: def.category,
    metric: def.metric,
    target: def.target,
    progress,
    done: progress >= def.target,
    claimed,
    claimedAt: row.claimedAt ?? null,
    rerolled: !!row.rerolled,
    reward: claimed && row.reward ? row.reward : rewardOf(def),
    vars,
  };
}

const bonusReward = (scope) => (scope === 'daily' ? { boosters: BONUS_REWARDS.daily.boosters } : { themed: BONUS_REWARDS.weekly.themed });

function periodView(ctx, u, scope, period) {
  const rows = ensureRows(ctx, u, period.key, scope);
  const slots = rows.filter((r) => r.slot < QUEST_SLOTS).map((r) => questView(ctx, u, r, period)).filter(Boolean);
  const bonusRow = rows.find((r) => r.slot === BONUS_SLOT);
  const allClaimed = slots.length === QUEST_SLOTS && slots.every((s) => s.claimed);
  const out = {
    periodKey: period.key,
    startsAt: period.start,
    endsAt: period.end,
    slots,
    bonus: { claimable: allClaimed && !bonusRow, claimed: !!bonusRow, reward: bonusRow?.reward || bonusReward(scope) },
  };
  if (scope === 'daily') out.rerollsLeft = Math.max(0, FREE_REROLLS - rows.filter((r) => r.rerolled).length);
  return out;
}

function list(ctx, u) {
  const now = current();
  const first = ensureRows(ctx, u, FIRST_KEY, 'first');
  const firstDone = first.length >= FIRST_STEPS.length && first.every((r) => r.claimedAt != null);
  return {
    daily: periodView(ctx, u, 'daily', now.daily),
    weekly: periodView(ctx, u, 'weekly', now.weekly),
    firstSteps: firstDone ? [] : first.map((r) => questView(ctx, u, r, windowOf(FIRST_KEY))).filter(Boolean),
    ...questEvents(ctx, u),
    serverTime: Date.now(),
  };
}

function slotOf(ctx, raw, scope) {
  const slot = SLOT_RE.test(String(raw)) ? Number(raw) : -1;
  const max = scope === 'first' ? FIRST_STEPS.length : QUEST_SLOTS;
  if (slot < 0 || slot >= max) ctx.fail(404, 'quest_not_found');
  return slot;
}

/** Applique une récompense : royalties, boosters bonus, booster thématique, XP (paliers de niveau). */
function grant(ctx, u, reward, source) {
  u.royalties += Math.max(0, Math.floor(reward.royalties || 0));
  u.bonusPacks += Math.max(0, Math.floor(reward.boosters || 0));
  if (reward.theme) ctx.collection.grantBooster(u.id, 'theme', reward.theme, source);
  return reward.xp ? ctx.collection.addXp(u.id, reward.xp, source) : null;
}

function claim(ctx, u, periodKey, rawSlot) {
  const scope = liveScope(ctx, periodKey);
  const slot = slotOf(ctx, rawSlot, scope);
  const w = scope === 'first' ? windowOf(FIRST_KEY) : current()[scope];
  ensureRows(ctx, u, periodKey, scope);
  const row = ctx.db.userQuests.find((r) => r.userId === u.id && r.periodKey === periodKey && r.slot === slot);
  const parsed = row && parseQuest(row.questId);
  if (!parsed) ctx.fail(404, 'quest_not_found');
  if (row.claimedAt != null) ctx.fail(409, 'already_claimed');
  const progress = progressOf(ctx, u, parsed, w, row);
  if (progress < parsed.def.target) ctx.fail(409, 'quest_not_done', { progress, target: parsed.def.target });
  const reward = rewardOf(parsed.def);
  row.claimedAt = Date.now();
  row.reward = reward;
  const levelUp = grant(ctx, u, reward, `quest:${scope === 'first' ? 'f' : scope[0]}`);
  return { reward, quest: questView(ctx, u, row, w), levelUp };
}

function reroll(ctx, u, periodKey, rawSlot) {
  const scope = liveScope(ctx, periodKey);
  if (scope !== 'daily') ctx.fail(409, 'no_reroll');
  const slot = slotOf(ctx, rawSlot, scope);
  const w = current().daily;
  const rows = ensureRows(ctx, u, periodKey, scope);
  const used = rows.filter((r) => r.rerolled).length;
  if (used >= FREE_REROLLS) ctx.fail(409, 'no_reroll');
  const row = rows.find((r) => r.slot === slot);
  if (!row) ctx.fail(404, 'quest_not_found');
  if (row.claimedAt != null) ctx.fail(409, 'already_claimed');
  const nextId = rerollId(u.id, periodKey, scope, slot, row.questId, contextOf(ctx, u));
  if (!nextId) ctx.fail(409, 'no_reroll');
  // Une quête neuve : pas de coup de pouce, ouvertures comptées depuis maintenant.
  Object.assign(row, { questId: nextId, rerolled: true, headStart: 0, base: { openings: u.openings || 0 } });
  return { quest: questView(ctx, u, row, w), rerollsLeft: Math.max(0, FREE_REROLLS - used - 1) };
}

/** Genre favori du joueur (booster thématique de la semaine) ; « À ton goût » s'il n'en a pas encore. */
function themeOf(ctx, u) {
  const g = contextOf(ctx, u).genres[0];
  return g ? `genre:${g}` : 'taste';
}

function claimBonus(ctx, u, periodKey) {
  const scope = liveScope(ctx, periodKey);
  if (scope === 'first') ctx.fail(409, 'bonus_locked');
  const rows = ensureRows(ctx, u, periodKey, scope);
  if (rows.some((r) => r.slot === BONUS_SLOT)) ctx.fail(409, 'already_claimed');
  const claimed = rows.filter((r) => r.slot < QUEST_SLOTS && r.claimedAt != null).length;
  if (claimed < QUEST_SLOTS) ctx.fail(409, 'bonus_locked', { claimed, needed: QUEST_SLOTS });
  const reward = scope === 'daily' ? { boosters: BONUS_REWARDS.daily.boosters } : { theme: themeOf(ctx, u), themed: BONUS_REWARDS.weekly.themed };
  const now = Date.now();
  ctx.db.userQuests.push({ userId: u.id, periodKey, slot: BONUS_SLOT, questId: 'bonus', rerolled: false, claimedAt: now, reward, createdAt: now });
  grant(ctx, u, reward, `quest:${scope[0]}:bonus`);
  return { reward };
}

// ----- routes ------------------------------------------------------------------------------------------------------

export const routes = [
  ['GET', /^\/quests$/, ({ ctx }) => list(ctx, ctx.me())],
  ['POST', /^\/quests\/bonus\/([^/]+)$/, ({ params, ctx }) => {
    const u = ctx.me();
    const since = Date.now();
    const result = claimBonus(ctx, u, decode(params[0]));
    return { ...result, badgesEarned: evaluateBadges(ctx, u.id, { since }), state: ctx.partialState() };
  }],
  ['POST', /^\/quests\/([^/]+)\/([^/]+)\/claim$/, ({ params, ctx }) => {
    const u = ctx.me();
    const since = Date.now();
    const result = claim(ctx, u, decode(params[0]), decode(params[1]));
    return { ...result, badgesEarned: evaluateBadges(ctx, u.id, { since }), state: ctx.partialState() };
  }],
  ['POST', /^\/quests\/([^/]+)\/([^/]+)\/reroll$/, ({ params, ctx }) => reroll(ctx, ctx.me(), decode(params[0]), decode(params[1]))],
];

export function seed(db) {
  ensure(db);
}

export function migrate(db) {
  ensure(db);
  // Les quêtes des périodes finies ne servent plus qu'à « Assidu » (jours où les 3 quêtes du jour ont été réclamées) :
  // on garde les lignes réclamées, on oublie les autres au-delà de 40 jours.
  const cutoff = Date.now() - 40 * DAY;
  db.userQuests = db.userQuests.filter((r) => r && (r.claimedAt != null || (r.createdAt ?? 0) >= cutoff));
}
