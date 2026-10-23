// Passeport musical et AlbumMania Rétro (PLAN.md 4.3, 5.8, chantier P2-A) : périodes à l'heure de Paris (mois,
// trimestres, ouverture du Rétro le 1er décembre), classement des artistes, évolution des goûts ; GET /passport (totaux,
// raretés = cartes distinctes, notes, favoris, répartitions, chronologie, pays connus seulement), cache d'une heure
// (recalcul après une action du joueur, au plus une fois par minute), confidentialité du Studio et blocages dans les
// deux sens ; GET /retro/:year (année verrouillée, année d'avant l'inscription, moments d'une année passée) ; tâche de
// nuit ; textes FR / EN du site (mêmes clés, typographie française) ; avec PERF_DB : coût pour le plus gros joueur.
//   PERF_DB=/chemin/perf.db node --test server/test/passport.test.js   (la base est recopiée : PERF_DB n'est pas modifiée)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApp, signupVerified, api } from './helpers.js';
import {
  monthWindows, quarterWindows, yearMonths, retroState, retroOpensAt, rankArtists, shiftOf, monthKey,
  PASSPORT_TTL_MS, STALE_MIN_MS, ARTIST_FAVORITE_BONUS, ARTIST_RATING_WEIGHT, jobs,
} from '../passport.js';
import { parisDate, parisMidnight } from '../../shared/periods.js';
import area from '../../client/src/i18n/areas/passport.js';

// ----- périodes et calculs purs -----------------------------------------------------------------------------

test('mois et trimestres à l’heure de Paris, changements d’heure compris', () => {
  const now = Date.UTC(2026, 9, 23, 10); // 23 octobre 2026
  const months = monthWindows(now, 12);
  assert.equal(months.length, 12);
  assert.equal(months[0].key, '2025-11');
  assert.equal(months[11].key, '2026-10');
  for (let i = 1; i < months.length; i++) assert.equal(months[i].start, months[i - 1].end, 'mois contigus');
  // Minuit à Paris : 1er novembre 2025 = 31 octobre 23:00 UTC (heure d'hiver), 1er avril 2026 = 31 mars 22:00 UTC.
  assert.equal(months[0].start, Date.UTC(2025, 9, 31, 23));
  assert.equal(months.find((m) => m.key === '2026-04').start, Date.UTC(2026, 2, 31, 22));
  assert.equal(monthKey(Date.UTC(2026, 9, 31, 23, 30)), '2026-11', 'le 31 octobre à 23 h 30 UTC, c’est déjà novembre à Paris');
  const quarters = quarterWindows(now, 4);
  assert.deepEqual(quarters.map((qt) => qt.key), ['2026-T1', '2026-T2', '2026-T3', '2026-T4']);
  assert.equal(quarters[3].start, parisMidnight(2026, 10, 1));
  assert.equal(quarters[3].end, parisMidnight(2027, 1, 1));
  assert.deepEqual(quarterWindows(Date.UTC(2026, 1, 3), 4).map((qt) => qt.key), ['2025-T2', '2025-T3', '2025-T4', '2026-T1']);
  const year = yearMonths(2026);
  assert.equal(year[0].start, parisMidnight(2026, 1, 1));
  assert.equal(year[11].end, parisMidnight(2027, 1, 1));
});

test('Rétro : l’année en cours ouvre le 1er décembre (Paris), les années passées tout le temps', () => {
  const opens = retroOpensAt(2026);
  assert.equal(opens, Date.UTC(2026, 10, 30, 23), '1er décembre 00:00 à Paris = 30 novembre 23:00 UTC');
  assert.equal(retroState(2026, opens - 1), 'locked');
  assert.equal(retroState(2026, opens), 'open');
  assert.equal(retroState(2026, Date.UTC(2027, 0, 15)), 'open', 'en janvier, le Rétro de l’année passée reste ouvert');
  assert.equal(retroState(2025, Date.UTC(2026, 5, 1)), 'open');
  assert.equal(retroState(2027, Date.UTC(2026, 5, 1)), 'future');
});

test('artiste favori : cartes + notes au-dessus de 5/10 + favori ; évolution : genre en plus forte hausse', () => {
  const cards = new Map([['a', { cards: 30, albums: 2 }], ['b', { cards: 6, albums: 1 }]]);
  const rated = new Map([['b', { n: 2, plus: 9 }], ['c', { n: 1, plus: 0 }]]);
  const ranked = rankArtists(cards, rated, new Set(['d']));
  assert.deepEqual(ranked.map((a) => a.id), ['b', 'a', 'd'], 'c (noté 5/10 ou moins, sans carte) ne compte pas');
  assert.equal(ranked[0].points, 6 + ARTIST_RATING_WEIGHT * 9);
  assert.equal(ranked[2].points, ARTIST_FAVORITE_BONUS);
  const quarters = [
    { key: '2026-T1', total: 10, genres: { rock: 8, electro: 2 } },
    { key: '2026-T2', total: 0, genres: {} },
    { key: '2026-T3', total: 10, genres: { rock: 4, electro: 6 } },
  ];
  assert.deepEqual(shiftOf(quarters, ['rock', 'electro']), { genre: 'electro', from: 0.2, to: 0.6, fromKey: '2026-T1', toKey: '2026-T3' });
  assert.equal(shiftOf(quarters.slice(0, 2), ['rock']), null, 'un seul trimestre renseigné : pas d’évolution');
});

// ----- application ----------------------------------------------------------------------------------------

const app = await startApp();
test.after(() => app.close());
const { db, deps, services } = app;

let n = 0;
const player = () => signupVerified(app, { username: `pp_${++n}` });
const call = (who, method, p, body) => api(app.base, who?.cookie || '', method, p, body);
const albums = db.prepare("SELECT id, artist_id AS artistId, genre, year, track_count FROM cat_albums WHERE status = 'active' ORDER BY id").all();
const tracksOf = (albumId) => db.prepare('SELECT id, rarity FROM cat_tracks WHERE album_id = ? ORDER BY n').all(albumId).map((t) => t.id);
const give = (who, cards) => services.atomic(() => services.addCards(services.getUser(who.user.id), cards, 'pack'));
const rate = (who, type, id, score, review) => deps.ratings.rate(who.user.id, type, id, score, review);
const befriend = (a, b) => db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
  .run(a.user.id, b.user.id, Date.now(), Date.now());
const age = (who, key, ms) => db.prepare('UPDATE user_stats_cache SET computed_at = computed_at - ? WHERE user_id = ? AND key = ?').run(ms, who.user.id, key);

test('GET /passport d’un nouveau joueur : tout à zéro, 12 mois, rien ne casse', async () => {
  const me = await player();
  const r = await call(me, 'GET', '/passport');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = r.body;
  assert.equal(p.self, true);
  assert.equal(p.owner.username, me.username);
  assert.equal(p.totals.cards, 0);
  assert.equal(p.totals.ratings, 0);
  assert.equal(p.totals.average, null);
  assert.equal(p.timeline.length, 12);
  assert.equal(p.timeline[11].month, monthKey(Date.now()));
  assert.equal(p.favorites.artist, null);
  assert.deepEqual(p.distributions.genres, []);
  assert.equal(p.distributions.rarities.length, 7);
  assert.equal(p.evolution.quarters.length, 4);
  assert.equal(p.evolution.shift, null);
  assert.ok(Array.isArray(p.retro.years));
  assert.equal(p.retro.current.year, parisDate().y);
  assert.ok(!('v' in p) && !('lists' in p), 'champs internes du cache absents');
});

test('GET /passport : cartes distinctes par rareté, vinyles, notes, favoris, répartitions, chronologie', async () => {
  const me = await player();
  const [a1, a2, a3] = albums;
  // Album 1 complet (un morceau aussi en holo), deux morceaux de l'album 2, un morceau holo seul de l'album 3.
  const t1 = tracksOf(a1.id);
  const t2 = tracksOf(a2.id);
  const t3 = tracksOf(a3.id);
  give(me, [...t1.map((trackId) => ({ trackId, variant: 'std' })), { trackId: t1[0], variant: 'holo' }]);
  give(me, [{ trackId: t2[0], variant: 'std' }, { trackId: t2[1], variant: 'std' }, { trackId: t3[0], variant: 'holo' }]);
  rate(me, 'album', a2.id, 10, 'Un disque que je réécoute tout le temps.');
  rate(me, 'album', a1.id, 8);
  rate(me, 'album', a3.id, 4);
  rate(me, 'track', t1[1], 6);
  // Une critique masquée par la modération ne compte pas.
  db.prepare('UPDATE ratings SET hidden_at = ? WHERE user_id = ? AND item_type = ? AND item_id = ?').run(Date.now(), me.user.id, 'album', a2.id);
  db.prepare("INSERT INTO user_favorites (user_id, kind, item_id, position, created_at) VALUES (?, 'artist', ?, 0, ?)").run(me.user.id, a3.artistId, Date.now());
  const r = await call(me, 'GET', '/passport');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const p = r.body;
  const unique = db.prepare('SELECT unique_cards FROM users WHERE id = ?').get(me.user.id).unique_cards;
  assert.equal(unique, t1.length + 3);
  assert.equal(p.totals.cards, unique);
  const sum = p.distributions.rarities.reduce((s, x) => s + x.cards, 0);
  assert.equal(sum, unique, 'raretés : morceaux distincts (un morceau standard + holo ne compte qu’une fois)');
  assert.equal(p.distributions.rarities.reduce((s, x) => s + x.holo, 0), 2);
  assert.equal(p.totals.holo, 2);
  assert.equal(p.totals.albumsCompleted, 1);
  assert.equal(p.totals.albumsStarted, 3);
  assert.equal(p.totals.ratings, 4);
  assert.equal(p.totals.average, Math.round(((10 + 8 + 4 + 6) / 4) * 10) / 10);
  assert.equal(p.distributions.ratings[10], 1);
  assert.equal(p.totals.reviews, 0, 'la seule critique est masquée');
  assert.deepEqual(p.favorites.albums.map((a) => a.id), [a2.id, a1.id, a3.id], 'albums les mieux notés, du meilleur au moins bon');
  assert.equal(p.favorites.collected[0].id, a1.id);
  assert.equal(p.favorites.collected[0].owned, t1.length);
  assert.ok(p.favorites.artists.some((a) => a.id === a3.artistId && a.favorite), 'artiste en favori classé');
  const shareSum = p.distributions.genres.reduce((s, g) => s + g.share, 0);
  assert.ok(Math.abs(shareSum - 1) < 0.01, `parts des genres : ${shareSum}`);
  assert.equal(p.distributions.genres.reduce((s, g) => s + g.cards, 0), unique - 0, 'cartes des albums commencés');
  const last = p.timeline[11];
  assert.equal(last.cards, t1.length + 4, 'cartes du mois : une ligne par version');
  assert.equal(last.ratings, 4);
  assert.equal(last.completions, 1);
  assert.equal(p.evolution.quarters[3].total, 3 + 3, 'découvertes du trimestre : albums commencés + albums notés');
  // Références du catalogue de la réponse : albums cités, artistes cités.
  const albumRefs = new Set(p.catalog.albums.map((a) => a.id));
  for (const a of [...p.favorites.albums, ...p.favorites.collected]) assert.ok(albumRefs.has(a.id), `album ${a.id} dans catalog`);
  assert.ok(p.catalog.artists.some((a) => a.id === p.favorites.artist.id));
});

test('pays : seulement ceux qui sont connus (graine ou source renseignée), part des cartes concernées', async () => {
  const me = await player();
  const [a1, a2] = albums;
  give(me, [{ trackId: tracksOf(a1.id)[0], variant: 'std' }, { trackId: tracksOf(a2.id)[0], variant: 'std' }]);
  // L'artiste du premier album passe pour un artiste importé sans source : son pays n'est plus « connu ».
  const artist = db.prepare('SELECT source, country, country_source FROM cat_artists WHERE id = ?').get(a1.artistId);
  db.prepare("UPDATE cat_artists SET source = 'deezer', country_source = NULL WHERE id = ?").run(a1.artistId);
  try {
    const p = (await call(me, 'GET', '/passport')).body;
    const other = db.prepare('SELECT country FROM cat_artists WHERE id = ?').get(a2.artistId).country;
    assert.deepEqual(p.distributions.countries.map((c) => c.code), other ? [other] : []);
    assert.equal(p.distributions.countriesKnown, other ? 0.5 : 0);
  } finally {
    db.prepare('UPDATE cat_artists SET source = ?, country = ?, country_source = ? WHERE id = ?').run(artist.source, artist.country, artist.country_source, a1.artistId);
  }
});

test('cache d’une heure : relu tel quel, recalculé après une action du joueur (au plus une fois par minute) ou après 1 h', async () => {
  const me = await player();
  give(me, [{ trackId: tracksOf(albums[4].id)[0], variant: 'std' }]);
  const first = (await call(me, 'GET', '/passport')).body;
  const again = (await call(me, 'GET', '/passport')).body;
  assert.equal(again.computedAt, first.computedAt, 'deuxième lecture : le cache');
  assert.ok(deps.passport.isFresh(me.user.id, 'passport'));
  // Une note juste après : le cache a moins d'une minute, il est gardé.
  rate(me, 'album', albums[4].id, 9);
  assert.equal((await call(me, 'GET', '/passport')).body.computedAt, first.computedAt);
  // Une minute plus tard : recalcul, la note est comptée.
  age(me, 'passport', STALE_MIN_MS + 1000);
  const fresh = (await call(me, 'GET', '/passport')).body;
  assert.notEqual(fresh.computedAt, first.computedAt);
  assert.equal(fresh.totals.ratings, 1);
  // Sans action (un joueur qui n'a rien fait depuis le démarrage), le cache tient une heure.
  const calm = await player();
  const base = (await call(calm, 'GET', '/passport')).body;
  age(calm, 'passport', 30 * 60_000);
  assert.equal((await call(calm, 'GET', '/passport')).body.computedAt, base.computedAt);
  age(calm, 'passport', PASSPORT_TTL_MS);
  assert.notEqual((await call(calm, 'GET', '/passport')).body.computedAt, base.computedAt);
  // Deux demandes simultanées : un seul calcul.
  deps.passport.forget(me.user.id);
  const [x, y] = await Promise.all([call(me, 'GET', '/passport'), call(me, 'GET', '/passport')]);
  assert.equal(x.body.computedAt, y.body.computedAt);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_stats_cache WHERE user_id = ? AND key = 'passport'").get(me.user.id).n, 1);
});

test('confidentialité : Studio public, amis, privé ; blocages dans les deux sens ; listes visibles seulement', async () => {
  const owner = await player();
  const friend = await player();
  const stranger = await player();
  const blocked = await player();
  const blocker = await player();
  befriend(owner, friend);
  give(owner, [{ trackId: tracksOf(albums[5].id)[0], variant: 'std' }]);
  const now = Date.now();
  for (const visibility of ['public', 'friends', 'private', 'private']) {
    db.prepare("INSERT INTO lists (user_id, kind, title, visibility, created_at, updated_at) VALUES (?, 'list', 'Ma liste', ?, ?, ?)").run(owner.user.id, visibility, now, now);
  }
  await call(owner, 'PUT', `/blocks/${blocked.user.id}`);
  await call(blocker, 'PUT', `/blocks/${owner.user.id}`);
  const of = (who) => call(who, 'GET', `/users/${owner.username}/passport`);

  const pub = await of(stranger);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.self, false);
  assert.equal(pub.body.retro, null, 'pas d’accès au Rétro d’un autre');
  assert.equal(pub.body.totals.lists, 1, 'un inconnu ne compte que les listes publiques');
  assert.equal((await of(friend)).body.totals.lists, 2, 'un ami compte aussi les listes réservées aux amis');
  assert.equal((await call(owner, 'GET', '/passport')).body.totals.lists, 4, 'le propriétaire compte toutes ses listes');
  assert.equal((await of(blocked)).status, 404, 'bloqué par le propriétaire : le joueur n’existe pas');
  assert.equal((await of(blocker)).status, 404, 'a bloqué le propriétaire : pareil');
  assert.equal((await call(stranger, 'GET', '/users/personne_ici/passport')).status, 404);

  db.prepare("UPDATE users SET profile_visibility = 'friends' WHERE id = ?").run(owner.user.id);
  const hidden = await of(stranger);
  assert.equal(hidden.status, 403);
  assert.equal(hidden.body.error, 'passport_private');
  assert.equal(hidden.body.visibility, 'friends');
  assert.equal((await of(friend)).status, 200, 'Studio réservé aux amis : un ami le lit');

  db.prepare("UPDATE users SET profile_visibility = 'private' WHERE id = ?").run(owner.user.id);
  assert.equal((await of(friend)).status, 403, 'Studio privé : même un ami ne le lit pas');
  assert.equal((await call(owner, 'GET', `/users/${owner.username}/passport`)).status, 200, 'le propriétaire, toujours');
  assert.equal((await call(owner, 'GET', '/passport')).status, 200);
});

test('GET /retro/:year : année refusée, année en cours verrouillée avant décembre, année d’avant l’inscription', async () => {
  const me = await player();
  for (const bad of ['2019', 'abc', '20266', String(parisDate().y + 1)]) {
    const r = await call(me, 'GET', `/retro/${bad}`);
    assert.equal(r.status, 404, bad);
    assert.equal(r.body.error, 'retro_not_found');
  }
  const current = parisDate().y;
  const r = await call(me, 'GET', `/retro/${current}`);
  assert.equal(r.status, 200);
  if (retroState(current) === 'locked') {
    assert.equal(r.body.status, 'locked');
    assert.equal(r.body.opensAt, retroOpensAt(current));
    assert.deepEqual(r.body.years, [], 'compte de cette année, Rétro pas encore ouvert : aucune année disponible');
  } else {
    assert.equal(r.body.status, 'open');
    assert.deepEqual(r.body.years, [current]);
  }
  const before = await call(me, 'GET', `/retro/${current - 1}`);
  assert.equal(before.status, 404, 'année d’avant l’inscription');
  assert.ok(Array.isArray(before.body.years));
});

test('Rétro d’une année passée : totaux, mois, moments, artistes, albums, genres, années disponibles', async () => {
  const me = await player();
  const year = parisDate().y - 1;
  const at = (m, d, h = 12) => parisMidnight(year, m, d) + h * 3_600_000;
  // Le compte existait déjà l'an dernier.
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(at(1, 2), me.user.id);
  const [a1, a2, a3] = albums;
  const t1 = tracksOf(a1.id);
  give(me, t1.map((trackId) => ({ trackId, variant: 'std' })));
  give(me, [{ trackId: tracksOf(a2.id)[0], variant: 'std' }, { trackId: tracksOf(a2.id)[1], variant: 'holo' }]);
  rate(me, 'album', a1.id, 9);
  rate(me, 'album', a2.id, 7, 'Belle surprise de l’année.');
  rate(me, 'album', a3.id, 10);
  // Tout est daté de l'an dernier : album 1 en mars (le 14 pour le premier morceau), album 2 en juillet.
  db.prepare('UPDATE cards SET first_at = ? WHERE user_id = ? AND track_id = ?').run(at(3, 14), me.user.id, t1[0]);
  db.prepare('UPDATE cards SET first_at = ? WHERE user_id = ? AND track_id IN (SELECT value FROM json_each(?)) AND track_id <> ?')
    .run(at(3, 20), me.user.id, JSON.stringify(t1), t1[0]);
  db.prepare("UPDATE cards SET first_at = ? WHERE user_id = ? AND track_id IN (SELECT id FROM cat_tracks WHERE album_id = ?)").run(at(7, 2), me.user.id, a2.id);
  db.prepare('UPDATE ratings SET created_at = ?, updated_at = ?, review_at = CASE WHEN review IS NULL THEN NULL ELSE ? END WHERE user_id = ?')
    .run(at(8, 1), at(8, 1), at(8, 1), me.user.id);
  db.prepare("UPDATE achievements SET created_at = ?, rank = 3 WHERE user_id = ? AND key = ?").run(at(3, 20, 13), me.user.id, `album:${a1.id}`);
  db.prepare('INSERT INTO pack_openings (user_id, source, cards, created_at) VALUES (?, ?, ?, ?)').run(me.user.id, 'pack', '[]', at(3, 14));

  const r = await call(me, 'GET', `/retro/${year}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const x = r.body;
  assert.equal(x.status, 'open');
  assert.equal(x.year, year);
  assert.ok(x.years.includes(year));
  assert.equal(x.totals.cards, t1.length + 2);
  assert.equal(x.totals.holo, 1);
  assert.equal(x.totals.albums, 2);
  assert.equal(x.totals.completed, 1);
  assert.equal(x.totals.ratings, 3);
  assert.equal(x.totals.reviews, 1);
  assert.equal(x.totals.boosters, 1);
  assert.equal(x.months.length, 12);
  assert.equal(x.months[2].cards, t1.length);
  assert.equal(x.months[2].completions, 1);
  assert.equal(x.months[6].cards, 2);
  assert.equal(x.months[7].ratings, 3);
  assert.equal(x.moments.firstCard.trackId, t1[0], 'première carte de l’année');
  assert.equal(x.moments.firstCompletion.albumId, a1.id);
  assert.equal(x.moments.lowestPressing.rank, 3);
  assert.equal(x.moments.busiestMonth.month, `${year}-03`);
  const order = ['legendary', 'promo', 'ultra', 'super', 'rare', 'uncommon', 'common'];
  const owned = db.prepare('SELECT t.rarity FROM cards c JOIN cat_tracks t ON t.id = c.track_id WHERE c.user_id = ?').all(me.user.id).map((t) => t.rarity);
  assert.equal(x.moments.rarestPull.rarity, order.find((rr) => owned.includes(rr)), 'la pépite : la plus haute rareté obtenue');
  assert.deepEqual(x.top.albums.map((a) => a.id), [a3.id, a1.id, a2.id]);
  assert.equal(x.top.collected[0].id, a1.id);
  assert.equal(x.top.artist.id, a1.artistId === a3.artistId ? a1.artistId : x.top.artist.id);
  assert.ok(x.top.artists.every((a) => a.albumId), 'chaque artiste a un album pour sa vignette');
  assert.ok(x.top.genres.length >= 1 && x.top.genres[0].albumId);
  assert.equal(x.thin, false);
  // Références : morceaux des moments, albums cités.
  assert.ok(x.catalog.tracks.some((t) => t.id === t1[0]));
  assert.ok(x.catalog.albums.some((a) => a.id === a3.id));
  // L'année suivante (en cours) n'a rien de tout ça ; le cache d'une année passée tient 24 h.
  const again = (await call(me, 'GET', `/retro/${year}`)).body;
  assert.equal(again.computedAt, x.computedAt);
  age(me, `retro:${year}`, 2 * 3_600_000);
  rate(me, 'album', albums[6].id, 8);
  assert.equal((await call(me, 'GET', `/retro/${year}`)).body.computedAt, x.computedAt, 'une année terminée ne bouge plus');
});

test('Rétro léger : peu de cartes, aucune note → thin ; tâche de nuit : vieux passeports effacés, autres clés gardées', async () => {
  const me = await player();
  const year = parisDate().y - 1;
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(parisMidnight(year, 6, 1), me.user.id);
  give(me, [{ trackId: tracksOf(albums[7].id)[0], variant: 'std' }]);
  db.prepare('UPDATE cards SET first_at = ? WHERE user_id = ?').run(parisMidnight(year, 9, 3), me.user.id);
  const x = (await call(me, 'GET', `/retro/${year}`)).body;
  assert.equal(x.thin, true);
  assert.equal(x.totals.cards, 1);
  assert.equal(x.moments.firstCompletion, null);
  assert.equal(x.moments.busiestMonth.month, `${year}-09`);
  await call(me, 'GET', '/passport');
  db.prepare("INSERT OR REPLACE INTO user_stats_cache (user_id, key, data, computed_at) VALUES (?, 'badges:v1', '{}', 0)").run(me.user.id);
  db.prepare('UPDATE user_stats_cache SET computed_at = 0 WHERE user_id = ?').run(me.user.id);
  const job = jobs.find((j) => j.name === 'passport-cache');
  const res = job.run(deps);
  assert.ok(res.rows >= 2);
  const keys = db.prepare('SELECT key FROM user_stats_cache WHERE user_id = ?').all(me.user.id).map((r) => r.key);
  assert.ok(keys.includes('badges:v1'), 'les clés des autres modules restent');
  assert.ok(!keys.some((k) => k === 'passport' || k.startsWith('retro:')), 'passeport et Rétro effacés');
});

// ----- textes du site -------------------------------------------------------------------------------------

test('textes passport / retro : mêmes clés en FR et en EN, typographie française', () => {
  const flat = (o, prefix = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v)
    ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
  const fr = new Map(flat(area.fr));
  const en = new Map(flat(area.en));
  assert.ok(fr.size > 50, 'la zone a ses textes');
  assert.deepEqual([...fr.keys()].sort(), [...en.keys()].sort(), 'mêmes clés en FR et en EN');
  for (const [k, v] of fr) {
    assert.equal(typeof v, 'string', k);
    const text = v.replace(/\{\w+\}/g, 'x');
    assert.ok(!/[  ][;:!?%]/.test(text), `espace ordinaire avant ; : ! ? % : ${k} = « ${v} »`);
    assert.ok(!/[^\s ][;!?%]/u.test(text), `espace fine insécable manquante avant ; ! ? % : ${k} = « ${v} »`);
    assert.ok(!/\p{L}:/u.test(text), `espace fine insécable manquante avant « : » : ${k} = « ${v} »`);
    assert.ok(!/«[^ ]|[^ ]»/u.test(text), `espace fine insécable manquante dans les guillemets : ${k}`);
    assert.ok(!/\b(Wrapped|Replay)\b/i.test(v), `jamais « Wrapped » ni « Replay » : ${k}`);
    assert.ok(!/\bvous\b/i.test(v), `tutoiement : ${k}`);
  }
  for (const [k, v] of en) assert.ok(!/\b(Wrapped|Replay)\b/i.test(v), `never “Wrapped” or “Replay”: ${k}`);
});

// ----- base peuplée -----------------------------------------------------------------------------------------

const PERF_DB = process.env.PERF_DB;
test('base peuplée (PERF_DB) : plus gros joueur sans blocage de plus de 100 ms, joueur typique < 40 ms, cache < 5 ms',
  { skip: !PERF_DB && 'PERF_DB non défini', timeout: 300_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-passport-'));
    const file = path.join(dir, 'perf.db');
    try {
      fs.copyFileSync(PERF_DB, file);
      const { openDb } = await import('../db.js');
      const { createApp } = await import('../app.js');
      const pdb = openDb(file);
      const { deps: d } = createApp({ db: pdb });
      const whale = pdb.prepare('SELECT user_id FROM cards GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1').get().user_id;
      const typical = pdb.prepare('SELECT user_id FROM cards GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1 OFFSET 500').get().user_id;
      // Plus long blocage de la boucle d'événements pendant un calcul.
      const measure = async (fn) => {
        let gap = 0;
        let last = performance.now();
        const timer = setInterval(() => {
          const t = performance.now();
          gap = Math.max(gap, t - last);
          last = t;
        }, 2);
        const started = performance.now();
        const out = await fn();
        const total = performance.now() - started;
        clearInterval(timer);
        return { out, total, gap: Math.max(gap, performance.now() - last) };
      };
      await d.passport.passportOf(typical); // préparation des requêtes
      for (const uid of [whale, typical]) d.passport.forget(uid);
      const big = await measure(() => d.passport.passportOf(whale));
      assert.ok(big.out.totals.cards > 10_000);
      assert.ok(big.gap < 100, `passeport du plus gros joueur : blocage de ${big.gap.toFixed(0)} ms`);
      const retro = await measure(() => d.passport.retroOf(whale, parisDate().y));
      assert.ok(retro.gap < 100, `Rétro du plus gros joueur : blocage de ${retro.gap.toFixed(0)} ms`);
      assert.ok(retro.out.totals.cards > 10_000);
      const small = await measure(() => d.passport.passportOf(typical));
      assert.ok(small.total < 40, `joueur typique : ${small.total.toFixed(1)} ms`);
      const hit = await measure(() => d.passport.passportOf(whale));
      assert.ok(hit.total < 5, `lecture du cache : ${hit.total.toFixed(1)} ms`);
      const sum = big.out.distributions.rarities.reduce((s, x) => s + x.cards, 0);
      assert.equal(sum, big.out.totals.cards, 'raretés : cartes distinctes = users.unique_cards');
      console.log(`  passeport baleine ${big.total.toFixed(0)} ms (blocage ${big.gap.toFixed(0)} ms) · Rétro ${retro.total.toFixed(0)} ms (blocage ${retro.gap.toFixed(0)} ms) · typique ${small.total.toFixed(1)} ms · cache ${hit.total.toFixed(2)} ms`);
      pdb.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
