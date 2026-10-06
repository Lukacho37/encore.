// Le jeu sur un catalogue importé (faux Deezer) : boosters, booster d'album, recherche, succès, profils.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = Array.from({ length: 20 }, (_, i) => `boss${i + 1}@example.com`).join(',');
const { openDb } = await import('../db.js');
const { createCatalog } = await import('../catalog.js');
const { createImporter } = await import('../importer.js');
const { createServices } = await import('../services.js');
const { makeFakeDeezer } = await import('./fakeDeezer.js');
const { rollPack, rollAlbumPack, ECONOMY, RARITIES } = await import('../../shared/rules.js');
const { staticCatalog } = await import('../../shared/staticCatalog.js');
const { ARTISTS, ALBUMS, TRACKS } = await import('../../shared/catalog.js');

const CFG = {
  catalogImport: 'deezer',
  catalogTarget: 150,
  catalogMinArtistFans: 15000,
  catalogMinAlbumFans: 100,
  catalogMaxAlbumsPerArtist: 10,
  deezerApiUrl: 'https://deezer.test',
  covers: 'auto',
};

const db = openDb(':memory:');
const catalog = createCatalog(db, { covers: () => true });
const importer = createImporter(db, catalog, { cfg: CFG, fetchImpl: makeFakeDeezer({ artists: 80 }).fetchImpl, pauseMs: 0, log: { warn() {}, log() {} } });
await importer.start();
const services = createServices(db, catalog);

let n = 0;
function makeUser({ admin = false, royalties = 0, packs = 0 } = {}) {
  n += 1;
  const email = admin ? `boss${n}@example.com` : `p${n}@example.com`;
  const now = Date.now();
  const { lastInsertRowid } = db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, royalties, bonus_packs, packs_at, created_at)
    VALUES (?, ?, 'x', ?, ?, ?, ?, ?)`).run(email, admin ? `boss${n}` : `joueur${n}`, now, royalties, packs, now, now);
  return Number(lastInsertRowid);
}
const imported = () => db.prepare("SELECT id, track_count FROM cat_albums WHERE source = 'deezer' ORDER BY fans DESC").all();

test('le catalogue importé dépasse largement la graine', () => {
  const t = catalog.totals();
  assert.ok(t.imported >= 150, JSON.stringify(t));
  assert.equal(t.albums, t.imported + 20);
  assert.ok(t.tracks > 1500);
});

test('boosters : cartes valides tirées dans tout le catalogue, stats tenues à jour', () => {
  const uid = makeUser({ admin: true });
  const res = services.openPacks(uid, 30);
  assert.equal(res.cards.length, 150);
  assert.ok(res.cards.every((c) => catalog.track(c.trackId)?.rarity === c.rarity));
  assert.ok(res.cards.some((c) => c.trackId.startsWith('dz')), 'les cartes importées sortent des boosters');
  // Chaque carte de la réponse est décrite (titre, artiste, album, visuel) sans autre requête.
  const refs = new Map(res.catalog.tracks.map((t) => [t.id, t]));
  assert.ok(res.cards.every((c) => refs.get(c.trackId)?.title && refs.get(c.trackId).art));
  const st = services.state(uid);
  assert.equal(st.stats.total.owned, new Set(res.cards.map((c) => c.trackId)).size);
  assert.equal(st.stats.catalog.albums, catalog.totals().albums);
  assert.ok(Object.keys(st.stats.albums).length <= 150, 'seuls les albums commencés sont listés');
  for (const d of res.albumDeltas) assert.ok(d.after > d.before && d.after <= d.total);
});

test('boosters gratuits orientés vers les albums commencés', () => {
  const albumId = imported()[3].id;
  const ids = catalog.albumTrackIds(albumId);
  // Avec un tirage qui choisit toujours l'emplacement ciblé, toutes les cartes non promo viennent de l'album commencé.
  let i = 0;
  const rng = () => [0.01, 0.001, 0.5][i++ % 3];
  const cards = rollPack(rng, catalog, { focusAlbumIds: [albumId] });
  const fromAlbum = cards.filter((c) => ids.includes(c.trackId));
  assert.ok(fromAlbum.length >= 3, JSON.stringify(cards));
  // Sans album commencé, rien de spécial.
  assert.equal(rollPack(Math.random, staticCatalog).length, 5);
});

test('booster d’album : 5 cartes de l’album, payées en royalties, manquantes d’abord', () => {
  const album = imported()[0];
  const uid = makeUser({ royalties: ECONOMY.albumPackPrice * 2 + 10 });
  const res = services.openAlbumPack(uid, album.id);
  assert.equal(res.spent, ECONOMY.albumPackPrice);
  assert.equal(res.cards.length, 5);
  const ids = new Set(catalog.albumTrackIds(album.id));
  assert.ok(res.cards.every((c) => ids.has(c.trackId)));
  if (ids.size >= 5) assert.equal(new Set(res.cards.map((c) => c.trackId)).size, 5, 'cartes différentes');
  services.openAlbumPack(uid, album.id);
  assert.throws(() => services.openAlbumPack(uid, album.id), { code: 'not_enough_royalties' });
  assert.throws(() => services.openAlbumPack(uid, ['x']), { code: 'unknown_album' });
  assert.throws(() => services.openAlbumPack(uid, 'nope'), { code: 'unknown_album' });
});

test('identifiants piégés : tableaux, objets et chaînes trop longues refusés proprement', () => {
  const uid = makeUser({ royalties: 10_000 });
  assert.throws(() => services.pressCard(uid, ['dz1:01']), { code: 'unknown_track' });
  assert.throws(() => services.pressCard(uid, { id: 1 }), { code: 'unknown_track' });
  assert.throws(() => services.pressCard(uid, 'x'.repeat(500)), { code: 'unknown_track' });
  assert.deepEqual(services.setShowcase(uid, [['a'], 'dz0:01', null]).filter(Boolean), []);
  assert.throws(() => services.albumDetail(['a']), { code: 'unknown_album' });
  assert.throws(() => services.groups(uid, 'artist'), { code: 'invalid_group' });
  assert.equal(services.tracksByIds('a,b,' + 'x'.repeat(200)).tracks.length, 0);
});

test('compléter un album importé : succès, récompense, vinyle sur le profil', () => {
  const uid = makeUser({ admin: true });
  const album = imported()[1];
  const { missing } = services.adminAlmostAlbum(uid, album.id);
  const res = services.pressCard(uid, missing);
  const ach = res.achievements.find((a) => a.key === `album:${album.id}`);
  assert.ok(ach, JSON.stringify(res.achievements));
  assert.equal(ach.royalties, album.track_count * ECONOMY.albumRewardPerTrack);
  assert.deepEqual(res.albumDeltas.find((d) => d.albumId === album.id), { albumId: album.id, before: album.track_count - 1, after: album.track_count, total: album.track_count });
  const profile = services.publicProfile(uid, services.getUser(uid).username);
  assert.ok(profile.vinyls.some((v) => v.albumId === album.id));
  assert.ok(profile.catalog.albums.some((a) => a.id === album.id && a.art.cover), 'le vinyle arrive avec sa pochette');
  assert.equal(profile.stats.albumsTotal, catalog.totals().albums);
  // Photo de profil débloquée par l'album complété.
  services.setAvatar(uid, `album:${album.id}`);
  assert.equal(services.state(uid).catalog.albums[0].id, album.id);
});

test('admin : compléter la graine seulement (jamais tout le catalogue), ou un album précis', () => {
  const uid = makeUser({ admin: true });
  services.adminCompleteCollection(uid);
  const seedTracks = db.prepare("SELECT COUNT(*) AS n FROM cat_tracks WHERE source = 'seed'").get().n;
  assert.equal(services.state(uid).stats.total.owned, seedTracks);
  assert.equal(services.state(uid).stats.albumsCompleted, 20);
  const album = imported()[2];
  services.adminCompleteCollection(uid, album.id);
  const st = services.state(uid);
  assert.equal(st.stats.total.owned, seedTracks + album.track_count);
  assert.ok(st.achievements.some((a) => a.key === `album:${album.id}`));
  assert.throws(() => services.adminCompleteCollection(uid, 'nope'), { code: 'unknown_album' });
});

test('navigation : recherche plein texte, filtres, tri, pagination, progression', () => {
  const uid = makeUser({ admin: true });
  const album = catalog.album(imported()[5].id);
  const found = services.browseAlbums(uid, { q: album.title.split(' ')[0].slice(0, 4) + ' ' + album.artist.split(' ')[0] });
  assert.ok(found.items.some((a) => a.id === album.id), JSON.stringify(found.items.map((a) => a.title)));
  const page1 = services.browseAlbums(uid, { limit: 20 });
  const page2 = services.browseAlbums(uid, { limit: 20, offset: 20 });
  assert.equal(page1.total, catalog.totals().albums);
  assert.equal(page1.items.length, 20);
  assert.ok(!page2.items.some((a) => page1.items.some((b) => b.id === a.id)), 'pages disjointes');
  const genre = catalog.genres()[0].id;
  assert.ok(services.browseAlbums(uid, { genre }).items.every((a) => a.genre === genre));
  services.adminCompleteCollection(uid, album.id);
  const mine = services.browseAlbums(uid, { mine: '1', sort: 'progress' });
  assert.equal(mine.items[0].id, album.id);
  assert.equal(mine.items[0].owned, album.trackCount);
  const detail = services.albumDetail(album.id);
  assert.equal(detail.tracks.length, album.trackCount);
  assert.ok(detail.tracks.every((t) => t.url?.startsWith('https://') && t.code));
  assert.ok(services.artistDetail(album.artistId).albums.some((a) => a.id === album.id));
  const cards = services.myCards(uid, { q: detail.tracks[0].title.slice(0, 5) });
  assert.ok(cards.items.some((t) => t.id === detail.tracks[0].id));
  const groups = services.groups(uid, 'genre').groups;
  assert.ok(groups.find((g) => g.key === album.genre).owned >= album.trackCount);
  assert.ok(services.browsePromos({}).total > 0);
});

test('blind test sur le catalogue importé', async () => {
  const uid = makeUser();
  const info = services.blindtestInfo(uid);
  assert.equal(info.genres[0].count, catalog.totals().tracks);
  const genre = info.genres.find((g) => g.id !== 'all' && g.count >= 40).id;
  const game = await services.startBlindtest(uid, genre);
  assert.equal(game.round.choices.length, 4);
  await assert.rejects(services.startBlindtest(uid, ['rock']), { code: 'invalid_genre' });
});

test('recyclage des doublons sur le catalogue importé', () => {
  const uid = makeUser({ admin: true });
  services.openPacks(uid, 50);
  const dupes = db.prepare('SELECT COALESCE(SUM(count - 1), 0) AS n FROM cards WHERE user_id = ?').get(uid).n;
  const res = services.recycleDuplicates(uid);
  assert.equal(res.recycled, dupes);
  assert.ok(res.royalties >= dupes * 5);
  assert.ok(RARITIES.every((r) => typeof services.state(uid).stats.byRarity[r].owned === 'number'));
});

test('droits d’auteur : chaque nouvelle carte rapporte des royalties, pas les doublons ni le pressage', () => {
  const uid = makeUser({ packs: 3, royalties: 0 });
  const res = services.openPacks(uid, 1);
  const expected = res.cards.filter((c) => c.newTrack).reduce((n, c) => n + ECONOMY.newCardRoyalties[c.rarity], 0);
  assert.equal(res.cardRoyalties, expected);
  assert.ok(res.cardRoyalties > 0);
  assert.equal(services.getUser(uid).royalties, res.royalties);
  const missing = catalog.albumTrackIds(imported()[7].id).find((id) => !services.state(uid).cards.some((c) => c.t === id));
  db.prepare('UPDATE users SET royalties = 10000 WHERE id = ?').run(uid);
  assert.equal(services.pressCard(uid, missing).cardRoyalties, 0);
});

// ---------- recherche, pagination, booster d'album, succès, numéros de catalogue ----------

/** Base neuve avec la seule graine (quelques millisecondes), pour les tests qui modifient le catalogue. */
function seedWorld(options = {}) {
  const wdb = openDb(':memory:');
  const wcatalog = createCatalog(wdb, { covers: () => true, ...options });
  return { wdb, wcatalog, wservices: createServices(wdb, wcatalog) };
}

/** Ajoute un album importé (artiste, 4 pistes, index de recherche), comme le ferait l'import. */
function addImportedAlbum(wdb, wcatalog, { id, artistId, artist, title, catalogNumber }) {
  const now = Date.now();
  wdb.prepare("INSERT OR IGNORE INTO cat_artists (id, name, source, created_at) VALUES (?, ?, 'deezer', ?)").run(artistId, artist, now);
  wdb.prepare(`INSERT INTO cat_albums (id, artist_id, title, year, genre, catalog, track_count, source, created_at)
    VALUES (?, ?, ?, 2020, 'pop', ?, 4, 'deezer', ?)`).run(id, artistId, title, catalogNumber ?? wcatalog.nextCatalogNumber(), now);
  for (let i = 1; i <= 4; i++) {
    wdb.prepare(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, year, genre, pop, rarity, source, created_at)
      VALUES (?, 'album', ?, ?, ?, 4, ?, 2020, 'pop', 50, 'common', 'deezer', ?)`).run(`${id}:0${i}`, id, artistId, i, `${title} ${i}`, now);
  }
  wcatalog.indexAlbum(id);
}

test('recherche d’albums dans toutes les écritures, avec ou sans accents', () => {
  const { wdb, wcatalog } = seedWorld();
  const albums = [
    ['t1', 'Røyksopp', 'Melody A.M.'], ['t2', 'Cœur de pirate', 'Blonde'], ['t3', 'Кино', 'Группа крови'],
    ['t4', '宇多田ヒカル', 'First Love'], ['t5', 'Beyoncé', 'Lemonade'], ['t6', 'Sigur Rós', 'Ágætis byrjun'],
  ];
  for (const [id, artist, title] of albums) addImportedAlbum(wdb, wcatalog, { id, artistId: `a-${id}`, artist, title });
  const ids = (q) => wcatalog.searchAlbums({ q }).items.map((a) => a.id);
  for (const [q, id] of [
    ['Røyksopp', 't1'], ['royksopp', 't1'], ['RØYK', 't1'], ['Cœur', 't2'], ['coeur de', 't2'], ['Кино', 't3'], ['кино', 't3'],
    ['группа', 't3'], ['宇多田', 't4'], ['beyonce', 't5'], ['BEYONCÉ', 't5'], ['lemon beyon', 't5'], ['sigur ros', 't6'], ['agaetis', 't6'],
  ]) assert.deepEqual(ids(q), [id], q);
  // Rien de cherchable : aucun résultat, jamais tout le catalogue.
  for (const q of ['!!!', '😀', '"', '« »', '*']) assert.deepEqual(wcatalog.searchAlbums({ q }), { total: 0, items: [] }, q);
  // Guillemets et opérateurs FTS dans un mot : pas d'erreur de syntaxe.
  for (const q of ['a"b', 'NEAR(x y)', 'title:blonde', 'pirate*', '^blonde', 'AND OR NOT']) assert.doesNotThrow(() => wcatalog.searchAlbums({ q }), q);
  assert.deepEqual(ids('"Blonde"'), ['t2']);
  // Recherche vide (ou faite d'espaces) : pas de filtre.
  assert.equal(wcatalog.searchAlbums({ q: '   ' }).total, wcatalog.totals().albums);
});

test('index de recherche d’une version précédente : mis à niveau une seule fois au démarrage', () => {
  const { wdb, wcatalog } = seedWorld();
  addImportedAlbum(wdb, wcatalog, { id: 'old1', artistId: 'a-old1', artist: 'Cœur de pirate', title: 'Roses' });
  // Ligne indexée comme avant (sans forme repliée) et marqueur de mise à niveau absent.
  wdb.prepare("UPDATE cat_search SET artist = 'Cœur de pirate' WHERE album_id = 'old1'").run();
  wdb.prepare("DELETE FROM kv WHERE key = 'searchFold'").run();
  assert.equal(wcatalog.searchAlbums({ q: 'coeur' }).total, 0);
  const again = createCatalog(wdb, { covers: () => true });
  assert.deepEqual(again.searchAlbums({ q: 'coeur' }).items.map((a) => a.id), ['old1']);
  assert.ok(wdb.prepare("SELECT 1 FROM kv WHERE key = 'searchFold'").get());
});

test('mes cartes : recherche sans accents ni casse', () => {
  const uid = makeUser();
  const ins = db.prepare("INSERT OR IGNORE INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, 'std', 1, 0)");
  for (const id of catalog.albumTrackIds('racine-carree')) ins.run(uid, id);
  const fete = catalog.albumTracks('racine-carree').find((t) => t.title === 'Ta fête');
  assert.ok(fete, 'la graine contient « Ta fête »');
  for (const q of ['fete', 'FÊTE', 'ta Fete', 'stromae fête']) {
    assert.deepEqual(services.myCards(uid, { q }).items.map((t) => t.id), [fete.id], q);
  }
  const all = catalog.albumTrackIds('racine-carree').length;
  assert.equal(services.myCards(uid, { q: 'carree' }).total, all, 'titre de l’album, sans accent');
  assert.equal(services.myCards(uid, { q: 'RACINE CARRÉE' }).total, all);
  // Caractères spéciaux de LIKE : cherchés tels quels.
  assert.equal(services.myCards(uid, { q: '%' }).total, 0);
  assert.equal(services.myCards(uid, { q: '_' }).total, 0);
});

test('pagination : offset et limit non entiers arrondis au lieu d’une erreur SQLite', () => {
  const uid = makeUser();
  db.prepare("INSERT OR IGNORE INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, 'discovery:01', 'std', 1, 0), (?, 'discovery:02', 'std', 1, 0)").run(uid, uid);
  const promos = services.browsePromos({ offset: '1.5', limit: '2.5' });
  assert.deepEqual(promos.items.map((t) => t.id), services.browsePromos({ offset: '1', limit: '2' }).items.map((t) => t.id));
  assert.equal(services.browsePromos({ offset: 'abc', limit: 'abc' }).items.length, Math.min(60, promos.total));
  assert.equal(services.myCards(uid, { offset: '0.5', limit: '1.7' }).items.length, 1);
  assert.equal(services.myCards(uid, { offset: '1e400', limit: '-4' }).items.length, 0);
  assert.equal(services.browseAlbums(uid, { offset: '2.7', limit: '3.2' }).items.length, 3);
  // Directement au catalogue aussi.
  assert.equal(catalog.searchAlbums({ offset: 1.5, limit: 2.5 }).items.length, 2);
  assert.equal(catalog.promos({ offset: 0.5, limit: 1.5 }).items.length, 1);
  assert.equal(catalog.ownedTracks(uid, { offset: 0.2, limit: 1.9 }).items.length, 1);
});

test('booster d’album : les cartes manquantes sortent toutes avant une carte déjà possédée', () => {
  const album = imported().find((a) => a.track_count >= 9);
  const ids = catalog.albumTrackIds(album.id);
  const check = (cat, albumId, list, missingCount) => {
    const owned = new Set(list.slice(missingCount));
    const missing = list.slice(0, missingCount);
    for (let i = 0; i < 60; i++) {
      const cards = rollAlbumPack(Math.random, cat, albumId, owned);
      const got = cards.map((c) => c.trackId);
      assert.equal(cards.length, 5);
      assert.equal(new Set(got).size, 5, 'cartes différentes');
      const fresh = got.filter((id) => !owned.has(id));
      assert.equal(fresh.length, Math.min(5, missingCount), `manquantes d’abord (${missingCount} manquantes) : ${got}`);
      if (missingCount <= 5) assert.ok(missing.every((id) => got.includes(id)));
    }
  };
  for (const k of [9, 5, 3, 1, 0]) check(catalog, album.id, ids, k);
  // Démo : même règle partagée sur le catalogue statique.
  for (const k of [7, 2]) check(staticCatalog, 'discovery', staticCatalog.albumTrackIds('discovery'), k);
  // Album de moins de 5 cartes : toutes y sont, le reste est tiré dans l'album.
  const tiny = { albumTracks: () => [{ id: 'a', rarity: 'common' }, { id: 'b', rarity: 'rare' }, { id: 'c', rarity: 'legendary' }] };
  const cards = rollAlbumPack(Math.random, tiny, 'x', new Set(['a']));
  assert.equal(cards.length, 5);
  assert.deepEqual([...new Set(cards.map((c) => c.trackId))].sort(), ['a', 'b', 'c']);

  // Par le serveur : deux cartes manquantes, toutes deux dans le booster payé.
  const uid = makeUser({ royalties: ECONOMY.albumPackPrice });
  const ins = db.prepare("INSERT INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, 'std', 1, 0)");
  for (const id of ids.slice(2)) ins.run(uid, id);
  const res = services.openAlbumPack(uid, album.id);
  assert.deepEqual(res.cards.filter((c) => c.newTrack).map((c) => c.trackId).sort(), ids.slice(0, 2).sort());
  assert.ok(res.achievements.some((a) => a.key === `album:${album.id}`), 'album complété');
});

test('artistes maîtrisés et albums complétés comptés d’après les succès, même après un import', () => {
  const { wdb, wcatalog, wservices } = seedWorld();
  const now = Date.now();
  const uid = Number(wdb.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at)
    VALUES ('m@example.com', 'maitre', 'x', ?, ?, ?)`).run(now, now, now).lastInsertRowid);
  wservices.adminCompleteCollection(uid, 'kind-of-blue');
  let st = wcatalog.stats(uid);
  assert.equal(st.albumsCompleted, 1);
  assert.equal(st.artistsMastered, 1);
  // L'import ajoute un album à Miles Davis (artiste de la graine) : sa maîtrise et son badge restent.
  addImportedAlbum(wdb, wcatalog, { id: 'dz-miles', artistId: 'miles-davis', artist: 'Miles Davis', title: 'Bitches Brew' });
  wcatalog.refreshCounts();
  wcatalog.rebuildIndex();
  st = wcatalog.stats(uid);
  assert.ok(st.artists['miles-davis'].pct < 1);
  assert.equal(st.artistsMastered, 1);
  assert.equal(st.albumsCompleted, 1);
  const profile = wservices.publicProfile(uid, 'maitre');
  assert.equal(profile.stats.artistsMastered, profile.masteredArtists.length);
  assert.equal(profile.stats.albumsCompleted, profile.vinyls.length);
  // Démo : même calcul d'après les succès.
  const owned = new Set(staticCatalog.albumTrackIds('kind-of-blue'));
  const demo = staticCatalog.stats(owned, ['album:kind-of-blue', 'artist:miles-davis', 'album:inconnu']);
  assert.equal(demo.albumsCompleted, 1);
  assert.equal(demo.artistsMastered, 1);
  assert.equal(staticCatalog.stats(owned, []).artistsMastered, 0);
});

test('numéros de catalogue : un nouvel album de base ne heurte jamais un album importé', () => {
  const { wdb, wcatalog } = seedWorld();
  // Albums importés avec l'ancienne numérotation (juste après la graine : 21, 22), et un nouveau (≥ 1001).
  addImportedAlbum(wdb, wcatalog, { id: 'dz21', artistId: 'dz-a', artist: 'Importé', title: 'Vingt et un', catalogNumber: 21 });
  addImportedAlbum(wdb, wcatalog, { id: 'dz22', artistId: 'dz-a', artist: 'Importé', title: 'Vingt-deux', catalogNumber: 22 });
  addImportedAlbum(wdb, wcatalog, { id: 'dz-new', artistId: 'dz-a', artist: 'Importé', title: 'Nouveau' });
  assert.equal(wcatalog.album('dz-new').code, 'AM-1001');
  // La graine gagne un 21e album (comme le décrit le README) : le démarrage ne plante pas.
  const base = ALBUMS[0];
  const extra = { ...base, id: 'nouvel-album', title: 'Nouvel album' };
  const extraTracks = TRACKS.filter((t) => t.albumId === base.id).map((t) => ({ ...t, id: t.id.replace(base.id, extra.id), albumId: extra.id }));
  const grown = createCatalog(wdb, { covers: () => true, seedData: { ARTISTS, ALBUMS: [...ALBUMS, extra], TRACKS: [...TRACKS, ...extraTracks] } });
  assert.equal(grown.album('nouvel-album').code, 'AM-021');
  assert.ok(Number(grown.album('dz21').code.slice(3)) > 1001, grown.album('dz21').code);
  assert.equal(grown.album('dz22').code, 'AM-022');
  assert.equal(grown.albumTracks('dz21').length, 4, 'l’album déplacé garde ses cartes');
  const numbers = wdb.prepare('SELECT catalog FROM cat_albums').all().map((r) => r.catalog);
  assert.equal(new Set(numbers).size, numbers.length, 'numéros uniques');
  // Graine réordonnée : les albums de base échangent leur numéro sans conflit.
  const swapped = createCatalog(wdb, { covers: () => true, seedData: { ARTISTS, ALBUMS: [ALBUMS[1], ALBUMS[0], ...ALBUMS.slice(2)], TRACKS } });
  assert.equal(swapped.album(ALBUMS[1].id).code, 'AM-001');
  assert.equal(swapped.album(ALBUMS[0].id).code, 'AM-002');
});
