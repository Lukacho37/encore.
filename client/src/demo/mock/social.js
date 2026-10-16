// Jumeau de démo du module « social » (server/social.js, P1-A, PLAN.md 4.2.1) : mêmes routes, mêmes formes.
//   POST /posts · GET|PATCH|DELETE /posts/:id · GET /users/:username/posts · GET /items/:type/:id/posts
//   GET /comments?target=post:12 · GET /comments/:id/replies · POST /comments · PATCH|DELETE /comments/:id
//   PUT|DELETE|GET /likes/:type/:id · GET /reviews/:id
// Données : db.posts [{ id, userId, body, itemType, itemId, visibility, likeCount, commentCount, createdAt, editedAt,
// hiddenAt }], db.comments [{ id, userId, targetType, targetId, parentId, replyToUserId, body, likeCount, replyCount,
// createdAt, editedAt, deletedAt, hiddenAt }], db.likes [{ userId, targetType, targetId, createdAt }] ; les critiques
// sont les notes avec texte de db.ratings (identifiant `rid`, compteurs likeCount / commentCount tenus ici aussi).
// Les joueurs fictifs publient, aiment et répondent entre eux (seed) ; quand le joueur publie ou commente, l'un d'eux
// réagit quelques secondes plus tard (file db.botQueue, traitée à chaque état et à chaque route du module), ce qui
// remplit le fil, les discussions et les notifications de la démo. Les critiques renvoyées par le jumeau des notes
// reçoivent ici leur `liked` réel (les mentions « J'aime » sont tenues par ce module).
import { notify, unreadCount } from './notifications.js';
import { routes as ratingRoutes, summaryOf, viewerOf } from './ratings.js';

export const name = 'social';

const POST_MAX = 1000;
const COMMENT_MAX = 1000;
const PAGE = 20;
const DISCUSSION_FRIENDS = 5;
const REPLIES_PREVIEW = 2;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const ITEM_TYPES = ['album', 'track', 'artist', 'list', 'review'];
const COMMENT_TARGETS = ['post', 'review', 'list'];
const LIKE_TARGETS = ['post', 'review', 'comment', 'list'];
const MENTION_RE = /(^|[^\w@.])@([a-zA-Z0-9_.]{3,20})/g;
// Délais des réactions des joueurs fictifs (ms) : « J'aime », puis réponse.
const BOT_DELAY = [2000, 3500];

// Curseurs opaques, comme server/paging.js : JSON en base64url.
const encodeCursor = (values) => btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decodeCursor(raw, ctx) {
  if (!raw) return null;
  try {
    const values = JSON.parse(atob(String(raw).replace(/-/g, '+').replace(/_/g, '/')));
    if (Array.isArray(values) && values.length) return values;
  } catch {
    // curseur illisible
  }
  return ctx.fail(400, 'invalid_input', { field: 'cursor' });
}
export const limitOf = (query, def = PAGE) => Math.min(50, Math.max(1, Math.floor(Number(query.get('limit')) || def)));
const toId = (raw) => (/^\d{1,15}$/.test(String(raw ?? '')) ? Number(raw) : null);
export { encodeCursor, decodeCursor };

export function ensure(db) {
  for (const k of ['posts', 'comments', 'likes', 'botQueue']) if (!Array.isArray(db[k])) db[k] = [];
  if (!Number.isInteger(db.nextPostId)) db.nextPostId = 1 + Math.max(0, ...db.posts.map((p) => p.id || 0));
  if (!Number.isInteger(db.nextCommentId)) db.nextCommentId = 1 + Math.max(0, ...db.comments.map((c) => c.id || 0));
  for (const r of db.ratings || []) {
    if (!Number.isInteger(r.likeCount)) r.likeCount = 0;
    if (!Number.isInteger(r.commentCount)) r.commentCount = 0;
  }
}

/** Contenu lisible par `viewer` ({ id, friends, hidden }) : son auteur, ou visible et pas bloqué. */
export function canRead(viewer, ownerId, visibility) {
  if (ownerId === viewer.id) return true;
  if (viewer.hidden.has(ownerId)) return false;
  if (visibility === 'public') return true;
  if (visibility === 'friends') return viewer.friends.has(ownerId);
  return false;
}

const lists = (db) => (Array.isArray(db.lists) ? db.lists : []);
const avatarAlbum = (avatar) => (typeof avatar === 'string' && avatar.startsWith('album:') ? avatar.slice(6) : null);

/** Collecteur des éléments du catalogue cités (champ `catalog` de la réponse). */
export function collector(ctx) {
  const ids = { albumIds: [], trackIds: [], artistIds: [] };
  return {
    item(type, id) {
      if (!id) return;
      if (type === 'album') ids.albumIds.push(id);
      else if (type === 'track') ids.trackIds.push(id);
      else if (type === 'artist') ids.artistIds.push(id);
    },
    users(users) {
      for (const u of users) if (avatarAlbum(u?.avatar)) ids.albumIds.push(avatarAlbum(u.avatar));
    },
    albums(list) {
      ids.albumIds.push(...list);
    },
    build: () => ctx.refs(ids),
  };
}

// ----- cibles (post, critique, liste, commentaire) ----------------------------------------------

/** { type, id, ownerId, hidden, visibility, row, root? } lisible par `viewer`, sinon 404 not_found. */
function readTarget(ctx, viewer, type, rawId) {
  const { db } = ctx;
  const id = toId(rawId);
  if (!id) return ctx.fail(404, 'not_found');
  let row = null;
  let visibility = 'public';
  let root = null;
  if (type === 'post') {
    row = db.posts.find((p) => p.id === id);
    visibility = row?.visibility;
  } else if (type === 'review') {
    row = db.ratings.find((r) => r.rid === id && r.review);
  } else if (type === 'list') {
    row = lists(db).find((l) => l.id === id && l.kind !== 'wishlist');
    visibility = row?.visibility || 'public';
  } else if (type === 'comment') {
    row = db.comments.find((c) => c.id === id && !c.deletedAt);
    if (row) root = readTarget(ctx, viewer, row.targetType, row.targetId);
    if (root?.hidden) row = null;
  }
  if (!row || !canRead(viewer, row.userId, visibility)) return ctx.fail(404, 'not_found');
  const hidden = !!row.hiddenAt;
  if (hidden && row.userId !== viewer.id) return ctx.fail(404, 'not_found');
  return { type, id, ownerId: row.userId, hidden, visibility, row, root };
}

/** Élément (album, morceau) d'une cible : titre et vignette des notifications. */
function itemDataOf(target) {
  const t = target.root || target;
  if (t.type === 'post' && (t.row.itemType === 'album' || t.row.itemType === 'track')) return { itemType: t.row.itemType, itemId: t.row.itemId };
  if (t.type === 'review') return { itemType: t.row.type, itemId: t.row.id };
  return {};
}

/** Cibles d'un type aimées par `uid` parmi `ids`. */
export function likedAmong(db, uid, type, ids) {
  const set = new Set(ids);
  return new Set(db.likes.filter((l) => l.userId === uid && l.targetType === type && set.has(l.targetId)).map((l) => l.targetId));
}

/** Ligne de la table d'une cible (compteurs). */
function counterRow(db, type, id) {
  if (type === 'post') return db.posts.find((p) => p.id === id);
  if (type === 'review') return db.ratings.find((r) => r.rid === id);
  if (type === 'comment') return db.comments.find((c) => c.id === id);
  if (type === 'list') return lists(db).find((l) => l.id === id);
  return null;
}

// ----- critiques et listes -------------------------------------------------------------------------

/** Critiques (Review + item) par identifiants (rid) : Map rid → Review, lisibles par `viewer`. */
export function reviewsByIds(ctx, viewer, ids) {
  const wanted = new Set(ids);
  const rows = ctx.db.ratings.filter((r) => wanted.has(r.rid) && r.review && (!r.hiddenAt || r.userId === viewer.id) && !viewer.hidden.has(r.userId));
  const users = ctx.summaries(rows.map((r) => r.userId));
  const liked = likedAmong(ctx.db, viewer.id, 'review', rows.map((r) => r.rid));
  const out = new Map();
  for (const r of rows) {
    const user = users.get(r.userId);
    if (!user) continue;
    out.set(r.rid, {
      id: r.rid, user, score: r.score, review: r.review, reviewAt: r.reviewAt ?? r.updatedAt, updatedAt: r.updatedAt,
      likeCount: r.likeCount || 0, commentCount: r.commentCount || 0, liked: liked.has(r.rid), friend: viewer.friends.has(r.userId),
      item: { type: r.type, id: r.id }, ...(r.hiddenAt ? { moderated: true } : {}),
    });
  }
  return out;
}

/** Résumés de listes (ListSummary) lisibles par `viewer` : Map id → résumé. */
export function listSummaries(ctx, viewer, ids, refs = null) {
  const wanted = new Set(ids);
  const rows = lists(ctx.db).filter((l) => wanted.has(l.id) && l.kind !== 'wishlist' && canRead(viewer, l.userId, l.visibility || 'public')
    && (!l.hiddenAt || l.userId === viewer.id));
  const users = ctx.summaries(rows.map((l) => l.userId));
  const liked = likedAmong(ctx.db, viewer.id, 'list', rows.map((l) => l.id));
  const out = new Map();
  for (const l of rows) {
    const user = users.get(l.userId);
    if (!user) continue;
    const items = Array.isArray(l.items) ? l.items : [];
    const coverAlbumIds = items.filter((x) => (x.type || x.itemType) === 'album').slice(0, 4).map((x) => x.id || x.itemId).filter(Boolean);
    refs?.albums(coverAlbumIds);
    out.set(l.id, {
      id: l.id, kind: l.kind || 'list', title: l.title || '', user, itemCount: Number.isInteger(l.itemCount) ? l.itemCount : items.length,
      likeCount: l.likeCount || 0, commentCount: l.commentCount || 0, liked: liked.has(l.id), visibility: l.visibility || 'public',
      ranked: !!l.ranked, coverAlbumIds, updatedAt: l.updatedAt || l.createdAt, ...(l.hiddenAt ? { moderated: true } : {}),
    });
  }
  refs?.users(users.values());
  return out;
}

// ----- posts ---------------------------------------------------------------------------------------

/** Lignes de posts → Post pour `viewer` (auteurs, « J'aime », critiques et listes citées, moyennes). */
export function hydratePosts(ctx, viewer, rows, refs) {
  const { db } = ctx;
  const kept = rows.filter((p) => p && canRead(viewer, p.userId, p.visibility) && (!p.hiddenAt || p.userId === viewer.id));
  const users = ctx.summaries(kept.map((p) => p.userId));
  const liked = likedAmong(db, viewer.id, 'post', kept.map((p) => p.id));
  const reviews = reviewsByIds(ctx, viewer, kept.filter((p) => p.itemType === 'review').map((p) => Number(p.itemId)));
  const listMap = listSummaries(ctx, viewer, kept.filter((p) => p.itemType === 'list').map((p) => Number(p.itemId)), refs);
  const out = [];
  for (const p of kept) {
    const user = users.get(p.userId);
    if (!user) continue;
    const post = {
      id: p.id, user, body: p.body, item: p.itemType ? { type: p.itemType, id: p.itemId } : null, visibility: p.visibility,
      likeCount: p.likeCount, commentCount: p.commentCount, liked: liked.has(p.id), createdAt: p.createdAt, editedAt: p.editedAt ?? null,
      mine: p.userId === viewer.id, ...(p.hiddenAt ? { moderated: true } : {}),
    };
    if (p.itemType === 'review') {
      const review = reviews.get(Number(p.itemId));
      if (review) {
        post.review = review;
        refs.item(review.item.type, review.item.id);
        refs.users([review.user]);
      }
    } else if (p.itemType === 'list') {
      const list = listMap.get(Number(p.itemId));
      if (list) post.list = list;
    } else if (p.itemType) {
      refs.item(p.itemType, p.itemId);
      if (p.itemType !== 'artist') {
        const s = summaryOf(db, p.itemType, p.itemId);
        if (s.count) post.itemStats = { average: s.average, count: s.count };
      }
    }
    out.push(post);
  }
  refs.users(users.values());
  return out;
}

const byRecent = (a, b) => b.createdAt - a.createdAt || b.id - a.id;
const byOldest = (a, b) => a.createdAt - b.createdAt || a.id - b.id;

/** Page par curseur [createdAt, id] (du plus récent au plus ancien). */
function keysetPage(ctx, rows, query, def = PAGE) {
  const limit = limitOf(query, def);
  const after = decodeCursor(query.get('cursor'), ctx);
  let list = [...rows].sort(byRecent);
  if (after) list = list.filter((r) => r.createdAt < after[0] || (r.createdAt === after[0] && r.id < after[1]));
  const page = list.slice(0, limit);
  const last = page[page.length - 1];
  return { page, nextCursor: list.length > limit && last ? encodeCursor([last.createdAt, last.id]) : null };
}

function checkItem(ctx, viewer, raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || !ITEM_TYPES.includes(raw.type)) return ctx.fail(400, 'invalid_input', { field: 'item' });
  const { type } = raw;
  if (type === 'album' || type === 'track' || type === 'artist') {
    const id = typeof raw.id === 'string' ? raw.id : null;
    const map = type === 'album' ? ctx.ALBUM : type === 'track' ? ctx.TRACK : ctx.ARTIST;
    if (!id || !map.has(id)) return ctx.fail(404, 'unknown_item');
    return { type, id, ownerId: null };
  }
  try {
    const t = readTarget(ctx, viewer, type, raw.id);
    if (t.hidden) return ctx.fail(404, 'unknown_item');
    return { type, id: String(t.id), ownerId: t.ownerId };
  } catch (err) {
    if (err?.status === 404) return ctx.fail(404, 'unknown_item');
    throw err;
  }
}

function cleanBody(ctx, raw, max) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') return ctx.fail(400, 'invalid_input', { field: 'body' });
  const text = raw.replace(/\r\n?/g, '\n').normalize('NFC').trim().replace(/\n{3,}/g, '\n\n');
  if ([...text].length > max) return ctx.fail(400, 'invalid_input', { field: 'body', max });
  return text;
}

/** Compte actif (pas suspendu), comme deps.access.assertActive. */
function assertActive(ctx, u) {
  if (u.suspendedUntil && u.suspendedUntil > Date.now()) ctx.fail(403, 'suspended', { until: u.suspendedUntil });
}

/** Joueurs cités (@pseudo) dans un texte, sauf l'auteur. */
function mentioned(ctx, text, authorId) {
  const out = new Set();
  for (const m of String(text || '').matchAll(MENTION_RE)) {
    const u = ctx.userByName(m[2].replace(/[.]+$/, ''));
    if (u && u.id !== authorId) out.add(u.id);
    if (out.size >= 5) break;
  }
  return [...out];
}

function createPost(ctx, u, body, { at = Date.now() } = {}) {
  const { db } = ctx;
  assertActive(ctx, u);
  const viewer = viewerOf(ctx, u.id);
  const text = cleanBody(ctx, body.body, POST_MAX);
  const item = checkItem(ctx, viewer, body.item);
  const visibility = body.visibility === 'friends' ? 'friends' : 'public';
  if (!text && !item) ctx.fail(400, 'post_empty');
  const posted = db.posts.filter((p) => p.userId === u.id && p.createdAt >= at - DAY);
  if (posted.length >= 20) ctx.fail(429, 'quota_exceeded', { kind: 'posts' });
  if (posted.some((p) => (text ? p.body === text : !p.body && p.itemType === item.type && p.itemId === item.id))) ctx.fail(409, 'duplicate_post');
  const row = {
    id: db.nextPostId++, userId: u.id, body: text, itemType: item?.type ?? null, itemId: item?.id ?? null, visibility,
    likeCount: 0, commentCount: 0, createdAt: at, editedAt: null, hiddenAt: null,
  };
  db.posts.push(row);
  const data = { postId: row.id, ...itemDataOf({ type: 'post', row }) };
  const notified = new Set([u.id]);
  if (item?.ownerId && !notified.has(item.ownerId)) {
    notified.add(item.ownerId);
    notify(db, item.ownerId, `mention_${item.type}`, { actorId: u.id, targetType: 'post', targetId: row.id, groupKey: `mention:${item.type}:${item.id}`, data, at });
  }
  for (const uid of mentioned(ctx, text, u.id)) {
    if (notified.has(uid)) continue;
    notified.add(uid);
    notify(db, uid, 'mention_post', { actorId: u.id, targetType: 'post', targetId: row.id, groupKey: `mention:post:${row.id}`, data, at });
  }
  return row;
}

// ----- commentaires ----------------------------------------------------------------------------------

function hydrateComments(ctx, viewer, rows, refs, replies = new Map()) {
  const all = [...rows, ...[...replies.values()].flat()];
  const users = ctx.summaries(all.flatMap((c) => [c.userId, c.replyToUserId].filter(Boolean)));
  refs?.users(users.values());
  const liked = likedAmong(ctx.db, viewer.id, 'comment', all.map((c) => c.id));
  const one = (c) => {
    const deleted = !!c.deletedAt;
    const user = deleted ? null : users.get(c.userId);
    if (!deleted && !user) return null;
    const to = c.replyToUserId ? users.get(c.replyToUserId) : null;
    return {
      id: c.id, user, body: deleted ? null : c.body, deleted, parentId: c.parentId ?? null,
      replyToUser: to ? { id: to.id, username: to.username } : null, likeCount: deleted ? 0 : c.likeCount, liked: liked.has(c.id),
      replyCount: c.replyCount, createdAt: c.createdAt, editedAt: c.editedAt ?? null, mine: !deleted && c.userId === viewer.id,
      ...(c.hiddenAt ? { moderated: true } : {}),
    };
  };
  return rows.map((c) => {
    const x = one(c);
    if (x && replies.has(c.id)) x.replies = replies.get(c.id).map(one).filter(Boolean);
    return x;
  }).filter(Boolean);
}

const visibleComment = (viewer) => (c) => (!c.hiddenAt || c.userId === viewer.id) && !viewer.hidden.has(c.userId);

/** Commentaires de tête d'une cible (les plus anciens d'abord), chacun avec ses deux premières réponses. */
function commentsPage(ctx, viewer, target, query, refs) {
  const limit = limitOf(query);
  const after = decodeCursor(query.get('cursor'), ctx);
  let rows = ctx.db.comments.filter((c) => c.targetType === target.type && c.targetId === target.id && !c.parentId && visibleComment(viewer)(c)).sort(byOldest);
  if (after) rows = rows.filter((c) => c.createdAt > after[0] || (c.createdAt === after[0] && c.id > after[1]));
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const replies = new Map();
  for (const c of page) {
    if (!c.replyCount) continue;
    replies.set(c.id, ctx.db.comments.filter((r) => r.parentId === c.id && visibleComment(viewer)(r)).sort(byOldest).slice(0, REPLIES_PREVIEW));
  }
  return { items: hydrateComments(ctx, viewer, page, refs, replies), nextCursor: rows.length > limit && last ? encodeCursor([last.createdAt, last.id]) : null };
}

function createComment(ctx, u, body, { at = Date.now(), quota = true } = {}) {
  const { db } = ctx;
  assertActive(ctx, u);
  const viewer = viewerOf(ctx, u.id);
  if (!COMMENT_TARGETS.includes(body.targetType)) ctx.fail(400, 'invalid_input', { field: 'targetType' });
  const text = cleanBody(ctx, body.body, COMMENT_MAX);
  if (!text) ctx.fail(400, 'comment_empty');
  const target = readTarget(ctx, viewer, body.targetType, body.targetId);
  if (target.hidden) ctx.fail(409, 'thread_locked');
  let parent = null;
  let replyTo = null;
  let repliedTo = null;
  if (body.parentId !== undefined && body.parentId !== null) {
    const p = db.comments.find((c) => c.id === toId(body.parentId));
    if (!p || p.targetType !== target.type || p.targetId !== target.id || p.hiddenAt || viewer.hidden.has(p.userId)) ctx.fail(404, 'not_found');
    if (p.parentId) {
      // Réponse à une réponse : rattachée au commentaire de tête, avec « à @nom ».
      if (p.deletedAt) ctx.fail(404, 'not_found');
      parent = db.comments.find((c) => c.id === p.parentId);
      replyTo = p.userId === u.id ? null : p.userId;
      repliedTo = p;
    } else {
      parent = p;
      repliedTo = p.deletedAt ? null : p;
    }
  }
  if (quota && db.comments.filter((c) => c.userId === u.id && c.createdAt >= at - DAY).length >= 60) ctx.fail(429, 'quota_exceeded', { kind: 'comments' });
  const row = {
    id: db.nextCommentId++, userId: u.id, targetType: target.type, targetId: target.id, parentId: parent?.id ?? null, replyToUserId: replyTo,
    body: text, likeCount: 0, replyCount: 0, createdAt: at, editedAt: null, deletedAt: null, hiddenAt: null,
  };
  db.comments.push(row);
  const counted = counterRow(db, target.type, target.id);
  if (counted) counted.commentCount = (counted.commentCount || 0) + 1;
  if (parent) parent.replyCount = (parent.replyCount || 0) + 1;
  // Notifications groupées par fil : la personne à qui on répond, le propriétaire de la cible, les joueurs cités.
  const data = { commentId: row.id, ...itemDataOf(target) };
  const base = { actorId: u.id, targetType: target.type, targetId: target.id, data, at };
  const group = `comment:${target.type}:${target.id}`;
  const notified = new Set([u.id]);
  for (const uid of [repliedTo?.userId, replyTo]) {
    if (!uid || notified.has(uid)) continue;
    notified.add(uid);
    notify(db, uid, 'reply_comment', { ...base, groupKey: group });
  }
  if (!notified.has(target.ownerId)) {
    notified.add(target.ownerId);
    notify(db, target.ownerId, `comment_${target.type}`, { ...base, groupKey: group });
  }
  for (const uid of mentioned(ctx, text, u.id)) {
    if (notified.has(uid)) continue;
    notified.add(uid);
    notify(db, uid, 'mention_comment', { ...base, groupKey: `mention:comment:${target.type}:${target.id}` });
  }
  return { row, target };
}

// ----- mentions « J'aime » ---------------------------------------------------------------------------

function setLike(ctx, u, type, rawId, on, { at = Date.now() } = {}) {
  const { db } = ctx;
  if (!LIKE_TARGETS.includes(type)) ctx.fail(404, 'not_found');
  assertActive(ctx, u);
  const target = readTarget(ctx, viewerOf(ctx, u.id), type, rawId);
  if (target.hidden) ctx.fail(404, 'not_found');
  const row = counterRow(db, type, target.id);
  const idx = db.likes.findIndex((l) => l.userId === u.id && l.targetType === type && l.targetId === target.id);
  const groupKey = `like:${type}:${target.id}`;
  if (on && idx < 0) {
    db.likes.push({ userId: u.id, targetType: type, targetId: target.id, createdAt: at });
    row.likeCount = (row.likeCount || 0) + 1;
    // Un commentaire se lit dans son fil : la notification mène au fil, le commentaire est dans data.
    const root = target.root || target;
    notify(db, target.ownerId, `like_${type}`, {
      actorId: u.id, targetType: root.type, targetId: root.id, groupKey, at,
      data: { ...itemDataOf(target), ...(type === 'comment' ? { commentId: target.id } : {}) },
    });
  } else if (!on && idx >= 0) {
    db.likes.splice(idx, 1);
    row.likeCount = Math.max(0, (row.likeCount || 0) - 1);
    if (Array.isArray(db.notifications)) {
      db.notifications = db.notifications.filter((n) => !(n.userId === target.ownerId && n.actorId === u.id && n.groupKey === groupKey && !n.readAt));
    }
  }
  return { liked: on, likeCount: row.likeCount || 0 };
}

// ----- réactions des joueurs fictifs ------------------------------------------------------------------

const BOT_COMMENTS = [
  'Bien vu, je l’écoute ce soir.',
  'Complètement d’accord !',
  'Je ne l’avais jamais entendu comme ça, merci.',
  'Ajouté à ma liste d’écoute.',
  'Pareil, il tourne en boucle chez moi.',
];
const BOT_REPLIES = ['Merci pour ta réponse !', 'Tout à fait.', 'On en reparle après ta prochaine écoute ?'];

const bots = (db) => db.users.filter((u) => u.bot);
const pick = (list, seed) => list[Math.abs(seed) % list.length];

/** Programme la réaction d'un joueur fictif. */
function queue(db, entry) {
  db.botQueue.push({ ...entry, at: Date.now() + entry.delay });
}

/** Réactions arrivées à échéance : mentions « J'aime » et réponses des joueurs fictifs (notifications comprises). */
export function processQueue(ctx) {
  const { db } = ctx;
  ensure(db);
  if (!db.botQueue.length) return;
  const now = Date.now();
  const due = db.botQueue.filter((e) => e.at <= now);
  if (!due.length) return;
  db.botQueue = db.botQueue.filter((e) => e.at > now);
  for (const e of due) {
    const bot = ctx.userById(e.botId);
    if (!bot) continue;
    try {
      if (e.kind === 'like') setLike(ctx, bot, e.targetType, e.targetId, true, { at: e.at });
      else createComment(ctx, bot, { targetType: e.targetType, targetId: e.targetId, parentId: e.parentId ?? null, body: e.body }, { at: e.at, quota: false });
    } catch {
      // contenu retiré entre-temps : la réaction est abandonnée
    }
  }
}

/** Après un post public du joueur : un joueur fictif aime, un autre commente. */
function reactToPost(db, post) {
  const list = bots(db);
  if (!list.length || post.visibility !== 'public') return;
  queue(db, { kind: 'like', botId: pick(list, post.id).id, targetType: 'post', targetId: post.id, delay: BOT_DELAY[0] });
  queue(db, { kind: 'comment', botId: pick(list, post.id + 1).id, targetType: 'post', targetId: post.id, body: pick(BOT_COMMENTS, post.id), delay: BOT_DELAY[1] });
}

/** Après un commentaire du joueur sur le contenu d'un joueur fictif (ou en réponse à l'un d'eux) : il aime et répond. */
function reactToComment(ctx, comment, target) {
  const { db } = ctx;
  const isBot = (id) => !!id && !!ctx.userById(id)?.bot;
  const parent = comment.parentId ? db.comments.find((c) => c.id === comment.parentId) : null;
  const botId = isBot(comment.replyToUserId) ? comment.replyToUserId : isBot(parent?.userId) ? parent.userId : isBot(target.ownerId) ? target.ownerId : null;
  if (!botId || botId === comment.userId) return;
  queue(db, { kind: 'like', botId, targetType: 'comment', targetId: comment.id, delay: BOT_DELAY[0] });
  queue(db, { kind: 'comment', botId, targetType: target.type, targetId: target.id, parentId: comment.id, body: pick(BOT_REPLIES, comment.id), delay: BOT_DELAY[1] });
}

// ----- routes ------------------------------------------------------------------------------------------

/** Joueur affiché (vérifié, pas bloqué), sinon 404 user_not_found. */
function targetUser(ctx, viewer, raw) {
  const u = ctx.userByName(decodeURIComponent(raw));
  if (!u || !u.verified || (u.id !== viewer.id && viewer.hidden.has(u.id))) ctx.fail(404, 'user_not_found');
  return u;
}

/** Début d'une route : réactions échues écrites, joueur connecté et ses relations. */
function start(ctx) {
  processQueue(ctx);
  const u = ctx.me();
  return { u, viewer: viewerOf(ctx, u.id) };
}

export const routes = [
  ['POST', /^\/posts$/, ({ body, ctx }) => {
    const { u, viewer } = start(ctx);
    const row = createPost(ctx, u, body);
    reactToPost(ctx.db, row);
    const refs = collector(ctx);
    const [post] = hydratePosts(ctx, viewer, [row], refs);
    return { post, catalog: refs.build() };
  }],
  ['GET', /^\/posts\/(\d+)$/, ({ params, query, ctx }) => {
    const { viewer } = start(ctx);
    const target = readTarget(ctx, viewer, 'post', params[0]);
    const refs = collector(ctx);
    const [post] = hydratePosts(ctx, viewer, [target.row], refs);
    if (!post) ctx.fail(404, 'not_found');
    return { post, comments: commentsPage(ctx, viewer, target, query, refs), catalog: refs.build() };
  }],
  ['PATCH', /^\/posts\/(\d+)$/, ({ params, body, ctx }) => {
    const { u, viewer } = start(ctx);
    const row = ctx.db.posts.find((p) => p.id === toId(params[0]));
    if (!row || row.userId !== u.id) ctx.fail(404, 'not_found');
    assertActive(ctx, u);
    const text = cleanBody(ctx, body.body, POST_MAX);
    if (!text && !row.itemType) ctx.fail(400, 'post_empty');
    if (text !== row.body) Object.assign(row, { body: text, editedAt: Date.now() });
    const refs = collector(ctx);
    const [post] = hydratePosts(ctx, viewer, [row], refs);
    return { post, catalog: refs.build() };
  }],
  ['DELETE', /^\/posts\/(\d+)$/, ({ params, ctx }) => {
    const { u } = start(ctx);
    const { db } = ctx;
    const id = toId(params[0]);
    const row = db.posts.find((p) => p.id === id);
    if (!row || row.userId !== u.id) ctx.fail(404, 'not_found');
    // Le post part avec ses commentaires, ses mentions « J'aime » et ses notifications (purgeTarget).
    const commentIds = new Set(db.comments.filter((c) => c.targetType === 'post' && c.targetId === id).map((c) => c.id));
    db.posts = db.posts.filter((p) => p.id !== id);
    db.comments = db.comments.filter((c) => !commentIds.has(c.id));
    db.likes = db.likes.filter((l) => !(l.targetType === 'post' && l.targetId === id) && !(l.targetType === 'comment' && commentIds.has(l.targetId)));
    if (Array.isArray(db.notifications)) db.notifications = db.notifications.filter((n) => !(n.targetType === 'post' && n.targetId === String(id)));
    return { ok: true };
  }],
  ['GET', /^\/users\/([^/]+)\/posts$/, ({ params, query, ctx }) => {
    const { viewer } = start(ctx);
    const target = targetUser(ctx, viewer, params[0]);
    const self = target.id === viewer.id;
    const privacy = target.profileVisibility || target.privacy || 'public';
    if (!self && (privacy === 'private' || (privacy === 'friends' && !viewer.friends.has(target.id)))) {
      return { items: [], nextCursor: null, restricted: true, catalog: ctx.refs({}) };
    }
    const rows = ctx.db.posts.filter((p) => p.userId === target.id && (self || (!p.hiddenAt && canRead(viewer, p.userId, p.visibility))));
    const { page, nextCursor } = keysetPage(ctx, rows, query);
    const refs = collector(ctx);
    return { items: hydratePosts(ctx, viewer, page, refs), nextCursor, catalog: refs.build() };
  }],
  ['GET', /^\/items\/(album|track|artist)\/([^/]+)\/posts$/, ({ params, query, ctx }) => {
    const { viewer } = start(ctx);
    const type = params[0];
    const id = decodeURIComponent(params[1]);
    const map = type === 'album' ? ctx.ALBUM : type === 'track' ? ctx.TRACK : ctx.ARTIST;
    if (!map.has(id)) ctx.fail(404, 'unknown_item');
    const about = ctx.db.posts.filter((p) => p.itemType === type && p.itemId === id && !p.hiddenAt);
    // Première page : les posts des amis d'abord (5 au plus), puis tout le monde.
    const top = query.get('cursor') ? [] : about.filter((p) => viewer.friends.has(p.userId)).sort(byRecent).slice(0, DISCUSSION_FRIENDS);
    const rest = about.filter((p) => !viewer.friends.has(p.userId) && !viewer.hidden.has(p.userId) && canRead(viewer, p.userId, p.visibility));
    const { page, nextCursor } = keysetPage(ctx, rest, query, 10);
    const refs = collector(ctx);
    return { items: hydratePosts(ctx, viewer, [...top, ...page], refs), nextCursor, catalog: refs.build() };
  }],
  ['GET', /^\/comments$/, ({ query, ctx }) => {
    const { viewer } = start(ctx);
    const m = /^(post|review|list):(\d{1,15})$/.exec(query.get('target') || '');
    if (!m) ctx.fail(400, 'invalid_input', { field: 'target' });
    const target = readTarget(ctx, viewer, m[1], m[2]);
    const refs = collector(ctx);
    return { ...commentsPage(ctx, viewer, target, query, refs), catalog: refs.build() };
  }],
  ['GET', /^\/comments\/(\d+)\/replies$/, ({ params, query, ctx }) => {
    const { viewer } = start(ctx);
    const parent = ctx.db.comments.find((c) => c.id === toId(params[0]) && !c.parentId);
    if (!parent || (parent.hiddenAt && parent.userId !== viewer.id)) ctx.fail(404, 'not_found');
    readTarget(ctx, viewer, parent.targetType, parent.targetId);
    const limit = limitOf(query);
    const after = decodeCursor(query.get('cursor'), ctx);
    let rows = ctx.db.comments.filter((c) => c.parentId === parent.id && visibleComment(viewer)(c)).sort(byOldest);
    if (after) rows = rows.filter((c) => c.createdAt > after[0] || (c.createdAt === after[0] && c.id > after[1]));
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const refs = collector(ctx);
    return { items: hydrateComments(ctx, viewer, page, refs), nextCursor: rows.length > limit && last ? encodeCursor([last.createdAt, last.id]) : null, catalog: refs.build() };
  }],
  ['POST', /^\/comments$/, ({ body, ctx }) => {
    const { u, viewer } = start(ctx);
    const { row, target } = createComment(ctx, u, body);
    reactToComment(ctx, row, target);
    const refs = collector(ctx);
    const [comment] = hydrateComments(ctx, viewer, [row], refs);
    return { comment, catalog: refs.build() };
  }],
  ['PATCH', /^\/comments\/(\d+)$/, ({ params, body, ctx }) => {
    const { u, viewer } = start(ctx);
    const row = ctx.db.comments.find((c) => c.id === toId(params[0]));
    if (!row || row.userId !== u.id || row.deletedAt) ctx.fail(404, 'not_found');
    assertActive(ctx, u);
    const text = cleanBody(ctx, body.body, COMMENT_MAX);
    if (!text) ctx.fail(400, 'comment_empty');
    if (text !== row.body) Object.assign(row, { body: text, editedAt: Date.now() });
    const refs = collector(ctx);
    const [comment] = hydrateComments(ctx, viewer, [row], refs);
    return { comment, catalog: refs.build() };
  }],
  ['DELETE', /^\/comments\/(\d+)$/, ({ params, ctx }) => {
    const { u } = start(ctx);
    const { db } = ctx;
    const id = toId(params[0]);
    const row = db.comments.find((c) => c.id === id);
    if (!row || row.deletedAt) ctx.fail(404, 'not_found');
    // Par son auteur, ou par le propriétaire du fil ; avec des réponses, il reste vidé (« Commentaire supprimé »).
    const owner = counterRow(db, row.targetType, row.targetId)?.userId;
    if (row.userId !== u.id && owner !== u.id) ctx.fail(404, 'not_found');
    const hasReplies = !row.parentId && db.comments.some((c) => c.parentId === id);
    if (hasReplies) Object.assign(row, { deletedAt: Date.now(), body: '—', editedAt: null, likeCount: 0, hiddenAt: null });
    else {
      db.comments = db.comments.filter((c) => c.id !== id);
      const parent = row.parentId ? db.comments.find((c) => c.id === row.parentId) : null;
      if (parent) {
        parent.replyCount = Math.max(0, (parent.replyCount || 0) - 1);
        if (parent.deletedAt && !db.comments.some((c) => c.parentId === parent.id)) db.comments = db.comments.filter((c) => c.id !== parent.id);
      }
    }
    const counted = counterRow(db, row.targetType, row.targetId);
    if (counted) counted.commentCount = Math.max(0, (counted.commentCount || 0) - 1);
    db.likes = db.likes.filter((l) => !(l.targetType === 'comment' && l.targetId === id));
    if (Array.isArray(db.notifications)) db.notifications = db.notifications.filter((n) => n.data?.commentId !== id);
    return { ok: true };
  }],
  ['PUT', /^\/likes\/(\w+)\/(\d+)$/, ({ params, ctx }) => setLike(ctx, start(ctx).u, params[0], params[1], true)],
  ['DELETE', /^\/likes\/(\w+)\/(\d+)$/, ({ params, ctx }) => setLike(ctx, start(ctx).u, params[0], params[1], false)],
  ['GET', /^\/likes\/(\w+)\/(\d+)$/, ({ params, query, ctx }) => {
    const { viewer } = start(ctx);
    const type = params[0];
    if (!LIKE_TARGETS.includes(type)) ctx.fail(404, 'not_found');
    const target = readTarget(ctx, viewer, type, params[1]);
    // Les amis d'abord, puis les autres, les plus récents d'abord (curseur par décalage dans la démo).
    const rows = ctx.db.likes.filter((l) => l.targetType === type && l.targetId === target.id && !viewer.hidden.has(l.userId))
      .sort((a, b) => (viewer.friends.has(b.userId) ? 1 : 0) - (viewer.friends.has(a.userId) ? 1 : 0) || b.createdAt - a.createdAt);
    const limit = limitOf(query);
    const [offset = 0] = decodeCursor(query.get('cursor'), ctx) || [];
    const page = rows.slice(offset, offset + limit);
    const users = ctx.summaries(page.map((l) => l.userId));
    const refs = collector(ctx);
    refs.users(users.values());
    return {
      items: page.map((l) => users.get(l.userId)).filter(Boolean),
      nextCursor: offset + limit < rows.length ? encodeCursor([offset + limit]) : null,
      catalog: refs.build(),
    };
  }],
  ['GET', /^\/reviews\/(\d+)$/, ({ params, query, ctx }) => {
    const { viewer } = start(ctx);
    const target = readTarget(ctx, viewer, 'review', params[0]);
    const review = reviewsByIds(ctx, viewer, [target.id]).get(target.id);
    if (!review) ctx.fail(404, 'not_found');
    const refs = collector(ctx);
    refs.item(review.item.type, review.item.id);
    refs.users([review.user]);
    const comments = commentsPage(ctx, viewer, target, query, refs);
    return { review, item: review.item, comments, catalog: refs.build() };
  }],
];

// Les critiques servies par le jumeau des notes (pages album et morceau, pages suivantes) reçoivent leur `liked` réel :
// les mentions « J'aime » de la démo sont tenues par ce module (le vrai serveur le fait dans ratings.js, repris par P1-A).
function withLiked(ctx, result) {
  const { db } = ctx;
  if (!result || typeof result !== 'object' || !Array.isArray(db.likes) || !db.session) return result;
  const liked = new Set(db.likes.filter((l) => l.userId === db.session && l.targetType === 'review').map((l) => l.targetId));
  const mark = (list) => {
    if (Array.isArray(list)) for (const r of list) if (r && Number.isInteger(r.id) && 'likeCount' in r) r.liked = liked.has(r.id);
  };
  mark(result.friends?.reviews);
  mark(result.community?.reviews);
  mark(result.items);
  return result;
}
for (const route of ratingRoutes) {
  // Seulement les notes d'un album ou d'un morceau et leurs pages de critiques (pas le fil ni le journal d'un joueur).
  if (!route[1].source.startsWith('^\\/ratings\\/(album')) continue;
  const handler = route[2];
  route[2] = (args) => withLiked(args.ctx, handler(args));
}

// ----- joueurs fictifs : posts, commentaires, mentions « J'aime » ----------------------------------------

const SEED_POSTS = [
  ['maxvinyl', 'Réécouté Discovery d’une traite ce soir. Digital Love vieillit tellement bien… et j’ai enfin eu One More Time en légendaire.', ['album', 'discovery'], 3],
  ['lea.beats', 'Qui d’autre a pressé ce morceau ? 1 600 royalties, mais aucun regret.', ['track', 'racine-carree:03'], 5],
  ['soulcollector', 'Kind of Blue au casque, lumières éteintes. Rien de mieux pour finir la semaine.', ['album', 'kind-of-blue'], 9],
  ['k.dot_fan', 'Kendrick a sorti le meilleur album-concept de la décennie, je ne changerai pas d’avis.', ['artist', 'kendrick-lamar'], 20],
  ['lea.beats', 'Ma playlist du dimanche : Stromae, Adele, Billie Eilish. Vos suggestions pour la compléter ?', null, 26],
  ['maxvinyl', 'La face B d’Abbey Road, c’est seize minutes de génie sans un temps mort.', ['album', 'abbey-road'], 32],
  ['soulcollector', 'Back to Black : chaque morceau raconte une histoire. Le vinyle est enfin complet dans ma vinylthèque.', ['album', 'back-to-black'], 40],
];

// [post (indice) ou critique ('review:<pseudo>:<album>'), pseudo, texte, indice du commentaire auquel on répond]
const SEED_COMMENTS = [
  [0, 'lea.beats', 'Digital Love, c’est le soleil en musique.'],
  [0, 'k.dot_fan', 'Veridis Quo pour moi, sans hésiter.'],
  [0, 'maxvinyl', 'Exactement, et en vinyle c’est encore mieux.', 0],
  [2, 'maxvinyl', 'Blue in Green, à chaque fois des frissons.'],
  [4, 'soulcollector', 'Amy Winehouse, forcément.'],
  [4, 'k.dot_fan', 'Ajoute un peu de Kendrick, ça réveille.'],
  [4, 'lea.beats', 'Noté, merci !', 5],
  [5, 'soulcollector', 'Golden Slumbers me met les larmes aux yeux.'],
  ['review:maxvinyl:discovery', 'k.dot_fan', 'D’accord sur toute la ligne.'],
  ['review:soulcollector:kind-of-blue', 'lea.beats', 'Je l’écoute ce soir grâce à toi.'],
];

const SEED_LIKES = [
  [0, ['lea.beats', 'k.dot_fan', 'soulcollector']], [1, ['maxvinyl']], [2, ['maxvinyl', 'lea.beats']], [3, ['lea.beats']],
  [4, ['soulcollector', 'k.dot_fan']], [5, ['k.dot_fan']], [6, ['maxvinyl', 'lea.beats']],
  ['review:maxvinyl:discovery', ['lea.beats', 'soulcollector']], ['review:lea.beats:back-to-black', ['soulcollector']],
  ['review:k.dot_fan:good-kid-maad-city', ['maxvinyl', 'lea.beats']],
];

export function seed(db, ctx) {
  ensure(db);
  if (db.socialSeeded) return;
  db.socialSeeded = true;
  const now = Date.now();
  const byName = (n) => ctx.userByName(n);
  const posts = SEED_POSTS.map(([username, body, item, hoursAgo]) => {
    const u = byName(username);
    if (!u) return null;
    if (item && !(item[0] === 'album' ? ctx.ALBUM : item[0] === 'track' ? ctx.TRACK : ctx.ARTIST).has(item[1])) return null;
    const row = {
      id: db.nextPostId++, userId: u.id, body, itemType: item?.[0] ?? null, itemId: item?.[1] ?? null, visibility: 'public',
      likeCount: 0, commentCount: 0, createdAt: now - hoursAgo * HOUR, editedAt: null, hiddenAt: null,
    };
    db.posts.push(row);
    return row;
  });
  const reviewOf = (key) => {
    const [, username, albumId] = key.split(':');
    const u = byName(username);
    return u ? db.ratings.find((r) => r.userId === u.id && r.type === 'album' && r.id === albumId && r.review) : null;
  };
  const targetOf = (ref) => {
    if (typeof ref === 'number') return posts[ref] ? { type: 'post', id: posts[ref].id, row: posts[ref], at: posts[ref].createdAt } : null;
    const r = reviewOf(ref);
    return r && Number.isInteger(r.rid) ? { type: 'review', id: r.rid, row: r, at: r.reviewAt || r.updatedAt } : null;
  };
  const comments = [];
  SEED_COMMENTS.forEach(([ref, username, body, parentIdx], i) => {
    const target = targetOf(ref);
    const u = byName(username);
    if (!target || !u) return;
    const parent = parentIdx !== undefined ? comments[parentIdx] : null;
    const row = {
      id: db.nextCommentId++, userId: u.id, targetType: target.type, targetId: target.id, parentId: parent?.id ?? null, replyToUserId: null,
      body, likeCount: 0, replyCount: 0, createdAt: Math.min(now - 60_000, target.at + (i + 1) * 20 * 60_000), editedAt: null, deletedAt: null, hiddenAt: null,
    };
    db.comments.push(row);
    comments[i] = row;
    target.row.commentCount = (target.row.commentCount || 0) + 1;
    if (parent) parent.replyCount += 1;
  });
  for (const [ref, names] of SEED_LIKES) {
    const target = targetOf(ref);
    if (!target) continue;
    for (const n of names) {
      const u = byName(n);
      if (!u || u.id === target.row.userId) continue;
      db.likes.push({ userId: u.id, targetType: target.type, targetId: target.id, createdAt: target.at + 30 * 60_000 });
      target.row.likeCount = (target.row.likeCount || 0) + 1;
    }
  }
}

export function migrate(db, ctx) {
  // Sauvegarde d'avant le fil : tables créées, puis les posts et réactions des joueurs fictifs.
  ensure(db);
  if (!db.socialSeeded) seed(db, ctx);
}

/**
 * Pastilles de state.counts : les réactions échues des joueurs fictifs sont écrites d'abord, puis la pastille des
 * notifications est recomptée (ce module passe après celui des notifications : la cloche est à jour tout de suite).
 */
export function counts(db, ctx, uid) {
  try {
    processQueue(ctx);
    return { unread: unreadCount(db, uid) };
  } catch {
    // la démo continue sans les réactions
    return {};
  }
}
