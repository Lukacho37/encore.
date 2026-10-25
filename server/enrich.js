// Module « enrich » : provenance et enrichissement du catalogue (PLAN.md 3.4, 3.8, 4.3, 7.1, 8.3 P2.6). Chantier : P2-C.
//
// 1. Enrichissement MusicBrainz / Wikidata (données CC0) : pays des artistes (cat_artists.country, country_source),
//    identifiants MusicBrainz des artistes, des albums (groupe de parutions et parution) et des morceaux
//    (enregistrements), codes-barres et ISRC, identifiants Spotify et Apple Music lus dans les relations d'URL de
//    MusicBrainz et les déclarations de Wikidata. Seuls des identifiants et des faits sont gardés : jamais d'image,
//    jamais de paroles. Courtoisie : une requête par seconde au plus vers chaque service (MusicBrainz : 1,1 s), un
//    User-Agent qui nomme l'application, sa version et un contact pris dans la configuration (ENRICH_CONTACT,
//    LEGAL_CONTACT_EMAIL ou l'adresse publique du site ; sans contact, rien ne part), attente sur 429 / 503
//    (Retry-After), arrêt puis nouvelle tentative 15 minutes plus tard sur une panne. Tâche de fond reprise après un
//    redémarrage : la passe avance artiste par artiste (ordre d'arrivée au catalogue, la graine d'abord) et son
//    curseur est gardé en base (kv « enrich ») ; la pause tient jusqu'au bouton « Lancer » de l'espace admin. Une
//    nouvelle passe (30 jours après la précédente) ne retente que ce qui n'a pas été trouvé.
// 2. GET /api/catalog/listen/:type/:id : liens officiels et lecteurs intégrés (Deezer, Spotify, Apple Music) d'un
//    élément d'après external_ids ; un fournisseur détaché n'y figure plus ; `archived` pour un élément retiré.
// 3. Tâche « album-similar » : album_similar recalculé pour les albums qui ont reçu des notes (co-notes, puis artiste,
//    puis genre et décennie), un album par transaction.
// 4. Détachement d'un fournisseur (detachProvider, aussi utilisé par scripts/detach-provider.js) : plus aucun appel,
//    ses pochettes et ses liens bloqués, ses faits propres effacés sur demande ; les éléments confirmés par
//    MusicBrainz restent, les autres passent en status = 'withdrawn' (« archivé ») : cartes, notes, listes et vinyles
//    des joueurs sont gardés. Les filtres status = 'active' de la navigation et des tirages sont dans catalog.js (P2-E).
//
// Routes : GET /catalog/listen/:type/:id (joueur) ; admin : GET /enrich, POST /enrich/start, POST /enrich/pause,
// POST /enrich/similar, POST /providers/:source/detach { dryRun, purgeFacts, confirm }.
// API interne (deps.enrich) : status, start, pause, kick, listen, computeSimilar, detach, detachedProviders.
import fs from 'node:fs';
import { config as appConfig, isLocalUrl } from './config.js';
import { tx as runTx } from './db.js';
import { baseTitle, normText, providerDetached, providerKey } from './importer.js';
import {
  LISTEN_PROVIDERS, appleStorefront, cleanSourceId, deezerIdOf, embedFor, parseProviderUrl, searchUrl, sourceUrl,
} from '../shared/ids.js';

export const name = 'enrich';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

/** Écart minimal entre deux requêtes : MusicBrainz demande une requête par seconde au plus (marge de 10 %). */
export const MB_INTERVAL_MS = 1100;
export const WD_INTERVAL_MS = 1000;
const RETRY_MS = 15 * MINUTE; // nouvelle tentative après une panne
const REPASS_MS = 30 * DAY; // une nouvelle passe ne retente les introuvables qu'une fois par mois
const MAX_BUSY_RETRIES = 5; // 429 / 503 d'affilée sur une même requête
const BACKOFF_MS = 2 * SECOND;
const BACKOFF_MAX_MS = 60 * SECOND;
const TIMEOUT_MS = 15 * SECOND;
const ALBUMS_PER_ARTIST = 25; // albums d'un artiste cherchés par passe (les plus suivis d'abord)
const PROMOS_PER_ARTIST = 4;
const MIN_SCORE = 80; // score de pertinence de la recherche MusicBrainz (0-100)
const ARTIST_MIN_SCORE = 90;
/** Fournisseurs dont le catalogue peut être détaché (valeur de la colonne source de cat_*). */
export const DETACHABLE = ['deezer'];
const PROVIDER_PATTERNS = {
  deezer: { cover: '%dzcdn.net/%', link: 'https://www.deezer.com/%' },
};
/** Valeurs de cat_artists.country_source que l'enrichissement peut réécrire (jamais « seed » ni « manual »). */
const OWN_COUNTRY_SOURCES = ['musicbrainz', 'wikidata'];

const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '0';
  } catch {
    return '0';
  }
})();

// ---------- configuration ----------

/**
 * Réglages de l'enrichissement, lus dans l'environnement (config.js ne les connaît pas) :
 *   ENRICH                « musicbrainz » (par défaut, sauf pendant les tests) ou « off » ; toute autre valeur coupe ;
 *   ENRICH_CONTACT        contact du User-Agent (sinon LEGAL_CONTACT_EMAIL, sinon APP_URL s'il est public) ;
 *   MUSICBRAINZ_API_URL, WIKIDATA_API_URL : à ne changer que pour les tests ;
 *   ENRICH_INTERVAL_MS    écart entre deux requêtes, pris en compte pendant les tests seulement (jamais sous 1 s sinon).
 * `blocked` : null, « off » ou « contact_missing » (aucune requête ne part sans contact).
 */
export function enrichConfig(env = process.env, cfg = appConfig) {
  const raw = String(env.ENRICH ?? '').trim().toLowerCase();
  const mode = !raw ? (cfg.isTest ? 'off' : 'musicbrainz') : raw === 'musicbrainz' ? 'musicbrainz' : 'off';
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const contact = text(env.ENRICH_CONTACT) || cfg.legal?.contactEmail || (cfg.appUrl && !isLocalUrl(cfg.appUrl) ? cfg.appUrl : null);
  const wanted = Number(env.ENRICH_INTERVAL_MS);
  const testInterval = cfg.isTest && env.ENRICH_INTERVAL_MS !== undefined && Number.isFinite(wanted) && wanted >= 0 ? wanted : null;
  return {
    mode,
    contact,
    userAgent: `AlbumMania/${VERSION} ( ${contact || 'contact non configuré'} )`,
    mbUrl: (text(env.MUSICBRAINZ_API_URL) || 'https://musicbrainz.org/ws/2').replace(/\/$/, ''),
    wdUrl: text(env.WIKIDATA_API_URL) || 'https://www.wikidata.org/w/api.php',
    mbIntervalMs: testInterval ?? MB_INTERVAL_MS,
    wdIntervalMs: testInterval ?? WD_INTERVAL_MS,
    backoffMs: testInterval != null ? Math.max(1, testInterval) : BACKOFF_MS,
    blocked: mode === 'off' ? 'off' : !contact ? 'contact_missing' : null,
  };
}

// ---------- petits outils ----------

/** Service injoignable, qui bloque ou qui refuse en série : la passe s'arrête et reprendra plus tard. */
export class Unavailable extends Error {}
/** Pause demandée pendant une attente ou entre deux requêtes. */
class Stopped extends Error {}

const json = (v) => JSON.stringify(v);
const parse = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};
const fold = (s) => normText(s);
const sameTitle = (a, b) => !!baseTitle(a) && baseTitle(a) === baseTitle(b);
/** Texte d'une requête Lucene entre guillemets : guillemets et barres obliques inverses retirés. */
const quoted = (s) => `"${String(s || '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
/** Titre cherché : sans « (Deluxe Edition) », « [Remastered] »… (le titre de base sert ensuite à comparer). */
const searchTitle = (t) => String(t || '').replace(/\s*[([][^)\]]*[)\]]/g, ' ').trim() || String(t || '');
/** Code pays ISO 3166-1 alpha-2 réel (les codes « X? » de MusicBrainz — Monde, Europe… — ne sont pas des pays). */
const countryCode = (c) => {
  const v = String(c || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) && !/^X[A-Z]$/.test(v) && v !== 'ZZ' && v !== 'AA' ? v : null;
};

/** Noms crédités (« Jay-Z & Kanye West », puis chaque artiste) et artistes MusicBrainz d'un artist-credit. */
function creditOf(credits) {
  const list = Array.isArray(credits) ? credits : [];
  const joined = list.map((c) => `${c?.name ?? c?.artist?.name ?? ''}${c?.joinphrase ?? ''}`).join('');
  return { names: [joined, ...list.map((c) => c?.artist?.name || c?.name)].filter(Boolean), artists: list.map((c) => c?.artist).filter((a) => a?.id) };
}
const creditMatches = (credits, artistName, mbid) => {
  const { names, artists } = creditOf(credits);
  if (mbid && artists.some((a) => a.id === mbid)) return true;
  const want = fold(artistName);
  return !!want && names.some((n) => fold(n) === want);
};

// ---------- moteur d'enrichissement ----------

/**
 * Moteur MusicBrainz / Wikidata. `core` : { db }. `opts` : réglages d'enrichConfig() (par défaut ceux de
 * l'environnement), plus `fetchImpl`, `retryMs`, `log` pour les tests.
 */
export function createEnricher(core, opts = {}) {
  const { db } = core;
  const settings = { ...enrichConfig(), ...opts };
  const { fetchImpl = (...a) => fetch(...a), retryMs = RETRY_MS, log = console } = opts;
  const tx = (fn) => (db.isTransaction ? fn() : runTx(db, fn));
  const statements = new Map();
  const q = (sql) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    return st;
  };

  const kvGet = (key, fallback) => parse(q('SELECT value FROM kv WHERE key = ?').get(key)?.value, fallback);
  const kvSet = (key, value) => q('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, json(value));
  const DEFAULT_STATE = {
    phase: 'idle', paused: false, cursor: 0, pass: 1, passStartedAt: null, passFinishedAt: null, startedAt: null,
    finishedAt: null, lastError: null, artistsDone: 0,
  };
  const state = () => ({ ...DEFAULT_STATE, ...kvGet('enrich', {}) });
  const setState = (patch) => kvSet('enrich', { ...state(), ...patch });

  // Après un redémarrage en pleine passe, plus rien ne tourne : la passe sera reprise (resumeAfterRestart).
  const interrupted = state().phase === 'running';
  if (interrupted) setState({ phase: state().paused ? 'paused' : 'idle' });

  let running = null;
  let stopRequested = false;
  let timer = null;
  let retryAt = null;
  let wake = null;
  const last = { mb: 0, wd: 0 };
  const requests = { musicbrainz: 0, wikidata: 0 };
  const countries = new Map(Object.entries(kvGet('enrich:countries', {}))); // élément Wikidata d'un pays → code ISO

  /** Attente que la pause interrompt. */
  function sleep(ms) {
    return new Promise((resolve) => {
      let t = null;
      const done = () => {
        clearTimeout(t);
        if (wake === done) wake = null;
        resolve();
      };
      t = setTimeout(done, Math.max(0, ms));
      wake = done;
    });
  }
  const checkStop = () => {
    if (stopRequested) throw new Stopped('pause');
  };

  /** Une requête à la fois par service, à l'écart minimal de la précédente. */
  async function pace(kind) {
    const interval = kind === 'mb' ? settings.mbIntervalMs : settings.wdIntervalMs;
    const gap = interval - (Date.now() - last[kind]);
    if (gap > 0) await sleep(gap);
    checkStop();
    last[kind] = Date.now();
  }

  const retryAfterMs = (res) => {
    const v = res.headers?.get?.('retry-after');
    if (v == null) return null;
    const s = Number(v);
    if (Number.isFinite(s)) return Math.min(BACKOFF_MAX_MS, Math.max(0, s * SECOND));
    const at = Date.parse(v);
    return Number.isFinite(at) ? Math.min(BACKOFF_MAX_MS, Math.max(0, at - Date.now())) : null;
  };
  const backoff = (attempt) => Math.min(BACKOFF_MAX_MS, settings.backoffMs * 2 ** attempt);
  const waitThen = async (ms) => {
    await sleep(ms);
    checkStop();
  };

  /**
   * GET JSON poli : écart minimal respecté, User-Agent de l'application. Renvoie les données, ou null pour une
   * ressource absente ou refusée (4xx). Lève Unavailable sur une panne qui dure (réseau, 5xx), un blocage (401 / 403)
   * ou une suite de 429 / 503 (attente Retry-After, sinon de plus en plus longue, entre deux essais).
   */
  async function getJson(kind, url) {
    const service = kind === 'mb' ? 'musicbrainz' : 'wikidata';
    let busy = 0;
    for (let attempt = 0; ; attempt++) {
      await pace(kind);
      requests[service] += 1;
      let res;
      try {
        res = await fetchImpl(url, { headers: { 'User-Agent': settings.userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        if (attempt < 2) {
          await waitThen(backoff(attempt));
          continue;
        }
        throw new Unavailable(`${service}: ${err.message}`);
      }
      if (res.status === 429 || res.status === 503) {
        if (busy++ < MAX_BUSY_RETRIES) {
          await waitThen(retryAfterMs(res) ?? backoff(busy));
          continue;
        }
        throw new Unavailable(`${service}: HTTP ${res.status}`);
      }
      if (res.status === 401 || res.status === 403) throw new Unavailable(`${service}: HTTP ${res.status}`);
      if (res.status >= 500) {
        if (attempt < 2) {
          await waitThen(backoff(attempt));
          continue;
        }
        throw new Unavailable(`${service}: HTTP ${res.status}`);
      }
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      // Wikidata en retard de réplication (maxlag) : même politesse qu'un 503.
      if (data?.error?.code === 'maxlag' && busy++ < MAX_BUSY_RETRIES) {
        await waitThen(retryAfterMs(res) ?? backoff(busy));
        continue;
      }
      if (!data) {
        if (attempt < 2) {
          await waitThen(backoff(attempt));
          continue;
        }
        throw new Unavailable(`${service}: réponse illisible`);
      }
      return data.error ? null : data;
    }
  }
  const mb = (path) => getJson('mb', `${settings.mbUrl}${path}${path.includes('?') ? '&' : '?'}fmt=json`);
  const wd = (ids) => getJson('wd', `${settings.wdUrl}?action=wbgetentities&ids=${ids.join('|')}&props=claims&format=json&maxlag=5`);

  // ----- écritures -----

  const insExt = q(`INSERT INTO external_ids (entity_type, entity_id, source, source_id, url, confidence, matched_by, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity_type, entity_id, source, source_id) DO UPDATE SET url = COALESCE(excluded.url, external_ids.url),
      confidence = MAX(external_ids.confidence, excluded.confidence), fetched_at = excluded.fetched_at`);
  /** Identifiant externe (format vérifié) ; un identifiant déjà relié à un autre élément lui reste. */
  function putExt(type, entityId, source, value, { url = null, confidence = 1, by = 'musicbrainz' } = {}) {
    const v = cleanSourceId(source, value);
    if (!v) return false;
    if (source !== 'isrc') {
      const owner = q("SELECT entity_id FROM external_ids WHERE source = ? AND source <> 'isrc' AND entity_type = ? AND source_id = ?").get(source, type, v);
      if (owner && owner.entity_id !== entityId) return false;
    }
    insExt.run(type, entityId, source, v, url, confidence, by, Date.now());
    return true;
  }
  const extOf = (type, entityId, source) => q('SELECT source_id, url, matched_by FROM external_ids WHERE entity_type = ? AND entity_id = ? AND source = ?')
    .all(type, entityId, source);
  const hasExt = (type, entityId, source) => !!q('SELECT 1 FROM external_ids WHERE entity_type = ? AND entity_id = ? AND source = ? LIMIT 1').get(type, entityId, source);

  /** Relations d'URL de MusicBrainz → identifiants Spotify, Apple Music, Discogs du bon type ; renvoie l'élément Wikidata. */
  function storeRelations(type, entityId, relations) {
    let wikidata = null;
    for (const rel of Array.isArray(relations) ? relations : []) {
      const found = parseProviderUrl(rel?.url?.resource);
      if (!found) continue;
      if (found.source === 'wikidata') {
        if (rel.type === 'wikidata' || !wikidata) wikidata = found.id;
        continue;
      }
      if (found.source === 'deezer' || found.type !== type) continue;
      // Une adresse Apple Music garde sa vitrine (pays) : le lien direct y mène.
      const url = found.source === 'apple' && found.storefront ? rel.url.resource : null;
      putExt(type, entityId, found.source, found.id, { url, by: 'musicbrainz' });
    }
    if (wikidata) putExt(type, entityId, 'wikidata', wikidata, { by: 'musicbrainz' });
    return wikidata;
  }

  /** Valeurs d'une déclaration Wikidata (rang déprécié écarté, rang préféré d'abord). */
  function claimValues(entity, prop) {
    const list = (entity?.claims?.[prop] || []).filter((c) => c?.rank !== 'deprecated');
    list.sort((a, b) => (b.rank === 'preferred') - (a.rank === 'preferred'));
    return list.map((c) => c?.mainsnak?.datavalue?.value).filter((v) => v != null);
  }
  const claimStrings = (entity, prop) => claimValues(entity, prop).filter((v) => typeof v === 'string');
  const claimItems = (entity, prop) => claimValues(entity, prop).map((v) => v?.id).filter((v) => typeof v === 'string' && /^Q\d+$/.test(v));

  async function wikidataEntity(qid) {
    const data = await wd([qid]);
    return data?.entities?.[qid] || null;
  }

  /** Code ISO d'un pays Wikidata (P297), gardé en mémoire et en base : une requête par pays, une seule fois. */
  async function countryOfItem(qid) {
    if (countries.has(qid)) return countries.get(qid);
    const entity = await wikidataEntity(qid);
    const code = countryCode(claimStrings(entity, 'P297')[0]);
    countries.set(qid, code);
    kvSet('enrich:countries', Object.fromEntries(countries));
    return code;
  }

  // ----- albums -----

  /** Meilleure parution d'une recherche : titre de base identique, artiste crédité, score, même nombre de pistes. */
  function pickRelease(releases, album, artistName, artistMbid) {
    let best = null;
    let bestScore = -1;
    for (const r of Array.isArray(releases) ? releases : []) {
      if ((Number(r?.score) || 0) < MIN_SCORE || !r?.id || !sameTitle(r.title, album.title)) continue;
      if (!creditMatches(r['artist-credit'], artistName, artistMbid)) continue;
      const count = Number(r['track-count']) || (r.media || []).reduce((s, m) => s + (Number(m?.['track-count']) || 0), 0);
      let score = Number(r.score) || 0;
      if (count && count === album.track_count) score += 30;
      if (r.status === 'Official') score += 10;
      if (r['release-group']?.['primary-type'] === 'Album') score += 10;
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    if (!best) return null;
    return { release: best, confidence: (Number(best['track-count']) || 0) === album.track_count ? 0.9 : 0.75 };
  }

  /** Morceaux de l'album ↔ pistes de la parution : même nombre → par position, sinon par titre (chacune une fois). */
  function mapRecordings(albumId, media) {
    const ours = q('SELECT id, n, title FROM cat_tracks WHERE album_id = ? ORDER BY n').all(albumId);
    const theirs = (Array.isArray(media) ? media : []).flatMap((m) => (Array.isArray(m?.tracks) ? m.tracks : [])).filter((t) => t?.recording?.id);
    if (ours.length === theirs.length) return ours.map((t, i) => [t, theirs[i]]);
    const used = new Set();
    const out = [];
    for (const t of ours) {
      const j = theirs.findIndex((p, k) => !used.has(k) && sameTitle(p.title || p.recording.title, t.title));
      if (j >= 0) {
        used.add(j);
        out.push([t, theirs[j]]);
      }
    }
    return out;
  }

  /**
   * Relie un album à MusicBrainz : par son code-barres s'il est connu (sûr), sinon par titre et artiste. La parution
   * trouvée est lue une fois (groupe de parutions, relations d'URL des deux, enregistrements et ISRC), puis Wikidata
   * complète les identifiants Spotify / Apple Music. Renvoie l'identifiant MusicBrainz de l'artiste crédité, ou null.
   */
  async function enrichAlbum(artist, album, artistMbid) {
    let pick = null;
    let how = 'title';
    const upc = extOf('album', album.id, 'upc')[0]?.source_id;
    if (upc) {
      const found = await mb(`/release?query=${encodeURIComponent(`barcode:${upc}`)}&limit=5`);
      const r = (found?.releases || []).find((x) => x?.id && String(x.barcode || '').replace(/^0+/, '') === upc.replace(/^0+/, ''));
      if (r) {
        pick = { release: r, confidence: 1 };
        how = 'upc';
      }
    }
    if (!pick) {
      const query = `release:${quoted(searchTitle(album.title))} AND artist:${quoted(artist.name)}`;
      const found = await mb(`/release?query=${encodeURIComponent(query)}&limit=10`);
      pick = pickRelease(found?.releases, album, artist.name, artistMbid);
    }
    if (!pick) return null;
    const full = await mb(`/release/${pick.release.id}?inc=release-groups+url-rels+release-group-level-rels+recordings+isrcs+artist-credits`);
    const rg = full?.['release-group'] || pick.release['release-group'];
    if (!rg?.id) return null;
    let wikidata = null;
    let creditMbid = null;
    tx(() => {
      const rgUrl = sourceUrl('musicbrainz', 'album', rg.id, { mbType: 'release-group' });
      putExt('album', album.id, 'musicbrainz', rg.id, { url: rgUrl, confidence: pick.confidence, by: how });
      putExt('album', album.id, 'musicbrainz', pick.release.id, { url: sourceUrl('musicbrainz', 'album', pick.release.id, { mbType: 'release' }), confidence: pick.confidence, by: how });
      if (full?.barcode) putExt('album', album.id, 'upc', full.barcode, { confidence: pick.confidence, by: 'musicbrainz' });
      wikidata = storeRelations('album', album.id, [...(full?.relations || []), ...(rg.relations || [])]);
      for (const [ours, theirs] of mapRecordings(album.id, full?.media)) {
        putExt('track', ours.id, 'musicbrainz', theirs.recording.id, { confidence: pick.confidence, by: how });
        for (const isrc of theirs.recording.isrcs || []) putExt('track', ours.id, 'isrc', isrc, { confidence: pick.confidence, by: 'musicbrainz' });
      }
      // Artiste crédité : son identifiant MusicBrainz, si son nom est bien celui de notre artiste.
      const credited = creditOf(full?.['artist-credit'] || pick.release['artist-credit']).artists.find((a) => fold(a.name) === fold(artist.name));
      creditMbid = credited?.id || null;
      if (creditMbid && !hasExt('artist', artist.id, 'musicbrainz')) putExt('artist', artist.id, 'musicbrainz', creditMbid, { confidence: pick.confidence, by: 'album' });
    });
    if (wikidata && !(hasExt('album', album.id, 'spotify') && hasExt('album', album.id, 'apple'))) {
      const entity = await wikidataEntity(wikidata);
      // Contrôle croisé : l'élément Wikidata doit désigner le même groupe de parutions (P436), s'il en déclare un.
      const groups = claimStrings(entity, 'P436');
      if (entity && (!groups.length || groups.includes(rg.id))) {
        tx(() => {
          for (const id of claimStrings(entity, 'P2205')) putExt('album', album.id, 'spotify', id, { by: 'wikidata' });
          for (const id of claimStrings(entity, 'P2281')) putExt('album', album.id, 'apple', id, { by: 'wikidata' });
        });
      }
    }
    return creditMbid;
  }

  /** Promo (single hors album) : enregistrement MusicBrainz par son ISRC, sinon par titre et artiste. */
  async function enrichPromo(artist, track, artistMbid) {
    const isrc = extOf('track', track.id, 'isrc')[0]?.source_id;
    let rec = null;
    let how = 'isrc';
    if (isrc) {
      const found = await mb(`/isrc/${isrc}?inc=artist-credits`);
      rec = (found?.recordings || []).find((r) => r?.id && sameTitle(r.title, track.title)) || null;
    }
    if (!rec) {
      how = 'title';
      const query = `recording:${quoted(track.title)} AND artist:${quoted(artist.name)}`;
      const found = await mb(`/recording?query=${encodeURIComponent(query)}&limit=5`);
      rec = (found?.recordings || []).find((r) => (Number(r?.score) || 0) >= ARTIST_MIN_SCORE && r?.id && sameTitle(r.title, track.title)
        && creditMatches(r['artist-credit'], artist.name, artistMbid)) || null;
    }
    if (!rec) return;
    tx(() => {
      putExt('track', track.id, 'musicbrainz', rec.id, { confidence: how === 'isrc' ? 1 : 0.7, by: how });
      for (const code of rec.isrcs || []) putExt('track', track.id, 'isrc', code, { by: 'musicbrainz' });
    });
  }

  // ----- artistes -----

  /** Recherche par nom : un seul artiste au nom identique et au score élevé, sinon rien (homonymes). */
  async function searchArtist(artist) {
    const found = await mb(`/artist?query=${encodeURIComponent(`artist:${quoted(artist.name)}`)}&limit=5`);
    const same = (found?.artists || []).filter((a) => a?.id && (Number(a.score) || 0) >= ARTIST_MIN_SCORE
      && (fold(a.name) === fold(artist.name) || fold(a['sort-name']) === fold(artist.name)));
    if (same.length !== 1) return null;
    putExt('artist', artist.id, 'musicbrainz', same[0].id, { confidence: 0.7, by: 'name' });
    return same[0].id;
  }

  /** Pays d'un artiste MusicBrainz : son pays, sinon celui de sa zone (code ISO 3166-1, ou préfixe ISO 3166-2). */
  const mbCountry = (a) => countryCode(a?.country) || countryCode(a?.area?.['iso-3166-1-codes']?.[0])
    || countryCode(String(a?.area?.['iso-3166-2-codes']?.[0] || '').slice(0, 2));

  function setCountry(artistId, code, source) {
    if (!code) return false;
    return q(`UPDATE cat_artists SET country = ?, country_source = ?
      WHERE id = ? AND (country_source IS NULL OR country_source IN (SELECT value FROM json_each(?)))`)
      .run(code, source, artistId, json(OWN_COUNTRY_SOURCES)).changes > 0;
  }

  async function lookupArtist(artist, mbid) {
    const data = await mb(`/artist/${mbid}?inc=url-rels`);
    if (!data?.id) return;
    let wikidata = null;
    tx(() => {
      setCountry(artist.id, mbCountry(data), 'musicbrainz');
      wikidata = storeRelations('artist', artist.id, data.relations);
    });
    const needCountry = !q('SELECT country_source FROM cat_artists WHERE id = ?').get(artist.id)?.country_source;
    const needIds = !(hasExt('artist', artist.id, 'spotify') && hasExt('artist', artist.id, 'apple'));
    if (!wikidata || !(needCountry || needIds)) return;
    const entity = await wikidataEntity(wikidata);
    const mbids = claimStrings(entity, 'P434');
    if (!entity || (mbids.length && !mbids.includes(mbid))) return;
    let country = null;
    if (needCountry) {
      // Pays d'origine (groupes, P495), sinon nationalité (personnes, P27) : une seule valeur, sinon on s'abstient.
      const items = claimItems(entity, 'P495');
      const pool = items.length ? items : claimItems(entity, 'P27');
      if (pool.length === 1) country = await countryOfItem(pool[0]);
    }
    tx(() => {
      for (const id of claimStrings(entity, 'P1902')) putExt('artist', artist.id, 'spotify', id, { by: 'wikidata' });
      for (const id of claimStrings(entity, 'P2850')) putExt('artist', artist.id, 'apple', id, { by: 'wikidata' });
      if (country) setCountry(artist.id, country, 'wikidata');
    });
  }

  /** Rien à gagner : pays de source connue, identifiants Spotify ou Apple et Wikidata déjà là. */
  const artistComplete = (artist) => !!q('SELECT country_source FROM cat_artists WHERE id = ?').get(artist.id)?.country_source
    && (hasExt('artist', artist.id, 'spotify') || hasExt('artist', artist.id, 'apple')) && hasExt('artist', artist.id, 'wikidata');

  /** Un artiste : ses albums les plus suivis pas encore reliés, ses promos, puis lui-même. */
  async function processArtist(artist) {
    let mbid = extOf('artist', artist.id, 'musicbrainz')[0]?.source_id || null;
    const albums = q(`SELECT al.id, al.title, al.track_count FROM cat_albums al WHERE al.artist_id = ? AND al.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM external_ids e WHERE e.entity_type = 'album' AND e.entity_id = al.id AND e.source = 'musicbrainz')
      ORDER BY al.fans DESC, al.id LIMIT ?`).all(artist.id, ALBUMS_PER_ARTIST);
    for (const album of albums) {
      checkStop();
      if (await enrichAlbum(artist, album, mbid) && !mbid) mbid = extOf('artist', artist.id, 'musicbrainz')[0]?.source_id || null;
    }
    const promos = q(`SELECT t.id, t.title FROM cat_tracks t WHERE t.artist_id = ? AND t.kind = 'promo' AND t.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM external_ids e WHERE e.entity_type = 'track' AND e.entity_id = t.id AND e.source = 'musicbrainz')
      ORDER BY t.pop DESC, t.id LIMIT ?`).all(artist.id, PROMOS_PER_ARTIST);
    for (const promo of promos) {
      checkStop();
      await enrichPromo(artist, promo, mbid);
    }
    checkStop();
    if (!mbid) mbid = await searchArtist(artist);
    if (mbid && !artistComplete(artist)) await lookupArtist(artist, mbid);
  }

  // ----- passe -----

  const nextArtist = (cursor) => q('SELECT rowid AS rid, id, name, status FROM cat_artists WHERE rowid > ? ORDER BY rowid LIMIT 1').get(cursor);
  const repassDue = (s) => !!s.passFinishedAt && Date.now() - s.passFinishedAt >= REPASS_MS;

  function hasWork() {
    const s = state();
    if (settings.blocked || s.paused) return false;
    return !!nextArtist(s.cursor || 0) || repassDue(s);
  }

  async function run() {
    stopRequested = false;
    let s = state();
    // Passe terminée depuis un mois et rien de nouveau : nouvelle passe (seulement ce qui manque encore).
    if (!nextArtist(s.cursor || 0) && repassDue(s)) {
      setState({ cursor: 0, pass: (s.pass || 1) + 1, passStartedAt: Date.now(), passFinishedAt: null, artistsDone: 0 });
      s = state();
    }
    setState({ phase: 'running', startedAt: s.startedAt || Date.now(), passStartedAt: s.passStartedAt || Date.now(), lastError: null });
    let cursor = s.cursor || 0;
    for (;;) {
      checkStop();
      const artist = nextArtist(cursor);
      if (!artist) break;
      if (artist.status === 'active') await processArtist(artist);
      cursor = artist.rid;
      setState({ cursor, artistsDone: (state().artistsDone || 0) + 1 });
    }
    setState({ phase: 'done', finishedAt: Date.now(), passFinishedAt: Date.now() });
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

  /** Lance (ou reprend) la passe. `force` (bouton de l'espace admin) lève la pause. */
  function start({ force = false } = {}) {
    if (force && state().paused) setState({ paused: false, phase: 'idle' });
    if (running) return running;
    if (settings.blocked || state().paused) return null;
    clearRetry();
    running = run()
      .catch((err) => {
        if (err instanceof Stopped || state().paused) {
          setState({ phase: 'paused' });
          return;
        }
        setState({ phase: 'error', lastError: err.message });
        if (err instanceof Unavailable) {
          log.warn?.(`  Enrichissement du catalogue interrompu (${err.message}) : nouvelle tentative dans ${Math.round(retryMs / MINUTE)} minutes.`);
          scheduleRetry();
        } else {
          log.error?.('[enrich] passe en erreur :', err);
        }
      })
      .finally(() => {
        running = null;
        stopRequested = false;
      });
    return running;
  }

  /** Pause enregistrée en base (elle tient après un redémarrage) ; la requête en cours se termine, rien d'autre ne part. */
  function pause() {
    clearRetry();
    setState({ paused: true, ...(running ? {} : { phase: 'paused' }) });
    if (running) {
      stopRequested = true;
      wake?.();
    }
    return running;
  }

  /** Tâche de nuit « enrich » : lance la passe en arrière-plan s'il y a du travail (sans l'attendre). */
  function kick() {
    if (running) return { started: false, running: true };
    if (!hasWork()) return { started: false, running: false };
    start();
    return { started: !!running, running: !!running };
  }

  /** Reprise d'une passe interrompue par l'arrêt du serveur, peu après le démarrage. */
  function resumeAfterRestart(delayMs = 15 * SECOND) {
    if (!interrupted || settings.blocked) return false;
    setTimeout(() => {
      if (!running && hasWork()) start();
    }, delayMs).unref?.();
    return true;
  }

  return {
    start, pause, kick, hasWork, resumeAfterRestart, state,
    settings: () => ({ ...settings }),
    requests: () => ({ ...requests }),
    get running() {
      return !!running;
    },
    get retryAt() {
      return retryAt;
    },
    /** Promesse de la passe en cours, ou null (tests). */
    get current() {
      return running;
    },
  };
}

// ---------- albums proches (tâche « album-similar ») ----------

const SIMILAR_TOP = 12;
const SIMILAR_CORATED = 6;
const SIMILAR_ARTIST = 3;
const SIMILAR_FANS = 200; // amateurs (note ≥ 8) lus par album, les plus récents
const SIMILAR_MIN = 3; // co-amateurs minimum
const SIMILAR_BATCH = 4000; // albums recalculés par passage de la tâche

/**
 * Recalcule album_similar pour les albums notés depuis le dernier passage (kv « album-similar »). Score : co-notes
 * (cosinus des amateurs, notes ≥ 8 ; 0,5 à 1), puis autres albums de l'artiste (≈ 0,4), puis même genre et même
 * décennie, les plus suivis (≈ 0,2). Un album par transaction, une pause toutes les 25 : le serveur reste disponible.
 */
export async function computeSimilar(db, { batch = SIMILAR_BATCH, yieldEvery = 25 } = {}) {
  const q = (sql) => db.prepare(sql);
  const mark = parse(q("SELECT value FROM kv WHERE key = 'album-similar'").get()?.value, {});
  const since = Number(mark.since) || 0;
  const changed = q(`SELECT item_id AS id, MAX(updated_at) AS at FROM ratings WHERE updated_at > ? AND item_type = 'album'
    GROUP BY item_id ORDER BY at, item_id LIMIT ?`).all(since, batch);
  const fansOf = q(`SELECT user_id FROM ratings WHERE item_type = 'album' AND item_id = ? AND score >= 8 ORDER BY updated_at DESC LIMIT ${SIMILAR_FANS}`);
  const coRated = q(`SELECT r.item_id AS id, COUNT(*) AS n FROM ratings r JOIN cat_albums al ON al.id = r.item_id AND al.status = 'active'
    WHERE r.user_id IN (SELECT value FROM json_each(?)) AND r.item_type = 'album' AND r.score >= 8 AND r.item_id <> ?
    GROUP BY r.item_id HAVING n >= ${SIMILAR_MIN} ORDER BY n DESC, r.item_id LIMIT 40`);
  const statsOf = q("SELECT dist FROM rating_stats WHERE item_type = 'album' AND item_id = ?");
  const baseOf = q("SELECT id, artist_id, genre, year FROM cat_albums WHERE id = ? AND status = 'active'");
  const byArtist = q(`SELECT id FROM cat_albums WHERE artist_id = ? AND id <> ? AND status = 'active' ORDER BY fans DESC, id LIMIT ${SIMILAR_ARTIST}`);
  const byGenre = q(`SELECT id, artist_id FROM cat_albums WHERE genre = ? AND year BETWEEN ? AND ? AND status = 'active' AND id <> ?
    ORDER BY fans DESC, id LIMIT 40`);
  const del = q('DELETE FROM album_similar WHERE album_id = ?');
  const ins = q('INSERT OR REPLACE INTO album_similar (album_id, similar_id, score, reason, computed_at) VALUES (?, ?, ?, ?, ?)');
  const likesOf = (id) => {
    const dist = parse(statsOf.get(id)?.dist, []);
    return (Number(dist[8]) || 0) + (Number(dist[9]) || 0) + (Number(dist[10]) || 0);
  };
  let albums = 0;
  let rows = 0;
  let last = since;
  for (const [i, { id, at }] of changed.entries()) {
    const base = baseOf.get(id);
    const picks = [];
    const seen = new Set([id]);
    const add = (sid, score, reason) => {
      seen.add(sid);
      picks.push([sid, score, reason]);
    };
    if (base) {
      const fans = fansOf.all(id).map((r) => r.user_id);
      if (fans.length >= SIMILAR_MIN) {
        const scored = coRated.all(json(fans), id).map((r) => ({ id: r.id, score: r.n / Math.sqrt(fans.length * Math.max(r.n, likesOf(r.id))) }))
          .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
        for (const r of scored.slice(0, SIMILAR_CORATED)) add(r.id, Math.min(1, 0.5 + r.score / 2), 'corated');
      }
      byArtist.all(base.artist_id, id).forEach((r, k) => {
        if (!seen.has(r.id) && picks.length < SIMILAR_TOP) add(r.id, 0.4 - k * 0.01, 'artist');
      });
      if (base.genre && base.year) {
        const d = Math.floor(base.year / 10) * 10;
        const perArtist = new Map();
        let k = 0;
        for (const r of byGenre.all(base.genre, d, d + 9, id)) {
          if (picks.length >= SIMILAR_TOP) break;
          if (seen.has(r.id) || r.artist_id === base.artist_id || (perArtist.get(r.artist_id) || 0) >= 2) continue;
          perArtist.set(r.artist_id, (perArtist.get(r.artist_id) || 0) + 1);
          add(r.id, 0.2 - (k++) * 0.005, 'genre_decade');
        }
      }
    }
    const now = Date.now();
    runTx(db, () => {
      del.run(id);
      for (const [sid, score, reason] of picks) ins.run(id, sid, score, reason, now);
    });
    albums += 1;
    rows += picks.length;
    last = Math.max(last, Number(at) || 0);
    if ((i + 1) % yieldEvery === 0) await new Promise((r) => setImmediate(r));
  }
  const done = changed.length < batch;
  // Lot plein : on reprendra juste avant le dernier instant traité (des albums notés au même instant peuvent rester).
  q("INSERT INTO kv (key, value) VALUES ('album-similar', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(json({ since: done ? last : Math.max(since, last - 1), at: Date.now(), albums, rows, done }));
  return { albums, rows, done };
}

// ---------- détachement d'un fournisseur ----------

/**
 * Plan de détachement (dans une table temporaire de la connexion) : éléments du fournisseur `source` qu'aucune autre
 * source ne confirme (pas d'identifiant MusicBrainz, trouvé par UPC, ISRC ou titre et artiste), et ce que gardent les
 * joueurs. Renvoie le compte rendu ; la table temporaire sert ensuite à appliquer par lots.
 */
function planDetach(db, source) {
  const q = (sql) => db.prepare(sql);
  db.exec(`CREATE TEMP TABLE IF NOT EXISTS detach_items (rid INTEGER PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL);
    DELETE FROM temp.detach_items;
    CREATE UNIQUE INDEX IF NOT EXISTS temp.detach_items_kid ON detach_items(kind, id);`);
  const confirmed = (type, col) => `EXISTS (SELECT 1 FROM external_ids e WHERE e.entity_type = '${type}' AND e.entity_id = ${col} AND e.source = 'musicbrainz')`;
  q(`INSERT INTO temp.detach_items (kind, id) SELECT 'album', al.id FROM cat_albums al
    WHERE al.source = ? AND al.status = 'active' AND NOT ${confirmed('album', 'al.id')} ORDER BY al.rowid`).run(source);
  q(`INSERT INTO temp.detach_items (kind, id) SELECT 'track', t.id FROM temp.detach_items d JOIN cat_tracks t ON t.album_id = d.id
    WHERE d.kind = 'album' AND t.status = 'active' ORDER BY d.rid, t.n`).run();
  q(`INSERT INTO temp.detach_items (kind, id) SELECT 'track', t.id FROM cat_tracks t
    WHERE t.kind = 'promo' AND t.source = ? AND t.status = 'active' AND NOT ${confirmed('track', 't.id')} ORDER BY t.rowid`).run(source);
  // Un artiste reste tant qu'il est confirmé ou qu'il garde un album ou une promo au catalogue.
  q(`INSERT INTO temp.detach_items (kind, id) SELECT 'artist', ar.id FROM cat_artists ar
    WHERE ar.source = ? AND ar.status = 'active' AND NOT ${confirmed('artist', 'ar.id')}
      AND NOT EXISTS (SELECT 1 FROM cat_albums al WHERE al.artist_id = ar.id AND al.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM temp.detach_items d WHERE d.kind = 'album' AND d.id = al.id))
      AND NOT EXISTS (SELECT 1 FROM cat_tracks t WHERE t.artist_id = ar.id AND t.kind = 'promo' AND t.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM temp.detach_items d WHERE d.kind = 'track' AND d.id = t.id))
    ORDER BY ar.rowid`).run(source);
  const count = (kind) => q('SELECT COUNT(*) AS n FROM temp.detach_items WHERE kind = ?').get(kind).n;
  const total = (table, extra = '') => q(`SELECT COUNT(*) AS n FROM ${table} WHERE source = ? ${extra}`).get(source).n;
  const withdrawnPromos = q("SELECT COUNT(*) AS n FROM temp.detach_items d JOIN cat_tracks t ON t.id = d.id WHERE d.kind = 'track' AND t.kind = 'promo'").get().n;
  const cards = q("SELECT COUNT(DISTINCT c.user_id) AS players, COUNT(*) AS n FROM temp.detach_items d JOIN cards c ON c.track_id = d.id WHERE d.kind = 'track'").get();
  const ratings = q("SELECT COUNT(*) AS n FROM temp.detach_items d JOIN ratings r ON r.item_type = d.kind AND r.item_id = d.id WHERE d.kind IN ('album', 'track')").get().n;
  const listItems = q("SELECT COUNT(*) AS n FROM temp.detach_items d JOIN list_items li ON li.item_type = d.kind AND li.item_id = d.id WHERE d.kind IN ('album', 'track')").get().n;
  const pattern = PROVIDER_PATTERNS[source] || { cover: '', link: '' };
  const covers = q('SELECT COUNT(*) AS n FROM cat_albums WHERE cover IS NOT NULL AND (source = ? OR cover LIKE ?)').get(source, pattern.cover).n
    + q("SELECT COUNT(*) AS n FROM cat_tracks WHERE kind = 'promo' AND cover IS NOT NULL AND (source = ? OR cover LIKE ?)").get(source, pattern.cover).n
    + q('SELECT COUNT(*) AS n FROM covers WHERE provider = ? AND cover IS NOT NULL').get(source).n;
  const albums = total('cat_albums');
  const tracks = total('cat_tracks', "AND kind = 'album'");
  const promos = total('cat_tracks', "AND kind = 'promo'");
  const artists = total('cat_artists');
  const withdrawnTracks = count('track') - withdrawnPromos;
  return {
    source,
    albums: { total: albums, withdrawn: count('album'), kept: albums - count('album') },
    tracks: { total: tracks, withdrawn: withdrawnTracks, kept: tracks - withdrawnTracks },
    promos: { total: promos, withdrawn: withdrawnPromos, kept: promos - withdrawnPromos },
    artists: { total: artists, withdrawn: count('artist'), kept: artists - count('artist') },
    // Ce que les joueurs gardent (rien n'est supprimé) : cartes, notes et éléments de listes des éléments archivés.
    players: { withCards: cards.players, cards: cards.n, ratings, listItems },
    covers,
    facts: {
      externalIds: q("SELECT COUNT(*) AS n FROM external_ids WHERE source = ? AND source <> 'isrc'").get(source).n,
      queue: source === 'deezer' ? q('SELECT COUNT(*) AS n FROM import_artists').get().n : 0,
    },
  };
}

const dropPlan = (db) => db.exec('DROP TABLE IF EXISTS temp.detach_items');

/**
 * Étapes du détachement (générateur : une étape = une petite transaction, l'appelant peut souffler entre deux).
 * Rejouable : relancé après une interruption, il reprend ce qui reste. `search` : API du module search (retire les
 * documents des éléments archivés) ; sans elle (script), l'index est reconstruit au prochain démarrage.
 */
function* detachSteps(db, source, { dryRun = true, purgeFacts = false, by = null, search = null, chunk = 2000 } = {}) {
  const q = (sql) => db.prepare(sql);
  const report = planDetach(db, source);
  if (dryRun) {
    dropPlan(db);
    return { ...report, dryRun: true, purgeFacts: !!purgeFacts };
  }
  const at = Date.now();
  // D'abord : plus aucun appel au fournisseur (l'import s'arrête à sa requête suivante).
  q('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(providerKey(source), json({ detached: true, at, by, purgeFacts: !!purgeFacts }));
  if (!search) q("DELETE FROM kv WHERE key IN ('search:version', 'search:marks')").run();
  yield 'flag';
  const { hi } = q('SELECT COALESCE(MAX(rid), 0) AS hi FROM temp.detach_items').get();
  const slice = 'SELECT id FROM temp.detach_items WHERE kind = ? AND rid BETWEEN ? AND ?';
  for (let lo = 1; lo <= hi; lo += chunk) {
    const up = lo + chunk - 1;
    runTx(db, () => {
      q(`UPDATE cat_albums SET status = 'withdrawn' WHERE id IN (${slice})`).run('album', lo, up);
      q(`UPDATE cat_tracks SET status = 'withdrawn' WHERE id IN (${slice})`).run('track', lo, up);
      q(`UPDATE cat_artists SET status = 'withdrawn' WHERE id IN (${slice})`).run('artist', lo, up);
      if (search) for (const r of q('SELECT kind, id FROM temp.detach_items WHERE rid BETWEEN ? AND ?').all(lo, up)) search.remove(r.kind, r.id);
    });
    yield 'withdraw';
  }
  // Pochettes et liens du fournisseur : plus jamais affichés (le site revient aux visuels générés).
  const pattern = PROVIDER_PATTERNS[source] || { cover: '', link: '' };
  const ranges = (table) => {
    const r = q(`SELECT COALESCE(MIN(rowid), 0) AS lo, COALESCE(MAX(rowid), -1) AS hi FROM ${table}`).get();
    const out = [];
    for (let lo = r.lo; lo <= r.hi; lo += chunk * 2) out.push([lo, lo + chunk * 2 - 1]);
    return out;
  };
  for (const [lo, up] of ranges('cat_albums')) {
    runTx(db, () => {
      q(`UPDATE cat_albums SET cover = NULL, cover_w = NULL, thumb = NULL, thumb_w = NULL WHERE rowid BETWEEN ? AND ?
        AND cover IS NOT NULL AND (source = ? OR cover LIKE ?)`).run(lo, up, source, pattern.cover);
      q('UPDATE cat_albums SET url = NULL WHERE rowid BETWEEN ? AND ? AND url LIKE ?').run(lo, up, pattern.link);
      if (purgeFacts) q('UPDATE cat_albums SET fans = 0, deezer_id = NULL WHERE rowid BETWEEN ? AND ? AND source = ?').run(lo, up, source);
    });
    yield 'albums';
  }
  for (const [lo, up] of ranges('cat_tracks')) {
    runTx(db, () => {
      q(`UPDATE cat_tracks SET cover = NULL, thumb = NULL WHERE rowid BETWEEN ? AND ? AND cover IS NOT NULL
        AND (source = ? OR cover LIKE ?)`).run(lo, up, source, pattern.cover);
      q('UPDATE cat_tracks SET url = NULL WHERE rowid BETWEEN ? AND ? AND url LIKE ?').run(lo, up, pattern.link);
      if (purgeFacts) q('UPDATE cat_tracks SET rank = NULL, deezer_id = NULL WHERE rowid BETWEEN ? AND ? AND source = ?').run(lo, up, source);
    });
    yield 'tracks';
  }
  runTx(db, () => {
    q('DELETE FROM covers WHERE provider = ?').run(source);
    if (purgeFacts) {
      // Artistes de la graine reliés au fournisseur : leur identifiant et leurs fans viennent de lui.
      q('UPDATE cat_artists SET fans = 0, deezer_id = NULL WHERE source = ? OR deezer_id IS NOT NULL').run(source);
      if (source === 'deezer') {
        q('DELETE FROM import_artists').run();
        q("DELETE FROM kv WHERE key = 'rankBreaks'").run();
      }
    }
  });
  if (purgeFacts) {
    // Identifiants du fournisseur, par lots (plusieurs centaines de milliers de lignes sur un grand catalogue).
    const del = q(`DELETE FROM external_ids WHERE (entity_type, entity_id, source, source_id) IN
      (SELECT entity_type, entity_id, source, source_id FROM external_ids WHERE source = ? AND source <> 'isrc' LIMIT ${chunk * 2})`);
    while (runTx(db, () => Number(del.run(source).changes))) yield 'facts';
  }
  dropPlan(db);
  return { ...report, dryRun: false, purgeFacts: !!purgeFacts, at };
}

/** Détachement en une fois (script, tests) : renvoie le compte rendu. */
export function detachProvider(db, source, opts = {}) {
  if (!DETACHABLE.includes(source)) throw new Error(`fournisseur inconnu : ${source}`);
  const it = detachSteps(db, source, opts);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/** Détachement par lots, avec une pause entre deux : le serveur continue de répondre pendant ce temps. */
export async function detachProviderAsync(db, source, opts = {}) {
  if (!DETACHABLE.includes(source)) throw new Error(`fournisseur inconnu : ${source}`);
  const it = detachSteps(db, source, opts);
  let step = it.next();
  while (!step.done) {
    await new Promise((r) => setImmediate(r));
    step = it.next();
  }
  return step.value;
}

// ---------- écoute : liens officiels et lecteurs intégrés ----------

/**
 * Liens et lecteurs d'un élément (PLAN.md 4.3, 7.1) : la page officielle quand l'identifiant est connu, sinon une
 * recherche ; un lecteur intégré pour chaque identifiant Deezer, Spotify ou Apple Music connu (Spotify et Apple
 * seulement d'après une source CC0 : MusicBrainz ou Wikidata). Un fournisseur détaché n'apparaît plus. null si
 * l'élément n'existe pas.
 */
export function listenFor(db, type, id, { lang = 'fr' } = {}) {
  const q = (sql) => db.prepare(sql);
  let row = null;
  if (type === 'album') {
    row = q(`SELECT al.id, al.title, al.status, al.source, al.url, ar.name AS artist FROM cat_albums al
      JOIN cat_artists ar ON ar.id = al.artist_id WHERE al.id = ?`).get(id);
  } else if (type === 'track') {
    row = q(`SELECT t.id, t.title, t.kind, t.album_id, t.source, t.url, ar.name AS artist,
        CASE WHEN t.status = 'withdrawn' OR al.status = 'withdrawn' THEN 'withdrawn' ELSE 'active' END AS status
      FROM cat_tracks t JOIN cat_artists ar ON ar.id = t.artist_id LEFT JOIN cat_albums al ON al.id = t.album_id WHERE t.id = ?`).get(id);
  } else if (type === 'artist') {
    row = q('SELECT id, name AS title, status, source, NULL AS url, NULL AS artist FROM cat_artists WHERE id = ?').get(id);
  }
  if (!row) return null;
  const ids = q('SELECT source, source_id, url, matched_by FROM external_ids WHERE entity_type = ? AND entity_id = ?').all(type, id);
  const pick = (source, cc0 = false) => ids.find((r) => r.source === source && (!cc0 || r.matched_by !== 'import')) || null;
  const detached = new Set(DETACHABLE.filter((s) => providerDetached(db, s)));

  // Deezer : identifiant externe, sinon lien de la ligne, sinon la table des pochettes de la graine (covers.js).
  let deezer = pick('deezer')?.source_id || deezerIdOf(row.url, type);
  if (!deezer && row.source === 'seed' && type !== 'artist') {
    const albumTrack = type === 'track' && row.kind !== 'promo';
    const cover = q("SELECT url, tracks FROM covers WHERE item_key = ? AND provider = 'deezer'").get(albumTrack ? row.album_id : id);
    deezer = deezerIdOf(albumTrack ? parse(cover?.tracks, {})[id] : cover?.url, type);
  }
  const spotify = pick('spotify', true);
  const apple = pick('apple', true);
  const storefront = appleStorefront(lang);
  const known = {
    deezer: deezer ? { id: deezer, url: sourceUrl('deezer', type, deezer) } : null,
    spotify: spotify ? { id: spotify.source_id, url: sourceUrl('spotify', type, spotify.source_id) } : null,
    apple: apple ? { id: apple.source_id, url: apple.url || sourceUrl('apple', type, apple.source_id, { storefront }) } : null,
  };
  const text = `${row.artist || ''} ${row.title || ''}`.trim();
  const links = [];
  const embeds = [];
  for (const provider of LISTEN_PROVIDERS) {
    if (detached.has(provider)) continue;
    const direct = known[provider];
    links.push(direct?.url ? { provider, url: direct.url, direct: true } : { provider, url: searchUrl(provider, text), direct: false });
    const embed = direct && type !== 'artist' ? embedFor(provider, type, direct.id, { storefront }) : null;
    if (embed) embeds.push(embed);
  }
  // Attribution des identifiants libres (MusicBrainz, Wikidata : CC0) quand ils ont servi.
  const sources = [];
  const mbRow = ids.find((r) => r.source === 'musicbrainz' && /release-group/.test(r.url || '')) || ids.find((r) => r.source === 'musicbrainz');
  if (mbRow) sources.push({ source: 'musicbrainz', url: mbRow.url || sourceUrl('musicbrainz', type, mbRow.source_id) });
  const wdRow = pick('wikidata');
  if (wdRow || spotify?.matched_by === 'wikidata' || apple?.matched_by === 'wikidata') {
    sources.push({ source: 'wikidata', url: wdRow ? sourceUrl('wikidata', type, wdRow.source_id) : 'https://www.wikidata.org/' });
  }
  return { type, id, links, embeds, archived: row.status === 'withdrawn', sources, detached: [...detached] };
}

// ---------- module ----------

export function init(deps) {
  const { db, config } = deps;
  const quiet = { warn() {}, error() {} };
  const enricher = createEnricher({ db }, { ...enrichConfig(process.env, config), log: config.isTest ? quiet : console });
  const q = (sql) => db.prepare(sql);

  // Pays de la graine : source « seed » (le passeport ne compte que les pays dont la source est connue).
  q("UPDATE cat_artists SET country_source = 'seed' WHERE source = 'seed' AND country IS NOT NULL AND country_source IS NULL").run();
  if (!config.isTest) enricher.resumeAfterRestart();

  // Compteurs de l'espace admin, 30 s (« source <> 'isrc' » est répété exprès : il rend l'index partiel utilisable).
  const counts = deps.lru({ max: 4, ttlMs: 30 * SECOND });
  const countExt = (source, type) => q("SELECT COUNT(*) AS n FROM external_ids WHERE source = ? AND source <> 'isrc' AND entity_type = ?").get(source, type).n;
  const totals = () => counts.wrap('totals', () => ({
    artists: q('SELECT COUNT(*) AS n FROM cat_artists').get().n,
    artistsWithCountry: q('SELECT COUNT(*) AS n FROM cat_artists WHERE country IS NOT NULL AND country_source IS NOT NULL').get().n,
    countriesBy: Object.fromEntries(q('SELECT country_source AS s, COUNT(*) AS n FROM cat_artists WHERE country_source IS NOT NULL GROUP BY country_source').all().map((r) => [r.s, r.n])),
    albums: q('SELECT COUNT(*) AS n FROM cat_albums').get().n,
    withdrawn: {
      albums: q("SELECT COUNT(*) AS n FROM cat_albums WHERE status = 'withdrawn'").get().n,
      tracks: q("SELECT COUNT(*) AS n FROM cat_tracks WHERE status = 'withdrawn'").get().n,
    },
    musicbrainz: {
      artist: countExt('musicbrainz', 'artist'),
      album: q("SELECT COUNT(DISTINCT entity_id) AS n FROM external_ids WHERE source = 'musicbrainz' AND source <> 'isrc' AND entity_type = 'album'").get().n,
      track: countExt('musicbrainz', 'track'),
    },
    spotify: { artist: countExt('spotify', 'artist'), album: countExt('spotify', 'album'), track: countExt('spotify', 'track') },
    apple: { artist: countExt('apple', 'artist'), album: countExt('apple', 'album'), track: countExt('apple', 'track') },
    wikidata: countExt('wikidata', 'artist') + countExt('wikidata', 'album'),
    upc: countExt('upc', 'album'),
    isrc: q("SELECT COUNT(*) AS n FROM external_ids WHERE source = 'isrc'").get().n,
  }));

  function status() {
    const s = enricher.state();
    const settings = enricher.settings();
    const t = totals();
    const done = s.cursor ? q('SELECT COUNT(*) AS n FROM cat_artists WHERE rowid <= ?').get(s.cursor).n : 0;
    const similar = parse(q("SELECT value FROM kv WHERE key = 'album-similar'").get()?.value, null);
    const providers = {};
    for (const p of DETACHABLE) {
      const d = providerDetached(db, p);
      providers[p] = d ? { detached: true, at: d.at || null, purgeFacts: !!d.purgeFacts } : { detached: false };
    }
    return {
      mode: settings.mode,
      blocked: settings.blocked,
      userAgent: settings.userAgent,
      running: enricher.running,
      phase: enricher.running ? 'running' : s.phase === 'running' ? 'idle' : s.phase,
      paused: !!s.paused,
      pass: s.pass || 1,
      progress: { done: Math.min(done, t.artists), total: t.artists },
      requests: enricher.requests(),
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      passFinishedAt: s.passFinishedAt,
      retryAt: enricher.retryAt,
      lastError: s.lastError,
      counts: t,
      similar: similar ? { at: similar.at, albums: similar.albums, rows: q('SELECT COUNT(*) AS n FROM album_similar').get().n, done: !!similar.done } : null,
      providers,
    };
  }

  let detaching = null;
  async function detach(source, { dryRun = true, purgeFacts = false, by = null } = {}) {
    if (!DETACHABLE.includes(source)) throw new deps.HttpError(404, 'unknown_provider');
    if (detaching) throw new deps.HttpError(409, 'detach_running');
    if (!dryRun && providerDetached(db, source)) throw new deps.HttpError(409, 'already_detached');
    detaching = detachProviderAsync(db, source, { dryRun, purgeFacts, by, search: dryRun ? null : deps.search });
    try {
      const report = await detaching;
      if (!dryRun) {
        // Tirages, totaux et agrégats sans les éléments archivés (filtres status de catalog.js, P2-E).
        deps.catalog.invalidate?.();
        deps.catalog.rebuildIndex?.();
        counts.clear();
      }
      return report;
    } finally {
      detaching = null;
    }
  }

  function listen(type, rawId, viewer) {
    const id = deps.validate.id(rawId);
    const kind = ['album', 'track', 'artist'].includes(type) ? type : null;
    const out = kind && id ? listenFor(db, kind, id, { lang: viewer?.lang }) : null;
    if (!out) throw new deps.HttpError(404, kind ? `unknown_${kind}` : 'not_found');
    return out;
  }

  return {
    status,
    start: (opts) => enricher.start(opts),
    pause: () => enricher.pause(),
    kick: () => enricher.kick(),
    listen,
    computeSimilar: (opts) => computeSimilar(db, opts),
    detach,
    detachedProviders: () => DETACHABLE.filter((p) => providerDetached(db, p)),
    forgetCounts: () => counts.clear(),
    /** Moteur (tests). */
    enricher,
  };
}

export function routes(r, deps) {
  r.get('/catalog/listen/:type/:id', deps.limits.read, (req, res) => res.json(deps.enrich.listen(req.params.type, req.params.id, req.user)));
}

export function adminRoutes(r, deps) {
  const audit = (req, action, target, payload) => deps.services.audit(req.user.id, action, target, payload);
  r.get('/enrich', (_req, res) => res.json(deps.enrich.status()));
  r.post('/enrich/start', (req, res) => {
    deps.enrich.start({ force: true });
    audit(req, 'enrich.start');
    res.json(deps.enrich.status());
  });
  r.post('/enrich/pause', (req, res) => {
    deps.enrich.pause();
    audit(req, 'enrich.pause');
    res.json(deps.enrich.status());
  });
  r.post('/enrich/similar', async (req, res) => {
    const result = await deps.enrich.computeSimilar();
    audit(req, 'enrich.similar', null, result);
    deps.enrich.forgetCounts();
    res.json({ ...deps.enrich.status(), result });
  });
  r.post('/providers/:source/detach', async (req, res) => {
    const source = String(req.params.source || '');
    const dryRun = req.body.dryRun !== false;
    const purgeFacts = deps.validate.bool(req.body.purgeFacts);
    // Une vraie sortie se confirme en tapant le nom du fournisseur : aucun clic de trop ne la déclenche.
    if (!dryRun && req.body.confirm !== source) throw new deps.HttpError(400, 'confirm_required');
    const report = await deps.enrich.detach(source, { dryRun, purgeFacts, by: req.user.id });
    if (!dryRun) audit(req, 'provider.detach', `provider:${source}`, { purgeFacts, albums: report.albums, tracks: report.tracks, artists: report.artists });
    res.json({ report, status: deps.enrich.status() });
  });
}

export const jobs = [
  // MusicBrainz / Wikidata en arrière-plan : la tâche lance la passe sans l'attendre.
  { name: 'enrich', run: (deps) => deps.enrich.kick() },
  { name: 'album-similar', run: (deps) => deps.enrich.computeSimilar() },
];
