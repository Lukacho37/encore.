// Catalogue musical en base (SQLite) : la graine (20 albums choisis à la main, shared/catalog.js) plus les albums
// importés depuis Deezer (server/importer.js), jusqu'à 20 000 et plus.
//
// Toutes les fonctions sont synchrones (node:sqlite). Les objets renvoyés sont « autoportants » : une carte contient
// le nom de l'artiste, le titre de l'album, le visuel et le code catalogue, pour que le site puisse l'afficher sans
// autre requête. L'interface est la même que celle du catalogue statique de la démo (shared/staticCatalog.js).
import { config } from './config.js';
import { ARTISTS, ALBUMS, TRACKS, decadeOf } from '../shared/catalog.js';
import { RARITIES, foldText } from '../shared/rules.js';
import { generatedArt } from '../shared/art.js';

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

/** Entier borné reçu d'une requête (pagination) : SQLite refuse un LIMIT ou un OFFSET non entier. */
export function clampInt(raw, min, max, fallback) {
  return Math.min(max, Math.max(min, Math.floor(Number(raw) || fallback)));
}

/** Code catalogue façon maison de disques : AM-001 pour un album, AM-P03 pour une promo. */
export function codeFor(kind, number) {
  return kind === 'promo' ? `AM-P${pad(number)}` : `AM-${pad(number, 3)}`;
}

/**
 * `seedData` : la graine (par défaut celle de shared/catalog.js) ; les tests y ajoutent un album pour vérifier
 * qu'un nouvel album de base trouve sa place à côté des albums importés.
 */
export function createCatalog(db, { covers = () => config.covers !== 'off', seedData = { ARTISTS, ALBUMS, TRACKS } } = {}) {
  const q = (sql) => db.prepare(sql);
  const now = () => Date.now();

  // Texte replié (sans accents ni casse) pour la recherche dans ses cartes : fold(colonne) LIKE fold(mot).
  db.function('fold', { deterministic: true }, (s) => (s == null ? null : foldText(s)));

  /** Prochain numéro libre de la plage des albums importés (après 1000, réservés à la graine). */
  const nextCatalogNumber = () => Math.max(q('SELECT MAX(catalog) AS n FROM cat_albums').get().n || 0, SEED_CATALOG_MAX) + 1;

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
      for (const a of ALBUMS) indexAlbum(a.id);
      refreshCounts();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // L'index (unicode61) replie « é » en « e » mais pas les lettres sans décomposition (œ, ø, æ, ß, ł…) : on ajoute
  // au texte indexé sa forme repliée, pour que « coeur » trouve « Cœur » et « royksopp » trouve « Røyksopp ».
  const UNFOLDED = /[øæœßłđðþı]/;
  const searchText = (s) => (UNFOLDED.test(String(s).toLowerCase()) ? `${s} ${foldText(s)}` : s);

  function indexAlbum(albumId) {
    const row = q('SELECT al.title, ar.name FROM cat_albums al JOIN cat_artists ar ON ar.id = al.artist_id WHERE al.id = ?').get(albumId);
    if (!row) return;
    q('DELETE FROM cat_search WHERE album_id = ?').run(albumId);
    q('INSERT INTO cat_search (album_id, title, artist) VALUES (?, ?, ?)').run(albumId, searchText(row.title), searchText(row.name));
  }

  /** Une seule fois sur une base existante : réindexe les albums concernés par les lettres repliées à la main. */
  function upgradeSearchIndex() {
    if (q("SELECT 1 FROM kv WHERE key = 'searchFold'").get()) return;
    db.exec('BEGIN');
    try {
      for (const r of q('SELECT al.id, al.title, ar.name FROM cat_albums al JOIN cat_artists ar ON ar.id = al.artist_id').all()) {
        if (UNFOLDED.test(`${r.title} ${r.name}`.toLowerCase())) indexAlbum(r.id);
      }
      q("INSERT INTO kv (key, value) VALUES ('searchFold', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Nombre de cartes par artiste (pour « Maître d'un artiste ») et numéros des promos. */
  function refreshCounts() {
    db.exec(`UPDATE cat_artists SET track_count = (SELECT COUNT(*) FROM cat_tracks t WHERE t.artist_id = cat_artists.id),
      album_count = (SELECT COUNT(*) FROM cat_albums al WHERE al.artist_id = cat_artists.id)`);
    const promoTotal = q("SELECT COUNT(*) AS n FROM cat_tracks WHERE kind = 'promo'").get().n;
    db.exec(`UPDATE cat_tracks SET total = ${promoTotal} WHERE kind = 'promo'`);
  }

  // ---------- lecture -----------------------------------------------------------------

  const TRACK_SQL = `SELECT t.*, ar.name AS artist_name, ar.country AS artist_country, al.title AS album_title, al.art AS album_art,
      al.catalog AS album_catalog, al.cover AS album_cover, al.cover_w AS album_cover_w, al.thumb AS album_thumb, al.thumb_w AS album_thumb_w,
      al.url AS album_url
    FROM cat_tracks t JOIN cat_artists ar ON ar.id = t.artist_id LEFT JOIN cat_albums al ON al.id = t.album_id`;
  const ALBUM_SQL = `SELECT al.*, ar.name AS artist_name, ar.country AS artist_country FROM cat_albums al JOIN cat_artists ar ON ar.id = al.artist_id`;

  const stTrack = q(`${TRACK_SQL} WHERE t.id = ?`);
  const stAlbum = q(`${ALBUM_SQL} WHERE al.id = ?`);
  const stArtist = q('SELECT * FROM cat_artists WHERE id = ?');
  const stAlbumTracks = q(`${TRACK_SQL} WHERE t.album_id = ? ORDER BY t.n`);
  const stArtistAlbums = q(`${ALBUM_SQL} WHERE al.artist_id = ? ORDER BY al.year, al.title`);
  const stArtistTracks = q(`${TRACK_SQL} WHERE t.artist_id = ? ORDER BY t.album_id, t.n`);

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
    };
  }

  function artistView(r) {
    if (!r) return null;
    return { id: r.id, name: r.name, country: r.country || null, genre: r.genre, albumCount: r.album_count, trackCount: r.track_count, source: r.source };
  }

  const track = (id) => (typeof id === 'string' ? trackView(stTrack.get(id)) : null);
  const album = (id) => (typeof id === 'string' ? albumView(stAlbum.get(id)) : null);
  const artist = (id) => (typeof id === 'string' ? artistView(stArtist.get(id)) : null);

  function tracks(ids) {
    const list = [...new Set((ids || []).filter((x) => typeof x === 'string'))].slice(0, 500);
    if (!list.length) return [];
    return q(`${TRACK_SQL} WHERE t.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(list)).map(trackView);
  }

  const albumTracks = (albumId) => stAlbumTracks.all(albumId).map(trackView);
  const artistAlbums = (artistId) => stArtistAlbums.all(artistId).map(albumView);
  const artistTracks = (artistId) => stArtistTracks.all(artistId).map(trackView);
  const albumTrackIds = (albumId) => q('SELECT id FROM cat_tracks WHERE album_id = ? ORDER BY n').all(albumId).map((r) => r.id);
  const artistTrackIds = (artistId) => q('SELECT id FROM cat_tracks WHERE artist_id = ?').all(artistId).map((r) => r.id);

  // ---------- index en mémoire pour les tirages ------------------------------------------

  let index = null;
  function rebuildIndex() {
    const byRarity = new Map(RARITIES.map((r) => [r, []]));
    const byGenre = new Map();
    // Boosters thématiques (PLAN.md 6.10) : par décennie, et par genre × décennie ; promos par artiste (ciblage
    // de l'emplacement promo, PLAN.md 6.4).
    const byDecade = new Map();
    const byGenreDecade = new Map();
    const promoByArtist = new Map();
    const all = [];
    const push = (map, k, id) => {
      const list = map.get(k);
      if (list) list.push(id);
      else map.set(k, [id]);
    };
    for (const r of q('SELECT id, rarity, genre, pop, year, artist_id, kind FROM cat_tracks').iterate()) {
      byRarity.get(r.rarity)?.push(r.id);
      push(byGenre, `${r.genre}|${r.rarity}`, r.id);
      if (r.year) {
        const d = decadeOf(r.year);
        push(byDecade, `${d}|${r.rarity}`, r.id);
        push(byGenreDecade, `${r.genre}|${d}|${r.rarity}`, r.id);
      }
      if (r.kind === 'promo') push(promoByArtist, r.artist_id, r.id);
      all.push({ id: r.id, genre: r.genre, pop: r.pop });
    }
    // `known` : listes « genre + popularité minimale » du blind test, calculées à la demande puis gardées.
    index = { byRarity, byGenre, byDecade, byGenreDecade, promoByArtist, all, known: new Map() };
    focusPools = new WeakMap();
    cachedTotals = null;
    aggregates = {};
  }

  // Cartes des albums commencés par rareté, calculées une fois par booster (la même liste d'albums sert à chaque emplacement).
  let focusPools = new WeakMap();
  function focusPool(albumIds) {
    let pool = focusPools.get(albumIds);
    if (!pool) {
      pool = new Map();
      // Une seule requête par booster, par l'index des albums (quelques milliers de lignes au plus).
      for (const r of q('SELECT id, rarity FROM cat_tracks WHERE album_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(albumIds.slice(0, 2000)))) {
        if (!pool.has(r.rarity)) pool.set(r.rarity, []);
        pool.get(r.rarity).push(r.id);
      }
      focusPools.set(albumIds, pool);
    }
    return pool;
  }

  function pickFrom(list, rng, exclude) {
    if (!list?.length) return null;
    for (let tries = 0; tries < 12; tries++) {
      const id = list[Math.floor(rng() * list.length)];
      if (!exclude?.has(id)) return id;
    }
    return list.find((id) => !exclude?.has(id)) || null;
  }

  /**
   * Une carte au hasard d'une rareté donnée, dans tout le catalogue, un genre, une décennie (ou les deux), une liste
   * d'albums ou les promos de certains artistes (`artistIds`, rareté promo seulement). `exclude` (objet avec has())
   * écarte des cartes : celles déjà tirées dans ce booster, celles que le joueur possède déjà…
   */
  function randomTrack({ rarity, genre, decade, albumIds, artistIds, exclude } = {}, rng = Math.random) {
    if (!index) rebuildIndex();
    let id = null;
    if (albumIds?.length) {
      id = pickFrom(focusPool(albumIds).get(rarity), rng, exclude);
    } else if (artistIds?.length) {
      if (rarity !== 'promo') return null;
      const pool = [];
      for (const a of artistIds.slice(0, 5000)) {
        const list = index.promoByArtist.get(a);
        if (list) pool.push(...list);
      }
      id = pickFrom(pool, rng, exclude);
    } else if (genre && decade != null) {
      id = pickFrom(index.byGenreDecade.get(`${genre}|${decade}|${rarity}`), rng, exclude);
    } else if (decade != null) {
      id = pickFrom(index.byDecade.get(`${decade}|${rarity}`), rng, exclude);
    } else if (genre) {
      id = pickFrom(index.byGenre.get(`${genre}|${rarity}`), rng, exclude);
    } else {
      id = pickFrom(index.byRarity.get(rarity), rng, exclude);
    }
    return id ? track(id) : null;
  }

  /** Artistes qui ont au moins une promo (ciblage de l'emplacement promo). */
  function promoArtists() {
    if (!index) rebuildIndex();
    return [...index.promoByArtist.keys()];
  }

  /** Morceaux connus au hasard (blind test) : au-dessus d'un indice de popularité, éventuellement d'un genre. */
  function randomTracks({ genre, minPop = 0, count = 5, exclude } = {}, rng = Math.random) {
    if (!index) rebuildIndex();
    const g = genre && genre !== 'all' ? genre : null;
    const key = `${g}|${minPop}`;
    let ids = index.known.get(key);
    if (!ids) {
      ids = index.all.filter((t) => t.pop >= minPop && (!g || t.genre === g)).map((t) => t.id);
      index.known.set(key, ids);
    }
    const picked = new Set();
    const out = [];
    for (let tries = 0; out.length < count && picked.size < ids.length && tries < count * 20; tries++) {
      const id = ids[Math.floor(rng() * ids.length)];
      if (picked.has(id)) continue;
      picked.add(id);
      if (!exclude?.has(id)) out.push(id);
    }
    // Liste presque épuisée (petit genre) : on complète dans l'ordre.
    for (const id of ids) {
      if (out.length >= count) break;
      if (!picked.has(id) && !exclude?.has(id)) {
        picked.add(id);
        out.push(id);
      }
    }
    return tracks(out);
  }

  // ---------- totaux, genres, recherche ---------------------------------------------------

  let cachedTotals = null;
  function totals() {
    if (cachedTotals) return cachedTotals;
    const rarity = Object.fromEntries(RARITIES.map((r) => [r, 0]));
    for (const r of q('SELECT rarity, COUNT(*) AS n FROM cat_tracks GROUP BY rarity').all()) rarity[r.rarity] = r.n;
    cachedTotals = {
      tracks: q('SELECT COUNT(*) AS n FROM cat_tracks').get().n,
      albums: q('SELECT COUNT(*) AS n FROM cat_albums').get().n,
      artists: q('SELECT COUNT(*) AS n FROM cat_artists WHERE track_count > 0').get().n,
      promos: rarity.promo,
      rarity,
      imported: q("SELECT COUNT(*) AS n FROM cat_albums WHERE source = 'deezer'").get().n,
    };
    return cachedTotals;
  }
  const rarityTotals = () => totals().rarity;

  // Agrégats du catalogue (genres, décennies, totaux par groupe) : recalculés seulement après un import.
  let aggregates = {};
  const cached = (key, fn) => (aggregates[key] ??= fn());

  const genres = () => cached('genres', () => {
    const tracksBy = new Map(q('SELECT genre, COUNT(*) AS n FROM cat_tracks WHERE genre IS NOT NULL GROUP BY genre').all().map((r) => [r.genre, r.n]));
    return q('SELECT genre AS id, COUNT(*) AS albums FROM cat_albums WHERE genre IS NOT NULL GROUP BY genre ORDER BY albums DESC').all()
      .map((r) => ({ id: r.id, albums: r.albums, tracks: tracksBy.get(r.id) || 0 }));
  });
  const decades = () => cached('decades', () => q('SELECT (year / 10) * 10 AS decade, COUNT(*) AS albums FROM cat_albums WHERE year IS NOT NULL GROUP BY decade ORDER BY decade').all()
    .map((r) => ({ decade: r.decade, albums: r.albums })));

  /**
   * Texte de recherche plein texte : chaque mot devient un préfixe (« racine car » trouve « Racine carrée »).
   * Les lettres de toutes les écritures sont gardées (Кино, 宇多田, Røyksopp) ; l'index (unicode61) replie lui-même
   * les accents latins (« beyonce » trouve « Beyoncé »). Tout le reste, guillemets compris, devient une espace : la
   * syntaxe de MATCH ne peut pas être cassée. null si rien de cherchable.
   */
  function ftsQuery(text) {
    const words = String(text || '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
      .split(/\s+/).filter(Boolean).slice(0, 8);
    return words.length ? words.map((w) => `"${w}"*`).join(' ') : null;
  }

  /**
   * Albums du catalogue, filtrés et paginés, avec la progression du joueur (cartes possédées par album).
   * sort : popular (par défaut), progress, title, year, recent.
   */
  function searchAlbums({ q: text, genre, decade, artistId, sort = 'popular', mine = false, offset = 0, limit = 48, userId = null } = {}) {
    const where = [];
    const args = [];
    const fts = ftsQuery(text);
    // Une recherche sans rien de cherchable (« !!! », des emojis) ne trouve rien, plutôt que tout le catalogue.
    if (!fts && String(text || '').trim()) return { total: 0, items: [] };
    if (fts) {
      where.push('al.id IN (SELECT album_id FROM cat_search WHERE cat_search MATCH ?)');
      args.push(fts);
    }
    if (genre) {
      where.push('al.genre = ?');
      args.push(genre);
    }
    if (decade != null && decade !== '') {
      where.push('al.year >= ? AND al.year < ?');
      args.push(Number(decade), Number(decade) + 10);
    }
    if (artistId) {
      where.push('al.artist_id = ?');
      args.push(artistId);
    }
    const progress = `(SELECT t.album_id AS album_id, COUNT(DISTINCT c.track_id) AS owned FROM cards c JOIN cat_tracks t ON t.id = c.track_id
      WHERE c.user_id = ? AND t.album_id IS NOT NULL GROUP BY t.album_id)`;
    if (mine) where.push('COALESCE(p.owned, 0) > 0');
    const order = {
      progress: 'COALESCE(p.owned, 0) * 1.0 / al.track_count DESC, COALESCE(p.owned, 0) DESC, al.fans DESC',
      title: 'al.title COLLATE NOCASE',
      year: 'al.year DESC, al.title COLLATE NOCASE',
      recent: 'al.created_at DESC',
      popular: "CASE al.source WHEN 'seed' THEN 0 ELSE 1 END, al.fans DESC, al.title COLLATE NOCASE",
    }[sort] || 'al.fans DESC';
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const lim = clampInt(limit, 1, 100, 48);
    const off = clampInt(offset, 0, 1_000_000, 0);
    const rows = q(`SELECT al.*, ar.name AS artist_name, ar.country AS artist_country, COALESCE(p.owned, 0) AS owned
      FROM cat_albums al JOIN cat_artists ar ON ar.id = al.artist_id LEFT JOIN ${progress} p ON p.album_id = al.id
      ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(userId ?? -1, ...args, lim, off);
    const total = q(`SELECT COUNT(*) AS n FROM cat_albums al LEFT JOIN ${progress} p ON p.album_id = al.id ${whereSql}`).get(userId ?? -1, ...args).n;
    return { total, items: rows.map((r) => ({ ...albumView(r), owned: r.owned })) };
  }

  /** Singles hors album (cartes promo), paginés, avec ceux que le joueur possède. */
  function promos({ offset = 0, limit = 60 } = {}) {
    const rows = q(`${TRACK_SQL} WHERE t.kind = 'promo' ORDER BY t.n LIMIT ? OFFSET ?`).all(clampInt(limit, 1, 200, 60), clampInt(offset, 0, 1_000_000, 0));
    return { total: totals().promos, items: rows.map(trackView) };
  }

  /**
   * Cartes possédées par un joueur (choix pour le Studio), filtrables par texte et rareté, les plus rares d'abord.
   * Le texte est comparé sans accents ni casse, dans toutes les écritures (« fete » trouve « Ta fête »).
   */
  function ownedTracks(userId, { q: text, rarity, offset = 0, limit = 60 } = {}) {
    const where = ['c.user_id = ?'];
    const args = [userId];
    const words = foldText(text).trim().split(/\s+/).filter(Boolean).slice(0, 6);
    for (const w of words) {
      where.push("(fold(t.title) LIKE ? ESCAPE '\\' OR fold(ar.name) LIKE ? ESCAPE '\\' OR fold(COALESCE(al.title, '')) LIKE ? ESCAPE '\\')");
      const like = `%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      args.push(like, like, like);
    }
    if (rarity) {
      where.push('t.rarity = ?');
      args.push(rarity);
    }
    const base = `FROM cards c JOIN cat_tracks t ON t.id = c.track_id JOIN cat_artists ar ON ar.id = t.artist_id
      LEFT JOIN cat_albums al ON al.id = t.album_id WHERE ${where.join(' AND ')}`;
    const ids = q(`SELECT t.id, MAX(c.variant = 'holo') AS holo ${base} GROUP BY t.id
      ORDER BY CASE t.rarity WHEN 'promo' THEN 7 WHEN 'legendary' THEN 6 WHEN 'ultra' THEN 5 WHEN 'super' THEN 4 WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 2 ELSE 1 END DESC,
        t.pop DESC LIMIT ? OFFSET ?`).all(...args, clampInt(limit, 1, 120, 60), clampInt(offset, 0, 1_000_000, 0));
    const total = q(`SELECT COUNT(DISTINCT t.id) AS n ${base}`).get(...args).n;
    const holo = new Set(ids.filter((r) => r.holo).map((r) => r.id));
    const byId = new Map(tracks(ids.map((r) => r.id)).map((t) => [t.id, t]));
    return { total, items: ids.map((r) => byId.get(r.id)).filter(Boolean).map((t) => ({ ...t, holo: holo.has(t.id) })) };
  }

  // ---------- progression d'un joueur ------------------------------------------------------

  /** Statistiques de collection calculées en base : rien ne parcourt tout le catalogue côté navigateur. */
  function stats(userId) {
    const t = totals();
    const byRarity = Object.fromEntries(RARITIES.map((r) => [r, { owned: 0, total: t.rarity[r] }]));
    for (const r of q(`SELECT t.rarity, COUNT(DISTINCT c.track_id) AS n FROM cards c JOIN cat_tracks t ON t.id = c.track_id
      WHERE c.user_id = ? GROUP BY t.rarity`).all(userId)) {
      if (byRarity[r.rarity]) byRarity[r.rarity].owned = r.n;
    }
    const unique = Object.values(byRarity).reduce((s, x) => s + x.owned, 0);
    const albums = {};
    for (const r of q(`SELECT t.album_id, COUNT(DISTINCT c.track_id) AS owned, al.track_count AS total FROM cards c
      JOIN cat_tracks t ON t.id = c.track_id JOIN cat_albums al ON al.id = t.album_id
      WHERE c.user_id = ? GROUP BY t.album_id`).all(userId)) {
      albums[r.album_id] = { owned: r.owned, total: r.total, pct: r.total ? r.owned / r.total : 0 };
    }
    const artists = {};
    for (const r of q(`SELECT t.artist_id, COUNT(DISTINCT c.track_id) AS owned, ar.track_count AS total FROM cards c
      JOIN cat_tracks t ON t.id = c.track_id JOIN cat_artists ar ON ar.id = t.artist_id
      WHERE c.user_id = ? GROUP BY t.artist_id`).all(userId)) {
      artists[r.artist_id] = { owned: r.owned, total: r.total, pct: r.total ? r.owned / r.total : 0 };
    }
    // Albums complétés et artistes maîtrisés : d'après les succès (jamais retirés), comme les vinyles et les badges
    // du profil. Un import qui ajoute des albums à un artiste de la graine ne lui retire pas sa maîtrise.
    const done = q(`SELECT
        (SELECT COUNT(*) FROM achievements a JOIN cat_albums al ON al.id = substr(a.key, 7) WHERE a.user_id = ? AND a.key LIKE 'album:%') AS albums,
        (SELECT COUNT(*) FROM achievements a JOIN cat_artists ar ON ar.id = substr(a.key, 8) WHERE a.user_id = ? AND a.key LIKE 'artist:%') AS artists`)
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
    const totalsRows = cached(`group:${by}`, () => q(`SELECT ${expr} AS k, COUNT(*) AS total FROM cat_tracks t WHERE ${expr} IS NOT NULL GROUP BY k`).all());
    const owned = new Map(q(`SELECT ${expr} AS k, COUNT(DISTINCT c.track_id) AS owned FROM cards c JOIN cat_tracks t ON t.id = c.track_id
      WHERE c.user_id = ? GROUP BY k`).all(userId).map((r) => [r.k, r.owned]));
    return totalsRows.map((r) => ({ key: r.k, owned: owned.get(r.k) || 0, total: r.total, pct: r.total ? (owned.get(r.k) || 0) / r.total : 0 }))
      .sort((a, b) => (by === 'decade' ? a.key - b.key : b.total - a.total));
  }

  seed();
  upgradeSearchIndex();
  rebuildIndex();

  return {
    track, tracks, album, artist, albumTracks, artistAlbums, artistTracks, albumTrackIds, artistTrackIds,
    randomTrack, randomTracks, promoArtists, totals, rarityTotals, genres, decades, searchAlbums, promos, stats, groupStats, ownedTracks,
    rebuildIndex, refreshCounts, indexAlbum, nextCatalogNumber, decadeOf,
    invalidate() {
      cachedTotals = null;
      aggregates = {};
    },
  };
}
