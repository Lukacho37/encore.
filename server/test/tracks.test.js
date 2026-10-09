// Page morceau (PLAN.md 4.1.3, chantier P0-C) : morceaux de la graine et morceaux importés, frères d'album et promos
// de l'artiste, carte du joueur, propriétaires (amis), résumé des notes, albums complétés, 404.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';

const app = await startApp({ catalog: { artists: 6, albumsPerArtist: 2, target: 12 } });
test.after(() => app.close());
const { db, deps } = app;
const enc = encodeURIComponent;

let n = 0;
function bot() {
  const now = Date.now();
  n += 1;
  return db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at)
    VALUES (?, ?, 'x', ?, ?, ?) RETURNING id`).get(`trackbot${n}@example.com`, `trackbot${n}`, now, now, now).id;
}
const giveCard = (userId, trackId, variant = 'std', count = 1, at = Date.now()) => db.prepare(`INSERT INTO cards (user_id, track_id, variant, count, first_at)
  VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id, track_id, variant) DO UPDATE SET count = count + excluded.count`).run(userId, trackId, variant, count, at);
const befriend = (a, b) => db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
  .run(a, b, Date.now(), Date.now());

const me = await signupVerified(app, { username: 'morceau_moi' });
const get = (path) => api(app.base, me.cookie, 'GET', path);

test('morceau de la graine : en-tête, album, artiste, frères dans l’ordre, références du catalogue', async () => {
  const r = await get(`/catalog/tracks/${enc('discovery:03')}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const page = r.body;
  assert.equal(page.track.id, 'discovery:03');
  assert.equal(page.track.n, 3);
  assert.equal(page.album.id, 'discovery');
  assert.equal(page.artist.id, page.track.artistId);
  assert.deepEqual(page.siblings, deps.catalog.albumTrackIds('discovery'));
  assert.equal(page.mine, null);
  assert.equal(page.owners.count, 0);
  assert.deepEqual(page.owners.friends, []);
  assert.deepEqual(page.ratings, { summary: { count: 0, average: null, distribution: Array(11).fill(0), reviewCount: 0 }, myScore: null });
  assert.equal(page.albumCompletedBy, 0);
  assert.ok(page.catalog.tracks.some((t) => t.id === 'discovery:14'), 'les frères arrivent avec leurs données');
  assert.ok(page.catalog.albums.some((a) => a.id === 'discovery'));
  assert.ok(page.catalog.artists.some((a) => a.id === page.artist.id));
  // L'identifiant peut aussi arriver non encodé.
  assert.equal((await get('/catalog/tracks/discovery:03')).body.track.id, 'discovery:03');
});

test('morceau importé (faux Deezer) : lien Deezer, album importé, frères', async () => {
  const row = db.prepare("SELECT id, album_id FROM cat_tracks WHERE source = 'deezer' AND kind = 'album' ORDER BY id LIMIT 1").get();
  assert.ok(row, 'le faux Deezer a importé des morceaux');
  const page = (await get(`/catalog/tracks/${enc(row.id)}`)).body;
  assert.equal(page.track.id, row.id);
  assert.match(page.track.url, /^https:\/\/www\.deezer\.(com|test)\/track\/\d+/);
  assert.equal(page.album.id, row.album_id);
  assert.match(page.album.url || '', /deezer\.(com|test)\/album\//);
  assert.deepEqual(page.siblings, deps.catalog.albumTrackIds(row.album_id));
  assert.ok(page.siblings.includes(row.id));
});

test('promo : pas d’album, les promos de l’artiste en frères (≤ 12)', async () => {
  const promo = db.prepare("SELECT id, artist_id FROM cat_tracks WHERE kind = 'promo' ORDER BY n LIMIT 1").get();
  const page = (await get(`/catalog/tracks/${enc(promo.id)}`)).body;
  assert.equal(page.album, null);
  assert.equal(page.albumCompletedBy, null);
  const expected = db.prepare("SELECT id FROM cat_tracks WHERE artist_id = ? AND kind = 'promo' ORDER BY n LIMIT 12").all(promo.artist_id).map((r) => r.id);
  assert.deepEqual(page.siblings, expected);
  assert.ok(page.siblings.includes(promo.id));
});

test('carte du joueur, propriétaires (amis d’abord ≤ 8), résumé des notes, albums complétés', async () => {
  const trackId = 'thriller:02';
  const t0 = Date.now() - 10_000;
  giveCard(me.user.id, trackId, 'std', 2, t0);
  giveCard(me.user.id, trackId, 'holo', 1, t0 + 5000);
  const friends = Array.from({ length: 10 }, () => bot());
  for (const [i, f] of friends.entries()) {
    befriend(me.user.id, f);
    giveCard(f, trackId, 'std', 1, t0 + i);
  }
  const strangers = Array.from({ length: 3 }, () => bot());
  strangers.forEach((s) => giveCard(s, trackId));
  // Deux joueurs ont complété Thriller.
  for (const u of strangers.slice(0, 2)) db.prepare("INSERT INTO achievements (user_id, key, created_at, rank) VALUES (?, 'album:thriller', ?, NULL)").run(u, Date.now());
  deps.ratings.rate(strangers[0], 'track', trackId, 8, 'Un tube.');
  deps.ratings.rate(me.user.id, 'track', trackId, 6, null);

  const page = (await get(`/catalog/tracks/${enc(trackId)}`)).body;
  assert.deepEqual(page.mine.std, { count: 2, firstAt: t0 });
  assert.deepEqual(page.mine.holo, { count: 1, firstAt: t0 + 5000 });
  assert.equal(page.owners.count, 14);
  assert.equal(page.owners.friends.length, 8);
  assert.ok(page.owners.friends.every((u) => u.relation === 'friend' && u.username.startsWith('trackbot')));
  assert.equal(page.ratings.summary.count, 2);
  assert.equal(page.ratings.summary.average, 7);
  assert.equal(page.ratings.myScore, 6);
  assert.equal(page.albumCompletedBy, 2);

  // Le nombre de propriétaires est gardé 5 minutes ; forgetOwners le recalcule.
  giveCard(bot(), trackId);
  assert.equal((await get(`/catalog/tracks/${enc(trackId)}`)).body.owners.count, 14);
  deps.tracks.forgetOwners(trackId);
  assert.equal((await get(`/catalog/tracks/${enc(trackId)}`)).body.owners.count, 15);
});

test('morceau inconnu : 404 unknown_track ; sans compte : 401', async () => {
  for (const id of ['nope:01', 'constructor', '__proto__', 'x'.repeat(81)]) {
    const r = await get(`/catalog/tracks/${enc(id)}`);
    assert.equal(r.status, 404, id);
    assert.equal(r.body.error, 'unknown_track', id);
  }
  assert.equal((await api(app.base, '', 'GET', `/catalog/tracks/${enc('discovery:01')}`)).status, 401);
  // La liste publique des cartes (écran de connexion) répond toujours sans compte.
  assert.equal((await api(app.base, '', 'GET', `/catalog/tracks?ids=${enc('discovery:01')}`)).status, 200);
});

test('index : propriétaires et albums complétés passent par cards_track et ach_key', () => {
  const plan = (sql, ...args) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(' | ');
  assert.match(plan('SELECT COUNT(DISTINCT user_id) AS n FROM cards WHERE track_id = ?', 'discovery:01'), /cards_track/);
  assert.match(plan('SELECT COUNT(*) AS n FROM achievements WHERE key = ?', 'album:discovery'), /ach_key/);
});
