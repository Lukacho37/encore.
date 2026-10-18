// Jumeau de démo du module « match » (server/match.js, P1-E, PLAN.md 4.2.7, 5.3) : mêmes routes, mêmes formes.
//   GET /match/batch?usernames=a,b · GET /match/suggestions?limit= · GET /match/top · GET /match/:username
// Même calcul que le serveur (shared/match.js) sur les données de la démo : notes (db.ratings), cartes (db.cards →
// cartes par album, artiste, genre, décennie), « Mes 9 albums » (db.lists, jumeau des listes) et favoris
// (db.favorites[userId] = { artist: [], genre: [] }, écrits par les premiers pas : mock/onboarding.js). Les joueurs
// fictifs ont des favoris (seed) : les suggestions « artistes favoris en commun » existent dans la démo.
// Confidentialité comme le serveur : indisponible entre joueurs bloqués (db.blocks), pour un Studio privé, ou réservé
// aux amis d'un non-ami (u.profileVisibility). Résultats gardés en mémoire le temps de la session (pas de cache
// persistant à invalider : le calcul est instantané sur 20 albums).
import { bayes, compareProfiles, flipResult, recommendations, LOVED_SCORE, FAVORITE_FACTOR, FAVORITE_FLOOR, RATED_GENRE_WEIGHT } from '@shared/match.js';
import { summaryOf, viewerOf } from './ratings.js';

export const name = 'match';

const SUGGESTIONS = 8;
const SUGGESTIONS_MAX = 12;
const BATCH_MAX = 30;

// Favoris des joueurs fictifs (artistes, genres) : ce qu'ils auraient choisi aux premiers pas.
const BOT_FAVORITES = {
  'lea.beats': { artist: ['air', 'daft-punk', 'stromae', 'billie-eilish', 'amy-winehouse'], genre: ['electro', 'pop', 'soul'] },
  maxvinyl: { artist: ['the-beatles', 'pink-floyd', 'queen', 'daft-punk', 'michael-jackson'], genre: ['rock', 'pop', 'electro'] },
  soulcollector: { artist: ['amy-winehouse', 'miles-davis', 'bob-marley', 'adele', 'serge-gainsbourg'], genre: ['soul', 'jazz', 'reggae'] },
  'k.dot_fan': { artist: ['kendrick-lamar', 'kanye-west', 'eminem', 'daft-punk', 'nirvana'], genre: ['rap', 'electro', 'rock'] },
};

const decadeOf = (year) => (Number.isInteger(year) && year > 0 ? Math.floor(year / 10) * 10 : null);
const add = (map, key, w) => {
  if (key == null || !w) return;
  map.set(key, (map.get(key) || 0) + w);
};
const privacyOf = (u) => u?.profileVisibility || u?.privacy || 'public';

export function ensure(db) {
  if (!db.favorites || typeof db.favorites !== 'object' || Array.isArray(db.favorites)) db.favorites = {};
}

/** Favoris d'un joueur : { artist: [], genre: [], track: [] }. */
export function favoritesOf(db, uid) {
  const f = db.favorites?.[uid] || {};
  return { artist: Array.isArray(f.artist) ? f.artist : [], genre: Array.isArray(f.genre) ? f.genre : [], track: Array.isArray(f.track) ? f.track : [] };
}

/** Profil de goûts d'un joueur (voir shared/match.js), comme server/match.js profileOf. */
export function profileOf(ctx, uid) {
  const { db, ALBUM, TRACK } = ctx;
  const ratings = new Map();
  const loved = new Set();
  const artists = new Map();
  const genres = new Map();
  const decades = new Map();
  const completed = new Set();
  const rows = db.ratings.filter((r) => r.userId === uid);
  for (const r of rows) {
    ratings.set(`${r.type}:${r.id}`, r.score);
    const a = r.type === 'album' ? ALBUM.get(r.id) : null;
    if (!a) continue;
    if (r.score >= LOVED_SCORE) loved.add(r.id);
    add(artists, a.artistId, r.score - 5);
    add(genres, a.genre, RATED_GENRE_WEIGHT);
    add(decades, decadeOf(a.year), RATED_GENRE_WEIGHT);
  }
  // Cartes possédées : morceaux distincts par album.
  const perAlbum = new Map();
  for (const key of Object.keys(db.cards?.[uid] || {})) {
    const t = TRACK.get(key.split('|')[0]);
    if (!t?.albumId) continue;
    const set = perAlbum.get(t.albumId) || new Set();
    set.add(t.id);
    perAlbum.set(t.albumId, set);
  }
  let cards = 0;
  for (const [albumId, set] of perAlbum) {
    const a = ALBUM.get(albumId);
    cards += set.size;
    if (!a) continue;
    add(artists, a.artistId, set.size);
    add(genres, a.genre, set.size);
    add(decades, decadeOf(a.year), set.size);
    if (a.trackCount > 0 && set.size >= a.trackCount) completed.add(albumId);
  }
  // « Mes 9 albums » : adorés, et comptés comme une note de 10 quand ils ne sont pas notés.
  const grid = (db.lists || []).find((l) => l.userId === uid && l.kind === 'grid9');
  for (const it of grid?.items || []) {
    const a = it.type === 'album' ? ALBUM.get(it.id) : null;
    if (!a) continue;
    loved.add(it.id);
    if (ratings.has(`album:${it.id}`)) continue;
    add(artists, a.artistId, 5);
    add(genres, a.genre, RATED_GENRE_WEIGHT);
    add(decades, decadeOf(a.year), RATED_GENRE_WEIGHT);
  }
  const favorites = favoritesOf(db, uid);
  for (const a of favorites.artist) artists.set(a, Math.max(artists.get(a) || 0, FAVORITE_FLOOR) * FAVORITE_FACTOR);
  for (const g of favorites.genre) add(genres, g, FAVORITE_FLOOR);
  return { id: uid, ratings, loved, artists, genres, decades, completed, favorites, cards, ratingCount: rows.length };
}

/** Artiste, genre et moyenne bayésienne d'un album (recommandations). */
function albumInfo(ctx, id) {
  const a = ctx.ALBUM.get(id);
  if (!a) return null;
  const s = summaryOf(ctx.db, 'album', id);
  return { artistId: a.artistId, genre: a.genre, bayes: bayes((s?.average || 0) * (s?.count || 0), s?.count || 0) };
}

/** Résultat de la paire vu de `viewerId` (différences : a = moi ; recAtoB = mes recommandations à l'autre). */
function pairResult(ctx, viewerId, otherId) {
  const lo = Math.min(viewerId, otherId);
  const hi = Math.max(viewerId, otherId);
  const A = profileOf(ctx, lo);
  const B = profileOf(ctx, hi);
  const r = compareProfiles(A, B);
  // Comme la table taste_matches du serveur : le score de la paire est gardé (il nourrit le badge « Bonne entente »).
  if (!Array.isArray(ctx.db.tasteMatches)) ctx.db.tasteMatches = [];
  const kept = ctx.db.tasteMatches.find((m) => m.userA === lo && m.userB === hi);
  if (kept) kept.score = r.score;
  else ctx.db.tasteMatches.push({ userA: lo, userB: hi, score: r.score });
  const info = (id) => albumInfo(ctx, id);
  const data = {
    hasData: r.hasData, score: r.score, confidence: r.confidence, components: r.components, shared: r.shared, differences: r.differences,
    recAtoB: recommendations(A, B, info), recBtoA: recommendations(B, A, info), computedAt: ctx.now(),
  };
  return viewerId === lo ? data : flipResult(data);
}

/** Taste Match possible (blocages, Studio privé ou réservé aux amis). */
function canMatch(viewer, target) {
  if (!target || target.id === viewer.id || viewer.hidden.has(target.id) || !target.verified) return false;
  const privacy = privacyOf(target);
  if (privacy === 'public') return true;
  return privacy === 'friends' && viewer.friends.has(target.id);
}

const avatarAlbum = (avatar) => (typeof avatar === 'string' && avatar.startsWith('album:') ? avatar.slice(6) : null);

/** Références du catalogue d'un résultat. */
function refsOf(ctx, results, users = []) {
  const albumIds = [];
  const trackIds = [];
  const artistIds = [];
  for (const r of results) {
    albumIds.push(...(r.shared?.albums || []), ...(r.recAtoB || []), ...(r.recBtoA || []));
    trackIds.push(...(r.shared?.tracks || []));
    artistIds.push(...(r.shared?.artists || []));
    for (const c of r.components || []) if (c.key === 'artists') artistIds.push(...(c.vars?.ids || []));
    for (const d of r.differences || []) (d.type === 'track' ? trackIds : albumIds).push(d.id);
  }
  for (const u of users) if (avatarAlbum(u?.avatar)) albumIds.push(avatarAlbum(u.avatar));
  return ctx.refs({ albumIds, trackIds, artistIds });
}

function payloadOf(r, user) {
  return {
    score: r.score,
    confidence: r.confidence,
    estimate: r.confidence === 'low',
    hasData: r.hasData !== false,
    components: r.components,
    shared: r.shared,
    differences: (r.differences || []).map((d) => ({ type: d.type, id: d.id, mine: d.a, theirs: d.b })),
    recommendsToMe: r.recBtoA || [],
    recommendsToThem: r.recAtoB || [],
    user,
    computedAt: r.computedAt,
  };
}

/** Joueurs liés au joueur : amitié, demande (dans un sens ou dans l'autre) ou refus. */
function relatedIds(db, uid) {
  const out = new Set();
  for (const f of db.friendships) {
    if (f.requester === uid) out.add(f.addressee);
    else if (f.addressee === uid) out.add(f.requester);
  }
  return out;
}

/** Amis suggérés : { items: [{ user, score, reason, mutualFriends, artists }], friendCount, catalog } (comme le serveur). */
export function suggestionsFor(ctx, uid, limit = SUGGESTIONS) {
  const { db } = ctx;
  ensure(db);
  const viewer = viewerOf(ctx, uid);
  const related = relatedIds(db, uid);
  const myFavs = new Set(favoritesOf(db, uid).artist);
  const me = profileOf(ctx, uid);
  const out = [];
  for (const u of db.users) {
    if (u.id === uid || !u.verified || related.has(u.id) || viewer.hidden.has(u.id)) continue;
    const theirFriends = viewerOf(ctx, u.id).friends;
    const mutual = [...viewer.friends].filter((f) => theirFriends.has(f)).length;
    const favs = favoritesOf(db, u.id).artist.filter((a) => myFavs.has(a));
    const shared = [...me.loved].filter((id) => db.ratings.some((r) => r.userId === u.id && r.type === 'album' && r.id === id)).length;
    if (!mutual && favs.length < 2 && shared < 3 && !u.bot) continue;
    const isPublic = privacyOf(u) === 'public';
    if (!isPublic && !mutual) continue;
    const r = isPublic ? pairResult(ctx, uid, u.id) : null;
    const score = r && r.hasData !== false ? r.score : null;
    const reason = score != null && score >= 70 ? 'taste' : mutual > 0 ? 'friends_of_friends' : favs.length >= 2 ? 'favorites' : 'taste';
    out.push({ id: u.id, score, reason, mutualFriends: mutual, artists: reason === 'favorites' ? favs.slice(0, 2) : [] });
  }
  out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.mutualFriends - a.mutualFriends || a.id - b.id);
  const kept = out.slice(0, Math.min(limit, SUGGESTIONS_MAX));
  const summaries = ctx.summaries(kept.map((s) => s.id));
  const items = kept.filter((s) => summaries.has(s.id)).map((s) => ({
    user: summaries.get(s.id), score: s.score, reason: s.reason, mutualFriends: s.mutualFriends, artists: s.artists,
  }));
  return {
    items,
    friendCount: viewer.friends.size,
    catalog: ctx.refs({ albumIds: items.map((x) => avatarAlbum(x.user.avatar)).filter(Boolean), artistIds: items.flatMap((x) => x.artists) }),
  };
}

const limitOf = (query, def) => Math.min(SUGGESTIONS_MAX, Math.max(1, Math.floor(Number(query.get('limit')) || def)));

export const routes = [
  ['GET', /^\/match\/batch$/, ({ query, ctx }) => {
    const u = ctx.me();
    const viewer = viewerOf(ctx, u.id);
    const names = [...new Set(String(query.get('usernames') || '').split(',').map((s) => s.trim()).filter((s) => s && s.length <= 40))].slice(0, BATCH_MAX);
    const scores = {};
    for (const n of names) {
      const target = ctx.userByName(n);
      scores[n] = null;
      if (!canMatch(viewer, target)) continue;
      const r = pairResult(ctx, u.id, target.id);
      scores[n] = r.hasData === false ? null : r.score;
    }
    return { scores, pending: [] };
  }],
  ['GET', /^\/match\/suggestions$/, ({ query, ctx }) => suggestionsFor(ctx, ctx.me().id, limitOf(query, SUGGESTIONS))],
  ['GET', /^\/match\/top$/, ({ ctx }) => {
    const u = ctx.me();
    const viewer = viewerOf(ctx, u.id);
    let best = null;
    for (const id of viewer.friends) {
      const f = ctx.userById(id);
      if (!f || privacyOf(f) === 'private') continue;
      const r = pairResult(ctx, u.id, id);
      if (r.hasData === false) continue;
      const rank = r.score - (r.confidence === 'low' ? 15 : 0);
      if (!best || rank > best.rank) best = { id, rank, r };
    }
    if (!best) return { match: null, friendCount: viewer.friends.size, catalog: ctx.refs({}) };
    const user = ctx.summaries([best.id]).get(best.id);
    const p = payloadOf(best.r, user);
    return {
      match: { user, score: p.score, confidence: p.confidence, estimate: p.estimate, components: p.components, shared: p.shared, computedAt: p.computedAt },
      friendCount: viewer.friends.size,
      catalog: refsOf(ctx, [{ shared: best.r.shared, components: best.r.components }], [user]),
    };
  }],
  ['GET', /^\/match\/([^/]+)$/, ({ params, ctx }) => {
    const u = ctx.me();
    const target = ctx.userByName(decodeURIComponent(params[0]));
    if (!target || !target.verified) ctx.fail(404, 'user_not_found');
    if (target.id === u.id) ctx.fail(400, 'match_self');
    const viewer = viewerOf(ctx, u.id);
    if (!canMatch(viewer, target)) ctx.fail(403, 'match_unavailable');
    const r = pairResult(ctx, u.id, target.id);
    const user = ctx.summaries([target.id]).get(target.id) || null;
    return { ...payloadOf(r, user), catalog: refsOf(ctx, [r], user ? [user] : []) };
  }],
];

/** Favoris des joueurs fictifs (une fois). */
export function seed(db, ctx) {
  ensure(db);
  for (const [username, favs] of Object.entries(BOT_FAVORITES)) {
    const u = ctx.userByName(username);
    if (!u || db.favorites[u.id]) continue;
    db.favorites[u.id] = {
      artist: favs.artist.filter((id) => ctx.ARTIST.has(id)),
      genre: favs.genre,
    };
  }
}

export function migrate(db, ctx) {
  // Sauvegarde d'avant le Taste Match : la table des favoris, puis ceux des joueurs fictifs.
  ensure(db);
  seed(db, ctx);
}
