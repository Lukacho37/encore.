import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.FIRST_USER_ADMIN = 'true';
process.env.BLINDTEST_AUDIO = 'off';
const { createApp } = await import('../app.js');
const { TRACKS_BY_ALBUM } = await import('../../shared/catalog.js');

const { app, db } = createApp({ dbFile: ':memory:' });
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Encore': '1', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
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
  assert.equal((await call('POST', '/api/auth/signup', { email: 'alice@example.com', username: 'alice2', password: 'motdepasse123' })).body.error, 'email_taken');
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
  assert.equal(v.body.user.role, 'admin', 'premier compte = admin en test');
  assert.equal(v.body.packs.bonus, 5);

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
});
