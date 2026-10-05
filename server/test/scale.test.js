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
const { rollPack, ECONOMY, RARITIES } = await import('../../shared/rules.js');
const { staticCatalog } = await import('../../shared/staticCatalog.js');

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
