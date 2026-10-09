// Jumeau de démo du module « ratings » (server/ratings.js, P0-C, PLAN.md 4.1.2) : mêmes routes, mêmes formes.
// Les notes de la démo restent dans db.ratings (forme du cœur : { userId, type, id, score, review, createdAt,
// updatedAt }) ; ce module leur ajoute un identifiant stable `rid` (l'identifiant de la critique), `reviewAt`, les
// compteurs `likeCount` / `commentCount` et `hiddenAt`, puis répond aux routes des notes avant le cœur : critiques
// des amis (« Vos amis ») puis de la communauté par pages de 10 (curseur), fil des amis et journal d'un joueur.
// Les joueurs fictifs écrivent aussi des critiques de morceaux, pour que les pages morceau ne soient pas vides.
export const name = 'ratings';

const REVIEW_MAX = 2000;
const PAGE = 10;
const DUPLICATE_WINDOW = 20;

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

const itemExists = (ctx, type, id) => (type === 'album' ? ctx.ALBUM.has(id) : type === 'track' ? ctx.TRACK.has(id) : false);
const avatarAlbum = (avatar) => (typeof avatar === 'string' && avatar.startsWith('album:') ? avatar.slice(6) : null);
const avatarAlbums = (users) => [...users].map((u) => avatarAlbum(u.avatar)).filter(Boolean);

/** Complète une note de la démo (identifiant stable, date du texte, compteurs). */
function normalize(db, r) {
  if (!Number.isInteger(r.rid)) r.rid = db.nextRatingId++;
  if (!r.review) r.reviewAt = null;
  else if (!Number.isFinite(r.reviewAt)) r.reviewAt = r.updatedAt;
  if (!Number.isInteger(r.likeCount)) r.likeCount = 0;
  if (!Number.isInteger(r.commentCount)) r.commentCount = 0;
  if (r.hiddenAt === undefined) r.hiddenAt = null;
}

function ensure(db) {
  if (!Number.isInteger(db.nextRatingId)) db.nextRatingId = 1 + Math.max(0, ...db.ratings.map((r) => (Number.isInteger(r.rid) ? r.rid : 0)));
  for (const r of db.ratings) normalize(db, r);
}

/** Amis acceptés du joueur. */
const friendIds = (db, uid) => new Set(db.friendships.filter((f) => f.status === 'accepted' && (f.requester === uid || f.addressee === uid))
  .map((f) => (f.requester === uid ? f.addressee : f.requester)));

/** Joueurs masqués (blocages, si le jumeau de la modération en tient : db.blocks = [{ blocker, blocked }]). */
function hiddenIds(db, uid) {
  const out = new Set();
  for (const b of Array.isArray(db.blocks) ? db.blocks : []) {
    if (b?.blocker === uid) out.add(b.blocked);
    if (b?.blocked === uid) out.add(b.blocker);
  }
  return out;
}

/** Résumé des notes d'un élément : { count, average, distribution[11], reviewCount } (comme rating_stats). */
export function summaryOf(db, type, id) {
  const rows = db.ratings.filter((r) => r.type === type && r.id === id);
  const distribution = Array(11).fill(0);
  let sum = 0;
  for (const r of rows) {
    distribution[r.score] += 1;
    sum += r.score;
  }
  return { count: rows.length, average: rows.length ? sum / rows.length : null, distribution, reviewCount: rows.filter((r) => r.review).length };
}

/** Amis et joueurs masqués de celui qui regarde. */
export function viewerOf(ctx, uid) {
  const hidden = hiddenIds(ctx.db, uid);
  const friends = new Set([...friendIds(ctx.db, uid)].filter((id) => !hidden.has(id)));
  return { id: uid, friends, hidden };
}

/** Notes → critiques (Review), auteurs en résumés de joueurs (UserSummary). */
function hydrate(ctx, rows, viewer) {
  const users = ctx.summaries(rows.map((r) => r.userId));
  const items = rows.filter((r) => users.has(r.userId)).map((r) => ({
    id: r.rid,
    user: users.get(r.userId),
    score: r.score,
    review: r.review,
    reviewAt: r.reviewAt,
    updatedAt: r.updatedAt,
    likeCount: r.likeCount,
    commentCount: r.commentCount,
    liked: false,
    friend: viewer.friends.has(r.userId),
    ...(r.hiddenAt ? { moderated: true } : {}),
  }));
  return { items, users };
}

const byRecent = (a, b) => b.updatedAt - a.updatedAt || b.rid - a.rid;

/** Une page de critiques d'un élément (scope friends | community, sort recent | popular). */
function reviewsPage(ctx, viewer, type, id, { scope = 'community', sort = 'recent', cursor = null, limit = PAGE } = {}) {
  const wanted = (uid) => (scope === 'friends'
    ? viewer.friends.has(uid)
    : !viewer.friends.has(uid) && !viewer.hidden.has(uid) && uid !== viewer.id);
  let rows = ctx.db.ratings.filter((r) => r.type === type && r.id === id && r.review && !r.hiddenAt && wanted(r.userId));
  let nextCursor = null;
  if (sort === 'popular') {
    rows.sort((a, b) => b.likeCount - a.likeCount || byRecent(a, b));
    const [offset = 0] = decodeCursor(cursor, ctx) || [];
    const start = Math.min(Math.max(0, Number(offset) || 0), 200);
    if (start + limit < Math.min(rows.length, 200)) nextCursor = encodeCursor([start + limit]);
    rows = rows.slice(start, start + limit);
  } else {
    rows.sort(byRecent);
    const after = decodeCursor(cursor, ctx);
    if (after) rows = rows.filter((r) => r.updatedAt < after[0] || (r.updatedAt === after[0] && r.rid < after[1]));
    if (rows.length > limit) nextCursor = encodeCursor([rows[limit - 1].updatedAt, rows[limit - 1].rid]);
    rows = rows.slice(0, limit);
  }
  return { ...hydrate(ctx, rows, viewer), nextCursor };
}

/** Notes d'un album ou d'un morceau pour le joueur connecté (même forme que le serveur). */
function itemPayload(ctx, uid, type, id) {
  const { db } = ctx;
  ensure(db);
  const viewer = viewerOf(ctx, uid);
  const mineRow = db.ratings.find((r) => r.userId === uid && r.type === type && r.id === id);
  const scoreRows = db.ratings.filter((r) => r.type === type && r.id === id && viewer.friends.has(r.userId)).sort(byRecent).slice(0, 24);
  const scoreUsers = ctx.summaries(scoreRows.map((r) => r.userId));
  const scores = scoreRows.filter((r) => scoreUsers.has(r.userId))
    .map((r) => ({ user: scoreUsers.get(r.userId), score: r.score, updatedAt: r.updatedAt }));
  const friends = reviewsPage(ctx, viewer, type, id, { scope: 'friends' });
  const community = reviewsPage(ctx, viewer, type, id, { scope: 'community' });
  const result = {
    summary: summaryOf(db, type, id),
    mine: mineRow
      ? {
        id: mineRow.rid, score: mineRow.score, review: mineRow.review, reviewAt: mineRow.reviewAt, updatedAt: mineRow.updatedAt,
        ...(mineRow.hiddenAt ? { moderated: true } : {}),
      }
      : null,
    friends: { scores, reviews: friends.items, nextCursor: friends.nextCursor },
    community: { reviews: community.items, nextCursor: community.nextCursor },
    // Anciennes clés, comme le serveur (retirées par P1-A).
    reviews: [...friends.items, ...community.items],
    friendScores: scores.map((s) => ({ user: s.user, score: s.score })),
  };
  if (type === 'album') {
    const averages = {};
    const mine = {};
    for (const trackId of ctx.staticCatalog.albumTrackIds(id)) {
      const s = summaryOf(db, 'track', trackId);
      if (s.count) averages[trackId] = { avg: s.average, count: s.count };
      const m = db.ratings.find((r) => r.userId === uid && r.type === 'track' && r.id === trackId);
      if (m) mine[trackId] = m.score;
    }
    result.tracks = { averages, mine };
  }
  result.catalog = ctx.refs({ albumIds: avatarAlbums([...scoreUsers.values(), ...friends.users.values(), ...community.users.values()]) });
  return result;
}

const itemOf = (ctx, params) => {
  const type = params[0];
  const id = decodeURIComponent(params[1]);
  if (!itemExists(ctx, type, id)) ctx.fail(404, 'unknown_item');
  return { type, id };
};

/** Enregistre une note (et sa critique) comme le serveur : texte nettoyé, doublons refusés, date du texte. */
function rate(ctx, u, type, id, score, rawReview) {
  const { db } = ctx;
  ensure(db);
  if (!Number.isInteger(score) || score < 0 || score > 10) ctx.fail(400, 'invalid_score');
  const existing = db.ratings.find((r) => r.userId === u.id && r.type === type && r.id === id);
  let text;
  if (rawReview === undefined) text = existing?.review ?? null;
  else {
    text = typeof rawReview === 'string' ? rawReview.trim().normalize('NFC') : '';
    if (text.length > REVIEW_MAX) ctx.fail(400, 'review_too_long');
    text = text || null;
  }
  const changed = text !== (existing?.review ?? null);
  if (text && changed) {
    const recent = db.ratings.filter((r) => r.userId === u.id && r.reviewAt && !(r.type === type && r.id === id))
      .sort((a, b) => b.reviewAt - a.reviewAt).slice(0, DUPLICATE_WINDOW);
    if (recent.some((r) => r.review === text)) ctx.fail(409, 'duplicate_review');
  }
  const now = ctx.now();
  const reviewAt = !text ? null : changed ? now : existing?.reviewAt ?? now;
  if (existing) Object.assign(existing, { score, review: text, reviewAt, updatedAt: now });
  else {
    const row = { userId: u.id, type, id, score, review: text, createdAt: now, updatedAt: now, reviewAt };
    normalize(db, row);
    db.ratings.push(row);
  }
}

// `id` reste l'identifiant de l'élément noté (forme d'avant) ; `ratingId` est celui de la note.
const entryOf = (r) => ({ type: r.type, id: r.id, ratingId: r.rid, score: r.score, review: r.review, updatedAt: r.updatedAt });

function userReviewPage(ctx, viewerId, target, cursor, limit = PAGE) {
  let rows = ctx.db.ratings.filter((r) => r.userId === target.id && r.review && r.reviewAt && itemExists(ctx, r.type, r.id)
    && (target.id === viewerId || !r.hiddenAt)).sort((a, b) => b.reviewAt - a.reviewAt || b.rid - a.rid);
  const after = decodeCursor(cursor, ctx);
  if (after) rows = rows.filter((r) => r.reviewAt < after[0] || (r.reviewAt === after[0] && r.rid < after[1]));
  const nextCursor = rows.length > limit ? encodeCursor([rows[limit - 1].reviewAt, rows[limit - 1].rid]) : null;
  return { items: rows.slice(0, limit).map(entryOf), nextCursor };
}

function targetOf(ctx, viewer, raw) {
  const target = ctx.userByName(decodeURIComponent(raw));
  if (!target || !target.verified || hiddenIds(ctx.db, viewer.id).has(target.id)) ctx.fail(404, 'user_not_found');
  return target;
}

const itemRefs = (ctx, entries, extraAlbums = []) => ctx.refs({
  albumIds: [...entries.filter((e) => e.type === 'album').map((e) => e.id), ...extraAlbums],
  trackIds: entries.filter((e) => e.type === 'track').map((e) => e.id),
});

const limitOf = (query) => Math.min(50, Math.max(1, Math.floor(Number(query.get('limit')) || PAGE)));

export const routes = [
  ['GET', /^\/ratings\/feed$/, ({ ctx }) => {
    const u = ctx.me();
    ensure(ctx.db);
    const viewer = viewerOf(ctx, u.id);
    const rows = ctx.db.ratings.filter((r) => viewer.friends.has(r.userId) && itemExists(ctx, r.type, r.id)).sort(byRecent).slice(0, 20);
    const users = ctx.summaries(rows.map((r) => r.userId));
    const items = rows.filter((r) => users.has(r.userId))
      .map((r) => ({ ...entryOf(r), user: users.get(r.userId), review: r.hiddenAt ? null : r.review }));
    return { items, catalog: itemRefs(ctx, items, avatarAlbums(users.values())) };
  }],
  ['GET', /^\/ratings\/(album|track)\/([^/]+)$/, ({ params, ctx }) => {
    const { type, id } = itemOf(ctx, params);
    return itemPayload(ctx, ctx.me().id, type, id);
  }],
  ['GET', /^\/ratings\/(album|track)\/([^/]+)\/reviews$/, ({ params, query, ctx }) => {
    const { type, id } = itemOf(ctx, params);
    const scope = query.get('scope') || 'community';
    const sort = query.get('sort') || 'recent';
    if (!['friends', 'community'].includes(scope)) ctx.fail(400, 'invalid_input', { field: 'scope' });
    if (!['recent', 'popular'].includes(sort)) ctx.fail(400, 'invalid_input', { field: 'sort' });
    ensure(ctx.db);
    const page = reviewsPage(ctx, viewerOf(ctx, ctx.me().id), type, id, { scope, sort, cursor: query.get('cursor'), limit: limitOf(query) });
    return { items: page.items, nextCursor: page.nextCursor, catalog: ctx.refs({ albumIds: avatarAlbums(page.users.values()) }) };
  }],
  ['PUT', /^\/ratings\/(album|track)\/([^/]+)$/, ({ params, body, ctx }) => {
    const u = ctx.me();
    const { type, id } = itemOf(ctx, params);
    rate(ctx, u, type, id, body.score, body.review);
    // `rating` : le delta de la note du joueur, fusionné dans state.ratings par le site.
    return { ...itemPayload(ctx, u.id, type, id), rating: { type, id, score: body.score }, state: ctx.partialState() };
  }],
  ['DELETE', /^\/ratings\/(album|track)\/([^/]+)$/, ({ params, ctx }) => {
    const u = ctx.me();
    const { type, id } = itemOf(ctx, params);
    ctx.db.ratings = ctx.db.ratings.filter((r) => !(r.userId === u.id && r.type === type && r.id === id));
    return { ...itemPayload(ctx, u.id, type, id), rating: { type, id, score: null }, state: ctx.partialState() };
  }],
  ['GET', /^\/users\/([^/]+)\/ratings$/, ({ params, ctx }) => {
    const viewer = ctx.me();
    ensure(ctx.db);
    const target = targetOf(ctx, viewer, params[0]);
    const rows = ctx.db.ratings.filter((r) => r.userId === target.id && itemExists(ctx, r.type, r.id)).sort(byRecent);
    const albums = rows.filter((r) => r.type === 'album');
    const distribution = Array(11).fill(0);
    let sum = 0;
    for (const r of rows) {
      sum += r.score;
      distribution[r.score] += 1;
    }
    const best = (list, n) => [...list].sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt).slice(0, n).map(entryOf);
    const reviews = userReviewPage(ctx, viewer.id, target, null);
    const result = {
      stats: {
        count: rows.length, average: rows.length ? sum / rows.length : null, distribution,
        albums: albums.length, tracks: rows.length - albums.length, reviews: rows.filter((r) => r.review).length,
      },
      topAlbums: best(albums, 4),
      topTracks: best(rows.filter((r) => r.type === 'track'), 5),
      recent: rows.slice(0, 12).map(entryOf),
      reviews: reviews.items,
      reviewsCursor: reviews.nextCursor,
    };
    result.catalog = itemRefs(ctx, [...result.topAlbums, ...result.topTracks, ...result.recent, ...result.reviews]);
    return result;
  }],
  ['GET', /^\/users\/([^/]+)\/reviews$/, ({ params, query, ctx }) => {
    const viewer = ctx.me();
    ensure(ctx.db);
    const target = targetOf(ctx, viewer, params[0]);
    const page = userReviewPage(ctx, viewer.id, target, query.get('cursor'), limitOf(query));
    return { ...page, catalog: itemRefs(ctx, page.items) };
  }],
];

// Critiques de morceaux des joueurs fictifs (les notes d'albums viennent du cœur de la démo).
const BOT_TRACK_REVIEWS = [
  ['maxvinyl', 'discovery:03', 9, 'Le vocoder le plus tendre de l’album, et ce solo de guitare à la fin.'],
  ['lea.beats', 'discovery:03', 8, 'Parfait pour un dimanche matin, café à la main.'],
  ['k.dot_fan', 'discovery:01', 10, 'Impossible de ne pas sourire dès les premières notes.'],
  ['soulcollector', 'back-to-black:02', 10, 'La voix, les cuivres, tout est là.'],
  ['lea.beats', 'racine-carree:03', 9, 'Le refrain reste en tête toute la journée.'],
  ['maxvinyl', 'abbey-road:01', 9, 'L’ouverture de la face A la plus élégante qui soit.'],
  ['k.dot_fan', 'good-kid-maad-city:02', 9, 'Une histoire entière en un seul morceau.'],
];

export function seed(db, ctx) {
  ensure(db);
  const now = ctx.now();
  BOT_TRACK_REVIEWS.forEach(([username, trackId, score, review], i) => {
    const u = ctx.userByName(username);
    if (!u || !ctx.TRACK.has(trackId) || db.ratings.some((r) => r.userId === u.id && r.type === 'track' && r.id === trackId)) return;
    const at = now - (i + 2) * 3_600_000;
    const row = { userId: u.id, type: 'track', id: trackId, score, review, createdAt: at, updatedAt: at, reviewAt: at };
    normalize(db, row);
    db.ratings.push(row);
  });
}

export function migrate(db, ctx) {
  // Sauvegarde d'avant les notes v2 : identifiants stables, puis les critiques de morceaux des joueurs fictifs.
  const before = Number.isInteger(db.nextRatingId);
  ensure(db);
  if (!before) seed(db, ctx);
}
