// Import du grand catalogue depuis l'API publique de Deezer (sans clé), en tâche de fond et par reprise.
//
// 1. Découverte : classements et artistes de chaque grand genre (/chart/{genre}/artists, /genre/{genre}/artists).
// 2. Exploration, des artistes les plus suivis aux moins suivis : leurs albums studio (pas de live, de compilation
//    ni de rééditions en double), leurs artistes proches (/artist/{id}/related), et un single hors album par
//    artiste (carte promo).
// 3. Calibrage : l'indice de popularité (0-100) et la rareté de chaque morceau viennent de son rang Deezer, en
//    percentiles sur tout le catalogue importé (⭐ 0,5 % les plus écoutés, 🟠 1,5 %, 🟣 4 %, 🔵 10 %, 🟢 24 %, ⚪ 60 %).
//
// L'import s'arrête à la cible (CATALOG_TARGET, 20 000 albums par défaut) et reprend où il en était après un
// redémarrage. Le serveur ne stocke que des métadonnées et l'adresse des pochettes, jamais de fichier audio ni image.
import { config } from './config.js';
import { ARTISTS, ALBUMS } from '../shared/catalog.js';
import { generatedArt } from '../shared/art.js';

const DAY = 86_400_000;

/** Grands genres Deezer → genres du jeu. */
export const GENRE_MAP = {
  116: 'rap', 132: 'pop', 152: 'rock', 85: 'rock', 464: 'metal', 113: 'electro', 106: 'electro', 165: 'soul', 169: 'soul',
  129: 'jazz', 153: 'jazz', 144: 'reggae', 52: 'chanson', 197: 'latin', 75: 'latin', 84: 'country', 466: 'country',
  98: 'classical', 173: 'soundtrack', 2: 'world', 12: 'world', 16: 'world', 81: 'world',
};

/** Paliers de rareté en percentiles du rang Deezer (du plus rare au plus commun) et indice de popularité associé. */
export const RANK_TIERS = [
  { rarity: 'legendary', from: 0.995, pop: [92, 100] },
  { rarity: 'ultra', from: 0.98, pop: [82, 91] },
  { rarity: 'super', from: 0.94, pop: [70, 81] },
  { rarity: 'rare', from: 0.84, pop: [55, 69] },
  { rarity: 'uncommon', from: 0.6, pop: [35, 54] },
  { rarity: 'common', from: 0, pop: [0, 34] },
];

/** Rang Deezer approximatif de chaque palier avant le premier calibrage. */
const DEFAULT_BREAKS = [900_000, 800_000, 650_000, 450_000, 250_000];

export class RateLimited extends Error {}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Titre de base d'un album : sans « (Deluxe Edition) », « [Remastered] », « - Live »… pour repérer les rééditions. */
export function baseTitle(title) {
  return norm(String(title || '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(deluxe|expanded|remaster(ed)?|anniversary|edition|version|bonus tracks?|special|super)\b/gi, ' '));
}

const SKIP_TITLE = /\b(live|en concert|in concert|unplugged|karaok[eé]|instrumentals?|remix(es|ed)?|greatest hits|best of|the best|collection|essentials?|anthology|hits|playlist|mixtape vol|sessions?|demos?|b-sides|rarities|tribute|cover(s)? album|lullaby|8-bit)\b/i;

/** Titre court et featuring : « Stronger (feat. X) » → { title: 'Stronger', feat: 'X' }. */
export function splitFeat(title, short) {
  const m = /\((?:feat\.?|ft\.?|featuring)\s+([^)]+)\)/i.exec(title || '');
  const clean = String(short || title || '').replace(/\s*\((?:feat\.?|ft\.?|featuring)[^)]*\)/i, '').trim();
  return { title: clean || String(title || '').trim(), feat: m ? m[1].trim() : null };
}

const yearOf = (date) => {
  const y = Number(String(date || '').slice(0, 4));
  return y >= 1900 && y <= 2100 ? y : null;
};

const https = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

export function createImporter(db, catalog, { cfg = config, fetchImpl = (...a) => fetch(...a), pauseMs = 170, log = console } = {}) {
  const q = (sql) => db.prepare(sql);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const seedByName = new Map(ARTISTS.map((a) => [norm(a.name), a.id]));
  const seedAlbums = new Set(ALBUMS.map((a) => `${a.artist}|${baseTitle(a.title)}`));

  let running = null;
  let stopRequested = false;
  let timer = null;
  let lastCall = 0;
  let requests = 0;

  const kvGet = (key, fallback) => {
    const row = q('SELECT value FROM kv WHERE key = ?').get(key);
    try {
      return row ? JSON.parse(row.value) : fallback;
    } catch {
      return fallback;
    }
  };
  const kvSet = (key, value) => q('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  const state = () => kvGet('import', { phase: 'idle', lastError: null, startedAt: null, finishedAt: null, discovered: false });
  const setState = (patch) => kvSet('import', { ...state(), ...patch });

  // ---------- appels à Deezer ------------------------------------------------------------

  async function call(path, attempt = 0) {
    const gap = pauseMs - (Date.now() - lastCall);
    if (gap > 0) await wait(gap);
    lastCall = Date.now();
    requests++;
    let res;
    try {
      res = await fetchImpl(`${cfg.deezerApiUrl}${path}`, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      if (attempt < 2) {
        await wait(1000 * (attempt + 1));
        return call(path, attempt + 1);
      }
      throw err;
    }
    let data = null;
    if (res.ok) data = await res.json().catch(() => null);
    const quota = res.status === 429 || data?.error?.code === 4;
    if (quota) {
      if (attempt < 3) {
        await wait(Math.min(30_000, 5000 * 2 ** attempt));
        return call(path, attempt + 1);
      }
      throw new RateLimited('deezer');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (data?.error) {
      // Ressource absente (code 800) : on passe à la suite.
      if (data.error.code === 800) return null;
      throw new Error(`code ${data.error.code || data.error.type}`);
    }
    return data;
  }

  // ---------- file d'artistes ---------------------------------------------------------------

  const enqueue = q(`INSERT INTO import_artists (deezer_id, name, fans, genre, status, depth, priority, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    ON CONFLICT(deezer_id) DO UPDATE SET fans = MAX(import_artists.fans, excluded.fans), genre = COALESCE(import_artists.genre, excluded.genre),
      depth = MIN(import_artists.depth, excluded.depth), priority = MIN(import_artists.priority, excluded.priority)`);

  /** priority : place dans un classement (0 = n° 1) ; les classements ne donnent pas le nombre de fans. */
  function queueArtist(a, genre, depth, priority = 0) {
    if (!a?.id || !a.name) return;
    enqueue.run(String(a.id), String(a.name), Number(a.nb_fan) || 0, genre || null, depth, priority, Date.now());
  }

  async function discover() {
    for (const [gid, genre] of Object.entries(GENRE_MAP)) {
      if (stopRequested) return;
      const chart = await call(`/chart/${gid}/artists?limit=100`);
      (chart?.data || []).forEach((a, i) => queueArtist(a, genre, 0, i));
      const list = await call(`/genre/${gid}/artists`);
      (list?.data || []).forEach((a, i) => queueArtist(a, genre, 0, 100 + i));
    }
    setState({ discovered: true });
  }

  // ---------- écriture dans le catalogue -----------------------------------------------------

  function artistIdFor(dz) {
    const seedId = seedByName.get(norm(dz.name));
    if (seedId) {
      q('UPDATE cat_artists SET deezer_id = COALESCE(deezer_id, ?), fans = MAX(fans, ?) WHERE id = ? AND (deezer_id IS NULL OR deezer_id = ?)')
        .run(String(dz.id), Number(dz.nb_fan) || 0, seedId, String(dz.id));
      return seedId;
    }
    const existing = q('SELECT id FROM cat_artists WHERE deezer_id = ?').get(String(dz.id));
    if (existing) {
      q('UPDATE cat_artists SET fans = MAX(fans, ?) WHERE id = ?').run(Number(dz.nb_fan) || 0, existing.id);
      return existing.id;
    }
    const id = `dz${dz.id}`;
    q(`INSERT INTO cat_artists (id, name, genre, fans, source, deezer_id, created_at) VALUES (?, ?, ?, ?, 'deezer', ?, ?)
      ON CONFLICT(id) DO NOTHING`).run(id, String(dz.name), dz.genre || null, Number(dz.nb_fan) || 0, String(dz.id), Date.now());
    return id;
  }

  function breaks() {
    return kvGet('rankBreaks', DEFAULT_BREAKS);
  }

  /** Indice provisoire (avant le prochain calibrage) d'après les seuils du dernier calibrage. */
  function provisional(rank) {
    const b = breaks();
    const r = Number(rank) || 0;
    for (let i = 0; i < b.length; i++) {
      if (r >= b[i]) {
        const tier = RANK_TIERS[i];
        const hi = i === 0 ? Math.max(b[0] * 1.2, r) : b[i - 1];
        const t = Math.min(1, (r - b[i]) / Math.max(1, hi - b[i]));
        return { pop: Math.round(tier.pop[0] + t * (tier.pop[1] - tier.pop[0])), rarity: tier.rarity };
      }
    }
    const last = RANK_TIERS[RANK_TIERS.length - 1];
    return { pop: Math.round((r / Math.max(1, b[b.length - 1])) * last.pop[1]), rarity: 'common' };
  }

  function nextCatalogNumber() {
    return (q('SELECT MAX(catalog) AS n FROM cat_albums').get().n || 0) + 1;
  }

  /** Enregistre un album et ses pistes. Renvoie le nombre de pistes ou 0 si l'album est écarté. */
  function saveAlbum(artistId, artistGenre, dzAlbum) {
    const list = (dzAlbum.tracks?.data || []).filter((t) => t && t.id && (t.title_short || t.title));
    if (list.length < 4 || list.length > 40) return 0;
    if (q('SELECT 1 FROM cat_albums WHERE deezer_id = ?').get(String(dzAlbum.id))) return 0;
    if (seedAlbums.has(`${artistId}|${baseTitle(dzAlbum.title)}`)) return 0;
    const id = `dz${dzAlbum.id}`;
    const genreId = dzAlbum.genre_id ?? dzAlbum.genres?.data?.[0]?.id;
    const genre = GENRE_MAP[genreId] || artistGenre || 'pop';
    const year = yearOf(dzAlbum.release_date);
    const cover = https(dzAlbum.cover_xl) || https(dzAlbum.cover_big);
    const thumb = https(dzAlbum.cover_big) || cover;
    db.exec('BEGIN');
    try {
      q(`INSERT INTO cat_albums (id, artist_id, title, year, genre, art, catalog, track_count, fans, source, deezer_id, cover, cover_w, thumb, thumb_w, url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'deezer', ?, ?, ?, ?, ?, ?, ?)`).run(
        id, artistId, String(dzAlbum.title).trim(), year, genre, JSON.stringify(generatedArt(id)), nextCatalogNumber(), list.length,
        Number(dzAlbum.fans) || 0, String(dzAlbum.id), cover, cover ? (dzAlbum.cover_xl ? 1000 : 500) : null, thumb, thumb ? 500 : null,
        https(dzAlbum.link), Date.now(),
      );
      const ins = q(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, feat, year, genre, pop, rarity, rank, url, source, deezer_id, created_at)
        VALUES (?, 'album', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deezer', ?, ?) ON CONFLICT(id) DO NOTHING`);
      list.forEach((t, i) => {
        const { title, feat } = splitFeat(t.title, t.title_short);
        const { pop, rarity } = provisional(t.rank);
        const dzId = q('SELECT 1 FROM cat_tracks WHERE deezer_id = ?').get(String(t.id)) ? null : String(t.id);
        ins.run(`${id}:${String(i + 1).padStart(2, '0')}`, id, artistId, i + 1, list.length, title, feat, year, genre, pop, rarity,
          Number(t.rank) || 0, https(t.link), dzId, Date.now());
      });
      catalog.indexAlbum(id);
      db.exec('COMMIT');
      return list.length;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function savePromo(artistId, artistGenre, single, track) {
    if (q('SELECT 1 FROM cat_tracks WHERE deezer_id = ?').get(String(track.id))) return false;
    const { title, feat } = splitFeat(track.title, track.title_short);
    const genre = GENRE_MAP[single.genre_id] || artistGenre || 'pop';
    const n = (q("SELECT MAX(n) AS n FROM cat_tracks WHERE kind = 'promo'").get().n || 0) + 1;
    const id = `promo:dz${track.id}`;
    const { pop } = provisional(track.rank);
    const cover = https(single.cover_xl) || https(single.cover_big);
    q(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, feat, year, genre, pop, rarity, rank, promo_kind, art, url, cover, thumb, source, deezer_id, created_at)
      VALUES (?, 'promo', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'promo', ?, 'single', ?, ?, ?, ?, 'deezer', ?, ?) ON CONFLICT(id) DO NOTHING`).run(
      id, artistId, n, n, title, feat, yearOf(single.release_date), genre, pop, Number(track.rank) || 0, JSON.stringify(generatedArt(id)),
      https(track.link) || https(single.link), cover, https(single.cover_big) || cover, String(track.id), Date.now(),
    );
    return true;
  }

  // ---------- calibrage de la rareté ----------------------------------------------------------

  /** Indice de popularité et rareté de chaque morceau importé, en percentiles de rang Deezer. */
  function calibrate() {
    const rows = q("SELECT id, rank, kind FROM cat_tracks WHERE source = 'deezer' ORDER BY rank ASC, id").all();
    const n = rows.length;
    if (!n) return;
    const ranks = rows.map((r) => Number(r.rank) || 0);
    const upd = q('UPDATE cat_tracks SET pop = ?, rarity = ? WHERE id = ?');
    db.exec('BEGIN');
    try {
      let i = 0;
      while (i < n) {
        // Rangs égaux : même percentile.
        let j = i;
        while (j + 1 < n && ranks[j + 1] === ranks[i]) j++;
        const p = n === 1 ? 1 : i / (n - 1);
        const tierIdx = RANK_TIERS.findIndex((t) => p >= t.from);
        const tier = RANK_TIERS[tierIdx];
        const upper = tierIdx === 0 ? 1 : RANK_TIERS[tierIdx - 1].from;
        const t = upper > tier.from ? (p - tier.from) / (upper - tier.from) : 1;
        const pop = Math.max(0, Math.min(100, Math.round(tier.pop[0] + t * (tier.pop[1] - tier.pop[0]))));
        for (let k = i; k <= j; k++) upd.run(pop, rows[k].kind === 'promo' ? 'promo' : tier.rarity, rows[k].id);
        i = j + 1;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const at = (p) => ranks[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
    kvSet('rankBreaks', RANK_TIERS.slice(0, -1).map((t) => at(t.from)));
    catalog.refreshCounts();
    catalog.rebuildIndex();
  }

  // ---------- exploration d'un artiste --------------------------------------------------------

  const importedAlbums = () => q("SELECT COUNT(*) AS n FROM cat_albums WHERE source = 'deezer'").get().n;
  const importedPromos = () => q("SELECT COUNT(*) AS n FROM cat_tracks WHERE kind = 'promo' AND source = 'deezer'").get().n;
  const maxPromos = () => Math.round(cfg.catalogTarget * 0.075);

  async function processArtist(row) {
    const setStatus = (status) => q('UPDATE import_artists SET status = ?, updated_at = ? WHERE deezer_id = ?').run(status, Date.now(), row.deezer_id);
    let fans = row.fans;
    let name = row.name;
    if (!fans) {
      const info = await call(`/artist/${row.deezer_id}`);
      if (!info) return setStatus('skipped');
      fans = Number(info.nb_fan) || 0;
      name = info.name || name;
      q('UPDATE import_artists SET fans = ?, name = ? WHERE deezer_id = ?').run(fans, name, row.deezer_id);
    }
    if (fans < cfg.catalogMinArtistFans) return setStatus('skipped');

    const albums = (await call(`/artist/${row.deezer_id}/albums?limit=100`))?.data || [];
    const studio = new Map();
    for (const a of albums) {
      if (a.record_type !== 'album' || SKIP_TITLE.test(a.title || '') || (Number(a.fans) || 0) < cfg.catalogMinAlbumFans) continue;
      const key = baseTitle(a.title);
      if (!key) continue;
      const prev = studio.get(key);
      if (!prev || (Number(a.fans) || 0) > (Number(prev.fans) || 0)) studio.set(key, a);
    }
    const chosen = [...studio.values()].sort((a, b) => (Number(b.fans) || 0) - (Number(a.fans) || 0)).slice(0, cfg.catalogMaxAlbumsPerArtist);
    const genreVotes = {};
    for (const a of chosen) {
      const g = GENRE_MAP[a.genre_id];
      if (g) genreVotes[g] = (genreVotes[g] || 0) + 1;
    }
    const artistGenre = Object.entries(genreVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || row.genre || 'pop';
    const artistId = artistIdFor({ id: row.deezer_id, name, nb_fan: fans, genre: artistGenre });
    q('UPDATE cat_artists SET genre = COALESCE(genre, ?) WHERE id = ?').run(artistGenre, artistId);

    const albumTitles = new Set(q('SELECT title FROM cat_tracks WHERE artist_id = ?').all(artistId).map((r) => norm(splitFeat(r.title).title)));
    for (const a of chosen) {
      if (stopRequested || importedAlbums() >= cfg.catalogTarget) break;
      if (q('SELECT 1 FROM cat_albums WHERE deezer_id = ?').get(String(a.id))) continue;
      const full = await call(`/album/${a.id}`);
      if (!full) continue;
      if (full.nb_tracks > (full.tracks?.data?.length || 0) && full.nb_tracks <= 40) {
        const more = await call(`/album/${a.id}/tracks?limit=100`);
        if (more?.data?.length) full.tracks = { data: more.data };
      }
      if (saveAlbum(artistId, artistGenre, { ...a, ...full })) {
        for (const t of full.tracks.data) albumTitles.add(norm(splitFeat(t.title, t.title_short).title));
      }
    }

    // Single hors album : une carte promo par artiste (deux pour les plus suivis).
    const perArtist = fans >= 1_000_000 ? 2 : 1;
    const singles = albums.filter((a) => a.record_type === 'single' && !SKIP_TITLE.test(a.title || ''))
      .sort((a, b) => (Number(b.fans) || 0) - (Number(a.fans) || 0));
    let added = 0;
    for (const s of singles) {
      if (added >= perArtist || importedPromos() >= maxPromos() || stopRequested) break;
      if (albumTitles.has(norm(splitFeat(s.title).title))) continue;
      const full = await call(`/album/${s.id}`);
      const first = full?.tracks?.data?.[0];
      if (!first || albumTitles.has(norm(splitFeat(first.title, first.title_short).title))) continue;
      if (savePromo(artistId, artistGenre, { ...s, ...full }, first)) added++;
    }

    const related = (await call(`/artist/${row.deezer_id}/related?limit=20`))?.data || [];
    for (const r of related) {
      if ((Number(r.nb_fan) || 0) >= cfg.catalogMinArtistFans) queueArtist(r, artistGenre, row.depth + 1);
    }
    setStatus('done');
  }

  // ---------- tournée ------------------------------------------------------------------------

  async function run() {
    stopRequested = false;
    setState({ phase: 'running', startedAt: state().startedAt || Date.now(), lastError: null });
    if (!state().discovered) await discover();
    let sinceCalibration = 0;
    // Les artistes des classements d'abord, dans l'ordre des classements (leur nombre de fans n'y figure pas), puis
    // leurs artistes proches, et ainsi de suite ; à profondeur égale, les plus suivis passent en premier.
    const next = q("SELECT * FROM import_artists WHERE status = 'pending' ORDER BY depth, priority, CASE WHEN depth = 0 THEN rowid ELSE -fans END LIMIT 1");
    while (!stopRequested && importedAlbums() < cfg.catalogTarget) {
      const row = next.get();
      if (!row) break;
      try {
        await processArtist(row);
      } catch (err) {
        if (err instanceof RateLimited) throw err;
        // Un artiste en erreur ne bloque pas l'import : on le note et on passe au suivant.
        q("UPDATE import_artists SET status = 'error', updated_at = ? WHERE deezer_id = ?").run(Date.now(), row.deezer_id);
        setState({ lastError: `${row.name}: ${err.message}` });
        if (!/^HTTP 4|^code /.test(err.message)) throw err;
      }
      if (++sinceCalibration >= 40) {
        calibrate();
        sinceCalibration = 0;
      }
    }
    calibrate();
    const done = importedAlbums() >= cfg.catalogTarget || !next.get();
    setState({ phase: stopRequested ? 'paused' : done ? 'done' : 'idle', finishedAt: done ? Date.now() : null });
  }

  function start({ force = false } = {}) {
    if (running) return running;
    if (cfg.catalogImport === 'off' && !force) return null;
    running = run()
      .catch((err) => {
        const msg = err instanceof RateLimited ? 'deezer: quota' : err.message;
        setState({ phase: 'error', lastError: msg });
        log.warn?.(`  Import du catalogue interrompu (${msg}) : nouvelle tentative dans 10 minutes.`);
        timer = setTimeout(() => start(), 10 * 60_000);
        timer.unref?.();
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  function status() {
    const s = state();
    const counts = q("SELECT status, COUNT(*) AS n FROM import_artists GROUP BY status").all();
    const by = Object.fromEntries(counts.map((r) => [r.status, r.n]));
    const albums = importedAlbums();
    const totals = catalog.totals();
    return {
      mode: cfg.catalogImport,
      target: cfg.catalogTarget,
      running: !!running,
      phase: running ? 'running' : s.phase,
      albums,
      totalAlbums: totals.albums,
      tracks: totals.tracks,
      promos: totals.promos,
      artists: { pending: by.pending || 0, done: by.done || 0, skipped: by.skipped || 0, error: by.error || 0 },
      requests,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      lastError: s.lastError,
    };
  }

  return {
    start,
    status,
    calibrate,
    pause() {
      stopRequested = true;
      clearTimeout(timer);
    },
    /** Premier import peu après le démarrage, puis une vérification par jour (nouvelles sorties des artistes suivis). */
    schedule() {
      if (cfg.catalogImport === 'off') return;
      setTimeout(() => start(), 5000).unref?.();
      setInterval(() => {
        if (importedAlbums() < cfg.catalogTarget) start();
      }, DAY).unref?.();
    },
  };
}
