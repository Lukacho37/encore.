// Recherche globale (PLAN.md 4.1.4, 5.1, critère P0.2) : les 13 requêtes d'acceptation sur le catalogue de base
// noyé dans un faux catalogue importé aux noms de la fixture (« night night 12 », « Song amour 340 »…), quotas des
// groupes, compteurs plafonnés, membres bloqués absents dans les deux sens, listes publiques seulement, nouvelles
// lignes indexées par refresh(), pages de résultats, espace admin, temps par requête.
// Variable facultative : FIXTURE=<copie de fixture20k.db> mesure aussi la construction et les requêtes sur le grand
// catalogue (20 000 albums, 240 000 morceaux ; la base est recopiée, FIXTURE n'est jamais modifiée).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApp, signupVerified, api } from './helpers.js';
import { highlightParts, normalize, similarity, trigrams, textScore } from '../../shared/search.js';

process.env.ADMIN_EMAILS = 'chef@example.com';

const WORDS = ['night', 'amour', 'nuit', 'soleil', 'paris', 'ghost', 'heart', 'river', 'storm', 'echo', 'love', 'blue', 'gold', 'city', 'fire', 'dream'];
const GENRES = ['pop', 'rock', 'electro', 'jazz', 'rap'];

/** Faux catalogue importé, aux noms de la fixture : 160 artistes, 960 albums, 11 520 morceaux. */
function decoys(db) {
  const now = Date.now();
  const artist = db.prepare(`INSERT INTO cat_artists (id, name, genre, fans, source, deezer_id, created_at) VALUES (?, ?, ?, ?, 'deezer', ?, ?)`);
  const album = db.prepare(`INSERT INTO cat_albums (id, artist_id, title, year, genre, catalog, track_count, fans, source, deezer_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'deezer', ?, ?)`);
  const track = db.prepare(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, year, genre, pop, rarity, source, deezer_id, created_at)
    VALUES (?, 'album', ?, ?, ?, ?, ?, ?, ?, ?, 'common', 'deezer', ?, ?)`);
  db.exec('BEGIN');
  let n = 0;
  for (let a = 1; a <= 160; a++) {
    const artistId = `dz${a}`;
    artist.run(artistId, `Artist ${WORDS[a % 16]} ${a}`, GENRES[a % 5], 1000 + a * 50, `a${a}`, now);
    for (let k = 0; k < 6; k++) {
      n += 1;
      const albumId = `dz${1_000_000 + n}`;
      album.run(albumId, artistId, `${WORDS[n % 16]} ${WORDS[(n * 7) % 16]} ${n}`, 1990 + (n % 30), GENRES[n % 5], 1000 + n, 12, 100 + n * 10, `al${n}`, now);
      for (let t = 1; t <= 12; t++) {
        const id = `${albumId}:${String(t).padStart(2, '0')}`;
        track.run(id, albumId, artistId, t, 12, `Song ${WORDS[(n + t) % 16]} ${n * 12 + t}`, 1990 + (n % 30), GENRES[n % 5], (n * 13 + t * 7) % 90, `t${n}-${t}`, now);
      }
    }
  }
  db.exec('COMMIT');
}

const app = await startApp({ catalog: decoys });
after(() => app.close());
const search = app.deps.search;

// Joueurs : le chef (admin), alice et bob (bob est bloqué par alice), daft_lover (un membre qui parle de Daft Punk).
const chef = await signupVerified(app, { username: 'chef', email: 'chef@example.com' });
const alice = await signupVerified(app, { username: 'alice' });
const bob = await signupVerified(app, { username: 'bobby' });
const fan = await signupVerified(app, { username: 'daft_lover' });

/** Nom affiché du premier résultat (`top`) d'une réponse de suggestions. */
function topName(r) {
  if (!r.top) return null;
  const { kind, id } = r.top;
  if (kind === 'album') return r.catalog.albums.find((a) => a.id === id)?.title;
  if (kind === 'track') return r.catalog.tracks.find((t) => t.id === id)?.title;
  if (kind === 'artist') return r.catalog.artists.find((a) => a.id === id)?.name;
  if (kind === 'user') return r.top.username;
  return r.groups.list?.find((l) => l.id === id)?.title;
}

test('règles partagées : normalisation, score de texte, similarité, surlignage', () => {
  assert.equal(normalize('  Racine carrée — Stromae! '), 'racine carree stromae');
  assert.equal(normalize('Røyksopp & Cœur'), 'royksopp coeur');
  assert.equal(textScore('daft punk', 'daft punk', ['daft', 'punk']), 1);
  assert.equal(textScore('daft punk', 'daft', ['daft']), 0.9);
  assert.ok(Math.abs(textScore('the dark side of the moon', 'da', ['da']) - 0.8) < 1e-9);
  assert.ok(similarity(trigrams('stromea'), 'stromae') >= 0.4);
  assert.ok(similarity(trigrams('kendrik'), 'kendrick lamar') >= 0.4);
  assert.ok(similarity(trigrams('zzzzqx'), 'daft punk') < 0.3);
  assert.deepEqual(highlightParts('Racine carrée', 'carr'), [{ text: 'Racine ', hit: false }, { text: 'carr', hit: true }, { text: 'ée', hit: false }]);
  assert.deepEqual(highlightParts('Daft Punk', 'pu da'), [{ text: 'Da', hit: true }, { text: 'ft ', hit: false }, { text: 'Pu', hit: true }, { text: 'nk', hit: false }]);
  assert.deepEqual(highlightParts('Cœur', 'coe'), [{ text: 'Cœ', hit: true }, { text: 'ur', hit: false }]);
});

test('les 13 requêtes d’acceptation (PLAN.md 5.1) donnent le premier résultat attendu', () => {
  const cases = [
    ['stromea', 'artist', 'Stromae', true],
    ['daft pnuk', 'artist', 'Daft Punk', true],
    ['dicovery', 'album', 'Discovery', true],
    ['kendrik', 'artist', 'Kendrick Lamar', true],
    ['nevermnd', 'album', 'Nevermind', true],
    ['random acess memories', 'album', 'Random Access Memories', true],
    ['thriler', null, 'Thriller', true],
    ['back to blak', null, 'Back to Black', true],
    ['racine carree', 'album', 'Racine carrée', false],
    ['abbey road beatles', 'album', 'Abbey Road', false],
    ['get lucky', 'track', 'Get Lucky', false],
    ['da', 'artist', 'Daft Punk', false],
  ];
  for (const [q, kind, name, typo] of cases) {
    const r = search.suggest(alice.user.id, q);
    assert.equal(topName(r), name, `« ${q} » → ${JSON.stringify(r.top)}`);
    if (kind) assert.equal(r.top.kind, kind, `« ${q} » : type du premier résultat`);
    // « Vouliez-vous dire » seulement quand rien ne commence comme la requête.
    if (typo) assert.equal(r.suggestion, name, `« ${q} » : suggestion`);
    else assert.equal(r.suggestion, null, `« ${q} » : pas de suggestion`);
    const first = r.groups[r.top.kind][0];
    assert.equal(!!first.typo, typo, `« ${q} » : marque ≈`);
  }
  const none = search.suggest(alice.user.id, 'zzzzqx');
  assert.equal(none.top, null);
  assert.equal(none.suggestion, null);
  assert.ok(Object.values(none.groups).every((g) => g.length === 0));
});

test('quotas des groupes, compteurs plafonnés à 100, requête trop courte', async () => {
  const r = await api(app.base, alice.cookie, 'GET', '/search/suggest?q=night');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, max-age=30');
  const { groups, counts } = r.body;
  assert.ok(groups.album.length === 4 && groups.track.length === 4 && groups.artist.length <= 3 && groups.user.length <= 3 && groups.list.length <= 2);
  assert.equal(counts.album, 100, 'plus de 100 albums « night » : compteur plafonné');
  assert.equal(counts.track, 100);
  assert.ok(counts.artist >= 3 && counts.artist <= 100);
  // Les données des vignettes arrivent avec la réponse (pochette, artiste, album).
  for (const a of groups.album) assert.ok(r.body.catalog.albums.some((x) => x.id === a.id && x.art));
  for (const t of groups.track) assert.ok(r.body.catalog.tracks.some((x) => x.id === t.id && x.art && x.album));

  const one = await api(app.base, alice.cookie, 'GET', '/search/suggest?q=night&scope=album');
  assert.deepEqual(Object.keys(one.body.groups), ['album']);
  assert.equal(one.body.groups.album.length, 8);
  const two = await api(app.base, alice.cookie, 'GET', '/search/suggest?q=love&scope=album,track');
  assert.deepEqual(Object.keys(two.body.groups), ['album', 'track']);

  const short = await api(app.base, alice.cookie, 'GET', '/search/suggest?q=a');
  assert.equal(short.status, 200);
  assert.ok(Object.values(short.body.groups).every((g) => g.length === 0));
  assert.equal((await api(app.base, alice.cookie, 'GET', '/search/suggest?q=night&scope=films')).status, 400);
  assert.equal((await api(app.base, '', 'GET', '/search/suggest?q=night')).status, 401);
});

test('progression du joueur sur les albums proposés, bonus de sa collection', () => {
  const albumId = 'discovery';
  app.db.prepare(`INSERT INTO user_album_progress (user_id, album_id, owned, holo, total, first_at, updated_at) VALUES (?, ?, 5, 0, 14, 1, 1)`)
    .run(alice.user.id, albumId);
  const r = search.suggest(alice.user.id, 'discovery');
  assert.equal(r.groups.album[0].id, albumId);
  assert.deepEqual(r.progress[albumId], { owned: 5, total: 14 });
  assert.equal(search.suggest(bob.user.id, 'discovery').progress[albumId], undefined);
});

test('membres : trouvés par leur pseudo, jamais quand un blocage existe dans un sens ou dans l’autre', async () => {
  const before = await api(app.base, alice.cookie, 'GET', '/search/suggest?q=bobb&scope=user');
  assert.deepEqual(before.body.groups.user.map((u) => u.username), ['bobby']);
  assert.equal(before.body.groups.user[0].relation, null);
  const fanFound = await api(app.base, alice.cookie, 'GET', '/search/suggest?q=daft');
  assert.ok(fanFound.body.groups.user.some((u) => u.username === 'daft_lover'), 'pseudo daft_lover trouvé par « daft »');

  assert.equal((await api(app.base, alice.cookie, 'PUT', `/blocks/${bob.user.id}`)).status, 200);
  const blocked = await api(app.base, alice.cookie, 'GET', '/search/suggest?q=bobb&scope=user');
  assert.deepEqual(blocked.body.groups.user, []);
  const reverse = await api(app.base, bob.cookie, 'GET', '/search/suggest?q=alic');
  assert.ok(!reverse.body.groups.user.some((u) => u.username === 'alice'), 'alice invisible pour bobby');
  const page = await api(app.base, bob.cookie, 'GET', '/search?type=user&q=alice');
  assert.deepEqual(page.body.items, []);
  assert.equal((await api(app.base, alice.cookie, 'DELETE', `/blocks/${bob.user.id}`)).status, 200);
  const again = await api(app.base, alice.cookie, 'GET', '/search/suggest?q=bobb&scope=user');
  assert.deepEqual(again.body.groups.user.map((u) => u.username), ['bobby']);
});

test('un compte confirmé est cherchable tout de suite (événement user.verified)', async () => {
  await signupVerified(app, { username: 'nouvelle_venue' });
  const r = await api(app.base, alice.cookie, 'GET', '/search/suggest?q=nouvelle&scope=user');
  assert.deepEqual(r.body.groups.user.map((u) => u.username), ['nouvelle_venue']);
});

test('listes : publiques et non masquées seulement, avec leurs pochettes ; retirées à content.removed', () => {
  const now = Date.now();
  const add = (title, visibility) => {
    const id = Number(app.db.prepare(`INSERT INTO lists (user_id, title, visibility, item_count, like_count, created_at, updated_at)
      VALUES (?, ?, ?, 2, 12, ?, ?)`).run(fan.user.id, title, visibility, now, now).lastInsertRowid);
    app.db.prepare(`INSERT INTO list_items (list_id, position, item_type, item_id, added_at) VALUES (?, 0, 'album', 'discovery', ?), (?, 1, 'track', 'thriller:04', ?)`)
      .run(id, now, id, now);
    app.deps.bus.emit('list.saved', { listId: id, userId: fan.user.id, kind: 'list', visibility, itemCount: 2 });
    return id;
  };
  const pub = add('French Touch : les classiques', 'public');
  add('French Touch secrète', 'private');
  const r = search.suggest(alice.user.id, 'french touch');
  assert.deepEqual(r.groups.list.map((l) => l.title), ['French Touch : les classiques']);
  const list = r.groups.list[0];
  assert.equal(list.user.username, 'daft_lover');
  assert.deepEqual(list.coverAlbumIds, ['discovery', 'thriller']);
  assert.equal(list.itemCount, 2);
  assert.ok(r.catalog.albums.some((a) => a.id === 'discovery'));

  app.deps.bus.emit('content.removed', { targetType: 'list', targetId: pub, by: 'moderator' });
  assert.deepEqual(search.suggest(alice.user.id, 'french touch').groups.list, []);
});

test('nouvelles lignes du catalogue indexées par refresh() (import en arrière-plan)', () => {
  const now = Date.now();
  app.db.prepare("INSERT INTO cat_artists (id, name, genre, fans, source, created_at) VALUES ('dz9999', 'Zéphyrine Quartet', 'jazz', 5000, 'deezer', ?)").run(now);
  app.db.prepare(`INSERT INTO cat_albums (id, artist_id, title, year, genre, catalog, track_count, fans, source, created_at)
    VALUES ('dz9999001', 'dz9999', 'Brumes de Quimper', 2024, 'jazz', 9999, 1, 900, 'deezer', ?)`).run(now);
  app.db.prepare(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, year, genre, pop, rarity, source, created_at)
    VALUES ('dz9999001:01', 'album', 'dz9999001', 'dz9999', 1, 1, 'Marée haute', 2024, 'jazz', 40, 'rare', 'deezer', ?)`).run(now);
  assert.equal(search.suggest(alice.user.id, 'brumes').groups.album.length, 0, 'pas encore indexé');
  const added = search.refresh();
  assert.deepEqual({ ...added, user: 0 }, { album: 1, track: 1, artist: 1, user: 0 });
  assert.equal(search.suggest(alice.user.id, 'brumes quim').groups.album[0].id, 'dz9999001');
  assert.equal(search.suggest(alice.user.id, 'maree').groups.track[0].id, 'dz9999001:01');
  assert.equal(search.suggest(alice.user.id, 'zephyrine').groups.artist[0].id, 'dz9999');
  assert.deepEqual(search.refresh(), { album: 0, track: 0, artist: 0, user: 0 }, 'deuxième passage sans rien à faire');
});

test('pages de résultats : 24 par page, curseur, 240 au plus', async () => {
  const first = await api(app.base, alice.cookie, 'GET', '/search?type=album&q=night');
  assert.equal(first.status, 200);
  assert.equal(first.body.items.length, 24);
  assert.ok(first.body.total > 24 && first.body.total <= 240);
  assert.ok(first.body.nextCursor);
  const second = await api(app.base, alice.cookie, 'GET', `/search?type=album&q=night&cursor=${first.body.nextCursor}`);
  assert.equal(second.body.items.length, 24);
  const ids = new Set(first.body.items.map((i) => i.id));
  assert.ok(second.body.items.every((i) => !ids.has(i.id)), 'aucun doublon entre deux pages');
  assert.ok(first.body.catalog.albums.length >= 24);
  const users = await api(app.base, alice.cookie, 'GET', '/search?type=user&q=dafte_lover');
  assert.deepEqual(users.body.items.map((u) => u.username), ['daft_lover'], 'faute de frappe sur un pseudo');
  assert.equal((await api(app.base, alice.cookie, 'GET', '/search?type=disque&q=night')).status, 400);
  assert.equal((await api(app.base, alice.cookie, 'GET', '/search?type=album&q=night&cursor=%%%')).status, 400);
});

test('espace admin : état de l’index et reconstruction (propriétaire seulement)', async () => {
  assert.equal((await api(app.base, alice.cookie, 'GET', '/admin/search')).status, 403);
  const status = await api(app.base, chef.cookie, 'GET', '/admin/search');
  assert.equal(status.status, 200);
  assert.ok(status.body.docs.album > 900 && status.body.docs.track > 11_000 && status.body.docs.user >= 4);
  const rebuilt = await api(app.base, chef.cookie, 'POST', '/admin/search/rebuild');
  assert.equal(rebuilt.status, 200);
  assert.equal(rebuilt.body.indexedVersion, rebuilt.body.version);
  assert.equal(search.suggest(alice.user.id, 'get lucky').top.id, 'random-access-memories:08');
  assert.deepEqual(search.refreshWeights().changed, 0);
});

test('temps par requête < 20 ms (meilleur de trois, serveur chargé par les autres tests)', () => {
  const queries = ['stromea', 'daft pnuk', 'dicovery', 'kendrik', 'nevermnd', 'random acess memories', 'thriler', 'back to blak',
    'racine carree', 'abbey road beatles', 'get lucky', 'da', 'zzzzqx', 'night', 'song', 'amour riv', 'the'];
  for (const q of queries) search.suggest(alice.user.id, q);
  const slow = [];
  for (const q of queries) {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      search.forget();
      const t = performance.now();
      search.suggest(alice.user.id, q);
      best = Math.min(best, performance.now() - t);
    }
    if (best >= 20) slow.push(`${q} ${best.toFixed(1)} ms`);
  }
  assert.deepEqual(slow, []);
});

const FIXTURE = process.env.FIXTURE;
test('grand catalogue (FIXTURE) : index construit en 10 s au plus, requêtes < 20 ms au 95e centile', { skip: !FIXTURE && 'FIXTURE non défini' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-search-'));
  const file = path.join(dir, 'fixture.db');
  try {
    fs.copyFileSync(FIXTURE, file);
    const { openDb } = await import('../db.js');
    const { createApp } = await import('../app.js');
    const db = openDb(file);
    const started = performance.now();
    const big = createApp({ db });
    const bootMs = performance.now() - started;
    const status = big.deps.search.status();
    assert.ok(status.docs.track > 200_000, JSON.stringify(status.docs));
    assert.ok(status.lastBuild.ms <= 10_000, `construction ${status.lastBuild.ms} ms (démarrage ${bootMs.toFixed(0)} ms)`);
    const s = big.deps.search;
    assert.equal(topName(s.suggest(null, 'daft pnuk')), 'Daft Punk');
    assert.equal(topName(s.suggest(null, 'get lucky')), 'Get Lucky');
    const queries = ['stromea', 'dicovery', 'kendrik', 'nevermnd', 'thriler', 'back to blak', 'racine carree', 'abbey road beatles', 'da',
      'night', 'song', 'artist', 'paris dream', 'nigth', 'so', 'amour riv', 'the', 'beyonce'];
    for (const q of queries) s.suggest(null, q);
    const times = [];
    for (let i = 0; i < 3; i++) {
      for (const q of queries) {
        const t = performance.now();
        s.suggest(null, q);
        times.push(performance.now() - t);
      }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    assert.ok(p95 < 20, `95e centile ${p95.toFixed(1)} ms, pire ${times.at(-1).toFixed(1)} ms`);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
