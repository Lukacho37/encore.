// Notes et critiques v2 (PLAN.md 4.1.2, chantier P0-C) : identifiants stables, rating_stats égal à un recomptage,
// amis avant la communauté, pages par curseur, quota, doublons, blocages, modération, événements, journal d'un joueur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';

const app = await startApp();
test.after(() => app.close());
const { db, deps } = app;

const enc = encodeURIComponent;
let botCounter = 0;
/** Joueur créé directement en base (vérifié), pour écrire beaucoup de critiques par l'API interne. */
function bot(name = `bot${++botCounter}`) {
  const now = Date.now();
  const { id } = db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at)
    VALUES (?, ?, 'x', ?, ?, ?) RETURNING id`).get(`${name}@example.com`, name, now, now, now);
  return id;
}
function befriend(a, b) {
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
    .run(a, b, Date.now(), Date.now());
}
/** Remplace temporairement des règles d'accès (deps.access) le temps de `fn`. */
async function withAccess(patch, fn) {
  const real = deps.access;
  deps.access = { ...real, ...patch };
  try {
    return await fn();
  } finally {
    deps.access = real;
  }
}
const recount = (type, id) => db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(score), 0) AS sum, COALESCE(SUM(review IS NOT NULL), 0) AS reviews
  FROM ratings WHERE item_type = ? AND item_id = ?`).get(type, id);
const stats = (type, id) => db.prepare('SELECT count, sum, review_count, dist FROM rating_stats WHERE item_type = ? AND item_id = ?').get(type, id);

test('rating_stats égal à un recomptage après des suites aléatoires de notes et de retraits', () => {
  const users = Array.from({ length: 12 }, () => bot());
  const items = [['album', 'discovery'], ['album', 'thriller'], ['track', 'discovery:01'], ['track', 'discovery:02'], ['album', 'abbey-road']];
  let seed = 42;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  for (let i = 0; i < 400; i++) {
    const user = users[rand(users.length)];
    const [type, id] = items[rand(items.length)];
    if (rand(4) === 0) deps.ratings.unrate(user, type, id);
    else deps.ratings.rate(user, type, id, rand(11), rand(3) === 0 ? `Texte ${i} sur ${id}` : null);
  }
  for (const [type, id] of items) {
    const truth = recount(type, id);
    const row = stats(type, id);
    if (!truth.count) {
      assert.equal(row, undefined, `${type}:${id} sans note → pas de ligne`);
      continue;
    }
    assert.equal(row.count, truth.count, `${type}:${id} count`);
    assert.equal(row.sum, truth.sum, `${type}:${id} sum`);
    assert.equal(row.review_count, truth.reviews, `${type}:${id} review_count`);
    const dist = JSON.parse(row.dist);
    const expected = Array.from({ length: 11 }, (_, s) => db.prepare('SELECT COUNT(*) AS n FROM ratings WHERE item_type = ? AND item_id = ? AND score = ?').get(type, id, s).n);
    assert.deepEqual(dist, expected, `${type}:${id} dist`);
    const summary = deps.ratings.summaryOf(type, id);
    assert.equal(summary.count, truth.count);
    assert.ok(Math.abs(summary.average - truth.sum / truth.count) < 1e-9);
  }
  assert.deepEqual(deps.ratings.summaryOf('album', 'kind-of-blue').distribution, Array(11).fill(0));
});

test('PUT / GET / DELETE : identifiant stable, amis puis communauté, anciennes clés, delta et état partiel', async () => {
  const me = await signupVerified(app, { username: 'notes_moi' });
  const friend = await signupVerified(app, { username: 'notes_ami' });
  const stranger = bot('notes_inconnu');
  befriend(me.user.id, friend.user.id);
  const call = (who, method, path, body) => api(app.base, who.cookie, method, path, body);

  // Erreurs de validation.
  assert.equal((await call(me, 'PUT', '/ratings/album/nope', { score: 5 })).body.error, 'unknown_item');
  assert.equal((await call(me, 'PUT', '/ratings/podcast/discovery', { score: 5 })).body.error, 'unknown_item');
  assert.equal((await call(me, 'PUT', '/ratings/album/moon-safari', { score: 11 })).body.error, 'invalid_score');
  assert.equal((await call(me, 'PUT', '/ratings/album/moon-safari', { score: '7' })).body.error, 'invalid_score');
  assert.equal((await call(me, 'PUT', '/ratings/album/moon-safari', { score: 7, review: 'x'.repeat(2001) })).body.error, 'review_too_long');
  assert.equal((await call(me, 'GET', `/ratings/track/${enc('nope:01')}`)).status, 404);

  const first = await call(me, 'PUT', '/ratings/album/moon-safari', { score: 9, review: '  Un disque de nuit.  ' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const ratingId = first.body.mine.id;
  assert.ok(Number.isInteger(ratingId));
  assert.equal(first.body.mine.review, 'Un disque de nuit.');
  assert.ok(first.body.mine.reviewAt > 0);
  assert.deepEqual(first.body.rating, { type: 'album', id: 'moon-safari', score: 9 });
  assert.equal(first.body.state.partial, true);
  // Changer seulement la note garde l'identifiant, le texte et sa date.
  const second = await call(me, 'PUT', '/ratings/album/moon-safari', { score: 8 });
  assert.equal(second.body.mine.id, ratingId);
  assert.equal(second.body.mine.review, 'Un disque de nuit.');
  assert.equal(second.body.mine.reviewAt, first.body.mine.reviewAt);

  deps.ratings.rate(friend.user.id, 'album', 'moon-safari', 10, 'Mon album préféré.');
  deps.ratings.rate(stranger, 'album', 'moon-safari', 6, 'Pas mal du tout.');
  const view = (await call(me, 'GET', '/ratings/album/moon-safari')).body;
  assert.equal(view.summary.count, 3);
  assert.equal(view.summary.reviewCount, 3);
  assert.equal(view.summary.average, 8);
  assert.deepEqual(view.friends.scores.map((s) => s.user.username), ['notes_ami']);
  assert.deepEqual(view.friends.reviews.map((r) => r.user.username), ['notes_ami']);
  assert.equal(view.friends.reviews[0].friend, true);
  assert.equal(view.friends.reviews[0].user.relation, 'friend');
  assert.deepEqual(view.community.reviews.map((r) => r.user.username), ['notes_inconnu']);
  assert.equal(view.community.reviews[0].friend, false);
  assert.equal(view.community.nextCursor, null);
  const review = view.community.reviews[0];
  for (const k of ['id', 'user', 'score', 'review', 'reviewAt', 'updatedAt', 'likeCount', 'commentCount', 'liked', 'friend']) assert.ok(k in review, k);
  // Anciennes clés : amis d'abord, sans sa propre critique.
  assert.deepEqual(view.reviews.map((r) => r.user.username), ['notes_ami', 'notes_inconnu']);
  assert.deepEqual(view.friendScores.map((s) => s.score), [10]);
  // Album : moyennes des morceaux et mes notes de morceaux.
  deps.ratings.rate(stranger, 'track', 'moon-safari:01', 4, null);
  await call(me, 'PUT', `/ratings/track/${enc('moon-safari:01')}`, { score: 8 });
  const album = (await call(me, 'GET', '/ratings/album/moon-safari')).body;
  assert.deepEqual(album.tracks.averages['moon-safari:01'], { avg: 6, count: 2 });
  assert.equal(album.tracks.mine['moon-safari:01'], 8);

  // Retirer sa note : le texte disparaît (purgeTarget + content.removed), la ligne aussi.
  const purged = [];
  const realPurge = deps.moderation.purgeTarget;
  deps.moderation.purgeTarget = (type, id) => purged.push([type, id]);
  const events = [];
  const off = [deps.bus.on('rating.deleted', (p) => events.push(['deleted', p])), deps.bus.on('content.removed', (p) => events.push(['removed', p]))];
  try {
    const del = await call(me, 'DELETE', '/ratings/album/moon-safari');
    assert.equal(del.status, 200);
    assert.equal(del.body.mine, null);
    assert.deepEqual(del.body.rating, { type: 'album', id: 'moon-safari', score: null });
    assert.equal(del.body.summary.count, 2);
  } finally {
    deps.moderation.purgeTarget = realPurge;
    off.forEach((f) => f());
  }
  assert.deepEqual(purged, [['review', ratingId]]);
  assert.deepEqual(events.map((e) => e[0]).sort(), ['deleted', 'removed']);
  assert.deepEqual(events.find((e) => e[0] === 'deleted')[1], { userId: me.user.id, ratingId, itemType: 'album', itemId: 'moon-safari', hadReview: true });
  // Retirer une note qui n'existe pas : sans erreur.
  assert.equal((await call(me, 'DELETE', '/ratings/album/moon-safari')).status, 200);
});

test('événement rating.saved et effacement du texte seul', async () => {
  const me = await signupVerified(app, { username: 'notes_events' });
  const saved = [];
  const removed = [];
  const off = [deps.bus.on('rating.saved', (p) => saved.push(p)), deps.bus.on('content.removed', (p) => removed.push(p))];
  try {
    const a = await api(app.base, me.cookie, 'PUT', '/ratings/album/exodus', { score: 7 });
    const id = a.body.mine.id;
    await api(app.base, me.cookie, 'PUT', '/ratings/album/exodus', { score: 7, review: 'Reggae solaire.' });
    await api(app.base, me.cookie, 'PUT', '/ratings/album/exodus', { score: 9 });
    const cleared = await api(app.base, me.cookie, 'PUT', '/ratings/album/exodus', { score: 9, review: '   ' });
    assert.equal(cleared.body.mine.review, null);
    assert.equal(cleared.body.mine.reviewAt, null);
    assert.equal(cleared.body.mine.id, id);
    assert.deepEqual(saved.map((p) => [p.isNew, p.hasReview, p.reviewChanged]), [[true, false, false], [false, true, true], [false, true, false], [false, false, true]]);
    assert.ok(saved.every((p) => p.ratingId === id && p.userId === me.user.id && p.itemType === 'album' && p.itemId === 'exodus'));
    assert.deepEqual(removed, [{ targetType: 'review', targetId: id, by: 'author' }]);
  } finally {
    off.forEach((f) => f());
  }
});

test('pages par curseur : communauté 10 par 10, récentes d’abord, sans doublon ; populaires par mentions « J’aime »', async () => {
  const me = await signupVerified(app, { username: 'notes_pages' });
  const authors = Array.from({ length: 25 }, () => bot());
  const base = Date.now() - 100_000;
  authors.forEach((uid, i) => {
    deps.ratings.rate(uid, 'album', 'kind-of-blue', i % 11, `Critique numéro ${i}`);
    db.prepare("UPDATE ratings SET updated_at = ? WHERE user_id = ? AND item_type = 'album' AND item_id = 'kind-of-blue'").run(base + (i % 5) * 1000, uid);
  });
  const first = (await api(app.base, me.cookie, 'GET', '/ratings/album/kind-of-blue')).body;
  assert.equal(first.community.reviews.length, 10);
  assert.ok(first.community.nextCursor);
  const seen = [...first.community.reviews];
  let cursor = first.community.nextCursor;
  let pages = 1;
  while (cursor) {
    const page = await api(app.base, me.cookie, 'GET', `/ratings/album/kind-of-blue/reviews?scope=community&cursor=${cursor}`);
    assert.equal(page.status, 200, JSON.stringify(page.body));
    seen.push(...page.body.items);
    cursor = page.body.nextCursor;
    pages += 1;
  }
  assert.equal(pages, 3);
  assert.equal(seen.length, 25);
  assert.equal(new Set(seen.map((r) => r.id)).size, 25);
  for (let i = 1; i < seen.length; i++) {
    const [a, b] = [seen[i - 1], seen[i]];
    assert.ok(a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.id > b.id), 'ordre (updatedAt, id) décroissant');
  }
  // Taille de page et curseur illisible.
  assert.equal((await api(app.base, me.cookie, 'GET', '/ratings/album/kind-of-blue/reviews?limit=4')).body.items.length, 4);
  assert.equal((await api(app.base, me.cookie, 'GET', '/ratings/album/kind-of-blue/reviews?cursor=%%%')).status, 400);
  assert.equal((await api(app.base, me.cookie, 'GET', '/ratings/album/kind-of-blue/reviews?scope=tous')).status, 400);
  // Populaires : par mentions « J'aime » (colonne tenue par P1-A), décalage plafonné.
  const ids = seen.map((r) => r.id);
  db.prepare('UPDATE ratings SET like_count = 50 WHERE id = ?').run(ids[20]);
  db.prepare('UPDATE ratings SET like_count = 30 WHERE id = ?').run(ids[7]);
  const popular = (await api(app.base, me.cookie, 'GET', '/ratings/album/kind-of-blue/reviews?sort=popular&limit=2')).body;
  assert.deepEqual(popular.items.map((r) => r.id), [ids[20], ids[7]]);
  assert.equal(popular.items[0].likeCount, 50);
  const popular2 = (await api(app.base, me.cookie, 'GET', `/ratings/album/kind-of-blue/reviews?sort=popular&limit=2&cursor=${popular.nextCursor}`)).body;
  assert.equal(popular2.items.length, 2);
  assert.ok(!popular2.items.some((r) => [ids[20], ids[7]].includes(r.id)));
  // Amis : une page « amis » sans ami est vide.
  const friendsPage = (await api(app.base, me.cookie, 'GET', '/ratings/album/kind-of-blue/reviews?scope=friends')).body;
  assert.deepEqual(friendsPage, { items: [], nextCursor: null, catalog: friendsPage.catalog });
});

test('quota quotidien de critiques (429) : 30 nouveaux textes, une critique du jour se modifie encore', async () => {
  const me = await signupVerified(app, { username: 'notes_quota' });
  const tracks = deps.catalog.albumTrackIds('discovery').concat(deps.catalog.albumTrackIds('thriller'), deps.catalog.albumTrackIds('abbey-road'));
  for (let i = 0; i < 30; i++) {
    const r = await api(app.base, me.cookie, 'PUT', `/ratings/track/${enc(tracks[i])}`, { score: 5, review: `Morceau ${i} : très bien.` });
    assert.equal(r.status, 200, `${i} ${JSON.stringify(r.body)}`);
  }
  const over = await api(app.base, me.cookie, 'PUT', `/ratings/track/${enc(tracks[30])}`, { score: 5, review: 'Une de trop.' });
  assert.equal(over.status, 429);
  assert.equal(over.body.error, 'quota_exceeded');
  assert.equal(over.body.kind, 'reviews');
  // Une simple note ne compte pas ; modifier une critique déjà écrite aujourd'hui non plus.
  assert.equal((await api(app.base, me.cookie, 'PUT', `/ratings/track/${enc(tracks[30])}`, { score: 6 })).status, 200);
  assert.equal((await api(app.base, me.cookie, 'PUT', `/ratings/track/${enc(tracks[0])}`, { score: 5, review: 'Finalement, excellent.' })).status, 200);
});

test('doublons (409), politique des liens et compte actif', async () => {
  const me = await signupVerified(app, { username: 'notes_dup' });
  assert.equal((await api(app.base, me.cookie, 'PUT', '/ratings/album/21', { score: 8, review: 'Copié-collé partout.' })).status, 200);
  const dup = await api(app.base, me.cookie, 'PUT', '/ratings/album/back-to-black', { score: 8, review: 'Copié-collé partout.' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'duplicate_review');
  // Même texte renvoyé sur la même critique : pas un doublon.
  assert.equal((await api(app.base, me.cookie, 'PUT', '/ratings/album/21', { score: 9, review: 'Copié-collé partout.' })).status, 200);

  await withAccess({ linkPolicy: (text) => text.replace(/https?:\/\/\S+/g, '').trim() }, async () => {
    const r = await api(app.base, me.cookie, 'PUT', '/ratings/album/graduation', { score: 7, review: 'Écoute ça https://exemple.test/x' });
    assert.equal(r.body.mine.review, 'Écoute ça');
  });
  await withAccess({
    assertActive: () => {
      throw new deps.HttpError(403, 'suspended', { until: 1 });
    },
  }, async () => {
    const r = await api(app.base, me.cookie, 'PUT', '/ratings/album/exodus', { score: 7, review: 'Texte refusé.' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'suspended');
    // Une note sans texte reste possible pour un compte suspendu.
    assert.equal((await api(app.base, me.cookie, 'PUT', '/ratings/album/exodus', { score: 7 })).status, 200);
  });
});

test('blocages : critiques et notes des joueurs bloqués masquées dans les deux sens ; critique masquée par la modération', async () => {
  const me = await signupVerified(app, { username: 'notes_bloque' });
  const author = bot('notes_auteur_bloque');
  const other = bot('notes_auteur_libre');
  befriend(me.user.id, author);
  deps.ratings.rate(author, 'album', 'random-access-memories', 9, 'Critique de quelqu’un de bloqué.');
  deps.ratings.rate(other, 'album', 'random-access-memories', 7, 'Critique visible.');
  db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(author, me.user.id, Date.now());
  // Avec le vrai module de modération (P0-F), les blocages viennent de la table ; sinon, règle d'essai équivalente.
  const fromTable = (viewer) => new Set(db.prepare(`SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?
    UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?`).all(viewer, viewer).map((r) => r.id));
  const patch = deps.access.hiddenIds(me.user.id).has(author) ? {} : {
    hiddenIds: fromTable,
    isBlocked: (a, b) => fromTable(a).has(b),
  };
  await withAccess(patch, async () => {
    const view = (await api(app.base, me.cookie, 'GET', '/ratings/album/random-access-memories')).body;
    const names = [...view.friends.reviews, ...view.community.reviews, ...view.reviews].map((r) => r.user.username);
    assert.ok(!names.includes('notes_auteur_bloque'), 'critique d’un joueur bloqué masquée');
    assert.ok(names.includes('notes_auteur_libre'));
    assert.ok(!view.friends.scores.some((s) => s.user.id === author), 'note d’un joueur bloqué masquée');
    // Journal du joueur bloqué : introuvable.
    assert.equal((await api(app.base, me.cookie, 'GET', '/users/notes_auteur_bloque/ratings')).status, 404);
  });

  // Critique masquée par la modération : invisible pour les autres, signalée à son auteur.
  db.prepare("UPDATE ratings SET hidden_at = ? WHERE user_id = ? AND item_id = 'random-access-memories'").run(Date.now(), other);
  const after = (await api(app.base, me.cookie, 'GET', '/ratings/album/random-access-memories')).body;
  assert.ok(!after.community.reviews.some((r) => r.user.id === other));
  const own = deps.ratings.itemPayload(other, 'album', 'random-access-memories');
  assert.equal(own.mine.moderated, true);
});

test('journal d’un joueur : agrégats, listes bornées, critiques paginées ; fil des amis avec ratingId', async () => {
  const me = await signupVerified(app, { username: 'notes_journal' });
  const reader = await signupVerified(app, { username: 'notes_lecteur' });
  const albums = ['discovery', 'thriller', 'abbey-road', 'kind-of-blue', 'exodus', '21'];
  albums.forEach((a, i) => deps.ratings.rate(me.user.id, 'album', a, 4 + i, i < 4 ? `Avis sur ${a}, numéro ${i}.` : null));
  const tracks = deps.catalog.albumTrackIds('discovery');
  for (let i = 0; i < 12; i++) deps.ratings.rate(me.user.id, 'track', tracks[i], i % 11, i < 9 ? `Morceau ${i} vraiment bien.` : null);
  const journal = (await api(app.base, reader.cookie, 'GET', '/users/notes_journal/ratings')).body;
  const truth = db.prepare('SELECT COUNT(*) AS n, SUM(score) AS s FROM ratings WHERE user_id = ?').get(me.user.id);
  assert.equal(journal.stats.count, truth.n);
  assert.ok(Math.abs(journal.stats.average - truth.s / truth.n) < 1e-9);
  assert.equal(journal.stats.albums, 6);
  assert.equal(journal.stats.distribution.reduce((a, b) => a + b, 0), truth.n);
  assert.equal(journal.topAlbums.length, 4);
  assert.equal(journal.topAlbums[0].id, '21');
  assert.ok(journal.topTracks.length <= 5);
  assert.equal(journal.recent.length, 12);
  assert.equal(journal.reviews.length, 10);
  assert.ok(journal.reviews.every((e) => Number.isInteger(e.ratingId) && e.review));
  assert.ok(journal.reviewsCursor);
  const next = (await api(app.base, reader.cookie, 'GET', `/users/notes_journal/reviews?cursor=${journal.reviewsCursor}`)).body;
  assert.equal(next.items.length, journal.stats.reviews - 10);
  assert.equal(next.nextCursor, null);
  assert.ok(!next.items.some((e) => journal.reviews.some((x) => x.ratingId === e.ratingId)));
  assert.equal((await api(app.base, reader.cookie, 'GET', '/users/personne_ici/ratings')).status, 404);

  // Fil des amis : forme d'avant + identifiant de la note.
  befriend(reader.user.id, me.user.id);
  const feed = (await api(app.base, reader.cookie, 'GET', '/ratings/feed')).body;
  assert.ok(feed.items.length > 0 && feed.items.length <= 20);
  assert.ok(feed.items.every((f) => f.user.username === 'notes_journal' && Number.isInteger(f.ratingId) && f.type && f.id));
  assert.ok(feed.items.every((f) => (f.type === 'album' ? feed.catalog.albums : feed.catalog.tracks).some((x) => x.id === f.id)));
});

test('index : les critiques d’un élément passent par l’index partiel ratings_item_reviews', () => {
  const plan = (sql, ...args) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(' | ');
  const community = plan(`SELECT id FROM ratings WHERE item_type = ? AND item_id = ? AND review IS NOT NULL AND hidden_at IS NULL
    AND user_id NOT IN (SELECT value FROM json_each(?)) ORDER BY updated_at DESC, id DESC LIMIT 11`, 'album', 'discovery', '[1]');
  assert.match(community, /ratings_item_reviews/);
  const friends = plan(`SELECT id FROM ratings WHERE item_type = ? AND item_id = ? AND review IS NOT NULL AND hidden_at IS NULL
    AND user_id IN (SELECT value FROM json_each(?)) ORDER BY updated_at DESC, id DESC LIMIT 11`, 'album', 'discovery', '[1]');
  assert.doesNotMatch(friends, /SCAN ratings\b/);
});
