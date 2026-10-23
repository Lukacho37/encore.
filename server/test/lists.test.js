// Listes et « Mes 9 albums » (PLAN.md 4.2.4, 7.2, chantier P1-C) : matrice de visibilité (amis, privé, blocages dans les
// deux sens, masquage), 250 éléments au plus, remplacement de toutes les positions, doublons, liste d'envies refusée,
// grille unique, synchronisation de l'index de recherche, quotas, politique des liens, listes d'un album, suppression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';
import { LIST_MAX_ITEMS, NOTE_MAX } from '../lists.js';

const app = await startApp();
test.after(() => app.close());
const { db, deps } = app;

let n = 0;
/** Joueur inscrit par l'API (CGU acceptées, adresse confirmée). */
const player = (name) => signupVerified(app, { username: name || `ls_${++n}` });
const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
function befriend(a, b) {
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
    .run(a.user.id, b.user.id, Date.now(), Date.now());
}
const block = (a, b) => call(a, 'PUT', `/blocks/${b.user.id}`);
/** Compte assez ancien et de niveau suffisant pour publier des liens (politique des liens, PLAN.md 7.1). */
const ageAccount = (who) => db.prepare('UPDATE users SET created_at = ?, xp = 5000 WHERE id = ?').run(Date.now() - 3 * 86_400_000, who.user.id);
const albums = db.prepare('SELECT id FROM cat_albums ORDER BY id').all().map((r) => r.id);
const tracks = db.prepare('SELECT id FROM cat_tracks ORDER BY id').all().map((r) => r.id);
const searchDoc = (id) => db.prepare("SELECT 1 FROM search_docs WHERE kind = 'list' AND ref_id = ?").get(String(id));
const positions = (id) => db.prepare('SELECT position, item_type, item_id, note FROM list_items WHERE list_id = ? ORDER BY position').all(id);
const make = (who, body) => call(who, 'POST', '/lists', { title: 'Ma liste', ...body });

test('POST /lists : validation, éléments, réponse { list, description, items, catalog }', async () => {
  const me = await player();
  const r = await make(me, {
    title: '  French Touch   essentielle ', description: 'Les indispensables.\n\n\n\nDans l’ordre.', ranked: true, visibility: 'public',
    items: [{ type: 'album', id: 'discovery', note: 'Le sommet.' }, { type: 'album', id: 'moon-safari' }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const { list, description, items, catalog } = r.body;
  assert.equal(list.title, 'French Touch essentielle');
  assert.equal(description, 'Les indispensables.\n\nDans l’ordre.');
  assert.equal(list.kind, 'list');
  assert.equal(list.itemType, 'album');
  assert.equal(list.ranked, true);
  assert.equal(list.itemCount, 2);
  assert.equal(list.mine, true);
  assert.equal(list.user.username, me.username);
  assert.deepEqual(list.coverAlbumIds, ['discovery', 'moon-safari']);
  assert.deepEqual(items.map((i) => [i.position, i.type, i.id, i.note]), [[0, 'album', 'discovery', 'Le sommet.'], [1, 'album', 'moon-safari', null]]);
  assert.ok(catalog.albums.some((a) => a.id === 'moon-safari'), 'les albums de la liste sont dans `catalog`');

  assert.equal((await make(me, { title: '   ' })).body.error, 'title_required');
  assert.equal((await call(me, 'POST', '/lists', {})).body.error, 'title_required');
  assert.equal((await make(me, { title: 'x'.repeat(101) })).status, 400);
  assert.equal((await make(me, { description: 'x'.repeat(1001) })).status, 400);
  assert.equal((await make(me, { visibility: 'secret' })).status, 400);
  assert.equal((await make(me, { itemType: 'artist' })).status, 400);
  assert.equal((await make(me, { items: [{ type: 'album', id: 'nope' }] })).body.error, 'unknown_item');
  assert.equal((await make(me, { items: [{ type: 'track', id: tracks[0] }] })).body.error, 'wrong_item_type');
  assert.equal((await make(me, { items: [{ type: 'album', id: 'discovery', note: 'x'.repeat(281) }] })).status, 400);
  const dup = await make(me, { items: [{ type: 'album', id: 'discovery' }, { type: 'album', id: 'discovery' }] });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'already_in_list');
  // Liste mixte : albums et morceaux ; pochette d'un morceau = son album.
  const mixed = await make(me, { itemType: 'mixed', items: [{ type: 'track', id: 'discovery:01' }, { type: 'album', id: 'thriller' }] });
  assert.equal(mixed.status, 201, JSON.stringify(mixed.body));
  assert.deepEqual(mixed.body.list.coverAlbumIds, ['discovery', 'thriller']);
  assert.ok(mixed.body.catalog.tracks.some((t) => t.id === 'discovery:01'));
  assert.equal((await call(null, 'POST', '/lists', { title: 'anonyme' })).status, 401);
});

test('visibilité : publique, amis, privée, blocages dans les deux sens, masquée par la modération (404, jamais 403)', async () => {
  const owner = await player();
  const friend = await player();
  const stranger = await player();
  const blocker = await player();
  befriend(owner, friend);
  const ids = {};
  for (const visibility of ['public', 'friends', 'private']) {
    ids[visibility] = (await make(owner, { title: `Liste ${visibility}`, visibility, items: [{ type: 'album', id: 'discovery' }] })).body.list.id;
  }
  const can = async (who, vis) => (await call(who, 'GET', `/lists/${ids[vis]}`)).status;
  assert.deepEqual([await can(owner, 'public'), await can(owner, 'friends'), await can(owner, 'private')], [200, 200, 200]);
  assert.deepEqual([await can(friend, 'public'), await can(friend, 'friends'), await can(friend, 'private')], [200, 200, 404]);
  assert.deepEqual([await can(stranger, 'public'), await can(stranger, 'friends'), await can(stranger, 'private')], [200, 404, 404]);
  // Un ami ne peut pas modifier la liste d'un autre : 404, rien ne fuit.
  assert.equal((await call(friend, 'PATCH', `/lists/${ids.public}`, { title: 'Volée' })).status, 404);
  assert.equal((await call(friend, 'DELETE', `/lists/${ids.public}`)).status, 404);
  assert.equal((await call(friend, 'POST', `/lists/${ids.public}/items`, { type: 'album', id: 'thriller' })).status, 404);

  // Blocage dans un sens puis dans l'autre : plus de lecture ni de listes dans la navigation.
  assert.equal((await block(blocker, owner)).status, 200);
  assert.equal(await can(blocker, 'public'), 404);
  assert.equal(await can(owner, 'public'), 200);
  assert.equal((await call(owner, 'GET', `/lists?owner=${blocker.username}`)).status, 404);
  const popular = (await call(blocker, 'GET', '/lists?owner=popular&limit=50')).body.items;
  assert.ok(!popular.some((l) => l.user.id === owner.user.id), 'les listes d’un joueur bloqué ne sont jamais proposées');
  await block(stranger, owner);
  assert.equal((await call(owner, 'GET', `/lists?owner=${stranger.username}`)).status, 404);

  // Navigation dans les listes d'un joueur : publiques pour tous, « amis » pour les amis, toutes pour lui.
  const titles = async (who) => (await call(who, 'GET', `/lists?owner=${owner.username}`)).body.items.map((l) => l.title).sort();
  assert.deepEqual(await titles(owner), ['Liste friends', 'Liste private', 'Liste public']);
  assert.deepEqual(await titles(friend), ['Liste friends', 'Liste public']);
  const other = await player();
  assert.deepEqual(await titles(other), ['Liste public']);
  // Studio « amis » : les listes ne sont plus montrées aux autres dans son Studio, la liste publique reste lisible.
  db.prepare("UPDATE users SET profile_visibility = 'friends' WHERE id = ?").run(owner.user.id);
  const restricted = await call(other, 'GET', `/lists?owner=${owner.username}`);
  assert.equal(restricted.body.restricted, true);
  assert.deepEqual(restricted.body.items, []);
  assert.deepEqual(await titles(friend), ['Liste friends', 'Liste public']);
  assert.equal(await can(other, 'public'), 200);
  db.prepare("UPDATE users SET profile_visibility = 'public' WHERE id = ?").run(owner.user.id);

  // Masquée par la modération : seul son propriétaire la lit encore, avec `moderated`.
  deps.moderation.act(null, { targetType: 'list', targetId: ids.public, action: 'hide', ground: 'rules:spam', statement: 'Spam.' });
  assert.equal(await can(other, 'public'), 404);
  const mine = await call(owner, 'GET', `/lists/${ids.public}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.list.moderated, true);
  assert.ok(!(await call(other, 'GET', '/lists?owner=popular&limit=50')).body.items.some((l) => l.id === ids.public));
});

test('250 éléments au plus, remplacement de toutes les positions, notes gardées, retrait qui resserre', async () => {
  const me = await player();
  const id = (await make(me, { itemType: 'track' })).body.list.id;
  const many = tracks.slice(0, 251).map((t) => ({ type: 'track', id: t }));
  assert.equal(many.length, 251);
  const full = await call(me, 'PUT', `/lists/${id}/items`, { items: many });
  assert.equal(full.status, 409);
  assert.equal(full.body.error, 'list_full');
  const ok = await call(me, 'PUT', `/lists/${id}/items`, { items: many.slice(0, 250) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 300));
  assert.equal(ok.body.list.itemCount, 250);
  assert.equal(ok.body.items.length, 250);
  const more = await call(me, 'POST', `/lists/${id}/items`, { type: 'track', id: tracks[251] });
  assert.equal(more.status, 409);
  assert.equal(more.body.error, 'list_full');

  // Remplacement : nouvel ordre, notes, positions 0..n-1, date d'ajout gardée pour un élément déjà là.
  const list = (await make(me, { items: albums.slice(0, 4).map((a) => ({ type: 'album', id: a })) })).body.list.id;
  db.prepare('UPDATE list_items SET added_at = 1000 WHERE list_id = ?').run(list);
  const order = [albums[3], albums[0], albums[5], albums[1]];
  const r = await call(me, 'PUT', `/lists/${list}/items`, { items: order.map((a, i) => ({ type: 'album', id: a, note: i === 0 ? 'Premier' : null })) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(positions(list).map((p) => [p.position, p.item_id, p.note]), order.map((a, i) => [i, a, i === 0 ? 'Premier' : null]));
  const added = new Map(db.prepare('SELECT item_id, added_at FROM list_items WHERE list_id = ?').all(list).map((x) => [x.item_id, x.added_at]));
  assert.equal(added.get(albums[3]), 1000);
  assert.ok(added.get(albums[5]) > 1000, 'un nouvel élément prend la date du jour');
  assert.equal(db.prepare('SELECT item_count FROM lists WHERE id = ?').get(list).item_count, 4);
  // Doublon dans un remplacement, ou dans un ajout.
  assert.equal((await call(me, 'PUT', `/lists/${list}/items`, { items: [{ type: 'album', id: albums[0] }, { type: 'album', id: albums[0] }] })).body.error, 'already_in_list');
  assert.equal((await call(me, 'POST', `/lists/${list}/items`, { type: 'album', id: albums[0] })).body.error, 'already_in_list');
  assert.equal((await call(me, 'PUT', `/lists/${list}/items`, { items: 'nope' })).status, 400);
  // Ajout à la fin, puis retrait au milieu : les positions se resserrent.
  const add = await call(me, 'POST', `/lists/${list}/items`, { type: 'album', id: albums[7], note: 'Ajouté' });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.equal(add.body.list.itemCount, 5);
  assert.deepEqual(add.body.item, { type: 'album', id: albums[7], note: 'Ajouté' });
  const rm = await call(me, 'DELETE', `/lists/${list}/items/album/${albums[0]}`);
  assert.equal(rm.status, 200);
  assert.equal(rm.body.list.itemCount, 4);
  assert.deepEqual(positions(list).map((p) => [p.position, p.item_id]), [[0, albums[3]], [1, albums[5]], [2, albums[1]], [3, albums[7]]]);
  assert.equal((await call(me, 'DELETE', `/lists/${list}/items/album/${albums[0]}`)).status, 404);
  // PATCH : titre, description, classement, visibilité.
  const p = await call(me, 'PATCH', `/lists/${list}`, { title: 'Nouveau titre', description: '', ranked: false, visibility: 'friends' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.list.title, 'Nouveau titre');
  assert.equal(p.body.description, null);
  assert.equal(p.body.list.visibility, 'friends');
  assert.equal((await call(me, 'PATCH', `/lists/${list}`, { title: '' })).body.error, 'title_required');
});

test('une liste pleine s’enregistre d’un bloc : 250 éléments avec des notes de 280 caractères (sans 413)', async () => {
  const me = await player();
  // Le pire cas : 280 caractères de 4 octets chacun en UTF-8, soit ~290 ko pour la liste entière.
  const note = '🎶'.repeat(NOTE_MAX);
  const items = tracks.slice(0, LIST_MAX_ITEMS).map((t) => ({ type: 'track', id: t, note }));
  const created = await make(me, { itemType: 'track', items });
  assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 200));
  assert.equal(created.body.list.itemCount, LIST_MAX_ITEMS);
  // L'éditeur renvoie toute la liste dans un nouvel ordre, notes comprises.
  const id = created.body.list.id;
  const reordered = await call(me, 'PUT', `/lists/${id}/items`, { items: [...items].reverse() });
  assert.equal(reordered.status, 200, JSON.stringify(reordered.body).slice(0, 200));
  assert.equal(positions(id)[0].item_id, items[LIST_MAX_ITEMS - 1].id);
  assert.equal(positions(id)[0].note, note);
  // Au-delà, et sur les autres routes (32 ko), la limite reste.
  assert.equal((await call(me, 'PUT', `/lists/${id}/items`, { items, pad: 'x'.repeat(400_000) })).body.error, 'payload_too_large');
  assert.equal((await call(me, 'PATCH', `/lists/${id}`, { title: 'x', pad: 'x'.repeat(40_000) })).body.error, 'payload_too_large');
  assert.equal((await call(me, 'POST', '/posts', { body: 'x'.repeat(40_000) })).body.error, 'payload_too_large');
});

test('liste d’envies refusée par les routes génériques ; grille réservée à sa route', async () => {
  const me = await player();
  const other = await player();
  assert.equal((await call(me, 'PUT', '/me/wishlist/discovery')).status, 200);
  const wish = db.prepare("SELECT id FROM lists WHERE user_id = ? AND kind = 'wishlist'").get(me.user.id).id;
  assert.equal((await call(me, 'GET', `/lists/${wish}`)).body.error, 'use_wishlist_route');
  assert.equal((await call(me, 'GET', `/lists/${wish}`)).status, 403);
  assert.equal((await call(other, 'GET', `/lists/${wish}`)).status, 404, 'les autres ne savent même pas qu’elle existe');
  assert.equal((await call(me, 'PATCH', `/lists/${wish}`, { title: 'x' })).body.error, 'use_wishlist_route');
  assert.equal((await call(me, 'PUT', `/lists/${wish}/items`, { items: [] })).body.error, 'use_wishlist_route');
  assert.equal((await call(me, 'POST', `/lists/${wish}/items`, { type: 'album', id: 'thriller' })).body.error, 'use_wishlist_route');
  assert.equal((await call(me, 'DELETE', `/lists/${wish}`)).body.error, 'use_wishlist_route');
  assert.ok(!(await call(me, 'GET', '/lists?owner=me')).body.items.some((l) => l.id === wish));

  await call(me, 'PUT', '/me/grid9', { slots: ['discovery'] });
  const grid = db.prepare("SELECT id FROM lists WHERE user_id = ? AND kind = 'grid9'").get(me.user.id).id;
  assert.equal((await call(me, 'POST', `/lists/${grid}/items`, { type: 'album', id: 'thriller' })).body.error, 'use_grid9_route');
  assert.equal((await call(me, 'PUT', `/lists/${grid}/items`, { items: [] })).body.error, 'use_grid9_route');
  // Lisible par son adresse (visibilité), renommable par PATCH.
  assert.equal((await call(other, 'GET', `/lists/${grid}`)).body.list.kind, 'grid9');
  assert.equal((await call(me, 'PATCH', `/lists/${grid}`, { title: 'Mes essentiels' })).body.list.title, 'Mes essentiels');
});

test('« Mes 9 albums » : ligne unique créée à la première sauvegarde, cases vides, validation, lecture, setGrid9', async () => {
  const me = await player();
  const empty = await call(me, 'GET', '/me/grid9');
  assert.equal(empty.status, 200);
  assert.equal(empty.body.list, null);
  assert.equal(empty.body.title, 'Mes 9 albums');
  assert.deepEqual(empty.body.slots, Array(9).fill(null));

  const slots = ['discovery', null, 'thriller', null, null, 'abbey-road', null, null, 'nevermind'];
  const r = await call(me, 'PUT', '/me/grid9', { title: 'Mes 9 de toujours', slots });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.slots, slots);
  assert.equal(r.body.title, 'Mes 9 de toujours');
  assert.equal(r.body.list.kind, 'grid9');
  assert.equal(r.body.list.itemCount, 4);
  assert.ok(r.body.catalog.albums.some((a) => a.id === 'abbey-road'));
  const row = db.prepare("SELECT id FROM lists WHERE user_id = ? AND kind = 'grid9'").get(me.user.id);
  assert.deepEqual(positions(row.id).map((p) => [p.position, p.item_id]), [[0, 'discovery'], [2, 'thriller'], [5, 'abbey-road'], [8, 'nevermind']]);

  // Deuxième sauvegarde (échange de cases) : toujours une seule ligne ; titre absent → gardé.
  const swapped = ['thriller', null, 'discovery', null, null, 'abbey-road', null, null, 'nevermind'];
  assert.deepEqual((await call(me, 'PUT', '/me/grid9', { slots: swapped })).body.slots, swapped);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lists WHERE user_id = ? AND kind = 'grid9'").get(me.user.id).n, 1);
  assert.equal((await call(me, 'GET', '/me/grid9')).body.title, 'Mes 9 de toujours');
  assert.throws(() => db.prepare("INSERT INTO lists (user_id, kind, title, created_at, updated_at) VALUES (?, 'grid9', 'x', 1, 1)").run(me.user.id), /UNIQUE/);

  assert.equal((await call(me, 'PUT', '/me/grid9', { slots: Array(10).fill(null) })).status, 400);
  assert.equal((await call(me, 'PUT', '/me/grid9', { slots: ['nope'] })).body.error, 'unknown_item');
  assert.equal((await call(me, 'PUT', '/me/grid9', { slots: ['discovery', 'discovery'] })).body.error, 'already_in_list');
  assert.equal((await call(me, 'PUT', '/me/grid9', {})).status, 400);

  // Lecture : un autre joueur, un ami de Studio fermé, un joueur bloqué.
  const other = await player();
  const read = await call(other, 'GET', `/users/${me.username}/grid9`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.slots, swapped);
  assert.equal(read.body.user.username, me.username);
  assert.equal(read.body.list.mine, undefined);
  db.prepare("UPDATE users SET profile_visibility = 'private' WHERE id = ?").run(me.user.id);
  const closed = await call(other, 'GET', `/users/${me.username}/grid9`);
  assert.equal(closed.body.restricted, true);
  assert.deepEqual(closed.body.slots, Array(9).fill(null));
  assert.deepEqual((await call(me, 'GET', `/users/${me.username}/grid9`)).body.slots, swapped, 'le joueur voit toujours sa grille');
  db.prepare("UPDATE users SET profile_visibility = 'public' WHERE id = ?").run(me.user.id);
  await call(me, 'PATCH', `/lists/${row.id}`, { visibility: 'private' });
  assert.equal((await call(other, 'GET', `/users/${me.username}/grid9`)).body.list, null);
  await block(other, me);
  assert.equal((await call(other, 'GET', `/users/${me.username}/grid9`)).status, 404);
  assert.equal((await call(me, 'GET', `/users/${other.username}/grid9`)).status, 404);

  // API interne (onboarding) : inconnus et doublons ignorés, 9 au plus.
  const newbie = await player();
  const set = deps.lists.setGrid9(newbie.user.id, ['moon-safari', 'nope', 'moon-safari', 'thriller', ...albums]);
  assert.equal(set.slots[0], 'moon-safari');
  assert.equal(set.slots[1], null);
  assert.equal(set.slots[3], 'thriller');
  assert.equal(set.slots.length, 9);
  assert.equal(deps.lists.grid9Of(newbie.user.id).row.kind, 'grid9');
});

test('« Mes 9 albums » suit le Studio : fermé, la grille ne se lit nulle part (adresse, J’aime, commentaires, posts, recherche)', async () => {
  const me = await player();
  const friend = await player();
  const stranger = await player();
  befriend(me, friend);
  await call(me, 'PUT', '/me/grid9', { title: 'Ma grille zorglub', slots: ['discovery', 'thriller'] });
  const id = db.prepare("SELECT id FROM lists WHERE user_id = ? AND kind = 'grid9'").get(me.user.id).id;
  const suggest = async (who) => JSON.stringify((await call(who, 'GET', '/search/suggest?q=zorglub&scope=list')).body).includes('Ma grille zorglub');
  assert.ok(searchDoc(id), 'Studio public : la grille est indexée');
  assert.equal(await suggest(stranger), true);

  const setPrivacy = (visibility) => call(me, 'PUT', '/me/profile', { visibility });
  assert.equal((await setPrivacy('private')).status, 200);
  assert.ok(!searchDoc(id), 'Studio privé : la grille sort de l’index');
  assert.equal(await suggest(stranger), false);
  for (const who of [stranger, friend]) {
    assert.equal((await call(who, 'GET', `/lists/${id}`)).status, 404);
    assert.equal((await call(who, 'PUT', `/likes/list/${id}`)).status, 404);
    assert.equal((await call(who, 'POST', '/comments', { targetType: 'list', targetId: id, body: 'Belle grille' })).status, 404);
    assert.equal((await call(who, 'POST', '/posts', { body: 'Regardez', item: { type: 'list', id } })).status, 404);
    assert.equal(deps.lists.summaries(who.user.id, [id]).size, 0, 'pas de résumé (fil, Studio, posts)');
    assert.equal(deps.social.listSummaries(who.user.id, [id]).size, 0);
  }
  assert.equal((await call(me, 'GET', `/lists/${id}`)).status, 200, 'le joueur lit toujours sa grille');

  // Studio « amis » : les amis la lisent, pas les autres ; la recherche (contenus publics) ne la montre à personne.
  await setPrivacy('friends');
  assert.equal((await call(friend, 'GET', `/lists/${id}`)).status, 200);
  assert.equal((await call(friend, 'PUT', `/likes/list/${id}`)).status, 200);
  assert.equal((await call(stranger, 'GET', `/lists/${id}`)).status, 404);
  assert.ok(!searchDoc(id));

  // Studio rouvert : la grille revient partout, l’index compris.
  await setPrivacy('public');
  assert.ok(searchDoc(id), 'Studio rouvert : la grille revient dans l’index');
  assert.equal((await call(stranger, 'GET', `/lists/${id}`)).status, 200);
  assert.equal((await call(stranger, 'POST', '/comments', { targetType: 'list', targetId: id, body: 'Belle grille' })).status, 201);
  // Une liste ordinaire publique reste lisible par son adresse quel que soit le Studio (comme une critique).
  const plain = (await make(me, { title: 'Liste ouverte', items: [{ type: 'album', id: 'discovery' }] })).body.list.id;
  await setPrivacy('private');
  assert.equal((await call(stranger, 'GET', `/lists/${plain}`)).status, 200);
  assert.ok(searchDoc(plain));
});

test('index de recherche : liste publique indexée, privée, masquée ou supprimée retirée (list.saved, content.removed)', async () => {
  const me = await player();
  const id = (await make(me, { title: 'Nuits électriques', items: [{ type: 'album', id: 'discovery' }] })).body.list.id;
  assert.ok(searchDoc(id), 'liste publique indexée dès sa création');
  const found = await call(me, 'GET', `/search/suggest?q=${encodeURIComponent('nuits electriques')}&scope=list`);
  assert.equal(found.status, 200);
  assert.ok(JSON.stringify(found.body).includes('Nuits électriques'), JSON.stringify(found.body).slice(0, 300));
  await call(me, 'PATCH', `/lists/${id}`, { visibility: 'private' });
  assert.ok(!searchDoc(id), 'liste privée retirée');
  await call(me, 'PATCH', `/lists/${id}`, { visibility: 'public' });
  assert.ok(searchDoc(id));
  deps.moderation.act(null, { targetType: 'list', targetId: id, action: 'hide', ground: 'rules:spam', statement: 'Spam.' });
  assert.ok(!searchDoc(id), 'liste masquée retirée');
  const other = (await make(me, { title: 'Pluie de juin' })).body.list.id;
  assert.ok(searchDoc(other));
  assert.equal((await call(me, 'DELETE', `/lists/${other}`)).status, 200);
  assert.ok(!searchDoc(other), 'liste supprimée retirée');
  assert.equal((await call(me, 'GET', `/lists/${other}`)).status, 404);
});

test('quota quotidien (429), 200 listes au plus (409), compte suspendu (403), politique des liens', async () => {
  const me = await player();
  const ins = db.prepare("INSERT INTO lists (user_id, kind, title, created_at, updated_at) VALUES (?, 'list', ?, ?, ?)");
  for (let i = 0; i < 20; i++) ins.run(me.user.id, `liste ${i}`, Date.now(), Date.now());
  const q = await make(me);
  assert.equal(q.status, 429);
  assert.equal(q.body.error, 'quota_exceeded');
  assert.equal(q.body.kind, 'lists');

  const many = await player();
  const old = Date.now() - 3 * 86_400_000;
  for (let i = 0; i < 200; i++) ins.run(many.user.id, `ancienne ${i}`, old, old);
  const r = await make(many);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'too_many_lists');
  // La grille et la liste d'envies ne comptent pas.
  assert.equal((await call(many, 'PUT', '/me/grid9', { slots: ['discovery'] })).status, 200);

  const sus = await player();
  db.prepare('UPDATE users SET suspended_until = ? WHERE id = ?').run(Date.now() + 86_400_000, sus.user.id);
  assert.equal((await make(sus)).body.error, 'suspended');
  assert.equal((await call(sus, 'PUT', '/me/grid9', { slots: [] })).body.error, 'suspended');

  // Liens : compte récent refusé ; compte ancien : lien hors liste blanche retiré, lien autorisé gardé.
  const young = await player();
  assert.equal((await make(young, { description: 'Écoute https://www.deezer.com/album/1' })).body.error, 'links_not_allowed');
  ageAccount(young);
  const kept = await make(young, { description: 'Écoute https://www.deezer.com/album/1 et https://pirate.example/x', items: [{ type: 'album', id: 'discovery', note: 'Vu sur https://pirate.example/y' }] });
  assert.equal(kept.status, 201, JSON.stringify(kept.body));
  assert.match(kept.body.description, /deezer\.com\/album\/1/);
  assert.doesNotMatch(kept.body.description, /pirate/);
  assert.doesNotMatch(kept.body.items[0].note, /pirate/);
});

test('navigation : mes listes, amis, populaires ; pagination par curseur stable', async () => {
  const me = await player();
  const friend = await player();
  befriend(me, friend);
  for (let i = 0; i < 5; i++) await make(friend, { title: `Ami ${i}`, items: [{ type: 'album', id: albums[i] }] });
  await make(friend, { title: 'Ami vide' });
  await make(friend, { title: 'Ami privée', visibility: 'private', items: [{ type: 'album', id: 'discovery' }] });
  const page1 = await call(me, 'GET', '/lists?owner=friends&limit=2');
  assert.equal(page1.status, 200);
  assert.equal(page1.body.items.length, 2);
  assert.ok(page1.body.nextCursor);
  const seen = [...page1.body.items.map((l) => l.title)];
  let cursor = page1.body.nextCursor;
  while (cursor) {
    const p = await call(me, 'GET', `/lists?owner=friends&limit=2&cursor=${cursor}`);
    seen.push(...p.body.items.map((l) => l.title));
    cursor = p.body.nextCursor;
  }
  assert.deepEqual(seen, ['Ami 4', 'Ami 3', 'Ami 2', 'Ami 1', 'Ami 0'], 'les plus récentes d’abord, ni vide ni privée, sans doublon');
  assert.equal((await call(me, 'GET', '/lists?owner=friends&cursor=%%%')).status, 400);

  // Populaires : par nombre de « J'aime ».
  const liked = (await make(me, { title: 'Très aimée', items: [{ type: 'album', id: 'discovery' }] })).body.list.id;
  db.prepare('UPDATE lists SET like_count = 999 WHERE id = ?').run(liked);
  const pop = await call(friend, 'GET', '/lists?owner=popular&limit=3');
  assert.equal(pop.body.items[0].id, liked);
  // Mes listes : même vides.
  const mine = await call(friend, 'GET', '/lists?owner=me&limit=50');
  assert.ok(mine.body.items.some((l) => l.title === 'Ami vide'));
  assert.equal((await call(me, 'GET', '/lists?owner=personne_ici')).status, 404);
});

test('page d’une liste : commentaires et « J’aime » (social.js), suppression qui purge tout', async () => {
  const owner = await player();
  const fan = await player();
  ageAccount(owner);
  const id = (await make(owner, { title: 'À commenter', items: [{ type: 'album', id: 'discovery' }] })).body.list.id;
  const c = await call(fan, 'POST', '/comments', { targetType: 'list', targetId: id, body: 'Belle liste !' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal((await call(fan, 'PUT', `/likes/list/${id}`)).status, 200);
  const page = await call(fan, 'GET', `/lists/${id}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.list.likeCount, 1);
  assert.equal(page.body.list.liked, true);
  assert.equal(page.body.list.commentCount, 1);
  assert.equal(page.body.list.mine, false);
  assert.equal(page.body.comments.items[0].body, 'Belle liste !');
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND target_type = 'list'").get(owner.user.id), 'le propriétaire est prévenu');

  assert.equal((await call(owner, 'DELETE', `/lists/${id}`)).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM comments WHERE target_type = 'list' AND target_id = ?").get(id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM likes WHERE target_type = 'list' AND target_id = ?").get(id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE target_type = 'list' AND target_id = ?").get(String(id)).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM list_items WHERE list_id = ?').get(id).n, 0);
  assert.equal((await call(fan, 'GET', `/lists/${id}`)).status, 404);
});

test('listes qui contiennent un album : amis d’abord, visibilité, grilles des Studios publics, curseur', async () => {
  const me = await player();
  const friend = await player();
  const stranger = await player();
  const blocked = await player();
  befriend(me, friend);
  const album = 'kind-of-blue';
  const item = [{ type: 'album', id: album }];
  const s1 = (await make(stranger, { title: 'Jazz 1', items: item })).body.list.id;
  const s2 = (await make(stranger, { title: 'Jazz 2', items: item })).body.list.id;
  await make(stranger, { title: 'Jazz privé', visibility: 'private', items: item });
  await make(stranger, { title: 'Jazz amis', visibility: 'friends', items: item });
  const f1 = (await make(friend, { title: 'Jazz de mon ami', visibility: 'friends', items: item })).body.list.id;
  await make(blocked, { title: 'Jazz bloqué', items: item });
  await block(me, blocked);
  await call(stranger, 'PUT', '/me/grid9', { slots: [album] });
  const grid = db.prepare("SELECT id FROM lists WHERE user_id = ? AND kind = 'grid9'").get(stranger.user.id).id;

  const r = await call(me, 'GET', `/items/album/${album}/lists?limit=2`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.items[0].id, f1, 'la liste de l’ami passe en tête');
  const all = [...r.body.items];
  let cursor = r.body.nextCursor;
  while (cursor) {
    const p = await call(me, 'GET', `/items/album/${album}/lists?limit=2&cursor=${cursor}`);
    all.push(...p.body.items);
    cursor = p.body.nextCursor;
  }
  const got = all.map((l) => l.id);
  assert.equal(new Set(got).size, got.length, 'pas de doublon entre les pages');
  assert.deepEqual(new Set(got), new Set([f1, grid, s2, s1]));
  assert.ok(!all.some((l) => /privé|amis|bloqué/.test(l.title)));
  // Studio privé : sa grille sort de la liste ; album inconnu : 404.
  db.prepare("UPDATE users SET profile_visibility = 'private' WHERE id = ?").run(stranger.user.id);
  assert.ok(!(await call(me, 'GET', `/items/album/${album}/lists?limit=50`)).body.items.some((l) => l.id === grid));
  assert.equal((await call(me, 'GET', '/items/album/nope/lists')).body.error, 'unknown_item');
});

test('performance : les requêtes chaudes passent par leurs index (lists_popular, lists_user, list_items_item)', () => {
  const plan = (sql, ...args) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(' | ');
  const popular = plan(`SELECT id FROM lists WHERE visibility = 'public' AND hidden_at IS NULL AND kind = 'list' AND item_count > 0
    AND user_id NOT IN (SELECT value FROM json_each('[]')) ORDER BY like_count DESC, id DESC LIMIT 21`);
  assert.match(popular, /lists_popular/, popular);
  const mine = plan("SELECT id FROM lists WHERE user_id = 1 AND kind = 'list' ORDER BY updated_at DESC, id DESC LIMIT 21");
  assert.match(mine, /lists_user/, mine);
  const byAlbum = plan(`SELECT l.id FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.item_type = 'album' AND li.item_id = 'discovery'
    AND li.list_id < 99999 ORDER BY li.list_id DESC LIMIT 11`);
  assert.match(byAlbum, /list_items_item/, byAlbum);
  assert.doesNotMatch(byAlbum, /SCAN li\b/, byAlbum);
});
