// Provenance et enrichissement du catalogue (PLAN.md 3.4, 3.8, 4.3, 7.1, 8.3 P2.6, chantier P2-C) : passe MusicBrainz /
// Wikidata contre de faux services HTTP locaux (le bac à sable n'a pas Internet) — code-barres puis titre et artiste,
// relations d'URL, Wikidata, pays et country_source, homonymes écartés, pays de la graine et pays « manuels »
// jamais réécrits ; politesse (User-Agent avec contact, écart minimal, attente sur 429 / 503 avec Retry-After, arrêt
// sur une panne) ; pause qui tient après un redémarrage, reprise sans refaire ce qui est trouvé ; /catalog/listen ;
// tâches « enrich » et « album-similar » ; espace admin réservé à ADMIN_EMAILS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';

process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'patronne@example.com';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.now();

// ---------- faux MusicBrainz et faux Wikidata ----------

/**
 * Monde du faux MusicBrainz : artistes, parutions (par clé), enregistrements par ISRC ; Wikidata : éléments.
 * `busy` : chemin → nombre de 503 (Retry-After: 0) à rendre avant de répondre ; `always429` : tout est refusé.
 */
function makeWorld() {
  const claim = (v) => ({ mainsnak: { datavalue: { value: v } }, rank: 'normal' });
  const item = (id) => claim({ 'entity-type': 'item', id });
  return {
    db: null,
    log: [],
    busy: new Map(),
    always429: false,
    artists: {
      [uuid(1)]: { id: uuid(1), name: 'Daft Punk', country: 'US', relations: [
        { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q185828' } },
        { type: 'free streaming', url: { resource: 'https://open.spotify.com/artist/4tZwfgrHOc3mvqYlEYSvVi' } },
      ] },
      [uuid(11)]: { id: uuid(11), name: 'Test Band Alpha', country: 'GB', relations: [] },
      [uuid(12)]: { id: uuid(12), name: 'Beta Solo', area: { name: 'Quelque part' }, relations: [
        { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q900' } },
      ] },
      [uuid(13)]: { id: uuid(13), name: 'Gamma', country: 'DE', relations: [] },
      [uuid(14)]: { id: uuid(14), name: 'Gamma', country: 'NL', relations: [] },
      [uuid(15)]: { id: uuid(15), name: 'Delta', area: { name: 'Stockholm', 'iso-3166-2-codes': ['SE-AB'] }, relations: [] },
      [uuid(16)]: { id: uuid(16), name: 'Epsilon', country: 'US', relations: [] },
    },
    // Parutions : clé = id de l'album chez nous (les pistes sont lues dans la base du test).
    releases: {
      discovery: { id: uuid(101), rg: uuid(201), title: 'Discovery', artist: uuid(1), barcode: '724384960650',
        relations: [{ type: 'free streaming', url: { resource: 'https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc' } }],
        rgRelations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q1129999' } }] },
      'al-alpha': { id: uuid(102), rg: uuid(202), title: 'Alpha Record', artist: uuid(11), barcode: '000000123456', relations: [], rgRelations: [] },
      'al-beta': { id: uuid(103), rg: uuid(203), title: 'Beta Songs (Deluxe Edition)', artist: uuid(12), barcode: null,
        relations: [{ type: 'streaming', url: { resource: 'https://music.apple.com/gb/album/beta-songs/1500000001' } }], rgRelations: [] },
    },
    isrc: { FRAM10000001: [{ id: uuid(301), title: 'Delta Single', isrcs: ['FRAM10000001'] }] },
    entities: {
      Q1129999: { id: 'Q1129999', claims: { P436: [claim(uuid(201))], P2281: [claim('697194953')], P2205: [claim('2noRn2Aes5aoNVsU6iWThc')] } },
      Q185828: { id: 'Q185828', claims: { P434: [claim(uuid(1))], P1902: [claim('4tZwfgrHOc3mvqYlEYSvVi')], P2850: [claim('5468295')], P495: [item('Q142')] } },
      Q900: { id: 'Q900', claims: { P434: [claim(uuid(12))], P27: [item('Q142')], P1902: [claim('0aBcDeFgHiJkLmNoPqRsTu')] } },
      Q142: { id: 'Q142', claims: { P297: [claim('FR')] } },
    },
  };
}

function releaseView(world, key, { full = false } = {}) {
  const r = world.releases[key];
  const artist = world.artists[r.artist];
  const titles = world.db.prepare('SELECT title FROM cat_tracks WHERE album_id = ? ORDER BY n').all(key).map((t) => t.title);
  const base = {
    id: r.id, title: r.title, status: 'Official', barcode: r.barcode, score: 100, 'track-count': titles.length,
    'artist-credit': [{ name: artist.name, joinphrase: '', artist: { id: artist.id, name: artist.name } }],
    'release-group': { id: r.rg, 'primary-type': 'Album' },
  };
  if (!full) return base;
  return {
    ...base,
    relations: r.relations,
    'release-group': { ...base['release-group'], relations: r.rgRelations },
    media: [{ position: 1, 'track-count': titles.length, tracks: titles.map((title, i) => ({
      position: i + 1, number: String(i + 1), title,
      recording: { id: uuid(1000 + Number(r.id.slice(-3)) * 100 + i), title, isrcs: [`GBAM1${String(Number(r.id.slice(-3)) * 100 + i).padStart(7, '0')}`] },
    })) }],
  };
}

async function startFake(world) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://fake');
    const kind = u.pathname.startsWith('/w/') ? 'wd' : 'mb';
    world.log.push({ t: Date.now(), path: u.pathname, query: u.searchParams.get('query'), ua: req.headers['user-agent'], kind });
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (world.always429) return send(429, { error: 'slow down' }, { 'Retry-After': '0' });
    const left = world.busy.get(u.pathname) || 0;
    if (left > 0) {
      world.busy.set(u.pathname, left - 1);
      return send(503, { error: 'busy' }, { 'Retry-After': '0' });
    }
    if (kind === 'wd') {
      const ids = String(u.searchParams.get('ids') || '').split('|');
      return send(200, { entities: Object.fromEntries(ids.map((id) => [id, world.entities[id] || { id, missing: '' }])) });
    }
    const q = u.searchParams.get('query') || '';
    let m;
    if (u.pathname === '/ws/2/release') {
      if ((m = /^barcode:(\d+)$/.exec(q))) {
        return send(200, { releases: Object.keys(world.releases).filter((k) => world.releases[k].barcode === m[1]).map((k) => releaseView(world, k)) });
      }
      if ((m = /^release:"(.*)" AND artist:"(.*)"$/.exec(q))) {
        const [, title, artist] = m;
        const keys = Object.keys(world.releases).filter((k) => {
          const r = world.releases[k];
          return r.title.toLowerCase().startsWith(title.toLowerCase()) && world.artists[r.artist].name.toLowerCase() === artist.toLowerCase();
        });
        return send(200, { releases: keys.map((k) => releaseView(world, k)) });
      }
      return send(200, { releases: [] });
    }
    if ((m = /^\/ws\/2\/release\/([0-9a-f-]+)$/.exec(u.pathname))) {
      const key = Object.keys(world.releases).find((k) => world.releases[k].id === m[1]);
      return key ? send(200, releaseView(world, key, { full: true })) : send(404, { error: 'Not Found' });
    }
    if (u.pathname === '/ws/2/artist') {
      const want = /^artist:"(.*)"$/.exec(q)?.[1]?.toLowerCase();
      return send(200, { artists: Object.values(world.artists).filter((a) => a.name.toLowerCase() === want).map((a) => ({ ...a, score: 100, relations: undefined })) });
    }
    if ((m = /^\/ws\/2\/artist\/([0-9a-f-]+)$/.exec(u.pathname))) {
      return world.artists[m[1]] ? send(200, world.artists[m[1]]) : send(404, { error: 'Not Found' });
    }
    if ((m = /^\/ws\/2\/isrc\/([A-Z0-9]+)$/.exec(u.pathname))) {
      return world.isrc[m[1]] ? send(200, { isrc: m[1], recordings: world.isrc[m[1]] }) : send(404, { error: 'Not Found' });
    }
    if (u.pathname === '/ws/2/recording') return send(200, { recordings: [] });
    return send(404, { error: 'Not Found' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(() => r())) };
}

/** Artistes et albums du test, ajoutés au catalogue avant le démarrage (comme un import Deezer). */
let catalogNo = 7000;
function addCatalog(db) {
  const artist = (id, name, country = null, countrySource = null) => db.prepare(`INSERT INTO cat_artists (id, name, country, country_source, genre, fans, source, created_at)
    VALUES (?, ?, ?, ?, 'pop', 1000, 'deezer', ?)`).run(id, name, country, countrySource, NOW);
  const album = (id, artistId, title, n = 6) => {
    db.prepare(`INSERT INTO cat_albums (id, artist_id, title, year, genre, catalog, track_count, fans, source, created_at)
      VALUES (?, ?, ?, 2010, 'pop', ?, ?, 500, 'deezer', ?)`).run(id, artistId, title, catalogNo++, n, NOW);
    for (let i = 1; i <= n; i++) {
      db.prepare(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, year, genre, pop, rarity, source, created_at)
        VALUES (?, 'album', ?, ?, ?, ?, ?, 2010, 'pop', 40, 'common', 'deezer', ?)`).run(`${id}:${String(i).padStart(2, '0')}`, id, artistId, i, n, `${title} ${i}`, NOW);
    }
  };
  const ext = (type, id, source, value) => db.prepare(`INSERT INTO external_ids (entity_type, entity_id, source, source_id, matched_by, fetched_at)
    VALUES (?, ?, ?, ?, 'import', ?)`).run(type, id, source, value, NOW);
  artist('dzT1', 'Test Band Alpha');
  album('al-alpha', 'dzT1', 'Alpha Record');
  ext('album', 'al-alpha', 'upc', '000000123456');
  artist('dzT2', 'Beta Solo');
  album('al-beta', 'dzT2', 'Beta Songs', 5);
  artist('dzT3', 'Gamma');
  album('al-gamma', 'dzT3', 'Gamma Unknown', 4);
  artist('dzT4', 'Delta');
  db.prepare(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, year, genre, pop, rarity, source, created_at)
    VALUES ('promo:dzT4', 'promo', NULL, 'dzT4', 99, 99, 'Delta Single', 2020, 'pop', 60, 'promo', 'deezer', ?)`).run(NOW);
  ext('track', 'promo:dzT4', 'isrc', 'FRAM10000001');
  artist('dzT5', 'Epsilon', 'JP', 'manual');
}

const world = makeWorld();
const fake = await startFake(world);
process.env.ENRICH = 'musicbrainz';
process.env.ENRICH_CONTACT = 'contact-test@example.com';
process.env.ENRICH_INTERVAL_MS = '15';
process.env.MUSICBRAINZ_API_URL = `${fake.base}/ws/2`;
process.env.WIKIDATA_API_URL = `${fake.base}/w/api.php`;

const { startApp, signupVerified, api } = await import('./helpers.js');
const { openDb } = await import('../db.js');
const { createCatalog } = await import('../catalog.js');
const { createEnricher, enrichConfig, MB_INTERVAL_MS, WD_INTERVAL_MS, listenFor } = await import('../enrich.js');
const ids = await import('../../shared/ids.js');

const app = await startApp({ catalog: async (db) => addCatalog(db) });
world.db = app.db;
test.after(async () => {
  await app.close();
  await fake.close();
});
const { db, deps } = app;
const owner = await signupVerified(app, { username: 'patronne', email: 'patronne@example.com' });
const player = await signupVerified(app, { username: 'auditrice' });
const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
const extRows = (type, id, source) => db.prepare('SELECT source_id, url, matched_by, confidence FROM external_ids WHERE entity_type = ? AND entity_id = ? AND source = ? ORDER BY source_id')
  .all(type, id, source).map((r) => ({ ...r }));
const countryOf = (id) => ({ ...db.prepare('SELECT country, country_source FROM cat_artists WHERE id = ?').get(id) });

test('réglages : 1 requête / s au plus, contact obligatoire, ENRICH échoue fermé, intervalle de test ignoré ailleurs', () => {
  assert.ok(MB_INTERVAL_MS >= 1000 && WD_INTERVAL_MS >= 1000);
  const prod = { isTest: false, legal: { contactEmail: 'editeur@example.org' }, appUrl: 'https://albummania.example' };
  const c = enrichConfig({ ENRICH_INTERVAL_MS: '1' }, prod);
  assert.equal(c.mode, 'musicbrainz', 'actif par défaut hors tests');
  assert.equal(c.mbIntervalMs, MB_INTERVAL_MS, 'jamais sous une seconde hors tests');
  assert.equal(c.blocked, null);
  assert.match(c.userAgent, /^AlbumMania\/\d+\.\d+\.\d+ \( editeur@example\.org \)$/);
  assert.equal(enrichConfig({}, { ...prod, legal: {} }).contact, 'https://albummania.example', 'adresse publique du site à défaut');
  assert.equal(enrichConfig({}, { ...prod, legal: {}, appUrl: 'http://localhost:5173' }).blocked, 'contact_missing');
  for (const v of ['off', 'non', 'spotify', 'musicbrains']) assert.equal(enrichConfig({ ENRICH: v }, prod).blocked, 'off', v);
  assert.equal(enrichConfig({}, { ...prod, isTest: true }).mode, 'off', 'coupé pendant les tests sauf demande');
  assert.equal(enrichConfig({ ENRICH_CONTACT: 'ops@example.net' }, prod).contact, 'ops@example.net');
});

test('adresses et lecteurs : formats reconnus, jamais de lecture automatique', () => {
  assert.deepEqual(ids.parseProviderUrl('https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc?si=x'), { source: 'spotify', type: 'album', id: '2noRn2Aes5aoNVsU6iWThc' });
  assert.deepEqual(ids.parseProviderUrl('https://music.apple.com/fr/album/discovery/697194953'), { source: 'apple', type: 'album', id: '697194953', storefront: 'fr' });
  assert.deepEqual(ids.parseProviderUrl('https://music.apple.com/us/album/one-more-time/697194953?i=697195462'), { source: 'apple', type: 'track', id: '697195462', storefront: 'us' });
  assert.deepEqual(ids.parseProviderUrl('https://www.wikidata.org/wiki/Q185828'), { source: 'wikidata', type: null, id: 'Q185828' });
  assert.deepEqual(ids.parseProviderUrl('https://www.deezer.com/fr/album/302127'), { source: 'deezer', type: 'album', id: '302127' });
  assert.equal(ids.parseProviderUrl('https://example.com/album/1'), null);
  assert.equal(ids.parseProviderUrl('javascript:alert(1)'), null);
  assert.equal(ids.sourceUrl('musicbrainz', 'album', uuid(201)), `https://musicbrainz.org/release-group/${uuid(201)}`);
  assert.equal(ids.sourceUrl('spotify', 'album', 'nope'), null);
  const spotify = ids.embedFor('spotify', 'album', '2noRn2Aes5aoNVsU6iWThc');
  assert.deepEqual(spotify, { provider: 'spotify', src: 'https://open.spotify.com/embed/album/2noRn2Aes5aoNVsU6iWThc', height: 352 });
  assert.equal(ids.embedFor('apple', 'track', '697195462', { storefront: 'us' }).src, 'https://embed.music.apple.com/us/song/697195462');
  assert.equal(ids.embedFor('deezer', 'album', '302127').src, 'https://widget.deezer.com/widget/dark/album/302127');
  assert.equal(ids.embedFor('spotify', 'album', '"><script>'), null);
  for (const e of [spotify, ids.embedFor('apple', 'album', '1'), ids.embedFor('deezer', 'track', '1')]) assert.doesNotMatch(e.src, /autoplay/i);
});

test('espace admin réservé : un joueur ne voit ni l’enrichissement ni le détachement', async () => {
  for (const [method, path] of [['GET', '/admin/enrich'], ['POST', '/admin/enrich/start'], ['POST', '/admin/enrich/pause'], ['POST', '/admin/enrich/similar'],
    ['POST', '/admin/providers/deezer/detach']]) {
    assert.equal((await call(player, method, path, method === 'GET' ? undefined : {})).status, 403, path);
  }
  assert.equal((await call(null, 'GET', '/admin/enrich')).status, 401);
  assert.equal(world.log.length, 0, 'aucune requête partie');
});

test('passe complète : codes-barres, titres, relations, Wikidata, pays et sources, homonymes écartés, politesse', async () => {
  // Deux 503 sur la fiche d'Alpha : le moteur attend (Retry-After: 0) puis continue.
  world.busy.set(`/ws/2/artist/${uuid(11)}`, 2);
  const started = await call(owner, 'POST', '/admin/enrich/start');
  assert.equal(started.status, 200);
  assert.equal(started.body.running, true);
  assert.equal(started.body.userAgent, 'AlbumMania/0.1.0 ( contact-test@example.com )');
  await deps.enrich.enricher.current;
  const status = (await call(owner, 'GET', '/admin/enrich')).body;
  assert.equal(status.phase, 'done', JSON.stringify(status));
  assert.equal(status.progress.done, status.progress.total);
  assert.equal(status.lastError, null);

  // Discovery (graine) : code-barres cherché par titre (l'album n'en avait pas), groupe de parutions et parution,
  // Spotify (relation MusicBrainz), Apple Music (Wikidata), Wikidata, enregistrements et ISRC de chaque morceau.
  const mbDisc = extRows('album', 'discovery', 'musicbrainz');
  assert.deepEqual(mbDisc.map((r) => r.source_id).sort(), [uuid(101), uuid(201)].sort());
  assert.ok(mbDisc.some((r) => r.url === `https://musicbrainz.org/release-group/${uuid(201)}`));
  assert.ok(mbDisc.every((r) => r.matched_by === 'title'));
  assert.deepEqual(extRows('album', 'discovery', 'upc').map((r) => r.source_id), ['724384960650']);
  assert.deepEqual(extRows('album', 'discovery', 'spotify').map((r) => r.source_id), ['2noRn2Aes5aoNVsU6iWThc']);
  assert.deepEqual(extRows('album', 'discovery', 'apple').map((r) => [r.source_id, r.matched_by]), [['697194953', 'wikidata']]);
  assert.deepEqual(extRows('album', 'discovery', 'wikidata').map((r) => r.source_id), ['Q1129999']);
  const tracks = db.prepare("SELECT id FROM cat_tracks WHERE album_id = 'discovery' ORDER BY n").all().map((r) => r.id);
  for (const id of tracks) {
    assert.equal(extRows('track', id, 'musicbrainz').length, 1, id);
    assert.equal(extRows('track', id, 'isrc').length, 1, id);
  }
  // Daft Punk : identifiant par le crédit de l'album, Spotify, Apple, Wikidata ; son pays de la graine reste (FR,
  // « seed ») même si MusicBrainz dit autre chose dans ce faux monde.
  assert.deepEqual(extRows('artist', 'daft-punk', 'musicbrainz').map((r) => [r.source_id, r.matched_by]), [[uuid(1), 'album']]);
  assert.deepEqual(extRows('artist', 'daft-punk', 'spotify').map((r) => r.source_id), ['4tZwfgrHOc3mvqYlEYSvVi']);
  assert.deepEqual(extRows('artist', 'daft-punk', 'apple').map((r) => r.source_id), ['5468295']);
  assert.deepEqual(countryOf('daft-punk'), { country: 'FR', country_source: 'seed' });

  // Alpha : trouvé par son code-barres (confiance 1), pays MusicBrainz.
  assert.deepEqual(extRows('album', 'al-alpha', 'musicbrainz').map((r) => [r.matched_by, r.confidence]), [['upc', 1], ['upc', 1]]);
  assert.deepEqual(countryOf('dzT1'), { country: 'GB', country_source: 'musicbrainz' });
  // Beta : titre de base (« (Deluxe Edition) » ignoré), Apple Music avec sa vitrine, pays par Wikidata (P27 → P297).
  assert.equal(extRows('album', 'al-beta', 'musicbrainz').length, 2);
  assert.deepEqual(extRows('album', 'al-beta', 'apple').map((r) => [r.source_id, r.url]), [['1500000001', 'https://music.apple.com/gb/album/beta-songs/1500000001']]);
  assert.deepEqual(countryOf('dzT2'), { country: 'FR', country_source: 'wikidata' });
  assert.deepEqual(extRows('artist', 'dzT2', 'spotify').map((r) => r.source_id), ['0aBcDeFgHiJkLmNoPqRsTu']);
  // Gamma : deux artistes du même nom chez MusicBrainz, rien n'est relié ; album introuvable.
  assert.equal(extRows('artist', 'dzT3', 'musicbrainz').length, 0);
  assert.equal(extRows('album', 'al-gamma', 'musicbrainz').length, 0);
  assert.deepEqual(countryOf('dzT3'), { country: null, country_source: null });
  // Delta : promo reliée par son ISRC, artiste par son nom, pays de sa zone (ISO 3166-2 → SE).
  assert.deepEqual(extRows('track', 'promo:dzT4', 'musicbrainz').map((r) => [r.source_id, r.matched_by]), [[uuid(301), 'isrc']]);
  assert.deepEqual(extRows('artist', 'dzT4', 'musicbrainz').map((r) => r.matched_by), ['name']);
  assert.deepEqual(countryOf('dzT4'), { country: 'SE', country_source: 'musicbrainz' });
  // Epsilon : pays saisi à la main, jamais réécrit.
  assert.deepEqual(countryOf('dzT5'), { country: 'JP', country_source: 'manual' });

  // Politesse : chaque requête porte le User-Agent avec le contact ; écart minimal entre deux requêtes d'un même
  // service ; les deux 503 ont été attendus puis la fiche relue.
  assert.ok(world.log.length > 20);
  assert.ok(world.log.every((r) => r.ua === 'AlbumMania/0.1.0 ( contact-test@example.com )'));
  // (heure d'arrivée côté serveur : la latence varie de quelques ms ; l'écart exact est vérifié côté client plus bas)
  for (const kind of ['mb', 'wd']) {
    const times = world.log.filter((r) => r.kind === kind).map((r) => r.t);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 7, `${kind} : ${times[i] - times[i - 1]} ms entre deux requêtes`);
  }
  assert.equal(world.log.filter((r) => r.path === `/ws/2/artist/${uuid(11)}`).length, 3, 'deux 503 puis la réponse');
  // Rien d'autre que des identifiants et des faits : pas d'image, pas de paroles.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM external_ids WHERE url LIKE '%coverartarchive%' OR url LIKE '%.jpg'").get().n, 0);

  // Compteurs de l'espace admin.
  assert.equal(status.counts.spotify.album, 1);
  assert.equal(status.counts.apple.album, 2);
  assert.ok(status.counts.musicbrainz.album >= 3);
  assert.equal(status.counts.countriesBy.musicbrainz, 2);
  assert.equal(status.counts.countriesBy.wikidata, 1);
  assert.ok(db.prepare("SELECT 1 FROM admin_audit WHERE action = 'enrich.start'").get());
});

test('/catalog/listen : liens directs et lecteurs Spotify / Apple Music quand les identifiants existent, crédit CC0', async () => {
  const r = await call(player, 'GET', '/catalog/listen/album/discovery');
  assert.equal(r.status, 200);
  const links = Object.fromEntries(r.body.links.map((l) => [l.provider, l]));
  assert.deepEqual(Object.keys(links), ['deezer', 'spotify', 'apple', 'youtube']);
  assert.equal(links.spotify.url, 'https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc');
  assert.equal(links.spotify.direct, true);
  assert.equal(links.apple.url, 'https://music.apple.com/fr/album/697194953');
  assert.equal(links.youtube.direct, false);
  assert.deepEqual(r.body.embeds.map((e) => e.provider), ['spotify', 'apple']);
  assert.equal(r.body.embeds[1].src, 'https://embed.music.apple.com/fr/album/697194953');
  assert.deepEqual(r.body.sources.map((s) => s.source), ['musicbrainz', 'wikidata']);
  assert.equal(r.body.archived, false);
  // Morceau : identifiants du morceau seulement (pas de lecteur d'album sur la page d'un morceau).
  const track = await call(player, 'GET', `/catalog/listen/track/${encodeURIComponent('discovery:01')}`);
  assert.equal(track.status, 200);
  assert.deepEqual(track.body.embeds, []);
  assert.ok(track.body.sources.some((s) => s.source === 'musicbrainz'));
  // Un identifiant Spotify venu de l'import (jamais d'API Spotify) ne donne pas de lecteur : seulement une source CC0.
  db.prepare(`INSERT INTO external_ids (entity_type, entity_id, source, source_id, matched_by, fetched_at) VALUES ('album', 'al-gamma', 'spotify', '1AbCdEfGhIjKlMnOpQrStU', 'import', ?)`).run(NOW);
  assert.deepEqual(listenFor(db, 'album', 'al-gamma').embeds, []);
  // Inconnus.
  assert.equal((await call(player, 'GET', '/catalog/listen/album/nope')).body.error, 'unknown_album');
  assert.equal((await call(player, 'GET', '/catalog/listen/podcast/discovery')).status, 404);
  assert.equal((await call(null, 'GET', '/catalog/listen/album/discovery')).status, 401);
});

test('repasser : une passe finie ne relance rien avant un mois ; la tâche de nuit lance sans attendre', async () => {
  const before = world.log.length;
  assert.equal(deps.enrich.enricher.hasWork(), false);
  const kicked = await app.jobs.runJob('enrich');
  assert.deepEqual(kicked, { started: false, running: false });
  assert.equal(world.log.length, before);
  assert.ok(app.jobs.names().includes('enrich') && app.jobs.names().includes('album-similar'));
  // Un mois plus tard : nouvelle passe, seulement ce qui manque (Gamma, Epsilon…) ; rien de déjà trouvé n'est relu.
  db.prepare("UPDATE kv SET value = json_set(value, '$.passFinishedAt', ?) WHERE key = 'enrich'").run(Date.now() - 31 * 86_400_000);
  const run = await app.jobs.runJob('enrich');
  assert.equal(run.started, true, 'la tâche lance la passe');
  await deps.enrich.enricher.current;
  const during = world.log.slice(before);
  assert.ok(during.length > 0);
  assert.ok(!during.some((r) => r.path === `/ws/2/release/${uuid(101)}`), 'Discovery n’est pas relu');
  assert.ok(during.some((r) => r.query === 'release:"Gamma Unknown" AND artist:"Gamma"'), 'Gamma est retenté');
  assert.equal(deps.enrich.status().pass, 2);
});

/** Moteur seul sur sa propre base (graine + artistes du test), pour la pause, la reprise et les pannes. */
function engine(opts = {}) {
  const base = openDb(':memory:');
  addCatalog(base);
  createCatalog(base);
  return { base, make: (o = {}) => createEnricher({ db: base }, { ...enrichConfig(), retryMs: 60_000, log: { warn() {}, error() {} }, ...opts, ...o }) };
}
const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 5));
  }
};

test('pause : elle arrête la passe, tient après un redémarrage ; « Lancer » reprend sans refaire ce qui est trouvé', async () => {
  const { base, make } = engine();
  const local = makeWorld();
  local.db = base;
  const server = await startFake(local);
  const cfg = { mbUrl: `${server.base}/ws/2`, wdUrl: `${server.base}/w/api.php` };
  try {
    const first = make(cfg);
    first.start();
    await waitFor(() => local.log.some((r) => r.path === `/ws/2/release/${uuid(102)}`)); // Alpha relié
    first.pause();
    await first.current;
    assert.equal(first.state().phase, 'paused');
    assert.equal(first.state().paused, true);
    const stopped = local.log.length;
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(local.log.length, stopped, 'plus aucune requête après la pause');
    assert.ok(base.prepare("SELECT 1 FROM external_ids WHERE entity_id = 'al-alpha' AND source = 'musicbrainz'").get());

    // Redémarrage : la pause tient (ni la tâche de nuit ni la reprise automatique ne relancent).
    const second = make(cfg);
    assert.equal(second.start(), null);
    assert.equal(second.hasWork(), false);
    assert.deepEqual(second.kick(), { started: false, running: false });
    assert.equal(second.resumeAfterRestart(1), false, 'pas une passe interrompue : une pause');
    // « Lancer » : la passe reprend au curseur ; Alpha n'est pas relu.
    second.start({ force: true });
    await second.current;
    assert.equal(second.state().phase, 'done');
    assert.equal(local.log.filter((r) => r.path === `/ws/2/release/${uuid(102)}`).length, 1, 'Alpha lu une seule fois');
    assert.ok(base.prepare("SELECT 1 FROM external_ids WHERE entity_id = 'discovery' AND source = 'spotify'").get());

    // Arrêt brutal en pleine passe (phase « running » restée en base) : reprise automatique peu après le démarrage.
    base.prepare("UPDATE kv SET value = json_set(value, '$.phase', 'running', '$.cursor', 0, '$.passFinishedAt', NULL) WHERE key = 'enrich'").run();
    const third = make(cfg);
    assert.equal(third.state().phase, 'idle', 'phase remise à plat au démarrage');
    assert.equal(third.resumeAfterRestart(1), true);
    await waitFor(() => third.running);
    await third.current;
    assert.equal(third.state().phase, 'done');
  } finally {
    await server.close();
    base.close();
  }
});

test('écart minimal mesuré côté client : jamais deux requêtes MusicBrainz plus proches que l’intervalle', async () => {
  const { base, make } = engine();
  const local = makeWorld();
  local.db = base;
  const server = await startFake(local);
  const sent = [];
  try {
    const e = make({
      mbUrl: `${server.base}/ws/2`, wdUrl: `${server.base}/w/api.php`, mbIntervalMs: 25, wdIntervalMs: 25,
      fetchImpl: (url, init) => {
        sent.push({ t: Date.now(), kind: url.includes('/w/api.php') ? 'wd' : 'mb', ua: init.headers['User-Agent'] });
        return fetch(url, init);
      },
    });
    e.start();
    await e.current;
    assert.equal(e.state().phase, 'done');
    for (const kind of ['mb', 'wd']) {
      const times = sent.filter((r) => r.kind === kind).map((r) => r.t);
      assert.ok(times.length > 2, kind);
      // (2 ms de marge : l'heure est relevée à l'appel de fetch, un peu après le départ mesuré par le moteur)
      for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 23, `${kind} : ${times[i] - times[i - 1]} ms`);
    }
    assert.ok(sent.every((r) => /^AlbumMania\/\S+ \( .+ \)$/.test(r.ua)));
  } finally {
    await server.close();
    base.close();
  }
});

test('pannes : 429 en série → arrêt, erreur visible, nouvelle tentative programmée ; sans contact, rien ne part', async () => {
  const { base, make } = engine();
  const local = makeWorld();
  local.db = base;
  local.always429 = true;
  const server = await startFake(local);
  try {
    const e = make({ mbUrl: `${server.base}/ws/2`, wdUrl: `${server.base}/w/api.php` });
    e.start();
    await e.current;
    const s = e.state();
    assert.equal(s.phase, 'error');
    assert.match(s.lastError, /HTTP 429/);
    assert.ok(e.retryAt > Date.now(), 'nouvelle tentative programmée');
    assert.equal(local.log.length, 6, 'une requête et cinq nouvelles tentatives, pas plus');
    assert.equal(s.cursor, 0, 'le curseur n’avance pas sur une panne');
    e.pause(); // annule la tentative programmée
    assert.equal(e.retryAt, null);

    const silent = make({ mbUrl: `${server.base}/ws/2`, blocked: 'contact_missing' });
    local.log.length = 0;
    assert.equal(silent.start({ force: true }), null);
    assert.deepEqual(silent.kick(), { started: false, running: false });
    assert.equal(local.log.length, 0);
  } finally {
    await server.close();
    base.close();
  }
});

test('albums proches : co-notes d’abord, puis l’artiste, puis genre et décennie ; seulement les albums notés depuis', async () => {
  const fans = [];
  for (let i = 0; i < 4; i++) fans.push(await signupVerified(app, { username: `fan_sim_${i}` }));
  for (const f of fans) {
    for (const [id, score] of [['discovery', 9], ['moon-safari', 8], ['random-access-memories', 10]]) {
      assert.equal((await call(f, 'PUT', `/ratings/album/${id}`, { score })).status, 200);
    }
  }
  const first = await call(owner, 'POST', '/admin/enrich/similar');
  assert.equal(first.status, 200);
  assert.ok(first.body.result.albums >= 3);
  const rows = db.prepare("SELECT similar_id, reason, score FROM album_similar WHERE album_id = 'discovery' ORDER BY score DESC").all();
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].reason, 'corated');
  assert.ok(['moon-safari', 'random-access-memories'].includes(rows[0].similar_id));
  const reasons = rows.map((r) => r.reason);
  const firstOther = reasons.findIndex((r) => r !== 'corated');
  assert.ok(firstOther === -1 || !reasons.slice(firstOther).includes('corated'), 'co-notes avant le reste');
  // Un album noté sans co-amateurs : l'artiste puis le genre et la décennie.
  const solo = fans[0];
  assert.equal((await call(solo, 'PUT', '/ratings/album/graduation', { score: 9 })).status, 200);
  await call(owner, 'POST', '/admin/enrich/similar');
  const grad = db.prepare("SELECT similar_id, reason FROM album_similar WHERE album_id = 'graduation' ORDER BY score DESC").all();
  assert.equal(grad[0]?.similar_id, 'the-college-dropout');
  assert.equal(grad[0]?.reason, 'artist');
  assert.ok(rows.every((r) => r.similar_id !== 'discovery'));
  // Page album : album_similar sert d'abord.
  const sim = await call(player, 'GET', '/albums/discovery/similar');
  assert.equal(sim.status, 200);
  assert.equal(sim.body.items[0].reason, 'corated');
  // Rien de nouveau : aucun album recalculé.
  const again = await app.jobs.runJob('album-similar');
  assert.equal(again.albums, 0);
  assert.ok(db.prepare("SELECT 1 FROM admin_audit WHERE action = 'enrich.similar'").get());
});
