// Jumeau de démo du module « lists » (server/lists.js, P1-C, PLAN.md 4.2.4) : mêmes routes, mêmes formes.
//   GET|POST /lists · GET|PATCH|DELETE /lists/:id · PUT|POST /lists/:id/items · DELETE /lists/:id/items/:type/:itemId
//   GET /items/album/:id/lists · GET|PUT /me/grid9 · GET /users/:username/grid9
// Données : db.lists [{ id, userId, kind: 'list' | 'grid9', title, description, ranked, itemType, visibility,
// items: [{ type, id, note, position, addedAt }], itemCount, likeCount, commentCount, createdAt, updatedAt, hiddenAt }]
// (la forme que lisent déjà les jumeaux de la recherche, du fil, du social et de la modération). La liste d'envies
// vit ailleurs (db.wishlists, jumeau de collection.js). Commentaires et « J'aime » des listes : jumeau du social
// (db.comments, db.likes), dont la route GET /comments donne aussi les commentaires de la page d'une liste.
// Les joueurs fictifs ont leurs listes (classées ou non, avec des notes), leurs grilles « Mes 9 albums », des
// « J'aime » et des commentaires (seed) ; quand le joueur publie une liste publique d'au moins 3 éléments, l'un d'eux
// l'aime puis un autre la commente quelques secondes plus tard (file db.botQueue du jumeau du social).
import { routes as socialRoutes } from './social.js';
import { viewerOf } from './ratings.js';

export const name = 'lists';

const LIST_MAX_ITEMS = 250;
const LISTS_PER_USER = 200;
const LISTS_PER_DAY = 20;
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 1000;
const NOTE_MAX = 280;
const GRID_SLOTS = 9;
const PAGE = 20;
const ALBUM_FRIENDS = 5;
const VISIBILITIES = ['public', 'friends', 'private'];
const ITEM_TYPES = ['album', 'track', 'mixed'];
const GRID_TITLES = { fr: 'Mes 9 albums', en: 'My 9 albums' };
const HOUR = 3_600_000;
const DAY = 86_400_000;
// Réaction des joueurs fictifs à une liste publique du joueur (ms) : « J'aime », puis commentaire.
const BOT_DELAY = [2500, 4500];
const BOT_COMMENTS = ['Belle sélection, je note les deux derniers !', 'Très bonne liste, il ne manque rien.', 'Je l’écoute dans l’ordre ce soir.'];

// ----- outils ------------------------------------------------------------------------------------

// Curseurs opaques, comme server/paging.js : JSON en base64url.
const encodeCursor = (values) => btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decodeCursor(raw, ctx, length) {
  if (!raw) return null;
  try {
    const values = JSON.parse(atob(String(raw).replace(/-/g, '+').replace(/_/g, '/')));
    if (Array.isArray(values) && values.length === length && values.every((v) => Number.isFinite(v))) return values;
  } catch {
    // curseur illisible
  }
  return ctx.fail(400, 'invalid_input', { field: 'cursor' });
}
const limitOf = (query, def = PAGE) => Math.min(50, Math.max(1, Math.floor(Number(query.get('limit')) || def)));
const toId = (raw) => (/^\d{1,15}$/.test(String(raw ?? '')) ? Number(raw) : null);
const avatarAlbum = (avatar) => (typeof avatar === 'string' && avatar.startsWith('album:') ? avatar.slice(6) : null);
const privacyOf = (u) => u?.profileVisibility || u?.privacy || 'public';

export function ensure(db) {
  if (!Array.isArray(db.lists)) db.lists = [];
  if (!Number.isInteger(db.nextListId)) db.nextListId = 1 + Math.max(0, ...db.lists.map((l) => l.id || 0));
  for (const l of db.lists) {
    if (!Array.isArray(l.items)) l.items = [];
    l.itemCount = l.items.length;
    l.likeCount ||= 0;
    l.commentCount ||= 0;
    l.kind ||= 'list';
    l.itemType ||= 'album';
    l.visibility ||= 'public';
  }
}

/** Contenu de `ownerId` à la visibilité `visibility` lisible par `viewer` (blocages compris). */
function canRead(viewer, ownerId, visibility) {
  if (ownerId === viewer.id) return true;
  if (viewer.hidden.has(ownerId)) return false;
  if (visibility === 'public') return true;
  if (visibility === 'friends') return viewer.friends.has(ownerId);
  return false;
}

/** Studio d'un joueur ouvert à `viewer` (confidentialité du Studio : même champ que les autres jumeaux). */
function studioOpen(viewer, target) {
  if (target.id === viewer.id) return true;
  const privacy = privacyOf(target);
  if (privacy === 'public') return true;
  return privacy === 'friends' && viewer.friends.has(target.id);
}

/** Liste lisible par `viewer` : visibilité, blocages, masquée par la modération (lue par son auteur seulement). */
const readable = (viewer) => (l) => l.kind !== 'wishlist' && canRead(viewer, l.userId, l.visibility) && (!l.hiddenAt || l.userId === viewer.id);

/** Collecteur des éléments cités (champ `catalog`). */
function collector(ctx) {
  const albumIds = [];
  const trackIds = [];
  return {
    item(type, id) {
      if (type === 'album') albumIds.push(id);
      else if (type === 'track') trackIds.push(id);
    },
    albums(ids) {
      albumIds.push(...ids);
    },
    users(users) {
      for (const u of users) if (avatarAlbum(u?.avatar)) albumIds.push(avatarAlbum(u.avatar));
    },
    build: () => ctx.refs({ albumIds: albumIds.filter((id) => ctx.ALBUM.has(id)), trackIds: trackIds.filter((id) => ctx.TRACK.has(id)) }),
  };
}

/** Pochettes d'une liste : les 4 premiers albums distincts (album d'un morceau compris). */
function coversOf(ctx, l) {
  const out = [];
  for (const it of l.items.slice(0, 8)) {
    const album = it.type === 'album' ? it.id : ctx.TRACK.get(it.id)?.albumId;
    if (album && !out.includes(album)) out.push(album);
    if (out.length === 4) break;
  }
  return out;
}

/** Lignes → ListSummary lisibles par `viewer` (auteurs en un appel, « J'aime » du joueur). */
function summarize(ctx, viewer, rows, refs = null) {
  const kept = rows.filter((l) => l && readable(viewer)(l));
  const users = ctx.summaries(kept.map((l) => l.userId));
  refs?.users(users.values());
  const liked = new Set((ctx.db.likes || []).filter((x) => x.userId === viewer.id && x.targetType === 'list').map((x) => x.targetId));
  const out = [];
  for (const l of kept) {
    const user = users.get(l.userId);
    if (!user) continue;
    const coverAlbumIds = coversOf(ctx, l);
    refs?.albums(coverAlbumIds);
    out.push({
      id: l.id, kind: l.kind, title: l.title, user, itemCount: l.items.length, likeCount: l.likeCount || 0, commentCount: l.commentCount || 0,
      liked: liked.has(l.id), visibility: l.visibility, ranked: !!l.ranked, itemType: l.itemType, coverAlbumIds, updatedAt: l.updatedAt,
      ...(l.hiddenAt ? { moderated: true } : {}),
    });
  }
  return out;
}

/** Liste lisible par `viewer`, sinon 404 (jamais 403 : rien ne fuit). */
function readList(ctx, viewer, rawId) {
  const l = ctx.db.lists.find((x) => x.id === toId(rawId));
  if (!l || !readable(viewer)(l)) ctx.fail(404, 'not_found');
  return l;
}

/** Liste du joueur (404 sinon) ; la grille « Mes 9 albums » seulement si `grid`. */
function ownList(ctx, u, rawId, { grid = false } = {}) {
  const l = ctx.db.lists.find((x) => x.id === toId(rawId));
  if (!l || l.userId !== u.id) ctx.fail(404, 'not_found');
  if (l.kind === 'grid9' && !grid) ctx.fail(403, 'use_grid9_route');
  return l;
}

/** Texte reçu, espaces normalisés, au plus `max` caractères ('' si absent). */
function cleanText(ctx, raw, { max, field, multiline = false }) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') ctx.fail(400, 'invalid_input', { field });
  let text = raw.replace(/\r\n?/g, '\n').normalize('NFC');
  text = multiline ? text.trim().replace(/\n{3,}/g, '\n\n') : text.replace(/\s+/g, ' ').trim();
  if ([...text].length > max) ctx.fail(400, 'invalid_input', { field, max });
  return text;
}

function titleOf(ctx, raw) {
  const title = cleanText(ctx, raw, { max: TITLE_MAX, field: 'title' });
  if (!title) ctx.fail(400, 'title_required');
  return title;
}

/** Valeur parmi `values` ; absente : `fallback` s'il est donné, sinon 400. */
function oneOf(ctx, raw, values, field, fallback) {
  if (raw === undefined || raw === null || raw === '') {
    if (fallback !== undefined) return fallback;
    return ctx.fail(400, 'invalid_input', { field });
  }
  if (!values.includes(raw)) ctx.fail(400, 'invalid_input', { field });
  return raw;
}

/** Élément accepté par la liste et présent au catalogue de la démo (404 unknown_item, 400 wrong_item_type). */
function checkItem(ctx, rawType, rawId, itemType, index = null) {
  const type = oneOf(ctx, rawType, ['album', 'track'], 'type');
  if (itemType !== 'mixed' && type !== itemType) ctx.fail(400, 'wrong_item_type', { itemType });
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
  if (!(type === 'album' ? ctx.ALBUM : ctx.TRACK).has(id)) ctx.fail(404, 'unknown_item', { item: { type, id: id.slice(0, 80) }, ...(index != null ? { index } : {}) });
  return { type, id };
}

/** Éléments reçus : 250 au plus (409 list_full), sans doublon (409 already_in_list). */
function checkItems(ctx, raw, itemType) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) ctx.fail(400, 'invalid_input', { field: 'items' });
  if (raw.length > LIST_MAX_ITEMS) ctx.fail(409, 'list_full', { max: LIST_MAX_ITEMS });
  const seen = new Set();
  return raw.map((it, index) => {
    if (!it || typeof it !== 'object') ctx.fail(400, 'invalid_input', { field: 'items', index });
    const { type, id } = checkItem(ctx, it.type, it.id, itemType, index);
    if (seen.has(`${type}:${id}`)) ctx.fail(409, 'already_in_list', { item: { type, id } });
    seen.add(`${type}:${id}`);
    return { type, id, note: cleanText(ctx, it.note, { max: NOTE_MAX, field: 'note', multiline: true }) || null };
  });
}

/** Remplace les éléments (positions 0 à n-1, ou `position` donnée ; date d'ajout gardée pour un élément déjà là). */
function writeItems(l, items, now = Date.now()) {
  const before = new Map(l.items.map((it) => [`${it.type}:${it.id}`, it.addedAt]));
  l.items = items.map((it, i) => ({ type: it.type, id: it.id, note: it.note ?? null, position: it.position ?? i, addedAt: before.get(`${it.type}:${it.id}`) ?? now }));
  l.itemCount = l.items.length;
  l.updatedAt = now;
}

/** Commentaires de la page d'une liste : la route GET /comments du jumeau du social (mêmes formes, mêmes règles). */
function commentsOf(ctx, listId, query) {
  const route = socialRoutes.find(([m, re]) => m === 'GET' && re.test('/comments'));
  if (!route) return { items: [], nextCursor: null, catalog: null };
  const q = new URLSearchParams({ target: `list:${listId}` });
  if (query?.get('cursor')) q.set('cursor', query.get('cursor'));
  try {
    return route[2]({ params: [], body: {}, query: q, ctx });
  } catch {
    return { items: [], nextCursor: null, catalog: null };
  }
}

/** Fusionne deux champs `catalog` (sans doublon). */
function mergeCatalog(a, b) {
  if (!b) return a;
  const merge = (x = [], y = []) => [...new Map([...x, ...y].map((e) => [e.id, e])).values()];
  return { tracks: merge(a.tracks, b.tracks), albums: merge(a.albums, b.albums), artists: merge(a.artists, b.artists) };
}

/** Page d'une liste : { list, description, items, comments, catalog }. */
function pageOf(ctx, viewer, l, query = null, { comments = true } = {}) {
  const refs = collector(ctx);
  const [list] = summarize(ctx, viewer, [l], refs);
  if (!list) ctx.fail(404, 'not_found');
  list.mine = l.userId === viewer.id;
  list.createdAt = l.createdAt;
  const items = l.items.slice(0, LIST_MAX_ITEMS).map((it) => ({ position: it.position, type: it.type, id: it.id, note: it.note ?? null }));
  for (const it of items) refs.item(it.type, it.id);
  let thread = { items: [], nextCursor: null };
  let extra = null;
  if (comments) {
    const res = commentsOf(ctx, l.id, query);
    thread = { items: res.items || [], nextCursor: res.nextCursor ?? null };
    extra = res.catalog;
  }
  return { list, description: l.description || null, items, comments: thread, catalog: mergeCatalog(refs.build(), extra) };
}

/** Page de listes triées par `keyOf` (décroissant) : résumés et curseur [valeur, id]. */
function pageList(ctx, viewer, rows, query, keyOf) {
  const limit = limitOf(query);
  const after = decodeCursor(query.get('cursor'), ctx, 2);
  const sorted = rows.slice().sort((a, b) => keyOf(b)[0] - keyOf(a)[0] || b.id - a.id);
  const rest = after ? sorted.filter((l) => keyOf(l)[0] < after[0] || (keyOf(l)[0] === after[0] && l.id < after[1])) : sorted;
  const page = rest.slice(0, limit);
  const last = page[page.length - 1];
  const refs = collector(ctx);
  return { items: summarize(ctx, viewer, page, refs), nextCursor: rest.length > limit && last ? encodeCursor(keyOf(last)) : null, catalog: refs.build() };
}

/** Joueur affiché (vérifié, pas bloqué), sinon 404 user_not_found. */
function targetUser(ctx, viewer, raw) {
  const u = ctx.userByName(decodeURIComponent(String(raw || '')));
  if (!u || !u.verified || (u.id !== viewer.id && viewer.hidden.has(u.id))) ctx.fail(404, 'user_not_found');
  return u;
}

/** Un joueur fictif aime puis un autre commente une liste publique du joueur (une seule fois par liste). */
function reactToList(ctx, l) {
  const { db } = ctx;
  if (l.botReacted || l.kind !== 'list' || l.visibility !== 'public' || l.items.length < 3) return;
  const bots = db.users.filter((u) => u.bot && u.id !== l.userId);
  if (!bots.length) return;
  l.botReacted = true;
  if (!Array.isArray(db.botQueue)) db.botQueue = [];
  const now = Date.now();
  db.botQueue.push({ kind: 'like', botId: bots[l.id % bots.length].id, targetType: 'list', targetId: l.id, at: now + BOT_DELAY[0] });
  db.botQueue.push({
    kind: 'comment', botId: bots[(l.id + 1) % bots.length].id, targetType: 'list', targetId: l.id,
    body: BOT_COMMENTS[l.id % BOT_COMMENTS.length], at: now + BOT_DELAY[1],
  });
}

// ----- « Mes 9 albums » -----------------------------------------------------------------------------

const gridOf = (db, uid) => db.lists.find((l) => l.userId === uid && l.kind === 'grid9') || null;

/** 9 cases (album ou null) d'une grille. */
function slotsOf(l) {
  const slots = Array(GRID_SLOTS).fill(null);
  for (const it of l?.items || []) if (it.type === 'album' && it.position < GRID_SLOTS) slots[it.position] = it.id;
  return slots;
}

/** Réponse d'une grille : { list, title, slots, catalog }. */
function gridView(ctx, viewer, owner, l, refs = collector(ctx)) {
  const slots = slotsOf(l);
  refs.albums(slots.filter(Boolean));
  const [list] = l ? summarize(ctx, viewer, [l], refs) : [];
  return { list: list || null, title: l?.title || GRID_TITLES[owner.lang] || GRID_TITLES.fr, slots, catalog: refs.build() };
}

/** Cases reçues → 9 cases (album de la démo ou null) ; 400 / 404 unknown_item / 409 already_in_list. */
function checkSlots(ctx, raw) {
  if (!Array.isArray(raw) || raw.length > GRID_SLOTS) ctx.fail(400, 'invalid_input', { field: 'slots' });
  const slots = Array(GRID_SLOTS).fill(null);
  const seen = new Set();
  raw.forEach((value, i) => {
    if (value === null || value === undefined || value === '') return;
    const id = String(value);
    if (!ctx.ALBUM.has(id)) ctx.fail(404, 'unknown_item', { item: { type: 'album', id: id.slice(0, 80) }, slot: i });
    if (seen.has(id)) ctx.fail(409, 'already_in_list', { item: { type: 'album', id }, slot: i });
    seen.add(id);
    slots[i] = id;
  });
  return slots;
}

/** Écrit la grille d'un joueur (créée à la première sauvegarde). */
function writeGrid(ctx, u, slots, { title = null, visibility = null } = {}) {
  const { db } = ctx;
  const now = Date.now();
  let l = gridOf(db, u.id);
  if (!l) {
    l = {
      id: db.nextListId++, userId: u.id, kind: 'grid9', title: title || GRID_TITLES[u.lang] || GRID_TITLES.fr, description: null, ranked: true,
      itemType: 'album', visibility: visibility || 'public', items: [], itemCount: 0, likeCount: 0, commentCount: 0, createdAt: now, updatedAt: now, hiddenAt: null,
    };
    db.lists.push(l);
  } else {
    if (title) l.title = title;
    if (visibility) l.visibility = visibility;
  }
  writeItems(l, slots.map((id, position) => (id ? { type: 'album', id, position } : null)).filter(Boolean), now);
  return l;
}

// ----- routes ---------------------------------------------------------------------------------------

function start(ctx) {
  ensure(ctx.db);
  const u = ctx.me();
  return { u, viewer: viewerOf(ctx, u.id) };
}

export const routes = [
  ['GET', /^\/lists$/, ({ query, ctx }) => {
    const { viewer } = start(ctx);
    const { db } = ctx;
    const owner = query.get('owner') || 'me';
    const byDate = (l) => [l.updatedAt, l.id];
    if (owner === 'me') return pageList(ctx, viewer, db.lists.filter((l) => l.userId === viewer.id && l.kind === 'list'), query, byDate);
    if (owner === 'friends') {
      const rows = db.lists.filter((l) => viewer.friends.has(l.userId) && l.kind === 'list' && l.visibility !== 'private' && !l.hiddenAt && l.items.length);
      return pageList(ctx, viewer, rows, query, byDate);
    }
    if (owner === 'popular') {
      const rows = db.lists.filter((l) => l.kind === 'list' && l.visibility === 'public' && !l.hiddenAt && l.items.length && !viewer.hidden.has(l.userId));
      return pageList(ctx, viewer, rows, query, (l) => [l.likeCount || 0, l.id]);
    }
    const target = targetUser(ctx, viewer, owner);
    if (!studioOpen(viewer, target)) return { items: [], nextCursor: null, restricted: true, catalog: ctx.refs({}) };
    const self = target.id === viewer.id;
    const friend = viewer.friends.has(target.id);
    const rows = db.lists.filter((l) => l.userId === target.id && l.kind === 'list'
      && (self || (!l.hiddenAt && l.items.length && (l.visibility === 'public' || (friend && l.visibility === 'friends')))));
    return pageList(ctx, viewer, rows, query, byDate);
  }],
  ['POST', /^\/lists$/, ({ body, ctx }) => {
    const { u, viewer } = start(ctx);
    const { db } = ctx;
    const title = titleOf(ctx, body.title);
    const description = cleanText(ctx, body.description, { max: DESCRIPTION_MAX, field: 'description', multiline: true }) || null;
    const itemType = oneOf(ctx, body.itemType, ITEM_TYPES, 'itemType', 'album');
    const visibility = oneOf(ctx, body.visibility, VISIBILITIES, 'visibility', 'public');
    const items = checkItems(ctx, body.items, itemType);
    const mine = db.lists.filter((l) => l.userId === u.id && l.kind === 'list');
    const dayStart = new Date().setHours(0, 0, 0, 0);
    if (mine.filter((l) => l.createdAt >= dayStart).length >= LISTS_PER_DAY) ctx.fail(429, 'quota_exceeded', { kind: 'lists', resetAt: dayStart + DAY });
    if (mine.length >= LISTS_PER_USER) ctx.fail(409, 'too_many_lists', { max: LISTS_PER_USER });
    const now = Date.now();
    const l = {
      id: db.nextListId++, userId: u.id, kind: 'list', title, description, ranked: body.ranked === true || body.ranked === 'true', itemType, visibility,
      items: [], itemCount: 0, likeCount: 0, commentCount: 0, createdAt: now, updatedAt: now, hiddenAt: null,
    };
    writeItems(l, items, now);
    db.lists.push(l);
    reactToList(ctx, l);
    return pageOf(ctx, viewer, l, null, { comments: false });
  }],
  ['GET', /^\/lists\/(\d+)$/, ({ params, query, ctx }) => {
    const { viewer } = start(ctx);
    return pageOf(ctx, viewer, readList(ctx, viewer, params[0]), query);
  }],
  ['PATCH', /^\/lists\/(\d+)$/, ({ params, body, ctx }) => {
    const { u, viewer } = start(ctx);
    const l = ownList(ctx, u, params[0], { grid: true });
    let changed = false;
    if (body.title !== undefined) {
      l.title = titleOf(ctx, body.title);
      changed = true;
    }
    if (body.visibility !== undefined) {
      l.visibility = oneOf(ctx, body.visibility, VISIBILITIES, 'visibility');
      changed = true;
    }
    if (l.kind === 'list') {
      if (body.description !== undefined) {
        l.description = cleanText(ctx, body.description, { max: DESCRIPTION_MAX, field: 'description', multiline: true }) || null;
        changed = true;
      }
      if (body.ranked !== undefined) {
        l.ranked = body.ranked === true || body.ranked === 'true';
        changed = true;
      }
    }
    if (changed) l.updatedAt = Date.now();
    reactToList(ctx, l);
    return pageOf(ctx, viewer, l, null, { comments: false });
  }],
  ['DELETE', /^\/lists\/(\d+)$/, ({ params, ctx }) => {
    const { u } = start(ctx);
    const { db } = ctx;
    const l = ownList(ctx, u, params[0], { grid: true });
    // Comme purgeTarget('list') : la liste, ses commentaires, les « J'aime » (de la liste et de ses commentaires),
    // ses notifications ; les posts qui la citaient perdent leur carte.
    const commentIds = new Set((db.comments || []).filter((c) => c.targetType === 'list' && c.targetId === l.id).map((c) => c.id));
    if (Array.isArray(db.comments)) db.comments = db.comments.filter((c) => !commentIds.has(c.id));
    if (Array.isArray(db.likes)) {
      db.likes = db.likes.filter((x) => !((x.targetType === 'list' && x.targetId === l.id) || (x.targetType === 'comment' && commentIds.has(x.targetId))));
    }
    if (Array.isArray(db.notifications)) db.notifications = db.notifications.filter((n) => !(n.targetType === 'list' && n.targetId === String(l.id)));
    for (const p of db.posts || []) {
      if (p.itemType === 'list' && String(p.itemId) === String(l.id)) {
        p.itemType = null;
        p.itemId = null;
      }
    }
    if (Array.isArray(db.botQueue)) db.botQueue = db.botQueue.filter((e) => !(e.targetType === 'list' && e.targetId === l.id));
    db.lists = db.lists.filter((x) => x.id !== l.id);
    return { ok: true };
  }],
  ['PUT', /^\/lists\/(\d+)\/items$/, ({ params, body, ctx }) => {
    const { u, viewer } = start(ctx);
    const l = ownList(ctx, u, params[0]);
    if (!Array.isArray(body.items)) ctx.fail(400, 'invalid_input', { field: 'items' });
    writeItems(l, checkItems(ctx, body.items, l.itemType));
    reactToList(ctx, l);
    return pageOf(ctx, viewer, l, null, { comments: false });
  }],
  ['POST', /^\/lists\/(\d+)\/items$/, ({ params, body, ctx }) => {
    const { u, viewer } = start(ctx);
    const l = ownList(ctx, u, params[0]);
    const { type, id } = checkItem(ctx, body.type, body.id, l.itemType);
    const note = cleanText(ctx, body.note, { max: NOTE_MAX, field: 'note', multiline: true }) || null;
    if (l.items.some((it) => it.type === type && it.id === id)) ctx.fail(409, 'already_in_list', { item: { type, id } });
    if (l.items.length >= LIST_MAX_ITEMS) ctx.fail(409, 'list_full', { max: LIST_MAX_ITEMS });
    const now = Date.now();
    l.items.push({ type, id, note, position: l.items.length, addedAt: now });
    l.itemCount = l.items.length;
    l.updatedAt = now;
    reactToList(ctx, l);
    const refs = collector(ctx);
    refs.item(type, id);
    const [list] = summarize(ctx, viewer, [l], refs);
    return { list, item: { type, id, note }, catalog: refs.build() };
  }],
  ['DELETE', /^\/lists\/(\d+)\/items\/(album|track)\/([^/]+)$/, ({ params, ctx }) => {
    const { u, viewer } = start(ctx);
    const l = ownList(ctx, u, params[0]);
    const itemId = decodeURIComponent(params[2]);
    if (!l.items.some((it) => it.type === params[1] && it.id === itemId)) ctx.fail(404, 'not_found');
    writeItems(l, l.items.filter((it) => !(it.type === params[1] && it.id === itemId)).map(({ position: _position, ...it }) => it));
    const refs = collector(ctx);
    const [list] = summarize(ctx, viewer, [l], refs);
    return { list, catalog: refs.build() };
  }],
  ['GET', /^\/items\/album\/([^/]+)\/lists$/, ({ params, query, ctx }) => {
    const { viewer } = start(ctx);
    const { db } = ctx;
    const albumId = decodeURIComponent(params[0]);
    if (!ctx.ALBUM.has(albumId)) ctx.fail(404, 'unknown_item');
    const limit = limitOf(query, 10);
    const after = decodeCursor(query.get('cursor'), ctx, 1);
    // Listes (et grilles des Studios publics) lisibles qui contiennent l'album, les plus récentes d'abord ; celles
    // des amis en tête de la première page.
    const rows = db.lists.filter((l) => !l.hiddenAt && ['list', 'grid9'].includes(l.kind) && l.items.some((it) => it.type === 'album' && it.id === albumId)
      && (l.kind === 'list' || l.userId === viewer.id || privacyOf(ctx.userById(l.userId)) === 'public')
      && readable(viewer)(l)).sort((a, b) => b.id - a.id);
    const top = after ? [] : rows.filter((l) => viewer.friends.has(l.userId)).slice(0, ALBUM_FRIENDS);
    const topIds = new Set(top.map((l) => l.id));
    const rest = rows.filter((l) => !topIds.has(l.id) && (!after || l.id < after[0]));
    const page = rest.slice(0, limit);
    const last = page[page.length - 1];
    const refs = collector(ctx);
    return { items: summarize(ctx, viewer, [...top, ...page], refs), nextCursor: rest.length > limit && last ? encodeCursor([last.id]) : null, catalog: refs.build() };
  }],
  ['GET', /^\/me\/grid9$/, ({ ctx }) => {
    const { u, viewer } = start(ctx);
    return gridView(ctx, viewer, u, gridOf(ctx.db, u.id));
  }],
  ['PUT', /^\/me\/grid9$/, ({ body, ctx }) => {
    const { u, viewer } = start(ctx);
    const slots = checkSlots(ctx, body.slots);
    const blank = body.title === undefined || body.title === null || (typeof body.title === 'string' && !body.title.trim());
    const title = blank ? null : titleOf(ctx, body.title);
    const visibility = body.visibility === undefined || body.visibility === null ? null : oneOf(ctx, body.visibility, VISIBILITIES, 'visibility');
    return gridView(ctx, viewer, u, writeGrid(ctx, u, slots, { title, visibility }));
  }],
  ['GET', /^\/users\/([^/]+)\/grid9$/, ({ params, ctx }) => {
    const { viewer } = start(ctx);
    const target = targetUser(ctx, viewer, params[0]);
    const user = ctx.summaries([target.id]).get(target.id) || null;
    const refs = collector(ctx);
    if (user) refs.users([user]);
    const empty = { list: null, title: GRID_TITLES[target.lang] || GRID_TITLES.fr, slots: Array(GRID_SLOTS).fill(null) };
    if (!studioOpen(viewer, target)) return { ...empty, user, restricted: true, catalog: refs.build() };
    const l = gridOf(ctx.db, target.id);
    if (!l || !readable(viewer)(l)) return { ...empty, user, catalog: refs.build() };
    return { ...gridView(ctx, viewer, target, l, refs), user };
  }],
];

// ----- contenus des joueurs fictifs --------------------------------------------------------------------

/** Morceaux les plus connus d'un album (listes de morceaux des joueurs fictifs). */
const topTracks = (ctx, albumId, n) => ctx.staticCatalog.albumTracks(albumId).slice().sort((a, b) => b.pop - a.pop).slice(0, n).map((t) => t.id);

// [joueur, titre, description, classée, type, visibilité, éléments ([id, note?] ; morceaux : fonction), il y a (h)]
const SEED_LISTS = [
  ['lea.beats', 'Pour les trajets de nuit', 'Des disques à écouter fenêtre ouverte, du premier au dernier titre.', true, 'album', 'public', [
    ['moon-safari', 'La Femme d’argent dès la sortie de la ville.'], ['random-access-memories'], ['discovery', 'Pour les autoroutes vides.'],
    ['kind-of-blue'], ['the-dark-side-of-the-moon', 'À écouter d’une traite, sans pause.'], ['21'],
  ], 30],
  ['maxvinyl', 'Les indispensables du vinyle', 'Ceux qui ne quittent jamais la platine. Pressages d’origine ou rééditions, peu importe.', true, 'album', 'public', [
    ['abbey-road', 'La face B, d’un seul tenant.'], ['the-dark-side-of-the-moon'], ['kind-of-blue', 'Le premier jazz que j’ai acheté.'], ['thriller'],
    ['a-night-at-the-opera'], ['exodus'], ['histoire-de-melody-nelson', 'Court, parfait, à écouter fort.'], ['nevermind'],
  ], 52],
  ['soulcollector', 'Soul du dimanche matin', 'Café, platine, rien d’autre.', false, 'album', 'public', [
    ['back-to-black'], ['exodus'], ['kind-of-blue'], ['21'], ['moon-safari'],
  ], 75],
  ['k.dot_fan', 'Le rap qui a tout changé', 'Mon classement, discutable et assumé.', true, 'album', 'public', [
    ['good-kid-maad-city', 'Un film en treize morceaux.'], ['the-college-dropout'], ['the-marshall-mathers-lp'], ['graduation'], ['the-eminem-show'],
  ], 20],
  ['lea.beats', 'Pour danser dans le salon', 'Les morceaux qui font lever tout le monde.', false, 'track', 'public',
    (ctx) => [...topTracks(ctx, 'discovery', 2), ...topTracks(ctx, 'random-access-memories', 1), ...topTracks(ctx, 'thriller', 2), ...topTracks(ctx, 'racine-carree', 1)].map((id) => [id]), 12],
  ['maxvinyl', 'À offrir à quelqu’un qui débute', null, false, 'album', 'friends', [['abbey-road'], ['discovery'], ['back-to-black']], 100],
];

// [joueur, titre (null : titre par défaut), 9 albums]
const SEED_GRIDS = [
  ['lea.beats', null, ['moon-safari', 'discovery', 'random-access-memories', 'when-we-all-fall-asleep', '21', 'racine-carree', 'back-to-black', 'kind-of-blue', 'the-dark-side-of-the-moon']],
  ['maxvinyl', 'Mes 9 de toujours', ['abbey-road', 'the-dark-side-of-the-moon', 'kind-of-blue', 'thriller', 'a-night-at-the-opera', 'exodus', 'histoire-de-melody-nelson', 'nevermind', 'discovery']],
  ['soulcollector', null, ['back-to-black', 'exodus', 'kind-of-blue', '21', 'thriller', 'moon-safari', 'abbey-road', 'racine-carree', 'histoire-de-melody-nelson']],
  ['k.dot_fan', 'Ma vie en 9 disques', ['good-kid-maad-city', 'the-college-dropout', 'the-marshall-mathers-lp', 'graduation', 'the-eminem-show', 'thriller', 'discovery', 'nevermind', 'exodus']],
];

// « J'aime » [index de la liste, joueurs] et commentaires [index, joueur, texte, réponse au commentaire n° ?].
const SEED_LIKES = [[0, ['maxvinyl', 'soulcollector', 'k.dot_fan']], [1, ['lea.beats', 'soulcollector']], [2, ['lea.beats']], [3, ['maxvinyl', 'lea.beats']], [4, ['k.dot_fan']]];
const SEED_COMMENTS = [
  [0, 'maxvinyl', 'Moon Safari en premier, évidemment. Il manque juste un peu de Gainsbourg !'],
  [0, 'lea.beats', 'Melody Nelson est sur ma liste du dimanche, promis.', 0],
  [0, 'soulcollector', 'Je la teste ce soir sur la route.'],
  [1, 'k.dot_fan', 'Abbey Road numéro 1, rien à redire.'],
  [3, 'maxvinyl', 'good kid en premier, d’accord. Mais Graduation si bas ?'],
  [3, 'k.dot_fan', 'Assumé ! Il a moins bien vieilli.', 4],
];

export function seed(db, ctx) {
  ensure(db);
  if (db.listsSeeded) return;
  db.listsSeeded = true;
  const now = Date.now();
  const byName = (n) => ctx.userByName(n);
  const lists = SEED_LISTS.map(([username, title, description, ranked, itemType, visibility, items, hoursAgo]) => {
    const u = byName(username);
    if (!u) return null;
    const entries = (typeof items === 'function' ? items(ctx) : items).filter(([id]) => (itemType === 'track' ? ctx.TRACK : ctx.ALBUM).has(id));
    const at = now - hoursAgo * HOUR;
    const l = {
      id: db.nextListId++, userId: u.id, kind: 'list', title, description, ranked, itemType, visibility, items: [], itemCount: 0,
      likeCount: 0, commentCount: 0, createdAt: at - 2 * DAY, updatedAt: at, hiddenAt: null, botReacted: true,
    };
    writeItems(l, entries.map(([id, note]) => ({ type: itemType === 'track' ? 'track' : 'album', id, note: note || null })), at);
    db.lists.push(l);
    return l;
  });
  SEED_GRIDS.forEach(([username, title, albums], i) => {
    const u = byName(username);
    if (!u) return;
    const l = writeGrid(ctx, u, albums.map((id) => (ctx.ALBUM.has(id) ? id : null)), { title });
    l.createdAt = now - 20 * DAY;
    l.updatedAt = now - (3 + i * 2) * DAY;
  });
  // « J'aime » et commentaires : tables du jumeau du social (créées ici si besoin, il les complète ensuite).
  if (!Array.isArray(db.likes)) db.likes = [];
  if (!Array.isArray(db.comments)) db.comments = [];
  if (!Number.isInteger(db.nextCommentId)) db.nextCommentId = 1 + Math.max(0, ...db.comments.map((c) => c.id || 0));
  for (const [index, names] of SEED_LIKES) {
    const l = lists[index];
    if (!l) continue;
    for (const n of names) {
      const u = byName(n);
      if (!u || u.id === l.userId) continue;
      db.likes.push({ userId: u.id, targetType: 'list', targetId: l.id, createdAt: l.updatedAt + HOUR });
      l.likeCount += 1;
    }
  }
  const comments = [];
  SEED_COMMENTS.forEach(([index, username, body, parentIdx], i) => {
    const l = lists[index];
    const u = byName(username);
    if (!l || !u) return;
    const parent = parentIdx !== undefined ? comments[parentIdx] : null;
    const row = {
      id: db.nextCommentId++, userId: u.id, targetType: 'list', targetId: l.id, parentId: parent?.id ?? null, replyToUserId: null,
      body, likeCount: 0, replyCount: 0, createdAt: Math.min(now - 60_000, l.updatedAt + (i + 1) * 40 * 60_000),
      editedAt: null, deletedAt: null, hiddenAt: null,
    };
    db.comments.push(row);
    comments[i] = row;
    l.commentCount += 1;
    if (parent) parent.replyCount += 1;
  });
}

export function migrate(db, ctx) {
  // Sauvegarde d'avant les listes : la table, puis les listes et grilles des joueurs fictifs.
  ensure(db);
  if (!db.listsSeeded) seed(db, ctx);
}
