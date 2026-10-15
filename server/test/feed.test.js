// Fil d'actualité (PLAN.md 4.2.2, 5.2, chantier P1-A) : amis d'abord, lignes agrégées « a noté N albums », règle de
// diversité, pagination stable par curseur, contenus masqués et joueurs bloqués exclus, Studio privé, onglets Pour toi et
// Communauté, rattrapage unique, tâche purge-activity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';
import { scoreOf, diversify, jobs } from '../feed.js';

const app = await startApp();
test.after(() => app.close());
const { db, deps } = app;

let n = 0;
const player = (name) => signupVerified(app, { username: name || `fd_${++n}` });
const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
function befriend(a, b) {
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
    .run(a.user.id, b.user.id, Date.now(), Date.now());
}
const feed = async (who, query = '') => (await call(who, 'GET', `/feed${query}`)).body;

test('score et diversité (fonctions pures)', () => {
  const fresh = scoreOf({ ageHours: 0, affinity: 1, engagement: 0, verb: 'review' });
  assert.ok(Math.abs(fresh - 2.3) < 1e-9);
  assert.ok(Math.abs(scoreOf({ ageHours: 36, verb: 'rate' }) - 0.5) < 1e-9, 'demi-vie de 36 h');
  assert.ok(scoreOf({ ageHours: 1, engagement: 99, verb: 'post' }) > scoreOf({ ageHours: 1, engagement: 0, verb: 'post' }));
  assert.equal(scoreOf({ ageHours: 0, engagement: 1e9, verb: 'rate' }), 2, 'engagement plafonné à 1');
  const items = ['a', 'a', 'a', 'b', 'a', 'c'].map((actorId, i) => ({ actorId, i }));
  const out = diversify(items).map((x) => x.actorId);
  for (let i = 2; i < out.length; i++) assert.ok(!(out[i] === out[i - 1] && out[i] === out[i - 2]) || !out.slice(i).some((x) => x !== out[i]), out.join(''));
  assert.deepEqual(out, ['a', 'a', 'b', 'a', 'a', 'c']);
});

test('écriture : critique, notes du jour agrégées, album complété, post, liste privée exclue', async () => {
  const me = await player();
  await call(me, 'PUT', '/ratings/album/discovery', { score: 8 });
  await call(me, 'PUT', '/ratings/album/thriller', { score: 6 });
  await call(me, 'PUT', '/ratings/track/discovery:01', { score: 9 });
  const rows = db.prepare("SELECT verb, data, group_key FROM activity WHERE actor_id = ? AND verb = 'rate'").all(me.user.id);
  assert.equal(rows.length, 1, 'une seule ligne « a noté » par jour');
  const data = JSON.parse(rows[0].data);
  assert.equal(data.count, 3);
  assert.deepEqual(data.items.map((x) => x.id), ['discovery:01', 'thriller', 'discovery']);
  // La note devient une critique : elle quitte la ligne « a noté » et a sa propre ligne.
  await call(me, 'PUT', '/ratings/album/thriller', { score: 6, review: 'Toujours aussi efficace.' });
  const rate = JSON.parse(db.prepare("SELECT data FROM activity WHERE actor_id = ? AND verb = 'rate'").get(me.user.id).data);
  assert.deepEqual(rate.items.map((x) => x.id), ['discovery:01', 'discovery']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE actor_id = ? AND verb = 'review'").get(me.user.id).n, 1);
  // Retirer une note la retire de la ligne du jour.
  await call(me, 'DELETE', '/ratings/album/discovery');
  const rate2 = JSON.parse(db.prepare("SELECT data FROM activity WHERE actor_id = ? AND verb = 'rate'").get(me.user.id).data);
  assert.deepEqual(rate2.items.map((x) => x.id), ['discovery:01']);
  // Album complété (événement du bus) : une ligne, une seule fois.
  deps.bus.emit('album.completed', { userId: me.user.id, albumId: 'moon-safari', rank: 37, at: Date.now() });
  deps.bus.emit('album.completed', { userId: me.user.id, albumId: 'moon-safari', rank: 37, at: Date.now() });
  const done = db.prepare("SELECT data FROM activity WHERE actor_id = ? AND verb = 'complete'").all(me.user.id);
  assert.equal(done.length, 1);
  assert.equal(JSON.parse(done[0].data).rank, 37);
  // Légendaires du jour : une ligne agrégée.
  deps.bus.emit('cards.added', { userId: me.user.id, cards: [{ trackId: 'discovery:01', variant: 'std', rarity: 'legendary', newTrack: true }] });
  deps.bus.emit('cards.added', { userId: me.user.id, cards: [{ trackId: 'thriller:01', variant: 'std', rarity: 'promo', newTrack: true }, { trackId: 'x', rarity: 'common', newTrack: true }] });
  const pull = db.prepare("SELECT data FROM activity WHERE actor_id = ? AND verb = 'pull'").all(me.user.id);
  assert.equal(pull.length, 1);
  assert.equal(JSON.parse(pull[0].data).count, 2);
  // Liste privée : jamais dans le fil.
  deps.bus.emit('list.saved', { listId: 999, userId: me.user.id, kind: 'list', visibility: 'private', itemCount: 4 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE object_type = 'list' AND object_id = '999'").get().n, 0);
});

test('Tes amis : amis et soi, jamais les inconnus ni les bloqués ; FeedItem hydraté ; onglet par défaut', async () => {
  const me = await player();
  const friend = await player();
  const stranger = await player();
  befriend(me, friend);
  // Nouveau compte avec un ami inactif : Communauté par défaut, hasFriends vrai.
  const before = await feed(me);
  assert.equal(before.tab, 'community');
  assert.equal(before.hasFriends, true);

  await call(friend, 'PUT', '/ratings/album/abbey-road', { score: 10, review: 'Parfait de bout en bout.' });
  const fp = (await call(friend, 'POST', '/posts', { body: 'Abbey Road ce soir', item: { type: 'album', id: 'abbey-road' } })).body.post;
  await call(stranger, 'POST', '/posts', { body: 'Un inconnu' });
  await call(me, 'POST', '/posts', { body: 'Moi aussi' });

  const page = await feed(me);
  assert.equal(page.tab, 'friends', 'un ami a été actif : Tes amis par défaut');
  const actors = new Set(page.items.map((x) => x.actor.username));
  assert.ok(actors.has(friend.username));
  assert.ok(actors.has(me.username));
  assert.ok(!actors.has(stranger.username), 'un inconnu n’est pas dans Tes amis');
  const post = page.items.find((x) => x.verb === 'post' && x.object.id === String(fp.id));
  assert.equal(post.post.body, 'Abbey Road ce soir');
  assert.deepEqual(post.item, { type: 'album', id: 'abbey-road' });
  assert.equal(post.reason, 'friend');
  const review = page.items.find((x) => x.verb === 'review');
  assert.equal(review.review.review, 'Parfait de bout en bout.');
  assert.equal(review.review.liked, false);
  assert.ok(page.catalog.albums.some((a) => a.id === 'abbey-road'));
  for (const k of ['id', 'verb', 'actor', 'object', 'groupCount', 'data', 'likeCount', 'commentCount', 'liked', 'reason', 'createdAt', 'updatedAt']) assert.ok(k in post, k);

  // « J'aime » reflété dans le fil.
  await call(me, 'PUT', `/likes/post/${fp.id}`);
  const liked = (await feed(me, '?tab=friends')).items.find((x) => x.verb === 'post' && x.object.id === String(fp.id));
  assert.equal(liked.liked, true);
  assert.equal(liked.likeCount, 1);

  // Bloquer l'ami : il disparaît du fil (et l'amitié est retirée).
  await call(me, 'PUT', `/blocks/${friend.user.id}`);
  const after = await feed(me, '?tab=friends');
  assert.ok(!after.items.some((x) => x.actor.id === friend.user.id));
  assert.equal((await call(me, 'GET', '/feed?tab=nope')).status, 400);
});

test('pagination stable par curseur : aucun doublon ni trou, le score ne réordonne qu’à l’intérieur d’une page', async () => {
  const me = await player();
  const friends = [await player(), await player(), await player()];
  for (const f of friends) befriend(me, f);
  const ins = db.prepare(`INSERT INTO activity (actor_id, verb, object_type, object_id, item_type, item_id, visibility, created_at, updated_at)
    VALUES (?, 'complete', 'album', ?, 'album', ?, 'public', ?, ?)`);
  const albums = ['discovery', 'thriller', 'abbey-road', 'moon-safari', 'kind-of-blue', 'random-access-memories', 'nevermind', 'rumours', 'back-in-black', 'the-dark-side-of-the-moon'];
  const t0 = Date.now() - 3_600_000;
  let k = 0;
  for (let i = 0; i < 45; i++) {
    const f = friends[i % 3];
    const album = albums[i % albums.length];
    ins.run(f.user.id, `${album}#${i}`, album, t0 + (k++) * 1000, t0 + k * 1000);
  }
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await feed(me, `?tab=friends&limit=10${cursor ? `&cursor=${cursor}` : ''}`);
    seen.push(...page.items.map((x) => x.id));
    // Diversité : jamais 3 éléments d'affilée du même joueur quand un autre est disponible.
    const actors = page.items.map((x) => x.actor.id);
    for (let i = 2; i < actors.length; i++) {
      if (actors[i] === actors[i - 1] && actors[i] === actors[i - 2]) assert.ok(!actors.slice(i).some((a) => a !== actors[i]), 'diversité');
    }
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < 10);
  assert.equal(seen.length, 45, 'tout est lu');
  assert.equal(new Set(seen).size, 45, 'aucun doublon');
  assert.equal(pages, 5);
});

test('contenus masqués, Studio privé et blocages exclus ; Pour toi et Communauté', async () => {
  const me = await player();
  const author = await player();
  const privateOne = await player();
  const blocked = await player();
  await call(me, 'PUT', `/blocks/${blocked.user.id}`);
  const shown = (await call(author, 'POST', '/posts', { body: 'Visible', item: { type: 'album', id: 'discovery' } })).body.post;
  const hidden = (await call(author, 'POST', '/posts', { body: 'Masqué' })).body.post;
  db.prepare('UPDATE posts SET hidden_at = ? WHERE id = ?').run(Date.now(), hidden.id);
  await call(author, 'POST', '/posts', { body: 'Amis seulement', visibility: 'friends' });
  await call(blocked, 'POST', '/posts', { body: 'Bloqué' });
  db.prepare("UPDATE users SET profile_visibility = 'private' WHERE id = ?").run(privateOne.user.id);
  await call(privateOne, 'PUT', '/ratings/album/thriller', { score: 9, review: 'Studio privé, critique publiée.' });
  await call(privateOne, 'PUT', '/ratings/album/discovery', { score: 7 });

  // Toutes les pages classées (les autres tests ont aussi rempli le fil).
  const community = { items: [] };
  let cursor = null;
  do {
    const page = await feed(me, `?tab=community&limit=50${cursor ? `&cursor=${cursor}` : ''}`);
    community.items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  const bodies = community.items.filter((x) => x.verb === 'post').map((x) => x.post.body);
  assert.ok(bodies.includes('Visible'));
  assert.ok(!bodies.includes('Masqué'), 'post masqué exclu');
  assert.ok(!bodies.includes('Amis seulement'), 'post « amis » d’un inconnu exclu');
  assert.ok(!community.items.some((x) => x.actor.id === blocked.user.id), 'joueur bloqué exclu');
  assert.ok(!community.items.some((x) => x.actor.id === privateOne.user.id), 'Studio privé : son activité de jeu n’est pas dans le fil');
  assert.ok(community.items.every((x) => ['friend', 'taste', 'popular'].includes(x.reason)));
  assert.equal(community.items.find((x) => x.post?.id === shown.id).reason, 'popular');

  // Pour toi : mes goûts (genre ou artiste collectionné) ; démarrage à froid → la communauté.
  const forYou = await feed(me, '?tab=foryou');
  assert.ok(Array.isArray(forYou.items));
  assert.ok(forYou.items.length > 0, 'démarrage à froid : jamais vide quand la communauté est active');
  assert.ok(!forYou.items.some((x) => x.actor.id === blocked.user.id || x.actor.id === me.user.id));

  // Pages classées : curseur [décalage], sans doublon.
  const p1 = await feed(me, '?tab=community&limit=2');
  if (p1.nextCursor) {
    const p2 = await feed(me, `?tab=community&limit=2&cursor=${p1.nextCursor}`);
    const ids = [...p1.items, ...p2.items].map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test('Studio « Activité récente » : selon la confidentialité, blocages', async () => {
  const me = await player();
  const friend = await player();
  const other = await player();
  befriend(me, friend);
  await call(friend, 'POST', '/posts', { body: 'Pour mes amis', visibility: 'friends' });
  await call(friend, 'POST', '/posts', { body: 'Pour tous' });
  const asFriend = (await call(me, 'GET', `/users/${friend.username}/activity`)).body;
  assert.equal(asFriend.items.length, 2);
  const asOther = (await call(other, 'GET', `/users/${friend.username}/activity`)).body;
  assert.deepEqual(asOther.items.map((x) => x.post.body), ['Pour tous']);
  db.prepare("UPDATE users SET profile_visibility = 'friends' WHERE id = ?").run(friend.user.id);
  assert.equal((await call(other, 'GET', `/users/${friend.username}/activity`)).body.restricted, true);
  assert.equal((await call(me, 'GET', `/users/${friend.username}/activity`)).body.items.length, 2);
  await call(other, 'PUT', `/blocks/${friend.user.id}`);
  assert.equal((await call(other, 'GET', `/users/${friend.username}/activity`)).status, 404);
  assert.equal((await call(me, 'GET', '/users/personne_ici/activity')).status, 404);
});

test('rattrapage unique (critiques et albums complétés des 30 derniers jours) et tâche purge-activity', async () => {
  const me = await player();
  const now = Date.now();
  db.prepare("DELETE FROM kv WHERE key = 'feed:backfill'").run();
  db.prepare("INSERT INTO ratings (user_id, item_type, item_id, score, review, review_at, created_at, updated_at) VALUES (?, 'album', 'rumours', 9, 'Ancienne critique', ?, ?, ?)")
    .run(me.user.id, now - 5 * 86_400_000, now - 5 * 86_400_000, now - 5 * 86_400_000);
  db.prepare("INSERT INTO achievements (user_id, key, created_at, rank) VALUES (?, 'album:nevermind', ?, 3)").run(me.user.id, now - 2 * 86_400_000);
  db.prepare("INSERT INTO ratings (user_id, item_type, item_id, score, review, review_at, created_at, updated_at) VALUES (?, 'album', 'back-in-black', 7, 'Trop vieille', ?, ?, ?)")
    .run(me.user.id, now - 60 * 86_400_000, now - 60 * 86_400_000, now - 60 * 86_400_000);
  const first = deps.feed.backfill(now);
  assert.ok(first.reviews >= 1 && first.completions >= 1, JSON.stringify(first));
  assert.equal(deps.feed.backfill(now), null, 'une seule fois (drapeau kv)');
  const mine = db.prepare("SELECT verb, item_id FROM activity WHERE actor_id = ? AND verb IN ('review', 'complete')").all(me.user.id);
  assert.ok(mine.some((r) => r.verb === 'review' && r.item_id === 'rumours'));
  assert.ok(mine.some((r) => r.verb === 'complete' && r.item_id === 'nevermind'));
  assert.ok(!mine.some((r) => r.item_id === 'back-in-black'), 'plus de 30 jours : pas rattrapé');

  // purge-activity : plus de 180 jours.
  db.prepare("INSERT INTO activity (actor_id, verb, object_type, object_id, visibility, created_at, updated_at) VALUES (?, 'friend', 'user', '1', 'friends', ?, ?)")
    .run(me.user.id, now - 200 * 86_400_000, now - 200 * 86_400_000);
  const job = jobs.find((j) => j.name === 'purge-activity');
  assert.ok(job.run({ db }).deleted >= 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity WHERE created_at < ?').get(now - 180 * 86_400_000).n, 0);
});

test('index et budget : Tes amis et Communauté passent par les index d’activity, une page en quelques ms', async () => {
  const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ');
  const friends = plan("SELECT id FROM activity WHERE actor_id IN (SELECT value FROM json_each('[1,2,3]')) ORDER BY created_at DESC, id DESC LIMIT 21");
  assert.doesNotMatch(friends, /SCAN activity\b(?! USING)/, friends);
  const recent = plan("SELECT id FROM activity WHERE created_at >= 0 AND visibility = 'public' ORDER BY created_at DESC LIMIT 200");
  assert.doesNotMatch(recent, /SCAN activity\b(?! USING)/, recent);

  const me = await player();
  const crowd = [];
  for (let i = 0; i < 30; i++) {
    const { id } = db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at)
      VALUES (?, ?, 'x', ?, ?, ?) RETURNING id`).get(`fdc${i}@example.com`, `fd_crowd${i}`, Date.now(), Date.now(), Date.now());
    crowd.push(id);
    db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)").run(me.user.id, id, Date.now(), Date.now());
  }
  const ins = db.prepare(`INSERT INTO activity (actor_id, verb, object_type, object_id, item_type, item_id, visibility, created_at, updated_at)
    VALUES (?, 'complete', 'album', 'discovery', 'album', 'discovery', 'public', ?, ?)`);
  for (let i = 0; i < 3000; i++) ins.run(crowd[i % crowd.length], Date.now() - i * 60_000, Date.now() - i * 60_000);
  const time = (fn) => {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      fn();
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };
  const friendsMs = time(() => deps.feed.feed(me.user.id, { tab: 'friends' }));
  const communityMs = time(() => deps.feed.feed(me.user.id, { tab: 'community' }));
  assert.ok(friendsMs < 30, `Tes amis : ${friendsMs.toFixed(1)} ms`);
  assert.ok(communityMs < 60, `Communauté : ${communityMs.toFixed(1)} ms`);
});
