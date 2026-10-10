// Jumeau de démo du module « notifications » (server/notifications.js, P0-F, PLAN.md 4.1.7) : mêmes routes, mêmes formes.
//   GET  /notifications?cursor=&limit=   groupes (non lus d'abord), acteurs résumés, cible, données, catalogue ;
//   GET  /notifications/unread           { unread, state } (pastille de la cloche) ;
//   POST /notifications/read             { ids?, all? } → { unread, state }.
// Données : db.notifications = [{ id, userId, kind, actorId, targetType, targetId, groupKey, data, createdAt, readAt }].
// La démo n'a pas de bus d'événements : les notifications d'amitié sont déduites de db.friendships à chaque lecture
// (une demande reçue → friend_request, une demande acceptée par un joueur fictif → friend_accept), les autres sont
// écrites par les jumeaux qui les déclenchent (mock/moderation.js appelle notify()).
export const name = 'notifications';

export const GROUP_CAP = 50;
export const UNREAD_CAP = 99;
const PAGE = 20;
const LIST_CAP = 500;

const encodeCursor = (values) => btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decodeOffset(raw, ctx) {
  if (!raw) return 0;
  try {
    const values = JSON.parse(atob(String(raw).replace(/-/g, '+').replace(/_/g, '/')));
    if (Array.isArray(values) && Number.isInteger(values[0]) && values[0] >= 0) return Math.min(values[0], LIST_CAP);
  } catch {
    // curseur illisible
  }
  return ctx.fail(400, 'invalid_input', { field: 'cursor' });
}

function ensure(db) {
  if (!Array.isArray(db.notifications)) db.notifications = [];
  if (!Number.isInteger(db.nextNotificationId)) db.nextNotificationId = 1 + Math.max(0, ...db.notifications.map((n) => n.id || 0));
}

/** Joueurs masqués pour `uid` (blocages dans un sens ou dans l'autre, tenus par mock/moderation.js). */
function hiddenIds(db, uid) {
  const out = new Set();
  for (const b of Array.isArray(db.blocks) ? db.blocks : []) {
    if (b?.blocker === uid) out.add(b.blocked);
    if (b?.blocked === uid) out.add(b.blocker);
  }
  return out;
}

/**
 * Crée une notification (comme deps.notify) : jamais à soi-même, jamais à travers un blocage ; au plus 50 non lues par
 * groupe. Renvoie son identifiant, ou null.
 */
export function notify(db, userId, kind, { actorId = null, targetType = null, targetId = null, groupKey = null, data = null, at = Date.now() } = {}) {
  ensure(db);
  if (!db.users.some((u) => u.id === userId)) return null;
  if (actorId != null && (actorId === userId || hiddenIds(db, userId).has(actorId))) return null;
  const id = db.nextNotificationId++;
  db.notifications.push({
    id, userId, kind, actorId, targetType, targetId: targetId == null ? null : String(targetId), groupKey, data, createdAt: at, readAt: null,
  });
  if (groupKey) {
    const unread = db.notifications.filter((n) => n.userId === userId && n.groupKey === groupKey && !n.readAt).sort((a, b) => b.id - a.id);
    const drop = new Set(unread.slice(GROUP_CAP).map((n) => n.id));
    if (drop.size) db.notifications = db.notifications.filter((n) => !drop.has(n.id));
  }
  return id;
}

/** Notifications d'amitié déduites des demandes (la démo n'a pas d'événements friend.requested / friend.accepted). */
function syncFriends(db, uid) {
  ensure(db);
  const mine = db.notifications.filter((n) => n.userId === uid);
  const known = (kind, requestId) => mine.some((n) => n.kind === kind && n.data?.requestId === requestId);
  for (const f of db.friendships) {
    if (f.status === 'pending' && f.addressee === uid && !known('friend_request', f.id)) {
      notify(db, uid, 'friend_request', { actorId: f.requester, targetType: 'user', targetId: f.requester, groupKey: `friend_request:${f.requester}`, data: { requestId: f.id }, at: f.createdAt });
    }
    if (f.status === 'accepted' && f.requester === uid && f.respondedAt && !known('friend_accept', f.id)) {
      notify(db, uid, 'friend_accept', { actorId: f.addressee, targetType: 'user', targetId: f.addressee, groupKey: `friend_accept:${f.addressee}`, data: { requestId: f.id }, at: f.respondedAt });
    }
  }
  // Une demande qui n'attend plus rien (acceptée, refusée, annulée) passe en lue.
  const pending = new Set(db.friendships.filter((f) => f.status === 'pending' && f.addressee === uid).map((f) => f.id));
  for (const n of db.notifications) {
    if (n.userId === uid && n.kind === 'friend_request' && !n.readAt && !pending.has(n.data?.requestId)) n.readAt = Date.now();
  }
}

const groupOf = (n) => n.groupKey || `id:${n.id}`;

/** Groupes non lus (pastille), plafonnés à 99. */
export function unreadCount(db, uid) {
  ensure(db);
  const groups = new Set(db.notifications.filter((n) => n.userId === uid && !n.readAt).map(groupOf));
  return Math.min(groups.size, UNREAD_CAP);
}

/** Pastilles de state.counts (contrat de mockServer.js). */
export function counts(db, ctx, uid) {
  syncFriends(db, uid);
  return { unread: unreadCount(db, uid) };
}

function list(ctx, query) {
  const { db } = ctx;
  const uid = ctx.me().id;
  syncFriends(db, uid);
  const limit = Math.max(1, Math.min(50, Number.parseInt(query.get('limit'), 10) || PAGE));
  const offset = decodeOffset(query.get('cursor'), ctx);
  // Groupes : même clé de groupe et même état lu / non lu, non lus d'abord puis les plus récents.
  const groups = new Map();
  for (const n of db.notifications) {
    if (n.userId !== uid) continue;
    const key = `${groupOf(n)}|${n.readAt ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  const sorted = [...groups.values()].map((rows) => rows.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id))
    .sort((a, b) => (a[0].readAt ? 1 : 0) - (b[0].readAt ? 1 : 0) || b[0].createdAt - a[0].createdAt || b[0].id - a[0].id);
  const page = sorted.slice(offset, offset + limit);
  const hidden = hiddenIds(db, uid);
  const actorIds = new Set();
  for (const rows of page) {
    for (const id of [...new Set(rows.map((r) => r.actorId).filter((x) => x != null && !hidden.has(x)))].slice(0, 3)) actorIds.add(id);
    if (rows[0].targetType === 'user' && Number(rows[0].targetId)) actorIds.add(Number(rows[0].targetId));
  }
  const users = ctx.summaries([...actorIds]);
  const albumIds = [];
  const trackIds = [];
  const items = [];
  for (const rows of page) {
    const h = rows[0];
    const visible = [...new Set(rows.map((r) => r.actorId).filter((x) => x != null && !hidden.has(x) && users.has(x)))];
    const actors = visible.slice(0, 3).map((id) => users.get(id));
    if (h.actorId != null && !actors.length) continue;
    const data = { ...(h.data || {}) };
    if (h.kind === 'friend_request') data.pending = db.friendships.some((f) => f.id === data.requestId && f.status === 'pending' && f.addressee === uid);
    if (data.itemType === 'album' && data.itemId) albumIds.push(data.itemId);
    if (data.itemType === 'track' && data.itemId) trackIds.push(data.itemId);
    const target = h.targetType ? { type: h.targetType, id: h.targetId } : null;
    if (target?.type === 'user') target.username = users.get(Number(h.targetId))?.username ?? null;
    items.push({ id: h.id, kind: h.kind, actors, actorCount: visible.length, target, data, createdAt: h.createdAt, read: !!h.readAt, count: rows.length });
  }
  const end = offset + limit >= Math.min(sorted.length, LIST_CAP);
  const avatarAlbums = [...users.values()].map((u) => (typeof u.avatar === 'string' && u.avatar.startsWith('album:') ? u.avatar.slice(6) : null)).filter(Boolean);
  return {
    items,
    nextCursor: end ? null : encodeCursor([offset + limit]),
    unread: unreadCount(db, uid),
    catalog: ctx.refs({ albumIds: [...albumIds, ...avatarAlbums].filter((id) => ctx.ALBUM.has(id)), trackIds: trackIds.filter((id) => ctx.TRACK.has(id)) }),
  };
}

function markRead(ctx, body) {
  const { db } = ctx;
  const uid = ctx.me().id;
  ensure(db);
  const now = Date.now();
  if (body.all === true || body.all === 'true') {
    for (const n of db.notifications) if (n.userId === uid && !n.readAt) n.readAt = now;
  } else {
    const wanted = new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 100));
    for (const n of db.notifications.filter((x) => x.userId === uid && !x.readAt && wanted.has(x.id))) {
      for (const m of db.notifications) {
        if (m.userId === uid && !m.readAt && (n.groupKey ? m.groupKey === n.groupKey : m.id === n.id)) m.readAt = now;
      }
    }
  }
  return { unread: unreadCount(db, uid) };
}

export const routes = [
  ['GET', /^\/notifications$/, ({ query, ctx }) => list(ctx, query)],
  ['GET', /^\/notifications\/unread$/, ({ ctx }) => {
    const uid = ctx.me().id;
    syncFriends(ctx.db, uid);
    return { unread: unreadCount(ctx.db, uid), state: ctx.partialState() };
  }],
  ['POST', /^\/notifications\/read$/, ({ body, ctx }) => ({ ...markRead(ctx, body), state: ctx.partialState() })],
];

export function seed(db) {
  ensure(db);
}

export function migrate(db) {
  ensure(db);
}
