import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'alice@example.com';
process.env.BLINDTEST_AUDIO = 'off';
process.env.COVERS = 'off';
const { createApp } = await import('../app.js');
const { TRACKS_BY_ALBUM } = await import('../../shared/catalog.js');

const { app, db } = createApp({ dbFile: ':memory:' });
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());

/** Petit navigateur de test : garde tous les cookies reçus (session, inscription). */
function client() {
  const jar = new Map();
  return async function call(method, path, body) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-AlbumMania': '1', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const [k, v] = pair.split('=');
      if (attrs.some((a) => a.trim() === 'Max-Age=0')) jar.delete(k.trim());
      else jar.set(k.trim(), v);
    }
    return { status: res.status, body: await res.json() };
  };
}

const lastLink = (email) => db.prepare('SELECT text FROM dev_emails WHERE to_addr = ? ORDER BY id DESC LIMIT 1').get(email).text;
const tokenFrom = (text) => /token=([\w-]+)/.exec(text)[1];

async function register(call, email, username) {
  const r = await call('POST', '/api/auth/signup', { email, username, password: 'motdepasse123' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const v = await call('POST', '/api/auth/verify', { token: tokenFrom(lastLink(email)) });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body;
}

test('inscription, vérification e-mail et connexion', async () => {
  const call = client();
  const r = await call('POST', '/api/auth/signup', { email: 'Alice@Example.com', username: 'alice', password: 'motdepasse123' });
  assert.equal(r.status, 201);
  assert.equal((await call('POST', '/api/auth/signup', { email: 'x@example.com', username: 'ALICE', password: 'motdepasse123' })).body.error, 'username_taken');
  assert.equal((await call('POST', '/api/auth/signup', { email: 'y@example.com', username: 'a b', password: 'motdepasse123' })).body.error, 'username_format');
  assert.equal((await call('POST', '/api/auth/signup', { email: 'z@example.com', username: 'zed', password: 'court' })).body.error, 'password_short');

  const login = await call('POST', '/api/auth/login', { identifier: 'alice', password: 'motdepasse123' });
  assert.equal(login.status, 403);
  assert.equal(login.body.error, 'email_unverified');

  assert.equal((await call('POST', '/api/auth/verify', { token: 'faux-jeton-faux-jeton-faux' })).status, 400);
  const v = await call('POST', '/api/auth/verify', { token: tokenFrom(lastLink('alice@example.com')) });
  assert.equal(v.status, 200);
  assert.equal(v.body.user.username, 'alice');
  assert.equal(v.body.user.role, 'admin', 'adresse listée dans ADMIN_EMAILS = admin');
  assert.equal(v.body.packs.bonus, 5);
  assert.equal((await call('POST', '/api/auth/signup', { email: 'alice@example.com', username: 'alice2', password: 'motdepasse123' })).body.error, 'email_taken');

  assert.equal((await call('GET', '/api/state')).status, 200);
  await call('POST', '/api/auth/logout');
  assert.equal((await call('GET', '/api/state')).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { identifier: 'alice@example.com', password: 'mauvais' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { identifier: 'Alice', password: 'motdepasse123' })).status, 200);
});

test('protection CSRF', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('boosters, doublons, pressage et succès', async () => {
  const call = client();
  const s = await register(call, 'bob@example.com', 'bob');
  assert.equal(s.user.role, 'player');
  let opened = 0;
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/api/packs/open', {});
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.cards.length, 5);
    opened++;
  }
  const st = (await call('GET', '/api/state')).body;
  assert.equal(st.packs.bonus, 0);
  assert.equal(opened, 5);
  // Pas de stock : le serveur refuse.
  assert.equal((await call('POST', '/api/packs/open', {})).body.error, 'no_packs');
  assert.equal((await call('POST', '/api/packs/open', { count: 10 })).body.error, 'invalid_count');

  const rec = await call('POST', '/api/collection/recycle');
  assert.equal(rec.status, 200);
  assert.ok(rec.body.state.cards.every((c) => c.c === 1));

  // Album presque complet : presser la dernière carte déclenche le succès.
  const album = TRACKS_BY_ALBUM['kind-of-blue'];
  const uid = st.user.id;
  for (const t of album.slice(1)) {
    db.prepare("INSERT OR IGNORE INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, 'std', 1, 0)").run(uid, t.id);
  }
  db.prepare('DELETE FROM cards WHERE user_id = ? AND track_id = ?').run(uid, album[0].id);
  db.prepare('UPDATE users SET royalties = 5000 WHERE id = ?').run(uid);
  const press = await call('POST', '/api/collection/press', { trackId: album[0].id });
  assert.equal(press.status, 200, JSON.stringify(press.body));
  assert.ok(press.body.achievements.some((a) => a.key === 'album:kind-of-blue'));
  assert.ok(press.body.achievements.some((a) => a.key === 'artist:miles-davis'));
  assert.equal((await call('POST', '/api/collection/press', { trackId: album[0].id })).body.error, 'already_owned');
  assert.equal((await call('POST', '/api/collection/press', { trackId: 'promo:hey-jude' })).body.error, 'not_pressable');

  // Avatar : pochette d'un album complété uniquement.
  assert.equal((await call('POST', '/api/profile/avatar', { avatar: 'album:discovery' })).body.error, 'avatar_locked');
  const av = await call('POST', '/api/profile/avatar', { avatar: 'album:kind-of-blue', color: '#4f9dff' });
  assert.equal(av.body.state.user.avatar, 'album:kind-of-blue');

  // Les boosters sont aléatoires : on s'assure que la carte refusée n'a pas été tirée.
  db.prepare('DELETE FROM cards WHERE user_id = ? AND track_id = ?').run(uid, 'discovery:01');
  const sc = await call('POST', '/api/profile/showcase', { slots: [album[0].id, 'discovery:01', null] });
  assert.equal(sc.body.state.user.showcase[0], album[0].id);
  assert.equal(sc.body.state.user.showcase[1], null, 'carte non possédée refusée');

  const buy = await call('POST', '/api/shop/buy-pack');
  assert.equal(buy.status, 200);
  assert.equal(buy.body.state.packs.bonus, 1);
});

test('amis par nom d’utilisateur', async () => {
  const a = client();
  const b = client();
  await register(a, 'carla@example.com', 'carla');
  await register(b, 'dan@example.com', 'dan');
  assert.equal((await a('POST', '/api/friends/request', { username: 'personne' })).body.error, 'user_not_found');
  assert.equal((await a('POST', '/api/friends/request', { username: 'carla' })).body.error, 'cannot_add_self');
  assert.equal((await a('POST', '/api/friends/request', { username: 'DAN' })).body.status, 'pending');
  assert.equal((await a('POST', '/api/friends/request', { username: 'dan' })).body.error, 'already_requested');
  const inbox = (await b('GET', '/api/friends')).body;
  assert.equal(inbox.incoming.length, 1);
  assert.equal((await b('GET', '/api/state')).body.pendingFriends, 1);
  const accepted = await b('POST', `/api/friends/${inbox.incoming[0].requestId}/accept`);
  assert.equal(accepted.body.friends[0].user.username, 'carla');
  const profile = (await a('GET', '/api/users/dan')).body;
  assert.equal(profile.friendship, 'friends');
  assert.equal(profile.email, undefined, 'e-mail jamais exposé');
  const danId = (await b('GET', '/api/state')).body.user.id;
  const removed = await a('DELETE', `/api/friends/${danId}`);
  assert.equal(removed.body.friends.length, 0);
});

test('blind test : partie complète et récompense', async () => {
  const call = client();
  await register(call, 'eve@example.com', 'eve');
  const info = (await call('GET', '/api/blindtest')).body;
  assert.ok(info.genres.find((g) => g.id === 'rap').count > 10);
  const start = await call('POST', '/api/blindtest/start', { genre: 'jazz' });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const { gameId } = start.body;
  let round = start.body.round;
  let final;
  for (let i = 0; i < 5; i++) {
    assert.equal(round.choices.length, 4);
    // On triche dans le test en lisant la bonne réponse en base.
    const qs = JSON.parse(db.prepare('SELECT questions FROM blindtest_games WHERE id = ?').get(gameId).questions);
    const ans = await call('POST', `/api/blindtest/${gameId}/answer`, { choice: qs[i].answer });
    assert.equal(ans.body.result.correct, true);
    if (ans.body.final) final = ans.body.final;
    else round = (await call('POST', `/api/blindtest/${gameId}/next`)).body.round;
  }
  assert.equal(final.correct, 5);
  assert.equal(final.rewardPacks, 3);
  const st = (await call('GET', '/api/state')).body;
  assert.equal(st.packs.bonus, 5 + 3);
});

test('outils admin', async () => {
  const call = client();
  await call('POST', '/api/auth/login', { identifier: 'alice', password: 'motdepasse123' });
  const r = await call('POST', '/api/packs/open', { count: 10 });
  assert.equal(r.status, 200);
  assert.equal(r.body.cards.length, 50);
  assert.equal(r.body.state.packs.unlimited, true);
  const ov = (await call('GET', '/api/admin/overview')).body;
  assert.ok(ov.users.length >= 4);
  const almost = await call('POST', '/api/admin/me/almost', { albumId: 'thriller' });
  assert.ok(almost.body.missing.startsWith('thriller:'));
  const full = await call('POST', '/api/admin/me/complete');
  assert.ok(full.body.state.achievements.length > 20);

  const player = client();
  await player('POST', '/api/auth/login', { identifier: 'bob', password: 'motdepasse123' });
  assert.equal((await player('GET', '/api/admin/overview')).status, 403);

  // Pochettes : liste publique (même sans compte), état et actualisation réservés à l'admin.
  const guest = client();
  const covers = await guest('GET', '/api/covers');
  assert.equal(covers.status, 200);
  assert.deepEqual(covers.body, { providers: [], items: {}, tracks: {} });
  const st = await call('GET', '/api/admin/covers');
  assert.equal(st.status, 200);
  assert.equal(st.body.mode, 'off');
  assert.equal(st.body.total, 34);
  assert.equal((await call('POST', '/api/admin/covers/refresh')).status, 200);
  assert.equal((await player('GET', '/api/admin/covers')).status, 403);
  assert.equal((await player('POST', '/api/admin/covers/refresh')).status, 403);
});

test('admin réservé à ADMIN_EMAILS : personne d’autre ne peut le devenir', async () => {
  const call = client();
  await register(call, 'mallory@example.com', 'mallory');
  // Même en forçant la colonne role en base, le serveur ne donne pas l'accès.
  db.prepare("UPDATE users SET role = 'admin' WHERE username = 'mallory'").run();
  const st = (await call('GET', '/api/state')).body;
  assert.equal(st.user.role, 'player');
  assert.equal(st.packs.unlimited, false);
  assert.equal((await call('GET', '/api/admin/overview')).status, 403);
  assert.equal((await call('POST', '/api/admin/me/complete')).status, 403);
  assert.equal((await call('POST', '/api/admin/users/1/role', { role: 'admin' })).status, 404, 'plus de changement de rôle');
  const profile = (await call('GET', '/api/users/alice')).body;
  assert.equal(profile.role, 'admin');
});

test('pouvoirs admin : pressage gratuit, promos, toutes les pochettes, réponse du blind test', async () => {
  const call = client();
  await call('POST', '/api/auth/login', { identifier: 'alice', password: 'motdepasse123' });
  await call('POST', '/api/admin/me/reset');
  const before = (await call('GET', '/api/state')).body.user.royalties;
  const press = await call('POST', '/api/collection/press', { trackId: 'promo:hey-jude' });
  assert.equal(press.status, 200, JSON.stringify(press.body));
  assert.equal(press.body.spent, 0);
  assert.equal(press.body.state.user.royalties, before);
  assert.equal((await call('POST', '/api/profile/avatar', { avatar: 'album:abbey-road' })).status, 200);
  const bt = await call('POST', '/api/blindtest/start', { genre: 'rock' });
  assert.ok(bt.body.round.answer, 'l’admin voit la réponse');
  assert.ok(bt.body.round.choices.some((c) => c.id === bt.body.round.answer));
  const player = client();
  await player('POST', '/api/auth/login', { identifier: 'bob', password: 'motdepasse123' });
  const pbt = await player('POST', '/api/blindtest/start', { genre: 'rock' });
  assert.equal(pbt.body.round.answer, undefined, 'un joueur ne voit pas la réponse');
});

test('notes et critiques', async () => {
  const a = client();
  const b = client();
  await a('POST', '/api/auth/login', { identifier: 'carla', password: 'motdepasse123' });
  await b('POST', '/api/auth/login', { identifier: 'dan', password: 'motdepasse123' });
  assert.equal((await a('PUT', '/api/ratings/album/nope', { score: 5 })).body.error, 'unknown_item');
  assert.equal((await a('PUT', '/api/ratings/album/discovery', { score: 11 })).body.error, 'invalid_score');
  assert.equal((await a('PUT', '/api/ratings/album/discovery', { score: 4.5 })).body.error, 'invalid_score');
  assert.equal((await a('PUT', '/api/ratings/album/discovery', { score: 8, review: 'x'.repeat(2001) })).body.error, 'review_too_long');
  const r1 = await a('PUT', '/api/ratings/album/discovery', { score: 9, review: '  Un classique.  ' });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.mine.score, 9);
  assert.equal(r1.body.mine.review, 'Un classique.');
  assert.ok(r1.body.state.ratings.some((x) => x.t === 'album' && x.i === 'discovery' && x.s === 9));
  // Mise à jour plutôt que doublon
  await a('PUT', '/api/ratings/album/discovery', { score: 10, review: 'Chef-d’œuvre.' });
  await b('PUT', '/api/ratings/album/discovery', { score: 6 });
  const track = await a('PUT', `/api/ratings/track/${encodeURIComponent('discovery:01')}`, { score: 0 });
  assert.equal(track.status, 200, JSON.stringify(track.body));
  assert.equal(track.body.mine.score, 0);
  const view = (await b('GET', '/api/ratings/album/discovery')).body;
  assert.equal(view.summary.count, 2);
  assert.equal(view.summary.average, 8);
  assert.equal(view.summary.distribution[10], 1);
  assert.equal(view.summary.distribution[6], 1);
  assert.equal(view.reviews.length, 1, 'une critique écrite par une autre personne');
  assert.equal(view.reviews[0].user.username, 'carla');
  assert.equal(view.reviews[0].friend, false, 'carla et dan ne sont plus amis');
  assert.equal(view.tracks['discovery:01'].count, 1);
  const journal = (await b('GET', '/api/users/carla/ratings')).body;
  assert.equal(journal.stats.count, 2);
  assert.equal(journal.topAlbums[0].id, 'discovery');
  assert.equal(journal.reviews.length, 1);
  // Fil d'activité des amis
  await a('POST', '/api/friends/request', { username: 'dan' });
  const inbox = (await b('GET', '/api/friends')).body;
  await b('POST', `/api/friends/${inbox.incoming[0].requestId}/accept`);
  const feedBody = (await b('GET', '/api/ratings/feed')).body;
  const feed = feedBody.items;
  assert.ok(feed.length >= 2 && feed.every((f) => f.user.username === 'carla'));
  // Les éléments notés arrivent avec leurs données (titre, visuel), sans autre requête.
  assert.ok(feed.every((f) => (f.type === 'album' ? feedBody.catalog.albums : feedBody.catalog.tracks).some((x) => x.id === f.id)));
  // Échelle de notation
  const scale = await b('POST', '/api/profile/settings', { ratingScale: 'points' });
  assert.equal(scale.body.state.user.ratingScale, 'points');
  assert.equal((await b('POST', '/api/profile/settings', { ratingScale: 'emoji' })).body.error, 'invalid_scale');
  // Suppression de sa note
  const del = await b('DELETE', '/api/ratings/album/discovery');
  assert.equal(del.body.mine, null);
  // Modération admin
  const admin = client();
  await admin('POST', '/api/auth/login', { identifier: 'alice', password: 'motdepasse123' });
  const mod = (await admin('GET', '/api/admin/reviews')).body.items;
  const target = mod.find((x) => x.user.username === 'carla' && x.id === 'discovery');
  assert.ok(target);
  const after = await admin('DELETE', `/api/admin/reviews/${target.user.id}/album/discovery`);
  assert.equal(after.status, 200);
  assert.ok(!after.body.items.some((x) => x.user.username === 'carla' && x.id === 'discovery'));
  assert.equal((await b('GET', '/api/admin/reviews')).status, 403);
});

test('adresse réservée par quelqu’un d’autre : le vrai propriétaire la récupère, l’imposteur ne devient jamais admin', async () => {
  const attacker = client();
  const owner = client();
  // L'imposteur crée un compte avec l'adresse admin et son propre mot de passe.
  assert.equal((await attacker('POST', '/api/auth/signup', { email: 'alice2@example.com', username: 'imposteur', password: 'piratepirate' })).status, 201);
  const attackerToken = tokenFrom(lastLink('alice2@example.com'));
  // Le propriétaire clique sur ce lien depuis son propre navigateur : sans le mot de passe, rien ne se passe.
  const noPw = await owner('POST', '/api/auth/verify', { token: attackerToken });
  assert.equal(noPw.status, 401);
  assert.equal(noPw.body.error, 'password_required');
  assert.equal((await owner('POST', '/api/auth/verify', { token: attackerToken, password: 'motdepasse123' })).body.error, 'invalid_credentials');
  // Le propriétaire peut quand même s'inscrire avec son adresse : le compte inachevé est remplacé.
  const reg = await owner('POST', '/api/auth/signup', { email: 'alice2@example.com', username: 'alice2', password: 'motdepasse123' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.equal((await attacker('POST', '/api/auth/verify', { token: attackerToken, password: 'piratepirate' })).body.error, 'invalid_token');
  assert.equal((await attacker('POST', '/api/auth/login', { identifier: 'imposteur', password: 'piratepirate' })).status, 401);
  const ok = await owner('POST', '/api/auth/verify', { token: tokenFrom(lastLink('alice2@example.com')) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.username, 'alice2');
  // Une adresse vérifiée, elle, ne peut plus être reprise.
  assert.equal((await attacker('POST', '/api/auth/signup', { email: 'alice2@example.com', username: 'encoreuntest', password: 'piratepirate' })).body.error, 'email_taken');
});

test('vérifier depuis un autre appareil demande le mot de passe', async () => {
  const laptop = client();
  const phone = client();
  await laptop('POST', '/api/auth/signup', { email: 'zoe@example.com', username: 'zoe', password: 'motdepasse123' });
  const token = tokenFrom(lastLink('zoe@example.com'));
  assert.equal((await phone('POST', '/api/auth/verify', { token })).body.error, 'password_required');
  const ok = await phone('POST', '/api/auth/verify', { token, password: 'motdepasse123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.username, 'zoe');
});

test('identifiants piégés (constructor, __proto__) refusés partout', async () => {
  const call = client();
  await call('POST', '/api/auth/login', { identifier: 'carla', password: 'motdepasse123' });
  for (const path of ['/api/ratings/album/constructor', '/api/ratings/album/__proto__', '/api/ratings/track/toString', '/api/ratings/track/hasOwnProperty']) {
    assert.equal((await call('PUT', path, { score: 3, review: 'x' })).body.error, 'unknown_item', path);
  }
  assert.equal((await call('POST', '/api/collection/press', { trackId: 'constructor' })).body.error, 'unknown_track');
  assert.equal((await call('POST', '/api/profile/avatar', { avatar: 'album:constructor' })).body.error, 'invalid_avatar');
  assert.equal((await call('GET', '/api/users/carla/ratings')).status, 200);
});

test('modération : supprimer une critique garde la note', async () => {
  const author = client();
  const admin = client();
  await author('POST', '/api/auth/login', { identifier: 'dan', password: 'motdepasse123' });
  await author('PUT', '/api/ratings/album/thriller', { score: 7, review: 'Texte à modérer' });
  await admin('POST', '/api/auth/login', { identifier: 'alice', password: 'motdepasse123' });
  const target = (await admin('GET', '/api/admin/reviews')).body.items.find((r) => r.id === 'thriller' && r.user.username === 'dan');
  assert.equal((await admin('DELETE', `/api/admin/reviews/${target.user.id}/album/thriller`)).status, 200);
  const mine = (await author('GET', '/api/ratings/album/thriller')).body.mine;
  assert.equal(mine.score, 7);
  assert.equal(mine.review, null);
});
