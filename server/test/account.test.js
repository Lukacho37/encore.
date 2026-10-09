// Droits sur les données (PLAN.md 4.1.8, chantier P0-F) : export complet (toutes les sections, pièce jointe, 3 par
// jour) ; suppression du compte (mot de passe + pseudo, cascades, compteurs et rating_stats recalculés, journal sans
// donnée personnelle) ; changement de mot de passe et déconnexion des autres appareils.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api, login, PASSWORD } from './helpers.js';

const app = await startApp();
test.after(() => app.close());
const { db } = app;

const call = (who, method, path, body) => api(app.base, typeof who === 'string' ? who : who?.cookie || '', method, path, body);
let counter = 0;
const player = (prefix = 'a') => signupVerified(app, { username: `${prefix}${++counter}_acc` });

const SECTIONS = ['profile', 'settings', 'cards', 'achievements', 'ratings', 'friendships', 'blocks', 'lists', 'posts', 'comments', 'likes',
  'battleVotes', 'quests', 'notifications', 'reportsMade', 'moderationDecisions'];

test('export : toutes les sections, pièce jointe nommée, 3 exports par jour', async () => {
  const me = await player('exp');
  const friend = await player('expf');
  await call(me, 'POST', '/packs/open', { count: 1 });
  await call(me, 'PUT', '/ratings/album/discovery', { score: 9, review: 'Mon export contient ceci' });
  await call(me, 'POST', '/friends/request', { username: friend.username });
  const r = await call(me, 'GET', '/account/export');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), new RegExp(`attachment; filename="albummania-${me.username}-\\d{4}-\\d{2}-\\d{2}\\.json"`));
  for (const key of SECTIONS) assert.ok(key in r.body, `section ${key}`);
  assert.equal(r.body.profile.email, me.email);
  assert.ok(!('password_hash' in r.body.profile) && !JSON.stringify(r.body).includes('scrypt$'), 'jamais le mot de passe');
  assert.ok(r.body.cards.length >= 1);
  assert.equal(r.body.ratings.find((x) => x.itemId === 'discovery').review, 'Mon export contient ceci');
  assert.equal(r.body.friendships[0].username, friend.username);
  assert.equal(r.body.friendships[0].direction, 'sent');
  assert.equal((await call(me, 'GET', '/account/export')).status, 200);
  assert.equal((await call(me, 'GET', '/account/export')).status, 200);
  const fourth = await call(me, 'GET', '/account/export');
  assert.equal(fourth.status, 429);
  assert.equal(fourth.body.kind, 'exports');
  assert.equal((await call(null, 'GET', '/account/export')).status, 401);
});

test('suppression : contrôles, cascades, compteurs et rating_stats recalculés, journal anonyme, session fermée', async () => {
  const gone = await player('gone');
  const stays = await player('stays');
  const now = Date.now();
  // Ce que le compte laisse chez les autres : une note (moyenne), une mention et un commentaire sur la critique d'un autre.
  await call(stays, 'PUT', '/ratings/album/thriller', { score: 4, review: 'La critique qui reste' });
  await call(gone, 'PUT', '/ratings/album/thriller', { score: 10, review: 'Je vais partir' });
  await call(gone, 'PUT', '/ratings/track/thriller:01', { score: 8 });
  const staysReview = db.prepare("SELECT id FROM ratings WHERE user_id = ? AND item_id = 'thriller'").get(stays.user.id).id;
  const goneReview = db.prepare("SELECT id FROM ratings WHERE user_id = ? AND item_id = 'thriller'").get(gone.user.id).id;
  db.prepare("INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, 'review', ?, ?)").run(gone.user.id, staysReview, now);
  db.prepare("INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, 'review', ?, ?)").run(stays.user.id, goneReview, now);
  db.prepare("INSERT INTO comments (target_type, target_id, user_id, body, created_at) VALUES ('review', ?, ?, 'Bravo', ?)").run(staysReview, gone.user.id, now);
  db.prepare('UPDATE ratings SET like_count = 1, comment_count = 1 WHERE id = ?').run(staysReview);
  // Ce qui pointe vers ses contenus : la mention de « stays » et une notification.
  db.prepare("INSERT INTO notifications (user_id, kind, actor_id, target_type, target_id, created_at) VALUES (?, 'like_review', ?, 'review', ?, ?)")
    .run(gone.user.id, stays.user.id, String(goneReview), now);
  db.prepare("INSERT INTO notifications (user_id, kind, actor_id, created_at) VALUES (?, 'friend_accept', ?, ?)").run(stays.user.id, gone.user.id, now);
  // Un signalement fait par le compte (gardé, auteur effacé) et un blocage.
  await call(gone, 'POST', '/reports', { targetType: 'review', targetId: staysReview, reason: 'other' });
  const extra = await player('blocked');
  await call(gone, 'PUT', `/blocks/${extra.user.id}`);
  const before = db.prepare("SELECT count, sum FROM rating_stats WHERE item_type = 'album' AND item_id = 'thriller'").get();
  assert.equal(before.count, 2);

  assert.equal((await call(gone, 'DELETE', '/account', { password: 'mauvais', confirm: gone.username })).body.error, 'wrong_password');
  assert.equal((await call(gone, 'DELETE', '/account', { password: PASSWORD, confirm: 'quelqu_un' })).body.error, 'confirm_mismatch');
  assert.equal((await call(gone, 'DELETE', '/account', {})).body.error, 'password_missing');
  const del = await call(gone, 'DELETE', '/account', { password: PASSWORD, confirm: gone.username.toUpperCase() });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.ok(del.headers.getSetCookie().some((c) => /albummania_sid=;.*Max-Age=0/.test(c)), 'cookie effacé');
  assert.equal((await call(gone, 'GET', '/state')).status, 401, 'session fermée');

  const uid = gone.user.id;
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(uid).n, 0);
  for (const [table, col] of [['ratings', 'user_id'], ['cards', 'user_id'], ['sessions', 'user_id'], ['likes', 'user_id'], ['comments', 'user_id'],
    ['blocks', 'blocker_id'], ['friendships', 'requester_id'], ['notifications', 'user_id'], ['notifications', 'actor_id'], ['pack_openings', 'user_id']]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`).get(uid).n, 0, `${table}.${col}`);
  }
  // Compteurs de la critique qui reste : sa mention et son commentaire sont partis.
  const kept = db.prepare('SELECT like_count, comment_count FROM ratings WHERE id = ?').get(staysReview);
  assert.deepEqual([kept.like_count, kept.comment_count], [0, 0]);
  // La mention de « stays » sur la critique supprimée est retirée (pointeur orphelin).
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM likes WHERE target_type = 'review' AND target_id = ?").get(goneReview).n, 0);
  // rating_stats = recomptage.
  const after = db.prepare("SELECT count, sum FROM rating_stats WHERE item_type = 'album' AND item_id = 'thriller'").get();
  assert.deepEqual([after.count, after.sum], [1, 4]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM rating_stats WHERE item_type = 'track' AND item_id = 'thriller:01'").get().n, 0);
  // Signalement gardé sans auteur ; journal sans donnée personnelle.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id IS NULL AND target_id = ?').get(String(staysReview)).n, 1);
  const audit = db.prepare("SELECT target, payload FROM admin_audit WHERE action = 'account_deleted' ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.target, `user:${uid}`);
  assert.equal(audit.payload, null);
  assert.ok(!JSON.stringify(audit).includes(gone.username));
  // Le pseudo est de nouveau libre.
  const again = await signupVerified(app, { username: gone.username, email: `nouveau_${gone.email}` });
  assert.ok(again.user.id !== uid);
});

test('mot de passe : ancien vérifié, nouveau validé, autres sessions fermées ; déconnexion des autres appareils', async () => {
  const me = await player('pw');
  const other = await login(app, me.username);
  assert.equal((await call(me, 'POST', '/account/password', { current: 'faux', next: 'nouveaumotdepasse' })).body.error, 'wrong_password');
  assert.equal((await call(me, 'POST', '/account/password', { current: PASSWORD, next: 'court' })).body.error, 'password_short');
  const ok = await call(me, 'POST', '/account/password', { current: PASSWORD, next: 'nouveaumotdepasse' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.revoked, 1);
  assert.equal((await call(me, 'GET', '/state')).status, 200, 'cette session reste ouverte');
  assert.equal((await call(other, 'GET', '/state')).status, 401, 'l’autre appareil est déconnecté');
  const third = await login(app, me.username, 'nouveaumotdepasse');
  const revoke = await call(me, 'POST', '/account/sessions/revoke');
  assert.equal(revoke.body.revoked, 1);
  assert.equal((await call(third, 'GET', '/state')).status, 401);
  assert.equal((await call(me, 'GET', '/state')).status, 200);
});
