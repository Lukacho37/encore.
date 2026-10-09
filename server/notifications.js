// Module « notifications » : boîte de chaque joueur (PLAN.md 4.1.7). Chantier : P0-F.
// Types de P0 : friend_request, friend_accept, moderation_action, report_resolved, appeal_decided, terms_updated ;
// P1 ajoute les types sociaux (like_*, comment_*, reply_comment, badge_earned) par deps.notify, sans toucher à ce fichier.
//
// deps.notify(userId, kind, { actorId, targetType, targetId, groupKey, data }) : jamais à soi-même, jamais à travers un
// blocage ; au plus 50 notifications non lues par groupe. Les notifications non lues d'un même `group_key` se lisent
// comme une seule (« Camille et 3 autres ont aimé ta critique de Discovery ») ; marquées lues ensemble, elles restent
// groupées. Pastille : state.counts.unread = nombre de groupes non lus (index notif_unread, plafonné à 99).
export const name = 'notifications';

export const P0_KINDS = ['friend_request', 'friend_accept', 'moderation_action', 'report_resolved', 'appeal_decided', 'terms_updated'];
/** Notifications non lues gardées par groupe (les plus anciennes partent). */
export const GROUP_CAP = 50;
export const UNREAD_CAP = 99;
const PAGE = 20;
const LIST_CAP = 500;
const DAY = 86_400_000;
/** Décisions de modération qui ne concernent pas l'auteur (pas de notification). */
const SILENT_ACTIONS = new Set(['dismiss', 'restore', 'cover_block', 'cover_unblock']);

function parse(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function init(deps) {
  const { db, services, validate, paging } = deps;
  const statements = new Map();
  const q = (sql) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    return st;
  };
  const json = (v) => JSON.stringify(v);

  /** Crée une notification ; renvoie son identifiant, ou null quand elle n'a pas lieu d'être. */
  function notify(userId, kind, { actorId = null, targetType = null, targetId = null, groupKey = null, data = null } = {}) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0 || typeof kind !== 'string' || !kind) return null;
    const actor = actorId == null ? null : Number(actorId);
    if (actor != null && (!Number.isInteger(actor) || actor === uid)) return null;
    if (actor != null && deps.access?.isBlocked?.(uid, actor)) return null;
    if (!q('SELECT 1 FROM users WHERE id = ?').get(uid)) return null;
    const row = q(`INSERT INTO notifications (user_id, kind, actor_id, target_type, target_id, group_key, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .get(uid, kind.slice(0, 40), actor, targetType, targetId == null ? null : String(targetId), groupKey, data == null ? null : json(data), Date.now());
    if (groupKey) {
      q(`DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE user_id = ? AND group_key = ? AND read_at IS NULL
        ORDER BY id DESC LIMIT -1 OFFSET ${GROUP_CAP})`).run(uid, groupKey);
    }
    return row.id;
  }

  /** Groupes non lus (pastille de la cloche), plafonnés à 99. */
  function unreadCount(userId) {
    const n = q(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM notifications WHERE user_id = ? AND read_at IS NULL
      GROUP BY COALESCE(group_key, 'id:' || id) LIMIT ${UNREAD_CAP + 1})`).get(Number(userId)).n;
    return Math.min(n, UNREAD_CAP);
  }

  /**
   * Notifications groupées, non lues d'abord puis les plus récentes : { items: [Notification], nextCursor, unread,
   * catalog }. Notification = { id, kind, actors: [UserSummary ≤ 3], actorCount, target: { type, id, username? } | null,
   * data, createdAt, read, count }. `id` est celui de la plus récente du groupe (à renvoyer à POST /notifications/read).
   */
  function list(userId, { cursor, limit } = {}) {
    const n = paging.limitOf(limit, { def: PAGE, max: 50 });
    const offset = paging.offsetOf(cursor, { cap: LIST_CAP });
    const groups = q(`SELECT COALESCE(group_key, 'id:' || id) AS gk, COALESCE(read_at, 0) AS ra, MAX(id) AS id, MAX(created_at) AS at, COUNT(*) AS n
      FROM notifications WHERE user_id = ? GROUP BY gk, ra ORDER BY ra = 0 DESC, at DESC, id DESC LIMIT ? OFFSET ?`).all(userId, n + 1, offset);
    const page = paging.offsetPage(groups, offset, n, { cap: LIST_CAP });
    if (!page.items.length) return { items: [], nextCursor: null, unread: unreadCount(userId), catalog: deps.refs() };
    const heads = new Map(q('SELECT * FROM notifications WHERE id IN (SELECT value FROM json_each(?))')
      .all(json(page.items.map((g) => g.id))).map((r) => [r.id, r]));
    // Acteurs de chaque groupe, du plus récent au plus ancien (distincts).
    const actorRows = q(`SELECT COALESCE(group_key, 'id:' || id) AS gk, COALESCE(read_at, 0) AS ra, actor_id, MAX(created_at) AS at
      FROM notifications WHERE user_id = ? AND actor_id IS NOT NULL AND COALESCE(group_key, 'id:' || id) IN (SELECT value FROM json_each(?))
      GROUP BY gk, ra, actor_id ORDER BY at DESC`).all(userId, json([...new Set(page.items.map((g) => g.gk))]));
    const actorsOf = new Map();
    for (const r of actorRows) {
      const key = `${r.gk}|${r.ra}`;
      if (!actorsOf.has(key)) actorsOf.set(key, []);
      actorsOf.get(key).push(r.actor_id);
    }
    // Acteurs masqués (blocages) retirés avant de compter ; seuls les trois plus récents sont résumés.
    const hidden = deps.access?.hiddenIds?.(userId) ?? new Set();
    for (const [key, list] of actorsOf) actorsOf.set(key, list.filter((id) => !hidden.has(id)));
    const ids = new Set();
    for (const list of actorsOf.values()) for (const id of list.slice(0, 3)) ids.add(id);
    // Cible « joueur » : son pseudo pour le lien /u/:username.
    for (const g of page.items) {
      const h = heads.get(g.id);
      if (h?.target_type === 'user' && Number(h.target_id)) ids.add(Number(h.target_id));
    }
    const users = services.userSummaries(ids, userId);
    // Demandes d'ami encore en attente (bouton « Accepter » seulement pour celles-là).
    const requestIds = page.items.map((g) => parse(heads.get(g.id)?.data)?.requestId).filter((x) => Number.isInteger(x));
    const pending = new Set(requestIds.length
      ? q(`SELECT id FROM friendships WHERE addressee_id = ? AND status = 'pending' AND id IN (SELECT value FROM json_each(?))`)
        .all(userId, json(requestIds)).map((r) => r.id)
      : []);
    const albumIds = [];
    const trackIds = [];
    const items = [];
    for (const g of page.items) {
      const h = heads.get(g.id);
      if (!h) continue;
      const visible = actorsOf.get(`${g.gk}|${g.ra}`) || [];
      const actors = visible.slice(0, 3).map((id) => users.get(id)).filter(Boolean);
      // Un groupe dont tous les acteurs sont désormais masqués (blocage, compte supprimé) ne s'affiche plus.
      if (h.actor_id != null && !actors.length) continue;
      const data = parse(h.data) || {};
      if (h.kind === 'friend_request') data.pending = pending.has(data.requestId);
      if (data.itemType === 'album' && data.itemId) albumIds.push(data.itemId);
      if (data.itemType === 'track' && data.itemId) trackIds.push(data.itemId);
      if (h.target_type === 'album') albumIds.push(h.target_id);
      if (h.target_type === 'track') trackIds.push(h.target_id);
      const target = h.target_type ? { type: h.target_type, id: h.target_id } : null;
      if (target?.type === 'user') target.username = users.get(Number(h.target_id))?.username ?? null;
      items.push({
        id: h.id,
        kind: h.kind,
        actors,
        actorCount: Math.max(visible.length, actors.length),
        target,
        data,
        createdAt: g.at,
        read: g.ra !== 0,
        count: g.n,
      });
    }
    return {
      items,
      nextCursor: page.nextCursor,
      unread: unreadCount(userId),
      catalog: deps.refs({ albumIds: [...albumIds, ...services.summaryAlbums(users.values())], trackIds }),
    };
  }

  /** Marque lus des groupes (`ids` : identifiants renvoyés par list) ou tout (`all`). Renvoie { unread }. */
  function markRead(userId, { ids, all } = {}) {
    const now = Date.now();
    if (validate.bool(all)) {
      q('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, userId);
    } else {
      const wanted = (Array.isArray(ids) ? ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 100);
      if (wanted.length) {
        const rows = q(`SELECT id, group_key FROM notifications WHERE user_id = ? AND read_at IS NULL AND id IN (SELECT value FROM json_each(?))`)
          .all(userId, json(wanted));
        for (const r of rows) {
          if (r.group_key) q('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND group_key = ?').run(now, userId, r.group_key);
          else q('UPDATE notifications SET read_at = ? WHERE id = ?').run(now, r.id);
        }
      }
    }
    return { unread: unreadCount(userId) };
  }

  // ----- abonnements aux événements du domaine -----------------------------------------------------

  deps.bus.on('friend.requested', ({ fromId, toId, requestId }) => {
    // Une nouvelle demande du même joueur remplace la précédente dans la cloche (même groupe).
    notify(toId, 'friend_request', { actorId: fromId, targetType: 'user', targetId: fromId, groupKey: `friend_request:${fromId}`, data: { requestId } });
  });

  deps.bus.on('friend.accepted', ({ userId, friendId }) => {
    // La demande acceptée n'attend plus rien : sa notification passe en lue.
    q("UPDATE notifications SET read_at = ? WHERE user_id = ? AND actor_id = ? AND kind = 'friend_request' AND read_at IS NULL").run(Date.now(), userId, friendId);
    notify(friendId, 'friend_accept', { actorId: userId, targetType: 'user', targetId: userId, groupKey: `friend_accept:${userId}` });
  });

  deps.bus.on('moderation.action', ({ actionId, action, authorId }) => {
    if (!authorId || SILENT_ACTIONS.has(action)) return;
    const a = q('SELECT * FROM moderation_actions WHERE id = ?').get(actionId);
    if (!a) return;
    const snap = parse(a.snapshot) || {};
    const until = action === 'suspend' ? q('SELECT suspended_until FROM users WHERE id = ?').get(authorId)?.suspended_until ?? null : null;
    notify(authorId, 'moderation_action', {
      targetType: a.target_type,
      targetId: a.target_id,
      data: {
        actionId: a.id,
        action: a.action,
        ground: a.ground,
        statement: a.statement,
        appealable: action !== 'unsuspend',
        ...(snap.itemType && snap.itemId ? { itemType: snap.itemType, itemId: snap.itemId } : {}),
        ...(typeof snap.text === 'string' ? { excerpt: snap.text.slice(0, 140) } : {}),
        ...(until ? { until } : {}),
      },
    });
  });

  return { notify, unreadCount, list, markRead };
}

export function routes(r, deps) {
  const { limits } = deps;
  const api = () => deps.notifications;
  const partial = (req) => deps.services.state(req.user.id, { partial: true });

  r.get('/notifications', limits.read, (req, res) => res.json(api().list(req.user.id, req.query)));
  // Pastilles seules (la cloche les relit de temps en temps) : l'état partiel met à jour state.counts.
  r.get('/notifications/unread', limits.read, (req, res) => res.json({ unread: api().unreadCount(req.user.id), state: partial(req) }));
  r.post('/notifications/read', limits.write, (req, res) => res.json({ ...api().markRead(req.user.id, req.body), state: partial(req) }));
}

export const jobs = [
  {
    // Notifications lues : 90 jours ; non lues : 180 jours.
    name: 'purge-notifications',
    run({ db }) {
      const now = Date.now();
      const read = db.prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?').run(now - 90 * DAY).changes;
      const unread = db.prepare('DELETE FROM notifications WHERE read_at IS NULL AND created_at < ?').run(now - 180 * DAY).changes;
      return { read, unread };
    },
  },
];
