// Catalogue statique (les 20 albums de shared/catalog.js), avec la même interface que le catalogue en base
// (server/catalog.js) : la démo autonome et les tests l'utilisent à la place de SQLite.
import {
  TRACKS, TRACK_BY_ID, ALBUMS, ALBUM_BY_ID, ARTISTS, ARTIST_BY_ID, TRACKS_BY_ALBUM, TRACKS_BY_ARTIST, ALBUMS_BY_ARTIST,
  PROMO_TRACKS, decadeOf, artFor, catalogCode,
} from './catalog.js';
import { RARITIES, foldText as norm } from './rules.js';

function trackView(t) {
  if (!t) return null;
  const artist = ARTIST_BY_ID[t.artistId];
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    feat: t.feat,
    pop: t.pop,
    rarity: t.rarity,
    albumId: t.albumId,
    artistId: t.artistId,
    artist: artist.name,
    country: artist.country || null,
    album: t.albumId ? ALBUM_BY_ID[t.albumId].title : null,
    n: t.n,
    total: t.total,
    year: t.year,
    genre: t.genre,
    promoKind: t.promoKind || null,
    context: t.context || null,
    code: catalogCode(t),
    art: artFor(t),
    url: null,
  };
}

function albumView(a) {
  if (!a) return null;
  const artist = ARTIST_BY_ID[a.artist];
  return {
    id: a.id,
    title: a.title,
    artistId: a.artist,
    artist: artist.name,
    country: artist.country || null,
    year: a.year,
    genre: a.genre,
    trackCount: TRACKS_BY_ALBUM[a.id].length,
    code: `AM-${String(a.catalog).padStart(3, '0')}`,
    art: { ...a.art, seed: a.id },
    url: null,
    source: 'seed',
  };
}

function artistView(a) {
  if (!a) return null;
  return { id: a.id, name: a.name, country: a.country, genre: a.genre, albumCount: (ALBUMS_BY_ARTIST[a.id] || []).length, trackCount: (TRACKS_BY_ARTIST[a.id] || []).length, source: 'seed' };
}

const own = (o) => (typeof o === 'string' ? o : null);

function ratio(list, owned) {
  const have = list.reduce((n, t) => n + (owned.has(t.id) ? 1 : 0), 0);
  return { owned: have, total: list.length, pct: list.length ? have / list.length : 0 };
}

function pick(list, rng, exclude) {
  const candidates = exclude ? list.filter((t) => !exclude.has(t.id)) : list;
  return candidates.length ? candidates[Math.floor(rng() * candidates.length)] : null;
}

export const staticCatalog = {
  track: (id) => trackView(TRACK_BY_ID[own(id)]),
  tracks: (ids) => [...new Set(ids || [])].map((id) => trackView(TRACK_BY_ID[own(id)])).filter(Boolean),
  album: (id) => albumView(ALBUM_BY_ID[own(id)]),
  artist: (id) => artistView(ARTIST_BY_ID[own(id)]),
  albumTracks: (albumId) => (TRACKS_BY_ALBUM[own(albumId)] || []).map(trackView),
  artistAlbums: (artistId) => (ALBUMS_BY_ARTIST[own(artistId)] || []).map((a) => albumView(ALBUM_BY_ID[a.id])),
  artistTracks: (artistId) => (TRACKS_BY_ARTIST[own(artistId)] || []).map(trackView),
  albumTrackIds: (albumId) => (TRACKS_BY_ALBUM[own(albumId)] || []).map((t) => t.id),
  artistTrackIds: (artistId) => (TRACKS_BY_ARTIST[own(artistId)] || []).map((t) => t.id),

  randomTrack({ rarity, genre, albumIds, exclude } = {}, rng = Math.random) {
    let list = TRACKS.filter((t) => t.rarity === rarity);
    if (albumIds?.length) list = list.filter((t) => albumIds.includes(t.albumId));
    else if (genre) list = list.filter((t) => t.genre === genre);
    return trackView(pick(list, rng, exclude));
  },

  randomTracks({ genre, minPop = 0, count = 5, exclude } = {}, rng = Math.random) {
    const list = TRACKS.filter((t) => t.pop >= minPop && (!genre || genre === 'all' || t.genre === genre) && !exclude?.has(t.id));
    const out = [];
    const copy = [...list];
    while (out.length < count && copy.length) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
    return out.map(trackView);
  },

  totals() {
    const rarity = Object.fromEntries(RARITIES.map((r) => [r, TRACKS.filter((t) => t.rarity === r).length]));
    return { tracks: TRACKS.length, albums: ALBUMS.length, artists: ARTISTS.length, promos: PROMO_TRACKS.length, rarity, imported: 0 };
  },
  rarityTotals() {
    return this.totals().rarity;
  },
  genres() {
    const counts = {};
    for (const a of ALBUMS) counts[a.genre] = (counts[a.genre] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([id, albums]) => ({ id, albums, tracks: TRACKS.filter((t) => t.genre === id).length }));
  },

  ownedTracks(owned, { q, rarity, offset = 0, limit = 60, holo = new Set() } = {}) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const order = { promo: 7, legendary: 6, ultra: 5, super: 4, rare: 3, uncommon: 2, common: 1 };
    let list = TRACKS.filter((t) => owned.has(t.id) && (!rarity || t.rarity === rarity)).map(trackView);
    if (words.length) list = list.filter((t) => words.every((w) => norm(`${t.title} ${t.artist} ${t.album || ''}`).includes(w)));
    list.sort((a, b) => order[b.rarity] - order[a.rarity] || b.pop - a.pop);
    return { total: list.length, items: list.slice(offset, offset + limit).map((t) => ({ ...t, holo: holo.has(t.id) })) };
  },
  decades() {
    const counts = {};
    for (const a of ALBUMS) counts[decadeOf(a.year)] = (counts[decadeOf(a.year)] || 0) + 1;
    return Object.entries(counts).map(([d, albums]) => ({ decade: Number(d), albums })).sort((a, b) => a.decade - b.decade);
  },

  /** `owned` : Set des cartes du joueur (la démo n'a pas de base pour joindre les cartes). */
  searchAlbums({ q, genre, decade, artistId, sort = 'popular', mine = false, offset = 0, limit = 48, owned = new Set() } = {}) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    let list = ALBUMS.map((a) => ({ ...albumView(ALBUM_BY_ID[a.id]), owned: ratio(TRACKS_BY_ALBUM[a.id], owned).owned }));
    if (words.length) list = list.filter((a) => words.every((w) => norm(`${a.title} ${a.artist}`).includes(w)));
    if (genre) list = list.filter((a) => a.genre === genre);
    if (decade != null && decade !== '') list = list.filter((a) => decadeOf(a.year) === Number(decade));
    if (artistId) list = list.filter((a) => a.artistId === artistId);
    if (mine) list = list.filter((a) => a.owned > 0);
    const cmp = {
      progress: (a, b) => b.owned / b.trackCount - a.owned / a.trackCount || b.owned - a.owned,
      title: (a, b) => a.title.localeCompare(b.title),
      year: (a, b) => b.year - a.year,
      recent: () => 0,
      popular: () => 0,
    }[sort] || (() => 0);
    list.sort(cmp);
    const off = Math.max(0, Number(offset) || 0);
    return { total: list.length, items: list.slice(off, off + (Number(limit) || 48)) };
  },

  promos({ offset = 0, limit = 60 } = {}) {
    return { total: PROMO_TRACKS.length, items: PROMO_TRACKS.slice(offset, offset + limit).map(trackView) };
  },

  /**
   * Statistiques de collection (même forme que celles du serveur : seuls les albums et artistes commencés).
   * `achievements` : clés des succès du joueur ; comme sur le serveur, albums complétés et artistes maîtrisés se
   * comptent d'après les succès obtenus (jamais retirés), sinon d'après les cartes possédées.
   */
  stats(owned, achievements = null) {
    const byRarity = Object.fromEntries(RARITIES.map((r) => [r, ratio(TRACKS.filter((t) => t.rarity === r), owned)]));
    const albums = {};
    for (const a of ALBUMS) {
      const r = ratio(TRACKS_BY_ALBUM[a.id], owned);
      if (r.owned) albums[a.id] = r;
    }
    const artists = {};
    for (const a of ARTISTS) {
      const r = ratio(TRACKS_BY_ARTIST[a.id], owned);
      if (r.owned) artists[a.id] = r;
    }
    const keys = achievements ? [...new Set(achievements)] : null;
    return {
      total: ratio(TRACKS, owned),
      promos: ratio(PROMO_TRACKS, owned),
      byRarity,
      albums,
      artists,
      albumsCompleted: keys
        ? keys.filter((k) => k.startsWith('album:') && ALBUM_BY_ID[own(k.slice(6))]).length
        : Object.values(albums).filter((x) => x.pct === 1).length,
      artistsMastered: keys
        ? keys.filter((k) => k.startsWith('artist:') && ARTIST_BY_ID[own(k.slice(7))]).length
        : Object.values(artists).filter((x) => x.pct === 1).length,
      catalog: { albums: ALBUMS.length, artists: ARTISTS.length, tracks: TRACKS.length },
    };
  },

  groupStats(owned, by) {
    const keyOf = (t) => (by === 'decade' ? decadeOf(t.year) : t.genre);
    const groups = new Map();
    for (const t of TRACKS) {
      const k = keyOf(t);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    return [...groups.entries()].map(([key, list]) => ({ key, ...ratio(list, owned) }))
      .sort((a, b) => (by === 'decade' ? a.key - b.key : b.total - a.total));
  },
};
