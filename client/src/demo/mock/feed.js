// Jumeau de démo du module « feed » (server/feed.js, P1-A, PLAN.md 4.2.2, 5.2) : mêmes routes, mêmes formes.
//   GET /feed?tab=friends|foryou|community&cursor=&limit=   → { tab, items: [FeedItem], nextCursor, hasFriends, catalog }
//   GET /users/:username/activity?cursor=                   → { items, nextCursor, restricted?, catalog }
// La démo n'a pas de bus d'événements : l'activité est déduite à chaque lecture des données elles-mêmes (posts,
// critiques, notes du jour agrégées, albums complétés, artistes maîtrisés, listes publiées), puis classée comme sur le
// serveur : 0.5^(âge en heures / 36) × (1 + affinité + engagement + bonus du type), jamais plus de 2 éléments d'affilée
// du même joueur, raison affichée (« Ami », « Proche de tes goûts », « Populaire »).
import { dayKey } from '@shared/periods.js';
import { viewerOf } from './ratings.js';
import {
  canRead, collector, decodeCursor, encodeCursor, ensure, hydratePosts, limitOf, listSummaries, processQueue, reviewsByIds,
} from './social.js';

export const name = 'feed';

const TABS = ['friends', 'foryou', 'community'];
const HOUR = 3_600_000;
const DAY = 86_400_000;
const GROUP_ITEMS = 12;
const RANKED_CAP = 200;
const FRIENDS_ACTIVE_MS = 14 * DAY;
/** Albums complétés et artistes maîtrisés gardés par joueur (les joueurs fictifs en ont beaucoup). */
const PER_ACTOR = { complete: 3, master: 2 };
const KIND_BOOST = { complete: 0.4, review: 0.3, post: 0.3, master: 0.3, list: 0.2, grid: 0.2, rate: 0 };

/** Score d'une activité (PLAN.md 5.2). */
function scoreOf({ ageHours, affinity = 0, engagement = 0, verb }) {
  const eng = Math.min(1, Math.log10(1 + Math.max(0, engagement)) / 2);
  return 0.5 ** (Math.max(0, ageHours) / 36) * (1 + affinity + eng + (KIND_BOOST[verb] ?? 0));
}

/** Jamais plus de 2 éléments d'affilée du même joueur. */
function diversify(items) {
  const pool = [...items];
  const out = [];
  while (pool.length) {
    const a = out.length >= 2 ? out[out.length - 1].actorId : null;
    const b = out.length >= 2 ? out[out.length - 2].actorId : null;
    let i = a != null && a === b ? pool.findIndex((x) => x.actorId !== a) : 0;
    if (i < 0) i = 0;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

/** Toute l'activité de la démo, déduite des données : [{ key, verb, actorId, … }], la plus récente d'abord. */
function activities(ctx) {
  const { db } = ctx;
  const out = [];
  for (const p of db.posts) {
    if (p.hiddenAt) continue;
    const catalogItem = ['album', 'track', 'artist'].includes(p.itemType);
    out.push({
      key: `post:${p.id}`, verb: 'post', actorId: p.userId, objectType: 'post', objectId: p.id, itemType: catalogItem ? p.itemType : null,
      itemId: catalogItem ? p.itemId : null, visibility: p.visibility, createdAt: p.createdAt, engagement: p.likeCount + 2 * p.commentCount,
    });
  }
  const rateGroups = new Map();
  for (const r of db.ratings) {
    if (r.review && !r.hiddenAt && Number.isInteger(r.rid)) {
      out.push({
        key: `review:${r.rid}`, verb: 'review', actorId: r.userId, objectType: 'review', objectId: r.rid, itemType: r.type, itemId: r.id,
        visibility: 'public', createdAt: r.reviewAt || r.updatedAt, engagement: (r.likeCount || 0) + 2 * (r.commentCount || 0),
      });
    } else if (!r.review) {
      // Notes du jour : une ligne par joueur et par jour (« a noté 5 albums aujourd'hui »).
      const k = `rate:${r.userId}:${dayKey(r.updatedAt)}`;
      if (!rateGroups.has(k)) rateGroups.set(k, { key: k, verb: 'rate', actorId: r.userId, visibility: 'public', createdAt: 0, rows: [] });
      const g = rateGroups.get(k);
      g.rows.push(r);
      g.createdAt = Math.max(g.createdAt, r.updatedAt);
    }
  }
  for (const g of rateGroups.values()) {
    const rows = g.rows.sort((a, b) => b.updatedAt - a.updatedAt);
    const first = rows[0];
    out.push({
      key: g.key, verb: 'rate', actorId: g.actorId, objectType: first.type, objectId: first.id, itemType: first.type, itemId: first.id,
      visibility: 'public', createdAt: g.createdAt, engagement: 0,
      data: { items: rows.slice(0, GROUP_ITEMS).map((r) => ({ type: r.type, id: r.id, score: r.score })), count: rows.length },
    });
  }
  for (const [uid, list] of Object.entries(db.achievements || {})) {
    const entries = Object.entries(list || {}).sort((a, b) => b[1] - a[1]);
    for (const verb of ['complete', 'master']) {
      const prefix = verb === 'complete' ? 'album:' : 'artist:';
      for (const [key, at] of entries.filter(([k]) => k.startsWith(prefix)).slice(0, PER_ACTOR[verb])) {
        const id = key.slice(prefix.length);
        const type = verb === 'complete' ? 'album' : 'artist';
        out.push({
          key: `${verb}:${uid}:${id}`, verb, actorId: Number(uid), objectType: type, objectId: id, itemType: type, itemId: id,
          visibility: 'public', createdAt: at, engagement: 0,
        });
      }
    }
  }
  for (const l of Array.isArray(db.lists) ? db.lists : []) {
    const count = Number.isInteger(l.itemCount) ? l.itemCount : Array.isArray(l.items) ? l.items.length : 0;
    if (l.kind === 'wishlist' || l.hiddenAt || !count || (l.visibility && l.visibility === 'private')) continue;
    out.push({
      key: `list:${l.id}`, verb: l.kind === 'grid9' ? 'grid' : 'list', actorId: l.userId, objectType: 'list', objectId: l.id,
      visibility: l.visibility || 'public', createdAt: l.updatedAt || l.createdAt || 0, engagement: (l.likeCount || 0) + 2 * (l.commentCount || 0),
      data: { itemCount: count },
    });
  }
  return out.filter((a) => ctx.userById(a.actorId) && Number.isFinite(a.createdAt)).sort((a, b) => b.createdAt - a.createdAt);
}

/** Lignes d'activité → FeedItem pour `viewer` (posts, critiques, listes et joueurs hydratés en une fois). */
function hydrate(ctx, viewer, rows, reasons, refs) {
  const posts = new Map(hydratePosts(ctx, viewer, ctx.db.posts.filter((p) => rows.some((r) => r.verb === 'post' && r.objectId === p.id)), refs).map((p) => [p.id, p]));
  const reviews = reviewsByIds(ctx, viewer, rows.filter((r) => r.verb === 'review').map((r) => r.objectId));
  const lists = listSummaries(ctx, viewer, rows.filter((r) => r.verb === 'list' || r.verb === 'grid').map((r) => r.objectId), refs);
  const users = ctx.summaries(rows.map((r) => r.actorId));
  refs.users(users.values());
  const items = [];
  for (const r of rows) {
    const actor = users.get(r.actorId);
    if (!actor) continue;
    const data = { ...(r.data || {}) };
    const item = {
      id: r.key, verb: r.verb, actor, object: { type: r.objectType, id: String(r.objectId) }, item: r.itemType ? { type: r.itemType, id: r.itemId } : null,
      groupCount: Number(data.count) || 1, data, likeCount: 0, commentCount: 0, liked: false, reason: reasons.get(r.key) || 'popular',
      createdAt: r.createdAt, updatedAt: r.createdAt,
    };
    if (r.itemType) refs.item(r.itemType, r.itemId);
    if (r.verb === 'post') {
      const post = posts.get(r.objectId);
      if (!post) continue;
      Object.assign(item, { post, likeCount: post.likeCount, commentCount: post.commentCount, liked: post.liked });
    } else if (r.verb === 'review') {
      const review = reviews.get(r.objectId);
      if (!review || review.moderated) continue;
      Object.assign(item, { review, likeCount: review.likeCount, commentCount: review.commentCount, liked: review.liked });
    } else if (r.verb === 'list' || r.verb === 'grid') {
      const list = lists.get(r.objectId);
      if (!list) continue;
      Object.assign(item, { list, likeCount: list.likeCount, commentCount: list.commentCount, liked: list.liked });
    } else if (r.verb === 'rate') {
      for (const x of data.items || []) refs.item(x.type, x.id);
    }
    items.push(item);
  }
  return items;
}

/** Genres des albums dont le joueur a des cartes (ses goûts, pour « Pour toi »). */
function tasteGenres(ctx, uid) {
  const counts = new Map();
  for (const key of Object.keys(ctx.db.cards?.[uid] || {})) {
    const album = ctx.ALBUM.get(ctx.TRACK.get(key.split('|')[0])?.albumId);
    if (album?.genre) counts.set(album.genre, (counts.get(album.genre) || 0) + 1);
  }
  return new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g));
}

const genreOf = (ctx, row) => (row.itemType === 'album' ? ctx.ALBUM.get(row.itemId)?.genre
  : row.itemType === 'track' ? ctx.ALBUM.get(ctx.TRACK.get(row.itemId)?.albumId)?.genre
    : row.itemType === 'artist' ? ctx.ARTIST.get(row.itemId)?.genre : null);

/** Activités d'un onglet lisibles par `viewer`, avec leur raison. */
function candidates(ctx, viewer, tab, all) {
  const reasons = new Map();
  const visible = all.filter((r) => !viewer.hidden.has(r.actorId) && canRead(viewer, r.actorId, r.visibility));
  let rows;
  if (tab === 'friends') {
    rows = visible.filter((r) => r.actorId === viewer.id || viewer.friends.has(r.actorId));
    for (const r of rows) reasons.set(r.key, 'friend');
  } else if (tab === 'foryou') {
    const genres = tasteGenres(ctx, viewer.id);
    const rated = new Set(ctx.db.ratings.filter((r) => r.userId === viewer.id).map((r) => `${r.type}:${r.id}`));
    rows = visible.filter((r) => {
      if (r.actorId === viewer.id) return false;
      if (viewer.friends.has(r.actorId)) return r.verb === 'review' && !rated.has(`${r.itemType}:${r.itemId}`);
      return r.visibility === 'public' && genres.has(genreOf(ctx, r));
    });
    for (const r of rows) reasons.set(r.key, viewer.friends.has(r.actorId) ? 'friend' : 'taste');
    // Démarrage à froid : l'activité populaire de la communauté complète l'onglet.
    if (rows.length < 10) {
      const seen = new Set(rows.map((r) => r.key));
      for (const r of visible) {
        if (seen.has(r.key) || r.actorId === viewer.id || viewer.friends.has(r.actorId) || r.visibility !== 'public') continue;
        rows.push(r);
        reasons.set(r.key, 'popular');
      }
    }
  } else {
    rows = visible.filter((r) => r.visibility === 'public');
    for (const r of rows) reasons.set(r.key, r.actorId === viewer.id || viewer.friends.has(r.actorId) ? 'friend' : 'popular');
  }
  return { rows, reasons };
}

/** Classe des activités (score, puis diversité). */
function rank(viewer, rows, now) {
  const scored = rows.map((r) => ({
    r,
    s: scoreOf({ ageHours: (now - r.createdAt) / HOUR, affinity: r.actorId === viewer.id || viewer.friends.has(r.actorId) ? 1 : 0, engagement: r.engagement, verb: r.verb }),
  }));
  scored.sort((a, b) => b.s - a.s || b.r.createdAt - a.r.createdAt);
  return diversify(scored.map((x) => x.r));
}

function feed(ctx, query) {
  processQueue(ctx);
  const u = ctx.me();
  ensure(ctx.db);
  const viewer = viewerOf(ctx, u.id);
  const now = Date.now();
  const all = activities(ctx);
  let tab = query.get('tab') || '';
  if (tab && !TABS.includes(tab)) ctx.fail(400, 'invalid_input', { field: 'tab' });
  if (!tab) tab = all.some((r) => viewer.friends.has(r.actorId) && r.createdAt >= now - FRIENDS_ACTIVE_MS) ? 'friends' : 'community';
  const limit = limitOf(query);
  const [offset = 0] = decodeCursor(query.get('cursor'), ctx) || [];
  const { rows, reasons } = candidates(ctx, viewer, tab, all);
  // Tes amis : ordre chronologique, le score ne réordonne qu'à l'intérieur de la page ; les autres onglets : classés.
  const ordered = tab === 'friends' ? rows : rank(viewer, rows.slice(0, RANKED_CAP), now);
  const pageRows = ordered.slice(offset, offset + limit);
  const refs = collector(ctx);
  const items = hydrate(ctx, viewer, tab === 'friends' ? rank(viewer, pageRows, now) : pageRows, reasons, refs);
  const next = offset + pageRows.length;
  const end = tab === 'friends' ? ordered.length : Math.min(ordered.length, RANKED_CAP);
  return { tab, items, nextCursor: next < end ? encodeCursor([next]) : null, hasFriends: viewer.friends.size > 0, catalog: refs.build() };
}

function userActivity(ctx, rawName, query) {
  processQueue(ctx);
  const u = ctx.me();
  ensure(ctx.db);
  const viewer = viewerOf(ctx, u.id);
  const target = ctx.userByName(decodeURIComponent(rawName));
  if (!target || !target.verified || (target.id !== viewer.id && viewer.hidden.has(target.id))) ctx.fail(404, 'user_not_found');
  const self = target.id === viewer.id;
  const privacy = target.profileVisibility || target.privacy || 'public';
  if (!self && (privacy === 'private' || (privacy === 'friends' && !viewer.friends.has(target.id)))) {
    return { items: [], nextCursor: null, restricted: true, catalog: ctx.refs({}) };
  }
  const rows = activities(ctx).filter((r) => r.actorId === target.id && canRead(viewer, r.actorId, r.visibility));
  const limit = limitOf(query, 10);
  const [offset = 0] = decodeCursor(query.get('cursor'), ctx) || [];
  const pageRows = rows.slice(offset, offset + limit);
  const reasons = new Map(pageRows.map((r) => [r.key, self || viewer.friends.has(r.actorId) ? 'friend' : 'popular']));
  const refs = collector(ctx);
  return {
    items: hydrate(ctx, viewer, pageRows, reasons, refs),
    nextCursor: offset + limit < rows.length ? encodeCursor([offset + limit]) : null,
    catalog: refs.build(),
  };
}

export const routes = [
  ['GET', /^\/feed$/, ({ query, ctx }) => feed(ctx, query)],
  ['GET', /^\/users\/([^/]+)\/activity$/, ({ params, query, ctx }) => userActivity(ctx, params[0], query)],
];

export function seed(db) {
  ensure(db);
}

export function migrate(db) {
  ensure(db);
}
