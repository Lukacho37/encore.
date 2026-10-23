// Jumeau de démo du module « collection » (server/collection.js, P1-D, PLAN.md 4.2.5, 6) : mêmes routes, mêmes formes.
// Le calcul du jeu (ciblage, pitié, paliers, ouverture d'un booster spécial) vit dans le cœur de la démo, comme dans
// server/services.js : ce fichier n'en garde que les routes, via ctx.collection (voir mockServer.js).
//   Albums recherchés : db.wishlists[userId] = [albumId…] (12 places, +4 aux niveaux 10, 25 et 50).
//   Boosters spéciaux : db.boosters = [{ id, userId, kind, theme, source, createdAt, openedAt }].
//   Cosmétiques : ceux du niveau (shared/cosmetics.js), ceux de db.cosmeticGrants ; la sélection est u.cosmetics.
// Les joueurs fictifs ont leurs albums recherchés et leurs cosmétiques, pour que les Studios et les pages ne soient
// pas vides. Contrat : voir client/src/demo/mock/index.js.
import { boosterOdds, parseBoosterTheme, wishlistMax } from '@shared/rules.js';
import { COSMETIC_KINDS, LEVEL_COSMETICS } from '@shared/cosmetics.js';

export const name = 'collection';

const DAY = 86_400_000;
const BOOSTERS_MAX = 100;
const idOf = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);

/** Joueurs bloqués dans un sens ou dans l'autre (db.blocks, jumeau de la modération). */
function hiddenIds(db, uid) {
  const out = new Set();
  for (const b of db.blocks || []) {
    if (b.blocker === uid) out.add(b.blocked);
    if (b.blocked === uid) out.add(b.blocker);
  }
  return out;
}

const friendIds = (db, uid) => new Set(db.friendships.filter((f) => f.status === 'accepted' && (f.requester === uid || f.addressee === uid))
  .map((f) => (f.requester === uid ? f.addressee : f.requester)));

/** Progression d'un joueur sur ces albums : { albumId: { owned, total } } (albums commencés seulement). */
function progressOf(ctx, uid, albumIds) {
  const owned = ctx.collection.ownedSet(uid);
  const out = {};
  for (const id of albumIds) {
    const ids = ctx.staticCatalog.albumTrackIds(id);
    const n = ids.filter((t) => owned.has(t)).length;
    if (n) out[id] = { owned: n, total: ids.length };
  }
  return out;
}

function wishlistState(ctx, u, wanted) {
  const list = ctx.collection.wishlist(u.id);
  return { ...(wanted === undefined ? {} : { wanted }), count: list.length, max: wishlistMax(ctx.collection.levelOf(u)) };
}

/** Ajoute un album (idempotent) ; 409 wishlist_full au-delà des places du niveau. */
function addWishlist(ctx, u, albumId) {
  const id = idOf(albumId);
  if (!id || !ctx.ALBUM.has(id)) ctx.fail(404, 'unknown_album');
  const list = (ctx.db.wishlists[u.id] ||= []);
  if (list.includes(id)) return;
  const max = wishlistMax(ctx.collection.levelOf(u));
  if (list.length >= max) ctx.fail(409, 'wishlist_full', { max });
  list.push(id);
}

/** Liste d'envies d'un joueur vue par le joueur connecté : blocages et visibilité du Studio respectés. */
function userWishlist(ctx, viewer, username) {
  const target = ctx.userByName(decodeURIComponent(username));
  if (!target || !target.verified || (target.id !== viewer.id && hiddenIds(ctx.db, viewer.id).has(target.id))) ctx.fail(404, 'user_not_found');
  const visibility = target.visibility || target.profileVisibility || 'public';
  if (target.id !== viewer.id && (visibility === 'private' || (visibility === 'friends' && !friendIds(ctx.db, viewer.id).has(target.id)))) {
    ctx.fail(403, 'profile_private');
  }
  const items = ctx.collection.wishlist(target.id);
  return { items, progress: progressOf(ctx, target.id, items), max: wishlistMax(ctx.collection.levelOf(target)), catalog: ctx.refs({ albumIds: items }) };
}

const boosterView = (b) => ({ id: b.id, kind: b.kind, theme: b.theme, source: b.source, createdAt: b.createdAt });

function listBoosters(ctx, u) {
  const rows = ctx.db.boosters.filter((b) => b.userId === u.id && !b.openedAt).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  const items = rows.slice(0, BOOSTERS_MAX).map(boosterView);
  const albumIds = items.map((b) => parseBoosterTheme(b.theme)).filter((p) => p?.kind === 'album').map((p) => p.value);
  return { items, more: rows.length > BOOSTERS_MAX, catalog: ctx.refs({ albumIds }) };
}

/** Booster d'album au choix : l'album est fixé avant l'ouverture (« album:choice » → « album:<id> »). */
function chooseAlbum(ctx, u, boosterId, albumId) {
  const album = idOf(albumId);
  if (!album || !ctx.ALBUM.has(album)) ctx.fail(404, 'unknown_album');
  const row = ctx.db.boosters.find((b) => b.id === Number(boosterId) && b.userId === u.id);
  if (!row) ctx.fail(404, 'booster_not_found');
  if (row.openedAt) ctx.fail(409, 'booster_opened');
  if (row.theme !== 'album:choice') ctx.fail(409, 'not_choice_booster');
  row.theme = `album:${album}`;
  return { booster: boosterView(row), catalog: ctx.refs({ albumIds: [album] }) };
}

function cosmeticsPayload(ctx, u) {
  const level = ctx.collection.levelOf(u);
  return {
    unlocked: ctx.collection.unlockedCosmetics(u.id),
    selected: ctx.collection.cosmeticsOf(u.id),
    level,
    locked: LEVEL_COSMETICS.filter((c) => c.level > level).map((c) => ({ id: c.id, level: c.level })),
  };
}

/** « Complété par 214 joueurs · 3 amis » et le Pressage n° du joueur (comme server/collection.js). */
function completion(ctx, u, albumId) {
  const id = idOf(albumId);
  if (!id || !ctx.ALBUM.has(id)) ctx.fail(404, 'unknown_album');
  const key = `album:${id}`;
  const done = Object.entries(ctx.db.achievements).filter(([, list]) => list?.[key] !== undefined)
    .map(([uid, list]) => ({ uid: Number(uid), at: list[key] })).sort((a, b) => a.at - b.at || a.uid - b.uid);
  const hidden = hiddenIds(ctx.db, u.id);
  const friends = friendIds(ctx.db, u.id);
  // Un ami au Studio privé garde ses albums complétés pour lui (comme le serveur).
  const friendRows = done.filter((r) => friends.has(r.uid) && !hidden.has(r.uid) && ctx.userById(r.uid)?.profileVisibility !== 'private');
  const summaries = ctx.summaries(friendRows.slice(0, 8).map((r) => r.uid));
  const friendList = friendRows.slice(0, 8).map((r) => summaries.get(r.uid)).filter(Boolean);
  const at = ctx.collection.achOf(u.id)[key];
  let mine = null;
  if (at !== undefined) {
    const cards = ctx.db.cards[u.id] || {};
    const firsts = ctx.staticCatalog.albumTrackIds(id).flatMap((t) => [cards[`${t}|std`]?.at, cards[`${t}|holo`]?.at]).filter(Number.isFinite);
    const first = Math.min(at, ...firsts);
    mine = { at, rank: ctx.collection.rankOf(u.id, key), firstCardAt: first, days: Math.max(0, Math.floor((at - first) / DAY)) };
  }
  const avatarAlbums = friendList.map((f) => (typeof f.avatar === 'string' && f.avatar.startsWith('album:') ? f.avatar.slice(6) : null)).filter(Boolean);
  return { albumId: id, completedBy: done.length, friendsCount: friendRows.length, friends: friendList, mine, catalog: ctx.refs({ albumIds: [id, ...avatarAlbums] }) };
}

export const routes = [
  // Albums recherchés.
  ['GET', /^\/me\/wishlist$/, ({ ctx }) => {
    const u = ctx.me();
    const items = ctx.collection.wishlist(u.id);
    return { items, ...wishlistState(ctx, u), progress: progressOf(ctx, u.id, items), catalog: ctx.refs({ albumIds: items }) };
  }],
  ['PUT', /^\/me\/wishlist\/([^/]+)$/, ({ params, ctx }) => {
    const u = ctx.me();
    addWishlist(ctx, u, decodeURIComponent(params[0]));
    return wishlistState(ctx, u, true);
  }],
  ['DELETE', /^\/me\/wishlist\/([^/]+)$/, ({ params, ctx }) => {
    const u = ctx.me();
    const id = idOf(decodeURIComponent(params[0]));
    if (!id) ctx.fail(404, 'unknown_album');
    ctx.db.wishlists[u.id] = ctx.collection.wishlist(u.id).filter((x) => x !== id);
    return wishlistState(ctx, u, false);
  }],
  ['GET', /^\/users\/([^/]+)\/wishlist$/, ({ params, ctx }) => userWishlist(ctx, ctx.me(), params[0])],

  // Boosters spéciaux : inventaire, choix de l'album, ouverture (avec l'état partiel), chances publiées.
  ['GET', /^\/me\/boosters$/, ({ ctx }) => listBoosters(ctx, ctx.me())],
  ['POST', /^\/me\/boosters\/(\d+)\/choose$/, ({ params, body, ctx }) => chooseAlbum(ctx, ctx.me(), params[0], body.albumId)],
  ['POST', /^\/me\/boosters\/(\d+)\/open$/, ({ params, body, ctx }) => {
    const result = ctx.collection.openSpecialPack(ctx.me(), params[0], { albumId: body.albumId });
    return { ...result, state: ctx.partialState() };
  }],
  ['GET', /^\/boosters\/odds$/, ({ query, ctx }) => {
    const theme = query.get('theme') || null;
    if (theme && !parseBoosterTheme(theme)) ctx.fail(400, 'invalid_theme');
    return boosterOdds(theme);
  }],

  // Cosmétiques, moment de complétion, pressage d'une carte (promos : un album de l'artiste complété).
  ['GET', /^\/me\/cosmetics$/, ({ ctx }) => cosmeticsPayload(ctx, ctx.me())],
  ['GET', /^\/albums\/([^/]+)\/completion$/, ({ params, ctx }) => completion(ctx, ctx.me(), decodeURIComponent(params[0]))],
  ['GET', /^\/me\/press\/([^/]+)$/, ({ params, ctx }) => ctx.collection.pressInfo(ctx.me(), decodeURIComponent(params[0]))],
];

/**
 * Joueurs fictifs : 3 albums recherchés (leurs 2 albums commencés les plus avancés, puis un album pas commencé), le
 * plus beau cadre et la plus belle couleur de vinyle de leur niveau. Idempotent : un choix déjà fait reste.
 */
function seedBots(db, ctx) {
  const albums = [...ctx.ALBUM.keys()];
  for (const u of db.users.filter((x) => x.bot)) {
    if (!db.wishlists[u.id]?.length) {
      const owned = ctx.collection.ownedSet(u.id);
      const progress = albums.map((id) => {
        const ids = ctx.staticCatalog.albumTrackIds(id);
        return { id, pct: ids.filter((t) => owned.has(t)).length / ids.length };
      });
      const started = progress.filter((p) => p.pct > 0 && p.pct < 1).sort((a, b) => b.pct - a.pct);
      const notStarted = progress.filter((p) => p.pct === 0);
      db.wishlists[u.id] = [...started.slice(0, 2), notStarted[u.id % Math.max(1, notStarted.length)]].filter(Boolean).map((p) => p.id);
    }
    if (!u.cosmetics || !Object.values(u.cosmetics).some(Boolean)) {
      const unlocked = new Set(ctx.collection.unlockedCosmetics(u.id).map((c) => c.id));
      const best = (kind) => [...LEVEL_COSMETICS].reverse().find((c) => c.kind === kind && unlocked.has(c.id))?.key ?? null;
      u.cosmetics = Object.fromEntries(COSMETIC_KINDS.map((kind) => [kind, kind === 'frame' || kind === 'vinyl' || kind === 'title' ? best(kind) : null]));
    }
    u.pity ??= 0;
  }
}

export function seed(db, ctx) {
  seedBots(db, ctx);
}

export function migrate(db, ctx) {
  db.boosters ||= [];
  db.wishlists ||= {};
  db.cosmeticGrants ||= {};
  seedBots(db, ctx);
  // Comptes activés avant cette version de la démo : les boosters spéciaux offerts, une fois.
  for (const u of db.users) if (!u.bot && u.verified) ctx.collection.demoGift(u);
}
