// Atelier (PLAN.md 4.3, 6.3, 6.10, 6.11, chantier P2-D) : édition deluxe (note de l'album et de chaque morceau d'un
// album complété, rattrapage silencieux, titre à la 10e), Vernir (royalties ou doublons, jamais le dernier
// exemplaire), Comptoir (3 doublons d'une rareté contre une carte manquante d'un album recherché), achat d'un booster
// thématique (180 royalties), éditions des vinyles du Studio, cosmétiques des coffrets et des événements, plans de
// requêtes. Vernir et le Comptoir renvoient un état partiel et le delta `cardCounts` (exemplaires après l'échange,
// P2-E), que le site fusionne (client/src/state/mergeState.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp, signupVerified, api } from './helpers.js';
import {
  COMPTOIR_DUPLICATES, DELUXE_XP, THEMED_BOOSTER_PRICE, VERNIR_DUPLICATES, boosterOdds, buyableTheme, deluxeProgress, pickDuplicates,
  recycleValue, vernirCost,
} from '../../shared/rules.js';
import { DELUXE_TITLE_AT, cosmeticDef, frameStyle } from '../../shared/cosmetics.js';
import { parseBadgeKey, rewardFor } from '../../shared/badges.js';
import { staticCatalog } from '../../shared/staticCatalog.js';

const app = await startApp();
test.after(() => app.close());
const { db, deps, services } = app;

const enc = encodeURIComponent;
const ALBUMS = staticCatalog.searchAlbums({ limit: 100 }).items.map((a) => a.id);
const tracksOf = (albumId) => staticCatalog.albumTracks(albumId);
const cardOf = (userId, trackId, variant) => db.prepare('SELECT count FROM cards WHERE user_id = ? AND track_id = ? AND variant = ?').get(userId, trackId, variant)?.count ?? 0;
const royaltiesOf = (userId) => db.prepare('SELECT royalties FROM users WHERE id = ?').get(userId).royalties;
const setRoyalties = (userId, n) => db.prepare('UPDATE users SET royalties = ? WHERE id = ?').run(n, userId);
/** Cartes données directement (même chemin qu'un booster : progression, succès, événements). */
const give = (userId, cards, source = 'test') => services.atomic(() => services.addCards(services.getUser(userId), cards, source));
const std = (trackId, times = 1) => Array.from({ length: times }, () => ({ trackId, variant: 'std' }));
/** XP des badges gagnés depuis `since` (une note ou une édition deluxe peut aussi débloquer une médaille). */
const badgeXpSince = (userId, since) => db.prepare("SELECT key FROM achievements WHERE user_id = ? AND key >= 'badge:' AND key < 'badge;' AND created_at >= ?")
  .all(userId, since).map((r) => parseBadgeKey(r.key)).reduce((n, b) => n + (b ? rewardFor(b.family, b.tier).xp || 0 : 0), 0);

// ---------- règles partagées ----------

test('règles : prix de Vernir, choix des doublons, thèmes achetables, progression deluxe ; pas de catalogue de base', () => {
  assert.deepEqual(vernirCost('common'), { royalties: 4 * recycleValue('common', 'std'), duplicates: 3 });
  assert.equal(vernirCost('legendary').royalties, 1000);
  assert.equal(vernirCost('inconnue'), null);
  // Standards d'abord, puis les cartes qui en ont le plus ; jamais le dernier exemplaire ; la carte vernie garde le sien.
  const rows = [
    { trackId: 'a', variant: 'holo', count: 5 },
    { trackId: 'b', variant: 'std', count: 2 },
    { trackId: 'c', variant: 'std', count: 4 },
    { trackId: 'd', variant: 'std', count: 1 },
  ];
  assert.deepEqual(pickDuplicates(rows, 3), [{ trackId: 'c', variant: 'std', n: 3 }]);
  assert.deepEqual(pickDuplicates(rows, 5), [{ trackId: 'c', variant: 'std', n: 3 }, { trackId: 'b', variant: 'std', n: 1 }, { trackId: 'a', variant: 'holo', n: 1 }]);
  assert.deepEqual(pickDuplicates(rows, 3, { reserve: { trackId: 'c', variant: 'std' } }), [
    { trackId: 'c', variant: 'std', n: 2 }, { trackId: 'b', variant: 'std', n: 1 },
  ]);
  assert.equal(pickDuplicates(rows, 9), null);
  assert.ok(buyableTheme('genre:rock') && buyableTheme('decade:1990') && buyableTheme('taste'));
  assert.ok(!buyableTheme('event:french-touch') && !buyableTheme('album:choice') && !buyableTheme('album:discovery') && !buyableTheme('decade:2030'));
  const p = deluxeProgress({ completed: true, albumRated: true, trackIds: ['x', 'y'], ratedTrackIds: new Set(['x']) });
  assert.deepEqual([p.ready, p.tracksRated, p.tracksTotal, p.missing], [false, 1, 2, ['y']]);
  assert.ok(deluxeProgress({ completed: true, albumRated: true, trackIds: ['x'], ratedTrackIds: new Set(['x']) }).ready);
  // Le module des règles ne tire plus le catalogue de base dans le site.
  const src = fs.readFileSync(new URL('../../shared/rules.js', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/catalog\.js'/.test(src), 'shared/rules.js importe encore shared/catalog.js');
});

test('cosmétiques des coffrets, des événements et des badges : définis et dessinés', () => {
  assert.deepEqual(cosmeticDef('frame:set-ed-classiques'), {
    id: 'frame:set-ed-classiques', kind: 'frame', key: 'set-ed-classiques', source: 'set:ed-classiques', style: 'set', setId: 'ed-classiques',
  });
  assert.equal(frameStyle('set-g-rock-1970'), 'set');
  assert.equal(frameStyle('french-touch'), 'french-touch');
  assert.equal(frameStyle('frame:rock-legends'), 'rock-legends');
  assert.equal(frameStyle('or'), 'or');
  assert.equal(frameStyle('inconnu'), null);
  assert.equal(cosmeticDef('title:juge').source, 'badge:judge');
  assert.equal(cosmeticDef('title:deluxe').kind, 'title');
  assert.equal(cosmeticDef('vinyl:prune').level, 5);
  assert.equal(cosmeticDef('frame:set-'), null);
});

// ---------- Vernir ----------

test('Vernir en royalties : la carte standard devient holo, 4 × sa valeur de recyclage, delta des exemplaires', async () => {
  const alice = await signupVerified(app, { username: 'ws_alice' });
  const [t1] = tracksOf(ALBUMS[0]);
  give(alice.user.id, std(t1.id));
  const cost = vernirCost(t1.rarity).royalties;
  setRoyalties(alice.user.id, cost + 7);

  const info = await api(app.base, alice.cookie, 'GET', `/collection/vernir/${enc(t1.id)}`);
  assert.equal(info.status, 200, JSON.stringify(info.body));
  assert.deepEqual({ ...info.body, cost: undefined }, {
    trackId: t1.id, rarity: t1.rarity, std: 1, holo: 0, cost: undefined, royalties: cost + 7, duplicates: 0,
    can: { royalties: true, duplicates: false }, reason: null,
  });

  const r = await api(app.base, alice.cookie, 'POST', '/collection/vernir', { trackId: t1.id, pay: 'royalties' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.spent, { royalties: cost });
  assert.equal(r.body.state.partial, true, 'état partiel');
  assert.ok(r.body.cardCounts.some((c) => c.t === t1.id && c.v === 'holo' && c.c === 1));
  assert.ok(r.body.cardCounts.some((c) => c.t === t1.id && c.v === 'std' && c.c === 0), 'le dernier exemplaire standard est devenu holo');
  assert.equal(royaltiesOf(alice.user.id), 7);
  assert.equal(cardOf(alice.user.id, t1.id, 'holo'), 1);
  assert.equal(db.prepare('SELECT holo FROM user_album_progress WHERE user_id = ? AND album_id = ?').get(alice.user.id, ALBUMS[0]).holo, 1);
  assert.equal(db.prepare('SELECT unique_cards FROM users WHERE id = ?').get(alice.user.id).unique_cards, 1, 'toujours une carte');

  // Déjà holo, pas possédée, pas assez de royalties, paiement inconnu.
  assert.deepEqual((await api(app.base, alice.cookie, 'POST', '/collection/vernir', { trackId: t1.id, pay: 'royalties' })).body, { error: 'already_holo' });
  assert.equal((await api(app.base, alice.cookie, 'GET', `/collection/vernir/${enc(t1.id)}`)).body.reason, 'already_holo');
  const [, t2, t3] = tracksOf(ALBUMS[0]);
  const notOwned = await api(app.base, alice.cookie, 'POST', '/collection/vernir', { trackId: t2.id, pay: 'royalties' });
  assert.deepEqual([notOwned.status, notOwned.body.error], [409, 'not_owned']);
  give(alice.user.id, std(t3.id));
  const poor = await api(app.base, alice.cookie, 'POST', '/collection/vernir', { trackId: t3.id, pay: 'royalties' });
  assert.deepEqual([poor.status, poor.body], [409, { error: 'not_enough_royalties', cost: vernirCost(t3.rarity).royalties }]);
  assert.equal((await api(app.base, alice.cookie, 'POST', '/collection/vernir', { trackId: t3.id, pay: 'argent' })).status, 400);
  assert.equal((await api(app.base, alice.cookie, 'POST', '/collection/vernir', { trackId: 'inconnu:01', pay: 'royalties' })).status, 404);
  assert.equal((await api(app.base, '', 'POST', '/collection/vernir', { trackId: t3.id, pay: 'royalties' })).status, 401);
});

test('Vernir avec 3 doublons de la même rareté : standards d’abord, la carte vernie garde un exemplaire', async () => {
  const bob = await signupVerified(app, { username: 'ws_bob' });
  const pool = tracksOf(ALBUMS[1]);
  const rarity = pool[0].rarity;
  const same = pool.filter((t) => t.rarity === rarity);
  const target = same[0];
  // 3 exemplaires de la carte visée (2 en trop, dont un mis de côté) et un doublon d'une autre carte de la rareté.
  give(bob.user.id, [...std(target.id, 3)]);
  const other = same[1] || null;
  if (other) give(bob.user.id, std(other.id, 2));
  const info = (await api(app.base, bob.cookie, 'GET', `/collection/vernir/${enc(target.id)}`)).body;
  assert.equal(info.duplicates, other ? 2 : 1);
  const short = await api(app.base, bob.cookie, 'POST', '/collection/vernir', { trackId: target.id, pay: 'duplicates' });
  assert.deepEqual([short.status, short.body], [409, { error: 'not_enough_duplicates', needed: VERNIR_DUPLICATES, have: info.duplicates }]);
  // Un doublon de plus (une autre version de la même rareté ailleurs) : ça passe.
  const extra = same[2] || same[1] || same[0];
  give(bob.user.id, std(extra.id, extra.id === target.id ? 1 : 2));
  if (!other && extra.id !== target.id) give(bob.user.id, std(extra.id, 1));
  const before = (await api(app.base, bob.cookie, 'GET', `/collection/vernir/${enc(target.id)}`)).body.duplicates;
  assert.ok(before >= VERNIR_DUPLICATES, `${before} doublons`);
  const royalties = royaltiesOf(bob.user.id);
  const r = await api(app.base, bob.cookie, 'POST', '/collection/vernir', { trackId: target.id, pay: 'duplicates' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.spent.duplicates.reduce((n, p) => n + p.n, 0), VERNIR_DUPLICATES);
  assert.ok(r.body.spent.duplicates.every((p) => p.variant === 'std'));
  assert.equal(royaltiesOf(bob.user.id), royalties, 'payé en doublons seulement');
  assert.equal(cardOf(bob.user.id, target.id, 'holo'), 1);
  assert.ok(cardOf(bob.user.id, target.id, 'std') >= 1, 'un exemplaire standard reste');
  const left = (await api(app.base, bob.cookie, 'GET', `/collection/vernir/${enc(extra.id === target.id ? same[1]?.id ?? target.id : extra.id)}`)).body;
  assert.ok(left.std >= 1, 'jamais le dernier exemplaire d’une version');
});

test('Vernir la dernière carte non holo d’un album : l’édition holo est réunie', async () => {
  const cid = await signupVerified(app, { username: 'ws_carl' });
  const albumId = ALBUMS[2];
  const tracks = tracksOf(albumId);
  give(cid.user.id, [...tracks.slice(1).map((t) => ({ trackId: t.id, variant: 'holo' })), { trackId: tracks[0].id, variant: 'std' }]);
  setRoyalties(cid.user.id, 5000);
  const r = await api(app.base, cid.cookie, 'POST', '/collection/vernir', { trackId: tracks[0].id, pay: 'royalties' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.holoEdition, true);
  const studio = (await api(app.base, cid.cookie, 'GET', `/users/${cid.username}`)).body;
  const vinyl = studio.vinyls.find((v) => v.albumId === albumId);
  assert.deepEqual([vinyl.edition, vinyl.holo, vinyl.color], ['holo', true, null]);
});

// ---------- Comptoir ----------

test('Comptoir : 3 doublons d’une rareté contre une carte manquante choisie d’un album recherché', async () => {
  const dana = await signupVerified(app, { username: 'ws_dana' });
  const albumId = ALBUMS[3];
  const tracks = tracksOf(albumId);
  const wanted = tracks.find((t) => t.rarity === 'common') || tracks[0];
  const rarity = wanted.rarity;
  // Doublons de cette rareté pris dans un autre album.
  const spares = ALBUMS.slice(4).flatMap(tracksOf).filter((t) => t.rarity === rarity).slice(0, 2);
  give(dana.user.id, [...std(spares[0].id, 3), ...std(spares[1].id, 2)]);

  const notWished = await api(app.base, dana.cookie, 'POST', '/collection/comptoir', { trackId: wanted.id });
  assert.deepEqual([notWished.status, notWished.body.error], [409, 'not_wishlisted']);
  assert.equal((await api(app.base, dana.cookie, 'PUT', `/me/wishlist/${enc(albumId)}`)).status, 200);

  const page = await api(app.base, dana.cookie, 'GET', '/collection/comptoir');
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.equal(page.body.needed, COMPTOIR_DUPLICATES);
  assert.equal(page.body.duplicates[rarity], 3);
  assert.equal(page.body.items.length, 1);
  assert.equal(page.body.items[0].albumId, albumId);
  assert.equal(page.body.items[0].missing.length, tracks.length);
  assert.ok(page.body.items[0].missing.some((m) => m.trackId === wanted.id && m.rarity === rarity));
  assert.ok(page.body.catalog.tracks.some((t) => t.id === wanted.id));

  const r = await api(app.base, dana.cookie, 'POST', '/collection/comptoir', { trackId: wanted.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.spent.duplicates, [{ trackId: spares[0].id, variant: 'std', n: 2 }, { trackId: spares[1].id, variant: 'std', n: 1 }]);
  assert.equal(r.body.cards[0].trackId, wanted.id);
  assert.equal(r.body.cards[0].newTrack, true);
  assert.equal(r.body.state.partial, true);
  // Doublons dépensés : leurs exemplaires restants dans le delta `cardCounts`.
  assert.ok(r.body.cardCounts.some((c) => c.t === spares[0].id && c.v === 'std' && c.c === 1));
  assert.equal(cardOf(dana.user.id, wanted.id, 'std'), 1);
  assert.equal(cardOf(dana.user.id, spares[0].id, 'std'), 1);
  assert.equal(cardOf(dana.user.id, spares[1].id, 'std'), 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pack_openings WHERE user_id = ? AND source = 'comptoir'").get(dana.user.id).n, 1);

  const again = await api(app.base, dana.cookie, 'POST', '/collection/comptoir', { trackId: wanted.id });
  assert.deepEqual([again.status, again.body.error], [409, 'already_owned']);
  const other = tracks.find((t) => t.id !== wanted.id && t.rarity === rarity) || tracks.find((t) => t.id !== wanted.id);
  const short = await api(app.base, dana.cookie, 'POST', '/collection/comptoir', { trackId: other.id });
  assert.deepEqual([short.status, short.body.error, short.body.needed], [409, 'not_enough_duplicates', COMPTOIR_DUPLICATES]);
  const promo = staticCatalog.promos({ limit: 1 }).items[0];
  assert.deepEqual((await api(app.base, dana.cookie, 'POST', '/collection/comptoir', { trackId: promo.id })).body, { error: 'not_exchangeable' });
});

test('Comptoir : la carte qui complète l’album donne le vinyle (Pressage n°) ; pages des albums recherchés', async () => {
  const eve = await signupVerified(app, { username: 'ws_eve' });
  const albumId = ALBUMS[5];
  const tracks = tracksOf(albumId);
  const last = tracks[tracks.length - 1];
  give(eve.user.id, tracks.slice(0, -1).map((t) => ({ trackId: t.id, variant: 'std' })));
  const spare = ALBUMS.slice(6).flatMap(tracksOf).find((t) => t.rarity === last.rarity);
  give(eve.user.id, std(spare.id, 4));
  for (const id of [albumId, ...ALBUMS.slice(7, 15)]) await api(app.base, eve.cookie, 'PUT', `/me/wishlist/${enc(id)}`);
  const first = (await api(app.base, eve.cookie, 'GET', '/collection/comptoir?limit=4')).body;
  assert.equal(first.items.length, 4);
  assert.ok(first.nextCursor);
  const second = (await api(app.base, eve.cookie, 'GET', `/collection/comptoir?limit=4&cursor=${first.nextCursor}`)).body;
  assert.equal(second.items.length, 4);
  assert.ok(!second.items.some((a) => first.items.some((b) => b.albumId === a.albumId)), 'pages disjointes');
  assert.equal(first.incomplete, 9);

  const r = await api(app.base, eve.cookie, 'POST', '/collection/comptoir', { trackId: last.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const done = r.body.achievements.find((a) => a.key === `album:${albumId}`);
  assert.ok(done, 'album complété');
  assert.equal(done.rank, 1);
  assert.ok(!(await api(app.base, eve.cookie, 'GET', '/collection/comptoir?limit=24')).body.items.some((a) => a.albumId === albumId), 'album complet retiré');
});

// ---------- booster thématique ----------

test('booster thématique : 180 royalties, dans l’inventaire, mêmes chances ; jamais un événement ni un album', async () => {
  const fay = await signupVerified(app, { username: 'ws_fay' });
  setRoyalties(fay.user.id, THEMED_BOOSTER_PRICE * 2 - 1);
  const r = await api(app.base, fay.cookie, 'POST', '/me/boosters/buy', { theme: 'genre:rock' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.spent, THEMED_BOOSTER_PRICE);
  assert.deepEqual({ ...r.body.booster, id: 0, createdAt: 0 }, { id: 0, kind: 'theme', theme: 'genre:rock', source: 'shop', createdAt: 0 });
  assert.equal(r.body.state.partial, true);
  assert.equal(r.body.state.user.royalties, THEMED_BOOSTER_PRICE - 1);
  const inv = (await api(app.base, fay.cookie, 'GET', '/me/boosters')).body.items;
  assert.ok(inv.some((b) => b.id === r.body.booster.id && b.source === 'shop'));
  assert.deepEqual((await api(app.base, fay.cookie, 'GET', '/boosters/odds?theme=genre%3Arock')).body.slots, boosterOdds(null).slots);
  const poor = await api(app.base, fay.cookie, 'POST', '/me/boosters/buy', { theme: 'decade:1990' });
  assert.deepEqual([poor.status, poor.body], [409, { error: 'not_enough_royalties', cost: THEMED_BOOSTER_PRICE }]);
  for (const theme of ['event:french-touch', 'album:choice', `album:${ALBUMS[0]}`, 'decade:1930', 'genre:inconnu', 42, null]) {
    assert.equal((await api(app.base, fay.cookie, 'POST', '/me/boosters/buy', { theme })).status, 400, String(theme));
  }
  // Il s'ouvre comme les autres boosters spéciaux (même écran d'ouverture côté site).
  const open = await api(app.base, fay.cookie, 'POST', `/me/boosters/${r.body.booster.id}/open`);
  assert.equal(open.status, 200, JSON.stringify(open.body));
  assert.equal(open.body.cards.length, 5);
});

// ---------- édition deluxe ----------

test('édition deluxe : album complété, album noté, chaque morceau noté → succès, +50 XP, notification, vinyle deluxe', async () => {
  const gus = await signupVerified(app, { username: 'ws_gus' });
  const albumId = ALBUMS[6];
  const tracks = tracksOf(albumId);
  give(gus.user.id, tracks.map((t) => ({ trackId: t.id, variant: 'std' })));
  const status0 = (await api(app.base, gus.cookie, 'GET', `/albums/${enc(albumId)}/deluxe`)).body;
  assert.deepEqual([status0.completed, status0.albumRated, status0.tracksRated, status0.tracksTotal, status0.done], [true, false, 0, tracks.length, false]);
  assert.equal(status0.missing.length, tracks.length);
  assert.equal(status0.state, undefined);

  assert.equal((await api(app.base, gus.cookie, 'PUT', `/ratings/album/${enc(albumId)}`, { score: 8 })).status, 200);
  for (const t of tracks.slice(0, -1)) assert.equal((await api(app.base, gus.cookie, 'PUT', `/ratings/track/${enc(t.id)}`, { score: 7 })).status, 200);
  assert.equal((await api(app.base, gus.cookie, 'GET', `/albums/${enc(albumId)}/deluxe`)).body.missing.length, 1);
  const xp = db.prepare('SELECT xp FROM users WHERE id = ?').get(gus.user.id).xp;
  const t0 = Date.now();
  const lastRate = await api(app.base, gus.cookie, 'PUT', `/ratings/track/${enc(tracks.at(-1).id)}`, { score: 9 });
  assert.equal(lastRate.status, 200);
  assert.ok(db.prepare('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?').get(gus.user.id, `deluxe:${albumId}`), 'succès deluxe');
  // +50 XP, plus ceux des badges gagnés par la même note (« Oreille fine » : chaque morceau d'un album noté).
  const badgeXp = badgeXpSince(gus.user.id, t0);
  assert.equal(db.prepare('SELECT xp FROM users WHERE id = ?').get(gus.user.id).xp, xp + DELUXE_XP + badgeXp);
  assert.equal(lastRate.body.state.user.level.xp, xp + DELUXE_XP + badgeXp, 'l’XP est dans l’état partiel de la note');
  const notes = db.prepare("SELECT target_id, data FROM notifications WHERE user_id = ? AND kind = 'deluxe_earned'").all(gus.user.id);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].target_id, albumId);

  const status = (await api(app.base, gus.cookie, 'GET', `/albums/${enc(albumId)}/deluxe`)).body;
  assert.equal(status.done, true);
  assert.deepEqual(status.achievements, [{ key: `deluxe:${albumId}`, rank: null }]);
  assert.equal(status.state.partial, true);
  // Le succès est dans l'état complet (comme les vinyles) ; la note retirée ne l'enlève pas.
  assert.ok((await api(app.base, gus.cookie, 'GET', '/state')).body.achievements.some((a) => a.key === `deluxe:${albumId}`));
  await api(app.base, gus.cookie, 'DELETE', `/ratings/track/${enc(tracks[0].id)}`);
  assert.equal((await api(app.base, gus.cookie, 'GET', `/albums/${enc(albumId)}/deluxe`)).body.done, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'deluxe_earned'").get(gus.user.id).n, 1, 'une seule fois');

  // Studio : vinyle deluxe (pas de couleur choisie), vu par soi et par un autre, et dans l'onglet Vinyles.
  const other = await signupVerified(app, { username: 'ws_gus_friend' });
  for (const who of [gus, other]) {
    const studio = (await api(app.base, who.cookie, 'GET', `/users/${gus.username}`)).body;
    const vinyl = studio.vinyls.find((v) => v.albumId === albumId);
    assert.deepEqual([vinyl.edition, vinyl.holo, vinyl.color], ['deluxe', false, null]);
  }
  const page = (await api(app.base, other.cookie, 'GET', `/users/${gus.username}/vinyls`)).body;
  assert.equal(page.items.find((v) => v.albumId === albumId).edition, 'deluxe');
  await api(app.base, gus.cookie, 'PUT', '/me/studio', { featuredVinyl: albumId });
  assert.equal((await api(app.base, gus.cookie, 'GET', `/users/${gus.username}`)).body.featuredVinyl.edition, 'deluxe');
});

test('édition deluxe : tout noté avant de compléter l’album → donnée à la complétion', async () => {
  const hal = await signupVerified(app, { username: 'ws_hal' });
  const albumId = ALBUMS[7];
  const tracks = tracksOf(albumId);
  await api(app.base, hal.cookie, 'PUT', `/ratings/album/${enc(albumId)}`, { score: 6 });
  for (const t of tracks) await api(app.base, hal.cookie, 'PUT', `/ratings/track/${enc(t.id)}`, { score: 6 });
  assert.equal((await api(app.base, hal.cookie, 'GET', `/albums/${enc(albumId)}/deluxe`)).body.done, false);
  give(hal.user.id, tracks.map((t) => ({ trackId: t.id, variant: 'std' })));
  assert.ok(db.prepare('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?').get(hal.user.id, `deluxe:${albumId}`));
  assert.equal((await api(app.base, hal.cookie, 'GET', '/albums/inconnu/deluxe')).status, 404);
});

test('édition deluxe : rattrapage silencieux au premier Studio, une fois ; titre « Oreille deluxe » à la 10e', async () => {
  const ivy = await signupVerified(app, { username: 'ws_ivy' });
  const albums = ALBUMS.slice(8, 8 + DELUXE_TITLE_AT);
  const now = Date.now();
  // Albums complétés et notés avant P2 : écrits directement, sans événement.
  const insCard = db.prepare("INSERT INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, 'std', 1, ?)");
  const insAch = db.prepare('INSERT INTO achievements (user_id, key, created_at, rank) VALUES (?, ?, ?, 1)');
  const insRate = db.prepare('INSERT INTO ratings (user_id, item_type, item_id, score, created_at, updated_at) VALUES (?, ?, ?, 7, ?, ?)');
  for (const albumId of albums) {
    for (const t of tracksOf(albumId)) {
      insCard.run(ivy.user.id, t.id, now);
      insRate.run(ivy.user.id, 'track', t.id, now, now);
    }
    insAch.run(ivy.user.id, `album:${albumId}`, now);
    insRate.run(ivy.user.id, 'album', albumId, now, now);
  }
  services.recountCollection?.(ivy.user.id, albums);
  const xp = db.prepare('SELECT xp FROM users WHERE id = ?').get(ivy.user.id).xp;
  const t0 = Date.now();
  const studio = (await api(app.base, ivy.cookie, 'GET', `/users/${ivy.username}`)).body;
  assert.equal(studio.vinyls.filter((v) => v.edition === 'deluxe').length, albums.length);
  // +50 XP par édition, plus ceux des badges qu'elles débloquent (si une famille de badges les compte).
  assert.equal(db.prepare('SELECT xp FROM users WHERE id = ?').get(ivy.user.id).xp, xp + DELUXE_XP * albums.length + badgeXpSince(ivy.user.id, t0));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'deluxe_earned'").get(ivy.user.id).n, 0, 'rattrapage silencieux');
  assert.equal(deps.workshop.backfillDeluxe(ivy.user.id), 0, 'une seule fois');
  const cos = (await api(app.base, ivy.cookie, 'GET', '/me/cosmetics')).body;
  assert.ok(cos.unlocked.some((c) => c.id === 'title:deluxe'));
  assert.equal((await api(app.base, ivy.cookie, 'PUT', '/me/cosmetics', { title: 'deluxe' })).status, 200);
});

// ---------- cosmétiques des coffrets et des événements ----------

test('cadres des coffrets et des événements : accordés, choisis, montrés dans les résumés de joueur', async () => {
  const jo = await signupVerified(app, { username: 'ws_jo' });
  deps.collection.grantCosmetic(jo.user.id, 'frame:set-ed-classiques', 'set:ed-classiques');
  deps.collection.grantCosmetic(jo.user.id, 'frame:french-touch', 'event:french-touch');
  const cos = (await api(app.base, jo.cookie, 'GET', '/me/cosmetics')).body;
  assert.ok(cos.unlocked.some((c) => c.id === 'frame:set-ed-classiques'));
  for (const frame of ['set-ed-classiques', 'french-touch']) {
    const r = await api(app.base, jo.cookie, 'PUT', '/me/cosmetics', { frame });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(frameStyle(r.body.cosmetics.frame), frame.startsWith('set-') ? 'set' : frame);
  }
  assert.equal((await api(app.base, jo.cookie, 'PUT', '/me/cosmetics', { frame: 'rock-legends' })).status, 409);
  assert.equal(services.userSummaries([jo.user.id]).get(jo.user.id).frame, 'french-touch');
});

// ---------- performances ----------

test('plans de requêtes de l’atelier : cartes et succès par la clé primaire, jamais un parcours complet', () => {
  const plan = (sql, ...args) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(' | ');
  const spares = plan(`SELECT c.track_id, c.variant, c.count FROM cards c CROSS JOIN cat_tracks t
    WHERE c.user_id = ? AND c.count > 1 AND t.id = c.track_id AND t.rarity = ?`, 1, 'common');
  assert.match(spares, /SEARCH c USING (INDEX|PRIMARY KEY)/);
  assert.doesNotMatch(spares, /SCAN c\b|SCAN cards/);
  const deluxe = plan(`SELECT substr(key, 8) FROM achievements WHERE user_id = ? AND key IN (SELECT 'deluxe:' || value FROM json_each(?))`, 1, '["a"]');
  assert.doesNotMatch(deluxe, /SCAN achievements/);
  const backfill = plan(`SELECT substr(a.key, 7) FROM achievements a WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;'
    AND EXISTS (SELECT 1 FROM ratings r WHERE r.user_id = a.user_id AND r.item_type = 'album' AND r.item_id = substr(a.key, 7))
    AND NOT EXISTS (SELECT 1 FROM achievements d WHERE d.user_id = a.user_id AND d.key = 'deluxe:' || substr(a.key, 7)) LIMIT 10`, 1);
  assert.doesNotMatch(backfill, /SCAN (a|r|d|achievements|ratings)\b/);
});
