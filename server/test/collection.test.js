// Jeu de collection (PLAN.md 4.2.5 et 6, chantier P1-D) : albums recherchés et leurs places par niveau, partage du
// ciblage des boosters (statistiques sur 2 000 boosters), pitié douce, promos ciblées et pressables, rareté au tirage
// (pulled_rarity), paliers de niveau, boosters spéciaux et leurs chances, cosmétiques, moment de complétion
// (Pressage n° sous des complétions simultanées).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';
import {
  rollPack, isHit, PITY_AFTER, WISHLIST_FOCUS, ADVANCED_FOCUS, FOCUS_CHANCE, PROMO_FOCUS, PROMO_PRESS_COST, wishlistMax,
} from '../../shared/rules.js';
import { staticCatalog } from '../../shared/staticCatalog.js';
import { parseBadgeKey, rewardFor } from '../../shared/badges.js';

const app = await startApp();
test.after(() => app.close());
const { db, deps, services } = app;

const enc = encodeURIComponent;
const xpForLevel = (level) => 50 * (level - 1) ** 2;
const setLevel = (userId, level) => db.prepare('UPDATE users SET xp = ? WHERE id = ?').run(xpForLevel(level), userId);
let botCounter = 0;
/** Joueur créé directement en base (vérifié, CGU acceptées), pour les appels à l'API interne. */
function bot({ royalties = 0, packs = 0 } = {}) {
  const now = Date.now();
  const name = `col${++botCounter}`;
  return db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, royalties, bonus_packs, packs_at, created_at)
    VALUES (?, ?, 'x', ?, ?, ?, ?, ?) RETURNING id`).get(`${name}@example.com`, name, now, royalties, packs, now, now).id;
}
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

// ---------- albums recherchés ----------

test('albums recherchés : 12 places, +4 aux niveaux 10, 25 et 50 ; 409 wishlist_full ; idempotent', async () => {
  assert.deepEqual([1, 9, 10, 24, 25, 49, 50, 100].map(wishlistMax), [12, 12, 16, 16, 20, 20, 24, 24]);
  const alice = await signupVerified(app, { username: 'wish_alice' });
  const albums = staticCatalog.searchAlbums({ limit: 100 }).items.map((a) => a.id);
  for (const [i, id] of albums.slice(0, 12).entries()) {
    const r = await api(app.base, alice.cookie, 'PUT', `/me/wishlist/${enc(id)}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { wanted: true, count: i + 1, max: 12 });
  }
  // Déjà recherché : rien ne change.
  assert.equal((await api(app.base, alice.cookie, 'PUT', `/me/wishlist/${enc(albums[0])}`)).body.count, 12);
  const full = await api(app.base, alice.cookie, 'PUT', `/me/wishlist/${enc(albums[12])}`);
  assert.equal(full.status, 409);
  assert.deepEqual(full.body, { error: 'wishlist_full', max: 12 });
  assert.equal((await api(app.base, alice.cookie, 'PUT', '/me/wishlist/inconnu')).status, 404);
  // Niveau 10 : 4 places de plus.
  setLevel(alice.user.id, 10);
  const more = await api(app.base, alice.cookie, 'PUT', `/me/wishlist/${enc(albums[12])}`);
  assert.deepEqual(more.body, { wanted: true, count: 13, max: 16 });
  const del = await api(app.base, alice.cookie, 'DELETE', `/me/wishlist/${enc(albums[0])}`);
  assert.deepEqual(del.body, { wanted: false, count: 12, max: 16 });
  const mine = (await api(app.base, alice.cookie, 'GET', '/me/wishlist')).body;
  assert.equal(mine.items.length, 12);
  assert.equal(mine.items[0], albums[1], 'ordre d’ajout');
  assert.ok(mine.catalog.albums.length === 12);
  // L'état du joueur annonce ses places.
  assert.equal((await api(app.base, alice.cookie, 'GET', '/state')).body.user.slots.wishlist, 16);
  // Une seule liste « wishlist » par joueur (lists_singleton), jamais indexée comme une liste ordinaire.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lists WHERE user_id = ? AND kind = 'wishlist'").get(alice.user.id).n, 1);
});

test('albums recherchés d’un autre joueur : progression, profil privé (403) et blocages (404)', async () => {
  const bob = await signupVerified(app, { username: 'wish_bob' });
  const carla = await signupVerified(app, { username: 'wish_carla' });
  await api(app.base, bob.cookie, 'PUT', '/me/wishlist/discovery');
  db.prepare("INSERT INTO cards (user_id, track_id, variant, count, first_at, pulled_rarity) VALUES (?, 'discovery:01', 'std', 1, ?, 'common')").run(bob.user.id, Date.now());
  services.refreshProgress(bob.user.id, ['discovery']);
  const seen = await api(app.base, carla.cookie, 'GET', '/users/wish_bob/wishlist');
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.items, ['discovery']);
  assert.deepEqual(seen.body.progress.discovery, { owned: 1, total: staticCatalog.albumTrackIds('discovery').length });
  db.prepare("UPDATE users SET profile_visibility = 'private' WHERE id = ?").run(bob.user.id);
  assert.equal((await api(app.base, carla.cookie, 'GET', '/users/wish_bob/wishlist')).status, 403);
  assert.equal((await api(app.base, bob.cookie, 'GET', '/users/wish_bob/wishlist')).status, 200, 'le joueur voit toujours la sienne');
  db.prepare("UPDATE users SET profile_visibility = 'public' WHERE id = ?").run(bob.user.id);
  assert.equal((await api(app.base, bob.cookie, 'PUT', `/blocks/${carla.user.id}`)).status, 200);
  assert.equal((await api(app.base, carla.cookie, 'GET', '/users/wish_bob/wishlist')).status, 404);
  assert.equal((await api(app.base, '', 'GET', '/users/wish_bob/wishlist')).status, 401);
});

test('onboarding : addToWishlist ajoute tant qu’il reste de la place, ignore les albums inconnus', () => {
  const uid = bot();
  const albums = staticCatalog.searchAlbums({ limit: 100 }).items.map((a) => a.id);
  const out = deps.collection.addToWishlist(uid, ['inconnu', ...albums]);
  assert.equal(out.length, 12);
  assert.equal(out[0], albums[0]);
});

// ---------- ciblage des boosters ----------

/** Catalogue statique qui compte les emplacements servis par la liste d'envies et par les albums avancés. */
function countingCatalog(wishIds, advancedIds) {
  const counts = { wish: 0, advanced: 0, promoMine: 0, promo: 0 };
  return {
    counts,
    randomTrack(opts, rng) {
      const track = staticCatalog.randomTrack(opts, rng);
      if (track && opts.albumIds === wishIds) counts.wish += 1;
      if (track && opts.albumIds === advancedIds) counts.advanced += 1;
      return track;
    },
  };
}

test('ciblage : 25 % des emplacements pour la liste d’envies, 10 % pour les albums avancés (2 000 boosters)', () => {
  assert.equal(WISHLIST_FOCUS + ADVANCED_FOCUS, FOCUS_CHANCE);
  // Albums qui ont les six raretés hors promo : le ciblage ne retombe jamais faute de carte.
  const wishIds = ['discovery', 'abbey-road'];
  const advancedIds = ['the-eminem-show', 'back-to-black'];
  const boosters = 2000;
  // Emplacements comptés : ceux qui ne tirent pas une promo (l'emplacement promo n'est jamais ciblé vers les albums).
  const nonPromo = (pack) => pack.filter((c) => c.rarity !== 'promo').length;
  const cat = countingCatalog(wishIds, advancedIds);
  let slots = 0;
  for (let i = 0; i < boosters; i++) {
    slots += nonPromo(rollPack(Math.random, cat, { wishlist: { albumIds: wishIds, owned: new Set() }, focusAlbumIds: advancedIds }));
  }
  const wishShare = cat.counts.wish / slots;
  const advShare = cat.counts.advanced / slots;
  assert.ok(Math.abs(wishShare - 0.25) <= 0.03, `liste d’envies : ${(wishShare * 100).toFixed(1)} %`);
  assert.ok(Math.abs(advShare - 0.10) <= 0.03, `albums avancés : ${(advShare * 100).toFixed(1)} %`);
  // Liste d'envies vide : les 35 % vont aux albums avancés.
  const solo = countingCatalog(null, advancedIds);
  let soloSlots = 0;
  for (let i = 0; i < boosters; i++) soloSlots += nonPromo(rollPack(Math.random, solo, { focusAlbumIds: advancedIds }));
  const soloShare = solo.counts.advanced / soloSlots;
  assert.ok(Math.abs(soloShare - 0.35) <= 0.03, `sans liste d’envies : ${(soloShare * 100).toFixed(1)} %`);
});

test('ciblage : la liste d’envies ne vise que les cartes manquantes', () => {
  const wishIds = ['discovery'];
  const ids = staticCatalog.albumTrackIds('discovery');
  const owned = new Set(ids.slice(1)); // une seule carte manquante
  let seen = 0;
  for (let i = 0; i < 400; i++) {
    for (const c of rollPack(Math.random, staticCatalog, { wishlist: { albumIds: wishIds, owned } })) {
      if (c.trackId === ids[0]) seen += 1;
    }
  }
  assert.ok(seen > 0, 'la carte manquante sort');
  // Par le serveur : packFocus n'emporte que les albums recherchés incomplets.
  const uid = bot();
  deps.collection.addToWishlist(uid, ['discovery', 'thriller']);
  services.adminCompleteCollection(uid, 'thriller');
  const focus = services.packFocus(uid);
  assert.deepEqual(focus.wishlist.albumIds, ['discovery']);
});

test('promos : la moitié des promos tirées viennent des artistes du joueur', () => {
  const artistIds = ['daft-punk'];
  let promos = 0;
  let mine = 0;
  for (let i = 0; i < 6000; i++) {
    const pack = rollPack(Math.random, staticCatalog, { promoArtistIds: () => artistIds });
    for (const c of pack) {
      if (c.rarity !== 'promo') continue;
      promos += 1;
      if (staticCatalog.track(c.trackId).artistId === 'daft-punk') mine += 1;
    }
  }
  const base = 1 / staticCatalog.promos({ limit: 100 }).items.length;
  const expected = PROMO_FOCUS + (1 - PROMO_FOCUS) * base;
  assert.ok(promos > 300, `promos tirées : ${promos}`);
  assert.ok(Math.abs(mine / promos - expected) <= 0.06, `${(100 * mine / promos).toFixed(1)} % (attendu ${(100 * expected).toFixed(1)} %)`);
  // Par le serveur : les artistes des cartes possédées et des albums recherchés (ayant des promos).
  const uid = bot();
  db.prepare("INSERT INTO cards (user_id, track_id, variant, count, first_at, pulled_rarity) VALUES (?, 'abbey-road:01', 'std', 1, ?, 'common')").run(uid, Date.now());
  services.refreshProgress(uid, ['abbey-road']);
  deps.collection.addToWishlist(uid, ['nevermind']);
  assert.deepEqual(services.packFocus(uid).promoArtistIds().sort(), ['nirvana', 'the-beatles']);
});

test('promos pressables : 409 promo_locked, puis 1 200 royalties une fois un album de l’artiste complété', async () => {
  const dan = await signupVerified(app, { username: 'press_dan' });
  db.prepare('UPDATE users SET royalties = 5000 WHERE id = ?').run(dan.user.id);
  const promo = staticCatalog.promos({ limit: 100 }).items.find((t) => t.artistId === 'nirvana');
  const info = (await api(app.base, dan.cookie, 'GET', `/me/press/${enc(promo.id)}`)).body;
  assert.deepEqual({ cost: info.cost, pressable: info.pressable, reason: info.reason }, { cost: null, pressable: false, reason: 'promo_locked' });
  const locked = await api(app.base, dan.cookie, 'POST', '/collection/press', { trackId: promo.id });
  assert.equal(locked.status, 409);
  assert.equal(locked.body.error, 'promo_locked');
  services.adminCompleteCollection(dan.user.id, 'nevermind');
  const open = (await api(app.base, dan.cookie, 'GET', `/me/press/${enc(promo.id)}`)).body;
  assert.equal(open.cost, PROMO_PRESS_COST);
  assert.equal(open.pressable, true);
  const pressed = await api(app.base, dan.cookie, 'POST', '/collection/press', { trackId: promo.id });
  assert.equal(pressed.status, 200, JSON.stringify(pressed.body));
  assert.equal(pressed.body.spent, PROMO_PRESS_COST);
  // Presser la promo complète la discographie de Nirvana (son seul album et sa promo) : médaille « Maître » argent,
  // +100 royalties (PLAN.md 5.7, chantier P1-F). Les royalties des médailles gagnées s'ajoutent au solde attendu.
  const badgeRoyalties = db.prepare("SELECT key FROM achievements WHERE user_id = ? AND key >= 'badge:' AND key < 'badge;'").all(dan.user.id)
    .reduce((sum, r) => {
      const b = parseBadgeKey(r.key);
      return sum + (b ? rewardFor(b.family, b.tier).royalties : 0);
    }, 0);
  assert.equal(pressed.body.state.user.royalties, 5000 - PROMO_PRESS_COST + pressed.body.royalties + badgeRoyalties);
  assert.equal((await api(app.base, dan.cookie, 'GET', `/me/press/${enc(promo.id)}`)).body.reason, 'owned');
});

// ---------- pitié douce, rareté au tirage ----------

test('pitié douce : une carte ultra ou mieux au plus tard au 10e booster, compteur remis à zéro', () => {
  assert.equal(PITY_AFTER, 10);
  // Tirage pur : à 9 boosters sans « hit », le suivant en contient forcément un.
  for (let i = 0; i < 300; i++) assert.ok(rollPack(Math.random, staticCatalog, { pity: 9 }).some((c) => isHit(c.rarity)));
  // Par le serveur : 300 boosters d'affilée, jamais 10 de suite sans hit ; le compteur suit.
  const uid = bot();
  let pity = 0;
  let longest = 0;
  for (let round = 0; round < 6; round++) {
    // Un joueur avec des boosters bonus, ouverts un par un pour suivre `pity`.
    db.prepare('UPDATE users SET bonus_packs = 50 WHERE id = ?').run(uid);
    for (let i = 0; i < 50; i++) {
      const res = services.openPacks(uid, 1);
      const hit = res.cards.some((c) => isHit(c.rarity));
      pity = hit ? 0 : pity + 1;
      longest = Math.max(longest, pity);
      assert.equal(res.pity, pity);
    }
  }
  assert.ok(longest <= PITY_AFTER - 1, `plus longue série sans hit : ${longest}`);
  assert.equal(services.getUser(uid).pity, pity);
  assert.equal(services.state(uid, { partial: true }).user.pity, pity);
});

test('pitié douce : le compteur tient entre les ouvertures ; un booster d’album avec un hit le remet à zéro', () => {
  const uid = bot();
  db.prepare('UPDATE users SET pity = 9 WHERE id = ?').run(uid);
  db.prepare('UPDATE users SET bonus_packs = 1 WHERE id = ?').run(uid);
  const res = services.openPacks(uid, 1);
  assert.ok(res.cards.some((c) => isHit(c.rarity)), 'le 10e booster contient un hit');
  assert.equal(res.pity, 0);
  // Booster d'album avec un hit : la pitié repart de zéro.
  db.prepare('UPDATE users SET pity = 7, royalties = 100000 WHERE id = ?').run(uid);
  let reset = false;
  for (let i = 0; i < 20 && !reset; i++) {
    const r = services.openAlbumPack(uid, 'thriller'); // trois légendaires sur neuf cartes
    if (r.cards.some((c) => isHit(c.rarity))) {
      assert.equal(r.pity, 0);
      reset = true;
    } else assert.equal(r.pity, 7, 'un booster d’album sans hit ne compte pas');
  }
  assert.ok(reset);
});

test('pulled_rarity : la rareté au moment du tirage reste, même si le catalogue change', () => {
  const uid = bot({ packs: 1 });
  const res = services.openPacks(uid, 1);
  const first = res.cards[0];
  const row = db.prepare('SELECT pulled_rarity FROM cards WHERE user_id = ? AND track_id = ?').get(uid, first.trackId);
  assert.equal(row.pulled_rarity, first.rarity);
  const other = first.rarity === 'common' ? 'rare' : 'common';
  db.prepare('UPDATE cat_tracks SET rarity = ? WHERE id = ?').run(other, first.trackId);
  try {
    assert.equal(db.prepare('SELECT pulled_rarity FROM cards WHERE user_id = ? AND track_id = ?').get(uid, first.trackId).pulled_rarity, first.rarity);
  } finally {
    db.prepare('UPDATE cat_tracks SET rarity = ? WHERE id = ?').run(first.rarity, first.trackId);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND pulled_rarity IS NULL').get(uid).n, 0);
});

// ---------- paliers de niveau ----------

test('paliers : +1 booster par niveau gagné (toute source d’XP), booster spécial tous les 10 niveaux, événement level.up', async () => {
  const uid = bot();
  const events = [];
  const off = deps.bus.on('level.up', (e) => events.push(e));
  try {
    const before = services.getUser(uid).bonus_packs;
    const up = deps.collection.addXp(uid, xpForLevel(11), 'quest');
    assert.deepEqual({ from: up.from, to: up.to, boosters: up.boosters, themed: up.themed }, { from: 1, to: 11, boosters: 10, themed: 1 });
    assert.ok(up.cosmetics.includes('frame:ivoire') && up.cosmetics.includes('vinyl:prune') && up.cosmetics.includes('theme:turquoise'));
    assert.equal(up.wishlist, 4);
    assert.equal(up.showcase, 1);
    assert.equal(services.getUser(uid).bonus_packs, before + 10);
    assert.deepEqual(events, [{ userId: uid, from: 1, to: 11, source: 'quest' }]);
    const special = deps.collection.listBoosters(uid).items;
    assert.equal(special.length, 1);
    assert.deepEqual({ kind: special[0].kind, theme: special[0].theme, source: special[0].source }, { kind: 'theme', theme: 'taste', source: 'level:10' });
    // Sans niveau gagné : null, rien de plus.
    assert.equal(deps.collection.addXp(uid, 1, 'quest'), null);
    assert.equal(deps.collection.addXp(uid, 0, 'quest'), null);
    assert.equal(deps.collection.addXp(uid, -50, 'quest'), null);
  } finally {
    off?.();
  }
  // Par un booster : la réponse porte levelUp et l'état partiel les boosters gagnés.
  const erin = await signupVerified(app, { username: 'level_erin' });
  let gained = null;
  for (let i = 0; i < 5 && !gained; i++) {
    const r = await api(app.base, erin.cookie, 'POST', '/packs/open', {});
    assert.equal(r.status, 200);
    if (r.body.levelUp) gained = r.body;
  }
  assert.ok(gained, 'un niveau gagné avec les boosters de bienvenue');
  assert.equal(gained.levelUp.from + gained.levelUp.boosters, gained.levelUp.to);
  assert.equal(gained.state.user.level.level, gained.levelUp.to);
});

// ---------- boosters spéciaux ----------

test('boosters spéciaux : inventaire, ouverture unique, thème respecté, booster d’album au choix', async () => {
  const fay = await signupVerified(app, { username: 'special_fay' });
  const gus = await signupVerified(app, { username: 'special_gus' });
  const rock = deps.collection.grantBooster(fay.user.id, 'theme', 'genre:rock', 'quest:w');
  const decade = deps.collection.grantBooster(fay.user.id, 'decade:1970', null, 'event');
  const album = deps.collection.grantBooster(fay.user.id, 'album', 'album:discovery', 'onboarding');
  const choice = deps.collection.grantBooster(fay.user.id, 'album', 'album:choice', 'level:20');
  assert.throws(() => deps.collection.grantBooster(fay.user.id, 'theme', 'genre:polka', 'x'), { code: 'invalid_theme' });
  assert.throws(() => deps.collection.grantBooster(fay.user.id, 'theme', 'album:discovery', 'x'), { code: 'invalid_theme' });
  const list = (await api(app.base, fay.cookie, 'GET', '/me/boosters')).body;
  assert.deepEqual(list.items.map((b) => b.id).sort(), [rock, decade, album, choice].sort());
  assert.ok(list.catalog.albums.some((a) => a.id === 'discovery'));

  const opened = await api(app.base, fay.cookie, 'POST', `/me/boosters/${rock}/open`);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.cards.length, 5);
  const rockShare = opened.body.cards.filter((c) => staticCatalog.track(c.trackId).genre === 'rock').length;
  assert.ok(rockShare >= 4, `cartes rock : ${rockShare}`);
  assert.equal(opened.body.state.partial, true);
  assert.equal(typeof opened.body.pity, 'number');
  assert.equal((await api(app.base, fay.cookie, 'POST', `/me/boosters/${rock}/open`)).body.error, 'booster_opened');
  // Le booster d'un autre joueur n'existe pas pour lui.
  assert.equal((await api(app.base, gus.cookie, 'POST', `/me/boosters/${decade}/open`)).status, 404);
  const seventies = (await api(app.base, fay.cookie, 'POST', `/me/boosters/${decade}/open`)).body;
  const in70s = seventies.cards.filter((c) => {
    const y = staticCatalog.track(c.trackId).year;
    return y >= 1970 && y < 1980;
  }).length;
  assert.ok(in70s >= 4, `cartes des années 70 : ${in70s}`);
  const disco = (await api(app.base, fay.cookie, 'POST', `/me/boosters/${album}/open`)).body;
  assert.ok(disco.cards.every((c) => c.trackId.startsWith('discovery:')));
  assert.equal(disco.albumId, 'discovery');
  // Au choix : l'album est demandé, puis fixé avant l'ouverture.
  assert.equal((await api(app.base, fay.cookie, 'POST', `/me/boosters/${choice}/open`)).body.error, 'album_required');
  const chosen = await api(app.base, fay.cookie, 'POST', `/me/boosters/${choice}/choose`, { albumId: 'thriller' });
  assert.equal(chosen.body.booster.theme, 'album:thriller');
  assert.equal((await api(app.base, fay.cookie, 'POST', `/me/boosters/${choice}/choose`, { albumId: 'abbey-road' })).body.error, 'not_choice_booster');
  const thriller = (await api(app.base, fay.cookie, 'POST', `/me/boosters/${choice}/open`)).body;
  assert.ok(thriller.cards.every((c) => c.trackId.startsWith('thriller:')));
  assert.deepEqual((await api(app.base, fay.cookie, 'GET', '/me/boosters')).body.items, []);
  // Deux ouvertures simultanées du même booster : une seule réussit.
  const twice = deps.collection.grantBooster(fay.user.id, 'theme', 'taste', 'level:10');
  const both = await Promise.all([1, 2].map(() => api(app.base, fay.cookie, 'POST', `/me/boosters/${twice}/open`)));
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await api(app.base, fay.cookie, 'POST', '/me/boosters/abc/open')).status, 404);
});

test('chances publiées : booster standard (ciblage, pitié), thématique, d’album ; thème inconnu refusé', async () => {
  const hal = await signupVerified(app, { username: 'odds_hal' });
  const std = (await api(app.base, hal.cookie, 'GET', '/boosters/odds')).body;
  assert.equal(std.kind, 'standard');
  assert.equal(std.slots.length, 5);
  assert.deepEqual(std.focus, { wishlist: 0.25, advanced: 0.1, advancedAlbums: 20, promo: 0.5 });
  assert.equal(std.pity.after, 10);
  assert.ok(std.pity.perBooster.ultra > std.perBooster.ultra);
  const theme = (await api(app.base, hal.cookie, 'GET', '/boosters/odds?theme=genre:rock')).body;
  assert.equal(theme.kind, 'genre');
  assert.equal(theme.focus, undefined, 'pas de ciblage dans un booster thématique');
  const albumOdds = (await api(app.base, hal.cookie, 'GET', '/boosters/odds?theme=album:choice')).body;
  assert.equal(albumOdds.missingFirst, true);
  assert.equal((await api(app.base, hal.cookie, 'GET', '/boosters/odds?theme=genre:polka')).status, 400);
});

// ---------- cosmétiques ----------

test('cosmétiques : débloqués par le niveau, accordés par un badge, sélection vérifiée (409 cosmetic_locked)', async () => {
  const ivy = await signupVerified(app, { username: 'cosmo_ivy' });
  const empty = (await api(app.base, ivy.cookie, 'GET', '/me/cosmetics')).body;
  assert.deepEqual(empty.unlocked, []);
  assert.deepEqual(empty.selected, { frame: null, vinyl: null, theme: null, title: null });
  assert.ok(empty.locked.some((c) => c.id === 'frame:ivoire' && c.level === 3));
  setLevel(ivy.user.id, 5);
  const five = (await api(app.base, ivy.cookie, 'GET', '/me/cosmetics')).body;
  assert.deepEqual(five.unlocked, [{ id: 'frame:ivoire', source: 'level:3' }, { id: 'vinyl:prune', source: 'level:5' }]);
  assert.throws(() => deps.collection.setCosmetics(ivy.user.id, { frame: 'or' }), { code: 'cosmetic_locked' });
  assert.deepEqual(deps.collection.setCosmetics(ivy.user.id, { frame: 'ivoire', vinyl: 'vinyl:prune' }), { frame: 'ivoire', vinyl: 'prune', theme: null, title: null });
  deps.collection.grantCosmetic(ivy.user.id, 'frame:french-touch', 'event:french-touch');
  deps.collection.setCosmetics(ivy.user.id, { frame: 'french-touch' });
  const st = (await api(app.base, ivy.cookie, 'GET', '/state')).body;
  assert.deepEqual(st.user.cosmetics, { frame: 'french-touch', vinyl: 'prune', theme: null, title: null });
  // Le résumé du joueur (UserSummary) porte son cadre ; le profil public, toute la sélection.
  const summary = services.userSummaries([ivy.user.id], null).get(ivy.user.id);
  assert.equal(summary.frame, 'french-touch');
  assert.equal(services.publicProfile(ivy.user.id, 'cosmo_ivy').cosmetics.vinyl, 'prune');
  // L'étagère de vinyles porte la couleur choisie sur chaque disque noir.
  services.adminCompleteCollection(ivy.user.id, 'moon-safari');
  services.forget(ivy.user.id);
  const shelf = services.publicProfile(ivy.user.id, 'cosmo_ivy').vinyls;
  assert.deepEqual(shelf.map((v) => [v.albumId, v.edition, v.color]), [['moon-safari', 'black', 'prune']]);
  // Niveau perdu (collection remise à zéro) : le cosmétique de niveau ne s'affiche plus.
  deps.collection.setCosmetics(ivy.user.id, { frame: 'ivoire' });
  setLevel(ivy.user.id, 1);
  services.forget(ivy.user.id);
  assert.equal(services.userSummaries([ivy.user.id], null).get(ivy.user.id).frame, null);
  assert.equal((await api(app.base, ivy.cookie, 'GET', '/state')).body.user.cosmetics.frame, null);
  assert.throws(() => deps.collection.grantCosmetic(ivy.user.id, 'hat:rouge', 'x'), { code: 'invalid_cosmetic' });
});

// ---------- moment de complétion ----------

test('Pressage n° : rangs distincts sous des complétions simultanées ; complétion vue d’un ami', async () => {
  const players = [];
  for (let i = 0; i < 6; i++) players.push(await signupVerified(app, { username: `press_${i}` }));
  // Les tests précédents (centaines de boosters sur les 20 albums de la graine) ont pu compléter l'album avant eux.
  const before = db.prepare("SELECT COUNT(*) AS n FROM achievements WHERE key = 'album:exodus'").get().n;
  const expected = [1, 2, 3, 4, 5, 6].map((n) => before + n);
  const missing = [];
  for (const p of players) {
    db.prepare('UPDATE users SET royalties = 10000 WHERE id = ?').run(p.user.id);
    missing.push(services.adminAlmostAlbum(p.user.id, 'exodus').missing);
  }
  const results = await Promise.all(players.map((p, i) => api(app.base, p.cookie, 'POST', '/collection/press', { trackId: missing[i] })));
  const ranks = results.map((r) => {
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ach = r.body.achievements.find((a) => a.key === 'album:exodus');
    assert.ok(ach, 'album complété');
    assert.ok(ach.at && ach.firstCardAt, 'date et première carte pour la carte de statistiques');
    return ach.rank;
  });
  assert.deepEqual([...ranks].sort((a, b) => a - b), expected);
  const dbRanks = db.prepare(`SELECT rank FROM achievements WHERE key = 'album:exodus' AND user_id IN (SELECT value FROM json_each(?))
    ORDER BY rank`).all(JSON.stringify(players.map((p) => p.user.id))).map((r) => r.rank);
  assert.deepEqual(dbRanks, expected);

  // Page d'album : « Complété par 6 joueurs · N amis », et le pressage du joueur.
  const viewer = players[0];
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
    .run(viewer.user.id, players[1].user.id, Date.now(), Date.now());
  const done = (await api(app.base, viewer.cookie, 'GET', '/albums/exodus/completion')).body;
  assert.equal(done.completedBy, before + 6);
  assert.deepEqual(done.friends.map((f) => f.username), ['press_1']);
  assert.equal(done.mine.rank, ranks[0]);
  assert.equal(typeof done.mine.days, 'number');
  // Un ami bloqué n'apparaît plus.
  await api(app.base, players[1].cookie, 'PUT', `/blocks/${viewer.user.id}`);
  assert.deepEqual((await api(app.base, viewer.cookie, 'GET', '/albums/exodus/completion')).body.friends, []);
  const stranger = await signupVerified(app, { username: 'press_stranger' });
  const theirs = (await api(app.base, stranger.cookie, 'GET', '/albums/exodus/completion')).body;
  assert.equal(theirs.mine, null);
  assert.equal((await api(app.base, stranger.cookie, 'GET', '/albums/inconnu/completion')).status, 404);
  // Le profil public range chaque vinyle avec son numéro de pressage.
  const profile = services.publicProfile(stranger.user.id, 'press_2');
  assert.equal(profile.vinyls.find((v) => v.albumId === 'exodus').rank, ranks[2]);
});
