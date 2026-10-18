// Premiers pas (PLAN.md 4.2.7, 5.9, chantier P1-E) : options de chaque étape (14 genres, artistes des genres choisis,
// albums, notes rapides), validation, résultat (profil musical, 12 recommandations, amis suggérés, boosters de
// bienvenue thématiques, premiers pas), écritures (favoris, « Mes 9 albums », liste d'envies, notes rapides,
// onboarded_at), parcours passé, et refaire le parcours sans rien regagner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';
import { THEME_GENRES } from '../../shared/rules.js';

const app = await startApp({ catalog: { artists: 40, albumsPerArtist: 4, target: 200 } });
test.after(() => app.close());
const { db, deps } = app;

let n = 0;
const player = () => signupVerified(app, { username: `ob_${++n}` });
const call = (who, method, p, body) => api(app.base, who?.cookie || '', method, p, body);
const boosters = (who) => db.prepare('SELECT kind, theme, source FROM user_boosters WHERE user_id = ? ORDER BY id').all(who.user.id);
const favorites = (who, kind) => db.prepare('SELECT item_id FROM user_favorites WHERE user_id = ? AND kind = ? ORDER BY position').all(who.user.id, kind).map((r) => r.item_id);
const grid9 = (who) => db.prepare(`SELECT li.item_id FROM lists l JOIN list_items li ON li.list_id = l.id
  WHERE l.user_id = ? AND l.kind = 'grid9' ORDER BY li.position`).all(who.user.id).map((r) => r.item_id);
const genresWithAlbums = db.prepare("SELECT genre, COUNT(*) AS n FROM cat_albums WHERE status = 'active' AND genre IS NOT NULL GROUP BY genre ORDER BY n DESC").all()
  .map((r) => r.genre).filter((g) => THEME_GENRES.includes(g));
const artistsOf = (genres, count) => db.prepare(`SELECT id FROM cat_artists WHERE status = 'active' AND genre IN (SELECT value FROM json_each(?)) ORDER BY fans DESC LIMIT ?`)
  .all(JSON.stringify(genres), count).map((r) => r.id);
const albumsOf = (genres, count) => db.prepare(`SELECT id FROM cat_albums WHERE status = 'active' AND genre IN (SELECT value FROM json_each(?)) ORDER BY fans DESC LIMIT ?`)
  .all(JSON.stringify(genres), count).map((r) => r.id);

test('GET /onboarding : genres, artistes des genres choisis, albums par genre, 10 notes rapides, ce qui était déjà choisi', async () => {
  const me = await player();
  const all = await call(me, 'GET', '/onboarding');
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.ok(all.body.genres.length >= 10 && all.body.genres.every((g) => THEME_GENRES.includes(g.id) && g.albums > 0));
  assert.equal(all.body.mine.onboarded, false);

  const chosen = genresWithAlbums.slice(0, 3);
  const r = await call(me, 'GET', `/onboarding?genres=${chosen.join(',')}`);
  assert.equal(r.status, 200);
  const { artists, artistAlbums, albums, quickRate, catalog } = r.body;
  assert.ok(artists.length >= 6 && artists.length <= 30);
  const genreOf = new Map(db.prepare('SELECT id, genre FROM cat_artists').all().map((a) => [a.id, a.genre]));
  assert.ok(artists.every((id) => chosen.includes(genreOf.get(id))), 'artistes des genres choisis seulement');
  assert.ok(Object.keys(artistAlbums).length >= 1, 'un album pour la pastille de chaque artiste');
  assert.deepEqual(albums.map((g) => g.key), chosen, 'albums populaires de chaque genre');
  assert.ok(quickRate.length === 10 && new Set(quickRate).size === 10);
  assert.ok(catalog.albums.length > 0 && catalog.artists.length > 0);

  // Artistes choisis : leurs albums d'abord ; albums déjà montrés exclus des notes rapides.
  const picked = artistsOf(chosen, 3);
  const withArtists = (await call(me, 'GET', `/onboarding?genres=${chosen.join(',')}&artists=${picked.join(',')}&exclude=${quickRate.slice(0, 4).join(',')}`)).body;
  assert.equal(withArtists.albums[0].key, 'artists');
  assert.ok(withArtists.quickRate.every((id) => !quickRate.slice(0, 4).includes(id)));
  assert.equal((await call(null, 'GET', '/onboarding')).status, 401);
});

test('POST /onboarding : validation (≥ 3 genres, 3 à 10 artistes, 9 albums, 10 notes)', async () => {
  const me = await player();
  const bad = async (body, field) => {
    const r = await call(me, 'POST', '/onboarding', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error, 'invalid_input');
    assert.equal(r.body.field, field);
  };
  await bad({ genres: genresWithAlbums.slice(0, 2) }, 'genres');
  await bad({ genres: 'rock,pop,rap' }, 'genres');
  await bad({ artists: artistsOf(genresWithAlbums, 2) }, 'artists');
  await bad({ artists: artistsOf(genresWithAlbums, 11) }, 'artists');
  await bad({ grid9: albumsOf(genresWithAlbums, 10) }, 'grid9');
  await bad({ ratings: [{ albumId: albumsOf(genresWithAlbums, 1)[0], score: 11 }] }, 'ratings');
  await bad({ ratings: Array.from({ length: 11 }, () => ({ albumId: 'x', score: 5 })) }, 'ratings');
  assert.equal(db.prepare('SELECT onboarded_at FROM users WHERE id = ?').get(me.user.id).onboarded_at, null, 'rien écrit');
});

test('parcours complet : profil, 12 recommandations, boosters de bienvenue, Mes 9 albums, liste d’envies, notes rapides', async () => {
  const twin = await player();
  const me = await player();
  const genres = genresWithAlbums.slice(0, 4);
  const artists = artistsOf(genres, 5);
  const nine = albumsOf(genres, 9);
  const quick = albumsOf(genres, 20).filter((id) => !nine.includes(id)).slice(0, 6);
  // Un joueur qui a les mêmes goûts : il doit apparaître dans les amis suggérés.
  for (const id of nine) deps.ratings.rate(twin.user.id, 'album', id, 9);
  const before = db.prepare('SELECT bonus_packs FROM users WHERE id = ?').get(me.user.id).bonus_packs;

  const body = {
    genres, artists, grid9: nine,
    ratings: [...quick.slice(0, 5).map((albumId, i) => ({ albumId, score: 6 + i })), { albumId: quick[5], score: null }],
  };
  const r = await call(me, 'POST', '/onboarding', body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { result, state, catalog } = r.body;

  // Profil musical : genres choisis (les plus représentés d'abord), décennies, couleur.
  assert.equal(result.profile.genres.length, 3);
  assert.ok(result.profile.genres.every((g) => genres.includes(g)));
  assert.ok(result.profile.decades.length >= 1);
  assert.ok(['cult', 'gems', 'recent', 'classics', 'mixed'].includes(result.profile.flavour));

  // 12 recommandations : ni les 9 albums, ni les albums notés ; 2 par artiste au plus.
  assert.equal(result.recommendations.length, 12);
  const ids = result.recommendations.map((x) => x.id);
  assert.equal(new Set(ids).size, 12);
  assert.ok(ids.every((id) => !nine.includes(id) && !quick.slice(0, 5).includes(id)));
  const artistOf = new Map(db.prepare('SELECT id, artist_id FROM cat_albums').all().map((a) => [a.id, a.artist_id]));
  const per = {};
  for (const id of ids) per[artistOf.get(id)] = (per[artistOf.get(id)] || 0) + 1;
  assert.ok(Object.values(per).every((k) => k <= 2), '2 par artiste au plus');
  assert.ok(result.recommendations.every((x) => ['artist', 'genre', 'similar', 'popular'].includes(x.reason)));
  assert.ok(ids.every((id) => catalog.albums.some((a) => a.id === id)), 'recommandations dans `catalog`');

  // Amis suggérés (6 au plus), avec le jumeau de goûts.
  assert.ok(result.suggestedFriends.length <= 6);
  assert.ok(result.suggestedFriends.some((s) => s.user.username === twin.username), JSON.stringify(result.suggestedFriends));

  // Boosters : 3 thématiques des premiers genres + un booster d'album au choix ; les 5 de l'inscription restent.
  assert.deepEqual(result.boosters.map((b) => b.theme), [...result.profile.genres.map((g) => `genre:${g}`), 'album:choice']);
  assert.deepEqual(boosters(me).map((b) => [b.kind, b.source]), [['theme', 'onboarding'], ['theme', 'onboarding'], ['theme', 'onboarding'], ['album', 'onboarding']]);
  // (les notes rapides donnent de l'XP : un passage de niveau peut ajouter un booster, jamais en retirer)
  assert.ok(db.prepare('SELECT bonus_packs FROM users WHERE id = ?').get(me.user.id).bonus_packs >= before);
  assert.ok(result.firstSteps.length >= 1 && result.firstSteps.every((s) => s.id && s.target));

  // Écritures.
  assert.deepEqual(grid9(me), nine, 'Mes 9 albums');
  assert.deepEqual(deps.services.wishlistAlbumIds(me.user.id).slice().sort(), nine.slice().sort(), 'liste d’envies = les 9 albums');
  assert.deepEqual(favorites(me, 'artist'), artists.slice(0, 5));
  assert.deepEqual(favorites(me, 'genre').slice(0, 3), result.profile.genres, 'genres favoris rangés comme le profil');
  assert.deepEqual(favorites(me, 'genre').slice().sort(), genres.slice().sort());
  const rated = db.prepare("SELECT item_id, score FROM ratings WHERE user_id = ? AND item_type = 'album' ORDER BY score").all(me.user.id);
  assert.deepEqual(rated.map((x) => x.score), [6, 7, 8, 9, 10], '« Pas écouté » n’écrit pas de note');
  assert.equal(state.partial, true);
  assert.equal(state.user.onboarded, true);
  assert.ok(db.prepare('SELECT onboarded_at FROM users WHERE id = ?').get(me.user.id).onboarded_at > 0);

  // GET /onboarding renvoie ce qui a été choisi (« Refaire mon profil musical »).
  const mine = (await call(me, 'GET', '/onboarding')).body.mine;
  assert.equal(mine.onboarded, true);
  assert.deepEqual(mine.grid9, nine);
  assert.deepEqual(mine.artists, artists.slice(0, 5));

  // Refaire : favoris et grille remplacés, aucun booster de plus, onboarded_at inchangé.
  const at = db.prepare('SELECT onboarded_at FROM users WHERE id = ?').get(me.user.id).onboarded_at;
  const other = genresWithAlbums.slice(4, 7);
  const redo = await call(me, 'POST', '/onboarding', { genres: other, artists: artistsOf(other, 3), grid9: albumsOf(other, 3), ratings: [] });
  assert.equal(redo.status, 200, JSON.stringify(redo.body));
  assert.equal(boosters(me).length, 4, 'les boosters de bienvenue ne sont offerts qu’une fois');
  assert.deepEqual(grid9(me), albumsOf(other, 3));
  assert.deepEqual(favorites(me, 'artist'), artistsOf(other, 3));
  assert.equal(db.prepare('SELECT onboarded_at FROM users WHERE id = ?').get(me.user.id).onboarded_at, at);
  assert.equal(redo.body.result.boosters.length, 4, 'les boosters pas encore ouverts restent listés');
});

test('passer tout le parcours : onboarded_at posé, recommandations populaires, aucun booster thématique', async () => {
  const me = await player();
  const r = await call(me, 'POST', '/onboarding', { skip: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.state.user.onboarded, true);
  assert.equal(r.body.result.recommendations.length, 12);
  assert.ok(r.body.result.recommendations.every((x) => x.reason === 'popular'));
  assert.deepEqual(r.body.result.boosters, []);
  assert.equal(boosters(me).length, 0);
  assert.deepEqual(grid9(me), []);
  // Étapes passées une à une (listes vides) : même chose, sans erreur.
  const other = await player();
  const partial = await call(other, 'POST', '/onboarding', { genres: genresWithAlbums.slice(0, 3), artists: [], grid9: [], ratings: [] });
  assert.equal(partial.status, 200);
  assert.deepEqual(partial.body.result.boosters.map((b) => b.theme.split(':')[0]), ['genre', 'genre', 'genre'], 'sans les 9 albums, pas de booster d’album au choix');
});

test('un nouveau compte après le parcours : Découvrir n’est pas vide (genres et artistes favoris)', async () => {
  const me = await player();
  const genres = genresWithAlbums.slice(0, 3);
  await call(me, 'POST', '/onboarding', { genres, artists: artistsOf(genres, 3), grid9: [], ratings: [] });
  const d = (await call(me, 'GET', '/discover')).body;
  const ids = d.sections.map((s) => s.id);
  assert.ok(ids.includes('because') && ids.includes('genre'), JSON.stringify(ids));
  assert.equal(d.sections.find((s) => s.id === 'because').kind, 'artist');
  assert.equal(d.sections.find((s) => s.id === 'genre').reason.key, 'discover.reasons.genreCold');
});
