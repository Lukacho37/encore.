import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { openDb } = await import('../db.js');
const { createCatalog } = await import('../catalog.js');
const { createImporter, baseTitle, splitFeat, RANK_TIERS } = await import('../importer.js');
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

function setup(cfg = CFG, fake = makeFakeDeezer()) {
  const db = openDb(':memory:');
  const catalog = createCatalog(db, { covers: () => cfg.covers !== 'off' });
  const importer = createImporter(db, catalog, { cfg, fetchImpl: fake.fetchImpl, pauseMs: 0, log: quiet });
  return { db, catalog, importer, fake };
}

test('titres : rééditions reconnues, featuring extrait', () => {
  assert.equal(baseTitle('Random Access Memories (10th Anniversary Edition)'), baseTitle('Random Access Memories'));
  assert.equal(baseTitle('Abbey Road [Remastered]'), 'abbey road');
  assert.equal(baseTitle('Nevermind - Deluxe'), 'nevermind');
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

  // Le catalogue sert les albums importés : recherche, pochette Deezer, carte autoportante.
  const found = catalog.searchAlbums({ q: 'artist 1000 album' });
  assert.ok(found.total >= 1);
  const album = found.items[0];
  assert.match(album.art.cover, /^https:\/\/cdn\.deezer\.test\//);
  assert.equal(album.art.provider, 'deezer');
  const tr = catalog.albumTracks(album.id)[0];
  assert.equal(tr.album, album.title);
  assert.equal(tr.artist, 'Artist 1000');
  assert.match(tr.code, /^AM-\d{3,}$/);
  assert.match(tr.url, /^https:\/\/www\.deezer\.test\/track\//);
  assert.ok(catalog.totals().albums === 20 + CFG.catalogTarget);
  db.close();
});

test('reprise : un second import continue sans doublon ; quota géré', async () => {
  const fake = makeFakeDeezer();
  const { db, catalog } = setup({ ...CFG, catalogTarget: 30 }, fake);
  const first = createImporter(db, catalog, { cfg: { ...CFG, catalogTarget: 30 }, fetchImpl: fake.fetchImpl, pauseMs: 0, log: quiet });
  await first.start();
  assert.equal(first.status().albums, 30);
  const second = createImporter(db, catalog, { cfg: { ...CFG, catalogTarget: 60 }, fetchImpl: fake.fetchImpl, pauseMs: 0, log: quiet });
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

test('CATALOG_IMPORT=off : rien ne part', () => {
  const fake = makeFakeDeezer();
  const { importer, db } = setup({ ...CFG, catalogImport: 'off' }, fake);
  assert.equal(importer.start(), null);
  assert.equal(fake.calls.length, 0);
  db.close();
});
