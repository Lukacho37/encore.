// Studio (PLAN.md 2.5, 4.2.3, 7.2, chantier P1-B) : matrice de confidentialité (public, amis, privé, blocages dans les
// deux sens), compatibilité avec le profil de P0, validation des blocs, favoris (5 au plus), cosmétique verrouillé
// (409), bio (longueur, liens, suspension), vinyle mis en avant et listes épinglées, réponse bornée pour un gros
// collectionneur et étagère complète par curseur, plans de requêtes sans parcours complet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';
import { BLOCK_IDS as CLIENT_BLOCK_IDS } from '../../client/src/components/studio/blocks.js';
import { BLOCK_IDS, blocksOf } from '../studio.js';

const app = await startApp();
test.after(() => app.close());
const { db } = app;

let n = 0;
const player = (name) => signupVerified(app, { username: name || `st_${++n}` });
const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
function befriend(a, b) {
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
    .run(a.user.id, b.user.id, Date.now(), Date.now());
}
const studio = (viewer, owner) => call(viewer, 'GET', `/users/${owner.username}`);
/** Compte assez ancien et de niveau suffisant pour publier des liens (politique des liens, PLAN.md 7.1). */
const ageAccount = (who, xp = 5000) => db.prepare('UPDATE users SET created_at = ?, xp = ? WHERE id = ?').run(Date.now() - 3 * 86_400_000, xp, who.user.id);
/** Album complété (succès « album:<id> ») sans passer par les boosters. */
const complete = (who, albumId, at = Date.now()) => db.prepare("INSERT OR IGNORE INTO achievements (user_id, key, created_at, rank) VALUES (?, ?, ?, 1)")
  .run(who.user.id, `album:${albumId}`, at);
const albums = db.prepare('SELECT id FROM cat_albums ORDER BY id').all().map((r) => r.id);

test('les blocs du site et du serveur sont les mêmes ; blocksOf complète et nettoie', () => {
  assert.deepEqual(CLIENT_BLOCK_IDS, BLOCK_IDS);
  assert.equal(BLOCK_IDS.length, 12);
  const out = blocksOf([{ id: 'stats', on: false }, { id: 'inconnu' }, { id: 'stats' }, 'nine']);
  assert.deepEqual(out.slice(0, 2), [{ id: 'stats', on: false }, { id: 'nine', on: true }]);
  assert.equal(out.length, 12);
  assert.deepEqual(blocksOf(null).map((b) => b.id), BLOCK_IDS);
});

test('GET /users/:username : champs de P0 gardés, Studio en plus, réponse sans e-mail ni rôle', async () => {
  const owner = await player();
  const viewer = await player();
  db.prepare('UPDATE users SET bonus_packs = 10, royalties = 5000 WHERE id = ?').run(owner.user.id);
  for (let i = 0; i < 4; i++) await call(owner, 'POST', '/packs/album', { albumId: 'back-to-black' });
  const r = await studio(viewer, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = r.body;
  for (const k of ['id', 'username', 'avatar', 'avatarColor', 'level', 'createdAt', 'stats', 'showcase', 'completedAlbums', 'vinyls',
    'masteredArtists', 'upcoming', 'friendship', 'requestId', 'catalog', 'cosmetics']) assert.ok(k in p, k);
  for (const k of ['user', 'relation', 'access', 'blocks', 'featuredVinyl', 'favorites', 'featuredLists', 'recent', 'vinylCount']) assert.ok(k in p, k);
  assert.equal(p.role, undefined);
  assert.equal(p.email, undefined);
  assert.equal(p.user.email, undefined);
  assert.equal(p.access, 'full');
  assert.equal(p.relation, null);
  assert.equal(p.friendship, 'none');
  assert.equal(p.user.visibility, 'public');
  assert.equal(p.user.friendsCount, 0);
  assert.deepEqual(p.blocks.map((b) => b.id), BLOCK_IDS);
  assert.ok(p.blocks.every((b) => b.on));
  assert.ok(p.vinyls.some((v) => v.albumId === 'back-to-black' && v.rank === 1));
  assert.equal(p.vinylCount, 1);
  assert.ok(p.recent.length > 0 && p.recent.length <= 12);
  assert.ok(p.recent.every((c) => p.catalog.tracks.some((t) => t.id === c.trackId)), 'derniers morceaux avec leur fiche');
  assert.ok(p.catalog.albums.some((a) => a.id === 'back-to-black'));
  const self = (await studio(owner, owner)).body;
  assert.equal(self.relation, 'self');
  assert.equal(self.friendship, 'self');
  assert.equal((await call(viewer, 'GET', '/users/personne')).status, 404);
});

test('confidentialité : public, amis, privé, blocages dans les deux sens', async () => {
  const owner = await player();
  const friend = await player();
  const stranger = await player();
  const blocker = await player();
  befriend(owner, friend);
  complete(owner, albums[0]);
  await call(owner, 'PUT', '/me/favorites/genre', { ids: ['rock', 'jazz'] });
  await call(owner, 'PUT', '/me/profile', { bio: 'Collectionneur de vinyles.' });

  const header = (p) => {
    assert.equal(p.access, 'header');
    assert.deepEqual(p.vinyls, []);
    assert.deepEqual(p.showcase, []);
    assert.deepEqual(p.masteredArtists, []);
    assert.deepEqual(p.favorites, { artists: [], tracks: [], genres: [] });
    assert.deepEqual(p.recent, []);
    assert.equal(p.featuredVinyl, null);
    // L'en-tête reste : pseudo, bio, niveau, chiffres, nombre d'amis.
    assert.equal(p.user.bio, 'Collectionneur de vinyles.');
    assert.equal(p.user.friendsCount, 1);
    assert.ok(p.stats);
  };

  // Public : tout le monde voit tout.
  assert.equal((await studio(stranger, owner)).body.access, 'full');
  assert.deepEqual((await studio(stranger, owner)).body.favorites.genres, ['rock', 'jazz']);

  // Amis : les amis voient tout, les autres l'en-tête.
  assert.equal((await call(owner, 'PUT', '/me/profile', { visibility: 'friends' })).status, 200);
  assert.equal((await studio(friend, owner)).body.access, 'full');
  assert.equal((await studio(friend, owner)).body.relation, 'friend');
  header((await studio(stranger, owner)).body);
  assert.equal((await studio(owner, owner)).body.access, 'full');
  const restricted = await call(stranger, 'GET', `/users/${owner.username}/vinyls`);
  assert.equal(restricted.status, 200);
  assert.equal(restricted.body.restricted, true);
  assert.deepEqual(restricted.body.items, []);
  assert.equal((await call(friend, 'GET', `/users/${owner.username}/vinyls`)).body.items.length, 1);

  // Privé : l'en-tête seulement, même pour un ami.
  assert.equal((await call(owner, 'PUT', '/me/profile', { visibility: 'private' })).status, 200);
  header((await studio(friend, owner)).body);
  header((await studio(stranger, owner)).body);
  const mine = (await studio(owner, owner)).body;
  assert.equal(mine.access, 'full');
  assert.equal(mine.user.visibility, 'private');

  // Blocages : le Studio n'existe plus, dans un sens comme dans l'autre.
  await call(owner, 'PUT', '/me/profile', { visibility: 'public' });
  assert.equal((await call(blocker, 'PUT', `/blocks/${owner.user.id}`)).status, 200);
  assert.equal((await studio(blocker, owner)).status, 404);
  assert.equal((await studio(owner, blocker)).status, 404);
  assert.equal((await call(owner, 'GET', `/users/${blocker.username}/vinyls`)).status, 404);

  // Visibilité inconnue refusée.
  assert.equal((await call(owner, 'PUT', '/me/profile', { visibility: 'everyone' })).status, 400);
});

test('PUT /me/studio : blocs validés (inconnu, doublon, type), ordre et masquage gardés', async () => {
  const me = await player();
  const bad = [
    { blocks: 'nine' },
    { blocks: [{ id: 'inconnu', on: true }] },
    { blocks: [{ id: 'nine' }, { id: 'nine' }] },
    { blocks: [{ id: 'nine', on: 'non' }] },
    { blocks: [null] },
    { blocks: Array.from({ length: 13 }, () => ({ id: 'nine' })) },
  ];
  for (const body of bad) {
    const r = await call(me, 'PUT', '/me/studio', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.field, 'blocks');
  }
  const r = await call(me, 'PUT', '/me/studio', { blocks: [{ id: 'stats', on: true }, { id: 'showcase', on: false }, { id: 'nine' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.studio.blocks.slice(0, 3), [{ id: 'stats', on: true }, { id: 'showcase', on: false }, { id: 'nine', on: true }]);
  assert.equal(r.body.studio.blocks.length, 12);
  const seen = (await studio(await player(), me)).body.blocks;
  assert.deepEqual(seen.slice(0, 3).map((b) => b.id), ['stats', 'showcase', 'nine']);
  assert.equal(seen.find((b) => b.id === 'showcase').on, false);
  // Un champ absent garde sa valeur.
  await call(me, 'PUT', '/me/studio', { featuredVinyl: null });
  assert.equal((await studio(me, me)).body.blocks[0].id, 'stats');
});

test('vinyle mis en avant (pressé seulement) et listes épinglées (à soi, 3 au plus)', async () => {
  const me = await player();
  const other = await player();
  complete(me, albums[1]);
  assert.equal((await call(me, 'PUT', '/me/studio', { featuredVinyl: albums[2] })).body.error, 'vinyl_not_owned');
  assert.equal((await call(me, 'PUT', '/me/studio', { featuredVinyl: 'inconnu' })).status, 400);
  const ok = await call(me, 'PUT', '/me/studio', { featuredVinyl: albums[1] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const p = (await studio(other, me)).body;
  assert.equal(p.featuredVinyl.albumId, albums[1]);
  assert.equal(p.featuredVinyl.rank, 1);
  assert.ok(p.catalog.albums.some((a) => a.id === albums[1]));

  ageAccount(me);
  const lists = [];
  for (let i = 0; i < 4; i++) lists.push((await call(me, 'POST', '/lists', { title: `Liste ${i}`, items: [{ type: 'album', id: albums[i] }] })).body.list.id);
  const theirs = (await call(other, 'POST', '/lists', { title: 'La sienne' })).body.list.id;
  assert.equal((await call(me, 'PUT', '/me/studio', { featuredLists: lists })).status, 400, '3 au plus');
  assert.equal((await call(me, 'PUT', '/me/studio', { featuredLists: [theirs] })).status, 404, 'la liste d’un autre');
  assert.equal((await call(me, 'PUT', '/me/studio', { featuredLists: ['x'] })).status, 400);
  const pinned = await call(me, 'PUT', '/me/studio', { featuredLists: [lists[2], lists[0]] });
  assert.equal(pinned.status, 200, JSON.stringify(pinned.body));
  const seen = (await studio(other, me)).body;
  assert.deepEqual(seen.featuredLists.map((l) => l.id), [lists[2], lists[0]], 'ordre choisi');
  assert.ok(seen.catalog.albums.some((a) => a.id === albums[2]), 'pochettes des listes');
  // Une liste devenue privée disparaît des épinglées pour les autres, pas pour soi.
  await call(me, 'PATCH', `/lists/${lists[2]}`, { visibility: 'private' });
  assert.deepEqual((await studio(other, me)).body.featuredLists.map((l) => l.id), [lists[0]]);
  assert.deepEqual((await studio(me, me)).body.featuredLists.map((l) => l.id), [lists[2], lists[0]]);
});

test('PUT /me/favorites/:kind : 5 au plus, éléments connus, ordre gardé, remplacement', async () => {
  const me = await player();
  const artists = db.prepare('SELECT id FROM cat_artists ORDER BY id LIMIT 6').all().map((r) => r.id);
  const tracks = db.prepare('SELECT id FROM cat_tracks ORDER BY id LIMIT 3').all().map((r) => r.id);
  assert.equal((await call(me, 'PUT', '/me/favorites/artist', { ids: artists })).status, 400, '6 artistes');
  assert.equal((await call(me, 'PUT', '/me/favorites/artist', { ids: 'abc' })).status, 400);
  assert.equal((await call(me, 'PUT', '/me/favorites/artist', { ids: [artists[0], artists[0]] })).status, 400, 'doublon');
  assert.equal((await call(me, 'PUT', '/me/favorites/album', { ids: [] })).status, 400, 'type inconnu');
  const unknown = await call(me, 'PUT', '/me/favorites/artist', { ids: ['personne'] });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'unknown_item');
  assert.equal((await call(me, 'PUT', '/me/favorites/genre', { ids: ['polka'] })).status, 404);
  const r = await call(me, 'PUT', '/me/favorites/artist', { ids: [artists[3], artists[1]] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.favorites.artists, [artists[3], artists[1]]);
  assert.ok(r.body.catalog.artists.some((a) => a.id === artists[3]));
  await call(me, 'PUT', '/me/favorites/track', { ids: tracks });
  await call(me, 'PUT', '/me/favorites/artist', { ids: [artists[2]] });
  const p = (await studio(await player(), me)).body;
  assert.deepEqual(p.favorites.artists, [artists[2]]);
  assert.deepEqual(p.favorites.tracks, tracks);
  assert.ok(tracks.every((id) => p.catalog.tracks.some((t) => t.id === id)));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_favorites WHERE user_id = ? AND kind = 'artist'").get(me.user.id).n, 1);
});

test('PUT /me/cosmetics : verrouillé → 409, débloqué → résumé du joueur et état partiel', async () => {
  const me = await player();
  const locked = await call(me, 'PUT', '/me/cosmetics', { frame: 'or' });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error, 'cosmetic_locked');
  assert.equal((await call(me, 'PUT', '/me/cosmetics', { frame: 42 })).status, 400);
  // Niveau 3 : cadre « Ivoire ».
  db.prepare('UPDATE users SET xp = 2000 WHERE id = ?').run(me.user.id);
  const ok = await call(me, 'PUT', '/me/cosmetics', { frame: 'ivoire' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.cosmetics.frame, 'ivoire');
  assert.equal(ok.body.state.partial, true);
  assert.equal(ok.body.state.user.cosmetics.frame, 'ivoire');
  const p = (await studio(await player(), me)).body;
  assert.equal(p.user.frame, 'ivoire');
  assert.equal(p.cosmetics.frame, 'ivoire');
  assert.equal((await call(me, 'PUT', '/me/cosmetics', { frame: null })).body.cosmetics.frame, null);
});

test('bio : 280 caractères, liens selon l’ancienneté, compte actif, cachée pendant une suspension', async () => {
  const me = await player();
  const viewer = await player();
  assert.equal((await call(me, 'PUT', '/me/profile', { bio: 'x'.repeat(281) })).status, 400);
  assert.equal((await call(me, 'PUT', '/me/profile', { bio: 12 })).status, 400);
  const link = await call(me, 'PUT', '/me/profile', { bio: 'Mon site : https://exemple.com' });
  assert.equal(link.status, 400);
  assert.equal(link.body.error, 'links_not_allowed');
  const r = await call(me, 'PUT', '/me/profile', { bio: '  Fan de jazz.\r\n\r\n\r\n\r\nEt de soul.  ' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.profile.bio, 'Fan de jazz.\n\nEt de soul.');
  assert.equal(r.body.profile.visibility, 'public');
  assert.equal((await studio(viewer, me)).body.user.bio, 'Fan de jazz.\n\nEt de soul.');
  // Suspendu : la bio disparaît pour les autres, il ne peut plus en écrire une nouvelle, mais peut l'effacer.
  db.prepare('UPDATE users SET suspended_until = ? WHERE id = ?').run(Date.now() + 86_400_000, me.user.id);
  assert.equal((await studio(viewer, me)).body.user.bio, null);
  assert.equal((await studio(me, me)).body.user.bio, 'Fan de jazz.\n\nEt de soul.');
  assert.equal((await call(me, 'PUT', '/me/profile', { bio: 'Autre chose' })).status, 403);
  assert.equal((await call(me, 'PUT', '/me/profile', { bio: '' })).body.profile.bio, null);
  db.prepare('UPDATE users SET suspended_until = NULL WHERE id = ?').run(me.user.id);
  // Compte ancien et de niveau suffisant : les liens permis passent.
  ageAccount(me);
  const ok = await call(me, 'PUT', '/me/profile', { bio: 'Écoute https://www.deezer.com/fr/album/302127' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.profile.bio.includes('deezer.com'));
});

test('gros collectionneur : réponse bornée (24 vinyles), étagère complète par curseur, sans doublon', async () => {
  const whale = await player();
  const viewer = await player();
  const artist = db.prepare('SELECT id FROM cat_artists LIMIT 1').get().id;
  const now = Date.now();
  const insert = db.prepare(`INSERT INTO cat_albums (id, artist_id, title, year, genre, catalog, track_count, source, created_at)
    VALUES (?, ?, ?, 2001, 'pop', ?, 10, 'test', ?)`);
  const ids = [];
  for (let i = 0; i < 130; i++) {
    const id = `st-whale-${String(i).padStart(3, '0')}`;
    insert.run(id, artist, `Album ${i}`, 900_000 + i, now);
    ids.push(id);
    // Deux albums complétés à la même milliseconde : le curseur départage par la clé.
    complete(whale, id, now - Math.floor(i / 2) * 1000);
  }
  // Beaucoup de maîtrises aussi.
  const artists = db.prepare('SELECT id FROM cat_artists LIMIT 100').all().map((r) => r.id);
  for (const a of artists) db.prepare('INSERT OR IGNORE INTO achievements (user_id, key, created_at) VALUES (?, ?, ?)').run(whale.user.id, `artist:${a}`, now);
  app.services.forget(whale.user.id);
  const r = await studio(viewer, whale);
  assert.equal(r.status, 200);
  const p = r.body;
  assert.equal(p.vinyls.length, 24);
  assert.equal(p.vinylCount, 130);
  assert.ok(p.catalog.albums.length <= 24 + 3 + 2, `${p.catalog.albums.length} albums de référence`);
  const size = JSON.stringify(p).length;
  assert.ok(size < 60_000, `${size} octets`);
  // L'étagère complète, page par page.
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await call(viewer, 'GET', `/users/${whale.username}/vinyls?limit=48${cursor ? `&cursor=${cursor}` : ''}`);
    assert.equal(page.status, 200, JSON.stringify(page.body));
    seen.push(...page.body.items.map((v) => v.albumId));
    assert.ok(page.body.items.every((v) => page.body.catalog.albums.some((a) => a.id === v.albumId)));
    cursor = page.body.nextCursor;
    pages += 1;
  } while (cursor && pages < 10);
  assert.equal(seen.length, 130);
  assert.equal(new Set(seen).size, 130);
  assert.equal((await call(viewer, 'GET', `/users/${whale.username}/vinyls?cursor=abc!`)).status, 400);
});

test('plans de requêtes du Studio : aucun parcours complet des tables du jeu', async () => {
  const me = await player();
  const other = await player();
  const seen = new Set();
  const orig = db.prepare;
  db.prepare = (sql) => {
    seen.add(sql);
    return orig.call(db, sql);
  };
  try {
    // Base neuve de ce test : les requêtes déjà préparées par le module ne repassent pas par db.prepare ; on vérifie
    // donc aussi celles du module directement ci-dessous.
    await studio(other, me);
    await call(other, 'GET', `/users/${me.username}/vinyls`);
  } finally {
    delete db.prepare;
  }
  const sqls = [...seen, ...[
    "SELECT COUNT(*) AS n FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'",
    'SELECT kind, item_id FROM user_favorites WHERE user_id = ? ORDER BY kind, position, created_at',
    'SELECT track_id, variant, first_at FROM cards WHERE user_id = ? ORDER BY first_at DESC LIMIT ?',
    `SELECT a.key, a.created_at, a.rank, p.holo, p.total FROM achievements a
      LEFT JOIN user_album_progress p ON p.user_id = a.user_id AND p.album_id = substr(a.key, 7)
      WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;' AND (a.created_at, a.key) < (?, ?)
        AND EXISTS (SELECT 1 FROM cat_albums al WHERE al.id = substr(a.key, 7))
      ORDER BY a.created_at DESC, a.key DESC LIMIT ?`,
  ]].filter((sql) => /^\s*(SELECT|WITH)/i.test(sql));
  const guarded = new Set(['users', 'cards', 'achievements', 'friendships', 'ratings', 'cat_albums', 'cat_tracks', 'cat_artists',
    'user_album_progress', 'lists', 'list_items', 'user_favorites', 'likes']);
  const bad = [];
  for (const sql of sqls) {
    const params = (sql.match(/\?/g) || []).length;
    for (const { detail } of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(params).fill(1))) {
      const m = /^SCAN (\w+)/.exec(detail);
      if (m && guarded.has(m[1])) bad.push(`${detail} ← ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
  assert.deepEqual(bad, []);
});
