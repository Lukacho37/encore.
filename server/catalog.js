// Catalogue musical en base (SQLite) : la graine (20 albums choisis à la main, shared/catalog.js) plus les albums
// importés depuis Deezer (server/importer.js), jusqu'à 20 000 et plus.
//
// Toutes les fonctions sont synchrones (node:sqlite). Les objets renvoyés sont « autoportants » : une carte contient
// le nom de l'artiste, le titre de l'album, le visuel et le code catalogue, pour que le site puisse l'afficher sans
// autre requête. L'interface est la même que celle du catalogue statique de la démo (shared/staticCatalog.js).
//
// Éléments archivés (status = 'withdrawn', détachement d'un fournisseur, P2-C) : absents des tirages, de la navigation,
// des totaux et des agrégats ; toujours lisibles un par un (cartes, notes, listes et vinyles des joueurs), avec
// `archived: true` sur leur vue (PLAN.md 3.7).
//
// Navigation (/catalog/albums, PLAN.md 7.3, P2-E) : pages par curseur (keyset) sur les index de cat_albums, sans
// parcours complet ni tri de tout le catalogue ; tri « populaires » en deux requêtes (les albums de la graine, puis
// les importés par l'index des fans) ; texte cherché dans l'index de la recherche globale (search_docs, search_fts),
// cat_search n'est plus utilisé.
import { config } from './config.js';
import { ARTISTS, ALBUMS, TRACKS, decadeOf } from '../shared/catalog.js';
import { RARITIES, foldText } from '../shared/rules.js';
import { generatedArt } from '../shared/art.js';
import { normalize, tokensOf, ftsBody } from '../shared/search.js';
import { indexRow } from './search.js';

const pad = (n, w = 2) => String(n).padStart(w, '0');
const parse = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

// Numéros de catalogue : 1 à 1000 réservés à la graine (un album ajouté à shared/catalog.js prend le suivant),
// les albums importés sont numérotés à partir de 1001.
export const SEED_CATALOG_MAX = 1000;

/** Tris de la navigation dans les albums (/catalog/albums?sort=). */
export const BROWSE_SORTS = ['popular', 'progress', 'title', 'year', 'recent'];
/** Albums trouvés au plus par un filtre texte (les plus populaires d'abord) : de quoi paginer sans tout charger. */
export const TEXT_CAP = 5000;

/** Entier borné reçu d'une requête (pagination) : SQLite refuse un LIMIT ou un OFFSET non entier. */
export function clampInt(raw, min, max, fallback) {
  return Math.min(max, Math.max(min, Math.floor(Number(raw) || fallback)));
}

/** Code catalogue façon maison de disques : AM-001 pour un album, AM-P03 pour une promo. */
export function codeFor(kind, number) {
  return kind === 'promo' ? `AM-P${pad(number)}` : `AM-${pad(number, 3)}`;
}

/** Curseur de navigation reçu (tableau décodé par server/paging.js) mal formé pour ce tri : 400. */
export class BadCursor extends Error {}

/** Colonnes d'une ligne de catalog.collectionRows. */
export const ROW = Object.freeze({ track: 0, variant: 1, count: 2, at: 3, rarity: 4, artist: 5 });

/**
 * `seedData` : la graine (par défaut celle de shared/catalog.js) ; les tests y ajoutent un album pour vérifier
 * qu'un nouvel album de base trouve sa place à côté des albums importés.
 */
export function createCatalog(db, { covers = () => config.covers !== 'off', seedData = { ARTISTS, ALBUMS, TRACKS } } = {}) {
  const statements = new Map();
  /** Requête préparée une fois par texte SQL. */
  const q = (sql) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    return st;
  };
  const now = () => Date.now();
  const json = (list) => JSON.stringify(list);

  // Texte replié (sans accents ni casse) pour la recherche dans ses cartes : fold(colonne) LIKE fold(mot).
  db.function('fold', { deterministic: true }, (s) => (s == null ? null : foldText(s)));

  /** Prochain numéro libre de la plage des albums importés (après 1000, réservés à la graine). */
  const nextCatalogNumber = () => Math.max(q('SELECT MAX(catalog) AS n FROM cat_albums').get().n || 0, SEED_CATALOG_MAX) + 1;

  // ---------- index de la recherche ----------------------------------------------------------

  // Le module search (server/search.js) se branche ici à son démarrage : un album importé est alors indexé par lui
  // (dictionnaire des mots et caches tenus à jour). Sans module (catalogue seul : scripts, tests), le document de
  // l'album est écrit directement, avec les mêmes règles (indexRow).
  let indexer = null;
  const setIndexer = (fn) => {
    indexer = typeof fn === 'function' ? fn : null;
  };

  /** (Ré)indexe un album dans la recherche globale (après son import ou sa modification). */
  function indexAlbum(albumId) {
    if (indexer) return indexer(albumId);
    return indexRow(db, 'album', albumId);
  }

  // ---------- graine ----------------------------------------------------------------

  function seed() {
    const { ARTISTS, ALBUMS, TRACKS } = seedData;
    db.exec('BEGIN');
    try {
      const artist = q(`INSERT INTO cat_artists (id, name, country, genre, fans, source, created_at) VALUES (?, ?, ?, ?, 0, 'seed', ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, country = excluded.country, genre = excluded.genre`);
      for (const a of ARTISTS) artist.run(a.id, a.name, a.country, a.genre, now());
      const album = q(`INSERT INTO cat_albums (id, artist_id, title, year, genre, art, catalog, track_count, fans, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'seed', ?)
        ON CONFLICT(id) DO UPDATE SET artist_id = excluded.artist_id, title = excluded.title, year = excluded.year, genre = excluded.genre,
          art = excluded.art, catalog = excluded.catalog, track_count = excluded.track_count`);
      // Le numéro d'un album de base peut être pris par un autre album (importé avant que la graine ne grandisse,
      // ou graine réordonnée) : cet album-là part dans la plage des albums importés.
      const holder = q('SELECT id FROM cat_albums WHERE catalog = ? AND id != ?');
      const renumber = q('UPDATE cat_albums SET catalog = ? WHERE id = ?');
      ALBUMS.forEach((a, i) => {
        const taken = holder.get(i + 1, a.id);
        if (taken) renumber.run(nextCatalogNumber(), taken.id);
        album.run(a.id, a.artist, a.title, a.year, a.genre, JSON.stringify(a.art), i + 1, a.tracks.length, now());
      });
      const track = q(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, feat, year, genre, pop, rarity, promo_kind, context, art, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed', ?)
        ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, album_id = excluded.album_id, artist_id = excluded.artist_id, n = excluded.n,
          total = excluded.total, title = excluded.title, feat = excluded.feat, year = excluded.year, genre = excluded.genre, pop = excluded.pop,
          rarity = excluded.rarity, promo_kind = excluded.promo_kind, context = excluded.context, art = excluded.art`);
      for (const t of TRACKS) {
        track.run(t.id, t.kind, t.albumId, t.artistId, t.n, t.total, t.title, t.feat, t.year, t.genre, t.pop, t.rarity,
          t.promoKind || null, t.context || null, t.art ? JSON.stringify(t.art) : null, now());
      }
      // Albums de la graine dans la recherche (titres corrigés dans shared/catalog.js compris).
      for (const a of ALBUMS) indexRow(db, 'album', a.id);
      refreshCounts();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Nombre de cartes et d'albums de chaque artiste (« Maître d'un artiste »), numéros des promos ; sans les archivés. */
  function refreshCounts() {
    db.exec(`UPDATE cat_artists SET track_count = (SELECT COUNT(*) FROM cat_tracks t WHERE t.artist_id = cat_artists.id AND t.status = 'active'),
      album_count = (SELECT COUNT(*) FROM cat_albums al WHERE al.artist_id = cat_artists.id AND al.status = 'active')`);
    const promoTotal = q("SELECT COUNT(*) AS n FROM cat_tracks WHERE kind = 'promo'").get().n;
    db.exec(`UPDATE cat_tracks SET total = ${promoTotal} WHERE kind = 'promo'`);
  }

  // ---------- lecture -----------------------------------------------------------------

  const TRACK_SQL = `SELECT t.*, ar.name AS artist_name, ar.country AS artist_country, al.title AS album_title, al.art AS album_art,
      al.catalog AS album_catalog, al.cover AS album_cover, al.cover_w AS album_cover_w, al.thumb AS album_thumb, al.thumb_w AS album_thumb_w,
      al.url AS album_url, al.status AS album_status
    FROM cat_tracks t JOIN cat_artists ar ON ar.id = t.artist_id LEFT JOIN cat_albums al ON al.id = t.album_id`;
  const ALBUM_SQL = `SELECT al.*, ar.name AS artist_name, ar.country AS artist_country FROM cat_albums al JOIN cat_artists ar ON ar.id = al.artist_id`;

  /** Visuel d'une carte ou d'un album : palette et motif générés, plus la vraie pochette importée si elle existe. */
  function artOf(seedId, artJson, cover) {
    const art = { ...(parse(artJson) || generatedArt(seedId)), seed: seedId };
    if (cover?.cover && covers()) {
      Object.assign(art, { cover: cover.cover, coverW: cover.coverW || 1000, thumb: cover.thumb || cover.cover, thumbW: cover.thumbW || 500, provider: 'deezer' });
    }
    return art;
  }

  function trackView(r) {
    if (!r) return null;
    const promo = r.kind === 'promo';
    const art = promo
      ? artOf(r.id, r.art, { cover: r.cover, thumb: r.thumb })
      : artOf(r.album_id, r.album_art, { cover: r.album_cover, coverW: r.album_cover_w, thumb: r.album_thumb, thumbW: r.album_thumb_w });
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      feat: r.feat,
      pop: r.pop,
      rarity: r.rarity,
      albumId: r.album_id,
      artistId: r.artist_id,
      artist: r.artist_name,
      country: r.artist_country || null,
      album: r.album_title || null,
      n: r.n,
      total: r.total,
      year: r.year,
      genre: r.genre,
      promoKind: r.promo_kind,
      context: r.context,
      code: promo ? codeFor('promo', r.n) : codeFor('album', r.album_catalog),
      art,
      url: r.url || null,
      // Archivé (P2-C) : plus tiré ni proposé, mais toujours dans les collections.
      archived: r.status === 'withdrawn' || r.album_status === 'withdrawn' || undefined,
    };
  }

  function albumView(r) {
    if (!r) return null;
    return {
      id: r.id,
      title: r.title,
      artistId: r.artist_id,
      artist: r.artist_name,
      country: r.artist_country || null,
      year: r.year,
      genre: r.genre,
      trackCount: r.track_count,
      code: codeFor('album', r.catalog),
      art: artOf(r.id, r.art, { cover: r.cover, coverW: r.cover_w, thumb: r.thumb, thumbW: r.thumb_w }),
      url: r.url || null,
      source: r.source,
      archived: r.status === 'withdrawn' || undefined,
    };
  }

  function artistView(r) {
    if (!r) return null;
    return {
      id: r.id, name: r.name, country: r.country || null, genre: r.genre, albumCount: r.album_count, trackCount: r.track_count, source: r.source,
      archived: r.status === 'withdrawn' || undefined,
    };
  }

  const track = (id) => (typeof id === 'string' ? trackView(q(`${TRACK_SQL} WHERE t.id = ?`).get(id)) : null);
  const album = (id) => (typeof id === 'string' ? albumView(q(`${ALBUM_SQL} WHERE al.id = ?`).get(id)) : null);
  const artist = (id) => (typeof id === 'string' ? artistView(q('SELECT * FROM cat_artists WHERE id = ?').get(id)) : null);

  function tracks(ids) {
    const list = [...new Set((ids || []).filter((x) => typeof x === 'string'))].slice(0, 500);
    if (!list.length) return [];
    return q(`${TRACK_SQL} WHERE t.id IN (SELECT value FROM json_each(?))`).all(json(list)).map(trackView);
  }

  // Un album (même archivé) garde tous ses morceaux : sa page et la collection de ses joueurs restent entières.
  const albumTracks = (albumId) => q(`${TRACK_SQL} WHERE t.album_id = ? ORDER BY t.n`).all(albumId).map(trackView);
  const albumTrackIds = (albumId) => q('SELECT id FROM cat_tracks WHERE album_id = ? ORDER BY n').all(albumId).map((r) => r.id);
  // La page d'un artiste et la maîtrise d'un artiste ne comptent que ce qui est encore au catalogue.
  const artistAlbums = (artistId) => q(`${ALBUM_SQL} WHERE al.artist_id = ? AND al.status = 'active' ORDER BY al.year, al.title`).all(artistId).map(albumView);
  const artistTracks = (artistId) => q(`${TRACK_SQL} WHERE t.artist_id = ? AND t.status = 'active' ORDER BY t.album_id, t.n`).all(artistId).map(trackView);
  const artistTrackIds = (artistId) => q("SELECT id FROM cat_tracks WHERE artist_id = ? AND status = 'active'").all(artistId).map((r) => r.id);

  // ---------- index en mémoire pour les tirages ------------------------------------------
  //
  // Index compact (PLAN.md 7.3 : moins de 30 Mo pour 240 000 morceaux) : un seul tableau des identifiants, et pour
  // chaque groupe (rareté, genre × rareté, décennie × rareté, genre × décennie × rareté, promos d'un artiste) la liste
  // des positions dans ce tableau en Int32Array ; popularité et genre de chaque morceau en tableaux typés (blind test).
  // Seuls les morceaux actifs y sont (les archivés ne sortent plus des boosters).

  let index = null;
  function rebuildIndex() {
    const ids = [];
    const popOf = [];
    const genreOf = [];
    const genreNames = [];
    const genreCode = new Map();
    const buckets = new Map(); // clé → positions (tableau ordinaire le temps de la construction)
    const promoByArtist = new Map();
    const rarityCount = Object.fromEntries(RARITIES.map((r) => [r, 0]));
    const push = (map, k, i) => {
      const list = map.get(k);
      if (list) list.push(i);
      else map.set(k, [i]);
    };
    for (const r of q("SELECT id, rarity, genre, pop, year, artist_id, kind FROM cat_tracks WHERE status = 'active'").iterate()) {
      const i = ids.length;
      ids.push(r.id);
      popOf.push(r.pop);
      let g = genreCode.get(r.genre);
      if (g === undefined) {
        g = genreNames.length;
        genreNames.push(r.genre);
        genreCode.set(r.genre, g);
      }
      genreOf.push(g);
      if (r.rarity in rarityCount) rarityCount[r.rarity] += 1;
      push(buckets, `r|${r.rarity}`, i);
      push(buckets, `g|${r.genre}|${r.rarity}`, i);
      if (r.year) {
        const d = decadeOf(r.year);
        push(buckets, `d|${d}|${r.rarity}`, i);
        push(buckets, `gd|${r.genre}|${d}|${r.rarity}`, i);
      }
      if (r.kind === 'promo') push(promoByArtist, r.artist_id, i);
    }
    const compact = (map) => new Map([...map].map(([k, list]) => [k, Int32Array.from(list)]));
    index = {
      ids,
      pop: Uint8Array.from(popOf, (p) => Math.max(0, Math.min(255, p | 0))),
      genre: Uint16Array.from(genreOf),
      genreCode,
      buckets: compact(buckets),
      promoByArtist: compact(promoByArtist),
      rarityCount,
      // `known` : positions « genre + popularité minimale » du blind test, calculées à la demande puis gardées.
      known: new Map(),
    };
    focusPools = new WeakMap();
    cachedTotals = null;
    aggregates = {};
    totalsCache.clear();
  }
  const ensureIndex = () => index || (rebuildIndex(), index);

  // Cartes des albums commencés par rareté, calculées une fois par booster (la même liste d'albums sert à chaque emplacement).
  let focusPools = new WeakMap();
  function focusPool(albumIds) {
    let pool = focusPools.get(albumIds);
    if (!pool) {
      pool = new Map();
      // Une seule requête par booster, par l'index des albums (quelques milliers de lignes au plus).
      for (const r of q("SELECT id, rarity FROM cat_tracks WHERE album_id IN (SELECT value FROM json_each(?)) AND status = 'active'").all(json(albumIds.slice(0, 2000)))) {
        if (!pool.has(r.rarity)) pool.set(r.rarity, []);
        pool.get(r.rarity).push(r.id);
      }
      focusPools.set(albumIds, pool);
    }
    return pool;
  }

  /** Un identifiant au hasard d'une liste (tableau d'identifiants, ou positions dans l'index), hors `exclude`. */
  function pickFrom(list, rng, exclude, idOf = (x) => x) {
    if (!list?.length) return null;
    for (let tries = 0; tries < 12; tries++) {
      const id = idOf(list[Math.floor(rng() * list.length)]);
      if (!exclude?.has(id)) return id;
    }
    for (let k = 0; k < list.length; k++) {
      const id = idOf(list[k]);
      if (!exclude?.has(id)) return id;
    }
    return null;
  }

  /**
   * Une carte au hasard d'une rareté donnée, dans tout le catalogue, un genre, une décennie (ou les deux), une liste
   * d'albums ou les promos de certains artistes (`artistIds`, rareté promo seulement). `exclude` (objet avec has())
   * écarte des cartes : celles déjà tirées dans ce booster, celles que le joueur possède déjà…
   */
  function randomTrack({ rarity, genre, decade, albumIds, artistIds, exclude } = {}, rng = Math.random) {
    const ix = ensureIndex();
    const at = (i) => ix.ids[i];
    let id = null;
    if (albumIds?.length) {
      id = pickFrom(focusPool(albumIds).get(rarity), rng, exclude);
    } else if (artistIds?.length) {
      if (rarity !== 'promo') return null;
      const pool = [];
      for (const a of artistIds.slice(0, 5000)) {
        const list = ix.promoByArtist.get(a);
        if (list) for (const i of list) pool.push(i);
      }
      id = pickFrom(pool, rng, exclude, at);
    } else if (genre && decade != null) {
      id = pickFrom(ix.buckets.get(`gd|${genre}|${decade}|${rarity}`), rng, exclude, at);
    } else if (decade != null) {
      id = pickFrom(ix.buckets.get(`d|${decade}|${rarity}`), rng, exclude, at);
    } else if (genre) {
      id = pickFrom(ix.buckets.get(`g|${genre}|${rarity}`), rng, exclude, at);
    } else {
      id = pickFrom(ix.buckets.get(`r|${rarity}`), rng, exclude, at);
    }
    return id ? track(id) : null;
  }

  /** Artistes qui ont au moins une promo (ciblage de l'emplacement promo). */
  function promoArtists() {
    return [...ensureIndex().promoByArtist.keys()];
  }

  /** Morceaux connus au hasard (blind test) : au-dessus d'un indice de popularité, éventuellement d'un genre. */
  function randomTracks({ genre, minPop = 0, count = 5, exclude } = {}, rng = Math.random) {
    const ix = ensureIndex();
    const g = genre && genre !== 'all' ? genre : null;
    const key = `${g}|${minPop}`;
    let list = ix.known.get(key);
    if (!list) {
      const code = g == null ? -1 : ix.genreCode.get(g) ?? -2;
      const picked = [];
      for (let i = 0; i < ix.ids.length; i++) if (ix.pop[i] >= minPop && (code === -1 || ix.genre[i] === code)) picked.push(i);
      list = Int32Array.from(picked);
      ix.known.set(key, list);
    }
    const seen = new Set();
    const out = [];
    for (let tries = 0; out.length < count && seen.size < list.length && tries < count * 20; tries++) {
      const k = list[Math.floor(rng() * list.length)];
      if (seen.has(k)) continue;
      seen.add(k);
      if (!exclude?.has(ix.ids[k])) out.push(ix.ids[k]);
    }
    // Liste presque épuisée (petit genre) : on complète dans l'ordre.
    for (let j = 0; j < list.length && out.length < count; j++) {
      const k = list[j];
      if (!seen.has(k) && !exclude?.has(ix.ids[k])) {
        seen.add(k);
        out.push(ix.ids[k]);
      }
    }
    return tracks(out);
  }

  // ---------- totaux, genres -----------------------------------------------------------------

  let cachedTotals = null;
  /** Totaux du catalogue actif (les archivés n'y comptent plus) : morceaux par rareté lus dans l'index des tirages. */
  function totals() {
    if (cachedTotals) return cachedTotals;
    const ix = ensureIndex();
    const rarity = { ...ix.rarityCount };
    cachedTotals = {
      tracks: ix.ids.length,
      albums: q("SELECT COUNT(*) AS n FROM cat_albums WHERE status = 'active'").get().n,
      artists: q("SELECT COUNT(*) AS n FROM cat_artists WHERE track_count > 0 AND status = 'active'").get().n,
      promos: rarity.promo,
      rarity,
      imported: q("SELECT COUNT(*) AS n FROM cat_albums WHERE source = 'deezer' AND status = 'active'").get().n,
    };
    return cachedTotals;
  }
  const rarityTotals = () => totals().rarity;

  // Agrégats du catalogue (genres, décennies, totaux par groupe) : recalculés seulement après un import.
  let aggregates = {};
  const cached = (key, fn) => (aggregates[key] ??= fn());

  const genres = () => cached('genres', () => {
    const ix = ensureIndex();
    const tracksBy = new Map();
    for (let i = 0; i < ix.genre.length; i++) {
      const code = ix.genre[i];
      tracksBy.set(code, (tracksBy.get(code) || 0) + 1);
    }
    return q("SELECT genre AS id, COUNT(*) AS albums FROM cat_albums WHERE genre IS NOT NULL AND status = 'active' GROUP BY genre ORDER BY albums DESC").all()
      .map((r) => ({ id: r.id, albums: r.albums, tracks: tracksBy.get(ix.genreCode.get(r.id)) || 0 }));
  });
  const decades = () => cached('decades', () => q(`SELECT (year / 10) * 10 AS decade, COUNT(*) AS albums FROM cat_albums
    WHERE year IS NOT NULL AND status = 'active' GROUP BY decade ORDER BY decade`).all().map((r) => ({ decade: r.decade, albums: r.albums })));

  // ---------- navigation dans les albums ---------------------------------------------------------

  /**
   * Corps FTS5 d'un texte cherché dans l'index de la recherche globale (chaque mot est un préfixe d'un mot du nom ou
   * du contexte de l'album : artiste, année). null si rien de cherchable.
   */
  function textBody(text) {
    const tokens = tokensOf(normalize(String(text ?? '').slice(0, 200)));
    return tokens.length ? `k:kalbum AND {name context}: (${ftsBody(tokens)})` : null;
  }

  /**
   * Albums dont le titre, l'artiste ou l'année commencent comme les mots de `text` (index search_fts), les plus
   * populaires d'abord (TEXT_CAP au plus). null si rien de cherchable. Le module search en fait autant, avec en plus
   * son dictionnaire des mots et les fautes de frappe (services.browseAlbums passe alors `albumIds`).
   */
  function matchAlbums(text, cap = TEXT_CAP) {
    const body = textBody(text);
    if (!body) return null;
    return q(`SELECT d.ref_id AS id FROM (SELECT rowid AS rid FROM search_fts WHERE search_fts MATCH ? LIMIT ?) m
      JOIN search_docs d ON d.id = m.rid WHERE d.kind = 'album'`).all(body, cap).map((r) => r.id);
  }

  // Albums de la graine (en tête du tri « populaires ») : lus une fois, la graine ne change qu'au démarrage.
  let seedAlbumIds = [];
  const loadSeedIds = () => {
    seedAlbumIds = q("SELECT id FROM cat_albums WHERE source = 'seed' ORDER BY catalog").all().map((r) => r.id);
  };

  // Tris : expression ORDER BY (servie par un index de cat_albums pour la navigation sans filtre), valeurs du curseur
  // lues sur la ligne, et condition « après le curseur » (valeurs dans l'ordre de `key`).
  const TITLE = 'al.title COLLATE NOCASE';
  // Part des cartes possédées d'un album commencé (0 pour un album sans morceau).
  const RATIO = 'COALESCE(CAST(p.owned AS REAL) / NULLIF(al.track_count, 0), 0)';
  const ORDERS = {
    fans: {
      order: `al.fans DESC, ${TITLE}, al.rowid`,
      key: (r) => [r.fans, r.title, r.rid],
      // al.fans <= ? redit la borne pour que l'index des fans serve de point de départ.
      after: () => `al.fans <= ? AND (al.fans < ? OR (${TITLE}, al.rowid) > (?, ?))`,
      args: ([f, t, rid]) => [f, f, t, rid],
    },
    title: {
      order: `${TITLE}, al.rowid`,
      key: (r) => [r.title, r.rid],
      after: () => `(${TITLE}, al.rowid) > (?, ?)`,
      args: (k) => k,
    },
    recent: {
      order: 'al.created_at DESC, al.rowid DESC',
      key: (r) => [r.created_at, r.rid],
      after: () => '(al.created_at, al.rowid) < (?, ?)',
      args: (k) => k,
    },
    year: {
      // Albums datés (les années inconnues forment le segment suivant, par titre).
      order: `al.year DESC, ${TITLE}, al.rowid`,
      key: (r) => [r.year, r.title, r.rid],
      after: () => `al.year <= ? AND (al.year < ? OR (${TITLE}, al.rowid) > (?, ?))`,
      args: ([y, t, rid]) => [y, y, t, rid],
    },
    started: {
      // Albums commencés : les plus avancés d'abord (part des cartes, cartes, fans).
      order: `ratio DESC, p.owned DESC, al.fans DESC, al.rowid`,
      key: (r) => [r.ratio, r.owned, r.fans, r.rid],
      after: () => `(-${RATIO}, -p.owned, -al.fans, al.rowid) > (?, ?, ?, ?)`,
      args: ([ratio, owned, fans, rid]) => [-ratio, -owned, -fans, rid],
    },
  };
  const NOT_STARTED = 'NOT EXISTS (SELECT 1 FROM user_album_progress x WHERE x.user_id = :uid AND x.album_id = al.id AND x.owned > 0)';

  /**
   * Segments d'un tri, lus l'un après l'autre : « populaires » = albums de la graine puis albums importés par fans ;
   * « progression » = albums commencés (user_album_progress) puis les autres par fans ; « année » = albums datés puis
   * les autres par titre ; un seul segment sinon.
   * `mine` : seulement les albums commencés.
   */
  function segmentsOf(sort, mine) {
    if (sort === 'progress') return mine ? [{ from: 'progress', order: 'started' }] : [{ from: 'progress', order: 'started' }, { where: NOT_STARTED, order: 'fans' }];
    if (sort === 'popular') return [{ seeds: true, where: "al.source = 'seed'", order: 'fans' }, { where: "al.source <> 'seed'", order: 'fans' }];
    // Années inconnues en dernier, comme ORDER BY year DESC.
    if (sort === 'year') return [{ where: 'al.year IS NOT NULL', order: 'year', large: true }, { where: 'al.year IS NULL', order: 'title' }];
    return [{ order: ORDERS[sort] ? sort : 'fans' }];
  }

  const SELECT_ALBUM = `al.*, al.rowid AS rid, ar.name AS artist_name, ar.country AS artist_country`;

  /**
   * Requête d'un segment : `from` désigne la table de départ (les albums par leur index, une liste d'identifiants,
   * ou la progression du joueur), `filters` les conditions communes (déjà paramétrées par nom).
   */
  function segmentSql(seg, { filters, ids, mine, count = false }) {
    let from;
    let ratio = '0 AS ratio';
    const where = [...filters];
    if (seg.from === 'progress' || mine) {
      // Albums commencés du joueur (clé primaire de user_album_progress), quelques milliers au plus.
      from = `user_album_progress p CROSS JOIN cat_albums al ON al.id = p.album_id`;
      where.unshift('p.user_id = :uid AND p.owned > 0');
      if (ids) where.push('al.id IN (SELECT value FROM json_each(:ids))');
      ratio = `${RATIO} AS ratio`;
    } else if (ids) {
      from = `json_each(:ids) j CROSS JOIN cat_albums al ON al.id = j.value
        LEFT JOIN user_album_progress p ON p.user_id = :uid AND p.album_id = al.id`;
    } else {
      from = `cat_albums al LEFT JOIN user_album_progress p ON p.user_id = :uid AND p.album_id = al.id`;
    }
    if (seg.where) where.push(seg.where);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    if (count) return `SELECT COUNT(*) AS n FROM ${from} ${whereSql}`;
    return { from, whereSql, ratio };
  }

  // Nombre d'albums d'un filtre : gardé 30 s (une page suivante ne recompte pas), oublié à chaque changement du catalogue.
  const totalsCache = new Map();
  function countOf(key, sql, params) {
    const hit = totalsCache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.n;
    const n = q(sql).get(params).n;
    if (totalsCache.size > 2000) totalsCache.clear();
    totalsCache.set(key, { n, at: Date.now() });
    return n;
  }

  /**
   * Albums du catalogue, filtrés et paginés, avec la progression du joueur (cartes possédées par album, lues dans
   * user_album_progress). sort : popular (par défaut), progress, title, year, recent.
   * Filtres : `q` (texte, cherché dans search_fts) ou `albumIds` (liste déjà trouvée par le module search), genre,
   * décennie, artiste, `mine` (albums commencés). Pages : `cursor` (tableau décodé, keyset sur les index), sinon
   * `offset` (compatibilité). Renvoie { total, items, nextCursor } ; nextCursor est un tableau (encodé par l'appelant).
   */
  function searchAlbums({ q: text, albumIds = null, genre, decade, artistId, sort = 'popular', mine = false, cursor = null, offset = 0, limit = 48, userId = null } = {}) {
    let ids = albumIds;
    if (!ids && String(text ?? '').trim()) {
      // Une recherche sans rien de cherchable (« !!! », des emojis) ne trouve rien, plutôt que tout le catalogue.
      ids = matchAlbums(text);
      if (!ids) return { total: 0, items: [] };
    }
    if (ids && !ids.length) return { total: 0, items: [] };
    const params = { uid: userId ?? -1 };
    const filters = ["al.status = 'active'"];
    if (ids) params.ids = json(ids.slice(0, TEXT_CAP));
    if (genre) {
      filters.push('al.genre = :genre');
      params.genre = genre;
    }
    if (decade != null && decade !== '') {
      filters.push('al.year >= :y0 AND al.year < :y1');
      params.y0 = Number(decade);
      params.y1 = Number(decade) + 10;
    }
    if (artistId) {
      filters.push('al.artist_id = :artist');
      params.artist = artistId;
    }
    const kind = BROWSE_SORTS.includes(sort) ? sort : 'popular';
    const segments = segmentsOf(kind, mine);
    const lim = clampInt(limit, 1, 100, 48);
    const ctx = { filters, ids: !!ids, mine };

    // Total : tous les albums du filtre (les segments d'un tri se partagent le catalogue). Seuls les filtres du
    // catalogue (genre, décennie, artiste) sont gardés : un texte ou « mes albums » se recomptent (quelques ms, et la
    // collection du joueur change à chaque booster).
    const plain = !ids && !genre && (decade == null || decade === '') && !artistId && !mine;
    const countSql = segmentSql({}, { ...ctx, count: true });
    const total = plain ? totals().albums
      : ids || mine ? q(countSql).get(params).n
        : countOf(JSON.stringify([genre, decade, artistId]), countSql, params);

    // Position de départ : segment et clés du curseur, ou décalage à sauter segment par segment.
    let segIndex = 0;
    let keys = null;
    let skip = 0;
    if (cursor) {
      if (!Array.isArray(cursor) || !Number.isInteger(cursor[0]) || cursor[0] < 0 || cursor[0] >= segments.length) throw new BadCursor();
      segIndex = cursor[0];
      keys = cursor.slice(1);
      const order = ORDERS[segments[segIndex].order];
      if (keys.length !== order.key({}).length || keys.some((k) => k !== null && typeof k !== 'string' && !Number.isFinite(k))) throw new BadCursor();
    } else {
      skip = clampInt(offset, 0, 1_000_000, 0);
    }

    const items = [];
    for (let s = segIndex; s < segments.length && items.length <= lim; s++) {
      const seg = segments[s];
      const order = ORDERS[seg.order];
      // Albums de la graine : lus par leur liste (une vingtaine), jamais en parcourant l'index jusqu'aux albums sans fans.
      let segIds = null;
      if (seg.seeds) {
        segIds = ids ? ids.filter((id) => seedAlbumIds.includes(id)) : seedAlbumIds;
        if (!segIds.length) continue;
      }
      const segParams = segIds ? { ...params, ids: json(segIds) } : params;
      const segCtx = segIds ? { ...ctx, ids: true } : ctx;
      // Décalage plus grand que tout le segment (sauf le dernier) : on le saute en le comptant. Un grand segment
      // (albums datés) se compte par différence avec le total, sans le parcourir.
      if (skip > 0 && s < segments.length - 1) {
        const countSeg = (other) => q(segmentSql(other, { ...ctx, count: true })).get(params).n;
        const n = seg.large ? total - segments.filter((o) => o !== seg).reduce((sum, o) => sum + countSeg(o), 0)
          : q(segmentSql(seg, { ...segCtx, count: true })).get(segParams).n;
        if (skip >= n) {
          skip -= n;
          continue;
        }
      }
      const { from, whereSql, ratio } = segmentSql(seg, segCtx);
      const after = s === segIndex && keys ? order.after(keys) : null;
      const afterArgs = after ? order.args(keys) : [];
      const sql = `SELECT ${SELECT_ALBUM}, COALESCE(p.owned, 0) AS owned, ${ratio}
        FROM ${from} JOIN cat_artists ar ON ar.id = al.artist_id
        ${whereSql}${after ? `${whereSql ? ' AND' : ' WHERE'} ${after}` : ''}
        ORDER BY ${order.order} LIMIT :lim OFFSET :off`;
      // Filtres en paramètres nommés, valeurs du curseur en paramètres anonymes (les ? de la condition).
      const rows = q(sql).all({ ...segParams, lim: lim + 1 - items.length, off: skip }, ...afterArgs);
      skip = 0;
      for (const r of rows) items.push({ row: r, seg: s, key: order.key(r) });
    }
    const page = items.slice(0, lim);
    const last = page[page.length - 1];
    return {
      total,
      items: page.map(({ row }) => ({ ...albumView(row), owned: row.owned })),
      nextCursor: items.length > lim && last ? [last.seg, ...last.key] : null,
    };
  }

  /** Singles hors album (cartes promo) encore au catalogue, paginés. */
  function promos({ offset = 0, limit = 60 } = {}) {
    const rows = q(`${TRACK_SQL} WHERE t.kind = 'promo' AND t.status = 'active' ORDER BY t.n LIMIT ? OFFSET ?`)
      .all(clampInt(limit, 1, 200, 60), clampInt(offset, 0, 1_000_000, 0));
    return { total: totals().promos, items: rows.map(trackView) };
  }

  // Collection en dessous de laquelle le filtre texte cherche chaque carte dans l'index (au-delà : un croisement).
  const SMALL_COLLECTION = 1500;
  // Ordre des cartes d'un joueur : les plus rares d'abord, puis les plus populaires.
  const RARITY_RANK = `CASE t.rarity WHEN 'promo' THEN 7 WHEN 'legendary' THEN 6 WHEN 'ultra' THEN 5 WHEN 'super' THEN 4
    WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 2 ELSE 1 END DESC, t.pop DESC`;

  /**
   * Conditions du filtre des cartes d'un joueur : `trackIds` (morceaux déjà trouvés), `match` (expression FTS5 de
   * l'index de la recherche, croisée en SQL avec ses cartes : exact, sans liste plafonnée), sinon le texte `q`
   * comparé sans accents ni casse au titre, à l'artiste et à l'album (catalogue seul, sans module de recherche).
   */
  function ownedFilter(userId, { q: text, trackIds = null, match = null, rarity }) {
    const where = ['c.user_id = ?'];
    const args = [userId];
    let joins = '';
    if (trackIds) {
      where.push('c.track_id IN (SELECT value FROM json_each(?))');
      args.push(json(trackIds));
    } else if (match) {
      // Document de la recherche de chaque carte, puis : petite collection, une recherche dans l'index par carte ;
      // grande collection, l'ensemble des morceaux trouvés croisé avec ses cartes (moins cher au-delà).
      const cards = q('SELECT unique_cards AS n FROM users WHERE id = ?').get(userId)?.n ?? 0;
      joins = "JOIN search_docs d ON d.kind = 'track' AND d.ref_id = c.track_id";
      where.push(cards <= SMALL_COLLECTION
        ? 'EXISTS (SELECT 1 FROM search_fts f WHERE f.search_fts MATCH ? AND f.rowid = d.id)'
        : 'd.id IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?)');
      args.push(match);
    } else {
      const words = foldText(text).trim().split(/\s+/).filter(Boolean).slice(0, 6);
      for (const w of words) {
        where.push("(fold(t.title) LIKE ? ESCAPE '\\' OR fold(ar.name) LIKE ? ESCAPE '\\' OR fold(COALESCE(al.title, '')) LIKE ? ESCAPE '\\')");
        const like = `%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
        args.push(like, like, like);
      }
      if (words.length) joins = 'JOIN cat_artists ar ON ar.id = t.artist_id LEFT JOIN cat_albums al ON al.id = t.album_id';
    }
    if (rarity) {
      where.push('t.rarity = ?');
      args.push(rarity);
    }
    const plain = where.length === 1;
    return { base: `FROM cards c JOIN cat_tracks t ON t.id = c.track_id ${joins} WHERE ${where.join(' AND ')}`, args, plain };
  }

  /** Cartes du joueur hydratées depuis leurs identifiants ordonnés ([[id, holo]]). */
  function ownedItems(order) {
    const byId = new Map(tracks(order.map((r) => r[0])).map((t) => [t.id, t]));
    return order.map(([id, holo]) => (byId.has(id) ? { ...byId.get(id), holo: !!holo } : null)).filter(Boolean);
  }

  /**
   * Toutes les cartes d'un joueur qui passent le filtre, dans l'ordre d'affichage : [[id, holo]] (une lecture, que
   * l'appelant peut garder pour les pages suivantes d'un même filtre).
   */
  function ownedOrder(userId, filter = {}) {
    const { base, args } = ownedFilter(userId, filter);
    return q(`SELECT c.track_id AS id, MAX(c.variant = 'holo') AS holo ${base} GROUP BY c.track_id ORDER BY ${RARITY_RANK}`)
      .all(...args).map((r) => [r.id, r.holo]);
  }

  /**
   * Cartes possédées par un joueur (choix pour le Studio, onglet Mes cartes), filtrables par texte et rareté, les
   * plus rares d'abord, paginées : { total, items }.
   */
  function ownedTracks(userId, { q: text, trackIds = null, match = null, rarity, offset = 0, limit = 60 } = {}) {
    const { base, args, plain } = ownedFilter(userId, { q: text, trackIds, match, rarity });
    const rows = q(`SELECT c.track_id AS id, MAX(c.variant = 'holo') AS holo ${base} GROUP BY c.track_id ORDER BY ${RARITY_RANK}
      LIMIT ? OFFSET ?`).all(...args, clampInt(limit, 1, 120, 60), clampInt(offset, 0, 1_000_000, 0));
    // Sans filtre : le nombre de morceaux distincts se lit dans la clé primaire des cartes, sans jointure.
    const total = plain ? q('SELECT COUNT(DISTINCT track_id) AS n FROM cards WHERE user_id = ?').get(userId).n
      : q(`SELECT COUNT(DISTINCT c.track_id) AS n ${base}`).get(...args).n;
    return { total, items: ownedItems(rows.map((r) => [r.id, r.holo])) };
  }

  // ---------- progression d'un joueur ------------------------------------------------------

  /**
   * Cartes d'un joueur avec la rareté et l'artiste de chaque morceau, dans l'ordre de la clé primaire (les versions
   * d'un même morceau se suivent, les morceaux d'un album aussi) : une seule lecture de sa collection, qui sert à la
   * fois à la liste des cartes de l'état complet et à ses statistiques (stats()). Chaque ligne est un tableau
   * [morceau, version, exemplaires, date, rareté, artiste] (ROW) : deux fois moins coûteux à lire que des objets
   * pour les 60 000 cartes d'un gros collectionneur.
   */
  let rowsStatement = null;
  function collectionRows(userId) {
    if (!rowsStatement) {
      rowsStatement = db.prepare(`SELECT c.track_id, c.variant, c.count, c.first_at, t.rarity, t.artist_id
        FROM cards c JOIN cat_tracks t ON t.id = c.track_id WHERE c.user_id = ? ORDER BY c.track_id`);
      // node:sqlite antérieur à 22.16 : pas de lignes en tableaux, on les convertit.
      if (typeof rowsStatement.setReturnArrays === 'function') rowsStatement.setReturnArrays(true);
      else rowsStatement.asObjects = true;
    }
    const rows = rowsStatement.all(userId);
    return rowsStatement.asObjects ? rows.map((r) => [r.track_id, r.variant, r.count, r.first_at, r.rarity, r.artist_id]) : rows;
  }

  /**
   * Statistiques de collection : cartes distinctes par rareté, progression par album et par artiste, albums complétés
   * et artistes maîtrisés, sans GROUP BY sur les cartes. Une lecture des cartes du joueur (`rows` : collectionRows,
   * si l'appelant l'a déjà faite) pour les raretés et les artistes ; la progression des albums vient de
   * user_album_progress (tenue à jour avec les cartes) ; les totaux, du catalogue.
   */
  function stats(userId, rows = collectionRows(userId)) {
    const t = totals();
    const byRarity = Object.fromEntries(RARITIES.map((r) => [r, { owned: 0, total: t.rarity[r] }]));
    const perArtist = new Map();
    // Lignes dans l'ordre des identifiants : un morceau (ses deux versions) d'affilée ; les morceaux d'un même artiste
    // le plus souvent aussi (comptés par séries avant d'aller dans la table).
    let prevTrack = null;
    let runArtist = null;
    let run = 0;
    for (const row of rows) {
      if (row[ROW.track] === prevTrack) continue;
      prevTrack = row[ROW.track];
      const rarity = byRarity[row[ROW.rarity]];
      if (rarity) rarity.owned += 1;
      if (row[ROW.artist] !== runArtist) {
        if (run) perArtist.set(runArtist, (perArtist.get(runArtist) || 0) + run);
        runArtist = row[ROW.artist];
        run = 0;
      }
      run += 1;
    }
    if (run) perArtist.set(runArtist, (perArtist.get(runArtist) || 0) + run);
    const unique = Object.values(byRarity).reduce((s, x) => s + x.owned, 0);
    const ratio = (owned, total) => ({ owned, total, pct: total ? owned / total : 0 });
    const albums = {};
    for (const r of q(`SELECT p.album_id, p.owned, al.track_count FROM user_album_progress p CROSS JOIN cat_albums al ON al.id = p.album_id
      WHERE p.user_id = ? AND p.owned > 0`).all(userId)) {
      albums[r.album_id] = ratio(r.owned, r.track_count);
    }
    const artists = {};
    if (perArtist.size) {
      for (const r of q('SELECT id, track_count FROM cat_artists WHERE id IN (SELECT value FROM json_each(?))').all(json([...perArtist.keys()]))) {
        artists[r.id] = ratio(perArtist.get(r.id), r.track_count);
      }
    }
    // Albums complétés et artistes maîtrisés : d'après les succès (jamais retirés), comme les vinyles et les badges
    // du profil. Un import qui ajoute des albums à un artiste de la graine ne lui retire pas sa maîtrise.
    const done = q(`SELECT
        (SELECT COUNT(*) FROM achievements a JOIN cat_albums al ON al.id = substr(a.key, 7) WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;') AS albums,
        (SELECT COUNT(*) FROM achievements a JOIN cat_artists ar ON ar.id = substr(a.key, 8) WHERE a.user_id = ? AND a.key >= 'artist:' AND a.key < 'artist;') AS artists`)
      .get(userId, userId);
    return {
      total: { owned: unique, total: t.tracks, pct: t.tracks ? unique / t.tracks : 0 },
      promos: { owned: byRarity.promo.owned, total: t.promos, pct: t.promos ? byRarity.promo.owned / t.promos : 0 },
      byRarity,
      albums,
      artists,
      albumsCompleted: done.albums,
      artistsMastered: done.artists,
      catalog: { albums: t.albums, artists: t.artists, tracks: t.tracks },
    };
  }

  /** Progression par genre ou par décennie (onglets de la collection). */
  function groupStats(userId, by) {
    const expr = by === 'decade' ? '(t.year / 10) * 10' : 't.genre';
    const totalsRows = cached(`group:${by}`, () => q(`SELECT ${expr} AS k, COUNT(*) AS total FROM cat_tracks t
      WHERE ${expr} IS NOT NULL AND t.status = 'active' GROUP BY k`).all());
    const owned = new Map(q(`SELECT ${expr} AS k, COUNT(DISTINCT c.track_id) AS owned FROM cards c JOIN cat_tracks t ON t.id = c.track_id
      WHERE c.user_id = ? GROUP BY k`).all(userId).map((r) => [r.k, r.owned]));
    return totalsRows.map((r) => ({ key: r.k, owned: owned.get(r.k) || 0, total: r.total, pct: r.total ? (owned.get(r.k) || 0) / r.total : 0 }))
      .sort((a, b) => (by === 'decade' ? a.key - b.key : b.total - a.total));
  }

  seed();
  loadSeedIds();
  rebuildIndex();

  return {
    track, tracks, album, artist, albumTracks, artistAlbums, artistTracks, albumTrackIds, artistTrackIds,
    randomTrack, randomTracks, promoArtists, totals, rarityTotals, genres, decades, searchAlbums, matchAlbums, promos, stats, groupStats,
    ownedTracks, ownedOrder, ownedItems, collectionRows, rebuildIndex, refreshCounts, indexAlbum, setIndexer, nextCatalogNumber, decadeOf,
    /** Taille de l'index des tirages (morceaux actifs), pour les mesures. */
    indexSize: () => ensureIndex().ids.length,
    invalidate() {
      cachedTotals = null;
      aggregates = {};
      totalsCache.clear();
    },
  };
}
