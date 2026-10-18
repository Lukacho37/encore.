// Jumeau de démo du module « onboarding » (server/onboarding.js, P1-E, PLAN.md 4.2.7, 5.9) : mêmes routes, mêmes formes.
//   GET /onboarding?genres=a,b,c&artists=x,y&exclude=ids → { genres, artists, artistAlbums, albums, quickRate, mine, catalog }
//   POST /onboarding { genres, artists, grid9, ratings } | { skip: true } → { result, state, catalog }
// Sur le catalogue de la démo (20 albums) : les genres qui ont des albums, les artistes de ces genres (les plus
// populaires d'abord : popularité moyenne de leurs morceaux), leurs albums, puis ceux des genres. Écritures comme le
// serveur : favoris (db.favorites, lus par le jumeau du Taste Match), « Mes 9 albums » (db.lists, jumeau des listes),
// liste d'envies (ctx.collection.addToWishlist), notes rapides (db.ratings), boosters de bienvenue thématiques une
// seule fois par compte (ctx.collection.grantBooster, source 'onboarding'), onboardedAt.
import { THEME_GENRES } from '@shared/rules.js';
import { FIRST_STEPS } from '@shared/quests.js';
import { bayes } from '@shared/match.js';
import { ensure as ensureLists } from './lists.js';
import { ensure as ensureFavorites, favoritesOf, suggestionsFor } from './match.js';
import { summaryOf } from './ratings.js';

export const name = 'onboarding';

const GENRES_MIN = 3;
const ARTISTS_MIN = 3;
const ARTISTS_MAX = 10;
const GRID = 9;
const RATINGS_MAX = 10;
const FAVORITES_MAX = 5;
const QUICK = 10;
const RECOMMENDATIONS = 12;
const PER_ARTIST = 2;
const GRID_TITLES = { fr: 'Mes 9 albums', en: 'My 9 albums' };

const idOf = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);
const listOf = (raw, max) => [...new Set((Array.isArray(raw) ? raw : String(raw || '').split(',')).map((x) => idOf(String(x ?? '').trim())).filter(Boolean))].slice(0, max);
const decadeOf = (year) => (Number.isInteger(year) && year > 0 ? Math.floor(year / 10) * 10 : null);

/** Popularité d'un album (moyenne des morceaux) et d'un artiste (moyenne de ses albums), calculée une fois. */
let popularity = null;
function pop(ctx) {
  if (popularity) return popularity;
  const album = new Map();
  for (const a of ctx.ALBUM.values()) {
    const tracks = ctx.staticCatalog.albumTracks(a.id);
    album.set(a.id, tracks.length ? tracks.reduce((s, t) => s + (t.pop || 0), 0) / tracks.length : 0);
  }
  const artist = new Map();
  for (const a of ctx.ALBUM.values()) artist.set(a.artistId, Math.max(artist.get(a.artistId) || 0, album.get(a.id)));
  popularity = { album, artist };
  return popularity;
}

const albumsByPop = (ctx, filter = () => true) => [...ctx.ALBUM.values()].filter(filter).sort((a, b) => pop(ctx).album.get(b.id) - pop(ctx).album.get(a.id) || a.id.localeCompare(b.id));

/** Listes rangées en alternance, sans doublon, `max` au plus. */
function interleave(lists, max) {
  const out = [];
  for (let i = 0; out.length < max && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      if (l[i] !== undefined && !out.includes(l[i])) out.push(l[i]);
      if (out.length >= max) break;
    }
  }
  return out;
}

function mineOf(ctx, u) {
  const favs = favoritesOf(ctx.db, u.id);
  const grid = (ctx.db.lists || []).find((l) => l.userId === u.id && l.kind === 'grid9');
  const slots = Array(GRID).fill(null);
  for (const it of grid?.items || []) if (it.type === 'album' && it.position < GRID) slots[it.position] = it.id;
  return { genres: favs.genre.filter((g) => THEME_GENRES.includes(g)), artists: favs.artist, grid9: slots.filter(Boolean), onboarded: u.onboardedAt != null };
}

function options(ctx, u, query) {
  const chosen = listOf(query.get('genres'), THEME_GENRES.length).filter((g) => THEME_GENRES.includes(g));
  const chosenArtists = listOf(query.get('artists'), ARTISTS_MAX).filter((id) => ctx.ARTIST.has(id));
  const exclude = new Set(listOf(query.get('exclude'), GRID + RATINGS_MAX));
  const counts = new Map();
  for (const a of ctx.ALBUM.values()) counts.set(a.genre, (counts.get(a.genre) || 0) + 1);
  const genres = THEME_GENRES.map((id) => ({ id, albums: counts.get(id) || 0 })).filter((g) => g.albums > 0);

  const artistIds = [...ctx.ARTIST.values()].sort((a, b) => pop(ctx).artist.get(b.id) - pop(ctx).artist.get(a.id) || a.id.localeCompare(b.id));
  let artists = chosen.length
    ? interleave(chosen.map((g) => artistIds.filter((a) => a.genre === g).map((a) => a.id)), 30)
    : artistIds.slice(0, 30).map((a) => a.id);
  // Catalogue de démo réduit : les autres artistes complètent la liste pour qu'il y ait de quoi choisir.
  if (artists.length < 12) artists = [...artists, ...artistIds.map((a) => a.id).filter((id) => !artists.includes(id))].slice(0, 30);
  for (const id of chosenArtists) if (!artists.includes(id)) artists.unshift(id);
  const artistAlbums = {};
  for (const a of albumsByPop(ctx)) artistAlbums[a.artistId] ??= a.id;

  const albums = [];
  const fromArtists = chosenArtists.flatMap((id) => albumsByPop(ctx, (a) => a.artistId === id).slice(0, 4).map((a) => a.id));
  if (fromArtists.length) albums.push({ key: 'artists', items: fromArtists });
  for (const g of chosen.length ? chosen : THEME_GENRES.slice(0, 4)) {
    const items = albumsByPop(ctx, (a) => a.genre === g).slice(0, 8).map((a) => a.id);
    if (items.length) albums.push({ key: g, items });
  }
  if (albums.reduce((n, g) => n + g.items.length, 0) < 12) {
    const seen = new Set(albums.flatMap((g) => g.items));
    const more = albumsByPop(ctx, (a) => !seen.has(a.id)).slice(0, 12).map((a) => a.id);
    if (more.length) albums.push({ key: 'popular', items: more });
  }

  const rated = new Set(ctx.db.ratings.filter((r) => r.userId === u.id && r.type === 'album').map((r) => r.id));
  const pools = (chosen.length ? chosen : THEME_GENRES).map((g) => albumsByPop(ctx, (a) => a.genre === g).map((a) => a.id).filter((id) => !exclude.has(id) && !rated.has(id)));
  let quickRate = interleave(pools, QUICK);
  if (quickRate.length < 5) quickRate = [...quickRate, ...albumsByPop(ctx, (a) => !exclude.has(a.id) && !rated.has(a.id) && !quickRate.includes(a.id)).map((a) => a.id)].slice(0, QUICK);

  return {
    genres,
    artists,
    artistAlbums,
    albums,
    quickRate,
    mine: mineOf(ctx, u),
    catalog: ctx.refs({ albumIds: [...albums.flatMap((g) => g.items), ...quickRate, ...Object.values(artistAlbums)], artistIds: artists }),
  };
}

function parse(ctx, body = {}) {
  const bad = (field) => ctx.fail(400, 'invalid_input', { field });
  if (body.genres !== undefined && !Array.isArray(body.genres)) bad('genres');
  const genres = listOf(body.genres || [], THEME_GENRES.length).filter((g) => THEME_GENRES.includes(g));
  if (genres.length && genres.length < GENRES_MIN) bad('genres');
  if (body.artists !== undefined && !Array.isArray(body.artists)) bad('artists');
  const asked = listOf(body.artists || [], ARTISTS_MAX + 1);
  if (asked.length > ARTISTS_MAX) bad('artists');
  const artists = asked.filter((id) => ctx.ARTIST.has(id));
  if (artists.length && artists.length < ARTISTS_MIN) bad('artists');
  if (body.grid9 !== undefined && (!Array.isArray(body.grid9) || body.grid9.length > GRID)) bad('grid9');
  const grid9 = listOf((body.grid9 || []).filter(Boolean), GRID).filter((id) => ctx.ALBUM.has(id));
  if (body.ratings !== undefined && (!Array.isArray(body.ratings) || body.ratings.length > RATINGS_MAX)) bad('ratings');
  const ratings = [];
  for (const r of body.ratings || []) {
    const albumId = idOf(r?.albumId);
    if (!albumId || !ctx.ALBUM.has(albumId) || ratings.some((x) => x.albumId === albumId)) continue;
    if (r.score === null || r.score === undefined) continue;
    if (!Number.isInteger(r.score) || r.score < 0 || r.score > 10) bad('ratings');
    ratings.push({ albumId, score: r.score });
  }
  return { genres, artists, grid9, ratings };
}

/** Genres du profil : choisis, rangés selon le nombre d'artistes et d'albums choisis de chaque genre. */
function rankGenres(ctx, input) {
  const weight = new Map();
  const bump = (g) => g && weight.set(g, (weight.get(g) || 0) + 1);
  for (const id of input.artists) bump(ctx.ARTIST.get(id)?.genre);
  for (const id of input.grid9) bump(ctx.ALBUM.get(id)?.genre);
  for (const r of input.ratings) if (r.score >= 6) bump(ctx.ALBUM.get(r.albumId)?.genre);
  const base = input.genres.length ? input.genres : [...weight.keys()].filter((g) => THEME_GENRES.includes(g));
  return base.map((g, i) => [g, weight.get(g) || 0, i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([g]) => g);
}

function profileOf(ctx, input, topGenres) {
  const albums = [...input.grid9, ...input.ratings.filter((r) => r.score >= 6).map((r) => r.albumId)].map((id) => ctx.ALBUM.get(id)).filter(Boolean);
  const decades = new Map();
  for (const a of albums) {
    const d = decadeOf(a.year);
    if (d) decades.set(d, (decades.get(d) || 0) + 1);
  }
  const topDecades = [...decades].sort((a, b) => b[1] - a[1] || b[0] - a[0]).slice(0, 2).map(([d]) => d);
  let flavour = null;
  if (albums.length >= 3) {
    const cut = [...pop(ctx).album.values()].sort((a, b) => b - a)[Math.floor(ctx.ALBUM.size / 3)] || 0;
    const cult = albums.filter((a) => pop(ctx).album.get(a.id) >= cut).length / albums.length;
    const avgYear = albums.reduce((s, a) => s + (a.year || 0), 0) / albums.length;
    if (cult >= 0.6) flavour = 'cult';
    else if (cult <= 0.2) flavour = 'gems';
    else if (avgYear >= 2015) flavour = 'recent';
    else if (avgYear < 1985) flavour = 'classics';
    else flavour = 'mixed';
  }
  return { genres: topGenres.slice(0, 3), decades: topDecades, flavour };
}

function recommend(ctx, u, input, topGenres) {
  const rated = new Set(ctx.db.ratings.filter((r) => r.userId === u.id && r.type === 'album').map((r) => r.id));
  const skip = new Set([...input.grid9, ...rated]);
  const b = (id) => {
    const s = summaryOf(ctx.db, 'album', id);
    return bayes((s?.average || 0) * (s?.count || 0), s?.count || 0);
  };
  const fromArtists = input.artists.flatMap((id) => albumsByPop(ctx, (a) => a.artistId === id)).filter((a) => !skip.has(a.id)).map((a) => ({ a, reason: 'artist' }));
  const fromGenres = topGenres.slice(0, 3).flatMap((g) => albumsByPop(ctx, (a) => a.genre === g).sort((x, y) => b(y.id) - b(x.id))).filter((a) => !skip.has(a.id)).map((a) => ({ a, reason: 'genre' }));
  const fromSimilar = input.grid9.flatMap((id) => {
    const base = ctx.ALBUM.get(id);
    return base ? albumsByPop(ctx, (a) => a.id !== id && (a.artistId === base.artistId || (a.genre === base.genre && decadeOf(a.year) === decadeOf(base.year)))) : [];
  }).filter((a) => !skip.has(a.id)).map((a) => ({ a, reason: 'similar' }));
  const out = [];
  const perArtist = new Map();
  const push = ({ a, reason }) => {
    if (out.length >= RECOMMENDATIONS || out.some((x) => x.id === a.id) || (perArtist.get(a.artistId) || 0) >= PER_ARTIST) return;
    perArtist.set(a.artistId, (perArtist.get(a.artistId) || 0) + 1);
    out.push({ id: a.id, reason });
  };
  const lists = [fromArtists, fromGenres, fromSimilar];
  for (let i = 0; out.length < RECOMMENDATIONS && lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) push(l[i]);
  for (const a of albumsByPop(ctx, (x) => !skip.has(x.id))) push({ a, reason: 'popular' });
  return out;
}

/** « Mes 9 albums » remplacée par ces albums (comme deps.lists.setGrid9). */
function setGrid9(ctx, u, ids) {
  const { db } = ctx;
  ensureLists(db);
  const now = Date.now();
  let l = db.lists.find((x) => x.userId === u.id && x.kind === 'grid9');
  if (!l) {
    l = {
      id: db.nextListId++, userId: u.id, kind: 'grid9', title: GRID_TITLES[u.lang] || GRID_TITLES.fr, description: null, ranked: true,
      itemType: 'album', visibility: 'public', items: [], itemCount: 0, likeCount: 0, commentCount: 0, createdAt: now, updatedAt: now, hiddenAt: null,
    };
    db.lists.push(l);
  }
  const before = new Map(l.items.map((it) => [it.id, it.addedAt]));
  l.items = ids.slice(0, GRID).map((id, position) => ({ type: 'album', id, note: null, position, addedAt: before.get(id) ?? now }));
  l.itemCount = l.items.length;
  l.updatedAt = now;
}

function submit(ctx, body = {}) {
  const { db } = ctx;
  const u = ctx.me();
  ensureFavorites(db);
  const input = body.skip === true ? { genres: [], artists: [], grid9: [], ratings: [] } : parse(ctx, body);
  const topGenres = rankGenres(ctx, input);
  const favs = favoritesOf(db, u.id);
  db.favorites[u.id] = {
    ...favs,
    genre: topGenres.length ? topGenres.slice(0, FAVORITES_MAX) : favs.genre,
    artist: input.artists.length ? input.artists.slice(0, FAVORITES_MAX) : favs.artist,
  };
  if (input.grid9.length) {
    setGrid9(ctx, u, input.grid9);
    ctx.collection.addToWishlist(u.id, input.grid9);
  }
  const now = ctx.now();
  for (const r of input.ratings) {
    const existing = db.ratings.find((x) => x.userId === u.id && x.type === 'album' && x.id === r.albumId);
    if (existing) Object.assign(existing, { score: r.score, updatedAt: now });
    else db.ratings.push({ userId: u.id, type: 'album', id: r.albumId, score: r.score, review: null, reviewAt: null, createdAt: now, updatedAt: now });
  }
  // Boosters de bienvenue thématiques : une seule fois par compte.
  if (!db.boosters.some((b) => b.userId === u.id && b.source === 'onboarding')) {
    for (const g of topGenres.slice(0, 3)) ctx.collection.grantBooster(u.id, `genre:${g}`, null, 'onboarding');
    if (input.grid9.length) ctx.collection.grantBooster(u.id, 'album:choice', null, 'onboarding');
  }
  const boosters = db.boosters.filter((b) => b.userId === u.id && b.source === 'onboarding' && !b.openedAt).map((b) => ({ id: b.id, kind: b.kind, theme: b.theme }));
  if (u.onboardedAt == null) u.onboardedAt = now;

  const recommendations = recommend(ctx, u, input, topGenres);
  const friends = suggestionsFor(ctx, u.id, 6);
  return {
    result: {
      profile: profileOf(ctx, input, topGenres),
      recommendations,
      suggestedFriends: friends.items.slice(0, 6),
      boosters,
      grid9: input.grid9,
      firstSteps: FIRST_STEPS.map((s) => ({ id: s.id, metric: s.metric, target: s.target })),
    },
    state: ctx.partialState(),
    catalog: ctx.refs({ albumIds: [...recommendations.map((r) => r.id), ...input.grid9], artistIds: friends.items.flatMap((s) => s.artists || []) }),
  };
}

export const routes = [
  ['GET', /^\/onboarding$/, ({ query, ctx }) => options(ctx, ctx.me(), query)],
  ['POST', /^\/onboarding$/, ({ body, ctx }) => submit(ctx, body)],
];

export function seed() {}

export function migrate() {}
