// Jumeau de démo du module « passport » (server/passport.js, P2-A, PLAN.md 4.3, 5.8) : mêmes routes, mêmes formes.
//   GET /passport · GET /users/:username/passport · GET /retro/:year
// Même calcul que le serveur sur les données de la démo : cartes (db.cards), succès (db.achievements, pressages par
// ctx.collection.rankOf), notes (db.ratings), listes (db.lists), duels (db.battleVotes), favoris (db.favorites),
// boosters ouverts (u.openings, sans date dans la démo). Confidentialité comme le serveur : joueurs bloqués (db.blocks)
// introuvables, Studio réservé aux amis ou privé → 403 passport_private.
// Joueurs fictifs : leur collection a été tirée d'un coup à la création de la démo ; pour un passeport crédible, leurs
// dates sont étalées (dans l'ordre) entre leur inscription et aujourd'hui, ici seulement (le reste de la démo garde les
// vraies dates). Rétro : dans la démo, l'année en cours est visible avant le 1er décembre (`preview: true`), pour qu'on
// puisse la découvrir à tout moment ; les années passées suivent la règle du serveur.
import { RARITIES } from '@shared/rules.js';
import { parisDate, parisMidnight } from '@shared/periods.js';
import { viewerOf } from './ratings.js';

export const name = 'passport';

const DAY = 86_400_000;
const TOP = 5;
const RETRO_FIRST_YEAR = 2020;
const SHIFT_MIN = 5;
const RARE_ORDER = ['legendary', 'promo', 'ultra', 'super', 'rare', 'uncommon', 'common'];
const pad = (n) => String(n).padStart(2, '0');
const round1 = (x) => Math.round(x * 10) / 10;
const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : 0);
const decadeOf = (year) => (Number.isInteger(year) && year > 0 ? Math.floor(year / 10) * 10 : null);
const privacyOf = (u) => u?.profileVisibility || 'public';
const avatarAlbum = (avatar) => (typeof avatar === 'string' && avatar.startsWith('album:') ? avatar.slice(6) : null);

// ----- périodes (comme server/passport.js) -------------------------------------------------------------------

const monthKey = (ms) => {
  const { y, m } = parisDate(ms);
  return `${y}-${pad(m)}`;
};

function monthWindows(now, count = 12) {
  const { y, m } = parisDate(now);
  return Array.from({ length: count }, (_, k) => {
    const i = count - 1 - k;
    const start = parisMidnight(y, m - i, 1);
    return { key: monthKey(start), start, end: parisMidnight(y, m - i + 1, 1) };
  });
}

function quarterWindows(now, count = 4) {
  const { y, m } = parisDate(now);
  const first = m - ((m - 1) % 3);
  return Array.from({ length: count }, (_, k) => {
    const i = count - 1 - k;
    const start = parisMidnight(y, first - 3 * i, 1);
    const d = parisDate(start);
    return { key: `${d.y}-T${Math.floor((d.m - 1) / 3) + 1}`, start, end: parisMidnight(y, first - 3 * i + 3, 1) };
  });
}

const yearMonths = (year) => Array.from({ length: 12 }, (_, i) => {
  const start = parisMidnight(year, i + 1, 1);
  return { key: `${year}-${pad(i + 1)}`, start, end: parisMidnight(year, i + 2, 1) };
});

const retroOpensAt = (year) => parisMidnight(year, 12, 1);
const bucketOf = (windows, at) => windows.findIndex((w) => at >= w.start && at < w.end);

// ----- données d'un joueur ------------------------------------------------------------------------------------

/**
 * Horloge d'un joueur : pour un joueur fictif, ses dates (cartes, notes, succès) sont étalées dans l'ordre entre le
 * lendemain de son inscription et la veille ; pour les autres, les vraies dates.
 */
function clockOf(ctx, u) {
  if (!u.bot) return (at) => at;
  const { db } = ctx;
  const stamps = [
    ...Object.values(db.cards[u.id] || {}).map((c) => c.at),
    ...db.ratings.filter((r) => r.userId === u.id).map((r) => r.createdAt),
    ...Object.values(db.achievements[u.id] || {}),
  ].filter(Number.isFinite);
  const now = ctx.now();
  if (!stamps.length) return (at) => at;
  const lo = Math.min(...stamps);
  const from = Math.min(u.createdAt + DAY, now - 2 * DAY);
  const to = now - DAY;
  return (at) => (now - lo > 0 ? Math.round(from + ((Math.min(at, now) - lo) / (now - lo)) * (to - from)) : at);
}

/** Tout ce que le passeport et le Rétro lisent d'un joueur, dates comprises (horloge du joueur). */
function snapshot(ctx, u) {
  const { db, TRACK, ALBUM, ARTIST } = ctx;
  const clock = clockOf(ctx, u);
  const cards = Object.entries(db.cards[u.id] || {}).map(([k, c]) => {
    const [trackId, variant] = k.split('|');
    return { trackId, variant, at: clock(c.at), track: TRACK.get(trackId) };
  }).filter((c) => c.track);
  const ratings = db.ratings.filter((r) => r.userId === u.id).map((r) => ({ ...r, at: clock(r.createdAt), reviewTime: r.review ? clock(r.reviewAt || r.updatedAt || r.createdAt) : null }));
  const ach = Object.entries(db.achievements[u.id] || {}).map(([key, at]) => ({ key, at: clock(at) }));
  const albums = new Map();
  for (const c of cards) {
    const albumId = c.track.albumId;
    if (!albumId || !ALBUM.has(albumId)) continue;
    const a = albums.get(albumId) || { id: albumId, tracks: new Set(), first: Infinity };
    a.tracks.add(c.trackId);
    a.first = Math.min(a.first, c.at);
    albums.set(albumId, a);
  }
  const fav = db.favorites?.[u.id] || {};
  return { ALBUM, ARTIST, cards, ratings, ach, albums, favArtists: new Set(Array.isArray(fav.artist) ? fav.artist : []), favGenres: Array.isArray(fav.genre) ? fav.genre : [] };
}

const addTo = (map, key, cards, albums = 1) => {
  if (key == null) return;
  const v = map.get(key) || { cards: 0, albums: 0 };
  v.cards += cards;
  v.albums += albums;
  map.set(key, v);
};
const shares = (map, total, keyName = 'id') => [...map].map(([k, v]) => ({ [keyName]: k, cards: v.cards, albums: v.albums, share: ratio(v.cards, total) }))
  .filter((x) => x.cards > 0);

function rankArtists(cards, rated, favorites) {
  const ids = new Set([...cards.keys(), ...rated.keys(), ...favorites]);
  return [...ids].map((id) => {
    const r = rated.get(id) || { n: 0, plus: 0 };
    const c = cards.get(id) || { cards: 0, albums: 0 };
    const favorite = favorites.has(id);
    return { id, cards: c.cards, albums: c.albums, rated: r.n, favorite, points: c.cards + 4 * r.plus + (favorite ? 20 : 0) };
  }).filter((a) => a.points > 0).sort((a, b) => b.points - a.points || b.cards - a.cards || (a.id < b.id ? -1 : 1));
}

function ratedArtists(s, from = -Infinity, to = Infinity) {
  const out = new Map();
  for (const r of s.ratings) {
    if (r.type !== 'album' || r.at < from || r.at >= to) continue;
    const a = s.ALBUM.get(r.id);
    if (!a) continue;
    const v = out.get(a.artistId) || { n: 0, plus: 0 };
    v.n += 1;
    v.plus += Math.max(0, r.score - 5);
    out.set(a.artistId, v);
  }
  return out;
}

function shiftOf(quarters, genres) {
  const filled = quarters.filter((qt) => qt.total >= SHIFT_MIN);
  if (filled.length < 2) return null;
  const a = filled[0];
  const b = filled[filled.length - 1];
  let out = null;
  for (const g of genres) {
    const from = ratio(a.genres[g] || 0, a.total);
    const to = ratio(b.genres[g] || 0, b.total);
    if (to - from >= 0.1 && (!out || to - from > out.to - out.from)) out = { genre: g, from, to, fromKey: a.key, toKey: b.key };
  }
  return out;
}

// ----- passeport ---------------------------------------------------------------------------------------------

function computePassport(ctx, u) {
  const { db } = ctx;
  const now = ctx.now();
  const s = snapshot(ctx, u);
  const months = monthWindows(now).map((w) => ({ ...w, cards: 0, ratings: 0, completions: 0 }));
  const quarters = quarterWindows(now).map((w) => ({ ...w, total: 0, genres: {} }));
  const discover = (at, genre) => {
    const qi = bucketOf(quarters, at);
    if (qi < 0 || !genre) return;
    quarters[qi].genres[genre] = (quarters[qi].genres[genre] || 0) + 1;
    quarters[qi].total += 1;
  };

  const artistCards = new Map();
  const genres = new Map();
  const decades = new Map();
  const countries = new Map();
  const countryArtists = new Map();
  const collected = [];
  let albumCards = 0;
  let knownCards = 0;
  for (const a of s.albums.values()) {
    const album = s.ALBUM.get(a.id);
    const owned = a.tracks.size;
    albumCards += owned;
    addTo(artistCards, album.artistId, owned);
    addTo(genres, album.genre, owned);
    addTo(decades, decadeOf(album.year), owned);
    const country = s.ARTIST.get(album.artistId)?.country || null;
    if (country) {
      knownCards += owned;
      addTo(countries, country, owned);
      if (!countryArtists.has(country)) countryArtists.set(country, new Set());
      countryArtists.get(country).add(album.artistId);
    }
    collected.push({ id: a.id, owned, total: album.trackCount });
    discover(a.first, album.genre);
  }

  // Raretés : morceaux distincts ; holo : lignes holo.
  const rarity = new Map(RARITIES.map((r) => [r, { cards: 0, holo: 0 }]));
  const seen = new Set();
  for (const c of s.cards) {
    const v = rarity.get(c.track.rarity);
    if (!v) continue;
    if (c.variant === 'holo') v.holo += 1;
    if (!seen.has(c.trackId)) {
      seen.add(c.trackId);
      v.cards += 1;
    }
  }
  for (const c of s.cards) {
    const mi = bucketOf(months, c.at);
    if (mi >= 0) months[mi].cards += 1;
  }

  const dist = Array(11).fill(0);
  for (const r of s.ratings) {
    if (r.score >= 0 && r.score <= 10) dist[r.score] += 1;
    const mi = bucketOf(months, r.at);
    if (mi >= 0) months[mi].ratings += 1;
    if (r.type === 'album') discover(r.at, s.ALBUM.get(r.id)?.genre);
  }
  const ratingCount = s.ratings.length;
  const ratingSum = s.ratings.reduce((sum, r) => sum + r.score, 0);
  const best = s.ratings.filter((r) => r.type === 'album' && s.ALBUM.has(r.id))
    .sort((a, b) => b.score - a.score || (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, TOP).map((r) => ({ id: r.id, score: r.score }));

  let albumsDone = 0;
  let artistsDone = 0;
  for (const a of s.ach) {
    if (a.key.startsWith('album:') && s.ALBUM.has(a.key.slice(6))) {
      albumsDone += 1;
      const mi = bucketOf(months, a.at);
      if (mi >= 0) months[mi].completions += 1;
    } else if (a.key.startsWith('artist:') && s.ARTIST.has(a.key.slice(7))) artistsDone += 1;
  }

  const lists = { public: 0, friends: 0, private: 0 };
  for (const l of db.lists || []) {
    if (l.userId === u.id && l.kind === 'list' && !l.hiddenAt && (l.visibility || 'public') in lists) lists[l.visibility || 'public'] += 1;
  }
  const battleVotes = (db.battleVotes || []).filter((v) => v.userId === u.id && v.winner).length;

  const artists = rankArtists(artistCards, ratedArtists(s), s.favArtists);
  const genreList = shares(genres, albumCards).sort((a, b) => b.cards - a.cards || (a.id < b.id ? -1 : 1));
  const decadeList = shares(decades, albumCards, 'decade').sort((a, b) => a.decade - b.decade);
  const countryList = shares(countries, knownCards, 'code').map((c) => ({ ...c, artists: countryArtists.get(c.code)?.size || 0 }))
    .sort((a, b) => b.cards - a.cards).slice(0, 10);
  collected.sort((a, b) => b.owned - a.owned || b.owned / (b.total || 1) - a.owned / (a.total || 1) || (a.id < b.id ? -1 : 1));
  const evo = new Map();
  for (const qt of quarters) for (const [g, n] of Object.entries(qt.genres)) evo.set(g, (evo.get(g) || 0) + n);
  const evoTop = [...evo].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP).map(([g]) => g);
  return {
    memberSince: u.createdAt,
    totals: {
      cards: seen.size,
      holo: [...rarity.values()].reduce((sum, v) => sum + v.holo, 0),
      albumsStarted: collected.length,
      albumsCompleted: albumsDone,
      artistsMastered: artistsDone,
      artists: artistCards.size,
      genres: genreList.length,
      decades: decadeList.length,
      countries: countries.size,
      ratings: ratingCount,
      average: ratingCount ? round1(ratingSum / ratingCount) : null,
      reviews: s.ratings.filter((r) => r.review && !r.hiddenAt).length,
      battleVotes,
      boosters: u.openings || 0,
    },
    lists,
    favorites: {
      artist: artists[0] || null,
      artists: artists.slice(0, TOP),
      albums: best,
      collected: collected.slice(0, TOP),
      genre: genreList[0]?.id ?? s.favGenres[0] ?? null,
      decade: [...decadeList].sort((a, b) => b.cards - a.cards)[0]?.decade ?? null,
      country: countryList[0]?.code ?? null,
      genres: s.favGenres.slice(0, TOP),
    },
    distributions: {
      genres: genreList,
      decades: decadeList,
      countries: countryList,
      countriesKnown: ratio(knownCards, albumCards),
      rarities: RARITIES.map((id) => ({ id, cards: rarity.get(id).cards, holo: rarity.get(id).holo, total: ctx.staticCatalog.totals?.().rarity?.[id] || 0 })),
      ratings: dist,
    },
    timeline: months.map((m) => ({ month: m.key, start: m.start, cards: m.cards, ratings: m.ratings, completions: m.completions })),
    evolution: { quarters, genres: evoTop, shift: shiftOf(quarters, evoTop) },
    computedAt: now,
  };
}

// ----- Rétro ---------------------------------------------------------------------------------------------------

function computeRetro(ctx, u, year) {
  const { db } = ctx;
  const now = ctx.now();
  const s = snapshot(ctx, u);
  const months = yearMonths(year).map((w) => ({ ...w, cards: 0, ratings: 0, completions: 0 }));
  const start = months[0].start;
  const end = months[11].end;
  const inYear = (at) => at >= start && at < end;

  const rarity = new Map(RARITIES.map((r) => [r, { cards: 0, holo: 0, first: null }]));
  const byAlbum = new Map();
  let firstCard = null;
  for (const c of s.cards) {
    if (!inYear(c.at)) continue;
    const card = { trackId: c.trackId, variant: c.variant, at: c.at };
    const v = rarity.get(c.track.rarity);
    if (v) {
      v.cards += 1;
      if (c.variant === 'holo') v.holo += 1;
      if (!v.first || card.at < v.first.at) v.first = card;
    }
    if (!firstCard || card.at < firstCard.at) firstCard = card;
    if (c.track.albumId && s.ALBUM.has(c.track.albumId)) byAlbum.set(c.track.albumId, (byAlbum.get(c.track.albumId) || 0) + 1);
    months[bucketOf(months, c.at)].cards += 1;
  }
  const artistCards = new Map();
  const artistAlbum = new Map();
  const genreAlbum = new Map();
  const genres = new Map();
  const decades = new Map();
  let cardsInAlbums = 0;
  const most = (map, key, albumId, n) => {
    if (key != null && (!map.has(key) || byAlbum.get(map.get(key)) < n)) map.set(key, albumId);
  };
  for (const [albumId, n] of byAlbum) {
    const a = s.ALBUM.get(albumId);
    cardsInAlbums += n;
    addTo(artistCards, a.artistId, n);
    addTo(genres, a.genre, n);
    addTo(decades, decadeOf(a.year), n);
    most(artistAlbum, a.artistId, albumId, n);
    most(genreAlbum, a.genre, albumId, n);
  }

  const yearRatings = s.ratings.filter((r) => inYear(r.at));
  for (const r of yearRatings) months[bucketOf(months, r.at)].ratings += 1;
  const bestAlbums = yearRatings.filter((r) => r.type === 'album' && s.ALBUM.has(r.id)).sort((a, b) => b.score - a.score || a.at - b.at).slice(0, TOP);
  const rated = ratedArtists(s, start, end);

  let firstCompletion = null;
  let lowestPressing = null;
  let completed = 0;
  let mastered = 0;
  for (const a of s.ach) {
    if (!inYear(a.at)) continue;
    if (a.key.startsWith('album:') && s.ALBUM.has(a.key.slice(6))) {
      completed += 1;
      months[bucketOf(months, a.at)].completions += 1;
      const albumId = a.key.slice(6);
      const rank = ctx.collection.rankOf ? ctx.collection.rankOf(u.id, a.key) : null;
      if (!firstCompletion || a.at < firstCompletion.at) firstCompletion = { albumId, at: a.at, rank };
      if (rank != null && (!lowestPressing || rank < lowestPressing.rank)) lowestPressing = { albumId, at: a.at, rank };
    } else if (a.key.startsWith('artist:')) mastered += 1;
  }

  const artists = rankArtists(artistCards, rated, s.favArtists).filter((a) => a.cards > 0 || a.rated > 0).slice(0, TOP).map((a) => ({
    ...a, albumId: artistAlbum.get(a.id) || bestAlbums.find((b) => s.ALBUM.get(b.id)?.artistId === a.id)?.id || null,
  }));
  const cardsTotal = months.reduce((sum, m) => sum + m.cards, 0);
  let busiest = null;
  for (const m of months) {
    if (!m.cards && !m.ratings) continue;
    if (!busiest || m.cards > busiest.cards || (m.cards === busiest.cards && m.ratings > busiest.ratings)) busiest = { month: m.key, cards: m.cards, ratings: m.ratings };
  }
  const rarest = RARE_ORDER.map((r) => (rarity.get(r)?.first ? { ...rarity.get(r).first, rarity: r } : null)).find(Boolean) || null;
  const ratingCount = yearRatings.length;
  const created = parisDate(u.createdAt).y;
  return {
    year,
    status: 'open',
    totals: {
      cards: cardsTotal,
      holo: [...rarity.values()].reduce((sum, v) => sum + v.holo, 0),
      albums: byAlbum.size,
      completed,
      mastered,
      ratings: ratingCount,
      average: ratingCount ? round1(yearRatings.reduce((sum, r) => sum + r.score, 0) / ratingCount) : null,
      reviews: yearRatings.filter((r) => r.review && !r.hiddenAt).length,
      battleVotes: (db.battleVotes || []).filter((v) => v.userId === u.id && v.winner && inYear(v.createdAt)).length,
      // La démo ne date pas les ouvertures : toutes comptent pour l'année d'inscription.
      boosters: created === year ? u.openings || 0 : 0,
      boostersPartial: false,
      lists: (db.lists || []).filter((l) => l.userId === u.id && l.kind === 'list' && !l.hiddenAt && inYear(l.createdAt || 0)).length,
    },
    months: months.map((m) => ({ month: m.key, start: m.start, cards: m.cards, ratings: m.ratings, completions: m.completions })),
    top: {
      artist: artists[0] || null,
      artists,
      albums: bestAlbums.map((b) => ({ id: b.id, score: b.score })),
      collected: [...byAlbum].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP).map(([id, cards]) => ({ id, cards })),
      genres: shares(genres, cardsInAlbums).sort((a, b) => b.cards - a.cards || (a.id < b.id ? -1 : 1)).slice(0, TOP)
        .map((g) => ({ ...g, albumId: genreAlbum.get(g.id) || null })),
      decades: shares(decades, cardsInAlbums, 'decade').sort((a, b) => b.cards - a.cards || a.decade - b.decade).slice(0, TOP),
    },
    rarities: RARITIES.map((id) => ({ id, cards: rarity.get(id).cards, holo: rarity.get(id).holo })),
    moments: { firstCard, firstCompletion, rarestPull: rarest, busiestMonth: busiest, lowestPressing },
    thin: cardsTotal < 30 && ratingCount < 5 && completed === 0,
    computedAt: now,
  };
}

// ----- réponses ------------------------------------------------------------------------------------------------

/** Années de Rétro du joueur ; dans la démo, l'année en cours est toujours ouverte (avant-première). */
function retroInfo(ctx, u) {
  const now = ctx.now();
  const current = parisDate(now).y;
  const first = Math.max(RETRO_FIRST_YEAR, parisDate(u.createdAt || now).y);
  const years = [];
  for (let y = current; y >= first; y--) years.push(y);
  return { years, current: { year: current, status: 'open', opensAt: retroOpensAt(current) } };
}

function owner(ctx, u) {
  return ctx.summaries([u.id]).get(u.id) || null;
}

function passportResponse(ctx, viewer, target) {
  const self = viewer.id === target.id;
  const v = viewerOf(ctx, viewer.id);
  const data = computePassport(ctx, target);
  const { lists, ...rest } = data;
  const o = owner(ctx, target);
  return {
    ...rest,
    totals: { ...data.totals, lists: lists.public + (self || v.friends.has(target.id) ? lists.friends : 0) + (self ? lists.private : 0) },
    owner: o,
    self,
    retro: self ? retroInfo(ctx, target) : null,
    catalog: ctx.refs({
      albumIds: [...data.favorites.albums.map((a) => a.id), ...data.favorites.collected.map((a) => a.id), avatarAlbum(o?.avatar)].filter(Boolean),
      artistIds: data.favorites.artists.map((a) => a.id),
    }),
  };
}

function otherPassport(ctx, username) {
  const me = ctx.me();
  const target = ctx.userByName(username);
  const v = viewerOf(ctx, me.id);
  if (!target || !target.verified || (target.id !== me.id && v.hidden.has(target.id))) ctx.fail(404, 'user_not_found');
  if (target.id !== me.id) {
    const privacy = privacyOf(target);
    if (privacy === 'private' || (privacy === 'friends' && !v.friends.has(target.id))) ctx.fail(403, 'passport_private', { visibility: privacy });
  }
  return passportResponse(ctx, me, target);
}

function retroResponse(ctx, raw) {
  const u = ctx.me();
  const info = retroInfo(ctx, u);
  const year = /^\d{4}$/.test(String(raw)) ? Number(raw) : NaN;
  if (!info.years.includes(year)) ctx.fail(404, 'retro_not_found', { years: info.years });
  const data = computeRetro(ctx, u, year);
  const preview = year === parisDate(ctx.now()).y && ctx.now() < retroOpensAt(year);
  const o = owner(ctx, u);
  const m = data.moments;
  return {
    ...data,
    ...(preview ? { preview: true } : {}),
    years: info.years,
    owner: o,
    catalog: ctx.refs({
      trackIds: [m.firstCard?.trackId, m.rarestPull?.trackId].filter(Boolean),
      albumIds: [
        ...data.top.albums.map((a) => a.id), ...data.top.collected.map((a) => a.id), ...data.top.artists.map((a) => a.albumId),
        ...data.top.genres.map((g) => g.albumId), m.firstCompletion?.albumId, m.lowestPressing?.albumId, avatarAlbum(o?.avatar),
      ].filter(Boolean),
      artistIds: data.top.artists.map((a) => a.id),
    }),
  };
}

export const routes = [
  ['GET', /^\/passport$/, ({ ctx }) => passportResponse(ctx, ctx.me(), ctx.me())],
  ['GET', /^\/users\/([^/]+)\/passport$/, ({ params, ctx }) => otherPassport(ctx, decodeURIComponent(params[0]))],
  ['GET', /^\/retro\/([^/]+)$/, ({ params, ctx }) => retroResponse(ctx, decodeURIComponent(params[0]))],
];

// Rien à semer : le passeport et le Rétro se calculent sur les données des autres jumeaux (cartes, notes, listes…).
export function seed() {}

export function migrate() {}
