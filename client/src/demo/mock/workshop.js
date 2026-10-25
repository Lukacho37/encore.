// Jumeau de démo du module « workshop » (server/workshop.js, P2-D, PLAN.md 4.3, 6.3, 6.10, 6.11) : mêmes routes,
// mêmes formes, mêmes règles (shared/rules.js). Contrat : voir client/src/demo/mock/index.js.
//   Vernir : GET /collection/vernir/:trackId, POST /collection/vernir { trackId, pay } (état complet).
//   Comptoir : GET /collection/comptoir?cursor=&limit=, POST /collection/comptoir { trackId } (état complet).
//   Booster thématique : POST /me/boosters/buy { theme } (180 royalties, état partiel).
//   Édition deluxe : GET /albums/:id/deluxe ; donnée après une note ou un album complété par l'abonné `after` (le bus du
//   vrai serveur), rattrapée sans bruit au premier Studio du joueur ; vinyles du Studio (/users/:u, /users/:u/vinyls)
//   avec leur édition 'deluxe' > 'holo' > 'black' et le drapeau `holo`, comme server/studio.js.
// Données : les succès `deluxe:<albumId>` vivent avec les autres (db.achievements), les cartes dans db.cards. Les
// joueurs fictifs ont chacun une ou deux éditions deluxe (leurs premiers albums complétés, notés en entier).
import {
  COMPTOIR_DUPLICATES, DELUXE_XP, RARITIES, THEMED_BOOSTER_PRICE, buyableTheme, deluxeKey, deluxeProgress, pickDuplicates, vernirCost,
} from '@shared/rules.js';
import { DELUXE_TITLE, DELUXE_TITLE_AT } from '@shared/cosmetics.js';
import { notify } from './notifications.js';

export const name = 'workshop';

const COMPTOIR_PAGE = 6;
const COMPTOIR_MAX = 24;
const MISSING_SHOWN = 60;
const PAY = ['royalties', 'duplicates'];
const idOf = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);
const encodeCursor = (values) => btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Décalage d'un curseur `[offset]` (comme paging.offsetOf) ; 400 invalid_input s'il est illisible. */
function offsetOf(ctx, raw) {
  if (!raw) return 0;
  try {
    const [offset] = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/')));
    if (Number.isInteger(offset) && offset >= 0) return Math.min(offset, COMPTOIR_MAX);
  } catch {
    // curseur illisible : erreur ci-dessous
  }
  return ctx.fail(400, 'invalid_input', { field: 'cursor' });
}

const limitOf = (raw) => Math.min(COMPTOIR_MAX, Math.max(1, Math.floor(Number(raw) || COMPTOIR_PAGE)));

function trackOf(ctx, raw) {
  const track = ctx.TRACK.get(idOf(raw));
  if (!track) ctx.fail(404, 'unknown_track');
  return track;
}

// ----- édition deluxe ------------------------------------------------------------------------------------------

function deluxeProgressOf(ctx, uid, albumId) {
  const trackIds = ctx.staticCatalog.albumTrackIds(albumId);
  const ach = ctx.collection.achOf(uid);
  const mine = ctx.db.ratings.filter((r) => r.userId === uid);
  const rated = new Set(mine.filter((r) => r.type === 'track').map((r) => r.id));
  const at = ach[deluxeKey(albumId)];
  return {
    albumId,
    ...deluxeProgress({
      completed: ach[`album:${albumId}`] !== undefined, albumRated: mine.some((r) => r.type === 'album' && r.id === albumId), trackIds, ratedTrackIds: rated,
    }),
    done: at !== undefined,
    at: at ?? null,
  };
}

/** Donne l'édition deluxe quand ses conditions sont remplies (comme services : +50 XP, titre à la 10e, notification). */
function evaluateDeluxe(ctx, uid, albumId, { silent = false } = {}) {
  if (!ctx.ALBUM.has(albumId)) return false;
  const ach = ctx.collection.achOf(uid);
  const key = deluxeKey(albumId);
  if (ach[key] !== undefined || !deluxeProgressOf(ctx, uid, albumId).ready) return false;
  ach[key] = ctx.now();
  ctx.collection.addXp(uid, DELUXE_XP);
  if (Object.keys(ach).filter((k) => k.startsWith('deluxe:')).length >= DELUXE_TITLE_AT) {
    ctx.collection.grantCosmetic(uid, DELUXE_TITLE, `deluxe:${DELUXE_TITLE_AT}`);
  }
  if (!silent) {
    notify(ctx.db, uid, 'deluxe_earned', { targetType: 'album', targetId: albumId, data: { itemType: 'album', itemId: albumId, xp: DELUXE_XP } });
  }
  return true;
}

/** Rattrapage silencieux, une fois par joueur (drapeau deluxe:v1 du serveur). */
function backfill(ctx, u) {
  if (!u || u.deluxeBackfilled) return 0;
  u.deluxeBackfilled = true;
  let n = 0;
  for (const k of Object.keys(ctx.collection.achOf(u.id))) {
    if (k.startsWith('album:') && evaluateDeluxe(ctx, u.id, k.slice(6), { silent: true })) n += 1;
  }
  return n;
}

function deluxeStatus(ctx, u, rawId) {
  const albumId = idOf(decodeURIComponent(rawId));
  if (!albumId || !ctx.ALBUM.has(albumId)) ctx.fail(404, 'unknown_album');
  evaluateDeluxe(ctx, u.id, albumId);
  const p = deluxeProgressOf(ctx, u.id, albumId);
  const missing = p.missing.slice(0, MISSING_SHOWN);
  const out = { ...p, missing, xp: DELUXE_XP, catalog: ctx.refs({ trackIds: missing, albumIds: [albumId] }) };
  if (p.done) Object.assign(out, { achievements: [{ key: deluxeKey(albumId), rank: null }], state: ctx.partialState() });
  return out;
}

/** Éditions des vinyles d'un joueur : 'deluxe' > 'holo' > 'black' ; la couleur choisie ne teint que les disques noirs. */
function withEditions(ctx, target, list) {
  if (!Array.isArray(list)) return list;
  const ach = ctx.collection.achOf(target.id);
  const color = ctx.collection.cosmeticsOf(target.id)?.vinyl ?? null;
  return list.map((v) => {
    if (!v?.albumId) return v;
    const holo = v.holo ?? v.edition === 'holo';
    const edition = ach[deluxeKey(v.albumId)] !== undefined ? 'deluxe' : holo ? 'holo' : 'black';
    return { ...v, edition, holo, color: edition === 'black' ? v.color ?? color : null };
  });
}

// ----- doublons ----------------------------------------------------------------------------------------------

/** Exemplaires en double d'une rareté : [{ trackId, variant, count }]. */
function spareRows(ctx, uid, rarity) {
  const out = [];
  for (const [k, v] of Object.entries(ctx.collection.cardsOf(uid))) {
    if (!(v.count > 1)) continue;
    const [trackId, variant] = k.split('|');
    if (ctx.TRACK.get(trackId)?.rarity === rarity) out.push({ trackId, variant, count: v.count });
  }
  return out;
}

function sparesByRarity(ctx, uid) {
  const out = Object.fromEntries(RARITIES.map((r) => [r, 0]));
  for (const [k, v] of Object.entries(ctx.collection.cardsOf(uid))) {
    const rarity = ctx.TRACK.get(k.split('|')[0])?.rarity;
    if (v.count > 1 && out[rarity] !== undefined) out[rarity] += v.count - 1;
  }
  return out;
}

function spareCount(rows, reserve = null) {
  let n = 0;
  for (const r of rows) n += Math.max(0, r.count - (reserve && r.trackId === reserve.trackId && r.variant === reserve.variant ? 2 : 1));
  return n;
}

function spend(ctx, uid, picks) {
  const cards = ctx.collection.cardsOf(uid);
  for (const p of picks) {
    const row = cards[`${p.trackId}|${p.variant}`];
    if (!row || row.count <= p.n) ctx.fail(409, 'not_enough_duplicates');
    row.count -= p.n;
  }
}

// ----- Vernir --------------------------------------------------------------------------------------------------

function vernirInfo(ctx, u, rawId) {
  const track = trackOf(ctx, decodeURIComponent(rawId));
  const cards = ctx.collection.cardsOf(u.id);
  const std = cards[`${track.id}|std`];
  const holo = cards[`${track.id}|holo`];
  const cost = vernirCost(track.rarity);
  const spares = std ? spareCount(spareRows(ctx, u.id, track.rarity), { trackId: track.id, variant: 'std' }) : 0;
  const reason = holo ? 'already_holo' : !std ? 'not_owned' : null;
  return {
    trackId: track.id, rarity: track.rarity, std: std?.count ?? 0, holo: holo?.count ?? 0, cost, royalties: u.royalties, duplicates: spares,
    can: { royalties: !reason && u.royalties >= cost.royalties, duplicates: !reason && spares >= cost.duplicates }, reason,
  };
}

function vernir(ctx, u, body) {
  const track = trackOf(ctx, body.trackId);
  if (!PAY.includes(body.pay)) ctx.fail(400, 'invalid_input', { field: 'pay' });
  const cost = vernirCost(track.rarity);
  const cards = ctx.collection.cardsOf(u.id);
  if (cards[`${track.id}|holo`]) ctx.fail(409, 'already_holo');
  const std = cards[`${track.id}|std`];
  if (!std) ctx.fail(409, 'not_owned');
  let spent;
  if (body.pay === 'royalties') {
    if (u.royalties < cost.royalties) ctx.fail(409, 'not_enough_royalties', { cost: cost.royalties });
    u.royalties -= cost.royalties;
    spent = { royalties: cost.royalties };
  } else {
    const rows = spareRows(ctx, u.id, track.rarity);
    const reserve = { trackId: track.id, variant: 'std' };
    const picks = pickDuplicates(rows, cost.duplicates, { reserve });
    if (!picks) ctx.fail(409, 'not_enough_duplicates', { needed: cost.duplicates, have: spareCount(rows, reserve) });
    spend(ctx, u.id, picks);
    spent = { duplicates: picks };
  }
  const now = ctx.now();
  if (std.count > 1) std.count -= 1;
  else delete cards[`${track.id}|std`];
  cards[`${track.id}|holo`] = { count: 1, at: now, r: std.r || track.rarity };
  const holoEdition = !!track.albumId && ctx.staticCatalog.albumTrackIds(track.albumId).every((id) => cards[`${id}|holo`]);
  return {
    trackId: track.id, rarity: track.rarity, albumId: track.albumId || null, pay: body.pay, spent, holoEdition, at: now,
    catalog: ctx.refs({ trackIds: [track.id, ...(spent.duplicates || []).map((p) => p.trackId)] }),
    // Le nombre d'exemplaires de plusieurs cartes change : état complet, comme le serveur.
    state: ctx.state(),
  };
}

// ----- Comptoir ------------------------------------------------------------------------------------------------

function comptoirPage(ctx, u, query) {
  const limit = limitOf(query.get('limit'));
  const offset = offsetOf(ctx, query.get('cursor'));
  const owned = ctx.collection.ownedSet(u.id);
  const wishlist = ctx.collection.wishlist(u.id).filter((id) => ctx.ALBUM.has(id)).slice(0, COMPTOIR_MAX);
  const albums = [];
  for (const albumId of wishlist) {
    const ids = ctx.staticCatalog.albumTrackIds(albumId);
    const missing = ids.filter((id) => !owned.has(id));
    if (missing.length) albums.push({ albumId, owned: ids.length - missing.length, total: ids.length, missing });
  }
  const rows = albums.slice(offset, offset + limit + 1);
  const page = rows.slice(0, limit);
  const next = offset + page.length;
  const items = page.map((a) => ({ ...a, missing: a.missing.map((id) => ({ trackId: id, rarity: ctx.TRACK.get(id).rarity })) }));
  return {
    needed: COMPTOIR_DUPLICATES,
    duplicates: sparesByRarity(ctx, u.id),
    items,
    nextCursor: rows.length > limit && next < COMPTOIR_MAX ? encodeCursor([next]) : null,
    wishlist: wishlist.length,
    incomplete: albums.length,
    catalog: ctx.refs({ trackIds: items.flatMap((a) => a.missing.map((m) => m.trackId)), albumIds: items.map((a) => a.albumId) }),
  };
}

function comptoir(ctx, u, body) {
  const track = trackOf(ctx, body.trackId);
  if (!track.albumId || track.rarity === 'promo') ctx.fail(409, 'not_exchangeable');
  if (!ctx.collection.wishlist(u.id).includes(track.albumId)) ctx.fail(409, 'not_wishlisted', { albumId: track.albumId });
  if (ctx.collection.ownedSet(u.id).has(track.id)) ctx.fail(409, 'already_owned');
  const rows = spareRows(ctx, u.id, track.rarity);
  const picks = pickDuplicates(rows, COMPTOIR_DUPLICATES);
  if (!picks) ctx.fail(409, 'not_enough_duplicates', { needed: COMPTOIR_DUPLICATES, have: spareCount(rows) });
  spend(ctx, u.id, picks);
  const added = ctx.collection.addCards(u.id, [{ trackId: track.id, variant: 'std' }], 'comptoir');
  return { trackId: track.id, rarity: track.rarity, albumId: track.albumId, spent: { duplicates: picks }, ...added, state: ctx.state() };
}

// ----- booster thématique --------------------------------------------------------------------------------------

function buyThemed(ctx, u, theme) {
  if (typeof theme !== 'string' || !buyableTheme(theme)) ctx.fail(400, 'invalid_theme');
  if (u.royalties < THEMED_BOOSTER_PRICE) ctx.fail(409, 'not_enough_royalties', { cost: THEMED_BOOSTER_PRICE });
  u.royalties -= THEMED_BOOSTER_PRICE;
  const id = ctx.collection.insertBooster(u.id, 'theme', theme, 'shop');
  const row = ctx.db.boosters.find((b) => b.id === id);
  return { booster: { id, kind: 'theme', theme, source: 'shop', createdAt: row?.createdAt ?? ctx.now() }, spent: THEMED_BOOSTER_PRICE, state: ctx.partialState() };
}

export const routes = [
  ['GET', /^\/collection\/vernir\/([^/]+)$/, ({ params, ctx }) => vernirInfo(ctx, ctx.me(), params[0])],
  ['POST', /^\/collection\/vernir$/, ({ body, ctx }) => vernir(ctx, ctx.me(), body)],
  ['GET', /^\/collection\/comptoir$/, ({ query, ctx }) => comptoirPage(ctx, ctx.me(), query)],
  ['POST', /^\/collection\/comptoir$/, ({ body, ctx }) => comptoir(ctx, ctx.me(), body)],
  ['POST', /^\/me\/boosters\/buy$/, ({ body, ctx }) => buyThemed(ctx, ctx.me(), body.theme)],
  ['GET', /^\/albums\/([^/]+)\/deluxe$/, ({ params, ctx }) => deluxeStatus(ctx, ctx.me(), params[0])],
];

const RATING_PATH = /^\/ratings\/(album|track)\/([^/]+)$/;
const STUDIO_PATH = /^\/users\/([^/]+)(\/vinyls)?$/;

/**
 * Abonné des autres routes (le bus du vrai serveur) : une note sur un album complété ou un album complété donne
 * l'édition deluxe (l'état partiel de la réponse est recalculé, comme celui du serveur qui la donne avant de
 * répondre) ; les vinyles du Studio reçoivent leur édition.
 */
export function after({ method, path, result, ctx }) {
  if (!result || typeof result !== 'object') return result;
  const u = ctx.db?.session ? ctx.userById(ctx.db.session) : null;
  if (!u) return result;
  let granted = false;
  const rating = method === 'PUT' && RATING_PATH.exec(path);
  if (rating) {
    const id = decodeURIComponent(rating[2]);
    const albumId = rating[1] === 'album' ? id : ctx.TRACK.get(id)?.albumId;
    if (albumId) granted = evaluateDeluxe(ctx, u.id, albumId) || granted;
  }
  for (const a of Array.isArray(result.achievements) ? result.achievements : []) {
    if (typeof a?.key === 'string' && a.key.startsWith('album:')) granted = evaluateDeluxe(ctx, u.id, a.key.slice(6)) || granted;
  }
  if (granted && result.state) result.state = result.state.partial ? ctx.partialState() : ctx.state();
  const studio = method === 'GET' && STUDIO_PATH.exec(path);
  if (studio) {
    const target = ctx.userByName(decodeURIComponent(studio[1]));
    if (target) {
      if (target.id === u.id) backfill(ctx, u);
      if (studio[2]) result.items = withEditions(ctx, target, result.items);
      else {
        result.vinyls = withEditions(ctx, target, result.vinyls);
        if (result.featuredVinyl) [result.featuredVinyl] = withEditions(ctx, target, [result.featuredVinyl]);
      }
    }
  }
  return result;
}

/**
 * Joueurs fictifs : leurs deux premiers albums complétés notés en entier (album et morceaux, notes d'après la
 * popularité), puis l'édition deluxe donnée sans bruit. Idempotent (drapeau u.deluxeSeeded).
 */
function seedBots(db, ctx) {
  for (const u of db.users.filter((x) => x.bot && !x.deluxeSeeded)) {
    u.deluxeSeeded = true;
    const done = Object.entries(ctx.collection.achOf(u.id)).filter(([k]) => k.startsWith('album:') && ctx.ALBUM.has(k.slice(6)))
      .sort((a, b) => a[1] - b[1]).slice(0, 2).map(([k, at]) => [k.slice(6), at]);
    for (const [albumId, at] of done) {
      const rated = new Set(db.ratings.filter((r) => r.userId === u.id).map((r) => `${r.type}:${r.id}`));
      const add = (type, id, score) => {
        if (rated.has(`${type}:${id}`)) return;
        db.ratings.push({ userId: u.id, type, id, score, review: null, reviewAt: null, createdAt: at, updatedAt: at });
      };
      add('album', albumId, 8 + (u.id % 3));
      for (const t of ctx.staticCatalog.albumTracks(albumId)) add('track', t.id, Math.max(4, Math.min(10, Math.round((t.pop ?? 60) / 10))));
      evaluateDeluxe(ctx, u.id, albumId, { silent: true });
    }
    u.deluxeBackfilled = true;
  }
}

export function seed(db, ctx) {
  seedBots(db, ctx);
}

export function migrate(db, ctx) {
  seedBots(db, ctx);
}
