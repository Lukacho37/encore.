// Notifications (PLAN.md 4.1.7, chantier P0-F) : regroupement (« Camille et 3 autres… »), pastille des non lues,
// jamais à soi-même ni à travers un blocage, plafond par groupe, demandes d'ami, lecture, pages, rétention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';

const app = await startApp();
test.after(() => app.close());
const { db, deps } = app;

const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
const enc = encodeURIComponent;
let counter = 0;
const player = (prefix = 'n') => signupVerified(app, { username: `${prefix}${++counter}_ntf` });
/** Joueur vérifié créé en base (acteurs en nombre). */
function bot(name) {
  const now = Date.now();
  return db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at)
    VALUES (?, ?, 'x', ?, ?, ?) RETURNING id`).get(`${name}@example.com`, name, now, now, now).id;
}
const list = async (who, qs = '') => (await call(who, 'GET', `/notifications${qs}`)).body;

test('regroupement : « Camille et 3 autres », trois acteurs au plus, une seule pastille, groupé aussi une fois lu', async () => {
  const me = await player('me');
  const actors = ['camille', 'leo', 'sam', 'ines'].map((n) => bot(`${n}_grp`));
  for (const a of actors) deps.notify(me.user.id, 'like_review', { actorId: a, targetType: 'review', targetId: 42, groupKey: 'like_review:42', data: { itemType: 'album', itemId: 'discovery' } });
  deps.notify(me.user.id, 'like_review', { actorId: actors[0], targetType: 'review', targetId: 42, groupKey: 'like_review:42', data: { itemType: 'album', itemId: 'discovery' } });
  deps.notify(me.user.id, 'friend_accept', { actorId: actors[1], targetType: 'user', targetId: actors[1] });
  const body = await list(me);
  assert.equal(body.unread, 2, 'deux groupes non lus');
  const group = body.items.find((n) => n.kind === 'like_review');
  assert.equal(group.actorCount, 4, 'acteurs distincts');
  assert.equal(group.actors.length, 3);
  assert.equal(group.actors[0].username, 'camille_grp', 'le plus récent d’abord');
  assert.equal(group.count, 5);
  assert.equal(group.read, false);
  assert.deepEqual(group.target, { type: 'review', id: '42' });
  assert.ok(body.catalog.albums.some((a) => a.id === 'discovery'));
  const accept = body.items.find((n) => n.kind === 'friend_accept');
  assert.equal(accept.target.username, 'leo_grp');
  assert.equal((await call(me, 'GET', '/state')).body.counts.unread, 2);

  // Lire le groupe (par l'identifiant renvoyé) : toutes ses lignes passent en lues et restent groupées.
  const read = await call(me, 'POST', '/notifications/read', { ids: [group.id] });
  assert.equal(read.status, 200);
  assert.equal(read.body.unread, 1);
  assert.equal(read.body.state.partial, true);
  assert.equal(read.body.state.counts.unread, 1, 'état partiel : pastille à jour');
  const after = await list(me);
  const readGroup = after.items.find((n) => n.kind === 'like_review');
  assert.equal(readGroup.read, true);
  assert.equal(readGroup.actorCount, 4);
  assert.equal(after.items[0].read, false, 'non lues d’abord');
  // Tout lire.
  assert.equal((await call(me, 'POST', '/notifications/read', { all: true })).body.unread, 0);
  const unread = await call(me, 'GET', '/notifications/unread');
  assert.equal(unread.body.unread, 0);
  assert.equal(unread.body.state.counts.unread, 0);
});

test('jamais à soi-même, jamais à travers un blocage ; un acteur bloqué ensuite disparaît de la liste', async () => {
  const me = await player('solo');
  const other = await player('other');
  assert.equal(deps.notify(me.user.id, 'like_review', { actorId: me.user.id, targetType: 'review', targetId: 1 }), null);
  assert.equal(deps.notify(999999, 'like_review', { actorId: other.user.id }), null, 'destinataire inconnu');
  const id = deps.notify(me.user.id, 'like_review', { actorId: other.user.id, targetType: 'review', targetId: 7, groupKey: 'like_review:7' });
  assert.ok(Number.isInteger(id));
  await call(me, 'PUT', `/blocks/${other.user.id}`);
  assert.equal((await list(me)).items.length, 0, 'le blocage efface les notifications entre les deux');
  assert.equal(deps.notify(me.user.id, 'like_review', { actorId: other.user.id, targetType: 'review', targetId: 7 }), null);
  assert.equal(deps.notify(other.user.id, 'like_review', { actorId: me.user.id, targetType: 'review', targetId: 8 }), null, 'dans les deux sens');
  // Notification système (sans acteur) : toujours permise.
  assert.ok(deps.notify(me.user.id, 'terms_updated', { groupKey: 'terms' }));
});

test('demandes d’ami : notification avec « Accepter » tant qu’elle est en attente, puis « a accepté » chez l’autre', async () => {
  const a = await player('ask');
  const b = await player('ans');
  await call(a, 'POST', '/friends/request', { username: b.username });
  let items = (await list(b)).items;
  const req = items.find((n) => n.kind === 'friend_request');
  assert.ok(req, 'notification de demande');
  assert.equal(req.actors[0].username, a.username);
  assert.equal(req.data.pending, true);
  assert.equal(req.target.username, a.username);
  assert.equal((await call(b, 'GET', '/state')).body.counts.unread, 1);
  const incoming = (await call(b, 'GET', '/friends')).body.incoming[0];
  await call(b, 'POST', `/friends/${incoming.requestId}/accept`);
  items = (await list(b)).items;
  const done = items.find((n) => n.kind === 'friend_request');
  assert.equal(done.data.pending, false);
  assert.equal(done.read, true, 'acceptée : la notification passe en lue');
  const accepted = (await list(a)).items.find((n) => n.kind === 'friend_accept');
  assert.equal(accepted.actors[0].username, b.username);
});

test('plafond : 50 non lues par groupe ; pastille plafonnée à 99 groupes', async () => {
  const me = await player('cap');
  const actor = bot('cap_actor');
  for (let i = 0; i < 55; i++) deps.notify(me.user.id, 'like_post', { actorId: actor, targetType: 'post', targetId: 1, groupKey: 'like_post:1' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND group_key = 'like_post:1' AND read_at IS NULL").get(me.user.id).n, 50);
  for (let i = 0; i < 110; i++) deps.notify(me.user.id, 'like_post', { actorId: actor, targetType: 'post', targetId: 100 + i, groupKey: `like_post:${100 + i}` });
  assert.equal(deps.notifications.unreadCount(me.user.id), 99);
});

test('pages : 20 groupes par page, curseur, sans doublon', async () => {
  const me = await player('pages');
  const actor = bot('pages_actor');
  for (let i = 0; i < 25; i++) deps.notify(me.user.id, 'like_list', { actorId: actor, targetType: 'list', targetId: i + 1, groupKey: `like_list:${i + 1}` });
  const first = await list(me);
  assert.equal(first.items.length, 20);
  assert.ok(first.nextCursor);
  const second = await list(me, `?cursor=${enc(first.nextCursor)}`);
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, null);
  const ids = [...first.items, ...second.items].map((n) => n.id);
  assert.equal(new Set(ids).size, 25);
  assert.equal((await call(me, 'GET', '/notifications?cursor=%%%')).status, 400);
  assert.equal((await call(null, 'GET', '/notifications')).status, 401);
});

test('tâche purge-notifications : lues après 90 jours, non lues après 180 jours', async () => {
  const me = await player('purge');
  const old = Date.now() - 100 * 86_400_000;
  const veryOld = Date.now() - 200 * 86_400_000;
  const ins = db.prepare("INSERT INTO notifications (user_id, kind, created_at, read_at) VALUES (?, 'terms_updated', ?, ?)");
  ins.run(me.user.id, old, old); // lue, 100 jours → supprimée
  ins.run(me.user.id, old, null); // non lue, 100 jours → gardée
  ins.run(me.user.id, veryOld, null); // non lue, 200 jours → supprimée
  const result = await app.jobs.runJob('purge-notifications');
  assert.ok(result.read >= 1 && result.unread >= 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(me.user.id).n, 1);
});
