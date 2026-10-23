// Jumeau de démo du module « sets » (server/sets.js, P2-B, PLAN.md 4.3, 6.8) : mêmes routes, mêmes formes.
//   GET /sets?kind=&cursor=&limit=  → { items: [SetSummary], nextCursor, counts, rewards, catalog, state? }
//   GET /sets/:id                   → { set, albums, friends, holders, event, rewards, catalog, state? }
// Données : db.sets = [{ id, kind, titles, rule, eventSlug, albumIds, createdAt }] (créés une fois, figés comme sur le
// serveur), db.setBadges = { [userId]: { [clé du badge]: date } } (badges des coffrets et des événements : les succès de
// la démo ne servent qu'aux albums et artistes). Le cadre d'un coffret passe par ctx.collection.grantCosmetic.
// Différence propre à la démo : son catalogue n'a que 20 albums ; un coffret y existe dès 3 albums (6 sur le serveur,
// 8 pour un généré). Les seuils des récompenses suivent la même règle (badge aux 3/4, cadre au complet). Les joueurs
// fictifs ont des albums complétés : ils apparaissent comme amis sur un coffret une fois la demande d'ami acceptée.
import {
  CODE_SETS, GENERATED_DECADES, GENERATED_GENRES, GENERATED_SIZE, MAX_SET_ALBUMS, SET_KINDS, generatedId, generatedTitles,
  kindRank, setRewards,
} from '@shared/sets.js';
import { daysUntil } from '@shared/events.js';
import { notify } from './notifications.js';
import { viewerOf } from './ratings.js';
import { demoCalendar } from './events.js';

export const name = 'sets';

/** Un coffret de la démo existe dès 3 albums (catalogue de 20 albums). */
export const DEMO_MIN_ALBUMS = 3;
const LIST_KINDS = ['all', 'started', ...SET_KINDS];
const COVERS = 4;
const FRIENDS_SHOWN = 8;
const PAGE_CAP = 500;
const DAY = 86_400_000;

function ensure(db) {
  if (!Array.isArray(db.sets)) db.sets = [];
  if (!db.setBadges || typeof db.setBadges !== 'object') db.setBadges = {};
}

const decode = (raw) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
};

const encCursor = (offset) => btoa(JSON.stringify([offset])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function offsetOf(ctx, raw) {
  if (!raw) return 0;
  try {
    const [offset] = JSON.parse(atob(String(raw).replace(/-/g, '+').replace(/_/g, '/')));
    if (Number.isInteger(offset) && offset >= 0) return Math.min(offset, PAGE_CAP);
  } catch {
    // curseur illisible : 400 plus bas
  }
  return ctx.fail(400, 'invalid_input', { field: 'cursor' });
}

// ----- création (comme server/sets.js, sur le catalogue de la démo) ----------------------------------------------

const norm = (s) => String(s || '').toLowerCase().normalize('NFC');

/** Album d'une sélection : identifiant de la graine, sinon artiste + titre. */
function resolveEntry(ctx, entry) {
  if (entry.id && ctx.ALBUM.has(entry.id)) return entry.id;
  for (const al of ctx.ALBUM.values()) {
    if (norm(al.title) === norm(entry.title) && norm(al.artist) === norm(entry.artist)) return al.id;
  }
  return null;
}

/** Albums d'une règle de remplissage ({ genre, decade, year, from, to }), dans l'ordre du catalogue (populaires d'abord). */
function fillAlbums(ctx, fill, exclude, limit) {
  const out = [];
  for (const al of ctx.ALBUM.values()) {
    if (out.length >= limit) break;
    if (exclude.has(al.id)) continue;
    if (fill.genre && al.genre !== fill.genre) continue;
    if (fill.decade && !(al.year >= fill.decade && al.year < fill.decade + 10)) continue;
    if (fill.year && al.year !== fill.year) continue;
    if (fill.from && !(al.year >= fill.from)) continue;
    if (fill.to && !(al.year <= fill.to)) continue;
    out.push(al.id);
  }
  return out;
}

/** Coffrets du code puis générés, créés une fois (figés ensuite). */
export function refreshSets(db, ctx) {
  ensure(db);
  const have = new Set(db.sets.map((s) => s.id));
  const now = Date.now();
  for (const def of CODE_SETS) {
    if (have.has(def.id)) continue;
    const size = Math.min(MAX_SET_ALBUMS, def.size || GENERATED_SIZE);
    const ids = [];
    for (const entry of def.albums || []) {
      if (ids.length >= size) break;
      const id = resolveEntry(ctx, entry);
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (ids.length < size && def.fill) ids.push(...fillAlbums(ctx, def.fill, new Set(ids), size - ids.length));
    if (ids.length < DEMO_MIN_ALBUMS) continue;
    db.sets.push({ id: def.id, kind: def.kind, titles: def.title, rule: def.fill || null, eventSlug: def.event || null, albumIds: ids, createdAt: now });
  }
  for (const decade of GENERATED_DECADES) {
    for (const genre of GENERATED_GENRES) {
      const id = generatedId(genre, decade);
      if (have.has(id)) continue;
      const ids = fillAlbums(ctx, { genre, decade }, new Set(), GENERATED_SIZE);
      if (ids.length < DEMO_MIN_ALBUMS) continue;
      db.sets.push({ id, kind: 'generated', titles: generatedTitles(genre, decade), rule: { genre, decade }, eventSlug: null, albumIds: ids, createdAt: now });
    }
  }
}

// ----- progression et récompenses ----------------------------------------------------------------------------------

const badgesOf = (db, uid) => (db.setBadges[uid] ||= {});
const frameGrant = (ctx, uid, frame) => (ctx.db.cosmeticGrants?.[uid] || []).find((c) => c.id === frame) || null;

/** Albums complétés (succès `album:<id>`) et cartes du joueur sur les albums d'un coffret. */
function albumProgress(ctx, uid, set) {
  const ach = ctx.collection.achOf(uid);
  const owned = ctx.collection.ownedSet(uid);
  return set.albumIds.map((albumId, position) => {
    const tracks = ctx.staticCatalog.albumTracks(albumId);
    const at = ach[`album:${albumId}`] ?? null;
    return { id: albumId, position, completed: at != null, completedAt: at, owned: tracks.filter((t) => owned.has(t.id)).length, total: tracks.length };
  });
}

function progressOf(ctx, uid, set) {
  const albums = albumProgress(ctx, uid, set);
  return {
    completed: albums.filter((a) => a.completed).length,
    owned: albums.reduce((s, a) => s + a.owned, 0),
    total: albums.reduce((s, a) => s + a.total, 0),
  };
}

/** Récompenses atteintes et pas encore données : badge (50 XP, comme un badge bronze) aux 3/4, cadre au complet. */
function grantReached(ctx, uid, set, progress) {
  const r = setRewards(set.id, set.albumIds.length);
  const won = [];
  const badges = badgesOf(ctx.db, uid);
  if (progress.completed >= r.badgeAt && !badges[r.badge]) {
    badges[r.badge] = Date.now();
    ctx.collection.addXp(uid, 50, 'set');
    won.push({ setId: set.id, reward: 'badge' });
  }
  if (progress.completed >= r.frameAt && !frameGrant(ctx, uid, r.frame)) {
    ctx.collection.grantCosmetic(uid, r.frame, `set:${set.id}`);
    won.push({ setId: set.id, reward: 'frame' });
  }
  const day = new Date().toISOString().slice(0, 10);
  for (const w of won) notify(ctx.db, uid, 'set_reward', { groupKey: `set:${day}`, data: w });
  return won;
}

/** SetSummary (même forme que le serveur). */
function summaryOf(ctx, uid, set, progress) {
  const r = setRewards(set.id, set.albumIds.length);
  return {
    id: set.id,
    kind: set.kind,
    titles: set.titles,
    rule: set.rule,
    eventSlug: set.eventSlug,
    albumCount: set.albumIds.length,
    covers: set.albumIds.slice(0, COVERS),
    progress,
    rewards: {
      badgeAt: r.badgeAt, frameAt: r.frameAt, badge: r.badge, frame: r.frame,
      badgeEarnedAt: badgesOf(ctx.db, uid)[r.badge] ?? null, frameEarnedAt: frameGrant(ctx, uid, r.frame)?.at ?? null,
    },
    createdAt: set.createdAt,
  };
}

const started = (s) => s.progress.owned > 0;
const score = (s) => s.progress.completed / Math.max(1, s.albumCount) + s.progress.owned / Math.max(1, s.progress.total) / 1000;
function compare(x, y) {
  if (started(x) !== started(y)) return started(x) ? -1 : 1;
  if (started(x) && score(x) !== score(y)) return score(y) - score(x);
  if (x.kind !== y.kind) return kindRank(x.kind) - kindRank(y.kind);
  return x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1);
}

/** Résumé d'un coffret pour un joueur (page d'un événement de la démo), ou null. */
export function setSummaryFor(ctx, uid, setId) {
  refreshSets(ctx.db, ctx);
  const set = ctx.db.sets.find((s) => s.id === setId);
  if (!set) return null;
  const progress = progressOf(ctx, uid, set);
  grantReached(ctx, uid, set, progress);
  return summaryOf(ctx, uid, set, progress);
}

/** Badges des coffrets et des événements d'un joueur : { [clé]: date } (démo). */
export const demoBadges = (db, uid) => {
  ensure(db);
  return badgesOf(db, uid);
};

function list(ctx, query) {
  const u = ctx.me();
  refreshSets(ctx.db, ctx);
  const kind = LIST_KINDS.includes(query.get('kind')) ? query.get('kind') : 'all';
  const offset = offsetOf(ctx, query.get('cursor'));
  const limit = Math.max(1, Math.min(48, Number(query.get('limit')) || 24));
  const rewards = [];
  const items = ctx.db.sets.map((set) => {
    const progress = progressOf(ctx, u.id, set);
    rewards.push(...grantReached(ctx, u.id, set, progress));
    return summaryOf(ctx, u.id, set, progress);
  });
  const counts = { all: items.length, started: items.filter(started).length };
  for (const k of SET_KINDS) counts[k] = items.filter((s) => s.kind === k).length;
  const shown = items.filter((s) => (kind === 'all' ? true : kind === 'started' ? started(s) : s.kind === kind)).sort(compare);
  const page = shown.slice(offset, offset + limit);
  const next = offset + page.length;
  return {
    items: page,
    nextCursor: next < shown.length && next < PAGE_CAP ? encCursor(next) : null,
    counts,
    rewards,
    catalog: ctx.refs({ albumIds: page.flatMap((s) => s.covers) }),
    ...(rewards.length ? { state: ctx.partialState() } : {}),
  };
}

function detail(ctx, rawId) {
  const u = ctx.me();
  refreshSets(ctx.db, ctx);
  const id = decode(rawId);
  const set = ctx.db.sets.find((s) => s.id === id);
  if (!set) ctx.fail(404, 'set_not_found');
  const albums = albumProgress(ctx, u.id, set);
  const progress = progressOf(ctx, u.id, set);
  const rewards = grantReached(ctx, u.id, set, progress);
  // Amis : ceux qui ont complété un album du coffret, sans les bloqués ni les Studios privés.
  const viewer = viewerOf(ctx, u.id);
  const keys = set.albumIds.map((x) => `album:${x}`);
  const rows = [...viewer.friends]
    .filter((fid) => ctx.userById(fid)?.profileVisibility !== 'private')
    .map((fid) => ({ fid, n: keys.filter((k) => ctx.collection.achOf(fid)[k]).length }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || a.fid - b.fid)
    .slice(0, FRIENDS_SHOWN);
  const sums = ctx.summaries(rows.map((r) => r.fid));
  const friends = rows.map((r) => ({ user: sums.get(r.fid), completed: r.n })).filter((f) => f.user);
  const badgeKey = setRewards(set.id, set.albumIds.length).badge;
  const holders = Object.values(ctx.db.setBadges).filter((b) => b && b[badgeKey]).length;
  let event = null;
  const ev = set.eventSlug ? demoCalendar().find((e) => e.slug === set.eventSlug) : null;
  if (ev) {
    event = {
      slug: ev.slug, titles: ev.title, status: ev.status, start: ev.start, end: ev.end,
      daysLeft: ev.status === 'current' ? daysUntil(ev.end) : null, startsIn: ev.status === 'upcoming' ? daysUntil(ev.start) : null,
    };
  }
  return {
    set: summaryOf(ctx, u.id, set, progress),
    albums,
    friends,
    holders,
    event,
    rewards,
    catalog: ctx.refs({ albumIds: set.albumIds }),
    ...(rewards.length ? { state: ctx.partialState() } : {}),
  };
}

export const routes = [
  ['GET', /^\/sets$/, ({ query, ctx }) => list(ctx, query)],
  ['GET', /^\/sets\/([^/]+)$/, ({ params, ctx }) => detail(ctx, params[0])],
];

export function seed(db, ctx) {
  refreshSets(db, ctx);
  // Joueurs fictifs : les badges que leurs albums complétés leur valent déjà (« N joueurs ont le badge de ce coffret »).
  for (const u of db.users.filter((x) => x.bot)) {
    const ach = db.achievements[u.id] || {};
    for (const set of db.sets) {
      const completed = set.albumIds.filter((id) => ach[`album:${id}`]).length;
      const r = setRewards(set.id, set.albumIds.length);
      if (completed >= r.badgeAt) (db.setBadges[u.id] ||= {})[r.badge] = (u.createdAt || Date.now()) + DAY;
    }
  }
}

export function migrate(db, ctx) {
  ensure(db);
  refreshSets(db, ctx);
}
