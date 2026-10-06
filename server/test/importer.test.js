import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { openDb } = await import('../db.js');
const { createCatalog } = await import('../catalog.js');
const { createImporter, baseTitle, splitFeat, RANK_TIERS } = await import('../importer.js');
const { catalogImportMode } = await import('../config.js');
const { makeFakeDeezer } = await import('./fakeDeezer.js');

const CFG = {
  catalogImport: 'deezer',
  catalogTarget: 120,
  catalogMinArtistFans: 15000,
  catalogMinAlbumFans: 100,
  catalogMaxAlbumsPerArtist: 10,
  deezerApiUrl: 'https://deezer.test',
  covers: 'auto',
};
const quiet = { warn() {}, log() {} };
const DAY = 86_400_000;

/** fetchImpl : pour intercaler des pannes ; wrapCatalog : pour espionner les appels de l'import au catalogue. */
function setup(cfg = CFG, fake = makeFakeDeezer(), { fetchImpl = fake.fetchImpl, wrapCatalog = (c) => c } = {}) {
  const db = openDb(':memory:');
  const catalog = createCatalog(db, { covers: () => cfg.covers !== 'off' });
  const make = (c = cfg) => createImporter(db, wrapCatalog(catalog), { cfg: c, fetchImpl, pauseMs: 0, backoffMs: 1, log: quiet });
  return { db, catalog, importer: make(), make, fake };
}

const httpError = (status) => ({ ok: false, status, json: async () => null });
const pathOf = (url) => new URL(url).pathname;
const albumsOf = (db, artistId) => db.prepare('SELECT title, deezer_id, track_count FROM cat_albums WHERE artist_id = ? ORDER BY title').all(artistId);
const statusOf = (db, deezerId) => db.prepare('SELECT status, retries FROM import_artists WHERE deezer_id = ?').get(String(deezerId));
const until = async (fn) => {
  while (!fn()) await new Promise((r) => setTimeout(r, 2));
};

test('titres : rééditions reconnues, featuring extrait, toutes les écritures', () => {
  assert.equal(baseTitle('Random Access Memories (10th Anniversary Edition)'), baseTitle('Random Access Memories'));
  assert.equal(baseTitle('Abbey Road [Remastered]'), 'abbey road');
  assert.equal(baseTitle('Nevermind - Deluxe'), 'nevermind');
  assert.equal(baseTitle('Café Bleu'), 'cafe bleu');
  // Un titre non latin garde ses lettres (il ne devient pas vide), et ses rééditions se reconnaissent toujours.
  assert.equal(baseTitle('Группа крови'), 'группа крови');
  assert.equal(baseTitle('Группа крови (Deluxe Edition)'), baseTitle('Группа крови'));
  assert.equal(baseTitle('初恋 [Remastered]'), '初恋');
  assert.ok(baseTitle('تملي معاك'));
  assert.notEqual(baseTitle('初恋'), baseTitle('道'));
  assert.deepEqual(splitFeat('Stronger (feat. Daft Punk)', 'Stronger'), { title: 'Stronger', feat: 'Daft Punk' });
  assert.deepEqual(splitFeat('Solo'), { title: 'Solo', feat: null });
});

test('import : albums studio seulement, rééditions dédoublonnées, graine respectée, promos hors album, cible atteinte', async () => {
  const { db, catalog, importer } = setup();
  await importer.start();
  const st = importer.status();
  assert.equal(st.phase, 'done', JSON.stringify(st));
  assert.equal(st.albums, CFG.catalogTarget, 'la cible est atteinte exactement');

  const titles = db.prepare("SELECT title FROM cat_albums WHERE source = 'deezer'").all().map((r) => r.title);
  assert.ok(!titles.some((t) => /live|greatest hits/i.test(t)), 'ni live ni compilation');
  // Une seule édition de l'album 1 de chaque artiste (la deluxe, plus écoutée).
  const firsts = titles.filter((t) => /Album 1( \(|$)/.test(t));
  const byArtist = new Map();
  for (const t of firsts) byArtist.set(t.replace(/ Album 1.*/, ''), (byArtist.get(t.replace(/ Album 1.*/, '')) || 0) + 1);
  assert.ok([...byArtist.values()].every((n) => n === 1), 'pas de doublon deluxe');

  // Daft Punk est l'artiste de la graine : son Discovery n'est pas réimporté, ses autres albums sont rattachés à lui.
  const dp = db.prepare("SELECT title, artist_id FROM cat_albums WHERE artist_id = 'daft-punk' ORDER BY title").all();
  assert.equal(dp.filter((a) => a.title === 'Discovery').length, 1, 'Discovery reste celui de la graine');
  assert.ok(dp.some((a) => a.title.startsWith('Daft Punk Album')), 'autres albums rattachés à daft-punk');
  assert.equal(db.prepare("SELECT deezer_id FROM cat_artists WHERE id = 'daft-punk'").get().deezer_id, '27');

  // Promos : le single hors album est importé, celui qui reprend un titre d'album ne l'est pas.
  const promos = db.prepare("SELECT title FROM cat_tracks WHERE kind = 'promo' AND source = 'deezer'").all().map((r) => r.title);
  assert.ok(promos.length > 0);
  assert.ok(promos.every((t) => /Exclusive Single/.test(t)), JSON.stringify(promos.slice(0, 5)));

  // Featuring extrait du titre.
  const feat = db.prepare("SELECT title, feat FROM cat_tracks WHERE feat IS NOT NULL AND source = 'deezer' LIMIT 1").get();
  assert.equal(feat.feat, 'Guest Star');
  assert.ok(!/feat/i.test(feat.title));

  // Calibrage : chaque palier est dans sa plage de popularité, les promos gardent leur rareté.
  for (const tier of RANK_TIERS) {
    const row = db.prepare("SELECT MIN(pop) AS lo, MAX(pop) AS hi, COUNT(*) AS n FROM cat_tracks WHERE source = 'deezer' AND rarity = ?").get(tier.rarity);
    if (row.n) assert.ok(row.lo >= tier.pop[0] && row.hi <= tier.pop[1], `${tier.rarity} ${row.lo}-${row.hi}`);
  }
  const n = db.prepare("SELECT COUNT(*) AS n FROM cat_tracks WHERE source = 'deezer' AND kind = 'album'").get().n;
  const common = db.prepare("SELECT COUNT(*) AS n FROM cat_tracks WHERE source = 'deezer' AND rarity = 'common'").get().n;
  assert.ok(common / n > 0.5 && common / n < 0.7, `communes : ${common}/${n}`);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cat_tracks WHERE kind = 'promo' AND rarity != 'promo'").get().n, 0);

  // Numéros de catalogue : les albums importés prennent la plage d'après la graine (AM-1001…), un album de base
  // ajouté plus tard garde le sien.
  assert.ok(db.prepare("SELECT MIN(catalog) AS n FROM cat_albums WHERE source = 'deezer'").get().n >= 1001);

  // Le catalogue sert les albums importés : recherche, pochette Deezer, carte autoportante.
  const found = catalog.searchAlbums({ q: 'artist 1000 album' });
  assert.ok(found.total >= 1);
  const album = found.items[0];
  assert.match(album.art.cover, /^https:\/\/cdn\.deezer\.test\//);
  assert.equal(album.art.provider, 'deezer');
  const tr = catalog.albumTracks(album.id)[0];
  assert.equal(tr.album, album.title);
  assert.equal(tr.artist, 'Artist 1000');
  assert.match(tr.code, /^AM-\d{4,}$/);
  assert.match(tr.url, /^https:\/\/www\.deezer\.test\/track\//);
  assert.ok(catalog.totals().albums === 20 + CFG.catalogTarget);
  db.close();
});

test('reprise : un second import continue sans doublon ; quota géré', async () => {
  const fake = makeFakeDeezer();
  const { db, make } = setup({ ...CFG, catalogTarget: 30 }, fake);
  const first = make({ ...CFG, catalogTarget: 30 });
  await first.start();
  assert.equal(first.status().albums, 30);
  const second = make({ ...CFG, catalogTarget: 60 });
  await second.start();
  assert.equal(second.status().albums, 60);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM (SELECT deezer_id FROM cat_albums WHERE deezer_id IS NOT NULL GROUP BY deezer_id HAVING COUNT(*) > 1)').get().n, 0);
  db.close();

  // Quota dépassé une requête sur 7 : les nouvelles tentatives suffisent, l'import aboutit.
  const quota = makeFakeDeezer({ quotaEvery: 7 });
  const q = setup({ ...CFG, catalogTarget: 15 }, quota);
  await q.importer.start();
  assert.equal(q.importer.status().albums, 15);
  q.db.close();
});

test('calibrage : une requête SQL, identique au calcul pas à pas ; rien à refaire quand rien ne change', async () => {
  let rebuilds = 0;
  const spy = (c) => ({ ...c, rebuildIndex: () => { rebuilds++; c.rebuildIndex(); } });
  const { db, importer, fake } = setup({ ...CFG, catalogTarget: 30 }, makeFakeDeezer({ artists: 20 }), { wrapCatalog: spy });
  await importer.start();
  assert.ok(rebuilds >= 1, 'les nouveaux morceaux entrent dans les tirages');

  // Des rangs égaux (même percentile) et des valeurs effacées : le calibrage doit tout retrouver.
  db.exec("UPDATE cat_tracks SET rank = 500000 WHERE source = 'deezer' AND rowid % 7 = 0");
  db.exec("UPDATE cat_tracks SET pop = 0, rarity = 'common' WHERE source = 'deezer'");
  assert.ok(importer.calibrate() > 0);
  const rows = db.prepare("SELECT id, rank, kind, pop, rarity FROM cat_tracks WHERE source = 'deezer' ORDER BY rank, id").all();
  const ranks = rows.map((r) => Number(r.rank) || 0);
  for (let i = 0; i < rows.length;) {
    let j = i;
    while (j + 1 < rows.length && ranks[j + 1] === ranks[i]) j++;
    const p = i / (rows.length - 1);
    const k = RANK_TIERS.findIndex((t) => p >= t.from);
    const tier = RANK_TIERS[k];
    const upper = k === 0 ? 1 : RANK_TIERS[k - 1].from;
    const pop = Math.round(tier.pop[0] + ((p - tier.from) / (upper - tier.from)) * (tier.pop[1] - tier.pop[0]));
    for (let m = i; m <= j; m++) {
      assert.equal(rows[m].pop, pop, rows[m].id);
      assert.equal(rows[m].rarity, rows[m].kind === 'promo' ? 'promo' : tier.rarity, rows[m].id);
    }
    i = j + 1;
  }
  // Seconde passe : aucune ligne ne change.
  assert.equal(importer.calibrate(), 0);

  // Cible atteinte, rien de nouveau : rien à lancer au démarrage, et « Lancer » ne refait ni requête ni calibrage.
  const calls = fake.calls.length;
  const before = rebuilds;
  assert.equal(importer.hasWork(), false);
  await importer.start({ force: true });
  assert.equal(fake.calls.length, calls);
  assert.equal(rebuilds, before);
  assert.equal(importer.status().phase, 'done');
  db.close();
});

test('panne de Deezer (403, 5xx, réseau) : l’import s’arrête sans toucher à la file, puis reprend', async () => {
  // Le serveur est bloqué (HTTP 403) après 60 requêtes.
  const fake = makeFakeDeezer({ artists: 120 });
  let blocked = true;
  let n = 0;
  const a = setup({ ...CFG, catalogTarget: 200 }, fake, { fetchImpl: async (url) => (blocked && ++n > 60 ? httpError(403) : fake.fetchImpl(url)) });
  await a.importer.start();
  let st = a.importer.status();
  assert.equal(st.phase, 'error');
  assert.match(st.lastError, /HTTP 403/);
  assert.equal(st.artists.error, 0, 'aucun artiste sacrifié');
  assert.ok(st.artists.pending > 50, JSON.stringify(st.artists));
  assert.ok(st.retryAt > Date.now(), 'nouvelle tentative programmée');
  assert.ok(st.requests < 70, 'pas d’acharnement');
  blocked = false;
  await a.importer.start();
  st = a.importer.status();
  assert.equal(st.phase, 'done');
  assert.equal(st.albums, 200);
  assert.equal(st.retryAt, null);
  a.db.close();

  // Panne passagère (503) sur la discographie de Daft Punk : il reste en attente, puis il est importé.
  for (const failure of [() => httpError(503), () => { throw new TypeError('fetch failed'); }]) {
    const f = makeFakeDeezer({ artists: 6 });
    let down = true;
    const b = setup({ ...CFG, catalogTarget: 40 }, f, { fetchImpl: async (url) => (down && pathOf(url) === '/artist/27/albums' ? failure() : f.fetchImpl(url)) });
    await b.importer.start();
    assert.equal(b.importer.status().phase, 'error');
    assert.equal(statusOf(b.db, 27).status, 'pending');
    assert.equal(b.importer.status().artists.error, 0);
    down = false;
    await b.importer.start();
    assert.equal(statusOf(b.db, 27).status, 'done');
    assert.ok(albumsOf(b.db, 'daft-punk').some((x) => x.deezer_id), 'albums de Daft Punk importés après la panne');
    b.importer.pause();
    b.db.close();
  }
});

test('ressource absente ou refusée : l’album est passé ; des refus en série arrêtent tout sans rien marquer', async () => {
  // Un album en 404 : passé, les autres albums de l'artiste sont importés et l'artiste est traité.
  const f = makeFakeDeezer({ artists: 6 });
  const a = setup({ ...CFG, catalogTarget: 100 }, f, { fetchImpl: async (url) => (pathOf(url) === '/album/2702' ? httpError(404) : f.fetchImpl(url)) });
  await a.importer.start();
  assert.equal(statusOf(a.db, 27).status, 'done');
  const dp = albumsOf(a.db, 'daft-punk').map((x) => x.title);
  assert.ok(!dp.includes('Daft Punk Album 3') && dp.includes('Daft Punk Album 2') && dp.includes('Daft Punk Album 4'), JSON.stringify(dp));
  a.db.close();

  // Tout est refusé après la découverte (API changée, blocage) : arrêt, et aucun artiste marqué traité, écarté ou en erreur.
  const g = makeFakeDeezer({ artists: 30 });
  const b = setup({ ...CFG, catalogTarget: 100 }, g, { fetchImpl: async (url) => (/^\/(chart|genre)\//.test(pathOf(url)) ? g.fetchImpl(url) : httpError(404)) });
  await b.importer.start();
  const st = b.importer.status();
  assert.equal(st.phase, 'error', JSON.stringify(st));
  assert.deepEqual({ done: st.artists.done, skipped: st.artists.skipped, error: st.artists.error }, { done: 0, skipped: 0, error: 0 });
  assert.equal(b.db.prepare('SELECT MAX(retries) AS n FROM import_artists').get().n, 0);
  b.importer.pause();
  b.db.close();
});

test('artistes en erreur : retentés à la tournée suivante, au plus 3 fois', async () => {
  const f = makeFakeDeezer({ artists: 8 });
  let broken = true;
  const { db, importer } = setup({ ...CFG, catalogTarget: 1000 }, f, { fetchImpl: async (url) => (broken && pathOf(url) === '/artist/1003/albums' ? httpError(404) : f.fetchImpl(url)) });
  await importer.start();
  assert.deepEqual({ ...statusOf(db, 1003) }, { status: 'error', retries: 1 });
  assert.equal(importer.status().phase, 'done', 'les autres artistes ont été traités');
  await importer.start();
  assert.deepEqual({ ...statusOf(db, 1003) }, { status: 'error', retries: 2 });
  // Réparé : il est importé à la tournée suivante.
  broken = false;
  assert.equal(importer.hasWork(), true);
  await importer.start();
  assert.equal(statusOf(db, 1003).status, 'done');
  assert.ok(albumsOf(db, 'dz1003').length > 0);

  // Au-delà de 3 essais, il reste de côté.
  db.prepare("UPDATE import_artists SET status = 'error', retries = 3 WHERE deezer_id = '1003'").run();
  await importer.start();
  assert.equal(statusOf(db, 1003).status, 'error');
  db.close();
});

test('pause : l’artiste en cours reste en attente ; la pause tient après un redémarrage ; « Lancer » la lève', async () => {
  const f = makeFakeDeezer({ artists: 6 });
  let imp;
  let albumCalls = 0;
  const fetchImpl = async (url) => {
    // L'admin met en pause pendant l'import des albums de Daft Punk.
    if (/^\/album\/27\d\d$/.test(pathOf(url)) && ++albumCalls === 2) imp.pause();
    return f.fetchImpl(url);
  };
  const { db, make } = setup({ ...CFG, catalogTarget: 40 }, f, { fetchImpl });
  imp = make();
  await imp.start();
  assert.equal(imp.status().phase, 'paused');
  assert.equal(statusOf(db, 27).status, 'pending', 'ses albums restants ne sont pas perdus');
  const partial = albumsOf(db, 'daft-punk').length;

  // Redémarrage : toujours en pause, rien ne part tout seul (démarrage, minuterie, nouvelle tentative).
  const again = make();
  assert.equal(again.status().phase, 'paused');
  assert.equal(again.status().paused, true);
  assert.equal(again.hasWork(), false);
  assert.equal(again.start(), null);

  await again.start({ force: true });
  assert.equal(again.status().paused, false);
  assert.equal(statusOf(db, 27).status, 'done');
  assert.ok(albumsOf(db, 'daft-punk').length > partial, 'les albums restants sont importés à la reprise');
  db.close();
});

test('« Lancer » pendant qu’une pause s’achève : l’import repart', async () => {
  const f = makeFakeDeezer({ artists: 6 });
  let imp;
  let albumCalls = 0;
  const fetchImpl = async (url) => {
    if (/^\/album\/27\d\d$/.test(pathOf(url)) && ++albumCalls === 2) {
      imp.pause();
      imp.start({ force: true });
    }
    return f.fetchImpl(url);
  };
  const { db, make } = setup({ ...CFG, catalogTarget: 40 }, f, { fetchImpl });
  imp = make();
  await imp.start();
  await until(() => !imp.status().running);
  assert.equal(imp.status().paused, false);
  assert.equal(imp.status().phase, 'done');
  assert.equal(statusOf(db, 27).status, 'done');
  db.close();
});

test('après une panne, la nouvelle tentative est programmée ; la pause l’annule', async () => {
  const f = makeFakeDeezer({ artists: 6 });
  const { importer, db } = setup({ ...CFG, catalogTarget: 40 }, f, { fetchImpl: async () => httpError(503) });
  await importer.start();
  assert.equal(importer.status().phase, 'error');
  assert.ok(importer.status().retryAt > Date.now());
  importer.pause();
  assert.equal(importer.status().retryAt, null);
  assert.equal(importer.status().phase, 'paused');
  assert.equal(importer.start(), null);
  db.close();
});

test('redémarrage en plein import : la phase « en cours » enregistrée ne reste pas affichée', () => {
  const { db, make } = setup();
  db.prepare("INSERT INTO kv (key, value) VALUES ('import', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(JSON.stringify({ phase: 'running', discovered: true, startedAt: Date.now() }));
  const imp = make();
  assert.equal(imp.status().running, false);
  assert.equal(imp.status().phase, 'idle');
  db.close();
});

test('homonymes : un artiste de la graine n’est reconnu que si c’est bien lui', async () => {
  const world = () => {
    const f = makeFakeDeezer({ artists: 0 });
    // Air (graine : Moon Safari) et un rappeur homonyme, moins suivi.
    f.addCustomArtist({ id: 5000, name: 'Air', fans: 900_000, genreId: 113, albums: [{ title: 'Moon Safari (Remastered)', fans: 9000 }, { title: 'Talkie Walkie', fans: 8000 }] });
    f.addCustomArtist({ id: 6000, name: 'AIR', fans: 80_000, genreId: 116, albums: [{ title: 'Street Album', fans: 3000 }, { title: 'Night Drive', fans: 2000 }] });
    // Nirvana : sans « Nevermind » sur sa page Deezer, mais le plus suivi de ce nom ; l'autre Nirvana est un homonyme.
    f.addCustomArtist({ id: 7000, name: 'Nirvana', fans: 5_000_000, genreId: 152, albums: [{ title: 'In Utero', fans: 9000 }, { title: 'Bleach', fans: 8000 }] });
    f.addCustomArtist({ id: 7100, name: 'Nirvana', fans: 40_000, genreId: 152, albums: [{ title: 'The Story of Simon Simopath', fans: 2000 }] });
    return f;
  };
  const a = setup({ ...CFG, catalogTarget: 50 }, world());
  await a.importer.start();
  const artist = (id) => a.db.prepare('SELECT name, deezer_id FROM cat_artists WHERE id = ?').get(id);
  assert.equal(artist('air').deezer_id, '5000');
  assert.deepEqual(albumsOf(a.db, 'air').map((x) => x.title), ['Moon Safari', 'Talkie Walkie'], 'pas de doublon de Moon Safari');
  assert.deepEqual({ ...artist('dz6000') }, { name: 'AIR', deezer_id: '6000' });
  assert.deepEqual(albumsOf(a.db, 'dz6000').map((x) => x.title), ['Night Drive', 'Street Album']);
  assert.equal(artist('nirvana').deezer_id, '7000');
  assert.deepEqual(albumsOf(a.db, 'nirvana').map((x) => x.title), ['Bleach', 'In Utero', 'Nevermind']);
  assert.deepEqual(albumsOf(a.db, 'dz7100').map((x) => x.title), ['The Story of Simon Simopath']);
  a.db.close();

  // Base d'une version précédente : Air rattaché par le seul nom au rappeur, avec un de ses albums. Réparé à l'import.
  const b = setup({ ...CFG, catalogTarget: 50 }, world());
  b.db.prepare("UPDATE cat_artists SET deezer_id = '6000' WHERE id = 'air'").run();
  b.db.prepare(`INSERT INTO cat_albums (id, artist_id, title, year, genre, art, catalog, track_count, fans, source, deezer_id, created_at)
    VALUES ('dz6000000', 'air', 'Street Album', 2015, 'rap', NULL, 1001, 1, 3000, 'deezer', '6000000', 0)`).run();
  b.db.prepare(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, year, genre, pop, rarity, rank, source, deezer_id, created_at)
    VALUES ('dz6000000:01', 'album', 'dz6000000', 'air', 1, 1, 'Street Album 1', 2015, 'rap', 10, 'common', 1000, 'deezer', '600000000', 0)`).run();
  await b.importer.start();
  // L'homonyme (n° 1 de son classement) passe avant le vrai Air : il libère l'artiste de la graine, qui se rattache au bon.
  assert.equal(b.db.prepare("SELECT deezer_id FROM cat_artists WHERE id = 'air'").get().deezer_id, '5000');
  assert.ok(!albumsOf(b.db, 'air').some((x) => x.title === 'Street Album'), 'album de l’homonyme rendu');
  assert.ok(albumsOf(b.db, 'dz6000').some((x) => x.title === 'Street Album'));
  assert.equal(b.db.prepare("SELECT artist_id FROM cat_tracks WHERE id = 'dz6000000:01'").get().artist_id, 'dz6000');
  assert.equal(b.db.prepare("SELECT track_count FROM cat_artists WHERE id = 'dz6000'").get().track_count,
    b.db.prepare("SELECT COUNT(*) AS n FROM cat_tracks WHERE artist_id = 'dz6000'").get().n, 'compteurs refaits');
  b.db.close();
});

test('discographie paginée, pistes complètes : rien ne manque, rien de tronqué', async () => {
  const f = makeFakeDeezer({ artists: 0, embedLimit: 25 });
  // 260 singles avant les albums studio : il faut lire trois pages de sorties.
  const singles = Array.from({ length: 260 }, (_, i) => ({ title: `Single ${i + 1}`, record_type: 'single', fans: 50, tracks: 1 }));
  f.addCustomArtist({
    id: 8000, name: 'Prolific', fans: 2_000_000, genreId: 132, albums: [...singles,
      { title: 'Deep Cut', fans: 9000, tracks: 12 },
      { title: 'Thirty Songs', fans: 8000, tracks: 30 }, // liste intégrée tronquée à 25 : lue en entier
      { title: 'Box of Forty Five', fans: 7000, tracks: 45 }, // plus de 40 pistes en tout : écarté
    ],
  });
  const { db, importer } = setup({ ...CFG, catalogTarget: 10 }, f);
  await importer.start();
  const got = albumsOf(db, 'dz8000');
  assert.deepEqual(got.map((x) => [x.title, x.track_count]), [['Deep Cut', 12], ['Thirty Songs', 30]]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cat_tracks WHERE album_id = 'dz8000261'").get().n, 30);
  assert.ok(f.calls.includes('/album/8000261/tracks'));
  assert.ok(!f.calls.includes('/album/8000262/tracks'), 'un album de 45 pistes n’est pas lu pour rien');
  db.close();
});

test('titres non latins : importés, rééditions dédoublonnées, single hors album gardé', async () => {
  const f = makeFakeDeezer({ artists: 0 });
  const blood = ['Группа крови', 'Закрой за мной дверь', 'Война', 'Спокойная ночь', 'Мама, мы все тяжело больны'];
  f.addCustomArtist({
    id: 9000, name: 'Кино', fans: 700_000, genreId: 152, albums: [
      { title: 'Группа крови', fans: 9000, tracks: blood },
      { title: 'Группа крови (Deluxe Edition)', fans: 9500, tracks: [...blood, 'Бонус'] },
      { title: 'Звезда по имени Солнце', fans: 8000, tracks: ['Звезда по имени Солнце', 'Невесёлая песня', 'Пачка сигарет', 'Сказка'] },
      { title: 'Кукушка', record_type: 'single', fans: 6000, tracks: ['Кукушка'] },
    ],
  });
  f.addCustomArtist({ id: 9100, name: '宇多田ヒカル', fans: 900_000, genreId: 132, albums: [{ title: 'First Love', fans: 9000, tracks: 8 }, { title: '初恋', fans: 8500, tracks: ['初恋', '道', 'あなた', '誓い'] }] });
  const { db, importer } = setup({ ...CFG, catalogTarget: 20 }, f);
  await importer.start();
  assert.deepEqual(albumsOf(db, 'dz9000').map((x) => x.title), ['Группа крови (Deluxe Edition)', 'Звезда по имени Солнце']);
  assert.deepEqual(db.prepare("SELECT title FROM cat_tracks WHERE kind = 'promo' AND artist_id = 'dz9000'").all().map((r) => r.title), ['Кукушка']);
  assert.deepEqual(albumsOf(db, 'dz9100').map((x) => x.title), ['First Love', '初恋']);
  db.close();
});

test('vérification quotidienne : nouveaux albums des artistes déjà importés, même la cible atteinte', async () => {
  const f = makeFakeDeezer({ artists: 0 });
  const steady = [{ title: 'One', fans: 9000 }, { title: 'Two', fans: 8000 }];
  f.addCustomArtist({ id: 9500, name: 'Steady', fans: 3_000_000, genreId: 132, albums: steady });
  f.addCustomArtist({ id: 9600, name: 'Quiet', fans: 100_000, genreId: 116, albums: [{ title: 'Calm', fans: 3000 }] });
  const { db, make } = setup({ ...CFG, catalogTarget: 1000 }, f);
  const first = make();
  await first.start();
  const imported = first.status().albums;
  assert.deepEqual(albumsOf(db, 'dz9500').map((x) => x.title), ['One', 'Two']);

  // Une semaine plus tard : Steady sort un album (très écouté) et en annonce un autre ; la cible est atteinte.
  f.addCustomArtist({ id: 9500, name: 'Steady', fans: 3_000_000, genreId: 132, albums: [...steady, { title: 'Three', fans: 20000 }, { title: 'Four', fans: 30000, release_date: '2999-01-01' }] });
  db.prepare('UPDATE import_artists SET checked_at = ?').run(Date.now() - 8 * DAY);
  db.prepare("UPDATE kv SET value = json_set(value, '$.refreshedAt', ?) WHERE key = 'import'").run(Date.now() - 2 * DAY);
  const daily = make({ ...CFG, catalogTarget: imported });
  assert.equal(daily.hasWork(), true, 'la vérification est due');
  const calls = f.calls.length;
  await daily.start();
  assert.deepEqual(albumsOf(db, 'dz9500').map((x) => x.title), ['One', 'Three', 'Two'], 'nouvel album importé, pas l’album annoncé');
  assert.equal(daily.status().albums, imported + 1);
  assert.equal(daily.status().phase, 'done');
  const during = f.calls.slice(calls);
  assert.ok(!during.some((p) => /related|^\/chart/.test(p)), 'la vérification ne cherche pas de nouveaux artistes');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM import_artists WHERE status = 'done' AND checked_at < ?").get(Date.now() - DAY).n, 0);
  assert.equal(daily.hasWork(), false, 'rien d’autre avant demain');
  db.close();
});

test('COVERS=off : les albums importés gardent leurs visuels générés', async () => {
  const cfg = { ...CFG, catalogTarget: 5, covers: 'off' };
  const { db, catalog, importer } = setup(cfg);
  await importer.start();
  const album = catalog.searchAlbums({ q: 'artist' }).items.find((a) => a.source === 'deezer');
  assert.ok(album);
  assert.equal(album.art.cover, undefined);
  assert.ok(album.art.palette && album.art.motif);
  db.close();
});

test('CATALOG_IMPORT échoue fermé : seul « deezer » (ou rien) active l’import', () => {
  assert.equal(catalogImportMode(undefined), 'deezer');
  assert.equal(catalogImportMode('  '), 'deezer');
  assert.equal(catalogImportMode(undefined, true), 'off', 'pas d’import pendant les tests');
  assert.equal(catalogImportMode(' Deezer '), 'deezer');
  for (const v of ['off', 'OFF', 'non', 'false', '0', 'deezr', 'spotify']) assert.equal(catalogImportMode(v), 'off', v);

  const fake = makeFakeDeezer();
  const { importer, db } = setup({ ...CFG, catalogImport: 'off' }, fake);
  assert.equal(importer.start(), null);
  assert.equal(importer.hasWork(), false);
  assert.equal(fake.calls.length, 0);
  db.close();
});
