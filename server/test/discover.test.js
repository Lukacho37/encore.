// Découvrir personnalisé (PLAN.md 4.2.7, 5.5, chantier P1-E) : sections expliquées (raison en une ligne), albums notés
// ou complétés écartés (sauf « À compléter »), 2 albums par artiste au plus, un album une seule fois sur la page,
// « Très apprécié par tes amis » (avatars, blocages), albums cultes, à compléter (liste d'envies d'abord), décennie,
// genre, tendances, nouveautés, démarrage à froid, tuiles, « Voir plus » par curseur, cache oublié quand on note,
// albums proches (GET /albums/:id/similar).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';

const app = await startApp({ catalog: { artists: 40, albumsPerArtist: 4, target: 200 } });
test.after(() => app.close());
const { db, deps } = app;

let n = 0;
const player = () => signupVerified(app, { username: `dc_${++n}` });
const call = (who, method, p, body) => api(app.base, who?.cookie || '', method, p, body);
const befriend = (a, b) => {
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
    .run(a.user.id, b.user.id, Date.now(), Date.now());
  deps.discover.forget(a.user.id);
  deps.discover.forget(b.user.id);
};
const rate = (who, id, score) => deps.ratings.rate(who.user.id, 'album', id, score);
const albums = db.prepare("SELECT id, artist_id, genre, year FROM cat_albums WHERE status = 'active' ORDER BY fans DESC, id").all();
const artistOf = new Map(albums.map((a) => [a.id, a.artist_id]));
const sectionOf = (page, id) => page.sections.find((s) => s.id === id);
const idsOf = (section) => section.items.map((x) => x.id);

// Albums cultes : 25 notes à 9 sur trois albums (statistiques de la communauté).
const cult = albums.slice(30, 36).map((a) => a.id);
for (const id of cult) {
  db.prepare("INSERT OR REPLACE INTO rating_stats (item_type, item_id, count, sum) VALUES ('album', ?, 25, 225)").run(id);
}

test('compte tout neuf : sections non vides, raisons, tuiles, aucune erreur', async () => {
  const me = await player();
  const r = await call(me, 'GET', '/discover');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { sections, tiles, catalog } = r.body;
  assert.ok(sections.length >= 2, JSON.stringify(sections.map((s) => s.id)));
  for (const s of sections) {
    assert.ok(s.titleKey.startsWith('discover.sections.'), s.titleKey);
    assert.ok(s.reason.key.startsWith('discover.reasons.'), s.reason.key);
    assert.ok(s.items.length >= 4 && s.items.length <= 12);
    assert.ok(s.items.every((x) => x.type === 'album'));
    const per = {};
    for (const x of s.items) per[artistOf.get(x.id)] = (per[artistOf.get(x.id)] || 0) + 1;
    assert.ok(Object.values(per).every((k) => k <= (s.kind === 'artist' || s.kind === 'complete' ? 3 : 2)), `2 par artiste au plus dans ${s.id}`);
  }
  assert.ok(sectionOf(r.body, 'cult'), 'albums cultes jamais notés');
  assert.deepEqual(tiles.map((t) => t.id), ['battles', 'rankings', 'lists', 'nine', 'blindtest']);
  const shown = sections.flatMap(idsOf);
  assert.ok(shown.every((id) => catalog.albums.some((a) => a.id === id)), 'les albums montrés sont dans `catalog`');
  assert.equal(new Set(shown).size, shown.length, 'un album n’apparaît qu’une fois sur la page');
  assert.equal((await call(null, 'GET', '/discover')).status, 401);
});

test('albums notés et complétés écartés (sauf « À compléter »), parce que tu as aimé, à compléter, genre', async () => {
  const me = await player();
  const seed = albums.find((a) => a.genre && a.year);
  rate(me, seed.id, 9);
  rate(me, cult[0], 4);
  // Album complété et album à moitié commencé ; un album recherché.
  const done = albums[1].id;
  const half = albums[2].id;
  const wantedIds = albums.slice(3, 7).map((a) => a.id);
  const wanted = wantedIds[0];
  db.prepare('INSERT INTO user_album_progress (user_id, album_id, owned, total, first_at, updated_at) VALUES (?, ?, 10, 10, ?, ?), (?, ?, 6, 10, ?, ?)')
    .run(me.user.id, done, Date.now(), Date.now(), me.user.id, half, Date.now(), Date.now());
  deps.collection.addToWishlist(me.user.id, wantedIds);
  deps.discover.forget(me.user.id);
  deps.match.forget(me.user.id);

  const page = (await call(me, 'GET', '/discover')).body;
  const because = sectionOf(page, 'because');
  assert.ok(because, JSON.stringify(page.sections.map((s) => s.id)));
  assert.equal(because.titleVars.albumId, seed.id);
  assert.equal(because.reason.key, 'discover.reasons.because');
  assert.ok(page.catalog.albums.some((a) => a.id === seed.id), 'la graine est dans `catalog` (titre de la section)');
  for (const s of page.sections) {
    if (s.id === 'complete') continue;
    assert.ok(!idsOf(s).includes(seed.id) && !idsOf(s).includes(cult[0]), `${s.id} : albums notés écartés`);
    assert.ok(!idsOf(s).includes(done), `${s.id} : album complété écarté`);
  }
  assert.ok(!idsOf(sectionOf(page, 'cult')).includes(cult[0]));
  const complete = sectionOf(page, 'complete');
  assert.ok(complete, 'à compléter');
  assert.deepEqual(idsOf(complete).slice(0, 4).sort(), wantedIds.slice().sort(), 'la liste d’envies d’abord');
  assert.ok(idsOf(complete).includes(half), 'puis les albums à moitié ou plus');
  assert.ok(!idsOf(complete).includes(done));
  assert.equal(complete.reason.key, 'discover.reasons.completeWanted');
  assert.deepEqual(page.progress[half], { owned: 6, total: 10 }, 'progression des albums montrés');
  const genre = sectionOf(page, 'genre');
  assert.ok(genre && genre.titleVars.genre, 'mon genre');
});

test('« Très apprécié par tes amis » : notes 8+ des amis, avatars, blocages respectés', async () => {
  const me = await player();
  const f1 = await player();
  const f2 = await player();
  const blocked = await player();
  befriend(me, f1);
  befriend(me, f2);
  befriend(me, blocked);
  const liked = albums.slice(50, 56).map((a) => a.id);
  for (const id of liked) {
    rate(f1, id, 9);
    rate(f2, id, 8);
  }
  const secret = albums.slice(60, 66).map((a) => a.id);
  for (const id of secret) rate(blocked, id, 10);
  await call(me, 'PUT', `/blocks/${blocked.user.id}`);
  deps.discover.forget(me.user.id);
  const page = (await call(me, 'GET', '/discover')).body;
  const friends = sectionOf(page, 'friends');
  assert.ok(friends, JSON.stringify(page.sections.map((s) => s.id)));
  assert.equal(friends.reason.key, 'discover.reasons.friends');
  assert.equal(friends.reason.vars.n, 2);
  assert.deepEqual(friends.users.map((u) => u.username).sort(), [f1.username, f2.username].sort());
  assert.ok(idsOf(friends).every((id) => liked.includes(id)), 'albums notés 8+ par mes amis');
  assert.ok(idsOf(friends).every((id) => !secret.includes(id)), 'jamais les notes d’un joueur bloqué');
});

test('cache 10 min oublié quand je note ; « Voir plus » par curseur ; section inconnue', async () => {
  const me = await player();
  const first = (await call(me, 'GET', '/discover')).body;
  const cultIds = idsOf(sectionOf(first, 'cult'));
  // Même réponse depuis le cache.
  assert.deepEqual((await call(me, 'GET', '/discover')).body, first);
  rate(me, cultIds[0], 7);
  const after = (await call(me, 'GET', '/discover')).body;
  assert.ok(!idsOf(sectionOf(after, 'cult')).includes(cultIds[0]), 'noter un album le retire de la page');

  const withMore = after.sections.find((s) => s.moreCursor);
  if (withMore) {
    const more = await call(me, 'GET', `/discover/${withMore.id}?cursor=${withMore.moreCursor}`);
    assert.equal(more.status, 200);
    assert.ok(more.body.items.length >= 1);
    assert.ok(more.body.items.every((x) => !idsOf(withMore).includes(x.id)), 'page suivante sans doublon');
    assert.ok(more.body.catalog.albums.length >= 1);
  }
  assert.equal((await call(me, 'GET', '/discover/inconnue')).status, 404);
  assert.equal((await call(me, 'GET', '/discover/friends')).status, 404, 'section absente de ma page');
});

test('GET /albums/:id/similar : co-notes, artiste, genre et décennie ; album inconnu', async () => {
  const fans = [];
  for (let i = 0; i < 4; i++) fans.push(await player());
  // (un album que le test précédent n'a pas pris pour graine : les albums proches sont gardés 1 h)
  const base = albums.filter((a) => a.genre && a.year)[20];
  const other = albums.find((a) => a.artist_id !== base.artist_id && a.id !== base.id);
  for (const f of fans) {
    rate(f, base.id, 9);
    rate(f, other.id, 9);
  }
  const me = await player();
  const r = await call(me, 'GET', `/albums/${base.id}/similar`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { items, catalog } = r.body;
  assert.ok(items.length >= 3 && items.length <= 12);
  assert.ok(items.every((x) => ['corated', 'artist', 'genre_decade'].includes(x.reason)));
  assert.ok(!items.some((x) => x.id === base.id));
  assert.ok(items.some((x) => x.id === other.id && x.reason === 'corated'), 'aimé par les mêmes amateurs');
  assert.ok(items.every((x) => catalog.albums.some((a) => a.id === x.id)));
  assert.equal((await call(me, 'GET', '/albums/nope/similar')).status, 404);
});
