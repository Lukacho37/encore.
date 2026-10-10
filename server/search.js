// Module « search » : recherche globale avec autocomplétion (PLAN.md 4.1.4, algorithme 5.1). Chantier : P0-E.
//
// Index : search_docs (type, identifiant, nom normalisé, popularité) + deux tables FTS5 sans contenu (aucun texte
// stocké deux fois) : search_fts (nom, contexte, type « kalbum »… ; préfixes de 2 et 3 lettres indexés) et search_tri
// (trigrammes du nom, pour les fautes de frappe). Les résultats sont ensuite habillés par refs() (catalogue),
// userSummaries (membres) et la table lists.
//
// Construction : au démarrage, avant listen() (init est appelé par createApp), quand kv['search:version'] diffère de
// SEARCH_VERSION (une fois, quelques secondes pour 268 000 documents). Ensuite : un minuteur de 5 minutes indexe les
// nouvelles lignes du catalogue (import Deezer) et les comptes nouvellement confirmés ; un compte est aussi indexé dès
// sa confirmation (événement user.verified), une liste à chaque list.saved (P1-C) et retirée à content.removed ; la
// tâche de nuit « search-weights » recalcule les popularités. API interne (deps.search) : upsert, remove, refresh,
// rebuild, refreshWeights, status, suggest, search.
import {
  SEARCH_KINDS, QUOTAS, SCOPE_QUOTA, COUNT_CAP, RESULTS_CAP, TYPO_MIN_LENGTH, TYPO_MIN_SIM, SUGGEST_MIN_SIM,
  normalize, prepareQuery, ftsBody, trigrams, queryGrams, similarity, textScore, typoScore, finalScore, byScore, betterTop,
  fansWeight, userWeight, listWeight, cleanQuery,
} from '../shared/search.js';

export const name = 'search';

/** Changer ce numéro reconstruit l'index au prochain démarrage (nouvelle règle d'indexation). */
export const SEARCH_VERSION = '2';

const REFRESH_MS = 5 * 60_000;
/**
 * Numérotation des documents : chaque type a sa plage d'identifiants, et la reconstruction numérote les documents
 * d'un type du plus populaire au moins populaire (les ajouts suivants prennent la suite dans la plage). FTS5 rend
 * les correspondances dans l'ordre des rowid : une requête plafonnée (CAP) sur un type garde donc les plus populaires
 * sans classer toutes les correspondances (une requête très générale comme « love » en a des dizaines de milliers).
 * Ordre des plages : membres, listes, artistes, albums, morceaux ; la lecture plafonnée des trigrammes (tous types
 * confondus) voit ainsi d'abord les petits ensembles. CAP > COUNT_CAP : le compteur « 99+ » s'en déduit.
 */
const KIND_SPAN = 1e9;
const RANGE_ORDER = ['user', 'list', 'artist', 'album', 'track'];
const rangeOf = (kind) => {
  const base = (RANGE_ORDER.indexOf(kind) + 1) * KIND_SPAN;
  return [base, base + KIND_SPAN - 1];
};
const CAP = 600;
/**
 * Un mot tapé de 4 lettres ou plus est cherché comme préfixe : FTS5 fusionnerait alors en mémoire les listes de tous
 * les mots qui commencent ainsi, à chaque requête (coûteux pour un mot très fréquent). Le dictionnaire des mots de
 * l'index (TermIndex) remplace ce préfixe par la liste exacte de ses mots (« nigh » → night OR nights…), lue sans
 * rien fusionner, tant qu'elle compte au plus MAX_EXPAND mots.
 */
const MAX_EXPAND = 30;
/** Lignes classées gardées par type pour les suggestions (de quoi remplacer les membres ou listes écartés). */
const SUGGEST_KEEP = 24;
/** Le bonus « déjà dans ma collection » n'est cherché que pour les mieux classés (quelques dizaines par type). */
const OWNED_WINDOW = 40;
/**
 * Fautes de frappe : seulement quand les préfixes n'ont presque rien trouvé (moins de TYPO_HITS lignes en tout) ;
 * trigrammes les plus rares gardés ; fréquence d'un trigramme comptée jusqu'à GRAM_CAP.
 */
const TYPO_HITS = 8;
const TYPO_GRAMS = 4;
const GRAM_CAP = 2000;
/**
 * Candidats approchés : ceux qui contiennent les trigrammes rares de la requête, classés par bm25 (le plus de
 * trigrammes rares d'abord), puis, s'il en faut encore, les plus populaires qui contiennent n'importe lequel de ses
 * trigrammes (TRI_CAP au plus).
 */
const TRI_RANK_MAX = 3000;
const TRI_LIMIT = 300;
const TRI_CAP = 1000;
/** Listes indexées : publiques, non masquées (la liste de souhaits n'est pas un contenu à chercher). */
const LIST_KINDS = "('list','grid9')";
/** Classement d'une page de résultats gardé une minute par joueur (pages suivantes, retour sur un onglet). */
const PAGE_TTL = 60_000;
const NO_CATALOG = Object.freeze({ tracks: [], albums: [], artists: [] });

const kvGet = (db, key) => db.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value ?? null;
const kvSet = (db, key, value) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  .run(key, String(value));

/**
 * Nom normalisé (`folded`, pour le reclassement), nom indexé (NULL quand c'est le nom normalisé), contexte et poids
 * de chaque type, lus en SQL (am_norm = normalize, am_fw = fansWeight, am_uw / am_lw = poids des membres et des
 * listes, shared/search.js). Morceau : le nom indexé comprend l'invité (feat), le nom normalisé non (« get lucky »
 * reste un nom exact).
 */
const SOURCES = {
  album: (where = '') => `SELECT al.id AS ref, am_norm(al.title) AS folded, NULL AS name,
      am_norm(ar.name || ' ' || COALESCE(al.year, '')) AS context,
      am_fw(al.fans, :maxAlbumFans, CASE WHEN al.fans > 0 THEN 0 ELSE (SELECT AVG(t.pop) FROM cat_tracks t WHERE t.album_id = al.id) END) AS weight
    FROM cat_albums al JOIN cat_artists ar ON ar.id = al.artist_id WHERE al.status = 'active' ${where}`,
  track: (where = '') => `SELECT t.id AS ref, am_norm(t.title) AS folded,
      CASE WHEN COALESCE(t.feat, '') = '' THEN NULL ELSE am_norm(t.title || ' ' || t.feat) END AS name,
      am_norm(ar.name || ' ' || COALESCE(al.title, '')) AS context, MIN(1.0, MAX(0, t.pop) / 100.0) AS weight
    FROM cat_tracks t JOIN cat_artists ar ON ar.id = t.artist_id LEFT JOIN cat_albums al ON al.id = t.album_id
    WHERE t.status = 'active' ${where}`,
  artist: (where = '') => `SELECT ar.id AS ref, am_norm(ar.name) AS folded, NULL AS name, am_norm(COALESCE(ar.genre, '')) AS context,
      am_fw(ar.fans, :maxArtistFans, CASE WHEN ar.fans > 0 THEN 0 ELSE (SELECT AVG(t.pop) FROM cat_tracks t WHERE t.artist_id = ar.id) END) AS weight
    FROM cat_artists ar WHERE ar.status = 'active' ${where}`,
  user: (where = '') => `SELECT CAST(u.id AS TEXT) AS ref, am_norm(u.username) AS folded, NULL AS name, '' AS context,
      am_uw(u.unique_cards) AS weight
    FROM users u WHERE u.email_verified_at IS NOT NULL ${where}`,
  list: (where = '') => `SELECT CAST(l.id AS TEXT) AS ref, am_norm(l.title) AS folded, NULL AS name, am_norm(u.username) AS context,
      am_lw(l.like_count) AS weight
    FROM lists l JOIN users u ON u.id = l.user_id
    WHERE l.visibility = 'public' AND l.hidden_at IS NULL AND l.kind IN ${LIST_KINDS} AND u.email_verified_at IS NOT NULL ${where}`,
};
/** Clé de la ligne source d'un document (upsert d'un seul document relu depuis la base). */
const SOURCE_KEY = { album: 'al.id', track: 't.id', artist: 'ar.id', user: 'u.id', list: 'l.id' };

/** Mots de l'index (colonnes nom et contexte), triés : développement des préfixes tapés en mots exacts. */
export function createTermIndex(db) {
  const DIGITS = /^\d+$/;
  const KIND_TERM = /^k(album|track|artist|user|list)$/;
  let words = [];
  let extra = new Set();

  const lowerBound = (list, key) => {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const has = (w) => words[lowerBound(words, w)] === w || extra.has(w);

  /** Relit tous les mots de l'index (au démarrage et après une reconstruction). */
  function load() {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.search_fts_terms USING fts5vocab(main, search_fts, 'row')");
    const set = new Set();
    for (const r of db.prepare('SELECT term FROM temp.search_fts_terms').iterate()) {
      if (!DIGITS.test(r.term) && !KIND_TERM.test(r.term)) set.add(r.term);
    }
    words = [...set].sort();
    extra = new Set();
  }

  /** Ajoute les mots d'un texte normalisé (document ajouté après le chargement). */
  function add(text) {
    for (const w of String(text || '').split(' ')) if (w && !DIGITS.test(w) && !has(w)) extra.add(w);
    if (extra.size > 5000) {
      words = [...words, ...extra].sort();
      extra = new Set();
    }
  }

  /**
   * Mots de l'index qui commencent par `token` : un tableau (vide : aucun document ne peut correspondre), ou null
   * quand il y en a trop (ou pour un nombre) : le préfixe FTS5 sert alors tel quel.
   */
  function expand(token) {
    if (DIGITS.test(token)) return null;
    const out = [];
    for (let i = lowerBound(words, token); i < words.length && words[i].startsWith(token); i++) {
      out.push(words[i]);
      if (out.length > MAX_EXPAND) return null;
    }
    for (const w of extra) {
      if (w.startsWith(token)) out.push(w);
      if (out.length > MAX_EXPAND) return null;
    }
    return out;
  }

  return { load, add, expand, get size() { return words.length + extra.size; } };
}

export function createSearchIndex(deps) {
  const { db } = deps;
  const statements = new Map();
  const q = (sql) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    return st;
  };

  db.function('am_norm', { deterministic: true }, (s) => normalize(s ?? ''));
  db.function('am_fw', { deterministic: true }, (fans, max, avgPop) => fansWeight(Number(fans) || 0, Number(max) || 0, Number(avgPop) || 0));
  db.function('am_uw', { deterministic: true }, (n) => userWeight(Number(n) || 0));
  db.function('am_lw', { deterministic: true }, (n) => listWeight(Number(n) || 0));

  const maxima = () => ({
    maxAlbumFans: q('SELECT COALESCE(MAX(fans), 0) AS m FROM cat_albums').get().m,
    maxArtistFans: q('SELECT COALESCE(MAX(fans), 0) AS m FROM cat_artists').get().m,
  });
  /** Paramètres nommés de la requête source d'un type (node:sqlite refuse un paramètre inconnu). */
  const paramsFor = (kind, m = null) => {
    if (kind === 'album') return { maxAlbumFans: (m || maxima()).maxAlbumFans };
    if (kind === 'artist') return { maxArtistFans: (m || maxima()).maxArtistFans };
    return {};
  };
  /** Transaction, sauf si l'appelant en a déjà ouvert une (un autre module qui indexe dans la sienne). */
  const inTx = (fn) => (db.isTransaction ? fn() : deps.tx(fn));

  // Classements complets des pages de résultats (240 au plus), par joueur, type et requête.
  const pageCache = deps.lru({ max: 300, ttlMs: PAGE_TTL });
  const terms = createTermIndex(db);
  // Fréquence (plafonnée) des trigrammes dans l'index, pour choisir les plus rares d'une requête approchée.
  const gramCache = new Map();
  /** L'index a changé : classements et fréquences gardés en mémoire oubliés. */
  function forget() {
    pageCache.clear();
    gramCache.clear();
  }

  let lastRefresh = Number(kvGet(db, 'search:refreshed_at')) || null;

  // ---------- écriture ----------

  function writeDoc(kind, ref, folded, ftsName, context, weight, now) {
    const existing = q('SELECT id FROM search_docs WHERE kind = ? AND ref_id = ?').get(kind, ref);
    let id;
    if (existing) {
      id = existing.id;
      q('DELETE FROM search_fts WHERE rowid = ?').run(id);
      q('DELETE FROM search_tri WHERE rowid = ?').run(id);
      q('UPDATE search_docs SET folded = ?, weight = ?, updated_at = ? WHERE id = ?').run(folded, weight, now, id);
    } else {
      const [lo, hi] = rangeOf(kind);
      id = (q('SELECT MAX(id) AS m FROM search_docs WHERE id BETWEEN ? AND ?').get(lo, hi).m ?? lo - 1) + 1;
      q('INSERT INTO search_docs (id, kind, ref_id, folded, weight, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, kind, ref, folded, weight, now);
    }
    q('INSERT INTO search_fts (rowid, name, context, k) VALUES (?, ?, ?, ?)').run(id, ftsName, context, `k${kind}`);
    q('INSERT INTO search_tri (rowid, name) VALUES (?, ?)').run(id, folded);
    terms.add(ftsName);
    terms.add(context);
  }

  /** Indexe les lignes d'un type qui vérifient `where` (dans la transaction de l'appelant), les plus populaires d'abord. */
  function indexWhere(kind, where, params = {}) {
    const now = Date.now();
    let n = 0;
    for (const r of q(`${SOURCES[kind](where)} ORDER BY weight DESC`).all({ ...paramsFor(kind), ...params })) {
      if (!r.folded) continue;
      writeDoc(kind, r.ref, r.folded, r.name || r.folded, r.context || '', r.weight || 0, now);
      n += 1;
    }
    return n;
  }

  function removeDoc(kind, ref) {
    const row = q('SELECT id FROM search_docs WHERE kind = ? AND ref_id = ?').get(kind, String(ref));
    if (!row) return false;
    q('DELETE FROM search_fts WHERE rowid = ?').run(row.id);
    q('DELETE FROM search_tri WHERE rowid = ?').run(row.id);
    q('DELETE FROM search_docs WHERE id = ?').run(row.id);
    return true;
  }

  /** Repères de l'indexation incrémentale : dernières lignes du catalogue indexées, dernière confirmation de compte. */
  function marks() {
    return {
      album: q('SELECT COALESCE(MAX(rowid), 0) AS m FROM cat_albums').get().m,
      track: q('SELECT COALESCE(MAX(rowid), 0) AS m FROM cat_tracks').get().m,
      artist: q('SELECT COALESCE(MAX(rowid), 0) AS m FROM cat_artists').get().m,
      user: q('SELECT COALESCE(MAX(email_verified_at), 0) AS m FROM users').get().m,
    };
  }
  const saveMarks = (m) => kvSet(db, 'search:marks', JSON.stringify(m));
  function readMarks() {
    try {
      const m = JSON.parse(kvGet(db, 'search:marks') || 'null');
      return m && typeof m === 'object' ? m : null;
    } catch {
      return null;
    }
  }

  /**
   * Reconstruction complète, en une transaction, entièrement en SQL (fonctions am_* pour la normalisation et les
   * poids) : pas d'aller-retour par document. Les sources sont lues une fois dans une table temporaire, puis les
   * documents sont numérotés type par type, du plus populaire au moins populaire (voir CAP). Pendant le chargement,
   * les fusions automatiques de segments FTS5 sont coupées ; une seule fusion complète à la fin (plus rapide).
   */
  function rebuild() {
    const started = performance.now();
    const now = Date.now();
    const docs = inTx(() => {
      db.exec("INSERT INTO search_fts(search_fts) VALUES ('delete-all')");
      db.exec("INSERT INTO search_tri(search_tri) VALUES ('delete-all')");
      db.exec('DELETE FROM search_docs');
      // Noms d'artistes et titres d'albums normalisés une fois (contexte des 240 000 morceaux).
      db.exec(`CREATE TEMP TABLE IF NOT EXISTS search_names (kind TEXT NOT NULL, id TEXT NOT NULL, n TEXT NOT NULL, PRIMARY KEY (kind, id)) WITHOUT ROWID;
        DELETE FROM temp.search_names;
        INSERT INTO temp.search_names SELECT 'artist', id, am_norm(name) FROM cat_artists;
        INSERT INTO temp.search_names SELECT 'album', id, am_norm(title) FROM cat_albums;
        CREATE TEMP TABLE IF NOT EXISTS search_src (id INTEGER, kind TEXT, ref TEXT, folded TEXT, name TEXT, context TEXT, weight REAL);
        DELETE FROM temp.search_src;`);
      const m = maxima();
      const sources = {
        ...SOURCES,
        track: () => `SELECT t.id AS ref, am_norm(t.title) AS folded,
            CASE WHEN COALESCE(t.feat, '') = '' THEN NULL ELSE am_norm(t.title || ' ' || t.feat) END AS name,
            TRIM(na.n || ' ' || COALESCE(nl.n, '')) AS context, MIN(1.0, MAX(0, t.pop) / 100.0) AS weight
          FROM cat_tracks t JOIN temp.search_names na ON na.kind = 'artist' AND na.id = t.artist_id
          LEFT JOIN temp.search_names nl ON nl.kind = 'album' AND nl.id = t.album_id WHERE t.status = 'active'`,
      };
      // Identifiants dans la plage du type, du plus populaire au moins populaire.
      for (const kind of SEARCH_KINDS) {
        q(`INSERT INTO temp.search_src SELECT ${rangeOf(kind)[0]} + ROW_NUMBER() OVER (ORDER BY weight DESC, ref) - 1, '${kind}', ref, folded, name,
          COALESCE(context, ''), COALESCE(weight, 0) FROM (${sources[kind]()}) WHERE folded != ''`).run(paramsFor(kind, m));
      }
      db.exec(`INSERT INTO search_docs (id, kind, ref_id, folded, weight, updated_at)
        SELECT id, kind, ref, folded, weight, ${now} FROM temp.search_src ORDER BY id`);
      db.exec("INSERT INTO search_fts(search_fts, rank) VALUES ('automerge', 0)");
      db.exec("INSERT INTO search_tri(search_tri, rank) VALUES ('automerge', 0)");
      // Nom et contexte indexés (non stockés dans search_docs).
      db.exec("INSERT INTO search_fts (rowid, name, context, k) SELECT id, COALESCE(name, folded), context, 'k' || kind FROM temp.search_src ORDER BY id");
      db.exec('INSERT INTO search_tri (rowid, name) SELECT id, folded FROM temp.search_src ORDER BY id');
      db.exec('DROP TABLE temp.search_src; DROP TABLE temp.search_names;');
      // Une fusion complète (chaque terme se lit dans un seul segment), puis retour aux fusions automatiques par
      // défaut pour les ajouts suivants.
      db.exec("INSERT INTO search_fts(search_fts) VALUES ('optimize')");
      db.exec("INSERT INTO search_tri(search_tri) VALUES ('optimize')");
      db.exec("INSERT INTO search_fts(search_fts, rank) VALUES ('automerge', 4)");
      db.exec("INSERT INTO search_tri(search_tri, rank) VALUES ('automerge', 4)");
      saveMarks(marks());
      kvSet(db, 'search:version', SEARCH_VERSION);
      kvSet(db, 'search:refreshed_at', now);
      return q('SELECT COUNT(*) AS n FROM search_docs').get().n;
    });
    lastRefresh = now;
    const built = { at: now, ms: Math.round(performance.now() - started), docs };
    kvSet(db, 'search:built', JSON.stringify(built));
    terms.load();
    forget();
    return built;
  }

  /**
   * Indexation incrémentale : lignes du catalogue ajoutées depuis le dernier passage (rowid au-delà des repères) et
   * comptes confirmés depuis. La mise à jour d'une ligne existante passe par upsert().
   */
  function refresh() {
    const prev = readMarks();
    if (!prev) return { rebuilt: rebuild() };
    const added = inTx(() => {
      const next = marks();
      const out = { album: 0, track: 0, artist: 0, user: 0 };
      if (next.artist > (prev.artist || 0)) out.artist = indexWhere('artist', 'AND ar.rowid > :mark', { mark: prev.artist || 0 });
      if (next.album > (prev.album || 0)) out.album = indexWhere('album', 'AND al.rowid > :mark', { mark: prev.album || 0 });
      if (next.track > (prev.track || 0)) out.track = indexWhere('track', 'AND t.rowid > :mark', { mark: prev.track || 0 });
      if (next.user > (prev.user || 0)) out.user = indexWhere('user', 'AND u.email_verified_at > :mark', { mark: prev.user || 0 });
      saveMarks(next);
      kvSet(db, 'search:refreshed_at', Date.now());
      return out;
    });
    lastRefresh = Date.now();
    if (added.album || added.track || added.artist || added.user) forget();
    return added;
  }

  /**
   * Ajoute ou met à jour un document. Forme du plan : upsert(kind, refId, name, context, weight) ; aussi un objet
   * { kind, refId | id, name, context, weight } ; ou upsert(kind, refId) seul : relu depuis la base avec les règles
   * d'indexation (une liste devenue privée ou masquée, un compte non confirmé est retiré).
   */
  function upsert(kindOrDoc, refId, docName, context = '', weight = 0) {
    const doc = kindOrDoc && typeof kindOrDoc === 'object'
      ? { kind: kindOrDoc.kind, ref: kindOrDoc.refId ?? kindOrDoc.id, name: kindOrDoc.name, context: kindOrDoc.context, weight: kindOrDoc.weight }
      : { kind: kindOrDoc, ref: refId, name: docName, context, weight };
    if (!SEARCH_KINDS.includes(doc.kind) || doc.ref == null || doc.ref === '') return false;
    const ref = String(doc.ref);
    const done = inTx(() => {
      if (doc.name == null) {
        const key = doc.kind === 'user' || doc.kind === 'list' ? Number(ref) : ref;
        const n = indexWhere(doc.kind, `AND ${SOURCE_KEY[doc.kind]} = :ref`, { ref: key });
        if (!n) removeDoc(doc.kind, ref);
        return n > 0;
      }
      const folded = normalize(doc.name);
      if (!folded) {
        removeDoc(doc.kind, ref);
        return false;
      }
      writeDoc(doc.kind, ref, folded, folded, normalize(doc.context || ''), Math.min(1, Math.max(0, Number(doc.weight) || 0)), Date.now());
      return true;
    });
    forget();
    return done;
  }

  function remove(kind, refId) {
    const done = inTx(() => removeDoc(kind, refId));
    if (done) forget();
    return done;
  }

  /** Tâche de nuit : popularités recalculées (fans, popularité des morceaux, cartes des membres, j'aime des listes). */
  function refreshWeights() {
    const m = maxima();
    const changed = inTx(() => {
      let n = 0;
      for (const kind of SEARCH_KINDS) {
        n += q(`UPDATE search_docs SET weight = COALESCE(s.weight, 0) FROM (${SOURCES[kind]()}) s
          WHERE search_docs.kind = '${kind}' AND search_docs.ref_id = s.ref AND search_docs.weight != COALESCE(s.weight, 0)`)
          .run(paramsFor(kind, m)).changes;
      }
      return n;
    });
    pageCache.clear();
    return { changed };
  }

  function status() {
    const docs = Object.fromEntries(SEARCH_KINDS.map((k) => [k, 0]));
    for (const r of q('SELECT kind, COUNT(*) AS n FROM search_docs GROUP BY kind').all()) docs[r.kind] = r.n;
    let lastBuild = null;
    try {
      lastBuild = JSON.parse(kvGet(db, 'search:built') || 'null');
    } catch {
      lastBuild = null;
    }
    return { version: SEARCH_VERSION, indexedVersion: kvGet(db, 'search:version'), docs, lastRefresh, lastBuild };
  }

  // ---------- lecture ----------

  // Le filtre de type passe par la colonne k (une borne de rowid ferait parcourir FTS5 jusqu'à la plage).
  const ST_CAPPED = `SELECT d.id, d.kind, d.ref_id AS ref, d.folded, d.weight
    FROM (SELECT rowid AS rid FROM search_fts WHERE search_fts MATCH ? LIMIT ?) m JOIN search_docs d ON d.id = m.rid`;
  const ST_GRAM = `SELECT COUNT(*) AS n FROM (SELECT rowid FROM search_tri WHERE search_tri MATCH ? LIMIT ${GRAM_CAP})`;
  const ST_TRI_RANKED = `SELECT d.id, d.kind, d.ref_id AS ref, d.folded, d.weight
    FROM (SELECT rowid AS rid FROM search_tri WHERE search_tri MATCH ? ORDER BY rank LIMIT ${TRI_LIMIT}) m JOIN search_docs d ON d.id = m.rid`;
  const ST_TRI_CAPPED = `SELECT d.id, d.kind, d.ref_id AS ref, d.folded, d.weight
    FROM (SELECT rowid AS rid FROM search_tri WHERE search_tri MATCH ? LIMIT ${TRI_CAP}) m JOIN search_docs d ON d.id = m.rid`;

  /** Nombre de documents (plafonné) qui contiennent ce trigramme. */
  function gramFrequency(gram) {
    let n = gramCache.get(gram);
    if (n === undefined) {
      if (gramCache.size > 20_000) gramCache.clear();
      n = q(ST_GRAM).get(`"${gram}"`).n;
      gramCache.set(gram, n);
    }
    return n;
  }

  /**
   * Corps de la requête FTS5 : chaque mot tapé est un préfixe (`"daft"* AND "pu"*`), développé en mots exacts
   * quand le dictionnaire le permet (`("night" OR "nights")`). null : un mot ne commence aucun mot de l'index.
   */
  function matchBody(tokens) {
    const clauses = [];
    for (const t of tokens) {
      const list = t.length >= 4 ? terms.expand(t) : null;
      if (list && !list.length) return null;
      clauses.push(list ? `(${list.map((w) => `"${w}"`).join(' OR ')})` : ftsBody([t]));
    }
    return clauses.join(' AND ');
  }

  /**
   * Candidats par type : chaque mot de la requête comme préfixe d'un mot du nom ou du contexte (FTS5), au plus CAP
   * par type, les plus populaires d'abord. Puis, quand un type a moins de lignes que son quota et que la requête a
   * 4 lettres ou plus, ressemblance par trigrammes (les 4 trigrammes de la requête les plus rares dans l'index,
   * similarité ≥ 0,3). Renvoie { lists, matched, ftsHits, typo } ; `matched[kind]` = correspondances par préfixe
   * (CAP + 1 quand le plafond est atteint).
   */
  function candidates(prepared, kinds, quotaOf) {
    const { fq, tokens, compact } = prepared;
    const body = matchBody(tokens);
    const lists = {};
    const matched = {};
    let ftsHits = 0;
    for (const kind of kinds) {
      const rows = body ? q(ST_CAPPED).all(`k:k${kind} AND {name context}: (${body})`, CAP + 1) : [];
      matched[kind] = rows.length;
      if (rows.length > CAP) rows.length = CAP;
      ftsHits += rows.length;
      lists[kind] = rows.map((r) => ({ ...r, typo: false, text: textScore(r.folded, fq, tokens) }));
    }
    const typo = [];
    const wanting = kinds.filter((k) => lists[k].length < quotaOf(k));
    if (compact.length >= TYPO_MIN_LENGTH && wanting.length && ftsHits < TYPO_HITS) {
      const grams = queryGrams(compact).map((g) => [g, gramFrequency(g)]).filter(([, n]) => n > 0).sort((a, b) => a[1] - b[1]);
      const queryTri = trigrams(fq);
      const seen = new Set(kinds.flatMap((k) => lists[k].map((r) => r.id)));
      const take = (rows) => {
        for (const r of rows) {
          if (seen.has(r.id) || !lists[r.kind]) continue;
          seen.add(r.id);
          const sim = similarity(queryTri, r.folded, TYPO_MIN_SIM);
          if (sim < TYPO_MIN_SIM) continue;
          const row = { ...r, typo: true, sim, text: typoScore(sim) };
          lists[r.kind].push(row);
          typo.push(row);
        }
      };
      // 1. Les trigrammes rares (sous le plafond de fréquence), classés : un nom qui en contient le plus vient d'abord.
      const rare = grams.filter(([, n]) => n < GRAM_CAP).slice(0, TYPO_GRAMS);
      if (rare.length && rare.reduce((sum, [, n]) => sum + n, 0) <= TRI_RANK_MAX) {
        take(q(ST_TRI_RANKED).all(rare.map(([g]) => `"${g}"`).join(' OR ')));
      }
      // 2. Toujours trop peu : les plus populaires qui contiennent l'un des trigrammes retenus (« nigth » → night).
      if (wanting.some((k) => lists[k].length < quotaOf(k)) && grams.length) {
        take(q(ST_TRI_CAPPED).all(grams.slice(0, TYPO_GRAMS).map(([g]) => `"${g}"`).join(' OR ')));
      }
    }
    return { lists, matched, ftsHits, typo };
  }

  /** Albums, morceaux (par leur album) et artistes dont le joueur a déjà des cartes, parmi ces candidats. */
  function ownedKeys(viewerId, lists) {
    const owned = new Set();
    if (!viewerId) return owned;
    const albumIds = (lists.album || []).map((r) => r.ref);
    const trackIds = (lists.track || []).map((r) => r.ref);
    const trackAlbum = new Map();
    if (trackIds.length) {
      for (const r of q('SELECT id, album_id FROM cat_tracks WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(trackIds))) {
        if (r.album_id) trackAlbum.set(r.id, r.album_id);
      }
    }
    const wanted = [...new Set([...albumIds, ...trackAlbum.values()])];
    if (wanted.length) {
      const have = new Set(q(`SELECT album_id FROM user_album_progress WHERE user_id = ? AND owned > 0
        AND album_id IN (SELECT value FROM json_each(?))`).all(viewerId, JSON.stringify(wanted)).map((r) => r.album_id));
      for (const id of albumIds) if (have.has(id)) owned.add(`album:${id}`);
      for (const [trackId, albumId] of trackAlbum) if (have.has(albumId)) owned.add(`track:${trackId}`);
    }
    const artistIds = (lists.artist || []).map((r) => r.ref);
    if (artistIds.length) {
      for (const r of q(`SELECT value AS id FROM json_each(?) WHERE EXISTS (SELECT 1 FROM cat_albums al
        JOIN user_album_progress p ON p.user_id = ? AND p.album_id = al.id AND p.owned > 0 WHERE al.artist_id = value)`)
        .all(JSON.stringify(artistIds), viewerId)) owned.add(`artist:${r.id}`);
    }
    return owned;
  }

  /**
   * Score final et ordre de chaque type : texte et popularité, puis le bonus de collection pour les OWNED_WINDOW
   * premiers (il ne peut pas faire remonter un résultat de plus loin). Garde `keep` lignes par type.
   */
  function rank(viewerId, lists, keep) {
    const out = {};
    const head = {};
    for (const [kind, rows] of Object.entries(lists)) {
      const seen = new Set();
      out[kind] = rows
        .filter((r) => !seen.has(r.id) && seen.add(r.id))
        .map((r) => ({ ...r, score: finalScore(r.text, r.weight) }))
        .sort(byScore);
      head[kind] = out[kind].slice(0, Math.max(keep, OWNED_WINDOW));
    }
    const owned = ownedKeys(viewerId, head);
    for (const kind of Object.keys(out)) {
      const top = head[kind].map((r) => (owned.has(`${kind}:${r.ref}`) ? { ...r, score: finalScore(r.text, r.weight, true) } : r)).sort(byScore);
      out[kind] = top.slice(0, keep);
    }
    return out;
  }

  const hiddenFor = (viewerId) => (viewerId ? deps.access?.hiddenIds?.(viewerId) : null) || new Set();

  /** Membres : résumés (bloqués dans un sens ou dans l'autre et comptes non confirmés absents), dans l'ordre. */
  function hydrateUsers(rows, viewerId, hidden) {
    const map = deps.services.userSummaries(rows.map((r) => Number(r.ref)), viewerId, { hidden });
    return rows.map((r) => ({ row: r, user: map.get(Number(r.ref)) })).filter((x) => x.user);
  }

  /** Listes visibles (publiques, non masquées, propriétaire non bloqué), avec les albums de leurs 3 premières pochettes. */
  function hydrateLists(rows, viewerId, hidden) {
    if (!rows.length) return [];
    const found = new Map(q(`SELECT id, user_id, title, kind, item_count, like_count FROM lists
      WHERE id IN (SELECT value FROM json_each(?)) AND visibility = 'public' AND hidden_at IS NULL`)
      .all(JSON.stringify(rows.map((r) => Number(r.ref)))).map((l) => [l.id, l]));
    if (!found.size) return [];
    const owners = deps.services.userSummaries([...found.values()].map((l) => l.user_id), viewerId, { hidden });
    const covers = new Map();
    for (const r of q(`SELECT list_id, item_type, item_id, (SELECT album_id FROM cat_tracks WHERE id = item_id) AS track_album
      FROM (SELECT list_id, item_type, item_id, ROW_NUMBER() OVER (PARTITION BY list_id ORDER BY position) AS rn
            FROM list_items WHERE list_id IN (SELECT value FROM json_each(?))) WHERE rn <= 3`).all(JSON.stringify([...found.keys()]))) {
      const albumId = r.item_type === 'album' ? r.item_id : r.track_album;
      if (!albumId) continue;
      if (!covers.has(r.list_id)) covers.set(r.list_id, []);
      covers.get(r.list_id).push(albumId);
    }
    const out = [];
    for (const r of rows) {
      const l = found.get(Number(r.ref));
      const user = l && owners.get(l.user_id);
      if (!user) continue;
      const coverAlbumIds = covers.get(l.id) || [];
      out.push({
        row: r,
        list: { id: l.id, title: l.title, kind: l.kind, itemCount: l.item_count, likeCount: l.like_count, user, coverAlbumId: coverAlbumIds[0] || null, coverAlbumIds },
      });
    }
    return out;
  }

  /** Progression du joueur sur ces albums : { [albumId]: { owned, total } } (user_album_progress). */
  function progressFor(viewerId, albumIds) {
    const out = {};
    if (!viewerId || !albumIds.length) return out;
    for (const r of q(`SELECT album_id, owned, total FROM user_album_progress WHERE user_id = ?
      AND album_id IN (SELECT value FROM json_each(?))`).all(viewerId, JSON.stringify([...new Set(albumIds)]))) {
      out[r.album_id] = { owned: r.owned, total: r.total };
    }
    return out;
  }

  /** Nom affiché d'un document (« Vouliez-vous dire… ») : catalogue, membres ou listes. */
  function displayName(row) {
    switch (row.kind) {
      case 'album': return deps.catalog.album(row.ref)?.title ?? null;
      case 'track': return deps.catalog.track(row.ref)?.title ?? null;
      case 'artist': return deps.catalog.artist(row.ref)?.name ?? null;
      case 'user': return q('SELECT username FROM users WHERE id = ?').get(Number(row.ref))?.username ?? null;
      case 'list': return q('SELECT title FROM lists WHERE id = ?').get(Number(row.ref))?.title ?? null;
      default: return null;
    }
  }

  /** Types demandés : « all », un type, ou plusieurs séparés par des virgules (« album,track », Collection). */
  function kindsOf(scope) {
    if (scope == null || scope === '' || scope === 'all') return SEARCH_KINDS;
    const list = String(scope).split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.length || list.length > SEARCH_KINDS.length || list.some((k) => !SEARCH_KINDS.includes(k))) {
      throw new deps.HttpError(400, 'invalid_input', { field: 'scope' });
    }
    return SEARCH_KINDS.filter((k) => list.includes(k));
  }

  const emptyOf = (kinds, value) => Object.fromEntries(kinds.map((k) => [k, value()]));
  /** Compteur affiché d'un type : correspondances par préfixe et par ressemblance, plafonné à 100. */
  const countOf = (kind, matched, lists) => Math.min(COUNT_CAP, matched[kind] + lists[kind].filter((r) => r.typo).length);

  /**
   * Suggestions de la liste déroulante : groupes par type (albums 4, morceaux 4, artistes 3, membres 3, listes 2 ;
   * 8 pour un seul type), compteurs plafonnés à 100, meilleur premier résultat (`top`), suggestion de correction
   * quand rien ne commence comme la requête.
   */
  function suggest(viewerId, rawQ, scope = 'all') {
    const kinds = kindsOf(scope);
    const qText = cleanQuery(rawQ);
    const prepared = prepareQuery(qText);
    if (!prepared) {
      return { q: qText, suggestion: null, top: null, groups: emptyOf(kinds, () => []), counts: emptyOf(kinds, () => 0), progress: {}, catalog: NO_CATALOG };
    }
    const quotaOf = (k) => (kinds.length === 1 ? SCOPE_QUOTA : QUOTAS[k]);
    const { lists, matched, ftsHits, typo } = candidates(prepared, kinds, quotaOf);
    const ranked = rank(viewerId, lists, SUGGEST_KEEP);
    const hidden = hiddenFor(viewerId);

    const groups = emptyOf(kinds, () => []);
    const counts = emptyOf(kinds, () => 0);
    const firsts = [];
    const ids = { album: [], track: [], artist: [] };
    const people = [];
    for (const kind of kinds) {
      const rows = ranked[kind];
      const quota = quotaOf(kind);
      counts[kind] = countOf(kind, matched, lists);
      if (kind === 'user' || kind === 'list') {
        // Quelques candidats de plus : certains disparaissent à l'habillage (bloqués, liste devenue privée).
        const read = rows.slice(0, quota * 3);
        const found = kind === 'user' ? hydrateUsers(read, viewerId, hidden) : hydrateLists(read, viewerId, hidden);
        counts[kind] = Math.max(found.length, counts[kind] - (read.length - found.length));
        const kept = found.slice(0, quota);
        if (kind === 'user') {
          groups.user = kept.map((x) => ({ ...x.user, typo: x.row.typo }));
          people.push(...groups.user);
          if (kept[0]) firsts.push({ ...kept[0].row, kind, id: kept[0].user.id, username: kept[0].user.username });
        } else {
          groups.list = kept.map((x) => ({ ...x.list, typo: x.row.typo }));
          for (const l of groups.list) {
            ids.album.push(...l.coverAlbumIds);
            people.push(l.user);
          }
          if (kept[0]) firsts.push({ ...kept[0].row, kind, id: kept[0].list.id });
        }
        continue;
      }
      const kept = rows.slice(0, quota);
      groups[kind] = kept.map((r) => ({ id: r.ref, typo: r.typo }));
      ids[kind].push(...kept.map((r) => r.ref));
      if (kept[0]) firsts.push({ ...kept[0], kind, id: kept[0].ref });
    }

    let best = null;
    for (const f of firsts) if (betterTop(f, best)) best = f;
    const top = best ? { kind: best.kind, id: best.id, ...(best.username && { username: best.username }) } : null;

    let suggestion = null;
    if (!ftsHits && typo.length) {
      const bestTypo = typo.reduce((a, b) => (b.sim > a.sim || (b.sim === a.sim && b.weight > a.weight) ? b : a));
      if (bestTypo.sim >= SUGGEST_MIN_SIM) suggestion = displayName(bestTypo);
    }

    const progress = progressFor(viewerId, (groups.album || []).map((a) => a.id));
    const catalog = deps.refs({ albumIds: [...ids.album, ...deps.services.summaryAlbums(people)], trackIds: ids.track, artistIds: ids.artist });
    return { q: qText, suggestion, top, groups, counts, progress, catalog };
  }

  /**
   * Page de résultats d'un type : { q, type, items, nextCursor, total, progress, catalog }. Albums, morceaux,
   * artistes : { id, typo } ; membres : UserSummary ; listes : comme dans les suggestions. 240 résultats au plus.
   */
  function search(viewerId, rawQ, type, { offset = 0, limit = 24 } = {}) {
    if (!SEARCH_KINDS.includes(type)) throw new deps.HttpError(400, 'invalid_input', { field: 'type' });
    const qText = cleanQuery(rawQ);
    const prepared = prepareQuery(qText);
    if (!prepared) return { q: qText, type, items: [], nextCursor: null, total: 0, progress: {}, catalog: NO_CATALOG };
    const key = `${viewerId || 0}|${type}|${prepared.fq}`;
    let ranked = pageCache.get(key);
    if (!ranked) {
      const { lists } = candidates(prepared, [type], () => SCOPE_QUOTA);
      ranked = pageCache.set(key, rank(viewerId, lists, RESULTS_CAP)[type].map((r) => ({ ref: r.ref, typo: r.typo })));
    }
    const slice = ranked.slice(offset, offset + limit);
    const hidden = hiddenFor(viewerId);
    const ids = { album: [], track: [], artist: [] };
    let items;
    if (type === 'user') {
      items = hydrateUsers(slice, viewerId, hidden).map((x) => ({ ...x.user, typo: x.row.typo }));
      ids.album.push(...deps.services.summaryAlbums(items));
    } else if (type === 'list') {
      items = hydrateLists(slice, viewerId, hidden).map((x) => ({ ...x.list, typo: x.row.typo }));
      for (const l of items) ids.album.push(...l.coverAlbumIds, ...deps.services.summaryAlbums([l.user]));
    } else {
      items = slice.map((r) => ({ id: r.ref, typo: r.typo }));
      ids[type].push(...items.map((i) => i.id));
    }
    const next = offset + slice.length;
    return {
      q: qText,
      type,
      items,
      nextCursor: next < ranked.length && next < RESULTS_CAP ? deps.paging.encodeCursor([next]) : null,
      total: ranked.length,
      progress: type === 'album' ? progressFor(viewerId, ids.album) : {},
      catalog: deps.refs({ albumIds: ids.album, trackIds: ids.track, artistIds: ids.artist }),
    };
  }

  return { rebuild, refresh, upsert, remove, refreshWeights, status, suggest, search, kindsOf, forget, loadTerms: () => terms.load() };
}

export function init(deps) {
  const index = createSearchIndex(deps);
  // Construction au démarrage (avant listen()) si la version de l'index a changé ; sinon, chargement du dictionnaire
  // des mots et rattrapage incrémental des lignes ajoutées pendant que le serveur était arrêté.
  if (kvGet(deps.db, 'search:version') !== SEARCH_VERSION) {
    const built = index.rebuild();
    if (!deps.config?.isTest) console.log(`  Recherche : index construit (${built.docs} documents en ${built.ms} ms).`);
  } else {
    index.loadTerms();
    try {
      index.refresh();
    } catch (err) {
      console.error('[search] rattrapage de l’index :', err);
    }
  }

  // Événements : compte confirmé, liste enregistrée (P1-C) ou retirée.
  deps.bus.on('user.verified', ({ userId }) => index.upsert('user', String(userId)));
  deps.bus.on('list.saved', ({ listId }) => index.upsert('list', String(listId)));
  deps.bus.on('content.removed', ({ targetType, targetId }) => {
    if (targetType === 'list') index.remove('list', String(targetId));
  });

  // Nouvelles lignes du catalogue (import Deezer en arrière-plan) : indexées toutes les 5 minutes.
  if (!deps.config?.isTest) {
    const timer = setInterval(() => {
      try {
        index.refresh();
      } catch (err) {
        console.error('[search] rafraîchissement de l’index :', err);
      }
    }, REFRESH_MS);
    timer.unref?.();
  }
  return index;
}

export function routes(r, deps) {
  // Server-Timing : temps de calcul de la recherche, lisible dans les outils du navigateur (et par scripts/e2e/p0-e.mjs).
  const timed = (res, fn) => {
    const started = performance.now();
    const out = fn();
    res.set('Server-Timing', `search;dur=${(performance.now() - started).toFixed(1)}`);
    return out;
  };
  r.get('/search/suggest', deps.limits.search, (req, res) => {
    const out = timed(res, () => deps.search.suggest(req.user.id, req.query.q, req.query.scope));
    res.set('Cache-Control', 'private, max-age=30');
    res.json(out);
  });
  r.get('/search', deps.limits.search, (req, res) => {
    const offset = deps.paging.offsetOf(req.query.cursor, { cap: RESULTS_CAP });
    const limit = deps.paging.limitOf(req.query.limit, { def: 24, max: 48 });
    res.json(timed(res, () => deps.search.search(req.user.id, req.query.q, req.query.type ?? 'album', { offset, limit })));
  });
}

export function adminRoutes(r, deps) {
  r.get('/search', (_req, res) => res.json(deps.search.status()));
  r.post('/search/rebuild', (req, res) => {
    const built = deps.search.rebuild();
    deps.services.audit(req.user.id, 'search.rebuild', null, built);
    res.json(deps.search.status());
  });
}

export const jobs = [
  { name: 'search-weights', run: (deps) => deps.search.refreshWeights() },
];
