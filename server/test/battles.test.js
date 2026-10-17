// Duels et classements (PLAN.md 5.4, chantier P1-F) : jetons signés (contrefaçon, autre joueur, expiration), un vote par
// paire, calculs Elo, mise à jour de toutes les catégories communes, anti-brigade, « provisoire » sous 50 votes, ordre
// des classements, hub, « Autour de l'album », « Je ne connais pas », quota quotidien, XP, albums retirés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startApp, signupVerified, api } from './helpers.js';
import {
  albumCategories, brigadeFactor, eloUpdate, expected, isListed, isProvisional, kFactor, parseCategory, seedRating, sharedCategories,
} from '../../shared/battles.js';

const app = await startApp();
test.after(() => app.close());
const { db } = app;

let n = 0;
const player = async (name, { old = true } = {}) => {
  const p = await signupVerified(app, { username: name || `bt_${++n}` });
  // Compte de plus de 24 h : K normal (les comptes neufs votent à K × 0,5).
  if (old) db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(Date.now() - 3 * 86_400_000, p.user.id);
  return p;
};
const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
const enc = encodeURIComponent;
const secret = () => db.prepare("SELECT value FROM kv WHERE key = 'secret'").get().value;
/** Jeton fabriqué avec le vrai secret (pour tester l'expiration et la vérification du contenu). */
function forge(payload, key = secret()) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${crypto.createHmac('sha256', key).update(data).digest('base64url')}`;
}
const next = (who, category, n2 = 1) => call(who, 'GET', `/battles/next?n=${n2}${category ? `&category=${enc(category)}` : ''}`);
const vote = (who, token, winner, extra = {}) => call(who, 'POST', '/battles/vote', { token, winner, ...extra });
const rating = (category, id) => db.prepare("SELECT rating, votes, wins FROM battle_ratings WHERE category = ? AND item_type = 'album' AND item_id = ?").get(category, id);

test('Elo : attendu, K selon les votes, mise à jour, note de départ, anti-brigade, provisoire', () => {
  assert.equal(expected(1500, 1500), 0.5);
  assert.ok(Math.abs(expected(1700, 1500) - 0.7597) < 1e-4);
  assert.equal(kFactor(0), 32);
  assert.equal(kFactor(29), 32);
  assert.equal(kFactor(30), 24);
  assert.equal(kFactor(99), 24);
  assert.equal(kFactor(100), 16);
  const r = eloUpdate({ rating: 1500, votes: 0 }, { rating: 1500, votes: 0 }, 'a');
  assert.deepEqual([r.deltaA, r.deltaB], [16, -16]);
  const upset = eloUpdate({ rating: 1400, votes: 50 }, { rating: 1600, votes: 200 }, 'a');
  assert.ok(Math.abs(upset.deltaA - 24 * (1 - expected(1400, 1600))) < 1e-9);
  assert.ok(Math.abs(upset.deltaB + 16 * (1 - expected(1400, 1600))) < 1e-9);
  // R0 = 1500 + 60 × (bayes − 6,5), bayes = (sum + 10 × 6) / (count + 10), borné à ± 200.
  assert.equal(seedRating({ count: 0, sum: 0 }), 1470);
  assert.equal(seedRating({ count: 10, sum: 100 }), 1500 + 60 * (8 - 6.5));
  assert.equal(seedRating({ count: 1000, sum: 10_000 }), 1700);
  assert.equal(seedRating({ count: 1000, sum: 0 }), 1300);
  assert.equal(brigadeFactor({ votesOnItemToday: 9 }), 1);
  assert.equal(brigadeFactor({ votesOnItemToday: 10 }), 0.25);
  assert.equal(brigadeFactor({ votesOnItemToday: 0, accountAgeMs: 3_600_000 }), 0.5);
  assert.equal(brigadeFactor({ votesOnItemToday: 12, accountAgeMs: 3_600_000 }), 0.125);
  assert.equal(isProvisional(49), true);
  assert.equal(isProvisional(50), false);
  assert.equal(isListed(19), false);
  assert.equal(isListed(20), true);
  assert.equal(isListed(3, 3), true, 'petite catégorie complète');
  assert.equal(isListed(1, 1), false);
});

test('catégories : clés valides, catégories communes d’un duel', () => {
  assert.deepEqual(parseCategory('genre_decade:rap:1990'), { key: 'genre_decade:rap:1990', kind: 'genre_decade', itemType: 'album', value: 'rap', value2: 1990 });
  assert.equal(parseCategory('album_tracks:discovery').itemType, 'track');
  for (const bad of ['', 'global:track', 'decade:1995', 'year:99', 'genre:Rock', 'artist:', 'country:fr', 'nope:x', 'artist:a:b']) {
    assert.equal(parseCategory(bad), null, bad);
  }
  const a = { artistId: 'daft-punk', year: 2001, genre: 'electro', country: 'FR' };
  const b = { artistId: 'daft-punk', year: 2007, genre: 'electro', country: 'FR' };
  assert.deepEqual(sharedCategories('album', a, b).sort(), ['artist:daft-punk', 'country:FR', 'decade:2000', 'genre:electro', 'genre_decade:electro:2000', 'global:album'].sort());
  assert.deepEqual(albumCategories({ year: 1977 }), ['global:album', 'decade:1970', 'year:1977']);
});

test('GET /api/battles/next : duels signés, paires ordonnées, catégorie demandée ou mélange', async () => {
  const me = await player();
  const r = await next(me, null, 3);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.duels.length >= 1 && r.body.duels.length <= 3);
  for (const d of r.body.duels) {
    assert.ok(d.a < d.b, 'a < b');
    assert.equal(d.itemType, 'album');
    assert.ok(parseCategory(d.category));
    assert.match(d.token, /^[\w-]+\.[\w-]+$/);
    assert.ok(r.body.catalog.albums.some((x) => x.id === d.a) && r.body.catalog.albums.some((x) => x.id === d.b));
  }
  assert.ok(parseCategory(r.body.featured));
  const artist = await next(me, 'artist:daft-punk', 3);
  assert.equal(artist.status, 200);
  assert.deepEqual([artist.body.duels[0].a, artist.body.duels[0].b], ['discovery', 'random-access-memories']);
  assert.equal(artist.body.duels.length, 1, 'une seule paire possible dans cette catégorie');
  assert.equal((await next(me, 'artist:nobody-here')).status, 404);
  assert.equal((await next(me, 'n’importe quoi')).body.error, 'unknown_category');
  // Duels de morceaux d'un même album.
  const tracks = await next(me, 'album_tracks:discovery', 2);
  assert.equal(tracks.status, 200);
  assert.equal(tracks.body.duels[0].itemType, 'track');
  assert.ok(tracks.body.catalog.tracks.length >= 2);
});

test('jetons : contrefaçon, autre joueur, expiration, contenu incohérent → 400 bad_token', async () => {
  const me = await player();
  const other = await player();
  const { duels } = (await next(me, 'global:album')).body;
  const token = duels[0].token;
  const [data, sig] = token.split('.');
  const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
  const tampered = `${Buffer.from(JSON.stringify({ ...payload, a: payload.b, b: payload.a })).toString('base64url')}.${sig}`;
  for (const bad of [tampered, `${data}.${sig.slice(0, -2)}xx`, 'abc', '', null, 42, `${data}.${sig}.x`]) {
    const r = await vote(me, bad, 'a');
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.body.error, 'bad_token');
  }
  assert.equal((await vote(other, token, 'a')).body.error, 'bad_token', 'le jeton d’un autre joueur');
  const expired = forge({ ...payload, e: Date.now() - 1 });
  assert.equal((await vote(me, expired, 'a')).body.error, 'bad_token');
  // Signé avec un autre secret, ou une catégorie qui ne contient pas les deux albums.
  assert.equal((await vote(me, forge(payload, 'x'.repeat(64)), 'a')).body.error, 'bad_token');
  assert.equal((await vote(me, forge({ ...payload, c: 'artist:daft-punk' }), 'a')).body.error, 'bad_token');
  assert.equal((await vote(me, token, 'c')).status, 400);
  assert.equal((await vote(me, token, undefined)).status, 400);
  // Le vrai jeton marche toujours.
  assert.equal((await vote(me, token, 'a')).status, 200);
});

test('vote : un par paire, Elo mis à jour dans toutes les catégories communes, XP des 20 premiers votes', async () => {
  const me = await player();
  const { duels } = (await next(me, 'artist:daft-punk')).body;
  const d = duels[0];
  const user0 = db.prepare('SELECT xp FROM users WHERE id = ?').get(me.user.id).xp;
  const r = await vote(me, d.token, 'a', { category: 'artist:daft-punk' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Notes de départ égales (aucune note de la communauté) et compte ancien : K = 32, ± 16.
  assert.deepEqual([r.body.deltaA, r.body.deltaB], [16, -16]);
  assert.deepEqual([r.body.ratingA, r.body.ratingB], [1486, 1454]);
  assert.equal(r.body.xp, 5);
  assert.equal(r.body.todayCount, 1);
  assert.equal(r.body.next, null, 'plus aucune paire dans cette catégorie');
  assert.ok(r.body.state?.partial);
  assert.equal(db.prepare('SELECT xp FROM users WHERE id = ?').get(me.user.id).xp - user0, 5);
  const row = db.prepare('SELECT winner_id, context, categories, counted FROM battle_votes WHERE user_id = ?').get(me.user.id);
  assert.equal(row.winner_id, d.a);
  assert.equal(row.counted, 1);
  const cats = JSON.parse(row.categories);
  assert.ok(cats.includes('global:album') && cats.includes('artist:daft-punk') && cats.includes('genre:electro'), cats.join());
  for (const c of cats) {
    const ra = rating(c, d.a);
    const rb = rating(c, d.b);
    assert.ok(ra && rb, c);
    assert.equal(ra.votes, 1);
    assert.equal(ra.wins, 1);
    assert.equal(rb.wins, 0);
    assert.ok(ra.rating > rb.rating);
  }
  const again = await vote(me, d.token, 'b');
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_voted');
  // Un nouveau jeton pour la même paire : toujours refusé ; la paire n'est plus proposée.
  const payload = JSON.parse(Buffer.from(d.token.split('.')[0], 'base64url').toString());
  assert.equal((await vote(me, forge({ ...payload, c: 'global:album', e: Date.now() + 60_000 }), 'b')).body.error, 'already_voted');
  assert.equal((await next(me, 'artist:daft-punk')).body.error, 'no_duel');
});

test('XP : 5 par vote pour les 20 premiers votes comptés du jour, puis 0', async () => {
  const me = await player();
  let xp = 0;
  let votes = 0;
  let token = (await next(me, 'global:album')).body.duels[0].token;
  while (votes < 22 && token) {
    const r = await vote(me, token, votes % 2 ? 'a' : 'b', { category: 'global:album' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    xp += r.body.xp;
    votes += 1;
    token = r.body.next?.duels?.[0]?.token;
  }
  assert.equal(votes, 22);
  assert.equal(xp, 100);
});

test('« Je ne connais pas » : la paire est gardée (plus proposée), rien d’autre ne change', async () => {
  const me = await player();
  const d = (await next(me, 'artist:kanye-west')).body.duels[0];
  const before = rating('artist:kanye-west', d.a);
  const r = await vote(me, d.token, null);
  assert.equal(r.status, 200);
  assert.equal(r.body.skipped, true);
  assert.equal(r.body.xp, 0);
  assert.deepEqual(rating('artist:kanye-west', d.a), before);
  assert.equal(db.prepare('SELECT counted FROM battle_votes WHERE user_id = ?').get(me.user.id).counted, 0);
  assert.equal((await next(me, 'artist:kanye-west')).status, 404);
});

test('anti-brigade : au-delà de 10 votes du même joueur sur un album dans la journée, K × 0,25 ; compte neuf × 0,5', async () => {
  const me = await player();
  const key = secret();
  const albums = db.prepare("SELECT id FROM cat_albums WHERE id <> 'thriller' ORDER BY id").all().map((r) => r.id);
  const deltas = [];
  for (const other of albums.slice(0, 12)) {
    const [a, b] = ['thriller', other].sort();
    const token = forge({ u: me.user.id, t: 'album', a, b, c: 'global:album', e: Date.now() + 60_000 }, key);
    const before = rating('global:album', 'thriller');
    const r = await vote(me, token, a === 'thriller' ? 'a' : 'b');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = rating('global:album', 'thriller');
    deltas.push((after.rating - (before?.rating ?? after.rating - (a === 'thriller' ? r.body.deltaA : r.body.deltaB))));
  }
  // Les 10 premiers votes à plein K, les suivants au quart.
  assert.ok(deltas[10] < deltas[0] * 0.4, `${deltas[0]} → ${deltas[10]}`);
  assert.ok(deltas[9] > deltas[0] * 0.4);
  // Compte de moins de 24 h : moitié du K.
  const fresh = await player(null, { old: false });
  const d = (await next(fresh, 'artist:eminem')).body.duels[0];
  const ra = rating('artist:eminem', d.a);
  const rb = rating('artist:eminem', d.b);
  const r = await vote(fresh, d.token, 'a');
  assert.equal(r.status, 200);
  const k = kFactor(ra?.votes ?? 0) * 0.5;
  const want = k * (1 - expected(ra?.rating ?? seedRating(), rb?.rating ?? seedRating()));
  assert.ok(Math.abs(r.body.deltaA - want) < 0.06, `K × 0,5 : ${r.body.deltaA} ≈ ${want}`);
});

test('quota : 200 votes par jour (429), compteur quotidien', async () => {
  const me = await player();
  const ins = db.prepare(`INSERT INTO battle_votes (user_id, item_type, a_id, b_id, winner_id, context, counted, created_at)
    VALUES (?, 'album', ?, ?, NULL, 'global:album', 1, ?)`);
  for (let i = 0; i < 200; i++) ins.run(me.user.id, `q${String(i).padStart(3, '0')}`, `r${i}`, Date.now());
  const d = (await next(me, 'global:album')).body.duels[0];
  const r = await vote(me, d.token, 'a');
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'quota_exceeded');
  assert.equal(r.body.kind, 'battle_votes');
});

test('classements : ordre des notes, provisoire sous 50 votes, pagination, hub, « Autour de l’album »', async () => {
  // Vingt albums classés dans global:album, notes posées directement.
  const albums = db.prepare('SELECT id FROM cat_albums ORDER BY id').all().map((r) => r.id);
  const now = Date.now();
  const up = db.prepare(`INSERT OR REPLACE INTO battle_ratings (category, item_type, item_id, rating, votes, wins, updated_at)
    VALUES ('global:album', 'album', ?, ?, ?, ?, ?)`);
  albums.forEach((id, i) => up.run(id, 1300 + i * 20, i === 0 ? 120 : 10 + i, 5, now));
  const me = await player();
  const r = await call(me, 'GET', '/rankings/global:album?limit=5');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.total, albums.length);
  assert.deepEqual(r.body.items.map((x) => x.rank), [1, 2, 3, 4, 5]);
  assert.equal(r.body.items[0].id, albums[albums.length - 1]);
  assert.ok(r.body.items.every((x, i, all) => i === 0 || all[i - 1].rating >= x.rating));
  assert.ok(r.body.items.every((x) => x.provisional === x.votes < 50));
  assert.ok(r.body.nextCursor);
  const p2 = await call(me, 'GET', `/rankings/global:album?limit=5&cursor=${r.body.nextCursor}`);
  assert.equal(p2.body.items[0].rank, 6);
  assert.ok(r.body.catalog.albums.length === 5);
  assert.equal((await call(me, 'GET', '/rankings/nope')).status, 404);
  // Le plus voté n'est pas provisoire.
  const last = await call(me, 'GET', '/rankings/global:album?limit=50');
  assert.equal(last.body.items.find((x) => x.id === albums[0]).provisional, false);
  assert.equal(last.body.listed, true);
  // Hub : global:album listé (20 éléments) avec son podium.
  const hub = await call(me, 'GET', '/rankings');
  assert.equal(hub.status, 200);
  const global = hub.body.categories.find((c) => c.key === 'global:album');
  assert.ok(global, JSON.stringify(hub.body.categories));
  assert.equal(global.top[0], albums[albums.length - 1]);
  // « Autour de l'album » : son rang dans global.
  const around = await call(me, 'GET', `/items/album/${albums[0]}/rankings`);
  assert.equal(around.status, 200);
  const g = around.body.items.find((x) => x.category === 'global:album');
  assert.equal(g.rank, albums.length);
  assert.equal(g.total, albums.length);
  assert.ok(parseCategory(around.body.vote));
  assert.equal((await call(me, 'GET', '/items/album/inconnu/rankings')).status, 404);
  assert.equal((await call(me, 'GET', '/items/artist/x/rankings')).status, 404);
});

test('albums retirés : jamais proposés, absents des classements', async () => {
  const me = await player();
  db.prepare("UPDATE cat_albums SET status = 'withdrawn' WHERE id = 'graduation'").run();
  try {
    assert.equal((await next(me, 'artist:kanye-west')).status, 404, 'un seul album actif : plus de duel');
    for (let i = 0; i < 5; i++) {
      const { duels } = (await next(me, 'genre:rap', 3)).body;
      for (const d of duels) assert.ok(d.a !== 'graduation' && d.b !== 'graduation');
    }
    db.prepare(`INSERT OR REPLACE INTO battle_ratings (category, item_type, item_id, rating, votes, wins, updated_at)
      VALUES ('genre:rap', 'album', 'graduation', 1900, 3, 3, ?)`).run(Date.now());
    const r = await call(me, 'GET', '/rankings/genre:rap?limit=50');
    assert.ok(!r.body.items.some((x) => x.id === 'graduation'));
  } finally {
    db.prepare("UPDATE cat_albums SET status = 'active' WHERE id = 'graduation'").run();
  }
});

test('sans session : 401 ; sans en-tête anti-CSRF : 403', async () => {
  assert.equal((await call(null, 'GET', '/battles/next')).status, 401);
  assert.equal((await call(null, 'GET', '/rankings')).status, 401);
  const me = await player();
  const res = await fetch(`${app.base}/api/battles/vote`, { method: 'POST', headers: { Cookie: me.cookie, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});
