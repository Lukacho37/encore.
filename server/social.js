// Module « social » : posts, commentaires, mentions « J'aime », permaliens de critiques (PLAN.md 4.2.1, 7.2). Chantier : P1-A.
//
// Post = { id, user, body, item: { type, id } | null, review?, list?, itemStats?, visibility, likeCount, commentCount,
//          liked, createdAt, editedAt, mine, moderated? }
// Comment = { id, user, body | null, deleted, parentId, replyToUser, likeCount, liked, replyCount, replies?: [Comment ≤ 2],
//             createdAt, editedAt, mine, moderated? }
//
// Règles (appliquées ici, jamais par le site) :
// - lire un contenu : son auteur, ou quelqu'un qui n'est pas bloqué (dans un sens ou dans l'autre) et qui a le droit de le
//   voir (post « amis » : les amis ; liste : sa visibilité ; critique : tout le monde) ; un contenu masqué par la
//   modération n'est lu que par son auteur (`moderated: true`) ; sinon 404 not_found (jamais 403, rien ne fuit) ;
// - écrire (post, commentaire, « J'aime ») : compte actif (deps.access.assertActive), quotas quotidiens (deps.quota),
//   politique des liens (deps.access.linkPolicy), post identique refusé pendant 24 h (409 duplicate_post) ;
// - commentaires sur un seul niveau : répondre à une réponse rattache au commentaire de tête, avec @nom
//   (reply_to_user_id) ; un commentaire supprimé qui a des réponses reste en place, vidé (« Commentaire supprimé ») ;
// - compteurs (like_count, comment_count, reply_count) tenus dans la même transaction que la ligne comptée ;
// - notifications groupées (deps.notify) : like_<type> (groupe like:<type>:<id>), comment_<type> et reply_comment
//   (groupe comment:<type>:<id>), mention_post / mention_comment (@pseudo dans un texte), mention_review / mention_list
//   (ta critique ou ta liste partagée dans un post). La cible d'une notification est toujours une page qui s'ouvre
//   (post, critique, liste) ; le commentaire visé est dans data.commentId.
// Événements : post.created, comment.created, like.created (la ligne + ownerId de la cible), content.removed.
// API interne (deps.social) : readTarget, likedAmong, hydratePosts, postsByIds, commentsPage, listSummaries, collector.
export const name = 'social';

/** Longueur maximale d'un post et d'un commentaire (caractères). */
export const POST_MAX = 1000;
export const COMMENT_MAX = 1000;
/** Pages par défaut ; posts des amis en tête des discussions d'un album ; réponses montrées sous un commentaire. */
const PAGE = 20;
const DISCUSSION_FRIENDS = 5;
const REPLIES_PREVIEW = 2;
/** @pseudo notifiés au plus par texte. */
const MENTIONS_MAX = 5;
const DAY = 86_400_000;

export const ITEM_TYPES = ['album', 'track', 'artist', 'list', 'review'];
export const COMMENT_TARGETS = ['post', 'review', 'list'];
export const LIKE_TARGETS = ['post', 'review', 'comment', 'list'];
const VISIBILITIES = ['public', 'friends'];
/** Tables des contenus (compteurs). */
const TABLES = { post: 'posts', review: 'ratings', comment: 'comments', list: 'lists' };
// @pseudo dans un texte (mêmes caractères que les pseudos, shared/rules.js USERNAME_RE).
const MENTION_RE = /(^|[^\w@.])@([a-zA-Z0-9_.]{3,20})/g;
// Corps d'un commentaire supprimé gardé pour ses réponses (la colonne refuse un texte vide ; jamais affiché).
const DELETED_BODY = '—';

/** Identifiant entier positif reçu d'une requête, sinon null. */
const toId = (raw) => {
  const n = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Pseudos cités (@pseudo) dans un texte, sans doublon (casse ignorée), au plus MENTIONS_MAX. */
export function mentionsOf(text) {
  const out = new Map();
  if (typeof text !== 'string') return [];
  for (const m of text.matchAll(MENTION_RE)) {
    const name = m[2].replace(/[.]+$/, '');
    if (name.length >= 3 && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), name);
    if (out.size >= MENTIONS_MAX) break;
  }
  return [...out.values()];
}

export function init(deps) {
  const { db, catalog, services, validate, paging, HttpError } = deps;
  const statements = new Map();
  /** Requête préparée une fois par texte SQL. */
  const q = (sql) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    return st;
  };
  const json = (v) => JSON.stringify(v);
  const access = () => deps.access || {};
  /** Transaction, sauf si l'appelant en a déjà ouvert une. */
  const atomic = (fn) => (db.isTransaction ? fn() : deps.tx(fn));
  const notFound = () => new HttpError(404, 'not_found');
  /** Curseur [valeur de tri, id] : deux nombres, sinon 400 invalid_input. */
  const keyset = (raw) => {
    const after = paging.decodeCursor(raw, { length: 2 });
    if (after && !(Number.isFinite(after[0]) && Number.isInteger(after[1]))) throw new HttpError(400, 'invalid_input', { field: 'cursor' });
    return after;
  };

  // ----- celui qui regarde ------------------------------------------------------------------------

  /** Joueurs masqués (blocages) et amis (lus à la première demande) de celui qui regarde. */
  function viewerOf(viewerId) {
    const id = Number(viewerId);
    const hidden = access().hiddenIds?.(id) ?? new Set();
    let friends = null;
    return {
      id,
      hidden,
      get friends() {
        friends ||= new Set([...services.friendIds(id)].filter((f) => !hidden.has(f)));
        return friends;
      },
    };
  }
  const asViewer = (v) => (typeof v === 'object' && v ? v : viewerOf(v));

  /** Contenu de `ownerId` à la visibilité `visibility` lisible par `viewer` (blocages compris). */
  function canRead(viewer, ownerId, visibility) {
    if (ownerId === viewer.id) return true;
    if (viewer.hidden.has(ownerId)) return false;
    if (visibility === 'public') return true;
    if (visibility === 'friends') return viewer.friends.has(ownerId);
    return false;
  }

  // ----- références du catalogue d'une réponse ----------------------------------------------------

  /** Collecteur des albums, morceaux et artistes cités ; build() → `catalog` (deps.refs, une fois). */
  function collector() {
    const albumIds = [];
    const trackIds = [];
    const artistIds = [];
    return {
      item(type, id) {
        if (!id) return;
        if (type === 'album') albumIds.push(id);
        else if (type === 'track') trackIds.push(id);
        else if (type === 'artist') artistIds.push(id);
      },
      users(summaries) {
        albumIds.push(...services.summaryAlbums(summaries));
      },
      albums(ids) {
        albumIds.push(...ids);
      },
      build: () => deps.refs({ albumIds, trackIds, artistIds }),
    };
  }

  // ----- cibles (post, critique, liste, commentaire) ------------------------------------------------

  /**
   * Cible lisible par `viewer` : { type, id, ownerId, hidden, visibility, row, root? } ; 404 not_found sinon. Un contenu
   * masqué n'est rendu qu'à son auteur (hidden: true). `root` : pour un commentaire, la cible de son fil.
   */
  function readTarget(viewerArg, type, rawId) {
    const viewer = asViewer(viewerArg);
    const id = toId(rawId);
    if (!id) throw notFound();
    let row = null;
    let visibility = 'public';
    let root = null;
    if (type === 'post') {
      row = q('SELECT id, user_id, body, item_type, item_id, visibility, hidden_at FROM posts WHERE id = ?').get(id);
      visibility = row?.visibility;
    } else if (type === 'review') {
      row = q('SELECT id, user_id, item_type, item_id, hidden_at FROM ratings WHERE id = ? AND review IS NOT NULL').get(id);
    } else if (type === 'list') {
      row = q("SELECT id, user_id, kind, visibility, hidden_at FROM lists WHERE id = ? AND kind <> 'wishlist'").get(id);
      visibility = row?.visibility;
    } else if (type === 'comment') {
      row = q('SELECT id, user_id, target_type, target_id, parent_id, deleted_at, hidden_at FROM comments WHERE id = ?').get(id);
      if (row?.deleted_at) row = null;
      if (row) root = readTarget(viewer, row.target_type, row.target_id);
      if (root?.hidden) row = null;
    }
    if (!row || !canRead(viewer, row.user_id, visibility)) throw notFound();
    const hidden = !!row.hidden_at;
    if (hidden && row.user_id !== viewer.id) throw notFound();
    return { type, id, ownerId: row.user_id, hidden, visibility, row, root };
  }

  /** Élément (album, morceau) d'une cible, pour la vignette et le titre d'une notification. */
  function itemDataOf(target) {
    const t = target.root || target;
    const { row } = t;
    if ((t.type === 'review' || t.type === 'post') && (row.item_type === 'album' || row.item_type === 'track')) {
      return { itemType: row.item_type, itemId: row.item_id };
    }
    return {};
  }

  /** Mentions « J'aime » de `viewerId` parmi ces cibles d'un type (une requête). */
  function likedAmong(viewerId, type, ids) {
    const list = [...new Set(ids)].filter((x) => Number.isInteger(x));
    if (!list.length) return new Set();
    return new Set(q('SELECT target_id FROM likes WHERE user_id = ? AND target_type = ? AND target_id IN (SELECT value FROM json_each(?))')
      .all(viewerId, type, json(list)).map((r) => r.target_id));
  }

  // ----- listes (résumé ListSummary, PLAN.md 4.2.4) -------------------------------------------------

  /**
   * Résumés de listes lisibles par `viewer` : Map id → { id, kind, title, user, itemCount, likeCount, commentCount, liked,
   * visibility, ranked, coverAlbumIds ≤ 4, updatedAt }. Quatre requêtes, quel que soit le nombre de listes.
   */
  function listSummaries(viewerArg, ids, refs = null) {
    const viewer = asViewer(viewerArg);
    const out = new Map();
    const wanted = [...new Set(ids.map(Number))].filter((x) => Number.isInteger(x) && x > 0);
    if (!wanted.length) return out;
    const rows = q(`SELECT id, user_id, kind, title, visibility, ranked, item_count, like_count, comment_count, updated_at, hidden_at
      FROM lists WHERE id IN (SELECT value FROM json_each(?)) AND kind <> 'wishlist'`).all(json(wanted))
      .filter((r) => canRead(viewer, r.user_id, r.visibility) && (!r.hidden_at || r.user_id === viewer.id));
    if (!rows.length) return out;
    const covers = new Map();
    for (const c of q(`SELECT list_id, item_id FROM (SELECT list_id, item_id, ROW_NUMBER() OVER (PARTITION BY list_id ORDER BY position) AS rn
        FROM list_items WHERE list_id IN (SELECT value FROM json_each(?)) AND item_type = 'album') WHERE rn <= 4`).all(json(rows.map((r) => r.id)))) {
      if (!covers.has(c.list_id)) covers.set(c.list_id, []);
      covers.get(c.list_id).push(c.item_id);
    }
    const users = services.userSummaries(rows.map((r) => r.user_id), viewer.id, { hidden: viewer.hidden });
    const liked = likedAmong(viewer.id, 'list', rows.map((r) => r.id));
    for (const r of rows) {
      const user = users.get(r.user_id);
      if (!user) continue;
      const coverAlbumIds = covers.get(r.id) || [];
      refs?.albums(coverAlbumIds);
      out.set(r.id, {
        id: r.id, kind: r.kind, title: r.title, user, itemCount: r.item_count, likeCount: r.like_count, commentCount: r.comment_count,
        liked: liked.has(r.id), visibility: r.visibility, ranked: !!r.ranked, coverAlbumIds, updatedAt: r.updated_at,
        ...(r.hidden_at ? { moderated: true } : {}),
      });
    }
    refs?.users(users.values());
    return out;
  }

  // ----- posts ------------------------------------------------------------------------------------

  /** Texte reçu : retours à la ligne normalisés, espaces autour retirés, au plus `max` caractères ('' si absent). */
  function cleanBody(raw, { max, field }) {
    if (raw === undefined || raw === null) return '';
    if (typeof raw !== 'string') throw new HttpError(400, 'invalid_input', { field });
    const text = raw.replace(/\r\n?/g, '\n').normalize('NFC').trim().replace(/\n{3,}/g, '\n\n');
    if ([...text].length > max) throw new HttpError(400, 'invalid_input', { field, max });
    return text;
  }

  /** Élément cité par un post : { type, id, ownerId } ou null ; 404 unknown_item s'il n'existe pas (ou plus) pour l'auteur. */
  function checkItem(viewer, raw) {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'invalid_input', { field: 'item' });
    const type = validate.oneOf(raw.type, ITEM_TYPES, { field: 'item' });
    if (type === 'album' || type === 'track' || type === 'artist') {
      const id = validate.id(raw.id);
      const found = id && (type === 'album' ? catalog.album(id) : type === 'track' ? catalog.track(id) : catalog.artist(id));
      if (!found) throw new HttpError(404, 'unknown_item');
      return { type, id, ownerId: null };
    }
    try {
      const t = readTarget(viewer, type, raw.id);
      if (t.hidden) throw notFound();
      return { type, id: String(t.id), ownerId: t.ownerId };
    } catch (err) {
      if (err?.status === 404) throw new HttpError(404, 'unknown_item');
      throw err;
    }
  }

  /** Moyennes des albums et morceaux cités (rating_stats) : Map « type:id » → { average, count }. */
  function itemStatsOf(rows) {
    const out = new Map();
    for (const type of ['album', 'track']) {
      const ids = [...new Set(rows.filter((r) => r.item_type === type).map((r) => r.item_id))];
      if (!ids.length) continue;
      for (const s of q('SELECT item_id, count, sum FROM rating_stats WHERE item_type = ? AND item_id IN (SELECT value FROM json_each(?))').all(type, json(ids))) {
        if (s.count) out.set(`${type}:${s.item_id}`, { average: s.sum / s.count, count: s.count });
      }
    }
    return out;
  }

  /**
   * Lignes de posts → Post, pour `viewer` : auteurs, « J'aime », critiques et listes citées, moyennes des éléments, en
   * requêtes groupées. Les posts illisibles (masqués, amis seulement, blocages) sont retirés. `refs` : collecteur.
   */
  function hydratePosts(viewerArg, rows, refs = collector()) {
    const viewer = asViewer(viewerArg);
    const kept = rows.filter((r) => r && canRead(viewer, r.user_id, r.visibility) && (!r.hidden_at || r.user_id === viewer.id));
    if (!kept.length) return [];
    const users = services.userSummaries(kept.map((r) => r.user_id), viewer.id, { hidden: viewer.hidden });
    const liked = likedAmong(viewer.id, 'post', kept.map((r) => r.id));
    const reviewIds = kept.filter((r) => r.item_type === 'review').map((r) => Number(r.item_id));
    const reviews = reviewIds.length ? deps.ratings?.reviewsByIds?.(viewer.id, reviewIds, { hidden: viewer.hidden }) ?? new Map() : new Map();
    const lists = listSummaries(viewer, kept.filter((r) => r.item_type === 'list').map((r) => Number(r.item_id)), refs);
    const stats = itemStatsOf(kept);
    const items = [];
    for (const r of kept) {
      const user = users.get(r.user_id);
      if (!user) continue;
      const post = {
        id: r.id,
        user,
        body: r.body,
        item: r.item_type ? { type: r.item_type, id: r.item_id } : null,
        visibility: r.visibility,
        likeCount: r.like_count,
        commentCount: r.comment_count,
        liked: liked.has(r.id),
        createdAt: r.created_at,
        editedAt: r.edited_at,
        mine: r.user_id === viewer.id,
        ...(r.hidden_at ? { moderated: true } : {}),
      };
      if (r.item_type === 'review') {
        const review = reviews.get(Number(r.item_id));
        if (review) {
          post.review = review;
          refs.item(review.item?.type, review.item?.id);
          refs.users([review.user]);
        }
      } else if (r.item_type === 'list') {
        const list = lists.get(Number(r.item_id));
        if (list) post.list = list;
      } else if (r.item_type) {
        refs.item(r.item_type, r.item_id);
        const s = stats.get(`${r.item_type}:${r.item_id}`);
        if (s) post.itemStats = s;
      }
      items.push(post);
    }
    refs.users(users.values());
    return items;
  }

  const POST_COLS = 'id, user_id, body, item_type, item_id, visibility, like_count, comment_count, created_at, edited_at, hidden_at';

  /** Posts par identifiants (fil, permaliens) : Map id → Post lisible par `viewer`. */
  function postsByIds(viewerArg, ids, refs = collector()) {
    const wanted = [...new Set(ids.map(Number))].filter((x) => Number.isInteger(x) && x > 0);
    if (!wanted.length) return new Map();
    const rows = q(`SELECT ${POST_COLS} FROM posts WHERE id IN (SELECT value FROM json_each(?))`).all(json(wanted));
    return new Map(hydratePosts(viewerArg, rows, refs).map((p) => [p.id, p]));
  }

  /** Joueurs cités (@pseudo) qui peuvent lire un contenu (`canSeeIt(id)`), sauf l'auteur. */
  function mentionedUsers(text, authorId, canSeeIt) {
    const names = mentionsOf(text);
    if (!names.length) return [];
    return q('SELECT id FROM users WHERE username IN (SELECT value FROM json_each(?)) AND email_verified_at IS NOT NULL')
      .all(json(names)).map((r) => r.id).filter((id) => id !== authorId && canSeeIt(id));
  }

  /** Élément noté d'une critique (titre et vignette des notifications). */
  function reviewItemData(ratingId) {
    const r = q('SELECT item_type, item_id FROM ratings WHERE id = ?').get(ratingId);
    return r ? { itemType: r.item_type, itemId: r.item_id } : {};
  }

  /** POST /api/posts : nouveau post (texte et / ou élément cité). Renvoie { post, catalog }. */
  function createPost(user, body = {}, ip = null) {
    access().assertActive?.(user);
    const viewer = viewerOf(user.id);
    let text = cleanBody(body.body, { max: POST_MAX, field: 'body' });
    const item = checkItem(viewer, body.item);
    const visibility = validate.oneOf(body.visibility, VISIBILITIES, { optional: true, fallback: 'public', field: 'visibility' });
    if (!text && !item) throw new HttpError(400, 'post_empty');
    deps.quota(user.id, 'posts');
    if (text) {
      const policed = access().linkPolicy?.(text, user);
      if (typeof policed === 'string') text = policed.trim();
      if (!text && !item) throw new HttpError(400, 'post_empty');
    }
    const now = Date.now();
    // Même texte (ou même élément sans texte) déjà posté dans les dernières 24 h : refusé (anti-spam, PLAN.md 7.2).
    const dup = text
      ? q('SELECT 1 FROM posts WHERE user_id = ? AND created_at >= ? AND body = ? LIMIT 1').get(user.id, now - DAY, text)
      : q("SELECT 1 FROM posts WHERE user_id = ? AND created_at >= ? AND body = '' AND item_type = ? AND item_id = ? LIMIT 1")
        .get(user.id, now - DAY, item.type, item.id);
    if (dup) throw new HttpError(409, 'duplicate_post');
    const row = q(`INSERT INTO posts (user_id, body, item_type, item_id, visibility, created_at, created_ip)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${POST_COLS}`)
      .get(user.id, text, item?.type ?? null, item?.id ?? null, visibility, now, ip);
    deps.bus.emit('post.created', {
      id: row.id, userId: user.id, body: text, itemType: row.item_type, itemId: row.item_id, visibility, createdAt: now, ownerId: item?.ownerId ?? null,
    });
    // Notifications : l'auteur de la critique ou de la liste partagée, puis les joueurs cités (@pseudo).
    const canSeePost = (uid) => (access().canSee ? access().canSee(uid, user.id, visibility) : visibility === 'public');
    const data = { postId: row.id, ...itemDataOf({ type: 'post', row }) };
    const notified = new Set([user.id]);
    if (item?.ownerId && !notified.has(item.ownerId) && canSeePost(item.ownerId)) {
      notified.add(item.ownerId);
      deps.notify?.(item.ownerId, `mention_${item.type}`, {
        actorId: user.id, targetType: 'post', targetId: row.id, groupKey: `mention:${item.type}:${item.id}`,
        data: { ...data, ...(item.type === 'review' ? reviewItemData(Number(item.id)) : {}) },
      });
    }
    for (const uid of mentionedUsers(text, user.id, canSeePost)) {
      if (notified.has(uid)) continue;
      notified.add(uid);
      deps.notify?.(uid, 'mention_post', { actorId: user.id, targetType: 'post', targetId: row.id, groupKey: `mention:post:${row.id}`, data });
    }
    const refs = collector();
    const [post] = hydratePosts(viewer, [row], refs);
    return { post, catalog: refs.build() };
  }

  /** GET /api/posts/:id : le post et la première page de ses commentaires. */
  function getPost(viewerId, rawId, query = {}) {
    const viewer = viewerOf(viewerId);
    const target = readTarget(viewer, 'post', rawId);
    const refs = collector();
    const post = postsByIds(viewer, [target.id], refs).get(target.id);
    if (!post) throw notFound();
    const comments = commentsPage(viewer, target, query, refs);
    return { post, comments, catalog: refs.build() };
  }

  /** PATCH /api/posts/:id (auteur) : nouveau texte ; edited_at posé. */
  function editPost(user, rawId, body = {}) {
    const id = toId(rawId);
    const row = id && q(`SELECT ${POST_COLS} FROM posts WHERE id = ?`).get(id);
    if (!row || row.user_id !== user.id) throw notFound();
    access().assertActive?.(user);
    let text = cleanBody(body.body, { max: POST_MAX, field: 'body' });
    if (text) {
      const policed = access().linkPolicy?.(text, user);
      if (typeof policed === 'string') text = policed.trim();
    }
    if (!text && !row.item_type) throw new HttpError(400, 'post_empty');
    if (text !== row.body) q('UPDATE posts SET body = ?, edited_at = ? WHERE id = ?').run(text, Date.now(), id);
    const refs = collector();
    const post = postsByIds(viewerOf(user.id), [id], refs).get(id);
    return { post, catalog: refs.build() };
  }

  /** DELETE /api/posts/:id (auteur) : supprimé avec tout ce qui s'y accroche (purgeTarget). */
  function deletePost(user, rawId) {
    const id = toId(rawId);
    const row = id && q('SELECT id, user_id FROM posts WHERE id = ?').get(id);
    if (!row || row.user_id !== user.id) throw notFound();
    atomic(() => {
      deps.moderation?.purgeTarget?.('post', id);
      q('DELETE FROM posts WHERE id = ?').run(id);
    });
    deps.bus.emit('content.removed', { targetType: 'post', targetId: id, by: 'author' });
    return { ok: true };
  }

  /** Joueur affiché (vérifié, pas bloqué), sinon 404 user_not_found. */
  function targetUser(viewer, username) {
    const target = q('SELECT id, username, profile_visibility FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(String(username || ''));
    if (!target || (target.id !== viewer.id && viewer.hidden.has(target.id))) throw new HttpError(404, 'user_not_found');
    return target;
  }

  /**
   * GET /api/users/:username/posts (onglet Posts du Studio) : posts du joueur lisibles par celui qui regarde, les plus
   * récents d'abord (curseur [created_at, id], index posts_user). Studio « amis » ou « privé » : rien pour les autres
   * (`restricted: true`).
   */
  function userPosts(viewerId, username, query = {}) {
    const viewer = viewerOf(viewerId);
    const target = targetUser(viewer, username);
    const self = target.id === viewer.id;
    const friend = !self && viewer.friends.has(target.id);
    const privacy = target.profile_visibility || 'public';
    if (!self && (privacy === 'private' || (privacy === 'friends' && !friend))) return { items: [], nextCursor: null, restricted: true, catalog: deps.refs() };
    const { limit } = paging.pageOf(query, { def: PAGE });
    const after = keyset(query.cursor);
    const filter = self ? '' : friend ? ' AND hidden_at IS NULL' : " AND hidden_at IS NULL AND visibility = 'public'";
    const base = `SELECT ${POST_COLS} FROM posts WHERE user_id = ?${filter}`;
    const rows = after
      ? q(`${base} AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`).all(target.id, after[0], after[1], limit + 1)
      : q(`${base} ORDER BY created_at DESC, id DESC LIMIT ?`).all(target.id, limit + 1);
    const page = paging.keysetPage(rows, limit, (r) => [r.created_at, r.id]);
    const refs = collector();
    return { items: hydratePosts(viewer, page.items, refs), nextCursor: page.nextCursor, catalog: refs.build() };
  }

  /**
   * GET /api/items/:type/:id/posts (« Discussions » d'un album, d'un morceau, d'un artiste) : la première page commence
   * par les posts des amis (5 au plus), puis tout le monde, du plus récent au plus ancien (curseur [created_at, id],
   * index posts_item). Les posts « amis » des autres, masqués ou de joueurs bloqués n'y sont jamais.
   */
  function itemPosts(viewerId, type, rawId, query = {}) {
    const id = validate.id(rawId);
    const exists = id && (type === 'album' ? catalog.album(id) : type === 'track' ? catalog.track(id) : type === 'artist' ? catalog.artist(id) : null);
    if (!exists) throw new HttpError(404, 'unknown_item');
    const viewer = viewerOf(viewerId);
    const { limit } = paging.pageOf(query, { def: 10 });
    const after = keyset(query.cursor);
    const friends = json([...viewer.friends]);
    const top = viewer.friends.size
      ? q(`SELECT ${POST_COLS} FROM posts WHERE item_type = ? AND item_id = ? AND hidden_at IS NULL
          AND user_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC, id DESC LIMIT ?`).all(type, id, friends, DISCUSSION_FRIENDS)
      : [];
    const base = `SELECT ${POST_COLS} FROM posts WHERE item_type = ? AND item_id = ? AND hidden_at IS NULL
      AND user_id NOT IN (SELECT value FROM json_each(?)) AND id NOT IN (SELECT value FROM json_each(?))
      AND (visibility = 'public' OR user_id = ? OR user_id IN (SELECT value FROM json_each(?)))`;
    const args = [type, id, json([...viewer.hidden]), json(top.map((r) => r.id)), viewer.id, friends];
    const rows = after
      ? q(`${base} AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args, after[0], after[1], limit + 1)
      : q(`${base} ORDER BY created_at DESC, id DESC LIMIT ?`).all(...args, limit + 1);
    const page = paging.keysetPage(rows, limit, (r) => [r.created_at, r.id]);
    const refs = collector();
    const items = hydratePosts(viewer, after ? page.items : [...top, ...page.items], refs);
    return { items, nextCursor: page.nextCursor, catalog: refs.build() };
  }

  // ----- commentaires -----------------------------------------------------------------------------

  const COMMENT_COLS = 'id, target_type, target_id, parent_id, user_id, reply_to_user_id, body, like_count, reply_count, created_at, edited_at, deleted_at, hidden_at';

  /** Lignes de commentaires → Comment (auteurs, @nom des réponses, « J'aime ») ; `replies` : Map parent → lignes. */
  function hydrateComments(viewer, rows, refs, replies = new Map()) {
    const all = [...rows, ...[...replies.values()].flat()];
    const users = services.userSummaries(all.flatMap((r) => [r.user_id, r.reply_to_user_id].filter(Boolean)), viewer.id, { hidden: viewer.hidden });
    const liked = likedAmong(viewer.id, 'comment', all.map((r) => r.id));
    refs?.users(users.values());
    const one = (r) => {
      const deleted = !!r.deleted_at;
      const user = deleted ? null : users.get(r.user_id);
      if (!deleted && !user) return null;
      const replyTo = r.reply_to_user_id ? users.get(r.reply_to_user_id) : null;
      return {
        id: r.id,
        user,
        body: deleted ? null : r.body,
        deleted,
        parentId: r.parent_id,
        replyToUser: replyTo ? { id: replyTo.id, username: replyTo.username } : null,
        likeCount: deleted ? 0 : r.like_count,
        liked: liked.has(r.id),
        replyCount: r.reply_count,
        createdAt: r.created_at,
        editedAt: r.edited_at,
        mine: !deleted && r.user_id === viewer.id,
        ...(r.hidden_at ? { moderated: true } : {}),
      };
    };
    return rows.map((r) => {
      const c = one(r);
      if (c && replies.has(r.id)) c.replies = replies.get(r.id).map(one).filter(Boolean);
      return c;
    }).filter(Boolean);
  }

  /**
   * Commentaires de tête d'une cible, les plus anciens d'abord (curseur [created_at, id], index comments_target), chacun
   * avec son nombre de réponses et ses deux premières réponses. `target` : résultat de readTarget (ou { type, id }).
   */
  function commentsPage(viewerArg, target, query = {}, refs = null) {
    const viewer = asViewer(viewerArg);
    const { limit } = paging.pageOf(query, { def: PAGE });
    const after = keyset(query.cursor);
    const hidden = json([...viewer.hidden]);
    const base = `SELECT ${COMMENT_COLS} FROM comments WHERE target_type = ? AND target_id = ? AND parent_id IS NULL
      AND (hidden_at IS NULL OR user_id = ?) AND user_id NOT IN (SELECT value FROM json_each(?))`;
    const rows = after
      ? q(`${base} AND (created_at, id) > (?, ?) ORDER BY created_at, id LIMIT ?`).all(target.type, target.id, viewer.id, hidden, after[0], after[1], limit + 1)
      : q(`${base} ORDER BY created_at, id LIMIT ?`).all(target.type, target.id, viewer.id, hidden, limit + 1);
    const page = paging.keysetPage(rows, limit, (r) => [r.created_at, r.id]);
    const parents = page.items.filter((r) => r.reply_count > 0).map((r) => r.id);
    const replies = new Map();
    if (parents.length) {
      for (const r of q(`SELECT * FROM (SELECT ${COMMENT_COLS}, ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY created_at, id) AS rn
          FROM comments WHERE parent_id IN (SELECT value FROM json_each(?)) AND (hidden_at IS NULL OR user_id = ?)
          AND user_id NOT IN (SELECT value FROM json_each(?))) WHERE rn <= ${REPLIES_PREVIEW} ORDER BY created_at, id`).all(json(parents), viewer.id, hidden)) {
        if (!replies.has(r.parent_id)) replies.set(r.parent_id, []);
        replies.get(r.parent_id).push(r);
      }
    }
    return { items: hydrateComments(viewer, page.items, refs, replies), nextCursor: page.nextCursor };
  }

  /** GET /api/comments?target=post:12 */
  function listComments(viewerId, query = {}) {
    const m = /^(post|review|list):(\d{1,15})$/.exec(String(query.target || ''));
    if (!m) throw new HttpError(400, 'invalid_input', { field: 'target' });
    const viewer = viewerOf(viewerId);
    const target = readTarget(viewer, m[1], m[2]);
    const refs = collector();
    return { ...commentsPage(viewer, target, query, refs), catalog: refs.build() };
  }

  /** GET /api/comments/:id/replies : réponses d'un commentaire de tête, les plus anciennes d'abord. */
  function listReplies(viewerId, rawId, query = {}) {
    const viewer = viewerOf(viewerId);
    const id = toId(rawId);
    const parent = id && q(`SELECT ${COMMENT_COLS} FROM comments WHERE id = ? AND parent_id IS NULL`).get(id);
    if (!parent || (parent.hidden_at && parent.user_id !== viewer.id)) throw notFound();
    readTarget(viewer, parent.target_type, parent.target_id);
    const { limit } = paging.pageOf(query, { def: PAGE });
    const after = keyset(query.cursor);
    const base = `SELECT ${COMMENT_COLS} FROM comments WHERE parent_id = ? AND (hidden_at IS NULL OR user_id = ?)
      AND user_id NOT IN (SELECT value FROM json_each(?))`;
    const hidden = json([...viewer.hidden]);
    const rows = after
      ? q(`${base} AND (created_at, id) > (?, ?) ORDER BY created_at, id LIMIT ?`).all(id, viewer.id, hidden, after[0], after[1], limit + 1)
      : q(`${base} ORDER BY created_at, id LIMIT ?`).all(id, viewer.id, hidden, limit + 1);
    const page = paging.keysetPage(rows, limit, (r) => [r.created_at, r.id]);
    const refs = collector();
    return { items: hydrateComments(viewer, page.items, refs), nextCursor: page.nextCursor, catalog: refs.build() };
  }

  /** Activité du fil : l'engagement d'un post, d'une critique ou d'une liste a changé. */
  const touchFeed = (type, id) => {
    try {
      deps.feed?.refreshEngagement?.(type, id);
    } catch (err) {
      console.error('[social] engagement du fil en erreur :', err);
    }
  };

  /** POST /api/comments : commentaire ou réponse. Renvoie { comment, catalog }. */
  function createComment(user, body = {}, ip = null) {
    access().assertActive?.(user);
    const viewer = viewerOf(user.id);
    const targetType = validate.oneOf(body.targetType, COMMENT_TARGETS, { field: 'targetType' });
    let text = cleanBody(body.body, { max: COMMENT_MAX, field: 'body' });
    if (!text) throw new HttpError(400, 'comment_empty');
    const target = readTarget(viewer, targetType, body.targetId);
    if (target.hidden) throw new HttpError(409, 'thread_locked');
    // Une réponse se rattache au commentaire de tête ; répondre à une réponse garde son auteur (@nom).
    let parent = null;
    let replyTo = null;
    let repliedTo = null;
    if (body.parentId !== undefined && body.parentId !== null) {
      const p = q(`SELECT ${COMMENT_COLS} FROM comments WHERE id = ?`).get(toId(body.parentId));
      if (!p || p.target_type !== targetType || p.target_id !== target.id || p.hidden_at || viewer.hidden.has(p.user_id)) throw notFound();
      if (p.parent_id) {
        if (p.deleted_at) throw notFound();
        parent = q(`SELECT ${COMMENT_COLS} FROM comments WHERE id = ?`).get(p.parent_id);
        if (!parent) throw notFound();
        replyTo = p.user_id === user.id ? null : p.user_id;
        repliedTo = p;
      } else {
        parent = p;
        repliedTo = p.deleted_at ? null : p;
      }
    }
    deps.quota(user.id, 'comments');
    const policed = access().linkPolicy?.(text, user);
    if (typeof policed === 'string') text = policed.trim();
    if (!text) throw new HttpError(400, 'comment_empty');
    const now = Date.now();
    const row = atomic(() => {
      const r = q(`INSERT INTO comments (target_type, target_id, parent_id, user_id, reply_to_user_id, body, created_at, created_ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COMMENT_COLS}`)
        .get(targetType, target.id, parent?.id ?? null, user.id, replyTo, text, now, ip);
      q(`UPDATE ${TABLES[targetType]} SET comment_count = comment_count + 1 WHERE id = ?`).run(target.id);
      if (parent) q('UPDATE comments SET reply_count = reply_count + 1 WHERE id = ?').run(parent.id);
      return r;
    });
    touchFeed(targetType, target.id);
    deps.bus.emit('comment.created', {
      id: row.id, userId: user.id, targetType, targetId: target.id, parentId: row.parent_id, body: text, createdAt: now, ownerId: target.ownerId,
    });
    // Notifications : l'auteur du commentaire auquel on répond (et la personne citée par @nom), le propriétaire de la
    // cible, puis les joueurs cités dans le texte ; chacun une seule fois.
    const data = { commentId: row.id, ...itemDataOf(target) };
    const group = `comment:${targetType}:${target.id}`;
    const base = { actorId: user.id, targetType, targetId: target.id, data };
    const notified = new Set([user.id]);
    for (const uid of [repliedTo?.user_id, replyTo]) {
      if (!uid || notified.has(uid)) continue;
      notified.add(uid);
      deps.notify?.(uid, 'reply_comment', { ...base, groupKey: group });
    }
    if (!notified.has(target.ownerId)) {
      notified.add(target.ownerId);
      deps.notify?.(target.ownerId, `comment_${targetType}`, { ...base, groupKey: group });
    }
    const canSeeTarget = (uid) => (access().canSee ? access().canSee(uid, target.ownerId, target.visibility) : target.visibility === 'public');
    for (const uid of mentionedUsers(text, user.id, canSeeTarget)) {
      if (notified.has(uid)) continue;
      notified.add(uid);
      deps.notify?.(uid, 'mention_comment', { ...base, groupKey: `mention:comment:${targetType}:${target.id}` });
    }
    const refs = collector();
    const [comment] = hydrateComments(viewer, [row], refs);
    return { comment, catalog: refs.build() };
  }

  /** PATCH /api/comments/:id (auteur) : nouveau texte. */
  function editComment(user, rawId, body = {}) {
    const id = toId(rawId);
    const row = id && q(`SELECT ${COMMENT_COLS} FROM comments WHERE id = ?`).get(id);
    if (!row || row.user_id !== user.id || row.deleted_at) throw notFound();
    access().assertActive?.(user);
    let text = cleanBody(body.body, { max: COMMENT_MAX, field: 'body' });
    if (text) {
      const policed = access().linkPolicy?.(text, user);
      if (typeof policed === 'string') text = policed.trim();
    }
    if (!text) throw new HttpError(400, 'comment_empty');
    if (text !== row.body) q('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(text, Date.now(), id);
    const refs = collector();
    const fresh = q(`SELECT ${COMMENT_COLS} FROM comments WHERE id = ?`).get(id);
    const [comment] = hydrateComments(viewerOf(user.id), [fresh], refs);
    return { comment, catalog: refs.build() };
  }

  /**
   * DELETE /api/comments/:id : par son auteur ou par le propriétaire de la cible. Sans réponse, il disparaît ; avec des
   * réponses, il reste vidé (« Commentaire supprimé »). Ses mentions « J'aime » et ses notifications partent avec lui.
   */
  function deleteComment(user, rawId) {
    const id = toId(rawId);
    const row = id && q(`SELECT ${COMMENT_COLS} FROM comments WHERE id = ?`).get(id);
    if (!row || row.deleted_at) throw notFound();
    const owner = q(`SELECT user_id FROM ${TABLES[row.target_type]} WHERE id = ?`).get(row.target_id)?.user_id;
    if (row.user_id !== user.id && owner !== user.id) throw notFound();
    atomic(() => {
      const hasReplies = !row.parent_id && !!q('SELECT 1 FROM comments WHERE parent_id = ? LIMIT 1').get(id);
      if (hasReplies) {
        q('UPDATE comments SET deleted_at = ?, body = ?, edited_at = NULL, like_count = 0, hidden_at = NULL WHERE id = ?').run(Date.now(), DELETED_BODY, id);
      } else {
        q('DELETE FROM comments WHERE id = ?').run(id);
        if (row.parent_id) {
          q('UPDATE comments SET reply_count = MAX(reply_count - 1, 0) WHERE id = ?').run(row.parent_id);
          // Commentaire de tête déjà supprimé dont la dernière réponse part : il disparaît aussi.
          q('DELETE FROM comments WHERE id = ? AND deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM comments WHERE parent_id = ?)').run(row.parent_id, row.parent_id);
        }
      }
      q(`UPDATE ${TABLES[row.target_type]} SET comment_count = MAX(comment_count - 1, 0) WHERE id = ?`).run(row.target_id);
      // Notifications de ce commentaire (réponse, mention, « J'aime ») : leur cible est le fil, le commentaire est dans data.
      q(`DELETE FROM notifications WHERE actor_id = ? AND target_type = ? AND target_id = ? AND json_extract(data, '$.commentId') = ?`)
        .run(row.user_id, row.target_type, String(row.target_id), id);
      q(`DELETE FROM notifications WHERE user_id = ? AND kind = 'like_comment' AND json_extract(data, '$.commentId') = ?`).run(row.user_id, id);
      deps.moderation?.purgeTarget?.('comment', id);
    });
    touchFeed(row.target_type, row.target_id);
    deps.bus.emit('content.removed', { targetType: 'comment', targetId: id, by: row.user_id === user.id ? 'author' : 'owner' });
    return { ok: true };
  }

  // ----- mentions « J'aime » ----------------------------------------------------------------------

  /** PUT / DELETE /api/likes/:type/:id : idempotent ; renvoie { liked, likeCount }. */
  function setLike(user, type, rawId, on) {
    if (!LIKE_TARGETS.includes(type)) throw notFound();
    access().assertActive?.(user);
    const viewer = viewerOf(user.id);
    const target = readTarget(viewer, type, rawId);
    if (target.hidden) throw notFound();
    const table = TABLES[type];
    const changed = atomic(() => {
      const n = on
        ? q('INSERT OR IGNORE INTO likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)').run(user.id, type, target.id, Date.now()).changes
        : q('DELETE FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?').run(user.id, type, target.id).changes;
      if (n) q(`UPDATE ${table} SET like_count = MAX(like_count ${on ? '+' : '-'} 1, 0) WHERE id = ?`).run(target.id);
      return n > 0;
    });
    const likeCount = q(`SELECT like_count FROM ${table} WHERE id = ?`).get(target.id)?.like_count ?? 0;
    if (changed) {
      if (type !== 'comment') touchFeed(type, target.id);
      // Un commentaire se lit dans son fil : la notification mène au fil, le commentaire est dans data.
      const root = target.root || target;
      const groupKey = `like:${type}:${target.id}`;
      if (on) {
        deps.notify?.(target.ownerId, `like_${type}`, {
          actorId: user.id, targetType: root.type, targetId: root.id, groupKey,
          data: { ...itemDataOf(target), ...(type === 'comment' ? { commentId: target.id } : {}) },
        });
        deps.bus.emit('like.created', { userId: user.id, targetType: type, targetId: target.id, ownerId: target.ownerId });
      } else {
        // « J'aime » retiré : sa notification pas encore lue part aussi (pas de bruit en cliquant deux fois).
        q('DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND group_key = ? AND read_at IS NULL').run(target.ownerId, user.id, groupKey);
      }
    }
    return { liked: on, likeCount };
  }

  /**
   * GET /api/likes/:type/:id : qui a aimé, les amis d'abord puis les autres, les plus récents d'abord. Curseur
   * [phase (0 amis, 1 autres), created_at, user_id].
   */
  function likers(viewerId, type, rawId, query = {}) {
    if (!LIKE_TARGETS.includes(type)) throw notFound();
    const viewer = viewerOf(viewerId);
    const target = readTarget(viewer, type, rawId);
    const limit = paging.limitOf(query.limit, { def: PAGE });
    const cursor = paging.decodeCursor(query.cursor, { length: 3 });
    if (cursor && !((cursor[0] === 0 || cursor[0] === 1) && Number.isFinite(cursor[1]) && Number.isInteger(cursor[2]))) {
      throw new HttpError(400, 'invalid_input', { field: 'cursor' });
    }
    const lists = [json([...viewer.friends]), json([...viewer.friends, ...viewer.hidden])];
    const filters = ['user_id IN (SELECT value FROM json_each(?))', 'user_id NOT IN (SELECT value FROM json_each(?))'];
    const rows = [];
    for (let phase = cursor ? cursor[0] : 0; phase < 2 && rows.length <= limit; phase++) {
      const after = cursor && cursor[0] === phase ? cursor : null;
      const base = `SELECT user_id, created_at, ${phase} AS phase FROM likes WHERE target_type = ? AND target_id = ? AND ${filters[phase]}`;
      const take = limit + 1 - rows.length;
      rows.push(...(after
        ? q(`${base} AND (created_at, user_id) < (?, ?) ORDER BY created_at DESC, user_id DESC LIMIT ?`).all(type, target.id, lists[phase], after[1], after[2], take)
        : q(`${base} ORDER BY created_at DESC, user_id DESC LIMIT ?`).all(type, target.id, lists[phase], take)));
    }
    const page = rows.slice(0, limit);
    const users = services.userSummaries(page.map((r) => r.user_id), viewer.id, { hidden: viewer.hidden });
    const last = page[page.length - 1];
    return {
      items: page.map((r) => users.get(r.user_id)).filter(Boolean),
      nextCursor: rows.length > limit && last ? paging.encodeCursor([last.phase, last.created_at, last.user_id]) : null,
      catalog: deps.refs({ albumIds: services.summaryAlbums(users.values()) }),
    };
  }

  // ----- permalien d'une critique -------------------------------------------------------------------

  /** GET /api/reviews/:id : { review, item: { type, id }, comments: { items, nextCursor }, catalog }. */
  function reviewPage(viewerId, rawId, query = {}) {
    const viewer = viewerOf(viewerId);
    const target = readTarget(viewer, 'review', rawId);
    const review = deps.ratings?.reviewsByIds?.(viewer.id, [target.id], { hidden: viewer.hidden })?.get(target.id);
    if (!review) throw notFound();
    const refs = collector();
    refs.item(target.row.item_type, target.row.item_id);
    refs.users([review.user]);
    const comments = commentsPage(viewer, target, query, refs);
    return { review, item: { type: target.row.item_type, id: target.row.item_id }, comments, catalog: refs.build() };
  }

  return {
    readTarget, likedAmong, hydratePosts, postsByIds, commentsPage, listSummaries, collector, viewerOf,
    createPost, getPost, editPost, deletePost, userPosts, itemPosts,
    listComments, listReplies, createComment, editComment, deleteComment, setLike, likers, reviewPage,
  };
}

export function routes(r, deps) {
  const { limits } = deps;
  const api = () => deps.social;

  r.post('/posts', limits.write, (req, res) => res.status(201).json(api().createPost(req.user, req.body, req.ip)));
  r.get('/posts/:id', limits.read, (req, res) => res.json(api().getPost(req.user.id, req.params.id, req.query)));
  r.patch('/posts/:id', limits.write, (req, res) => res.json(api().editPost(req.user, req.params.id, req.body)));
  r.delete('/posts/:id', limits.write, (req, res) => res.json(api().deletePost(req.user, req.params.id)));
  r.get('/users/:username/posts', limits.read, (req, res) => res.json(api().userPosts(req.user.id, req.params.username, req.query)));
  r.get('/items/:type/:id/posts', limits.read, (req, res) => res.json(api().itemPosts(req.user.id, req.params.type, req.params.id, req.query)));

  r.get('/comments', limits.read, (req, res) => res.json(api().listComments(req.user.id, req.query)));
  r.get('/comments/:id/replies', limits.read, (req, res) => res.json(api().listReplies(req.user.id, req.params.id, req.query)));
  r.post('/comments', limits.write, (req, res) => res.status(201).json(api().createComment(req.user, req.body, req.ip)));
  r.patch('/comments/:id', limits.write, (req, res) => res.json(api().editComment(req.user, req.params.id, req.body)));
  r.delete('/comments/:id', limits.write, (req, res) => res.json(api().deleteComment(req.user, req.params.id)));

  r.put('/likes/:targetType/:targetId', limits.write, (req, res) => res.json(api().setLike(req.user, req.params.targetType, req.params.targetId, true)));
  r.delete('/likes/:targetType/:targetId', limits.write, (req, res) => res.json(api().setLike(req.user, req.params.targetType, req.params.targetId, false)));
  r.get('/likes/:targetType/:targetId', limits.read, (req, res) => res.json(api().likers(req.user.id, req.params.targetType, req.params.targetId, req.query)));

  r.get('/reviews/:id', limits.read, (req, res) => res.json(api().reviewPage(req.user.id, req.params.id, req.query)));
}
