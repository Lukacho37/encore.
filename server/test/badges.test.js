// Badges (PLAN.md 5.7, chantier P1-F) : seuils de chaque famille, réévaluation par les événements du bus, rattrapage
// une seule fois (et en silence) pour les joueurs d'avant, jamais deux fois le même badge, récompenses de chaque
// palier (royalties, booster, titre), notification, fil d'actualité pour l'or, message du site, vue des autres
// joueurs (gagnés seulement, Studio privé, blocages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';
import { FAMILIES, badgeKey, parseBadgeKey, rewardFor, tierProgress } from '../../shared/badges.js';

const app = await startApp();
test.after(() => app.close());
const { db, deps, services } = app;

let n = 0;
const player = (name) => signupVerified(app, { username: name || `bd_${++n}` });
const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
const earned = (who) => db.prepare("SELECT key FROM achievements WHERE user_id = ? AND key >= 'badge:' AND key < 'badge;' ORDER BY key")
  .all(who.user.id).map((r) => r.key);
const has = (who, key) => earned(who).includes(key);
const evaluate = (who, family, variant = null) => deps.badges.evaluate(who.user.id, family, variant);
const userRow = (who) => db.prepare('SELECT royalties, xp, bonus_packs FROM users WHERE id = ?').get(who.user.id);

// ----- petit catalogue de test (albums, artistes, morceaux) --------------------------------------------------
let seq = 3000;
function makeAlbum({ genre = 'rock', year = 1995, tracks = 3, artistId = null, rarity = 'common' } = {}) {
  seq += 1;
  const id = `zz-al-${seq}`;
  const artist = artistId || `zz-ar-${seq}`;
  const now = Date.now();
  db.prepare("INSERT OR IGNORE INTO cat_artists (id, name, source, created_at) VALUES (?, ?, 'test', ?)").run(artist, `Artiste ${seq}`, now);
  db.prepare(`INSERT INTO cat_albums (id, artist_id, title, year, genre, catalog, track_count, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'test', ?)`).run(id, artist, `Album ${seq}`, year, genre, seq, tracks, now);
  const ids = [];
  for (let i = 1; i <= tracks; i++) {
    const tid = `${id}:${String(i).padStart(2, '0')}`;
    db.prepare(`INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, year, genre, pop, rarity, source, created_at)
      VALUES (?, 'album', ?, ?, ?, ?, ?, ?, ?, 50, ?, 'test', ?)`).run(tid, id, artist, i, tracks, `Titre ${i}`, year, genre, rarity, now);
    ids.push(tid);
  }
  return { id, artist, tracks: ids };
}
const complete = (who, albumId, at = Date.now(), rank = null) => db.prepare('INSERT OR IGNORE INTO achievements (user_id, key, created_at, rank) VALUES (?, ?, ?, ?)')
  .run(who.user.id, `album:${albumId}`, at, rank);
const started = (who, albumId) => db.prepare(`INSERT OR REPLACE INTO user_album_progress (user_id, album_id, owned, holo, total, first_at, updated_at)
  VALUES (?, ?, 1, 0, 3, ?, ?)`).run(who.user.id, albumId, Date.now(), Date.now());
const card = (who, trackId) => db.prepare(`INSERT OR IGNORE INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, 'std', 1, ?)`)
  .run(who.user.id, trackId, Date.now());
const LONG = 'Une critique assez longue pour compter : la production, les voix, les arrangements et la façon dont chaque morceau '
  + 'répond au précédent font de ce disque un classique que je réécoute souvent, surtout le soir avec un casque.';

test('définitions : ≈ 30 médailles, clés lisibles, récompenses des paliers', () => {
  const medals = FAMILIES.reduce((s, f) => s + (f.variants && !f.hiddenUntilEarned ? f.variants.length : 1), 0);
  assert.ok(medals >= 22 && medals <= 34, `médailles affichées : ${medals}`);
  assert.deepEqual(parseBadgeKey('badge:explorer:1990:bronze'), { family: 'explorer', variant: 1990, tier: 'bronze' });
  assert.deepEqual(parseBadgeKey('badge:vinyl:gold'), { family: 'vinyl', variant: null, tier: 'gold' });
  assert.equal(parseBadgeKey('badge:vinyl:diamond'), null);
  assert.equal(parseBadgeKey('badge:explorer:1955:bronze'), null);
  assert.equal(parseBadgeKey('album:discovery'), null);
  assert.deepEqual(rewardFor('vinyl', 'bronze'), { xp: 50, royalties: 0 });
  assert.deepEqual(rewardFor('vinyl', 'silver'), { xp: 150, royalties: 100 });
  assert.deepEqual(rewardFor('vinyl', 'gold'), { xp: 400, royalties: 0, boosters: 1 });
  assert.deepEqual(rewardFor('vinyl', 'platinum'), { xp: 1000, royalties: 0, cosmetic: 'title:vinylophile' });
  assert.deepEqual(tierProgress('explorer', { albums: 12, completed: 1 }).map((t) => [t.tier, t.reached, t.progress]), [['bronze', true, 10], ['silver', false, 1]]);
});

test('seuils : chaque famille gagne ses paliers au bon moment', async () => {
  const me = await player();
  const friend1 = await player();
  const friend2 = await player();
  const friend3 = await player();
  // Vinyles : 1 → bronze, 10 → argent.
  const rocks = Array.from({ length: 10 }, () => makeAlbum({ genre: 'rock', year: 1994 }));
  complete(me, rocks[0].id, Date.now(), 4);
  evaluate(me, 'vinyl');
  assert.ok(has(me, 'badge:vinyl:bronze'));
  assert.ok(!has(me, 'badge:vinyl:silver'));
  for (const a of rocks.slice(1)) complete(me, a.id, Date.now(), 40);
  evaluate(me, 'vinyl');
  assert.ok(has(me, 'badge:vinyl:silver'));
  assert.ok(!has(me, 'badge:vinyl:gold'));
  // Premier pressage : un album complété parmi ses 10 premiers joueurs (rang 4 ci-dessus).
  evaluate(me, 'first_press');
  assert.ok(has(me, 'badge:first_press:gold'));
  // Fan de rock : 5 complétions dans le genre (10 ici) ; explorateur des années 90 : argent (3 complétions), bronze
  // demande des cartes de 10 albums de la décennie.
  evaluate(me, 'genre_fan', 'rock');
  assert.ok(has(me, 'badge:genre_fan:rock:silver'));
  evaluate(me, 'explorer', 1990);
  assert.ok(has(me, 'badge:explorer:1990:silver'));
  assert.ok(!has(me, 'badge:explorer:1990:bronze'));
  for (const a of rocks) started(me, a.id);
  evaluate(me, 'explorer', 1990);
  assert.ok(has(me, 'badge:explorer:1990:bronze'));
  // Maître : un artiste maîtrisé → argent.
  db.prepare('INSERT INTO achievements (user_id, key, created_at) VALUES (?, ?, ?)').run(me.user.id, `artist:${rocks[0].artist}`, Date.now());
  evaluate(me, 'master');
  assert.ok(has(me, 'badge:master:silver'));
  // Légendaires : 10 cartes légendaires distinctes.
  const legends = makeAlbum({ genre: 'jazz', year: 1962, tracks: 10, rarity: 'legendary' });
  for (const t of legends.tracks.slice(0, 9)) card(me, t);
  evaluate(me, 'legendary');
  assert.ok(!has(me, 'badge:legendary:bronze'));
  card(me, legends.tracks[9]);
  evaluate(me, 'legendary');
  assert.ok(has(me, 'badge:legendary:bronze'));
  // Promos : 5 promos.
  const promos = makeAlbum({ genre: 'pop', year: 2011, tracks: 5, rarity: 'promo' });
  for (const t of promos.tracks) card(me, t);
  evaluate(me, 'promo');
  assert.ok(has(me, 'badge:promo:bronze'));
  // Éclectique : des cartes dans 10 genres.
  const genres = ['pop', 'rock', 'rap', 'electro', 'soul', 'jazz', 'reggae', 'chanson', 'latin', 'metal'];
  for (const g of genres) started(me, makeAlbum({ genre: g, year: 2001 }).id);
  evaluate(me, 'eclectic');
  assert.ok(has(me, 'badge:eclectic:silver'));
  assert.ok(!has(me, 'badge:eclectic:gold'));
  // Chroniqueur : 25 albums notés ; Plume : 10 critiques de 140 caractères ; Oreille fine : chaque morceau d'un album.
  const many = Array.from({ length: 25 }, () => makeAlbum({ genre: 'soul', year: 1972, tracks: 1 }));
  const rate = db.prepare(`INSERT INTO ratings (user_id, item_type, item_id, score, review, review_at, created_at, updated_at)
    VALUES (?, ?, ?, 7, ?, ?, ?, ?)`);
  many.forEach((a, i) => rate.run(me.user.id, 'album', a.id, i < 10 ? LONG : null, i < 10 ? Date.now() : null, Date.now(), Date.now()));
  evaluate(me, 'critic');
  evaluate(me, 'pen');
  assert.ok(has(me, 'badge:critic:bronze'));
  assert.ok(has(me, 'badge:pen:silver'));
  const small = makeAlbum({ tracks: 3 });
  for (const t of small.tracks.slice(0, 2)) rate.run(me.user.id, 'track', t, null, null, Date.now(), Date.now());
  evaluate(me, 'fine_ear');
  assert.ok(!has(me, 'badge:fine_ear:bronze'));
  rate.run(me.user.id, 'track', small.tracks[2], null, null, Date.now(), Date.now());
  evaluate(me, 'fine_ear');
  assert.ok(has(me, 'badge:fine_ear:bronze'));
  // Critique populaire : une critique à 10 « J'aime » ; Curateur : une liste publique à 10.
  db.prepare('UPDATE ratings SET like_count = 10 WHERE user_id = ? AND item_id = ?').run(me.user.id, many[0].id);
  evaluate(me, 'popular_review');
  assert.ok(has(me, 'badge:popular_review:silver'));
  const list = (kind, visibility, likes, items = 0) => db.prepare(`INSERT INTO lists (user_id, kind, title, visibility, like_count, item_count, created_at, updated_at)
    VALUES (?, ?, 'L', ?, ?, ?, ?, ?)`).run(me.user.id, kind, visibility, likes, items, Date.now(), Date.now());
  list('list', 'private', 30);
  evaluate(me, 'curator');
  assert.ok(!has(me, 'badge:curator:silver'), 'une liste privée ne compte pas');
  list('list', 'public', 10);
  evaluate(me, 'curator');
  assert.ok(has(me, 'badge:curator:silver'));
  // Mes 9 albums publiés.
  list('grid9', 'public', 0, 9);
  evaluate(me, 'nine');
  assert.ok(has(me, 'badge:nine:bronze'));
  // Bonne entente : Taste Match ≥ 85 % avec 3 amis (un non-ami ne compte pas).
  const stranger = await player();
  const match = (a, b, score) => {
    const [x, y] = a.user.id < b.user.id ? [a, b] : [b, a];
    db.prepare(`INSERT OR REPLACE INTO taste_matches (user_a, user_b, score, confidence, data, computed_at) VALUES (?, ?, ?, 'high', '{}', ?)`)
      .run(x.user.id, y.user.id, score, Date.now());
  };
  const befriend = (a, b) => db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'accepted', ?)").run(a.user.id, b.user.id, Date.now());
  for (const f of [friend1, friend2]) {
    befriend(me, f);
    match(me, f, 90);
  }
  match(me, stranger, 99);
  evaluate(me, 'friendly');
  assert.ok(!has(me, 'badge:friendly:silver'));
  befriend(friend3, me);
  match(me, friend3, 86);
  evaluate(me, 'friendly');
  assert.ok(has(me, 'badge:friendly:silver'));
  // Blind-testeur : un 5/5.
  db.prepare(`INSERT INTO blindtest_games (id, user_id, genre, questions, correct, created_at, finished_at) VALUES (?, ?, 'all', '[]', 4, ?, ?)`)
    .run('bt-a', me.user.id, Date.now(), Date.now());
  evaluate(me, 'blindtest');
  assert.ok(!has(me, 'badge:blindtest:bronze'));
  db.prepare(`INSERT INTO blindtest_games (id, user_id, genre, questions, correct, created_at, finished_at) VALUES (?, ?, 'all', '[]', 5, ?, ?)`)
    .run('bt-b', me.user.id, Date.now(), Date.now());
  evaluate(me, 'blindtest');
  assert.ok(has(me, 'badge:blindtest:bronze'));
  // Juge : 50 votes comptés (les « Je ne connais pas » ne comptent pas).
  const vote = db.prepare(`INSERT INTO battle_votes (user_id, item_type, a_id, b_id, winner_id, context, counted, created_at)
    VALUES (?, 'album', ?, ?, NULL, 'global:album', ?, ?)`);
  for (let i = 0; i < 49; i++) vote.run(me.user.id, `a${String(i).padStart(3, '0')}`, `b${i}`, 1, Date.now());
  vote.run(me.user.id, 'c000', 'c001', 0, Date.now());
  evaluate(me, 'judge');
  assert.ok(!has(me, 'badge:judge:bronze'));
  vote.run(me.user.id, 'd000', 'd001', 1, Date.now());
  evaluate(me, 'judge');
  assert.ok(has(me, 'badge:judge:bronze'));
  // Assidu : les 3 quêtes du jour réclamées 7 jours différents (pas forcément d'affilée).
  const quest = db.prepare('INSERT INTO user_quests (user_id, period_key, slot, quest_id, claimed_at, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (let d = 1; d <= 7; d++) for (let s = 0; s < (d === 7 ? 2 : 3); s++) quest.run(me.user.id, `d:2026-01-${String(d * 3).padStart(2, '0')}`, s, 'd-open', Date.now(), Date.now());
  evaluate(me, 'steady');
  assert.ok(!has(me, 'badge:steady:silver'));
  quest.run(me.user.id, 'd:2026-01-21', 2, 'd-open', Date.now(), Date.now());
  evaluate(me, 'steady');
  assert.ok(has(me, 'badge:steady:silver'));
});

test('jamais deux fois le même badge ; récompense de chaque palier une seule fois', async () => {
  const me = await player();
  const albums = Array.from({ length: 10 }, () => makeAlbum({ genre: 'metal', year: 1985 }));
  for (const a of albums) complete(me, a.id);
  const before = userRow(me);
  evaluate(me, 'vinyl');
  evaluate(me, 'vinyl');
  await Promise.all([1, 2, 3].map(() => Promise.resolve().then(() => evaluate(me, 'vinyl'))));
  assert.deepEqual(earned(me).filter((k) => k.startsWith('badge:vinyl')), ['badge:vinyl:bronze', 'badge:vinyl:silver']);
  const after = userRow(me);
  assert.equal(after.xp - before.xp, 50 + 150, 'XP du bronze et de l’argent, une fois');
  assert.equal(after.royalties - before.royalties, 100, 'royalties de l’argent');
  // Or : un booster bonus ; dernier palier : le titre cosmétique (user_cosmetics), une fois.
  const judge = db.prepare(`INSERT INTO battle_votes (user_id, item_type, a_id, b_id, winner_id, context, counted, created_at)
    VALUES (?, 'album', ?, ?, NULL, 'global:album', 1, ?)`);
  for (let i = 0; i < 1000; i++) judge.run(me.user.id, `x${String(i).padStart(4, '0')}`, `y${i}`, Date.now());
  // Assez d'XP pour que les 600 XP des trois paliers ne fassent pas gagner de niveau (chaque niveau donne un booster).
  db.prepare('UPDATE users SET xp = 1000000 WHERE id = ?').run(me.user.id);
  const packs = userRow(me).bonus_packs;
  evaluate(me, 'judge');
  assert.ok(has(me, 'badge:judge:gold'));
  assert.equal(userRow(me).bonus_packs - packs, 1);
  const cosmetic = db.prepare("SELECT cosmetic_id, source FROM user_cosmetics WHERE user_id = ? AND cosmetic_id = 'title:juge'").get(me.user.id);
  assert.equal(cosmetic?.source, 'badge:judge');
  evaluate(me, 'judge');
  assert.equal(userRow(me).bonus_packs - packs, 1);
  // Le titre est débloqué : il peut être choisi.
  const chosen = deps.collection.setCosmetics(me.user.id, { title: 'juge' });
  assert.equal(chosen.title, 'juge');
});

test('événements : album complété, critiques, « J’aime » → badges, notification, fil pour l’or, message du site', async () => {
  const me = await player();
  const fans = await Promise.all(Array.from({ length: 10 }, () => player()));
  const album = makeAlbum({ genre: 'electro', year: 2003, tracks: 2 });
  const since = Date.now();
  const user = services.getUser(me.user.id);
  services.atomic(() => services.addCards(user, album.tracks.map((trackId) => ({ trackId, variant: 'std' })), 'pack'));
  assert.ok(has(me, 'badge:vinyl:bronze'), 'album.completed → Vinyles bronze');
  assert.ok(has(me, 'badge:first_press:gold'), 'premier à compléter cet album → Premier pressage');
  const notif = db.prepare("SELECT data FROM notifications WHERE user_id = ? AND kind = 'badge_earned'").all(me.user.id);
  assert.ok(notif.length >= 2);
  const feed = db.prepare("SELECT object_id FROM activity WHERE actor_id = ? AND verb = 'badge'").all(me.user.id).map((r) => r.object_id);
  assert.ok(feed.includes('badge:first_press:gold'), 'l’or crée une entrée du fil');
  const recent = deps.badges.earnedSince(me.user.id, since).map((b) => b.key);
  assert.ok(recent.includes('badge:vinyl:bronze'));
  // Message du site : une fois.
  const seen = await call(me, 'POST', '/badges/seen');
  assert.equal(seen.status, 200);
  assert.ok(seen.body.items.some((b) => b.key === 'badge:vinyl:bronze'));
  assert.deepEqual((await call(me, 'POST', '/badges/seen')).body.items, []);
  // Une critique de 140 caractères et plus, puis 10 « J'aime » d'autres joueurs → Critique populaire (argent).
  const put = await call(me, 'PUT', `/ratings/album/${album.id}`, { score: 9, review: LONG });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const reviewId = db.prepare("SELECT id FROM ratings WHERE user_id = ? AND item_type = 'album' AND item_id = ?").get(me.user.id, album.id).id;
  for (const f of fans) {
    const like = await call(f, 'PUT', `/likes/review/${reviewId}`);
    assert.equal(like.status, 200, JSON.stringify(like.body));
  }
  assert.ok(has(me, 'badge:popular_review:silver'));
  // Bus : badge.earned porte famille et palier.
  const got = [];
  const off = deps.bus.on('badge.earned', (p) => got.push(p));
  db.prepare('INSERT INTO blindtest_games (id, user_id, genre, questions, correct, created_at, finished_at) VALUES (?, ?, \'all\', \'[]\', 5, ?, ?)')
    .run('bt-ev', me.user.id, Date.now(), Date.now());
  deps.bus.emit('blindtest.finished', { userId: me.user.id, correct: 5 });
  off();
  assert.deepEqual(got.map((p) => [p.key, p.family, p.tier]), [['badge:blindtest:bronze', 'blindtest', 'bronze']]);
});

test('rattrapage : une seule fois, en silence, pour un joueur d’avant les badges', async () => {
  const me = await player();
  db.prepare('UPDATE users SET created_at = 1000 WHERE id = ?').run(me.user.id);
  const albums = Array.from({ length: 12 }, () => makeAlbum({ genre: 'reggae', year: 1978 }));
  for (const a of albums) {
    complete(me, a.id);
    started(me, a.id);
  }
  const events = [];
  const off = deps.bus.on('badge.earned', (p) => events.push(p));
  const r = await call(me, 'GET', '/badges');
  off();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  for (const key of ['badge:vinyl:bronze', 'badge:vinyl:silver', 'badge:explorer:1970:bronze', 'badge:explorer:1970:silver', 'badge:genre_fan:reggae:silver']) {
    assert.ok(has(me, key), key);
  }
  assert.equal(events.length, 0, 'pas de fil ni de message pour l’historique');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'badge_earned'").get(me.user.id).n, 1, 'une seule notification');
  assert.deepEqual((await call(me, 'POST', '/badges/seen')).body.items, [], 'le rattrapage ne déclenche pas de message');
  const xp = userRow(me).xp;
  const count = earned(me).length;
  // Une deuxième lecture, un événement : rien de plus (drapeau badges:v1).
  await call(me, 'GET', '/badges');
  assert.deepEqual(deps.badges.backfill(me.user.id), []);
  assert.equal(earned(me).length, count);
  assert.equal(userRow(me).xp, xp);
  assert.ok(db.prepare("SELECT 1 FROM user_stats_cache WHERE user_id = ? AND key = 'badges:v1'").get(me.user.id));
});

test('GET /api/badges : médailles gagnées (date) et à gagner (progression) ; Fan de… : gagnés + le plus avancé', async () => {
  const me = await player();
  const jazz = Array.from({ length: 3 }, () => makeAlbum({ genre: 'jazz', year: 1959 }));
  for (const a of jazz) complete(me, a.id);
  evaluate(me, 'vinyl');
  const r = await call(me, 'GET', '/badges');
  assert.equal(r.status, 200);
  const vinyl = r.body.families.find((f) => f.id === 'vinyl');
  assert.equal(vinyl.best, 'bronze');
  assert.ok(vinyl.earnedAt > 0);
  assert.deepEqual(vinyl.tiers.map((t) => [t.tier, t.progress, t.target]), [['bronze', 1, 1], ['silver', 3, 10], ['gold', 3, 50], ['platinum', 3, 250]]);
  const fans = r.body.families.filter((f) => f.id === 'genre_fan');
  assert.deepEqual(fans.map((f) => [f.variant, f.tiers[0].progress]), [['jazz', 3]], 'le genre le plus avancé, pas encore gagné');
  const explorers = r.body.families.filter((f) => f.id === 'explorer');
  assert.equal(explorers.length, 7);
  assert.ok(r.body.total >= 24 && r.body.earned >= 1);
});

test('badges des autres : gagnés seulement, Studio privé 403, blocage 404', async () => {
  const me = await player();
  const other = await player();
  const albums = [makeAlbum(), makeAlbum()];
  for (const a of albums) complete(other, a.id);
  evaluate(other, 'vinyl');
  const r = await call(me, 'GET', `/users/${other.username}/badges`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.families.map((f) => [f.id, f.best]), [['vinyl', 'bronze']]);
  assert.ok(r.body.families[0].tiers.every((t) => t.earnedAt), 'seulement les paliers gagnés');
  assert.equal(r.body.families[0].tiers[0].progress, undefined, 'pas la progression d’un autre joueur');
  db.prepare("UPDATE users SET profile_visibility = 'private' WHERE id = ?").run(other.user.id);
  assert.equal((await call(me, 'GET', `/users/${other.username}/badges`)).status, 403);
  db.prepare("UPDATE users SET profile_visibility = 'public' WHERE id = ?").run(other.user.id);
  assert.equal((await call(other, 'PUT', `/blocks/${me.user.id}`)).status, 200);
  assert.equal((await call(me, 'GET', `/users/${other.username}/badges`)).status, 404);
  assert.equal((await call(me, 'GET', '/users/personne_ici/badges')).status, 404);
});

test('clés et paliers : chaque famille a des seuils croissants, une clé par palier', () => {
  // Médailles externes (coffrets, événements) : la variante est l'identifiant du coffret ou de l'événement.
  const sample = { set: 'g-rock-1970', event: 'french-touch' };
  for (const f of FAMILIES) {
    const variant = f.external ? sample[f.id] : f.variants ? f.variants[0] : null;
    for (const t of f.tiers) assert.ok(parseBadgeKey(badgeKey(f.id, variant, t.tier)), `${f.id} ${t.tier}`);
    const byMetric = new Map();
    for (const t of f.tiers) {
      const m = t.metric || 'value';
      if (byMetric.has(m)) assert.ok(t.target > byMetric.get(m), `${f.id} : seuils croissants`);
      byMetric.set(m, t.target);
    }
  }
});

test('médailles des coffrets et des événements : clés à 4 parties, jamais réévaluées ici, listées une fois gagnées', async () => {
  assert.deepEqual(parseBadgeKey('badge:set:g-rock-1970:bronze'), { family: 'set', variant: 'g-rock-1970', tier: 'bronze' });
  assert.deepEqual(parseBadgeKey('badge:event:french-touch:gold'), { family: 'event', variant: 'french-touch', tier: 'gold' });
  assert.equal(parseBadgeKey('badge:set:bronze'), null, 'un badge de coffret a toujours son coffret');
  assert.equal(parseBadgeKey('badge:set:g-rock-1970:gold'), null, 'palier inconnu de la famille');
  assert.equal(parseBadgeKey('badge:event:Pas_Un_Slug:gold'), null);
  const me = await player();
  const other = await player();
  assert.deepEqual(evaluate(me, 'set', 'g-rock-1970'), [], 'donnés par le module sets, pas par badges');
  // Aucune gagnée : une médaille verrouillée par famille (pour montrer qu'elle existe), sans variante.
  let r = await call(me, 'GET', '/badges');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.families.filter((m) => m.id === 'set' || m.id === 'event').map((m) => [m.id, m.variant, m.best]),
    [['set', null, null], ['event', null, null]]);
  // Gagnées (comme le font server/sets.js et server/events.js) : une médaille par coffret, par événement.
  const now = Date.now();
  const give = (who, key, at) => db.prepare('INSERT INTO achievements (user_id, key, created_at, data) VALUES (?, ?, ?, ?)')
    .run(who.user.id, key, at, JSON.stringify({ value: 1, at }));
  for (const who of [me, other]) {
    give(who, 'badge:set:g-rock-1970:bronze', now - 2000);
    give(who, 'badge:set:g-jazz-1960:bronze', now - 1000);
    give(who, 'badge:event:french-touch:gold', now);
  }
  deps.bus.emit('badge.earned', { userId: me.user.id, key: 'badge:event:french-touch:gold', family: 'event', variant: 'french-touch', tier: 'gold' });
  r = await call(me, 'GET', '/badges');
  assert.deepEqual(r.body.families.filter((m) => m.id === 'set' || m.id === 'event').map((m) => [m.id, m.variant, m.best, m.group]), [
    ['set', 'g-jazz-1960', 'bronze', 'collect'], ['set', 'g-rock-1970', 'bronze', 'collect'], ['event', 'french-touch', 'gold', 'play'],
  ], 'la page n’attend pas la fin du cache après une médaille d’un autre module');
  const seen = await call(me, 'POST', '/badges/seen');
  assert.ok(seen.body.items.some((b) => b.key === 'badge:event:french-touch:gold' && b.reward.boosters === 1));
  const theirs = await call(me, 'GET', `/users/${other.username}/badges`);
  assert.equal(theirs.status, 200);
  assert.deepEqual(theirs.body.families.map((m) => [m.id, m.variant]).sort(),
    [['event', 'french-touch'], ['set', 'g-jazz-1960'], ['set', 'g-rock-1970']]);
  // Le rattrapage d'un joueur d'avant les badges ne mesure pas ces familles.
  const old = await player();
  db.prepare('UPDATE users SET created_at = 1000 WHERE id = ?').run(old.user.id);
  assert.deepEqual(deps.badges.backfill(old.user.id).filter((b) => b.family === 'set' || b.family === 'event'), []);
});
