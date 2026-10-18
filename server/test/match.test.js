// Taste Match (PLAN.md 4.2.7, 5.3, chantier P1-E) : calcul partagé (profils identiques ≈ 100, disjoints bas, symétrie,
// composantes expliquées, poids redistribués, confiance), page /match/:username (albums, artistes, morceaux et genres en
// commun, différences, recommandations dans les deux sens), confidentialité (blocages dans les deux sens, Studio privé
// ou réservé aux amis), cache taste_matches (paire rangée, 6 h, recalcul après 5 notes, tâche taste-cache), lot de
// scores, amis suggérés, carte de l'accueil ; avec PERF_DB : distribution des scores et coût d'une paire.
//   PERF_DB=/chemin/perf.db node --test server/test/match.test.js   (la base est recopiée : PERF_DB n'est pas modifiée)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApp, signupVerified, api } from './helpers.js';
import {
  compareProfiles, recommendations, flipResult, matchScore, ratingAgreement, jsSimilarity, cosine, confidenceOf,
  MATCH_TTL_MS, MATCH_PURGE_MS, MATCH_WEIGHTS,
} from '../../shared/match.js';

// ----- calcul partagé ------------------------------------------------------------------------------

/** Profil de goûts à la main : notes { 'album:x': 8 }, adorés, artistes, genres, décennies. */
function profile({ ratings = {}, loved = [], artists = {}, genres = {}, decades = {}, cards = 0, completed = [] } = {}) {
  return {
    ratings: new Map(Object.entries(ratings)),
    loved: new Set(loved),
    artists: new Map(Object.entries(artists)),
    genres: new Map(Object.entries(genres)),
    decades: new Map(Object.entries(decades)),
    cards,
    completed: new Set(completed),
  };
}

/** Profil riche et déterministe : 40 albums notés, 12 adorés, 20 artistes, 4 genres, 3 décennies. */
function rich(offset = 0, noise = 0) {
  const ratings = {};
  const loved = [];
  for (let i = 0; i < 40; i++) {
    const s = Math.max(0, Math.min(10, 3 + ((i * 7) % 8) + (i % 3 === 0 ? noise : -noise)));
    ratings[`album:a${i + offset}`] = s;
    if (s >= 8) loved.push(`a${i + offset}`);
  }
  const artists = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`ar${i + offset}`, 20 - i]));
  return profile({ ratings, loved, artists, genres: { electro: 30, rap: 10, rock: 5, jazz: 2 }, decades: { 1990: 10, 2000: 25, 2010: 12 }, cards: 120 });
}

test('profils identiques ≈ 100, disjoints bas, symétrie exacte', () => {
  const same = compareProfiles(rich(), rich());
  assert.ok(same.score >= 95, `identiques : ${same.score}`);
  assert.equal(same.confidence, 'high');
  const close = compareProfiles(rich(), rich(0, 1));
  assert.ok(close.score >= 85, `proches (notes à 1 point près) : ${close.score}`);

  const A = profile({ ratings: { 'album:e1': 9, 'album:e2': 8 }, loved: ['e1', 'e2'], artists: { daft: 10, air: 6 }, genres: { electro: 10 }, decades: { 2000: 10 } });
  const B = profile({ ratings: { 'album:r1': 9, 'album:r2': 8 }, loved: ['r1', 'r2'], artists: { kanye: 10, nas: 6 }, genres: { rap: 10 }, decades: { 1990: 10 } });
  const far = compareProfiles(A, B);
  assert.ok(far.score <= 10, `disjoints : ${far.score}`);
  assert.equal(far.confidence, 'low');

  // Symétrie : même score, même confiance, différences inversées.
  const X = rich(0, 2);
  const Y = rich(5, 0);
  const xy = compareProfiles(X, Y);
  const yx = compareProfiles(Y, X);
  assert.equal(xy.score, yx.score);
  assert.equal(xy.confidence, yx.confidence);
  assert.deepEqual(xy.components.map((c) => c.value), yx.components.map((c) => c.value));
  assert.deepEqual(xy.differences.map((d) => [d.id, d.a, d.b]), yx.differences.map((d) => [d.id, d.b, d.a]));
});

test('composantes : poids redistribués, rapprochement vers 0,5, explications', () => {
  assert.equal(matchScore({ ratings: null, loved: null, artists: 1, genres: 0, decades: null }), Math.round((100 * 0.2) / 0.3));
  assert.equal(matchScore({}), null);
  assert.equal(ratingAgreement([[8, 8], [6, 6]]), null, 'moins de 3 éléments notés en commun : pas de composante');
  // 3 notes identiques : (3 × 1 + 5 × 0,5) / 8.
  assert.equal(ratingAgreement([[8, 8], [6, 6], [2, 2]]), (3 + 2.5) / 8);
  assert.equal(jsSimilarity(new Map([['a', 1]]), new Map([['a', 5]])), 1);
  assert.equal(jsSimilarity(new Map([['a', 1]]), new Map([['b', 1]])), 0);
  assert.equal(jsSimilarity(new Map(), new Map([['b', 1]])), null);
  assert.equal(cosine(new Map([['x', 2]]), new Map([['x', 5]])), 1);
  assert.deepEqual(Object.keys(MATCH_WEIGHTS), ['ratings', 'loved', 'artists', 'genres', 'decades']);

  const A = profile({
    ratings: { 'album:d': 10, 'album:m': 9, 'album:g': 2, 'track:t1': 9, 'track:t2': 3 },
    loved: ['d', 'm', 'x'], artists: { daft: 12, air: 8, kanye: 1 }, genres: { electro: 8, rap: 2 }, decades: { 2000: 6, 1990: 4 }, cards: 60,
  });
  const B = profile({
    ratings: { 'album:d': 9, 'album:m': 8, 'album:g': 9, 'track:t1': 8, 'track:t2': 9, 'album:z': 9 },
    loved: ['d', 'm', 'z', 'g'], artists: { daft: 9, air: 3, justice: 5 }, genres: { electro: 6, rock: 4 }, decades: { 2000: 9 }, cards: 55,
  });
  const r = compareProfiles(A, B);
  const by = Object.fromEntries(r.components.map((c) => [c.key, c]));
  assert.equal(by.ratings.vars.n, 5);
  assert.equal(by.ratings.vars.gap, Math.round(((1 + 1 + 7 + 1 + 6) / 5) * 10) / 10);
  assert.equal(by.loved.vars.n, 2);
  assert.deepEqual(by.artists.vars.ids, ['daft', 'air']);
  assert.deepEqual(by.genres.vars.ids, ['electro']);
  assert.deepEqual(by.decades.vars.ids, [2000]);
  for (const c of r.components) assert.ok(c.value === null || (c.value >= 0 && c.value <= 100));
  assert.equal(r.confidence, 'medium');
  assert.deepEqual(r.shared.albums, ['d', 'm']);
  assert.deepEqual(r.shared.tracks, ['t1']);
  assert.deepEqual(r.shared.genres, ['electro']);
  // Différences : |a − b| ≥ 5, les plus grands écarts d'abord.
  assert.deepEqual(r.differences.map((d) => [d.type, d.id, d.a, d.b]), [['album', 'g', 2, 9], ['track', 't2', 3, 9]]);
  const flipped = flipResult({ differences: r.differences, recAtoB: ['x'], recBtoA: ['z'] });
  assert.deepEqual(flipped.differences[0], { type: 'album', id: 'g', a: 9, b: 2 });
  assert.deepEqual([flipped.recAtoB, flipped.recBtoA], [['z'], ['x']]);

  assert.equal(confidenceOf({ corated: 10, cardsA: 50, cardsB: 50 }), 'high');
  assert.equal(confidenceOf({ corated: 10, cardsA: 50, cardsB: 49 }), 'medium');
  assert.equal(confidenceOf({ lovedShared: 2 }), 'medium');
  assert.equal(confidenceOf({ corated: 2, lovedShared: 1 }), 'low');
});

test('recommandations : adorés jamais notés ni complétés, 2 par artiste, 6 au plus, bonus de genre', () => {
  const from = profile({
    ratings: { 'album:a1': 10, 'album:a2': 9, 'album:a3': 9, 'album:b1': 8, 'album:c1': 8, 'album:seen': 10 },
    loved: ['a1', 'a2', 'a3', 'b1', 'c1', 'seen', 'done', 'grid'],
  });
  const to = profile({ ratings: { 'album:seen': 4 }, genres: { jazz: 10 }, completed: ['done'] });
  const meta = { a1: ['A', 'rock'], a2: ['A', 'rock'], a3: ['A', 'rock'], b1: ['B', 'jazz'], c1: ['C', 'pop'], grid: ['D', 'pop'] };
  const info = (id) => (meta[id] ? { artistId: meta[id][0], genre: meta[id][1], bayes: 6 } : null);
  const recs = recommendations(from, to, info);
  assert.ok(!recs.includes('seen') && !recs.includes('done'), 'ni noté ni complété');
  assert.equal(recs.filter((id) => id.startsWith('a')).length, 2, '2 albums par artiste au plus');
  // a1 (10) d'abord ; b1 (8 + 1,5 de bonus : le jazz est le genre du destinataire) passe devant a2 et grid (9).
  assert.deepEqual(recs, ['a1', 'b1', 'a2', 'grid', 'c1']);
  assert.ok(recs.length <= 6);
  assert.ok(recs.includes('grid'), 'un album de « Mes 9 albums » non noté compte comme adoré');
});

// ----- application -----------------------------------------------------------------------------------

const app = await startApp();
test.after(() => app.close());
const { db, deps } = app;

let n = 0;
const player = (name) => signupVerified(app, { username: name || `tm_${++n}` });
const call = (who, method, p, body) => api(app.base, who?.cookie || '', method, p, body);
const befriend = (a, b) => {
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
    .run(a.user.id, b.user.id, Date.now(), Date.now());
  deps.match.forget(a.user.id);
};
const rate = (who, type, id, score) => deps.ratings.rate(who.user.id, type, id, score);
const albums = db.prepare("SELECT id, artist_id, genre FROM cat_albums WHERE status = 'active' ORDER BY id").all();
const pair = (a, b) => db.prepare('SELECT * FROM taste_matches WHERE user_a = ? AND user_b = ?').get(Math.min(a.user.id, b.user.id), Math.max(a.user.id, b.user.id));

test('GET /match/:username : score, composantes, en commun, différences, recommandations dans les deux sens', async () => {
  const leo = await player();
  const cam = await player();
  // Huit albums notés pareil (dont 6 adorés), un gros désaccord, un morceau aimé des deux, et chacun un album adoré
  // que l'autre n'a pas noté.
  const common = albums.slice(0, 8);
  for (const [i, a] of common.entries()) {
    rate(leo, 'album', a.id, i < 6 ? 9 : 6);
    rate(cam, 'album', a.id, i < 6 ? 9 : 7);
  }
  rate(leo, 'album', albums[8].id, 10);
  rate(cam, 'album', albums[8].id, 2);
  rate(leo, 'track', 'discovery:01', 9);
  rate(cam, 'track', 'discovery:01', 10);
  rate(leo, 'album', albums[10].id, 10);
  rate(cam, 'album', albums[11].id, 9);

  const r = await call(leo, 'GET', `/match/${cam.username}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const m = r.body;
  assert.ok(m.score >= 60 && m.score <= 100, `score ${m.score}`);
  assert.equal(m.confidence, 'medium');
  assert.equal(m.estimate, false);
  assert.equal(m.user.username, cam.username);
  assert.deepEqual(m.components.map((c) => c.key), ['ratings', 'loved', 'artists', 'genres', 'decades']);
  const ratings = m.components.find((c) => c.key === 'ratings');
  assert.equal(ratings.vars.n, 10, '9 albums et 1 morceau notés en commun');
  assert.ok(m.shared.albums.length >= 6 && m.shared.albums.every((id) => common.some((a) => a.id === id)));
  assert.deepEqual(m.shared.tracks, ['discovery:01']);
  assert.ok(m.shared.genres.length >= 1);
  assert.deepEqual(m.differences, [{ type: 'album', id: albums[8].id, mine: 10, theirs: 2 }]);
  assert.ok(m.recommendsToThem.includes(albums[10].id), 'je recommande mon album adoré qu’elle n’a pas noté');
  assert.ok(m.recommendsToMe.includes(albums[11].id), 'elle me recommande le sien');
  assert.ok(!m.recommendsToMe.includes(albums[8].id), 'un album que j’ai déjà noté n’est jamais recommandé');
  assert.ok(m.catalog.albums.some((a) => a.id === albums[11].id), 'les albums du résultat sont dans `catalog`');
  assert.ok(m.catalog.tracks.some((t) => t.id === 'discovery:01'));

  // Vu de l'autre côté : même score, rôles inversés.
  const back = (await call(cam, 'GET', `/match/${leo.username}`)).body;
  assert.equal(back.score, m.score);
  assert.deepEqual(back.differences, [{ type: 'album', id: albums[8].id, mine: 2, theirs: 10 }]);
  assert.deepEqual(back.recommendsToMe, m.recommendsToThem);

  assert.equal((await call(leo, 'GET', `/match/${leo.username}`)).status, 400);
  assert.equal((await call(leo, 'GET', '/match/personne_ici')).status, 404);
  assert.equal((await call(null, 'GET', `/match/${cam.username}`)).status, 401);
});

test('joueurs sans notes : estimation (confiance basse), jamais d’erreur', async () => {
  const a = await player();
  const b = await player();
  const r = await call(a, 'GET', `/match/${b.username}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.confidence, 'low');
  assert.equal(r.body.estimate, true);
  assert.equal(r.body.hasData, false);
  assert.ok(Number.isInteger(r.body.score));
});

test('confidentialité : blocages dans les deux sens, Studio privé, réservé aux amis (403 match_unavailable)', async () => {
  const me = await player();
  const blocked = await player();
  const blocker = await player();
  const priv = await player();
  const friendsOnly = await player();
  const friend = await player();
  await call(me, 'PUT', `/blocks/${blocked.user.id}`);
  await call(blocker, 'PUT', `/blocks/${me.user.id}`);
  db.prepare("UPDATE users SET profile_visibility = 'private' WHERE id = ?").run(priv.user.id);
  db.prepare("UPDATE users SET profile_visibility = 'friends' WHERE id IN (?, ?)").run(friendsOnly.user.id, friend.user.id);
  befriend(me, friend);
  for (const who of [blocked, blocker, priv, friendsOnly]) {
    const r = await call(me, 'GET', `/match/${who.username}`);
    assert.equal(r.status, 403, who.username);
    assert.equal(r.body.error, 'match_unavailable');
  }
  assert.equal((await call(blocked, 'GET', `/match/${me.username}`)).status, 403, 'le bloqué ne voit pas non plus');
  assert.equal((await call(me, 'GET', `/match/${friend.username}`)).status, 200, 'Studio réservé aux amis : un ami peut comparer');

  const batch = await call(me, 'GET', `/match/batch?usernames=${[blocked, blocker, priv, friendsOnly, friend].map((u) => u.username).join(',')}`);
  assert.equal(batch.status, 200);
  assert.deepEqual(Object.entries(batch.body.scores).filter(([, s]) => s !== null).map(([u]) => u), [], 'aucun score pour eux (le seul ami n’a pas de données)');
  assert.ok(friend.username in batch.body.scores);
});

test('cache taste_matches : paire rangée, réutilisée, recalculée après 6 h ou 5 notes ; tâche taste-cache', async () => {
  const a = await player();
  const b = await player();
  for (const al of albums.slice(0, 4)) {
    rate(a, 'album', al.id, 8);
    rate(b, 'album', al.id, 8);
  }
  const first = (await call(b, 'GET', `/match/${a.username}`)).body;
  const row = pair(a, b);
  assert.ok(row && row.user_a < row.user_b, 'paire rangée avec user_a < user_b');
  assert.equal(row.score, first.score);
  const again = (await call(a, 'GET', `/match/${b.username}`)).body;
  assert.equal(again.computedAt, first.computedAt, 'servi par le cache');
  assert.equal(deps.match.cachedScore(a.user.id, b.user.id), first.score);
  assert.equal(deps.match.cachedScore(b.user.id, a.user.id), first.score);

  // 4 notes de plus : toujours le cache ; à la 5e, recalcul.
  for (const al of albums.slice(4, 8)) rate(a, 'album', al.id, 3);
  assert.equal((await call(a, 'GET', `/match/${b.username}`)).body.computedAt, first.computedAt);
  rate(a, 'album', albums[8].id, 3);
  const recount = (await call(a, 'GET', `/match/${b.username}`)).body;
  assert.ok(recount.computedAt >= first.computedAt && pair(a, b).computed_at === recount.computedAt);
  assert.notEqual(JSON.parse(pair(a, b).data).counts.a, JSON.parse(row.data).counts.a);

  // Plus de 6 h : recalcul.
  const old = Date.now() - MATCH_TTL_MS - 1000;
  db.prepare('UPDATE taste_matches SET computed_at = ? WHERE user_a = ? AND user_b = ?').run(old, row.user_a, row.user_b);
  const stale = (await call(a, 'GET', `/match/${b.username}`)).body;
  assert.ok(stale.computedAt > old);

  // Tâche nocturne : les paires de plus de 7 jours partent.
  db.prepare('UPDATE taste_matches SET computed_at = ? WHERE user_a = ? AND user_b = ?').run(Date.now() - MATCH_PURGE_MS - 1000, row.user_a, row.user_b);
  assert.equal(deps.match.cachedScore(a.user.id, b.user.id), null, 'cachedScore ne rend pas une paire trop vieille');
  const { jobs } = await import('../match.js');
  const res = jobs.find((j) => j.name === 'taste-cache').run(deps);
  assert.ok(res.pairs >= 1);
  assert.equal(pair(a, b), undefined);
});

test('GET /match/batch : 30 pseudos au plus, 5 calculs neufs par appel, les autres « pending »', async () => {
  const me = await player();
  rate(me, 'album', albums[0].id, 9);
  const others = [];
  for (let i = 0; i < 8; i++) {
    const u = await player();
    rate(u, 'album', albums[0].id, 9);
    others.push(u);
  }
  const names = others.map((u) => u.username).join(',');
  const r1 = (await call(me, 'GET', `/match/batch?usernames=${names},inconnu_zz`)).body;
  assert.equal(Object.keys(r1.scores).length, 9);
  assert.equal(r1.scores.inconnu_zz, null);
  assert.equal(r1.pending.length, 3, '5 calculs neufs au plus');
  const r2 = (await call(me, 'GET', `/match/batch?usernames=${names}`)).body;
  assert.equal(r2.pending.length, 0, 'au second appel, les paires en cache et les 3 restantes');
  assert.ok(Object.values(r2.scores).every((s) => Number.isInteger(s)));
  const many = Array.from({ length: 40 }, (_, i) => `x${i}`).join(',');
  assert.equal(Object.keys((await call(me, 'GET', `/match/batch?usernames=${many}`)).body.scores).length, 30);
});

test('amis suggérés : goûts proches, amis d’amis, artistes favoris ; ni amis, ni demandes, ni bloqués', async () => {
  const me = await player();
  const twin = await player();
  const friend = await player();
  const fof = await player();
  const fan = await player();
  const blocked = await player();
  const pending = await player();
  const loved = albums.slice(0, 6);
  for (const al of loved) {
    rate(me, 'album', al.id, 9);
    rate(twin, 'album', al.id, 9);
    rate(blocked, 'album', al.id, 9);
    rate(pending, 'album', al.id, 9);
  }
  befriend(me, friend);
  befriend(friend, fof);
  for (const who of [me, fan]) {
    for (const [position, artist] of ['daft-punk', 'air', 'adele'].entries()) {
      db.prepare("INSERT INTO user_favorites (user_id, kind, item_id, position, created_at) VALUES (?, 'artist', ?, ?, ?)").run(who.user.id, artist, position, Date.now());
    }
  }
  deps.match.forget(me.user.id);
  await call(me, 'PUT', `/blocks/${blocked.user.id}`);
  db.prepare("INSERT OR IGNORE INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(me.user.id, pending.user.id, Date.now());
  const r = await call(me, 'GET', '/match/suggestions');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.items.map((s) => [s.user.username, s]));
  assert.ok(by[twin.username], 'jumeau de goûts suggéré');
  assert.equal(by[twin.username].reason, 'taste');
  assert.ok(by[twin.username].score >= 70);
  assert.ok(by[fof.username], 'ami d’ami suggéré');
  assert.equal(by[fof.username].mutualFriends, 1);
  assert.ok(by[fan.username], 'fan des mêmes artistes suggéré');
  for (const who of [friend, blocked, pending, me]) assert.ok(!by[who.username], `${who.username} exclu`);
  assert.equal(r.body.friendCount, 1);
  assert.ok(r.body.items.length <= 8);
});

test('GET /match/top : l’ami le plus proche (carte de l’accueil), rien sans ami', async () => {
  const me = await player();
  const close = await player();
  const far = await player();
  assert.equal((await call(me, 'GET', '/match/top')).body.match, null);
  befriend(me, close);
  befriend(me, far);
  for (const al of albums.slice(0, 6)) {
    rate(me, 'album', al.id, 9);
    rate(close, 'album', al.id, 9);
    rate(far, 'album', al.id, 1);
  }
  deps.match.forget(me.user.id);
  const r = (await call(me, 'GET', '/match/top')).body;
  assert.equal(r.friendCount, 2);
  assert.equal(r.match.user.username, close.username);
  assert.ok(r.match.score > 60);
  assert.ok(Array.isArray(r.match.components) && r.match.shared);
});

// ----- base peuplée ------------------------------------------------------------------------------------

const PERF_DB = process.env.PERF_DB;
test('base peuplée (PERF_DB) : paires au hasard vers 40–60, profils proches > 80, < 15 ms par paire', { skip: !PERF_DB && 'PERF_DB non défini' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-match-'));
  const file = path.join(dir, 'perf.db');
  try {
    fs.copyFileSync(PERF_DB, file);
    const { openDb } = await import('../db.js');
    const { createApp } = await import('../app.js');
    const pdb = openDb(file);
    const { deps: d } = createApp({ db: pdb });
    const users = pdb.prepare('SELECT user_id FROM ratings GROUP BY user_id HAVING COUNT(*) >= 10 ORDER BY user_id').all().map((r) => r.user_id);
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    d.match.profileOf(users[0]);
    const scores = [];
    const times = [];
    while (scores.length < 300) {
      const a = users[Math.floor(rand() * users.length)];
      const b = users[Math.floor(rand() * users.length)];
      if (a === b) continue;
      d.match.forget(a);
      d.match.forget(b);
      const started = performance.now();
      const s = d.match.scoreBetween(a, b);
      times.push(performance.now() - started);
      if (s != null) scores.push(s);
    }
    scores.sort((x, y) => x - y);
    times.sort((x, y) => x - y);
    const median = scores[scores.length >> 1];
    assert.ok(median >= 35 && median <= 60, `médiane des paires au hasard : ${median}`);
    assert.ok(times[times.length >> 1] < 15, `médiane du coût d'une paire : ${times[times.length >> 1]} ms`);

    // Profil proche : un joueur ordinaire recopié avec des notes à un point près.
    const src = users[10];
    const now = Date.now();
    const twin = Number(pdb.prepare("INSERT INTO users (email, username, password_hash, packs_at, created_at, email_verified_at) VALUES ('twin@example.com', 'twin_perf', 'x', ?, ?, ?)").run(now, now, now).lastInsertRowid);
    pdb.prepare(`INSERT INTO ratings (user_id, item_type, item_id, score, created_at, updated_at)
      SELECT ?, item_type, item_id, MAX(0, MIN(10, score + (id % 3) - 1)), ?, ? FROM ratings WHERE user_id = ?`).run(twin, now, now, src);
    pdb.prepare(`INSERT INTO user_album_progress (user_id, album_id, owned, total, first_at, updated_at)
      SELECT ?, album_id, owned, total, first_at, updated_at FROM user_album_progress WHERE user_id = ?`).run(twin, src);
    const close = d.match.scoreBetween(src, twin);
    assert.ok(close > 80, `profils proches : ${close}`);
    pdb.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
