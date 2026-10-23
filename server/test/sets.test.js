// Coffrets (PLAN.md 6.8, 8.3 P2.4, chantier P2-B) : coffrets du code créés quand le catalogue en réunit assez,
// coffrets générés genre × décennie (les 8 plus populaires, figés), tâche sets-generate, liste paginée, page d'un
// coffret (progression, amis, blocages, Studio privé), badge aux 3/4 et cadre au complet donnés une seule fois (au fil
// des albums complétés et à la lecture pour un coffret créé après coup), coût des lectures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApp, signupVerified, api } from './helpers.js';
import {
  CODE_SETS, GENERATED_SIZE, generatedId, generatedRule, generatedTitles, isSetId, setBadgeKey, setFrameId, setRewards,
} from '../../shared/sets.js';

const NOW = Date.now();
let catalogNo = 5000;

/** Albums synthétiques (et leurs morceaux) ajoutés au catalogue d'un test : fans décroissants dans l'ordre donné. */
function addAlbums(db, { prefix, genre, years, fans = 100_000, tracks = 2, artist = `${prefix}-artist` }) {
  db.prepare(`INSERT OR IGNORE INTO cat_artists (id, name, genre, fans, source, created_at) VALUES (?, ?, ?, 0, 'test', ?)`)
    .run(artist, `Artiste ${prefix}`, genre, NOW);
  const ids = [];
  years.forEach((year, i) => {
    const id = `${prefix}-${i}`;
    db.prepare(`INSERT INTO cat_albums (id, artist_id, title, year, genre, catalog, track_count, fans, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test', ?)`).run(id, artist, `${prefix} ${i}`, year, genre, catalogNo++, tracks, fans - i * 10, NOW);
    for (let n = 1; n <= tracks; n++) {
      db.prepare(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, year, genre, pop, rarity, source, created_at)
        VALUES (?, 'album', ?, ?, ?, ?, ?, ?, ?, 50, 'common', 'test', ?)`).run(`${id}:${n}`, id, artist, n, tracks, `${prefix} ${i} · ${n}`, year, genre, NOW);
    }
    ids.push(id);
  });
  return ids;
}

// Catalogue : la graine (20 albums), 10 albums d'électro des années 90 (un coffret généré), 6 albums de rock des années
// 70 (avec les 2 de la graine : 8, un autre coffret généré), et 5 albums de jazz des années 60 (pas assez pour un
// coffret généré).
let electro90;
let rock70;
let jazz60;
const app = await startApp({
  catalog: async (db) => {
    electro90 = addAlbums(db, { prefix: 'el90', genre: 'electro', years: [1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 1990] });
    rock70 = addAlbums(db, { prefix: 'rk70', genre: 'rock', years: [1970, 1971, 1972, 1974, 1976, 1977] });
    jazz60 = addAlbums(db, { prefix: 'jz60', genre: 'jazz', years: [1960, 1961, 1962, 1963, 1964] });
  },
});
test.after(() => app.close());
const { db, deps, services } = app;

let n = 0;
const player = (name) => signupVerified(app, { username: name || `st_${++n}` });
const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
const setAlbums = (id) => db.prepare('SELECT album_id FROM set_albums WHERE set_id = ? ORDER BY position').all(id).map((r) => r.album_id);
const tracksOf = (albumId) => db.prepare('SELECT id FROM cat_tracks WHERE album_id = ? ORDER BY n').all(albumId).map((r) => r.id);
/** Complète un album par le vrai chemin (addCards dans une transaction : album.completed part après la validation). */
function complete(who, albumId) {
  const user = services.getUser(who.user.id);
  services.atomic(() => services.addCards(user, tracksOf(albumId).map((trackId) => ({ trackId, variant: 'std' })), 'press'));
}
const befriend = (a, b) => db.prepare(`INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at)
  VALUES (?, ?, 'accepted', ?, ?)`).run(a.user.id, b.user.id, Date.now(), Date.now());

test('règles partagées : seuils des récompenses, identifiants, titres des coffrets générés', () => {
  assert.deepEqual(setRewards('g-rock-1970', 8), { badgeAt: 6, frameAt: 8, badge: 'badge:set:g-rock-1970:bronze', frame: 'frame:set-g-rock-1970' });
  assert.equal(setRewards('ed-x', 10).badgeAt, 8);
  assert.equal(setRewards('ed-x', 12).badgeAt, 9);
  assert.equal(setRewards('ed-x', 6).badgeAt, 5);
  assert.deepEqual(generatedRule('g-electro-1990'), { genre: 'electro', decade: 1990 });
  assert.equal(generatedRule('g-polka-1990'), null);
  assert.equal(generatedRule('g-electro-1955'), null);
  assert.ok(isSetId('ed-classiques') && isSetId('g-soundtrack-2020') && isSetId('ev-french-touch'));
  assert.ok(!isSetId('x-classiques') && !isSetId('ed-') && !isSetId('ed-Classiques') && !isSetId(`ed-${'a'.repeat(40)}`));
  assert.deepEqual(generatedTitles('electro', 1990), { fr: 'Électro · années 90', en: 'Electronic · 1990s' });
  assert.equal(generatedTitles('rap', 2000).fr, 'Rap · années 2000');
  // Le cadre d'un coffret reste un cosmétique valide (clé de 40 caractères au plus).
  for (const def of CODE_SETS) assert.match(setFrameId(def.id), /^frame:[a-z0-9][a-z0-9-]{0,39}$/, def.id);
  assert.match(setFrameId(generatedId('soundtrack', 2020)), /^frame:[a-z0-9][a-z0-9-]{0,39}$/);
  assert.equal(setBadgeKey('ed-classiques'), 'badge:set:ed-classiques:bronze');
});

test('démarrage : coffrets du code créés quand le catalogue en réunit assez, générés genre × décennie (8 plus populaires)', () => {
  // Les classiques : 10 albums de la graine, dans l'ordre de la sélection.
  assert.deepEqual(setAlbums('ed-classiques'), CODE_SETS.find((s) => s.id === 'ed-classiques').albums.map((x) => x.id));
  const row = db.prepare('SELECT * FROM sets WHERE id = ?').get('ed-classiques');
  assert.equal(row.kind, 'editorial');
  assert.equal(row.album_count, 10);
  assert.equal(row.title_fr, 'Les classiques du bac');
  // Rap US 90 : rien dans le catalogue de test → pas de coffret (il viendra avec un import).
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sets WHERE id = 'ev-rap-us-90'").get().n, 0);
  // Électro des années 90 : la graine d'abord (Moon Safari, 1998), puis les plus populaires (fans décroissants).
  assert.deepEqual(setAlbums('g-electro-1990'), ['moon-safari', ...electro90.slice(0, GENERATED_SIZE - 1)]);
  // Rock des années 70 : la graine d'abord (Dark Side 1973, A Night at the Opera 1975), puis les fans.
  const rock = setAlbums('g-rock-1970');
  assert.equal(rock.length, 8);
  assert.deepEqual(rock.slice(0, 2).sort(), ['a-night-at-the-opera', 'the-dark-side-of-the-moon']);
  assert.deepEqual(rock.slice(2), rock70);
  // Jazz des années 60 : 5 albums seulement (Kind of Blue est de 1959) → pas de coffret généré.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sets WHERE id = 'g-jazz-1960'").get().n, 0);
  assert.ok(app.jobs.names().includes('sets-generate'));
});

test('tâche sets-generate : un coffret créé ne bouge plus ; un genre × décennie qui atteint 8 albums est créé', async () => {
  const before = setAlbums('g-electro-1990');
  // Un album plus populaire arrive : le coffret existant ne change pas (figé à la création).
  addAlbums(db, { prefix: 'el90b', genre: 'electro', years: [1995], fans: 9_000_000 });
  // Trois albums de jazz des années 60 : 8 albums, le coffret peut être créé.
  addAlbums(db, { prefix: 'jz60b', genre: 'jazz', years: [1965, 1966, 1967] });
  const report = await app.jobs.runJob('sets-generate');
  assert.deepEqual(setAlbums('g-electro-1990'), before);
  assert.ok(report.generated.includes('g-jazz-1960'), JSON.stringify(report));
  assert.equal(setAlbums('g-jazz-1960').length, 8);
  // Deuxième passage : rien à faire.
  const again = await app.jobs.runJob('sets-generate');
  assert.deepEqual(again, { code: [], generated: [] });
});

test('GET /api/sets : résumés, compteurs par sorte, filtre, pages par curseur, références du catalogue', async () => {
  const anon = await call(null, 'GET', '/sets');
  assert.equal(anon.status, 401);
  const p = await player();
  const r = await call(p, 'GET', '/sets?limit=2');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2);
  assert.ok(r.body.nextCursor);
  const total = db.prepare('SELECT COUNT(*) AS n FROM sets WHERE retired_at IS NULL').get().n;
  assert.equal(r.body.counts.all, total);
  assert.equal(r.body.counts.started, 0);
  assert.equal(r.body.counts.editorial + r.body.counts.event + r.body.counts.generated, total);
  // Sans progression : éditoriaux d'abord.
  const first = r.body.items[0];
  assert.equal(first.kind, 'editorial');
  assert.deepEqual(Object.keys(first.progress).sort(), ['completed', 'owned', 'total']);
  assert.equal(first.progress.completed, 0);
  assert.ok(first.progress.total > 0);
  assert.equal(first.covers.length, 4);
  assert.equal(first.rewards.badgeEarnedAt, null);
  assert.ok(first.titles.fr && first.titles.en);
  // Les pochettes citées sont dans le catalogue de la réponse.
  const albums = new Set(r.body.catalog.albums.map((x) => x.id));
  for (const s of r.body.items) for (const c of s.covers) assert.ok(albums.has(c), c);
  // Page suivante : pas de doublon.
  const next = await call(p, 'GET', `/sets?limit=2&cursor=${r.body.nextCursor}`);
  assert.equal(next.status, 200);
  assert.ok(next.body.items.every((s) => !r.body.items.some((x) => x.id === s.id)));
  // Filtre par sorte : seulement des coffrets générés, avec leur règle.
  const gen = await call(p, 'GET', '/sets?kind=generated&limit=50');
  assert.ok(gen.body.items.length >= 3 && gen.body.items.every((s) => s.kind === 'generated' && s.rule?.genre && s.rule?.decade));
  // Curseur illisible : 400.
  assert.equal((await call(p, 'GET', '/sets?cursor=%%%')).status, 400);
});

test('progression et récompenses : badge aux 3/4, cadre au complet, une seule fois, notifications', async () => {
  const p = await player();
  const ids = setAlbums('g-rock-1970');
  for (const id of ids.slice(0, 5)) complete(p, id);
  const badge = setBadgeKey('g-rock-1970');
  const has = (key) => !!db.prepare('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?').get(p.user.id, key);
  assert.ok(!has(badge));
  const xpBefore = services.getUser(p.user.id).xp;
  complete(p, ids[5]);
  // 6 sur 8 : le badge bronze (et ses 50 XP), le cadre pas encore.
  assert.ok(has(badge));
  const cosmetic = setFrameId('g-rock-1970');
  const frameRow = () => db.prepare('SELECT source FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = ?').get(p.user.id, cosmetic);
  assert.equal(frameRow(), undefined);
  assert.ok(services.getUser(p.user.id).xp >= xpBefore + 50);
  for (const id of ids.slice(6)) complete(p, id);
  assert.equal(frameRow()?.source, 'set:g-rock-1970');
  // Une seule fois : relire ne redonne rien.
  const again = deps.sets.checkRewards(p.user.id, ['g-rock-1970']);
  assert.deepEqual(again, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM achievements WHERE user_id = ? AND key = ?').get(p.user.id, badge).n, 1);
  // Notifications de coffret (ces albums font aussi avancer « Légendes du rock », qui a les siennes).
  const notes = db.prepare(`SELECT json_extract(data, '$.reward') AS reward FROM notifications WHERE user_id = ? AND kind = 'set_reward'
    AND json_extract(data, '$.setId') = 'g-rock-1970' ORDER BY id`).all(p.user.id).map((r) => r.reward);
  assert.deepEqual(notes, ['badge', 'frame']);
  // Le cadre se choisit dans le Studio (cosmétique débloqué).
  const cos = await call(p, 'GET', '/me/cosmetics');
  assert.ok(cos.body.unlocked.some((c) => c.id === cosmetic));
  const put = await call(p, 'PUT', '/me/cosmetics', { frame: cosmetic });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  // La liste et la page du coffret le montrent.
  const list = await call(p, 'GET', '/sets?kind=started');
  const mine = list.body.items.find((s) => s.id === 'g-rock-1970');
  assert.equal(mine.progress.completed, 8);
  assert.ok(mine.rewards.badgeEarnedAt && mine.rewards.frameEarnedAt);
  assert.equal(list.body.items[0].id, 'g-rock-1970');
});

test('un coffret créé après coup récompense à la lecture ce qui est déjà fait', async () => {
  const p = await player();
  // Six albums de jazz des années 60 complétés avant la création d'un coffret qui les contient.
  addAlbums(db, { prefix: 'jz60c', genre: 'jazz', years: [1967, 1968, 1969, 1960, 1961, 1962, 1963, 1964], fans: 8_000_000 });
  db.prepare("DELETE FROM sets WHERE id = 'g-jazz-1960'").run();
  await app.jobs.runJob('sets-generate');
  const ids = setAlbums('g-jazz-1960');
  assert.ok(ids.every((id) => id.startsWith('jz60c')), JSON.stringify(ids));
  // Albums complétés sans passer par le bus (outil admin) : rien n'est donné tout de suite…
  for (const id of ids.slice(0, 6)) services.adminCompleteCollection(p.user.id, id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM achievements WHERE user_id = ? AND key = ?').get(p.user.id, setBadgeKey('g-jazz-1960')).n, 0);
  // … mais la page du coffret le donne, avec l'état partiel du joueur.
  const r = await call(p, 'GET', '/sets/g-jazz-1960');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rewards, [{ setId: 'g-jazz-1960', reward: 'badge' }]);
  assert.ok(r.body.state?.partial);
  assert.ok(r.body.set.rewards.badgeEarnedAt);
});

test('GET /api/sets/:id : albums et progression, amis (sans bloqués ni Studios privés), détenteurs, 404', async () => {
  const me = await player();
  const friend = await player();
  const blocked = await player();
  const hidden = await player();
  for (const f of [friend, blocked, hidden]) befriend(me, f);
  const ids = setAlbums('g-electro-1990');
  complete(friend, ids[0]);
  complete(friend, ids[1]);
  complete(blocked, ids[0]);
  complete(hidden, ids[0]);
  db.prepare("UPDATE users SET profile_visibility = 'private' WHERE id = ?").run(hidden.user.id);
  assert.equal((await call(me, 'PUT', `/blocks/${blocked.user.id}`)).status, 200);
  // Le blocage défait l'amitié ; on la remet (donnée restée en place) : le filtre des blocages doit tenir quand même.
  befriend(me, blocked);
  // Une carte d'un album : progression en cartes.
  const user = services.getUser(me.user.id);
  services.atomic(() => services.addCards(user, [{ trackId: tracksOf(ids[2])[0], variant: 'std' }], 'press'));

  const r = await call(me, 'GET', '/sets/g-electro-1990');
  assert.equal(r.status, 200);
  assert.equal(r.body.albums.length, 8);
  assert.deepEqual(r.body.albums.map((a) => a.id), ids);
  assert.equal(r.body.albums[2].owned, 1);
  assert.equal(r.body.albums[2].completed, false);
  assert.equal(r.body.set.progress.completed, 0);
  assert.equal(r.body.set.progress.owned, 1);
  assert.equal(r.body.set.rewards.badgeAt, 6);
  assert.deepEqual(r.body.friends.map((f) => [f.user.username, f.completed]), [[friend.user.username, 2]]);
  assert.equal(r.body.friends[0].user.relation, 'friend');
  assert.equal(r.body.holders, 0);
  assert.equal(r.body.event, null);
  const albums = new Set(r.body.catalog.albums.map((x) => x.id));
  assert.ok(ids.every((id) => albums.has(id)));
  // Coffret d'événement : l'événement est décrit.
  const ev = await call(me, 'GET', '/sets/ed-classiques');
  assert.equal(ev.status, 200);
  assert.equal(ev.body.set.kind, 'editorial');
  for (const bad of ['nope', 'ed-inconnu', 'g-electro-1955', `ed-${'a'.repeat(60)}`]) {
    assert.equal((await call(me, 'GET', `/sets/${bad}`)).status, 404, bad);
  }
  assert.equal((await call(me, 'GET', '/sets/nope')).body.error, 'set_not_found');
});

test('coût : la progression lit set_albums avec des sondes de clé primaire, les lectures restent rapides', async () => {
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT sa.set_id AS id, COUNT(a.key) AS completed, COALESCE(SUM(p.owned), 0) AS owned
    FROM set_albums sa
    LEFT JOIN achievements a ON a.user_id = ? AND a.key = 'album:' || sa.album_id
    LEFT JOIN user_album_progress p ON p.user_id = ? AND p.album_id = sa.album_id
    GROUP BY sa.set_id`).all(1, 1).map((r) => r.detail).join(' | ');
  assert.ok(!/SCAN (a|achievements)\b/.test(plan) && !/SCAN (p|user_album_progress)\b/.test(plan), plan);
  const p = await player();
  for (const id of setAlbums('ed-classiques').slice(0, 3)) complete(p, id);
  const started = Date.now();
  for (let i = 0; i < 10; i++) {
    await call(p, 'GET', '/sets');
    await call(p, 'GET', '/sets/ed-classiques');
  }
  const ms = (Date.now() - started) / 20;
  assert.ok(ms < 50, `lecture moyenne ${ms} ms`);
});

// ----- base peuplée -----------------------------------------------------------------------------------------

const PERF_DB = process.env.PERF_DB;
test('base peuplée (PERF_DB) : coffrets créés au démarrage, lectures du plus gros joueur < 150 ms, joueur typique < 50 ms',
  { skip: !PERF_DB && 'PERF_DB non défini', timeout: 300_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sets-'));
    const file = path.join(dir, 'perf.db');
    try {
      fs.copyFileSync(PERF_DB, file);
      const { openDb } = await import('../db.js');
      const { createApp } = await import('../app.js');
      const pdb = openDb(file);
      const { deps: d } = createApp({ db: pdb });
      const count = pdb.prepare('SELECT COUNT(*) AS n FROM sets').get().n;
      assert.ok(count >= 50, `${count} coffrets`);
      const whale = pdb.prepare("SELECT user_id FROM achievements WHERE key >= 'album:' AND key < 'album;' GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1").get().user_id;
      const typical = pdb.prepare('SELECT user_id FROM cards GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1 OFFSET 500').get().user_id;
      const time = (fn) => {
        const t0 = performance.now();
        const out = fn();
        return { out, ms: performance.now() - t0 };
      };
      // Première lecture du plus gros joueur : les récompenses de tous ses coffrets sont données d'un coup (une fois).
      const first = time(() => d.sets.list(whale, {}));
      assert.ok(first.ms < 150, `première liste (baleine) : ${first.ms.toFixed(0)} ms`);
      for (const uid of [whale, typical]) {
        const budget = uid === whale ? 150 : 50;
        const list = time(() => d.sets.list(uid, {}));
        const detail = time(() => d.sets.detail(uid, list.out.items[0].id));
        const event = time(() => d.events.view(uid, 'french-touch'));
        const quests = time(() => d.quests.list(uid));
        for (const [what, r] of Object.entries({ list, detail, event, quests })) assert.ok(r.ms < budget, `${what} (${uid}) : ${r.ms.toFixed(1)} ms`);
        console.log(`  joueur ${uid} : liste ${list.ms.toFixed(1)} ms · coffret ${detail.ms.toFixed(1)} ms · événement ${event.ms.toFixed(1)} ms · quêtes ${quests.ms.toFixed(1)} ms`);
      }
      console.log(`  ${count} coffrets · première liste de la baleine ${first.ms.toFixed(0)} ms (${first.out.rewards.length} récompenses)`);
      pdb.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
