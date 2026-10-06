// Faux Deezer déterministe pour tester l'import du catalogue sans Internet.
// Chaque artiste a des albums studio, une réédition deluxe en double, un live, une compilation et deux singles
// (l'un déjà présent sur un album, l'autre hors album). Comme la vraie API, les listes sont paginées (limit, index,
// next) et /search/artist cherche par nom. embedLimit : la liste de pistes intégrée à /album/{id} s'arrête à N pistes
// (le reste se lit dans /album/{id}/tracks). addCustomArtist() ajoute un artiste sur mesure pour un test.
import { GENRE_MAP } from '../importer.js';

const GENRE_IDS = Object.keys(GENRE_MAP).map(Number);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeFakeDeezer({ artists = 60, albumsPerArtist = 4, quotaEvery = 0, embedLimit = Infinity } = {}) {
  const world = { artists: new Map(), albums: new Map() };
  const covers = (id) => ({
    cover_big: `https://cdn.deezer.test/${id}/500.jpg`,
    cover_xl: `https://cdn.deezer.test/${id}/1000.jpg`,
  });

  const addArtist = (id, name, fans, genreId) => {
    const r = rng(id);
    const list = [];
    for (let k = 0; k < albumsPerArtist; k++) {
      const albumId = id * 100 + k;
      const title = `${name} Album ${k + 1}`;
      const n = 8 + Math.floor(r() * 7);
      const tracks = Array.from({ length: n }, (_, i) => {
        const feat = i === 2 ? ' (feat. Guest Star)' : '';
        return {
          id: albumId * 100 + i,
          title: `${name} Song ${k + 1}-${i + 1}${feat}`,
          title_short: `${name} Song ${k + 1}-${i + 1}`,
          rank: Math.floor(r() * 1_000_000),
          link: `https://www.deezer.test/track/${albumId * 100 + i}`,
        };
      });
      world.albums.set(albumId, { id: albumId, title, record_type: 'album', fans: Math.round(fans / (k + 2)), genre_id: genreId, release_date: `${1990 + (id % 30)}-0${1 + (k % 9)}-01`, link: `https://www.deezer.test/album/${albumId}`, ...covers(albumId), tracks });
      list.push(albumId);
    }
    // Réédition deluxe du premier album (plus de fans : c'est elle qui doit être gardée), live, compilation.
    const first = world.albums.get(list[0]);
    const deluxeId = id * 100 + 50;
    world.albums.set(deluxeId, { ...first, id: deluxeId, title: `${first.title} (Deluxe Edition)`, fans: first.fans + 10, link: `https://www.deezer.test/album/${deluxeId}`, ...covers(deluxeId), tracks: first.tracks.map((t) => ({ ...t, id: t.id + 5_000_000 })) });
    list.push(deluxeId);
    const liveId = id * 100 + 60;
    world.albums.set(liveId, { ...first, id: liveId, title: `Live at the Arena`, fans: first.fans * 3, ...covers(liveId) });
    list.push(liveId);
    const compId = id * 100 + 70;
    world.albums.set(compId, { ...first, id: compId, title: `Greatest Hits`, record_type: 'compile', fans: first.fans * 4, ...covers(compId) });
    list.push(compId);
    // Singles : le premier reprend un titre d'album (pas une promo), le second est hors album.
    const s1 = id * 100 + 80;
    world.albums.set(s1, { id: s1, title: first.tracks[0].title_short, record_type: 'single', fans: fans * 2, genre_id: genreId, release_date: '2020-01-01', ...covers(s1), tracks: [{ ...first.tracks[0], id: first.tracks[0].id + 9_000_000 }] });
    const s2 = id * 100 + 81;
    world.albums.set(s2, { id: s2, title: `${name} Exclusive Single`, record_type: 'single', fans, genre_id: genreId, release_date: '2021-06-01', link: `https://www.deezer.test/album/${s2}`, ...covers(s2), tracks: [{ id: s2 * 100, title: `${name} Exclusive Single`, title_short: `${name} Exclusive Single`, rank: 950_000, link: `https://www.deezer.test/track/${s2 * 100}` }] });
    list.push(s1, s2);
    world.artists.set(id, { id, name, nb_fan: fans, genreId, albums: list });
  };

  /**
   * Artiste sur mesure : albums = [{ title, tracks (nombre ou liste de titres), fans, record_type, release_date, id }].
   * Les identifiants des albums valent id * 1000 + k (sauf id donné), ceux des pistes album * 100 + i.
   */
  const addCustomArtist = ({ id, name, fans, genreId = 132, albums = [] }) => {
    const list = albums.map((a, k) => {
      const albumId = a.id ?? id * 1000 + k;
      const titles = Array.isArray(a.tracks) ? a.tracks : Array.from({ length: a.tracks ?? 10 }, (_, i) => `${a.title} ${i + 1}`);
      const tracks = titles.map((t, i) => ({
        id: albumId * 100 + i, title: t, title_short: t, rank: 1000 + ((albumId * 7919 + i * 104729) % 990_000),
        link: `https://www.deezer.test/track/${albumId * 100 + i}`,
      }));
      world.albums.set(albumId, {
        id: albumId, title: a.title, record_type: a.record_type || 'album', fans: a.fans ?? 5000, genre_id: genreId,
        release_date: a.release_date || '2015-01-01', link: `https://www.deezer.test/album/${albumId}`, ...covers(albumId), tracks,
      });
      return albumId;
    });
    world.artists.set(id, { id, name, nb_fan: fans, genreId, albums: list });
    return world.artists.get(id);
  };

  for (let i = 0; i < artists; i++) {
    const id = 1000 + i;
    addArtist(id, `Artist ${id}`, Math.round(3_000_000 / (i + 1)) + 1000, GENRE_IDS[i % GENRE_IDS.length]);
  }
  // Un artiste de la graine : son « Discovery » existe déjà dans le jeu et ne doit pas être importé en double.
  addArtist(27, 'Daft Punk', 4_000_000, 113);
  const dp = world.artists.get(27);
  const firstDp = world.albums.get(dp.albums[0]);
  firstDp.title = 'Discovery';

  const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
  /** Une page d'une liste, comme Deezer : { data, total, next } (next absent sur la dernière page). */
  const page = (u, all, defaultLimit = 25) => {
    const limit = Math.max(1, Number(u.searchParams.get('limit')) || defaultLimit);
    const index = Math.max(0, Number(u.searchParams.get('index')) || 0);
    const out = { data: all.slice(index, index + limit), total: all.length };
    if (index + limit < all.length) {
      const nextUrl = new URL(u);
      nextUrl.searchParams.set('index', String(index + limit));
      out.next = nextUrl.href;
    }
    return out;
  };
  const calls = [];
  let n = 0;

  async function fetchImpl(url) {
    const u = new URL(url);
    const path = u.pathname;
    calls.push(path);
    n++;
    if (quotaEvery && n % quotaEvery === 0) return json({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } });
    let m;
    if ((m = /^\/chart\/(\d+)\/artists$/.exec(path))) {
      const gid = Number(m[1]);
      const list = [...world.artists.values()].filter((a) => a.genreId === gid).sort((a, b) => b.nb_fan - a.nb_fan).slice(0, 5);
      return json({ data: list.map((a) => ({ id: a.id, name: a.name })) });
    }
    if ((m = /^\/genre\/(\d+)\/artists$/.exec(path))) return json({ data: [] });
    if (path === '/search/artist') {
      const want = String(u.searchParams.get('q') || '').toLowerCase();
      const found = [...world.artists.values()].filter((a) => a.name.toLowerCase().includes(want));
      return json(page(u, found.map((a) => ({ id: a.id, name: a.name, nb_fan: a.nb_fan }))));
    }
    if ((m = /^\/artist\/(\d+)$/.exec(path))) {
      const a = world.artists.get(Number(m[1]));
      return a ? json({ id: a.id, name: a.name, nb_fan: a.nb_fan }) : json({ error: { code: 800, message: 'no data' } });
    }
    if ((m = /^\/artist\/(\d+)\/albums$/.exec(path))) {
      const a = world.artists.get(Number(m[1]));
      if (!a) return json({ error: { code: 800, message: 'no data' } });
      const all = a.albums.map((id) => { const al = world.albums.get(id); return { id: al.id, title: al.title, record_type: al.record_type, fans: al.fans, genre_id: al.genre_id, release_date: al.release_date, link: al.link, cover_big: al.cover_big, cover_xl: al.cover_xl }; });
      return json(page(u, all));
    }
    if ((m = /^\/artist\/(\d+)\/related$/.exec(path))) {
      const id = Number(m[1]);
      const rel = [id + 7, id + 13, id + 29].map((x) => world.artists.get(x)).filter(Boolean);
      return json({ data: rel.map((a) => ({ id: a.id, name: a.name, nb_fan: a.nb_fan })) });
    }
    if ((m = /^\/album\/(\d+)$/.exec(path))) {
      const al = world.albums.get(Number(m[1]));
      if (!al) return json({ error: { code: 800, message: 'no data' } });
      return json({ ...al, nb_tracks: al.tracks.length, tracks: { data: al.tracks.slice(0, embedLimit) } });
    }
    if ((m = /^\/album\/(\d+)\/tracks$/.exec(path))) {
      const al = world.albums.get(Number(m[1]));
      if (!al) return json({ error: { code: 800, message: 'no data' } });
      return json(page(u, al.tracks));
    }
    return json({ error: { code: 800, message: `unknown ${path}` } });
  }

  return { fetchImpl, world, calls, addCustomArtist };
}
