// Module « feed » : fil d'actualité, amis d'abord et explicable (PLAN.md 4.2.2, 5.2). Chantier : P1-A.
//
// Écriture : les abonnés du bus remplissent `activity` (une ligne par événement à partager). Les événements d'un même
// jour s'agrègent sur une seule ligne (`group_key`, index unique activity_group) : « a noté 5 albums aujourd'hui »,
// « a obtenu 2 légendaires ». `created_at` est l'instant du dernier événement de la ligne (clé de tri du fil, index
// activity_actor et activity_recent) : une ligne agrégée remonte quand elle grossit. Studio « privé » : les lignes de jeu
// (notes, critiques, albums complétés…) sont écrites `private` et relues selon la confidentialité du moment ; un post
// garde sa propre visibilité.
//
// Lecture (GET /api/feed?tab=friends|foryou|community&cursor=) :
// - Tes amis : activité des amis et la sienne, par curseur [created_at, id] ; le score ne réordonne qu'à l'intérieur de
//   chaque page (pagination stable). Onglet par défaut quand un ami a été actif dans les 14 derniers jours ;
// - Pour toi : activité publique des 7 derniers jours de joueurs hors amis dont l'album ou l'artiste correspond à tes
//   goûts (tes 3 genres, tes artistes favoris ou les 60 que tu collectionnes le plus), plus les critiques ≥ 8/10 de tes
//   amis sur des albums que tu n'as pas notés ; 200 candidats classés, gardés 5 minutes (curseur [décalage]) ;
// - Communauté : activité publique de tout le monde sur 7 jours, 200 candidats classés.
// Score (affiché comme raison : « Ami », « Proche de tes goûts », « Populaire ») :
//   0.5^(âge en heures / 36) × (1 + affinité + engagement + bonus du type) ; affinité 1 pour un ami, 0.5 pour un Taste
//   Match en cache ≥ 70 ; engagement = min(1, log10(1 + j'aime + 2 × commentaires) / 2) ; jamais plus de 2 éléments
//   d'affilée du même joueur. Les joueurs bloqués sont retirés avant le score ; l'hydratation est groupée.
// FeedItem = { id, verb, actor, object, item?, groupCount, data, post?, review?, list?, likeCount, commentCount, liked,
//              reason, createdAt, updatedAt }.
// API interne (deps.feed) : refreshEngagement(type, id), record(...), backfill(), feed(viewerId, query),
// userActivity(viewerId, username, query).
export const name = 'feed';

export const TABS = ['friends', 'foryou', 'community'];
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Éléments gardés dans une ligne agrégée (« a noté 5 albums » : les 12 derniers). */
const GROUP_ITEMS = 12;
const RECENT_MS = 7 * DAY;
const FRIENDS_ACTIVE_MS = 14 * DAY;
const FRIEND_REVIEWS_MS = 30 * DAY;
/** Candidats classés des onglets Pour toi et Communauté ; activité récente lue au plus pour Pour toi. */
const RANKED_CAP = 200;
const FORYOU_SCAN = 1000;
const RETENTION_MS = 180 * DAY;
const BACKFILL_MS = 30 * DAY;
/** Bonus par type d'activité (PLAN.md 5.2). */
const KIND_BOOST = { complete: 0.4, review: 0.3, post: 0.3, master: 0.3, deluxe: 0.3, list: 0.2, grid: 0.2, badge: 0.2, set: 0.2, pull: 0.1, rate: 0, friend: 0 };
/** Types d'activité qui suivent la confidentialité du Studio (les posts et les listes ont leur propre visibilité). */
const STUDIO_VERBS = new Set(['review', 'rate', 'complete', 'deluxe', 'master', 'badge', 'pull', 'grid', 'friend', 'set']);
/** Badges qui passent dans le fil : or, platine (et la toute première médaille). */
const FEED_TIERS = new Set(['gold', 'platinum']);

const ACT_COLS = 'id, actor_id, verb, object_type, object_id, item_type, item_id, group_key, data, visibility, engagement, created_at, updated_at';

function parse(text, fallback = {}) {
  if (typeof text !== 'string') return fallback;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Score d'une activité (PLAN.md 5.2). */
export function scoreOf({ ageHours, affinity = 0, engagement = 0, verb }) {
  const eng = Math.min(1, Math.log10(1 + Math.max(0, engagement)) / 2);
  return 0.5 ** (Math.max(0, ageHours) / 36) * (1 + affinity + eng + (KIND_BOOST[verb] ?? 0));
}

/** Jamais plus de 2 éléments d'affilée du même joueur : l'ordre du score est gardé autant que possible. */
export function diversify(items, actorOf = (x) => x.actorId) {
  const pool = [...items];
  const out = [];
  while (pool.length) {
    const a = out.length >= 2 ? actorOf(out[out.length - 1]) : null;
    const b = out.length >= 2 ? actorOf(out[out.length - 2]) : null;
    let i = a != null && a === b ? pool.findIndex((x) => actorOf(x) !== a) : 0;
    if (i < 0) i = 0;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

export function init(deps) {
  const { db, catalog, services, paging, periods, HttpError } = deps;
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
  const access = () => deps.access || {};
  const atomic = (fn) => (db.isTransaction ? fn() : deps.tx(fn));
  // Classements des onglets Pour toi / Communauté (5 min par joueur), goûts d'un joueur (10 min).
  const rankedCache = deps.lru({ max: 2000, ttlMs: 5 * 60_000 });
  const tasteCache = deps.lru({ max: 2000, ttlMs: 10 * 60_000 });

  // ----- écriture -------------------------------------------------------------------------------

  /** Visibilité d'une ligne de jeu selon la confidentialité du Studio de son auteur. */
  function studioVisibility(userId, fallback = 'public') {
    const privacy = q('SELECT profile_visibility FROM users WHERE id = ?').get(userId)?.profile_visibility;
    if (privacy === 'private') return 'private';
    if (privacy === 'friends' && fallback === 'public') return 'friends';
    return fallback;
  }

  /**
   * Écrit une activité. Avec `groupKey`, la ligne du même joueur et du même groupe est mise à jour (`merge(data)` →
   * nouvelles données) et remonte en tête du fil ; sinon une nouvelle ligne est ajoutée. Renvoie l'identifiant (ou null).
   */
  function record({ actorId, verb, objectType, objectId, itemType = null, itemId = null, visibility = 'public', groupKey = null, data = null, merge = null, at = Date.now() }) {
    return atomic(() => {
      if (groupKey) {
        const existing = q('SELECT id, data FROM activity WHERE actor_id = ? AND group_key = ?').get(actorId, groupKey);
        if (existing) {
          const next = merge ? merge(parse(existing.data)) : data;
          if (!next) {
            q('DELETE FROM activity WHERE id = ?').run(existing.id);
            return null;
          }
          q(`UPDATE activity SET object_type = ?, object_id = ?, item_type = ?, item_id = ?, data = ?, visibility = ?, created_at = ?, updated_at = ?
            WHERE id = ?`).run(objectType, String(objectId), itemType, itemId, json(next), visibility, at, at, existing.id);
          return existing.id;
        }
        const first = merge ? merge({}) : data;
        if (!first) return null;
        data = first;
      }
      return q(`INSERT INTO activity (actor_id, verb, object_type, object_id, item_type, item_id, group_key, data, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
        .get(actorId, verb, objectType, String(objectId), itemType, itemId, groupKey, data == null ? null : json(data), visibility, at, at).id;
    });
  }

  const exists = (actorId, verb, objectType, objectId) => !!q('SELECT 1 FROM activity WHERE actor_id = ? AND verb = ? AND object_type = ? AND object_id = ? LIMIT 1')
    .get(actorId, verb, objectType, String(objectId));
  const dayGroup = (kind, userId, at = Date.now()) => `${kind}:${userId}:${periods.dayKey(at)}`;

  /** Ajoute (ou retire, `remove`) un élément d'une ligne agrégée du jour : { items: [≤ 12, le plus récent d'abord], count }. */
  function addToGroup(data, entry, sameAs) {
    const items = (Array.isArray(data.items) ? data.items : []).filter((x) => !sameAs(x));
    const already = (data.items || []).length !== items.length;
    return { ...data, items: [entry, ...items].slice(0, GROUP_ITEMS), count: Math.max(1, (data.count || 0) + (already ? 0 : 1)) };
  }

  /** Engagement d'un post, d'une critique ou d'une liste (j'aime + 2 × commentaires), recopié sur ses activités. */
  function refreshEngagement(type, id) {
    const table = { post: 'posts', review: 'ratings', list: 'lists' }[type];
    if (!table) return;
    q(`UPDATE activity SET engagement = COALESCE((SELECT like_count + 2 * comment_count FROM ${table} WHERE id = ?), 0)
      WHERE object_type = ? AND object_id = ?`).run(Number(id), type, String(id));
  }

  const on = (event, fn) => deps.bus.on(event, fn);

  on('post.created', ({ id, userId, itemType, itemId, visibility, createdAt }) => {
    const catalogItem = ['album', 'track', 'artist'].includes(itemType);
    record({
      actorId: userId, verb: 'post', objectType: 'post', objectId: id, itemType: catalogItem ? itemType : null, itemId: catalogItem ? itemId : null,
      visibility: visibility === 'friends' ? 'friends' : 'public', at: createdAt,
    });
  });

  on('rating.saved', ({ userId, ratingId, itemType, itemId, score, isNew, hasReview, reviewChanged }) => {
    const now = Date.now();
    const visibility = studioVisibility(userId);
    const sameItem = (x) => x.type === itemType && x.id === itemId;
    if (hasReview && reviewChanged) {
      // Nouvelle critique : une ligne à elle ; un texte modifié ne remonte pas dans le fil.
      if (exists(userId, 'review', 'review', ratingId)) {
        q("UPDATE activity SET updated_at = ? WHERE object_type = 'review' AND object_id = ?").run(now, String(ratingId));
      } else {
        record({ actorId: userId, verb: 'review', objectType: 'review', objectId: ratingId, itemType, itemId, visibility, at: now });
        // La note du jour devient une critique : elle quitte la ligne « a noté ».
        record({
          actorId: userId, verb: 'rate', objectType: itemType, objectId: itemId, itemType, itemId, visibility, groupKey: dayGroup('rate', userId, now),
          merge: (d) => {
            if (!d.items) return null;
            const items = d.items.filter((x) => !sameItem(x));
            return items.length === d.items.length ? d : items.length ? { ...d, items, count: Math.max(1, (d.count || 1) - 1) } : null;
          },
        });
      }
      return;
    }
    if (hasReview) return;
    if (!isNew) {
      // Note changée : mise à jour dans la ligne du jour si elle y est (sans la faire remonter).
      const row = q('SELECT id, data FROM activity WHERE actor_id = ? AND group_key = ?').get(userId, dayGroup('rate', userId, now));
      const d = parse(row?.data);
      if (row && d.items?.some(sameItem)) {
        q('UPDATE activity SET data = ? WHERE id = ?').run(json({ ...d, items: d.items.map((x) => (sameItem(x) ? { ...x, score } : x)) }), row.id);
      }
      return;
    }
    record({
      actorId: userId, verb: 'rate', objectType: itemType, objectId: itemId, itemType, itemId, visibility, groupKey: dayGroup('rate', userId, now), at: now,
      merge: (d) => addToGroup(d, { type: itemType, id: itemId, score }, sameItem),
    });
  });

  on('rating.deleted', ({ userId, itemType, itemId }) => {
    const row = q('SELECT id, data FROM activity WHERE actor_id = ? AND group_key = ?').get(userId, dayGroup('rate', userId));
    const d = parse(row?.data);
    if (!row || !d.items?.some((x) => x.type === itemType && x.id === itemId)) return;
    const items = d.items.filter((x) => !(x.type === itemType && x.id === itemId));
    if (!items.length) q('DELETE FROM activity WHERE id = ?').run(row.id);
    else q('UPDATE activity SET data = ? WHERE id = ?').run(json({ ...d, items, count: Math.max(items.length, (d.count || 1) - 1) }), row.id);
  });

  on('album.completed', ({ userId, albumId, rank, at }) => {
    if (exists(userId, 'complete', 'album', albumId)) return;
    record({ actorId: userId, verb: 'complete', objectType: 'album', objectId: albumId, itemType: 'album', itemId: albumId, visibility: studioVisibility(userId), data: { rank: rank ?? null }, at: at || Date.now() });
  });

  on('artist.mastered', ({ userId, artistId, at }) => {
    if (exists(userId, 'master', 'artist', artistId)) return;
    record({ actorId: userId, verb: 'master', objectType: 'artist', objectId: artistId, itemType: 'artist', itemId: artistId, visibility: studioVisibility(userId), at: at || Date.now() });
  });

  on('cards.added', ({ userId, cards = [] }) => {
    const rare = cards.filter((c) => c.newTrack && (c.rarity === 'legendary' || c.rarity === 'promo'));
    if (!rare.length) return;
    const now = Date.now();
    const last = rare[rare.length - 1];
    record({
      actorId: userId, verb: 'pull', objectType: 'track', objectId: last.trackId, itemType: 'track', itemId: last.trackId, visibility: studioVisibility(userId),
      groupKey: dayGroup('pull', userId, now), at: now,
      merge: (d) => rare.reduce((acc, c) => addToGroup(acc, { trackId: c.trackId, rarity: c.rarity, variant: c.variant }, (x) => x.trackId === c.trackId), d),
    });
  });

  on('badge.earned', ({ userId, key, family, tier }) => {
    const first = q("SELECT COUNT(*) AS n FROM (SELECT 1 FROM achievements WHERE user_id = ? AND key >= 'badge:' AND key < 'badge;' LIMIT 2)").get(userId).n <= 1;
    if (!FEED_TIERS.has(tier) && !first) return;
    if (exists(userId, 'badge', 'badge', key)) return;
    record({ actorId: userId, verb: 'badge', objectType: 'badge', objectId: key, visibility: studioVisibility(userId), data: { family: family ?? null, tier: tier ?? null, first } });
  });

  on('list.saved', ({ listId, userId, kind, visibility, itemCount }) => {
    if (kind === 'wishlist') return;
    if (visibility === 'private' || !itemCount) {
      // Liste repassée en privée (ou vidée) : elle sort du fil.
      q("DELETE FROM activity WHERE object_type = 'list' AND object_id = ?").run(String(listId));
      return;
    }
    const vis = visibility === 'friends' ? 'friends' : 'public';
    q("UPDATE activity SET visibility = ? WHERE object_type = 'list' AND object_id = ?").run(kind === 'grid9' ? studioVisibility(userId, vis) : vis, String(listId));
    if (kind === 'grid9') {
      record({
        actorId: userId, verb: 'grid', objectType: 'list', objectId: listId, visibility: studioVisibility(userId, vis), groupKey: `grid:${userId}`,
        merge: (d) => ({ ...d, itemCount }),
      });
      return;
    }
    // Première publication, ou au moins 3 éléments de plus depuis la dernière fois qu'elle est passée dans le fil.
    const last = q("SELECT data FROM activity WHERE object_type = 'list' AND object_id = ? ORDER BY created_at DESC LIMIT 1").get(String(listId));
    const before = last ? Number(parse(last.data).itemCount) || 0 : null;
    if (before !== null && itemCount - before < 3) return;
    record({
      actorId: userId, verb: 'list', objectType: 'list', objectId: listId, visibility: vis, groupKey: `list:${listId}:${periods.dayKey()}`,
      merge: (d) => ({ ...d, itemCount, added: before === null ? null : itemCount - before }),
    });
  });

  on('friend.accepted', ({ userId, friendId }) => {
    record({
      actorId: userId, verb: 'friend', objectType: 'user', objectId: friendId, visibility: studioVisibility(userId, 'friends'),
      groupKey: dayGroup('friend', userId),
      merge: (d) => {
        const users = [friendId, ...(Array.isArray(d.users) ? d.users : []).filter((x) => x !== friendId)].slice(0, GROUP_ITEMS);
        return { ...d, users, count: users.length };
      },
    });
  });

  /**
   * Rattrapage unique (drapeau kv « feed:backfill ») : critiques et albums complétés des 30 derniers jours, pour que le
   * fil ne soit pas vide le premier jour. Deux INSERT … SELECT, rien n'est relu ligne à ligne.
   */
  function backfill(now = Date.now()) {
    if (q("SELECT 1 FROM kv WHERE key = 'feed:backfill'").get()) return null;
    const since = now - BACKFILL_MS;
    const vis = "CASE u.profile_visibility WHEN 'private' THEN 'private' WHEN 'friends' THEN 'friends' ELSE 'public' END";
    return atomic(() => {
      const reviews = q(`INSERT INTO activity (actor_id, verb, object_type, object_id, item_type, item_id, visibility, engagement, created_at, updated_at)
        SELECT r.user_id, 'review', 'review', CAST(r.id AS TEXT), r.item_type, r.item_id, ${vis}, r.like_count + 2 * r.comment_count, r.review_at, r.review_at
        FROM ratings r JOIN users u ON u.id = r.user_id
        WHERE r.review IS NOT NULL AND r.review_at >= ? AND r.hidden_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM activity a WHERE a.object_type = 'review' AND a.object_id = CAST(r.id AS TEXT))`).run(since).changes;
      const completions = q(`INSERT INTO activity (actor_id, verb, object_type, object_id, item_type, item_id, data, visibility, created_at, updated_at)
        SELECT a.user_id, 'complete', 'album', substr(a.key, 7), 'album', substr(a.key, 7), json_object('rank', a.rank), ${vis}, a.created_at, a.created_at
        FROM achievements a JOIN users u ON u.id = a.user_id
        WHERE a.key >= 'album:' AND a.key < 'album;' AND a.created_at >= ?
          AND EXISTS (SELECT 1 FROM cat_albums al WHERE al.id = substr(a.key, 7))
          AND NOT EXISTS (SELECT 1 FROM activity x WHERE x.actor_id = a.user_id AND x.verb = 'complete' AND x.object_id = substr(a.key, 7))`).run(since).changes;
      q("INSERT OR REPLACE INTO kv (key, value) VALUES ('feed:backfill', ?)").run(json({ at: now, reviews, completions }));
      return { reviews, completions };
    });
  }
  try {
    backfill();
  } catch (err) {
    console.error('[feed] rattrapage du fil en erreur :', err);
  }

  // ----- lecture : hydratation ------------------------------------------------------------------

  /** Joueurs masqués et amis de celui qui regarde (même forme que deps.social.viewerOf). */
  const viewerOf = (viewerId) => deps.social?.viewerOf?.(viewerId) ?? (() => {
    const hidden = access().hiddenIds?.(viewerId) ?? new Set();
    return { id: viewerId, hidden, friends: new Set([...services.friendIds(viewerId)].filter((f) => !hidden.has(f))) };
  })();

  const collector = () => deps.social?.collector?.() ?? (() => {
    const ids = { albumIds: [], trackIds: [], artistIds: [] };
    return {
      item: (type, id) => id && (type === 'album' ? ids.albumIds : type === 'track' ? ids.trackIds : type === 'artist' ? ids.artistIds : []).push(id),
      users: (s) => ids.albumIds.push(...services.summaryAlbums(s)),
      albums: (list) => ids.albumIds.push(...list),
      build: () => deps.refs(ids),
    };
  })();

  /**
   * Lignes d'activité → FeedItem pour `viewer`, en requêtes groupées (posts, critiques, listes, joueurs, mentions
   * « J'aime »). Les objets disparus, masqués ou illisibles et les lignes de Studio privés sont retirés.
   * `reasons` : Map id → raison ; sans elle, chaque élément reçoit 'friend' pour un ami (ou soi), sinon 'popular'.
   */
  function hydrate(viewer, rows, refs, reasons = null) {
    if (!rows.length) return [];
    const ids = (verbs) => rows.filter((r) => verbs.includes(r.verb)).map((r) => Number(r.object_id));
    const posts = deps.social?.postsByIds?.(viewer, ids(['post']), refs) ?? new Map();
    const reviews = deps.ratings?.reviewsByIds?.(viewer.id, ids(['review']), { hidden: viewer.hidden }) ?? new Map();
    const lists = deps.social?.listSummaries?.(viewer, ids(['list', 'grid']), refs) ?? new Map();
    const parsed = new Map(rows.map((r) => [r.id, parse(r.data)]));
    const userIds = new Set(rows.map((r) => r.actor_id));
    for (const r of rows) if (r.verb === 'friend') for (const u of parsed.get(r.id).users || []) userIds.add(u);
    const users = services.userSummaries(userIds, viewer.id, { hidden: viewer.hidden });
    refs.users(users.values());
    // Confidentialité du Studio au moment de la lecture (elle a pu changer depuis l'écriture).
    const others = [...new Set(rows.map((r) => r.actor_id))].filter((id) => id !== viewer.id);
    const privacy = new Map(others.length
      ? q('SELECT id, profile_visibility FROM users WHERE id IN (SELECT value FROM json_each(?))').all(json(others)).map((u) => [u.id, u.profile_visibility])
      : []);
    const items = [];
    for (const r of rows) {
      const actor = users.get(r.actor_id);
      if (!actor) continue;
      const self = r.actor_id === viewer.id;
      const friend = viewer.friends.has(r.actor_id);
      if (!self) {
        if (r.visibility === 'private' || (r.visibility === 'friends' && !friend)) continue;
        const p = privacy.get(r.actor_id) || 'public';
        if (STUDIO_VERBS.has(r.verb) && (p === 'private' || (p === 'friends' && !friend))) continue;
      }
      const data = { ...parsed.get(r.id) };
      const item = {
        id: r.id,
        verb: r.verb,
        actor,
        object: { type: r.object_type, id: r.object_id },
        item: r.item_type ? { type: r.item_type, id: r.item_id } : null,
        groupCount: Number(data.count) || 1,
        data,
        likeCount: 0,
        commentCount: 0,
        liked: false,
        reason: reasons?.get(r.id) || (self || friend ? 'friend' : 'popular'),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
      if (r.item_type) refs.item(r.item_type, r.item_id);
      if (r.verb === 'post') {
        const post = posts.get(Number(r.object_id));
        if (!post) continue;
        Object.assign(item, { post, likeCount: post.likeCount, commentCount: post.commentCount, liked: post.liked });
      } else if (r.verb === 'review') {
        const review = reviews.get(Number(r.object_id));
        if (!review || review.moderated) continue;
        Object.assign(item, { review, likeCount: review.likeCount, commentCount: review.commentCount, liked: review.liked });
        refs.item(review.item?.type, review.item?.id);
      } else if (r.verb === 'list' || r.verb === 'grid') {
        const list = lists.get(Number(r.object_id));
        if (!list || list.moderated) continue;
        Object.assign(item, { list, likeCount: list.likeCount, commentCount: list.commentCount, liked: list.liked });
      } else if (r.verb === 'rate') {
        for (const x of data.items || []) refs.item(x.type, x.id);
      } else if (r.verb === 'pull') {
        for (const x of data.items || []) refs.item('track', x.trackId);
      } else if (r.verb === 'friend') {
        data.users = (data.users || []).map((u) => users.get(u)).filter(Boolean);
        if (!data.users.length) continue;
        item.groupCount = data.users.length;
      }
      items.push(item);
    }
    return items;
  }

  // ----- lecture : onglets ----------------------------------------------------------------------

  /** Curseur [created_at, id] : deux nombres, sinon 400 invalid_input. */
  const keyset = (raw) => {
    const after = paging.decodeCursor(raw, { length: 2 });
    if (after && !(Number.isFinite(after[0]) && Number.isInteger(after[1]))) throw new HttpError(400, 'invalid_input', { field: 'cursor' });
    return after;
  };

  /** Un ami a-t-il été actif dans les 14 derniers jours ? (onglet par défaut) */
  function friendsActive(viewer, now) {
    if (!viewer.friends.size) return false;
    return !!q(`SELECT 1 FROM activity WHERE actor_id IN (SELECT value FROM json_each(?)) AND created_at >= ?
      AND visibility IN ('public', 'friends') LIMIT 1`).get(json([...viewer.friends]), now - FRIENDS_ACTIVE_MS);
  }

  /** Réordonne une page par score (raisons comprises), puis la diversité. */
  function rank(viewer, items, now, { tasteIds = new Set() } = {}) {
    const actors = [...new Set(items.map((x) => x.actor.id))].filter((id) => id !== viewer.id && !viewer.friends.has(id));
    const matchScore = new Map();
    for (const id of actors) {
      const s = deps.match?.cachedScore?.(viewer.id, id);
      const n = typeof s === 'number' ? s : s?.score;
      if (Number.isFinite(n)) matchScore.set(id, n);
    }
    const scored = items.map((x) => {
      const friend = x.actor.id === viewer.id || viewer.friends.has(x.actor.id);
      const close = (matchScore.get(x.actor.id) ?? 0) >= 70;
      const affinity = friend ? 1 : close ? 0.5 : 0;
      if (!friend && (close || tasteIds.has(x.id))) x.reason = 'taste';
      else if (friend) x.reason = 'friend';
      const engagement = x.likeCount + 2 * x.commentCount;
      return { x, s: scoreOf({ ageHours: (now - x.createdAt) / HOUR, affinity, engagement, verb: x.verb }) };
    });
    scored.sort((a, b) => b.s - a.s || b.x.createdAt - a.x.createdAt || b.x.id - a.x.id);
    return diversify(scored.map((e) => e.x), (x) => x.actor.id);
  }

  /** Tes amis : curseur [created_at, id] sur activity_actor, réordonné par score à l'intérieur de la page. */
  function friendsTab(viewer, query, now) {
    const { limit } = paging.pageOf(query, { def: 20 });
    const after = keyset(query.cursor);
    const actors = json([...viewer.friends, viewer.id]);
    const base = `SELECT ${ACT_COLS} FROM activity WHERE actor_id IN (SELECT value FROM json_each(?))
      AND (visibility IN ('public', 'friends') OR actor_id = ?)`;
    const rows = after
      ? q(`${base} AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`).all(actors, viewer.id, after[0], after[1], limit + 1)
      : q(`${base} ORDER BY created_at DESC, id DESC LIMIT ?`).all(actors, viewer.id, limit + 1);
    const page = paging.keysetPage(rows, limit, (r) => [r.created_at, r.id]);
    const refs = collector();
    const items = rank(viewer, hydrate(viewer, page.items, refs), now);
    return { items, nextCursor: page.nextCursor, catalog: refs.build() };
  }

  /** Goûts d'un joueur : ses 3 genres, ses artistes favoris et les 60 qu'il collectionne le plus (10 min en cache). */
  function tasteOf(userId) {
    return tasteCache.wrap(userId, () => {
      const genres = new Set(q(`SELECT al.genre AS g FROM user_album_progress p JOIN cat_albums al ON al.id = p.album_id
        WHERE p.user_id = ? AND al.genre IS NOT NULL GROUP BY al.genre ORDER BY SUM(p.owned) DESC LIMIT 3`).all(userId).map((r) => r.g));
      const artists = new Set(q(`SELECT al.artist_id AS a FROM user_album_progress p JOIN cat_albums al ON al.id = p.album_id
        WHERE p.user_id = ? GROUP BY al.artist_id ORDER BY SUM(p.owned) DESC LIMIT 60`).all(userId).map((r) => r.a));
      for (const f of q("SELECT kind, item_id FROM user_favorites WHERE user_id = ? AND kind IN ('artist', 'genre')").all(userId)) {
        (f.kind === 'artist' ? artists : genres).add(f.item_id);
      }
      return { genres, artists };
    });
  }

  /** L'élément d'une activité correspond-il à ces goûts ? (album / morceau : genre ou artiste ; artiste : favori) */
  function matchesTaste(row, taste, memo) {
    const key = `${row.item_type}:${row.item_id}`;
    if (memo.has(key)) return memo.get(key);
    let hit = false;
    if (row.item_type === 'artist') hit = taste.artists.has(row.item_id);
    else {
      const it = row.item_type === 'album' ? catalog.album(row.item_id) : row.item_type === 'track' ? catalog.track(row.item_id) : null;
      hit = !!it && (taste.genres.has(it.genre) || taste.artists.has(it.artistId));
    }
    memo.set(key, hit);
    return hit;
  }

  /** Candidats classés de Pour toi ou Communauté : [{ id, reason }] (≤ 200). */
  function rankedCandidates(viewer, tab, now) {
    const hidden = json([...viewer.hidden]);
    const recent = now - RECENT_MS;
    let rows;
    const tasteIds = new Set();
    if (tab === 'community') {
      rows = q(`SELECT ${ACT_COLS} FROM activity WHERE created_at >= ? AND visibility = 'public'
        AND actor_id NOT IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT ?`).all(recent, hidden, RANKED_CAP);
    } else {
      const taste = tasteOf(viewer.id);
      const excluded = json([...viewer.friends, ...viewer.hidden, viewer.id]);
      const memo = new Map();
      rows = [];
      if (taste.genres.size || taste.artists.size) {
        for (const r of q(`SELECT ${ACT_COLS} FROM activity WHERE created_at >= ? AND visibility = 'public' AND item_type IS NOT NULL
            AND actor_id NOT IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT ?`).all(recent, excluded, FORYOU_SCAN)) {
          if (matchesTaste(r, taste, memo)) {
            rows.push(r);
            tasteIds.add(r.id);
          }
          if (rows.length >= RANKED_CAP) break;
        }
      }
      // Critiques ≥ 8/10 des amis sur des albums que tu n'as pas notés.
      if (viewer.friends.size) {
        rows.push(...q(`SELECT ${ACT_COLS.split(', ').map((c) => `a.${c}`).join(', ')} FROM activity a JOIN ratings r ON r.id = CAST(a.object_id AS INTEGER)
          WHERE a.verb = 'review' AND a.actor_id IN (SELECT value FROM json_each(?)) AND a.created_at >= ? AND a.visibility IN ('public', 'friends')
            AND r.score >= 8 AND r.item_type = 'album'
            AND NOT EXISTS (SELECT 1 FROM ratings m WHERE m.user_id = ? AND m.item_type = 'album' AND m.item_id = r.item_id)
          ORDER BY a.created_at DESC LIMIT 50`).all(json([...viewer.friends]), now - FRIEND_REVIEWS_MS, viewer.id));
      }
      // Démarrage à froid (pas encore de goûts ni d'amis actifs) : l'activité populaire de la communauté.
      if (rows.length < 10) {
        const seen = new Set(rows.map((r) => r.id));
        rows.push(...q(`SELECT ${ACT_COLS} FROM activity WHERE created_at >= ? AND visibility = 'public'
          AND actor_id NOT IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC LIMIT ?`).all(recent, excluded, RANKED_CAP).filter((r) => !seen.has(r.id)));
      }
    }
    const refs = collector();
    const items = rank(viewer, hydrate(viewer, rows.slice(0, RANKED_CAP), refs), now, { tasteIds });
    return items.map((x) => ({ id: x.id, reason: x.reason }));
  }

  /** Pour toi / Communauté : classement gardé 5 minutes, pages par décalage (curseur [offset] ≤ 200). */
  function rankedTab(viewer, tab, query, now) {
    const limit = paging.limitOf(query.limit, { def: 20 });
    const offset = paging.offsetOf(query.cursor, { cap: RANKED_CAP });
    const key = `${tab}:${viewer.id}`;
    let ranked = offset ? rankedCache.get(key) : undefined;
    if (!ranked) ranked = rankedCache.set(key, rankedCandidates(viewer, tab, now));
    const slice = ranked.slice(offset, offset + limit);
    const refs = collector();
    let items = [];
    if (slice.length) {
      const rows = q(`SELECT ${ACT_COLS} FROM activity WHERE id IN (SELECT value FROM json_each(?))`).all(json(slice.map((x) => x.id)));
      const byId = new Map(rows.map((r) => [r.id, r]));
      const reasons = new Map(slice.map((x) => [x.id, x.reason]));
      items = hydrate(viewer, slice.map((x) => byId.get(x.id)).filter(Boolean), refs, reasons);
    }
    const next = offset + slice.length;
    return { items, nextCursor: next < ranked.length && next < RANKED_CAP ? paging.encodeCursor([next]) : null, catalog: refs.build() };
  }

  /** GET /api/feed?tab=&cursor=&limit= → { tab, items, nextCursor, hasFriends, catalog }. */
  function feed(viewerId, query = {}) {
    const now = Date.now();
    const viewer = viewerOf(viewerId);
    let tab = query.tab;
    if (tab !== undefined && tab !== '' && !TABS.includes(tab)) throw new HttpError(400, 'invalid_input', { field: 'tab' });
    if (!tab) tab = friendsActive(viewer, now) ? 'friends' : 'community';
    const page = tab === 'friends' ? friendsTab(viewer, query, now) : rankedTab(viewer, tab, query, now);
    return { tab, ...page, hasFriends: viewer.friends.size > 0 };
  }

  /**
   * GET /api/users/:username/activity (Studio « Activité récente ») : activité d'un joueur selon la confidentialité de
   * son Studio (privé : rien pour les autres ; amis : seulement pour ses amis), curseur [created_at, id].
   */
  function userActivity(viewerId, username, query = {}) {
    const viewer = viewerOf(viewerId);
    const target = q('SELECT id, profile_visibility FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(String(username || ''));
    if (!target || (target.id !== viewer.id && viewer.hidden.has(target.id))) throw new HttpError(404, 'user_not_found');
    const self = target.id === viewer.id;
    const friend = viewer.friends.has(target.id);
    const privacy = target.profile_visibility || 'public';
    if (!self && (privacy === 'private' || (privacy === 'friends' && !friend))) return { items: [], nextCursor: null, restricted: true, catalog: deps.refs() };
    const { limit } = paging.pageOf(query, { def: 10 });
    const after = keyset(query.cursor);
    const vis = self ? '' : friend ? " AND visibility IN ('public', 'friends')" : " AND visibility = 'public'";
    const base = `SELECT ${ACT_COLS} FROM activity WHERE actor_id = ?${vis}`;
    const rows = after
      ? q(`${base} AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?`).all(target.id, after[0], after[1], limit + 1)
      : q(`${base} ORDER BY created_at DESC, id DESC LIMIT ?`).all(target.id, limit + 1);
    const page = paging.keysetPage(rows, limit, (r) => [r.created_at, r.id]);
    const refs = collector();
    return { items: hydrate(viewer, page.items, refs), nextCursor: page.nextCursor, catalog: refs.build() };
  }

  return { refreshEngagement, record, backfill, feed, userActivity, scoreOf, diversify };
}

export function routes(r, deps) {
  const { limits } = deps;
  r.get('/feed', limits.read, (req, res) => res.json(deps.feed.feed(req.user.id, req.query)));
  r.get('/users/:username/activity', limits.read, (req, res) => res.json(deps.feed.userActivity(req.user.id, req.params.username, req.query)));
}

export const jobs = [
  {
    // Activité de plus de 180 jours (PLAN.md 3.8).
    name: 'purge-activity',
    run({ db }) {
      return { deleted: db.prepare('DELETE FROM activity WHERE created_at < ?').run(Date.now() - RETENTION_MS).changes };
    },
  },
];
