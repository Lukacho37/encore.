// Collecte du prestige mondial des artistes et des albums (le calcul est dans shared/prestige.js, le calibrage des
// raretés dans server/importer.js). Deux sources ouvertes, indépendantes de l'audience de Deezer :
//   - Wikidata (SPARQL, par lots) : l'élément de l'artiste (identifiant Deezer P2722, sinon nom exact avec un
//     identifiant MusicBrainz P434), puis ses albums (P175), rapprochés des nôtres par identifiant Deezer (P2723) ou par
//     titre ; pour chacun, le nombre d'éditions de Wikipédia qui lui consacrent un article (sitelinks) ;
//   - ListenBrainz (/1/popularity, par lots de 300) : auditeurs dans le monde de l'album (groupe de parutions
//     MusicBrainz P436) et de l'artiste (P434).
// Écrit cat_artists / cat_albums.wd_links, lb_users, prestige_at (0 quand rien n'est trouvé : c'est aussi une
// information) et range les identifiants Wikidata et MusicBrainz trouvés dans external_ids. Les artistes sont traités
// par paquets enregistrés au fur et à mesure : une coupure ne perd que le paquet en cours. Quelques minutes pour
// 20 000 albums. PRESTIGE=off : aucune requête (défaut des tests).
import { config, isLocalUrl } from './config.js';
import { baseTitle, normText } from './importer.js';

const ARTIST_BATCH = 150; // identifiants Deezer par requête SPARQL
const NAME_BATCH = 40; // noms par requête SPARQL (artistes sans identifiant Deezer sur Wikidata)
const ALBUM_BATCH = 40; // artistes dont on lit les albums par requête SPARQL
const LB_BATCH = 300; // identifiants MusicBrainz par requête ListenBrainz
const CHUNK = 600; // artistes traités puis enregistrés ensemble
const MAX_TRIES = 4;
// Album (Q482994) et album studio (Q208569) : ni single, ni compilation, ni live.
const ALBUM_TYPES = 'wd:Q482994 wd:Q208569';

// Pays francophones (Wikidata) : France, Belgique, Suisse, Luxembourg, Monaco, Canada (avec la langue française),
// Haïti, Afrique francophone et Maghreb.
const FRANCOPHONE = ['Q142', 'Q31', 'Q39', 'Q32', 'Q235', 'Q790', 'Q1041', 'Q1008', 'Q1009', 'Q974', 'Q971', 'Q912', 'Q1006',
  'Q965', 'Q962', 'Q945', 'Q1000', 'Q1019', 'Q1032', 'Q262', 'Q1028', 'Q948'];
// Métiers de la musique (chanteur, musicien, rappeur, auteur-compositeur, compositeur, DJ, producteur, guitariste,
// parolier) et groupes (groupe de musique, groupe de rock, duo).
const MUSIC_JOBS = 'wd:Q177220 wd:Q639669 wd:Q2252262 wd:Q488205 wd:Q36834 wd:Q130857 wd:Q183945 wd:Q855091 wd:Q753110';
const MUSIC_GROUPS = 'wd:Q215380 wd:Q5741069 wd:Q9212979';

/** Clé de rapprochement d'un titre : titre de base sans espaces ni ordinal (« LP2 » = « LP 2 », « Bad 25th » = « Bad »). */
export const matchKey = (title) => baseTitle(String(title || '').replace(/\b\d+(st|nd|rd|th|e|ème|eme)\b/gi, ' ')).replace(/\s+/g, '');

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function prestigeSettings(env = process.env, cfg = config) {
  const raw = String(env.PRESTIGE ?? '').trim().toLowerCase();
  const mode = raw ? (raw === 'off' ? 'off' : 'on') : cfg.isTest ? 'off' : 'on';
  // Contact du User-Agent, comme pour MusicBrainz (server/enrich.js) ; sans contact, le nom du projet seulement.
  const contact = text(env.ENRICH_CONTACT) || cfg.legal?.contactEmail || (cfg.appUrl && !isLocalUrl(cfg.appUrl) ? cfg.appUrl : null);
  return {
    mode,
    userAgent: `AlbumMania (prestige du catalogue${contact ? ` ; ${contact}` : ''})`,
    sparqlUrl: text(env.WIKIDATA_SPARQL_URL) || 'https://query.wikidata.org/sparql',
    lbUrl: (text(env.LISTENBRAINZ_API_URL) || 'https://api.listenbrainz.org/1').replace(/\/$/, ''),
    pauseMs: cfg.isTest ? 0 : 500,
  };
}

export function createPrestige(db, { settings = prestigeSettings(), fetchImpl = (...a) => fetch(...a), log = console } = {}) {
  const q = (sql) => db.prepare(sql);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastCall = 0;
  let running = null;

  async function request(url, init) {
    for (let attempt = 1; ; attempt++) {
      const gap = settings.pauseMs - (Date.now() - lastCall);
      if (gap > 0) await wait(gap);
      lastCall = Date.now();
      let res = null;
      try {
        res = await fetchImpl(url, { ...init, headers: { 'User-Agent': settings.userAgent, ...init.headers }, signal: AbortSignal.timeout(60_000) });
      } catch (err) {
        if (attempt >= MAX_TRIES) throw err;
      }
      if (res?.ok) return res.json();
      const retry = !res || res.status === 429 || res.status >= 500;
      if (!retry || attempt >= MAX_TRIES) throw new Error(`HTTP ${res?.status ?? 'réseau'} (${new URL(url).host})`);
      const after = Number(res?.headers?.get?.('retry-after')) || Number(res?.headers?.get?.('x-ratelimit-reset-in')) || 2 ** attempt;
      await wait(Math.min(60, after) * 1000);
    }
  }

  const sparql = async (query) => (await request(settings.sparqlUrl, {
    method: 'POST',
    headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `query=${encodeURIComponent(query)}`,
  })).results?.bindings || [];

  const listenbrainz = (kind, ids) => request(`${settings.lbUrl}/popularity/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(kind === 'artist' ? { artist_mbids: ids } : { release_group_mbids: ids }),
  });

  /** Lots d'une requête ; un lot qui échoue est coupé en deux (requête trop lourde), jusqu'à l'élément seul, passé. */
  async function batched(items, size, run) {
    for (let i = 0; i < items.length; i += size) {
      const part = items.slice(i, i + size);
      try {
        await run(part);
      } catch (err) {
        if (part.length === 1) {
          log.warn?.(`  Prestige : ${err.message}, élément passé.`);
          continue;
        }
        await batched(part, Math.ceil(part.length / 2), run);
      }
    }
  }

  const val = (b, k) => b[k]?.value;
  const qid = (uri) => String(uri || '').split('/').pop();
  const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const lit = (s) => JSON.stringify(String(s)); // chaîne SPARQL (mêmes échappements que JSON)
  const better = (prev, links) => !prev || links > prev.links;

  const extGet = q("SELECT source_id FROM external_ids WHERE entity_type = ? AND entity_id = ? AND source = ? ORDER BY confidence DESC LIMIT 1");
  const extPut = q(`INSERT OR IGNORE INTO external_ids (entity_type, entity_id, source, source_id, url, confidence, matched_by, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, 'prestige', ?)`);
  const putExt = (type, id, source, value, confidence) => {
    if (!value || extGet.get(type, id, source)) return;
    const url = source === 'wikidata' ? `https://www.wikidata.org/wiki/${value}` : `https://musicbrainz.org/${type === 'artist' ? 'artist' : 'release-group'}/${value}`;
    extPut.run(type, id, source, value, url, confidence, Date.now());
  };

  /** Éléments Wikidata des artistes : identifiant Deezer d'abord, puis nom exact (artistes avec un identifiant MusicBrainz). */
  async function findArtists(rows) {
    const found = new Map();
    const byDeezer = new Map(rows.filter((r) => r.deezer_id).map((r) => [String(r.deezer_id), r.id]));
    await batched([...byDeezer.keys()], ARTIST_BATCH, async (ids) => {
      const res = await sparql(`SELECT ?dz ?item ?links ?mb WHERE { VALUES ?dz { ${ids.map(lit).join(' ')} }
        ?item wdt:P2722 ?dz ; wikibase:sitelinks ?links . OPTIONAL { ?item wdt:P434 ?mb } }`);
      for (const b of res) {
        const id = byDeezer.get(val(b, 'dz'));
        const links = Number(val(b, 'links')) || 0;
        if (id && better(found.get(id), links)) found.set(id, { qid: qid(val(b, 'item')), links, mbid: val(b, 'mb') || null });
      }
    });
    const byName = new Map();
    for (const r of rows) if (!found.has(r.id) && text(r.name)) byName.set(normText(r.name), r.id);
    const names = rows.filter((r) => !found.has(r.id) && text(r.name)).map((r) => r.name.trim());
    await batched(names, NAME_BATCH, async (part) => {
      const res = await sparql(`SELECT ?name ?item ?links ?mb WHERE { VALUES ?name { ${part.flatMap((n) => [`${lit(n)}@en`, `${lit(n)}@fr`]).join(' ')} }
        ?item rdfs:label ?name ; wdt:P434 ?mb ; wikibase:sitelinks ?links . }`);
      for (const b of res) {
        const id = byName.get(normText(val(b, 'name')));
        const links = Number(val(b, 'links')) || 0;
        if (id && better(found.get(id), links)) found.set(id, { qid: qid(val(b, 'item')), links, mbid: val(b, 'mb') || null, byName: true });
      }
    });
    return found;
  }

  /** Albums Wikidata des artistes (qid → [{ qid, links, rg, dz, keys }]). */
  async function artistAlbums(qids) {
    const out = new Map();
    await batched(qids, ALBUM_BATCH, async (part) => {
      const res = await sparql(`SELECT ?artist ?item ?links ?rg ?dz (GROUP_CONCAT(DISTINCT ?label; separator="|||") AS ?labels) WHERE {
        VALUES ?artist { ${part.map((x) => `wd:${x}`).join(' ')} }
        VALUES ?type { ${ALBUM_TYPES} }
        ?item wdt:P175 ?artist ; wdt:P31 ?type ; wikibase:sitelinks ?links .
        OPTIONAL { ?item wdt:P436 ?rg } OPTIONAL { ?item wdt:P2723 ?dz }
        ?item rdfs:label ?label FILTER(LANG(?label) IN ("en", "fr", "es", "de", "pt", "it"))
      } GROUP BY ?artist ?item ?links ?rg ?dz`);
      for (const b of res) {
        const artist = qid(val(b, 'artist'));
        if (!out.has(artist)) out.set(artist, []);
        out.get(artist).push({
          qid: qid(val(b, 'item')),
          links: Number(val(b, 'links')) || 0,
          rg: val(b, 'rg') || null,
          dz: val(b, 'dz') || null,
          keys: new Set(String(val(b, 'labels') || '').split('|||').map(matchKey).filter(Boolean)),
        });
      }
    });
    return out;
  }

  /** Auditeurs ListenBrainz (mbid → total_user_count). */
  async function listeners(kind, mbids) {
    const out = new Map();
    const ids = [...new Set(mbids.filter((m) => MBID.test(m || '')))];
    await batched(ids, LB_BATCH, async (part) => {
      const res = await listenbrainz(kind, part);
      for (const r of Array.isArray(res) ? res : []) {
        const id = kind === 'artist' ? r.artist_mbid : r.release_group_mbid;
        if (id) out.set(id, Number(r.total_user_count) || 0);
      }
    });
    return out;
  }

  const albumsOf = q('SELECT id, artist_id, title, deezer_id FROM cat_albums WHERE artist_id IN (SELECT value FROM json_each(?)) AND prestige_at IS NULL');
  const setArtist = q('UPDATE cat_artists SET wd_links = ?, lb_users = ?, prestige_at = ? WHERE id = ?');
  const setAlbum = q('UPDATE cat_albums SET wd_links = ?, lb_users = ?, prestige_at = ? WHERE id = ?');

  /** Un paquet d'artistes : leurs éléments (sauf `known`, déjà évalués), leurs albums non évalués, les auditeurs. */
  async function processArtists(rows, { known = false } = {}) {
    const info = known
      ? new Map(rows.map((r) => [r.id, { qid: extGet.get('artist', r.id, 'wikidata')?.source_id || null, links: r.wd_links || 0 }]).filter(([, v]) => v.qid))
      : await findArtists(rows);
    const albums = albumsOf.all(JSON.stringify(rows.map((r) => r.id)));
    const wd = await artistAlbums([...new Set([...info.values()].map((v) => v.qid))]);
    const matched = new Map();
    for (const al of albums) {
      const cands = wd.get(info.get(al.artist_id)?.qid) || [];
      const key = matchKey(al.title);
      let best = cands.find((c) => c.dz && al.deezer_id && c.dz === String(al.deezer_id));
      if (!best) for (const c of cands) if (key && c.keys.has(key) && better(best, c.links)) best = c;
      if (best) matched.set(al.id, { ...best, exact: !!(best.dz && al.deezer_id && best.dz === String(al.deezer_id)) });
    }
    const rgUsers = await listeners('release-group', [...matched.values()].map((m) => m.rg));
    const artistUsers = known ? new Map() : await listeners('artist', [...info.values()].map((v) => v.mbid));

    const now = Date.now();
    db.exec('BEGIN');
    try {
      if (!known) {
        for (const r of rows) {
          const v = info.get(r.id);
          setArtist.run(v ? v.links : 0, v?.mbid ? artistUsers.get(v.mbid) ?? 0 : 0, now, r.id);
          if (v) {
            putExt('artist', r.id, 'wikidata', v.qid, v.byName ? 0.8 : 1);
            if (v.mbid && MBID.test(v.mbid)) putExt('artist', r.id, 'musicbrainz', v.mbid, v.byName ? 0.8 : 1);
          }
        }
      }
      for (const al of albums) {
        const m = matched.get(al.id);
        setAlbum.run(m ? m.links : 0, m?.rg ? rgUsers.get(m.rg) ?? 0 : 0, now, al.id);
        if (m) {
          putExt('album', al.id, 'wikidata', m.qid, m.exact ? 1 : 0.8);
          if (m.rg && MBID.test(m.rg)) putExt('album', al.id, 'musicbrainz', m.rg, m.exact ? 1 : 0.8);
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { artists: known ? 0 : rows.length, artistsFound: known ? 0 : info.size, albums: albums.length, albumsFound: matched.size };
  }

  /**
   * Évalue les artistes et albums qui ne l'ont pas encore été. Renvoie les compteurs ; `changed` : au moins un album
   * évalué (le calibrage des raretés doit être refait).
   */
  async function run({ onProgress = null } = {}) {
    const total = { artists: 0, artistsFound: 0, albums: 0, albumsFound: 0 };
    const add = (s) => {
      for (const k of Object.keys(total)) total[k] += s[k];
      onProgress?.({ ...total });
    };
    const fresh = q('SELECT id, name, deezer_id FROM cat_artists WHERE prestige_at IS NULL LIMIT ?');
    for (let rows = fresh.all(CHUNK); rows.length; rows = fresh.all(CHUNK)) add(await processArtists(rows));
    // Nouveaux albums d'artistes déjà évalués (import du lendemain, vérification des sorties).
    const later = q(`SELECT id, name, deezer_id, wd_links FROM cat_artists WHERE prestige_at IS NOT NULL
      AND id IN (SELECT artist_id FROM cat_albums WHERE prestige_at IS NULL)`).all();
    for (let i = 0; i < later.length; i += CHUNK) add(await processArtists(later.slice(i, i + CHUNK), { known: true }));
    // Albums sans artiste évaluable (ne devrait pas arriver) : notés quand même, pour ne pas les redemander.
    q('UPDATE cat_albums SET wd_links = COALESCE(wd_links, 0), lb_users = COALESCE(lb_users, 0), prestige_at = ? WHERE prestige_at IS NULL').run(Date.now());
    return { ...total, changed: total.albums > 0 };
  }

  /** Collecte (une seule à la fois) ; null quand PRESTIGE=off. */
  function collect(opts) {
    if (settings.mode === 'off') return Promise.resolve(null);
    running ||= run(opts).finally(() => {
      running = null;
    });
    return running;
  }

  /**
   * Artistes francophones connus de Wikidata avec un identifiant Deezer, les plus présents sur Wikipédia d'abord :
   * nationalité ou pays d'origine francophone, ou langue française. Les classements de Deezer dépendent du pays d'où
   * part la requête : sans cette liste, un serveur hébergé hors de France n'importe presque pas de musique française.
   */
  async function francophoneArtists({ limit = 2000 } = {}) {
    if (settings.mode === 'off') return [];
    // Une requête par critère : réunis en une seule, ils dépassent le temps accordé par le service SPARQL.
    // Québec : nationalité canadienne et langue française.
    const criteria = [...FRANCOPHONE.flatMap((c) => [`wdt:P27 wd:${c}`, `wdt:P495 wd:${c}`]), 'wdt:P27 wd:Q16 ; wdt:P1412 wd:Q150'];
    const best = new Map();
    await batched(criteria, 1, async ([criterion]) => {
      // Musiciens et groupes seulement (Deezer a aussi des fiches d'écrivains et d'acteurs, pour les livres audio).
      const rows = await sparql(`SELECT ?dz ?links ?name WHERE { ?item ${criterion} ; wdt:P2722 ?dz ; wikibase:sitelinks ?links .
        FILTER EXISTS { { ?item wdt:P106 ?job . VALUES ?job { ${MUSIC_JOBS} } } UNION { ?item wdt:P31 ?kind . VALUES ?kind { ${MUSIC_GROUPS} } } }
        OPTIONAL { ?item rdfs:label ?name FILTER(LANG(?name) IN ("fr", "en")) } }`);
      for (const b of rows) {
        const dz = val(b, 'dz');
        const links = Number(val(b, 'links')) || 0;
        if (/^\d+$/.test(dz || '') && better(best.get(dz), links)) best.set(dz, { deezerId: dz, name: val(b, 'name') || dz, links });
      }
    });
    return [...best.values()].sort((a, b) => b.links - a.links).slice(0, Math.max(1, Math.floor(limit)));
  }

  const status = () => q(`SELECT
      (SELECT COUNT(*) FROM cat_albums) AS albums,
      (SELECT COUNT(*) FROM cat_albums WHERE prestige_at IS NOT NULL) AS rated,
      (SELECT COUNT(*) FROM cat_albums WHERE wd_links > 0) AS withArticle,
      (SELECT COUNT(*) FROM cat_albums WHERE lb_users > 0) AS withListeners`).get();

  return { collect, status, francophoneArtists, settings };
}
