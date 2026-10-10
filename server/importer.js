// Import du grand catalogue depuis l'API publique de Deezer (sans clé), en tâche de fond et par reprise.
//
// 1. Découverte : classements et artistes de chaque grand genre (/chart/{genre}/artists, /genre/{genre}/artists).
// 2. Exploration, des artistes les plus suivis aux moins suivis : leurs albums studio (pas de live, de compilation
//    ni de rééditions en double), leurs artistes proches (/artist/{id}/related), et un single hors album par
//    artiste (carte promo).
// 3. Calibrage : l'indice de popularité (0-100) et la rareté de chaque morceau viennent de son rang Deezer, en
//    percentiles sur tout le catalogue importé (⭐ 0,5 % les plus écoutés, 🟠 1,5 %, 🟣 4 %, 🔵 10 %, 🟢 24 %, ⚪ 60 %).
//    Une seule requête SQL, et seulement quand des morceaux ont été ajoutés depuis le dernier calibrage.
// 4. Vérification quotidienne des nouvelles sorties, même une fois la cible atteinte : chaque jour, jusqu'à 300 artistes
//    déjà importés et pas revus depuis une semaine (les plus suivis d'abord, puis chacun son tour). Un nouvel album
//    studio entre au catalogue s'il fait partie des CATALOG_MAX_ALBUMS_PER_ARTIST albums les plus écoutés de l'artiste.
//
// L'import s'arrête à la cible (CATALOG_TARGET, 20 000 albums par défaut) et reprend où il en était après un
// redémarrage. Une ressource absente (code 800, 404 sur un album) est passée ; une panne ou un blocage de Deezer
// (réseau, 5xx, 401/403, quota, refus en série) arrête l'import sans toucher à la file d'artistes, qui reprend
// 10 minutes plus tard. La pause est enregistrée en base : elle tient jusqu'au bouton « Lancer » de l'espace admin.
// Le serveur ne stocke que des métadonnées et l'adresse des pochettes, jamais de fichier audio ni image.
import { config } from './config.js';
import { SEED_CATALOG_MAX } from './catalog.js';
import { ARTISTS, ALBUMS } from '../shared/catalog.js';
import { generatedArt } from '../shared/art.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const RETRY_MS = 10 * MINUTE; // nouvelle tentative après une panne de Deezer
const CALIBRATE_EVERY_MS = 15 * MINUTE; // calibrage pendant l'import (et à la fin de chaque tournée qui a ajouté des morceaux)
const MAX_RELEASES = 500; // sorties lues par artiste (/artist/{id}/albums, par pages de 100)
const MIN_TRACKS = 4;
const MAX_TRACKS = 40;
const MAX_ARTIST_RETRIES = 3; // un artiste en erreur est retenté au plus 3 fois
const MAX_ERROR_STREAK = 5; // artistes en erreur d'affilée : le problème ne vient pas d'eux
const MAX_REFUSALS = 10; // ressources refusées d'affilée (404, 410…) : Deezer bloque ou a changé
const REFRESH_EVERY_MS = 20 * HOUR; // vérification des nouvelles sorties : une fois par jour
const REFRESH_BATCH = 300; // artistes revus par vérification
const REFRESH_AGE_MS = 7 * DAY; // un artiste est revu au plus une fois par semaine

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

/** Deezer en panne, injoignable ou qui bloque le serveur : l'import s'arrête sans toucher à la file et reprend plus tard. */
export class Unavailable extends Error {}
export class RateLimited extends Unavailable {}
/** Ressource refusée (404, 410, paramètre…) : un album ou un single est passé ; pour un artiste, il sera retenté. */
class Refused extends Error {}
const optional = (promise) => promise.catch((err) => {
  if (err instanceof Refused) return null;
  throw err;
});

// Clé de comparaison : sans casse ni accents, ponctuation réduite à des espaces. Les lettres et chiffres de toutes les
// écritures sont gardés (Кино, 宇多田ヒカル, عمرو دياب) : un titre non latin ne devient pas vide.
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(/&/g, ' and ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

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
const fansOf = (a) => Number(a?.fans) || 0;

// Calibrage en une requête : percent_rank() donne à chaque morceau la part du catalogue importé moins écoutée que lui
// (rangs égaux : même percentile), puis le palier et l'indice de popularité en découlent. Seules les lignes dont
// l'indice ou la rareté changent sont réécrites.
const POP_SQL = `CASE ${RANK_TIERS.map((t, i) => {
  const upper = i === 0 ? 1 : RANK_TIERS[i - 1].from;
  return `WHEN p >= ${t.from} THEN MAX(0, MIN(100, round(${t.pop[0]} + ((p - ${t.from}) / (${upper} - ${t.from})) * (${t.pop[1]} - ${t.pop[0]}))))`;
}).join(' ')} END`;
const RARITY_SQL = `CASE ${RANK_TIERS.map((t) => `WHEN p >= ${t.from} THEN '${t.rarity}'`).join(' ')} END`;
// Seuls les morceaux dont la rareté n'est pas gelée (rarity_locked = 0) sont réécrits (PLAN.md 6.5).
const CALIBRATE_SQL = `UPDATE cat_tracks SET pop = x.pop, rarity = x.rarity
  FROM (SELECT id, CAST(${POP_SQL} AS INTEGER) AS pop, CASE WHEN kind = 'promo' THEN 'promo' ELSE ${RARITY_SQL} END AS rarity
    FROM (SELECT id, kind, CASE WHEN COUNT(*) OVER () = 1 THEN 1.0 ELSE percent_rank() OVER (ORDER BY COALESCE(rank, 0)) END AS p
      FROM cat_tracks WHERE source = 'deezer')) AS x
  WHERE cat_tracks.id = x.id AND cat_tracks.rarity_locked = 0 AND (cat_tracks.pop IS NOT x.pop OR cat_tracks.rarity IS NOT x.rarity)`;
/** Édition de rareté posée sur les morceaux gelés (« 1re édition » ; une réévaluation annuelle, P3, passerait à 2). */
export const RARITY_EDITION = 1;
const FREEZE_CHUNK = 2000; // morceaux gelés par transaction : aucune requête ne bloque le serveur plus de quelques ms
const BREAKS_SQL = `SELECT rn, rank FROM (SELECT COALESCE(rank, 0) AS rank, row_number() OVER (ORDER BY COALESCE(rank, 0), id) - 1 AS rn
  FROM cat_tracks WHERE source = 'deezer') WHERE rn IN (SELECT value FROM json_each(?))`;

export function createImporter(db, catalog, {
  cfg = config, fetchImpl = (...a) => fetch(...a), pauseMs = 170, backoffMs = 1000, retryMs = RETRY_MS, log = console,
} = {}) {
  const q = (sql) => db.prepare(sql);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const seedByName = new Map(ARTISTS.map((a) => [norm(a.name), a.id]));
  const seedAlbums = new Set(ALBUMS.map((a) => `${a.artist}|${baseTitle(a.title)}`));
  const seedTitles = new Map();
  for (const a of ALBUMS) {
    if (!seedTitles.has(a.artist)) seedTitles.set(a.artist, new Set());
    seedTitles.get(a.artist).add(baseTitle(a.title));
  }

  // Colonnes ajoutées après la première version de l'import (bases existantes) : nombre d'essais d'un artiste en
  // erreur, date de la dernière vérification de sa discographie.
  const cols = q('PRAGMA table_info(import_artists)').all().map((c) => c.name);
  if (!cols.includes('retries')) db.exec('ALTER TABLE import_artists ADD COLUMN retries INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('checked_at')) db.exec('ALTER TABLE import_artists ADD COLUMN checked_at INTEGER');

  let running = null;
  let stopRequested = false;
  let relaunch = false;
  let timer = null;
  let retryAt = null;
  let lastCall = 0;
  let requests = 0;
  let refusals = 0;
  let sinceCalibration = 0; // morceaux ajoutés depuis le dernier calibrage
  let dirty = false; // albums rendus à leur artiste (homonyme) : compteurs à refaire
  const seedChecks = new Map();

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

  // Après un redémarrage ou un plantage en plein import, plus rien ne tourne. Une pause d'avant cette version (sans
  // drapeau) reste une pause.
  {
    const s = state();
    if (s.phase === 'paused' && s.paused === undefined) setState({ paused: true });
    else if (s.phase === 'running') setState({ phase: s.paused ? 'paused' : 'idle' });
  }

  // ---------- appels à Deezer ------------------------------------------------------------

  /**
   * Une requête à l'API. Renvoie les données, ou null si la ressource est absente (code 800). Lève Refused si elle
   * est refusée, Unavailable si Deezer est en panne, bloque le serveur ou refuse tout : l'import s'arrête et reprendra.
   */
  async function call(path) {
    for (let attempt = 0; ; attempt++) {
      const gap = pauseMs - (Date.now() - lastCall);
      if (gap > 0) await wait(gap);
      lastCall = Date.now();
      requests++;
      let res;
      try {
        res = await fetchImpl(`${cfg.deezerApiUrl}${path}`, { signal: AbortSignal.timeout(10_000) });
      } catch (err) {
        // Réseau coupé ou délai dépassé.
        if (attempt < 2) {
          await wait(backoffMs * (attempt + 1));
          continue;
        }
        throw new Unavailable(`deezer: ${err.message}`);
      }
      const data = res.ok ? await res.json().catch(() => null) : null;
      const code = data?.error?.code;
      if (res.status === 429 || code === 4) {
        if (attempt < 3) {
          await wait(Math.min(30 * backoffMs, 5 * backoffMs * 2 ** attempt));
          continue;
        }
        throw new RateLimited('deezer: quota');
      }
      // Panne passagère (5xx, « service busy », réponse illisible) : on réessaie, puis on reprendra plus tard.
      if (res.status >= 500 || code === 700 || (res.ok && !data)) {
        if (attempt < 2) {
          await wait(backoffMs * (attempt + 1));
          continue;
        }
        throw new Unavailable(`deezer: ${res.ok ? (code ? `code ${code}` : 'réponse illisible') : `HTTP ${res.status}`}`);
      }
      // Accès refusé : le serveur est bloqué (adresse IP, pays…), inutile d'essayer les artistes suivants.
      if (res.status === 401 || res.status === 403) throw new Unavailable(`deezer: HTTP ${res.status}`);
      if (res.ok && !data.error) {
        refusals = 0;
        return data;
      }
      // Ressource absente (code 800) : on passe à la suite.
      if (code === 800) return null;
      // Ressource refusée (404, 410, paramètre…), sauf si les refus s'enchaînent : Deezer bloque ou a changé.
      const why = res.ok ? `code ${code ?? data.error.type}` : `HTTP ${res.status}`;
      if (++refusals >= MAX_REFUSALS) throw new Unavailable(`deezer: ${refusals} refus d'affilée (${why})`);
      throw new Refused(why);
    }
  }

  /** Toutes les sorties d'un artiste (albums, singles…), page par page, MAX_RELEASES au plus. null s'il n'existe pas. */
  async function artistReleases(deezerId) {
    const out = [];
    for (let index = 0; index < MAX_RELEASES; index += 100) {
      // Une page suivante refusée : on garde les précédentes.
      const request = call(`/artist/${deezerId}/albums?limit=100&index=${index}`);
      const page = await (index ? optional(request) : request);
      if (!page) return index ? out : null;
      const data = Array.isArray(page.data) ? page.data : [];
      out.push(...data);
      if (!page.next || data.length === 0) break;
    }
    return out;
  }

  /**
   * Pistes complètes d'un album (la liste intégrée à /album/{id} peut être partielle), ou null si l'album est écarté :
   * moins de 4 ou plus de 40 pistes en tout, ou liste incomplète (un album à qui il manque des pistes ne se complète pas).
   */
  async function albumTracks(albumId, full) {
    const valid = (t) => t && t.id && (t.title_short || t.title);
    const embedded = Array.isArray(full.tracks?.data) ? full.tracks.data : [];
    const total = Number(full.nb_tracks) || embedded.length;
    if (total < MIN_TRACKS || total > MAX_TRACKS) return null;
    let list = embedded;
    if (list.length < total) {
      list = [];
      for (let index = 0; list.length < total && index < 300; index += 100) {
        const page = await optional(call(`/album/${albumId}/tracks?limit=100&index=${index}`));
        const data = Array.isArray(page?.data) ? page.data : [];
        list.push(...data);
        if (!page?.next || data.length === 0) break;
      }
    }
    list = list.filter(valid);
    return list.length >= total && list.length <= MAX_TRACKS ? list : null;
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

  // Les artistes des classements d'abord, dans l'ordre des classements (leur nombre de fans n'y figure pas), puis
  // leurs artistes proches, et ainsi de suite ; à profondeur égale, les plus suivis passent en premier.
  const next = q("SELECT * FROM import_artists WHERE status = 'pending' ORDER BY depth, priority, CASE WHEN depth = 0 THEN rowid ELSE -fans END LIMIT 1");
  const pendingArtists = () => q("SELECT COUNT(*) AS n FROM import_artists WHERE status = 'pending' OR (status = 'error' AND retries < ?)").get(MAX_ARTIST_RETRIES).n;

  async function discover() {
    for (const [gid, genre] of Object.entries(GENRE_MAP)) {
      if (stopRequested) return;
      const chart = await optional(call(`/chart/${gid}/artists?limit=100`));
      (chart?.data || []).forEach((a, i) => queueArtist(a, genre, 0, i));
      const list = await optional(call(`/genre/${gid}/artists`));
      (list?.data || []).forEach((a, i) => queueArtist(a, genre, 0, 100 + i));
    }
    setState({ discovered: true });
  }

  // ---------- écriture dans le catalogue -----------------------------------------------------

  /**
   * Est-ce bien l'artiste de la graine, et pas un homonyme ? Oui si sa discographie Deezer contient l'un de ses albums
   * de la graine (même titre de base), ou à défaut s'il est le plus suivi des artistes Deezer qui portent exactement
   * ce nom (/search/artist, une requête par artiste de la graine, gardée en mémoire).
   */
  async function isSeedArtist(seedId, dz, releases) {
    const titles = seedTitles.get(seedId);
    if (titles && releases.some((a) => titles.has(baseTitle(a.title)))) return true;
    const key = `${seedId}|${dz.id}`;
    if (!seedChecks.has(key)) {
      const found = await optional(call(`/search/artist?q=${encodeURIComponent(dz.name)}&limit=25`));
      const same = (found?.data || []).filter((a) => a?.id && norm(a.name) === norm(dz.name));
      const top = same.sort((a, b) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0))[0];
      seedChecks.set(key, !!top && String(top.id) === String(dz.id));
    }
    return seedChecks.get(key);
  }

  /** Albums d'un homonyme rattachés à tort à un artiste de la graine (par une version précédente) : rendus à leur artiste. */
  function reclaimAlbums(fromId, toId, releases) {
    const ids = JSON.stringify(releases.map((a) => String(a.id)));
    const rows = q("SELECT id FROM cat_albums WHERE artist_id = ? AND source = 'deezer' AND deezer_id IN (SELECT value FROM json_each(?))").all(fromId, ids);
    if (!rows.length) return;
    db.exec('BEGIN');
    try {
      for (const { id } of rows) {
        q('UPDATE cat_albums SET artist_id = ? WHERE id = ?').run(toId, id);
        q('UPDATE cat_tracks SET artist_id = ? WHERE album_id = ?').run(toId, id);
        catalog.indexAlbum(id);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    dirty = true;
    log.warn?.(`  Import du catalogue : ${rows.length} album(s) d'un homonyme rendus à leur artiste (${toId}).`);
  }

  /**
   * Artiste du jeu pour un artiste Deezer. Un artiste déjà rattaché garde son rattachement ; un artiste de la graine
   * n'est reconnu que si le nom correspond ET que isSeedArtist() le confirme. Sinon (homonyme), il devient un artiste à
   * part : « Nirvana » (le groupe anglais des années 60) ne prend ni l'identifiant ni les albums de Nirvana.
   */
  async function artistIdFor(dz, releases) {
    const deezerId = String(dz.id);
    const fans = Number(dz.nb_fan) || 0;
    const bound = q('SELECT id, source FROM cat_artists WHERE deezer_id = ?').get(deezerId);
    if (bound && bound.source !== 'seed') {
      q('UPDATE cat_artists SET fans = MAX(fans, ?) WHERE id = ?').run(fans, bound.id);
      return bound.id;
    }
    const seedId = bound?.id || seedByName.get(norm(dz.name));
    if (seedId) {
      if (await isSeedArtist(seedId, dz, releases)) {
        // Deux pages Deezer pour le même artiste : ses albums vont tous à l'artiste de la graine, rattaché à la première.
        q('UPDATE cat_artists SET deezer_id = COALESCE(deezer_id, ?), fans = MAX(fans, ?) WHERE id = ?').run(deezerId, fans, seedId);
        return seedId;
      }
      // Ancien rattachement par le seul nom : l'artiste de la graine est libéré pour le bon.
      if (bound) q('UPDATE cat_artists SET deezer_id = NULL WHERE id = ?').run(seedId);
    }
    const id = `dz${deezerId}`;
    q(`INSERT INTO cat_artists (id, name, genre, fans, source, deezer_id, created_at) VALUES (?, ?, ?, ?, 'deezer', ?, ?)
      ON CONFLICT(id) DO UPDATE SET fans = MAX(fans, excluded.fans)`).run(id, String(dz.name), dz.genre || null, fans, deezerId, Date.now());
    if (seedId) reclaimAlbums(seedId, id, releases);
    return id;
  }

  function breaks() {
    return kvGet('rankBreaks', DEFAULT_BREAKS);
  }

  /** Indice provisoire (avant le prochain calibrage) d'après les seuils du dernier calibrage. */
  function provisional(rank, b = breaks()) {
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

  /** Les albums importés sont numérotés après la plage réservée à la graine (AM-1001 et suivants). */
  function nextCatalogNumber() {
    return Math.max(q('SELECT MAX(catalog) AS n FROM cat_albums').get().n || 0, SEED_CATALOG_MAX) + 1;
  }

  /** Enregistre un album et ses pistes (liste complète). Renvoie le nombre de pistes ou 0 si l'album est écarté. */
  function saveAlbum(artistId, artistGenre, dzAlbum, list) {
    if (list.length < MIN_TRACKS || list.length > MAX_TRACKS) return 0;
    if (q('SELECT 1 FROM cat_albums WHERE deezer_id = ?').get(String(dzAlbum.id))) return 0;
    if (seedAlbums.has(`${artistId}|${baseTitle(dzAlbum.title)}`)) return 0;
    const id = `dz${dzAlbum.id}`;
    const genreId = dzAlbum.genre_id ?? dzAlbum.genres?.data?.[0]?.id;
    const genre = GENRE_MAP[genreId] || artistGenre || 'pop';
    const year = yearOf(dzAlbum.release_date);
    const cover = https(dzAlbum.cover_xl) || https(dzAlbum.cover_big);
    const thumb = https(dzAlbum.cover_big) || cover;
    const b = breaks();
    db.exec('BEGIN');
    try {
      q(`INSERT INTO cat_albums (id, artist_id, title, year, genre, art, catalog, track_count, fans, source, deezer_id, cover, cover_w, thumb, thumb_w, url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'deezer', ?, ?, ?, ?, ?, ?, ?)`).run(
        id, artistId, String(dzAlbum.title).trim(), year, genre, JSON.stringify(generatedArt(id)), nextCatalogNumber(), list.length,
        fansOf(dzAlbum), String(dzAlbum.id), cover, cover ? (dzAlbum.cover_xl ? 1000 : 500) : null, thumb, thumb ? 500 : null,
        https(dzAlbum.link), Date.now(),
      );
      const ins = q(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, feat, year, genre, pop, rarity, rank, url, source, deezer_id, created_at)
        VALUES (?, 'album', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deezer', ?, ?) ON CONFLICT(id) DO NOTHING`);
      list.forEach((t, i) => {
        const { title, feat } = splitFeat(t.title, t.title_short);
        const { pop, rarity } = provisional(t.rank, b);
        const dzId = q('SELECT 1 FROM cat_tracks WHERE deezer_id = ?').get(String(t.id)) ? null : String(t.id);
        ins.run(`${id}:${String(i + 1).padStart(2, '0')}`, id, artistId, i + 1, list.length, title, feat, year, genre, pop, rarity,
          Number(t.rank) || 0, https(t.link), dzId, Date.now());
      });
      catalog.indexAlbum(id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    sinceCalibration += list.length;
    return list.length;
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
    sinceCalibration += 1;
    return true;
  }

  // ---------- calibrage de la rareté ----------------------------------------------------------

  const deezerTracks = () => q("SELECT COUNT(*) AS n FROM cat_tracks WHERE source = 'deezer'").get().n;

  // ---------- gel des raretés (PLAN.md 6.5) ------------------------------------------------------------

  /**
   * Catalogue gelé : au moins un morceau importé a sa rareté figée (l'étape v9 de db.js gèle tout catalogue existant ;
   * un catalogue neuf l'est à la fin de son premier import complet). Avant : construction initiale, les percentiles
   * de tout le catalogue font la rareté. Après : une carte tirée Légendaire reste Légendaire.
   */
  const frozen = () => !!q("SELECT 1 FROM cat_tracks WHERE source = 'deezer' AND rarity_locked = 1 LIMIT 1").get();

  /**
   * Gèle les morceaux importés pas encore gelés, par tranches de la clé primaire : chacune est une petite transaction
   * (la construction initiale se termine sans bloquer les joueurs). `assign` : rareté et indice provisoires d'après
   * les seuils enregistrés (morceaux arrivés après le gel). Renvoie le nombre de morceaux dont la rareté a changé.
   */
  function freezeUnlocked({ assign = false } = {}) {
    const b = breaks();
    const { lo, hi } = q("SELECT MIN(rowid) AS lo, MAX(rowid) AS hi FROM cat_tracks WHERE source = 'deezer' AND rarity_locked = 0").get();
    if (lo == null) return 0;
    let changed = 0;
    const lock = q(`UPDATE cat_tracks SET rarity_locked = 1, rarity_edition = ${RARITY_EDITION}, pop_source = COALESCE(pop_source, 'deezer-rank')
      WHERE rowid >= ? AND rowid < ? AND source = 'deezer' AND rarity_locked = 0`);
    const pick = q(`SELECT rowid AS rid, kind, rank, pop, rarity FROM cat_tracks
      WHERE rowid >= ? AND rowid < ? AND source = 'deezer' AND rarity_locked = 0`);
    const set = q('UPDATE cat_tracks SET pop = ?, rarity = ? WHERE rowid = ?');
    for (let from = lo; from <= hi; from += FREEZE_CHUNK) {
      const to = from + FREEZE_CHUNK;
      db.exec('BEGIN');
      try {
        if (assign) {
          for (const r of pick.all(from, to)) {
            const p = provisional(r.rank, b);
            const rarity = r.kind === 'promo' ? 'promo' : p.rarity;
            if (p.pop !== r.pop || rarity !== r.rarity) {
              set.run(p.pop, rarity, r.rid);
              if (rarity !== r.rarity) changed += 1;
            }
          }
        }
        lock.run(from, to);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
    return changed;
  }

  /**
   * Indice de popularité et rareté des morceaux importés (PLAN.md 6.5). Tant que le catalogue n'est pas gelé
   * (construction initiale), percentiles du rang Deezer sur tout le catalogue importé, en une requête, et seuils
   * enregistrés pour les morceaux qui arrivent entre deux calibrages. Une fois gelé, seuls les nouveaux morceaux
   * reçoivent une rareté (d'après les seuils enregistrés) puis sont gelés à leur tour : aucune rareté existante ne
   * change. `lock` : gèle tout à la fin (premier import complet). Les tirages et les compteurs du catalogue ne sont
   * recalculés que si quelque chose a changé.
   */
  function calibrate({ lock = false } = {}) {
    const n = deezerTracks();
    const before = state().calibratedTracks;
    let changed = 0;
    if (n && !frozen()) {
      changed = Number(q(CALIBRATE_SQL).run().changes);
      const idx = RANK_TIERS.slice(0, -1).map((t) => Math.floor(t.from * (n - 1)));
      const at = new Map(q(BREAKS_SQL).all(JSON.stringify(idx)).map((r) => [r.rn, r.rank]));
      kvSet('rankBreaks', idx.map((i) => at.get(i) ?? 0));
      if (lock) freezeUnlocked();
    } else if (n) {
      changed = freezeUnlocked({ assign: true });
    }
    if (changed || n !== before || dirty) {
      catalog.refreshCounts();
      catalog.rebuildIndex();
    }
    dirty = false;
    sinceCalibration = 0;
    setState({ calibratedTracks: n, calibratedAt: Date.now(), ...(lock || frozen() ? { frozenAt: state().frozenAt || Date.now() } : {}) });
    return changed;
  }

  /** Calibre seulement si des morceaux ont été ajoutés ou retirés depuis le dernier calibrage. */
  function calibrateIfNeeded() {
    if (!dirty && deezerTracks() === state().calibratedTracks) return false;
    calibrate();
    return true;
  }

  // ---------- exploration d'un artiste --------------------------------------------------------

  const importedAlbums = () => q("SELECT COUNT(*) AS n FROM cat_albums WHERE source = 'deezer'").get().n;
  const importedPromos = () => q("SELECT COUNT(*) AS n FROM cat_tracks WHERE kind = 'promo' AND source = 'deezer'").get().n;
  const maxPromos = () => Math.round(cfg.catalogTarget * 0.075);

  /**
   * Importe les albums d'un artiste. refresh : vérification des nouvelles sorties d'un artiste déjà traité (ni promo,
   * ni artistes proches, sans tenir compte de la cible ; seule sa date de vérification change). Interrompu par la
   * pause ou la cible, l'artiste reste en attente : ses albums déjà enregistrés seront passés à la reprise.
   */
  async function processArtist(row, { refresh = false } = {}) {
    const finish = (status) => {
      const now = Date.now();
      if (refresh) q('UPDATE import_artists SET checked_at = ? WHERE deezer_id = ?').run(now, row.deezer_id);
      else q('UPDATE import_artists SET status = ?, checked_at = ?, updated_at = ? WHERE deezer_id = ?').run(status, now, now, row.deezer_id);
    };
    let fans = row.fans;
    let name = row.name;
    if (!fans) {
      const info = await call(`/artist/${row.deezer_id}`);
      if (!info) return finish('skipped');
      fans = Number(info.nb_fan) || 0;
      name = info.name || name;
      q('UPDATE import_artists SET fans = ?, name = ? WHERE deezer_id = ?').run(fans, name, row.deezer_id);
    }
    if (fans < cfg.catalogMinArtistFans) return finish('skipped');

    const releases = await artistReleases(row.deezer_id);
    if (!releases) return finish('skipped');
    const today = new Date().toISOString().slice(0, 10);
    const studio = new Map();
    for (const a of releases) {
      if (!a?.id || a.record_type !== 'album' || SKIP_TITLE.test(a.title || '') || fansOf(a) < cfg.catalogMinAlbumFans) continue;
      if (a.release_date && String(a.release_date) > today) continue; // annoncé, pas encore sorti
      const key = baseTitle(a.title);
      if (!key) continue;
      const prev = studio.get(key);
      if (!prev || fansOf(a) > fansOf(prev)) studio.set(key, a);
    }
    // Ses albums studio les plus écoutés (CATALOG_MAX_ALBUMS_PER_ARTIST), à l'import comme à la vérification.
    const top = [...studio.entries()].sort((x, y) => fansOf(y[1]) - fansOf(x[1])).slice(0, cfg.catalogMaxAlbumsPerArtist);
    const genreVotes = {};
    for (const [, a] of top) {
      const g = GENRE_MAP[a.genre_id];
      if (g) genreVotes[g] = (genreVotes[g] || 0) + 1;
    }
    const artistGenre = Object.entries(genreVotes).sort((a, b) => b[1] - a[1])[0]?.[0] || row.genre || 'pop';
    const artistId = await artistIdFor({ id: row.deezer_id, name, nb_fan: fans, genre: artistGenre }, releases);
    q('UPDATE cat_artists SET genre = COALESCE(genre, ?) WHERE id = ?').run(artistGenre, artistId);

    // Déjà au catalogue (le même album, ou une autre édition du même album) : passé sans requête.
    const have = new Set(q('SELECT title FROM cat_albums WHERE artist_id = ?').all(artistId).map((r) => baseTitle(r.title)));
    const albumTitles = new Set(q('SELECT title FROM cat_tracks WHERE artist_id = ?').all(artistId).map((r) => norm(splitFeat(r.title).title)));
    let tried = 0;
    let refused = 0;
    for (const [key, a] of top) {
      if (stopRequested || (!refresh && importedAlbums() >= cfg.catalogTarget)) return;
      if (have.has(key) || q('SELECT 1 FROM cat_albums WHERE deezer_id = ?').get(String(a.id))) continue;
      tried++;
      let full = null;
      try {
        full = await call(`/album/${a.id}`);
      } catch (err) {
        if (!(err instanceof Refused)) throw err;
        refused++;
      }
      if (!full) continue;
      const list = await albumTracks(a.id, full);
      if (!list) continue;
      if (saveAlbum(artistId, artistGenre, { ...a, ...full }, list)) {
        have.add(key);
        for (const t of list) albumTitles.add(norm(splitFeat(t.title, t.title_short).title));
      }
    }
    // Tous ses albums refusés : l'artiste sera retenté (et plusieurs artistes de suite arrêtent l'import).
    if (tried && refused === tried) throw new Refused(`${refused} album(s) refusé(s)`);

    if (!refresh) {
      // Single hors album : une carte promo par artiste (deux pour les plus suivis), comptées d'une reprise à l'autre.
      const perArtist = fans >= 1_000_000 ? 2 : 1;
      let added = q("SELECT COUNT(*) AS n FROM cat_tracks WHERE kind = 'promo' AND source = 'deezer' AND artist_id = ?").get(artistId).n;
      const singles = releases.filter((a) => a?.id && a.record_type === 'single' && !SKIP_TITLE.test(a.title || ''))
        .sort((a, b) => fansOf(b) - fansOf(a));
      for (const s of singles) {
        if (added >= perArtist || importedPromos() >= maxPromos() || stopRequested) break;
        if (albumTitles.has(norm(splitFeat(s.title).title))) continue;
        const full = await optional(call(`/album/${s.id}`));
        const first = full?.tracks?.data?.[0];
        if (!first || albumTitles.has(norm(splitFeat(first.title, first.title_short).title))) continue;
        if (savePromo(artistId, artistGenre, { ...s, ...full }, first)) added++;
      }

      const related = (await optional(call(`/artist/${row.deezer_id}/related?limit=20`)))?.data || [];
      for (const r of related) {
        if ((Number(r.nb_fan) || 0) >= cfg.catalogMinArtistFans) queueArtist(r, artistGenre, row.depth + 1);
      }
    }
    if (stopRequested) return;
    finish('done');
  }

  // ---------- tournée ------------------------------------------------------------------------

  /** Calibrage pendant l'import : toutes les 15 minutes, ou plus tôt tant que le catalogue est petit. */
  const calibrationDue = (since) => Date.now() - since >= CALIBRATE_EVERY_MS
    || sinceCalibration >= Math.max(500, (state().calibratedTracks || 0) / 4);

  async function importQueue() {
    const streak = [];
    let lastCalibration = Date.now();
    while (!stopRequested && importedAlbums() < cfg.catalogTarget) {
      const row = next.get();
      if (!row) break;
      try {
        await processArtist(row);
        streak.length = 0;
      } catch (err) {
        // Panne de Deezer : l'artiste reste en attente, la tournée s'arrête et reprendra plus tard.
        if (err instanceof Unavailable) throw err;
        // Erreur propre à cet artiste (données inattendues…) : on le note et on passe au suivant ; il sera retenté.
        q("UPDATE import_artists SET status = 'error', retries = retries + 1, updated_at = ? WHERE deezer_id = ?").run(Date.now(), row.deezer_id);
        setState({ lastError: `${row.name}: ${err.message}` });
        log.warn?.(`  Import du catalogue : ${row.name} mis de côté (${err.message}).`);
        streak.push(row.deezer_id);
        if (streak.length >= MAX_ERROR_STREAK) {
          // Plusieurs artistes d'affilée : le problème ne vient pas d'eux, ils restent en attente.
          q("UPDATE import_artists SET status = 'pending', retries = MAX(0, retries - 1) WHERE deezer_id IN (SELECT value FROM json_each(?))").run(JSON.stringify(streak));
          throw new Error(`${streak.length} artistes en erreur d'affilée (${err.message})`);
        }
      }
      if (calibrationDue(lastCalibration)) {
        calibrateIfNeeded();
        lastCalibration = Date.now();
      }
    }
  }

  const refreshDue = () => Date.now() - (state().refreshedAt || 0) >= REFRESH_EVERY_MS;

  /** Vérification quotidienne : nouveaux albums des artistes déjà importés, les moins récemment revus d'abord. */
  async function refresh() {
    const rows = q(`SELECT * FROM import_artists WHERE status = 'done' AND COALESCE(checked_at, 0) < ?
      ORDER BY COALESCE(checked_at, 0), fans DESC LIMIT ?`).all(Date.now() - REFRESH_AGE_MS, REFRESH_BATCH);
    for (const row of rows) {
      if (stopRequested) return;
      try {
        await processArtist(row, { refresh: true });
      } catch (err) {
        if (err instanceof Unavailable) throw err;
        // Vérification ratée pour cet artiste : il sera revu la semaine prochaine.
        q('UPDATE import_artists SET checked_at = ? WHERE deezer_id = ?').run(Date.now(), row.deezer_id);
        log.warn?.(`  Vérification des nouvelles sorties : ${row.name} passé (${err.message}).`);
      }
    }
    setState({ refreshedAt: Date.now() });
  }

  async function run() {
    stopRequested = false;
    refusals = 0;
    setState({ phase: 'running', startedAt: state().startedAt || Date.now(), lastError: null });
    // Artistes en erreur lors d'une tournée précédente : nouvelle chance, au plus MAX_ARTIST_RETRIES fois en tout.
    q("UPDATE import_artists SET status = 'pending' WHERE status = 'error' AND retries < ?").run(MAX_ARTIST_RETRIES);
    try {
      if (!state().discovered && importedAlbums() < cfg.catalogTarget) await discover();
      await importQueue();
      if (!stopRequested && refreshDue()) await refresh();
    } finally {
      // Même interrompue, une tournée qui a ajouté des morceaux les fait entrer dans les tirages.
      try {
        calibrateIfNeeded();
      } catch (err) {
        log.warn?.(`  Calibrage du catalogue impossible : ${err.message}`);
      }
    }
    const done = importedAlbums() >= cfg.catalogTarget || !next.get();
    // Premier import complet : les raretés sont gelées (une carte tirée Légendaire reste Légendaire).
    if (done && !stopRequested && !frozen()) {
      try {
        calibrate({ lock: true });
      } catch (err) {
        log.warn?.(`  Gel des raretés impossible : ${err.message}`);
      }
    }
    setState({ phase: stopRequested ? 'paused' : done ? 'done' : 'idle', finishedAt: done ? state().finishedAt || Date.now() : null });
  }

  function clearRetry() {
    clearTimeout(timer);
    timer = null;
    retryAt = null;
  }

  function scheduleRetry() {
    clearRetry();
    retryAt = Date.now() + retryMs;
    timer = setTimeout(() => {
      timer = null;
      retryAt = null;
      start();
    }, retryMs);
    timer.unref?.();
  }

  /**
   * Lance une tournée (import, puis vérification des nouvelles sorties si elle est due). force (bouton de l'espace
   * admin) : même si l'import automatique est coupé, et lève la pause.
   */
  function start({ force = false } = {}) {
    if (force && state().paused) setState({ paused: false });
    if (running) {
      // « Lancer » pendant qu'une pause s'achève : l'import repart dès que la tournée en cours s'est arrêtée.
      if (force && stopRequested) relaunch = true;
      return running;
    }
    if (!force && (cfg.catalogImport !== 'deezer' || state().paused)) return null;
    clearRetry();
    running = run()
      .catch((err) => {
        if (state().paused) {
          setState({ phase: 'paused', lastError: err.message });
          return;
        }
        setState({ phase: 'error', lastError: err.message });
        if (cfg.catalogImport !== 'deezer') return;
        log.warn?.(`  Import du catalogue interrompu (${err.message}) : nouvelle tentative dans ${Math.round(retryMs / MINUTE)} minutes.`);
        scheduleRetry();
      })
      .finally(() => {
        running = null;
        if (relaunch) {
          relaunch = false;
          start({ force: true });
        }
      });
    return running;
  }

  /** Y a-t-il quelque chose à faire ? (import en cours de route, vérification quotidienne due, calibrage en retard) */
  function hasWork() {
    const s = state();
    if (s.paused || cfg.catalogImport !== 'deezer') return false;
    if (importedAlbums() < cfg.catalogTarget && (!s.discovered || pendingArtists() > 0)) return true;
    return refreshDue() || deezerTracks() !== s.calibratedTracks;
  }

  function status() {
    const s = state();
    const counts = q('SELECT status, COUNT(*) AS n FROM import_artists GROUP BY status').all();
    const by = Object.fromEntries(counts.map((r) => [r.status, r.n]));
    const albums = importedAlbums();
    const totals = catalog.totals();
    return {
      mode: cfg.catalogImport,
      target: cfg.catalogTarget,
      running: !!running,
      // Une phase « en cours » restée en base (redémarrage) ne veut rien dire si rien ne tourne.
      phase: running ? 'running' : s.phase === 'running' ? 'idle' : s.phase,
      paused: !!s.paused,
      albums,
      totalAlbums: totals.albums,
      tracks: totals.tracks,
      promos: totals.promos,
      artists: { pending: by.pending || 0, done: by.done || 0, skipped: by.skipped || 0, error: by.error || 0 },
      requests,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      refreshedAt: s.refreshedAt || null,
      retryAt,
      lastError: s.lastError,
      // Raretés gelées depuis (PLAN.md 6.5) ; null pendant la construction initiale du catalogue.
      frozenAt: s.frozenAt || null,
    };
  }

  return {
    start,
    status,
    calibrate,
    frozen,
    hasWork,
    /** Pause enregistrée en base : elle tient après un redémarrage, jusqu'au bouton « Lancer » de l'espace admin. */
    pause() {
      relaunch = false;
      clearRetry();
      if (running) stopRequested = true;
      setState({ paused: true, ...(running ? {} : { phase: 'paused' }) });
    },
    /**
     * Peu après le démarrage s'il y a quelque chose à faire, puis toutes les heures : reprise de l'import tant que la
     * cible n'est pas atteinte, vérification des nouvelles sorties une fois par jour. Rien pendant une pause.
     */
    schedule() {
      if (cfg.catalogImport !== 'deezer') return;
      if (hasWork()) setTimeout(() => start(), 5000).unref?.();
      setInterval(() => {
        if (!running && hasWork()) start();
      }, HOUR).unref?.();
    },
  };
}
