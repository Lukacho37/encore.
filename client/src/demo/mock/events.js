// Jumeau de démo du module « events » (server/events.js et les périodes d'événement de server/quests.js, P2-B,
// PLAN.md 4.3, 6.9) : mêmes routes, mêmes formes.
//   GET  /events                           → { current, upcoming, past, soon, serverTime }
//   GET  /events/:slug                     → { event, quests, set, battle, rewards, catalog }
//   POST /events/:slug/quests/:slot/claim  → { reward, quest, levelUp, state }
//   POST /events/:slug/bonus               → { reward, levelUp, state } (badge, cadre, booster thématique)
// Le calendrier est celui du code (shared/events.js). Propre à la démo : quand aucun événement n'est en cours, le
// prochain est montré « en cours » (aperçu : commencé il y a deux jours, encore douze), pour qu'un nouveau compte voie
// un événement vivant ; ses dates réelles restent celles du calendrier sur le serveur.
// Données : db.eventQuests = [{ userId, slug, slot, questId, claimedAt, reward, createdAt, headStart }] (slot 9 : le
// bonus, comme BONUS_SLOT). Progression recomptée à chaque lecture depuis les données de la démo, dans la fenêtre de
// l'événement ; coup de pouce de bienvenue comme les quêtes de la démo (un tiers de la cible pour un compte de moins de
// deux jours, jamais une quête finie).
import { BONUS_SLOT, metricParams, rewardOf } from '@shared/quests.js';
import { TIER_REWARDS } from '@shared/badges.js';
import {
  EVENT_BADGE_TIER, EVENT_SLOTS, UPCOMING_DAYS, daysUntil, eventBadgeKey, eventDef, eventPeriodKey, isEventSlug, nextEventSlug,
  parseEventQuest, resolveCalendar,
} from '@shared/events.js';
import { notify } from './notifications.js';
import { demoBadges, setSummaryFor } from './sets.js';

export const name = 'events';

const DAY = 86_400_000;
const HEAD_START_MS = 2 * DAY;
const SLOT_RE = /^\d{1,2}$/;

// ----- calendrier de la démo ----------------------------------------------------------------------------------------

const ANCHOR = Date.now();
let previewSlug;
/** Calendrier résolu ; sans événement en cours au chargement de la démo, le prochain est montré en aperçu. */
export function demoCalendar(now = Date.now()) {
  if (previewSlug === undefined) {
    const real = resolveCalendar({ now: ANCHOR });
    previewSlug = real.some((e) => e.status === 'current' && e.kind === 'event') ? null : nextEventSlug(ANCHOR);
  }
  return resolveCalendar({ now, preview: previewSlug, previewAnchor: ANCHOR });
}
const findEvent = (slug) => demoCalendar().find((e) => e.slug === slug) || null;

function ensure(db) {
  if (!Array.isArray(db.eventQuests)) db.eventQuests = [];
}

const decode = (raw) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
};

// ----- progression : recomptée depuis les données de la démo -------------------------------------------------------

const inWin = (t, w) => Number.isFinite(t) && t >= w.start && t < w.end;
const inDecade = (year, d) => !d || (year >= d && year < d + 10);

function newCards(ctx, uid, p, w) {
  const first = new Map();
  for (const [k, v] of Object.entries(ctx.db.cards[uid] || {})) {
    const t = k.split('|')[0];
    if (!first.has(t) || v.at < first.get(t)) first.set(t, v.at);
  }
  let n = 0;
  for (const [t, at] of first) {
    if (!inWin(at, w)) continue;
    const track = ctx.TRACK.get(t);
    if (!track || (p.genre && track.genre !== p.genre) || !inDecade(track.year, p.decade)) continue;
    n += 1;
  }
  return n;
}

function completeAlbum(ctx, uid, p, w) {
  const set = p.set ? (ctx.db.sets || []).find((s) => s.id === p.set) : null;
  return Object.entries(ctx.collection.achOf(uid)).filter(([k, at]) => {
    if (!k.startsWith('album:') || !inWin(at, w)) return false;
    const id = k.slice(6);
    if (p.set) return !!set?.albumIds.includes(id);
    const al = ctx.ALBUM.get(id);
    return !!al && (!p.genre || al.genre === p.genre) && inDecade(al.year, p.decade);
  }).length;
}

const COUNTERS = {
  new_cards: newCards,
  complete_album: completeAlbum,
  rate_albums: (ctx, uid, p, w) => ctx.db.ratings.filter((r) => {
    if (r.userId !== uid || r.type !== 'album' || !inWin(r.createdAt, w)) return false;
    const al = ctx.ALBUM.get(r.id);
    return !p.genre && !p.decade ? true : !!al && (!p.genre || al.genre === p.genre) && inDecade(al.year, p.decade);
  }).length,
  rate_tracks: (ctx, uid, _p, w) => ctx.db.ratings.filter((r) => r.userId === uid && r.type === 'track' && inWin(r.createdAt, w)).length,
  // Votes de l'événement : ceux de la fenêtre dans sa catégorie (le serveur les marque de son slug).
  battle_votes: (ctx, uid, p, w, ev) => (ctx.db.battleVotes || []).filter((v) => v.userId === uid && v.counted && inWin(v.createdAt, w)
    && (!p.event || (ev?.battle && (v.categories || []).includes(ev.battle)))).length,
  add_to_list: (ctx, uid, _p, w) => (Array.isArray(ctx.db.lists) ? ctx.db.lists : [])
    .filter((l) => l.userId === uid && (l.kind === 'list' || l.kind === 'grid9'))
    .reduce((n, l) => n + (l.items || []).filter((it) => inWin(it.addedAt, w)).length, 0),
};

function progressOf(ctx, uid, parsed, ev, row) {
  const counter = COUNTERS[parsed.def.metric];
  const real = counter ? counter(ctx, uid, metricParams(parsed), { start: ev.start, end: ev.end }, ev) : 0;
  return Math.min(parsed.def.target, real + (row?.headStart || 0));
}

// ----- quêtes de l'événement ---------------------------------------------------------------------------------------

const rowsOf = (db, uid, slug) => db.eventQuests.filter((r) => r.userId === uid && r.slug === slug).sort((a, b) => a.slot - b.slot);

/** Lignes de l'événement en cours, écrites à la première lecture (coup de pouce de bienvenue compris). */
function ensureRows(ctx, u, ev) {
  ensure(ctx.db);
  const rows = rowsOf(ctx.db, u.id, ev.slug);
  const have = new Set(rows.map((r) => r.slot));
  const now = Date.now();
  const fresh = !u.bot && now - (u.createdAt ?? 0) <= HEAD_START_MS;
  ev.quests.slice(0, EVENT_SLOTS).forEach((def, slot) => {
    if (have.has(slot)) return;
    const headStart = fresh && def.target >= 3 ? Math.max(1, Math.floor(def.target / 3)) : 0;
    ctx.db.eventQuests.push({ userId: u.id, slug: ev.slug, slot, questId: def.id, claimedAt: null, reward: null, createdAt: now, headStart });
  });
  return rowsOf(ctx.db, u.id, ev.slug);
}

function questView(ctx, u, ev, def, slot, row) {
  const parsed = parseEventQuest(ev.slug, def.id);
  const claimed = row?.claimedAt != null;
  const locked = ev.status === 'upcoming';
  const progress = claimed ? def.target : locked ? 0 : progressOf(ctx, u.id, parsed, ev, row);
  return {
    slot, id: def.id, defId: def.id, scope: 'event', category: def.category, metric: def.metric, target: def.target,
    progress, done: progress >= def.target, claimed, claimedAt: row?.claimedAt ?? null, rerolled: false,
    reward: claimed && row.reward ? row.reward : rewardOf(parsed.def), vars: def.params || {}, ...(locked ? { locked: true } : {}),
  };
}

/** Bonus d'un événement : badge or (sa récompense de palier), cadre, booster thématique. */
function bonusOf(slug) {
  const ev = eventDef(slug);
  if (!ev) return null;
  const tier = TIER_REWARDS[EVENT_BADGE_TIER] || {};
  return {
    xp: tier.xp || 0, royalties: tier.royalties || 0, ...(tier.boosters ? { boosters: tier.boosters } : {}),
    ...(ev.booster ? { theme: ev.booster, themed: 1 } : {}), badge: eventBadgeKey(ev.slug), ...(ev.frame ? { frame: ev.frame } : {}),
  };
}

function eventView(ctx, u, ev) {
  const rows = ev.status === 'current' ? ensureRows(ctx, u, ev) : rowsOf(ctx.db, u.id, ev.slug);
  const bySlot = new Map(rows.map((r) => [r.slot, r]));
  const defs = ev.quests.slice(0, EVENT_SLOTS);
  const slots = defs.map((def, slot) => questView(ctx, u, ev, def, slot, bySlot.get(slot)));
  const bonusRow = bySlot.get(BONUS_SLOT);
  return {
    slug: ev.slug, periodKey: eventPeriodKey(ev.slug), status: ev.status, startsAt: ev.start, endsAt: ev.end, slots,
    bonus: {
      claimable: ev.status === 'current' && slots.every((s) => s.claimed) && !bonusRow,
      claimed: !!bonusRow,
      reward: bonusRow?.reward || bonusOf(ev.slug),
    },
  };
}

function summaryOf(ctx, u, ev, now = Date.now()) {
  ensure(ctx.db);
  const claimed = rowsOf(ctx.db, u.id, ev.slug).filter((r) => r.slot < EVENT_SLOTS && r.claimedAt != null).length;
  const frame = ev.frame ? (ctx.db.cosmeticGrants?.[u.id] || []).find((c) => c.id === ev.frame) : null;
  return {
    slug: ev.slug, kind: ev.kind, titles: ev.title, ...(ev.year ? { year: ev.year } : {}), icon: ev.icon, start: ev.start, end: ev.end,
    status: ev.status, preview: ev.preview,
    daysLeft: ev.status === 'current' ? daysUntil(ev.end, now) : null,
    startsIn: ev.status === 'upcoming' ? daysUntil(ev.start, now) : null,
    battle: ev.battle, setId: ev.setId, frame: ev.frame, booster: ev.booster, badge: eventBadgeKey(ev.slug),
    quests: { claimed, total: ev.quests.length },
    earned: { badgeAt: demoBadges(ctx.db, u.id)[eventBadgeKey(ev.slug)] ?? null, frameAt: frame?.at ?? null },
  };
}

function overview(ctx) {
  const u = ctx.me();
  const now = Date.now();
  const all = demoCalendar(now).map((ev) => summaryOf(ctx, u, ev, now));
  const upcoming = all.filter((e) => e.status === 'upcoming');
  const next = upcoming.filter((e) => e.kind === 'event').sort((a, b) => a.start - b.start)[0];
  return {
    current: all.filter((e) => e.status === 'current'),
    upcoming,
    past: all.filter((e) => e.status === 'past').reverse(),
    soon: next && next.startsIn <= UPCOMING_DAYS ? next : null,
    serverTime: now,
  };
}

function view(ctx, rawSlug) {
  const u = ctx.me();
  const slug = decode(rawSlug);
  const ev = isEventSlug(slug) ? findEvent(slug) : null;
  if (!ev) ctx.fail(404, 'event_not_found');
  const set = ev.setId ? setSummaryFor(ctx, u.id, ev.setId) : null;
  return {
    event: summaryOf(ctx, u, ev),
    quests: eventView(ctx, u, ev),
    set,
    // La démo n'a pas de catégorie du jour écrite à l'avance : la catégorie de l'événement l'est pendant l'événement.
    battle: ev.battle ? { category: ev.battle, featured: ev.status === 'current' } : null,
    rewards: bonusOf(ev.slug),
    catalog: ctx.refs({ albumIds: set?.covers || [] }),
  };
}

/** Événement en cours (410 avant et après, 404 inconnu). */
function liveEvent(ctx, rawSlug) {
  const slug = decode(rawSlug);
  const ev = isEventSlug(slug) ? findEvent(slug) : null;
  if (!ev) ctx.fail(404, 'event_not_found');
  if (ev.status !== 'current') ctx.fail(410, 'period_over');
  return ev;
}

function grant(ctx, u, reward, source) {
  u.royalties += Math.max(0, Math.floor(reward.royalties || 0));
  u.bonusPacks += Math.max(0, Math.floor(reward.boosters || 0));
  if (reward.theme) ctx.collection.grantBooster(u.id, 'theme', reward.theme, source);
  return reward.xp ? ctx.collection.addXp(u.id, reward.xp, source) : null;
}

function claim(ctx, rawSlug, rawSlot) {
  const u = ctx.me();
  const ev = liveEvent(ctx, rawSlug);
  const slot = SLOT_RE.test(String(rawSlot)) ? Number(rawSlot) : -1;
  if (slot < 0 || slot >= EVENT_SLOTS) ctx.fail(404, 'quest_not_found');
  const rows = ensureRows(ctx, u, ev);
  const row = rows.find((r) => r.slot === slot);
  const def = ev.quests[slot];
  if (!row || !def) ctx.fail(404, 'quest_not_found');
  if (row.claimedAt != null) ctx.fail(409, 'already_claimed');
  const parsed = parseEventQuest(ev.slug, def.id);
  const progress = progressOf(ctx, u.id, parsed, ev, row);
  if (progress < def.target) ctx.fail(409, 'quest_not_done', { progress, target: def.target });
  const reward = rewardOf(parsed.def);
  row.claimedAt = Date.now();
  row.reward = reward;
  const levelUp = grant(ctx, u, reward, 'quest:e');
  return { reward, quest: questView(ctx, u, ev, def, slot, row), levelUp, state: ctx.partialState() };
}

function claimBonus(ctx, rawSlug) {
  const u = ctx.me();
  const ev = liveEvent(ctx, rawSlug);
  const rows = ensureRows(ctx, u, ev);
  if (rows.some((r) => r.slot === BONUS_SLOT)) ctx.fail(409, 'already_claimed');
  const claimed = rows.filter((r) => r.slot < EVENT_SLOTS && r.claimedAt != null).length;
  if (claimed < EVENT_SLOTS) ctx.fail(409, 'bonus_locked', { claimed, needed: EVENT_SLOTS });
  const reward = bonusOf(ev.slug);
  const now = Date.now();
  ctx.db.eventQuests.push({ userId: u.id, slug: ev.slug, slot: BONUS_SLOT, questId: 'bonus', claimedAt: now, reward, createdAt: now, headStart: 0 });
  const levelUp = grant(ctx, u, reward, `event:${ev.slug}`);
  demoBadges(ctx.db, u.id)[reward.badge] = now;
  if (reward.frame) ctx.collection.grantCosmetic(u.id, reward.frame, `event:${ev.slug}`);
  notify(ctx.db, u.id, 'event_reward', { groupKey: `event:${ev.slug}`, data: { slug: ev.slug, badge: reward.badge, frame: reward.frame || null } });
  return { reward, levelUp, state: ctx.partialState() };
}

export const routes = [
  ['GET', /^\/events$/, ({ ctx }) => overview(ctx)],
  ['GET', /^\/events\/([^/]+)$/, ({ params, ctx }) => view(ctx, params[0])],
  ['POST', /^\/events\/([^/]+)\/quests\/([^/]+)\/claim$/, ({ params, ctx }) => claim(ctx, params[0], decode(params[1]))],
  ['POST', /^\/events\/([^/]+)\/bonus$/, ({ params, ctx }) => claimBonus(ctx, params[0])],
];

export function seed(db) {
  ensure(db);
}

export function migrate(db) {
  ensure(db);
  // Les lignes des événements finis depuis plus de 400 jours ne servent plus.
  const cutoff = Date.now() - 400 * DAY;
  db.eventQuests = db.eventQuests.filter((r) => r && (r.claimedAt != null || (r.createdAt ?? 0) >= cutoff));
}
