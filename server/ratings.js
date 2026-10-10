// Module « ratings » : notes et critiques v2 (PLAN.md 4.1.2). Chantier : P0-C, repris par P1-A en P1 (mentions « J'aime »
// réelles sur les critiques, tri « populaires », anciennes clés `reviews` / `friendScores` retirées, critiques par
// identifiants pour le fil et les permaliens /review/:id).
// Une critique est une ligne de `ratings` avec un texte ; son identifiant (ratings.id) est stable : les mentions
// « J'aime », les réponses et les liens directs (/review/:id, P1) s'y accrochent. Les moyennes et répartitions viennent
// de `rating_stats`, recalculé dans la même transaction que chaque note (services.refreshRatingStats) : aucune page ne
// relit toutes les notes d'un album. Les critiques des amis passent avant celles de la communauté : deux requêtes
// bornées sur l'index partiel ratings_item_reviews, pas un tri « amis d'abord » sur toutes les critiques.
// Écrire un texte demande un compte actif (deps.access.assertActive), compte dans le quota quotidien `reviews`, passe
// par la politique des liens (deps.access.linkPolicy) et refuse un texte identique à une des 20 dernières critiques
// de l'auteur (409 duplicate_review). Événements : rating.saved, rating.deleted, content.removed (texte retiré).
// Les routes de ce module sont montées avant les routes historiques d'app.js, qu'elles remplacent.
export const name = 'ratings';

/** Longueur maximale d'une critique (caractères). */
export const REVIEW_MAX = 2000;
/** Critiques par page (amis, communauté) ; notes d'amis affichées au plus. */
export const REVIEWS_PAGE = 10;
export const FRIEND_SCORES = 24;
/** Tri « populaires » : décalage plafonné (PLAN.md 4.1.2). */
export const POPULAR_CAP = 200;
/** Nombre de critiques récentes de l'auteur comparées pour refuser un texte en double. */
const DUPLICATE_WINDOW = 20;

const TYPES = new Set(['album', 'track']);
const emptyDistribution = () => Array(11).fill(0);

/** Répartition stockée en JSON (rating_stats.dist) → 11 entiers, ou des zéros si elle est illisible. */
function parseDistribution(text) {
  try {
    const list = JSON.parse(text);
    if (Array.isArray(list) && list.length === 11) return list.map((n) => Number(n) || 0);
  } catch {
    // valeur abîmée : on repart de zéro plutôt que d'échouer
  }
  return emptyDistribution();
}

export function init(deps) {
  const { db, catalog, services, validate, paging, periods } = deps;
  const statements = new Map();
  /** Requête préparée une fois par texte SQL (les variantes avec / sans curseur sont deux textes). */
  const q = (sql) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    return st;
  };
  const json = (list) => JSON.stringify(list);
  const access = () => deps.access || {};
  /** Transaction, sauf si l'appelant en a déjà ouvert une (notes rapides de l'accueil, P1). */
  const atomic = (fn) => (db.isTransaction ? fn() : deps.tx(fn));
  /** Curseur [valeur de tri, id] lu d'une requête : deux nombres, sinon 400 invalid_input. */
  const keysetCursor = (raw) => {
    const after = paging.decodeCursor(raw, { length: 2 });
    if (after && !(Number.isFinite(after[0]) && Number.isInteger(after[1]))) throw new deps.HttpError(400, 'invalid_input', { field: 'cursor' });
    return after;
  };

  // ----- éléments, statistiques ---------------------------------------------------------------

  /** Album ou morceau existant, sinon 404 unknown_item. Renvoie l'identifiant validé. */
  function checkItem(type, rawId) {
    const id = validate.id(rawId);
    const ok = id && TYPES.has(type) && (type === 'album' ? !!catalog.album(id) : !!catalog.track(id));
    if (!ok) throw new deps.HttpError(404, 'unknown_item');
    return id;
  }

  /** Résumé des notes d'un élément (une ligne de rating_stats) : { count, average, distribution[11], reviewCount }. */
  function summaryOf(type, id) {
    const row = q('SELECT count, sum, review_count, dist FROM rating_stats WHERE item_type = ? AND item_id = ?').get(type, id);
    if (!row || !row.count) return { count: 0, average: null, distribution: emptyDistribution(), reviewCount: 0 };
    return { count: row.count, average: row.sum / row.count, distribution: parseDistribution(row.dist), reviewCount: row.review_count };
  }

  /** Amis (acceptés) et joueurs masqués (blocages dans un sens ou dans l'autre) de celui qui regarde. */
  function viewerOf(viewerId) {
    const hidden = access().hiddenIds?.(viewerId) ?? new Set();
    const friends = new Set([...services.friendIds(viewerId)].filter((id) => !hidden.has(id)));
    return { id: viewerId, friends, hidden };
  }

  /** Critiques aimées par `viewerId` parmi ces identifiants (une requête). */
  function likedReviews(viewerId, ids) {
    const list = ids.filter((x) => Number.isInteger(x));
    if (!viewerId || !list.length) return new Set();
    return new Set(q(`SELECT target_id FROM likes WHERE user_id = ? AND target_type = 'review'
      AND target_id IN (SELECT value FROM json_each(?))`).all(viewerId, json(list)).map((r) => r.target_id));
  }

  /** Lignes de notes → critiques (Review, PLAN.md 4.1.2), auteurs en un seul appel à userSummaries. */
  function hydrate(rows, viewer) {
    const users = services.userSummaries(rows.map((r) => r.user_id), viewer.id, { hidden: viewer.hidden });
    const liked = likedReviews(viewer.id, rows.map((r) => r.id));
    const items = [];
    for (const r of rows) {
      const user = users.get(r.user_id);
      if (!user) continue;
      items.push({
        id: r.id,
        user,
        score: r.score,
        review: r.review,
        reviewAt: r.review_at,
        updatedAt: r.updated_at,
        likeCount: r.like_count,
        commentCount: r.comment_count,
        liked: liked.has(r.id),
        friend: viewer.friends.has(r.user_id),
        ...(r.item_type ? { item: { type: r.item_type, id: r.item_id } } : {}),
        ...(r.hidden_at ? { moderated: true } : {}),
      });
    }
    return { items, users };
  }

  /**
   * Critiques par identifiants (fil, permalien /review/:id, posts qui en partagent une) : Map id → Review + `item`
   * { type, id }. Une critique masquée n'est rendue qu'à son auteur ; les joueurs bloqués sont absents.
   */
  function reviewsByIds(viewerId, ids, { hidden } = {}) {
    const wanted = [...new Set(ids.map(Number))].filter((x) => Number.isInteger(x) && x > 0);
    if (!wanted.length) return new Map();
    const viewer = viewerOf(viewerId);
    if (hidden) viewer.hidden = hidden;
    const rows = q(`SELECT ${REVIEW_COLS}, item_type, item_id FROM ratings WHERE id IN (SELECT value FROM json_each(?))
      AND review IS NOT NULL AND (hidden_at IS NULL OR user_id = ?)`).all(json(wanted), viewerId);
    return new Map(hydrate(rows, viewer).items.map((r) => [r.id, r]));
  }

  const REVIEW_COLS = 'id, user_id, score, review, review_at, updated_at, like_count, comment_count, hidden_at';

  /**
   * Une page de critiques d'un élément. `scope` : 'friends' (amis de celui qui regarde) ou 'community' (tous les
   * autres, sauf lui-même et les joueurs masqués). `sort` : 'recent' (curseur [updated_at, id] sur l'index partiel
   * ratings_item_reviews) ou 'popular' (curseur [décalage] ≤ 200, trié par mentions « J'aime »).
   * Renvoie { items: [Review], nextCursor, users }.
   */
  function reviewsPage(viewer, type, id, { scope = 'community', sort = 'recent', cursor = null, limit = REVIEWS_PAGE } = {}) {
    const friends = [...viewer.friends];
    if (scope === 'friends' && !friends.length) return { items: [], nextCursor: null, users: new Map() };
    // Les conditions « review IS NOT NULL AND hidden_at IS NULL » recopient celles de l'index partiel.
    const base = `SELECT ${REVIEW_COLS} FROM ratings WHERE item_type = ? AND item_id = ? AND review IS NOT NULL AND hidden_at IS NULL`;
    const who = scope === 'friends'
      ? ' AND user_id IN (SELECT value FROM json_each(?))'
      : ' AND user_id NOT IN (SELECT value FROM json_each(?))';
    const people = json(scope === 'friends' ? friends : [...viewer.friends, ...viewer.hidden, viewer.id]);
    let page;
    if (sort === 'popular') {
      const offset = paging.offsetOf(cursor, { cap: POPULAR_CAP });
      const rows = q(`${base}${who} ORDER BY like_count DESC, updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(type, id, people, limit + 1, offset);
      page = paging.offsetPage(rows, offset, limit, { cap: POPULAR_CAP });
    } else {
      const after = keysetCursor(cursor);
      const rows = after
        ? q(`${base}${who} AND (updated_at, id) < (?, ?) ORDER BY updated_at DESC, id DESC LIMIT ?`).all(type, id, people, after[0], after[1], limit + 1)
        : q(`${base}${who} ORDER BY updated_at DESC, id DESC LIMIT ?`).all(type, id, people, limit + 1);
      page = paging.keysetPage(rows, limit, (r) => [r.updated_at, r.id]);
    }
    const { items, users } = hydrate(page.items, viewer);
    return { items, nextCursor: page.nextCursor, users };
  }

  /** Albums des photos de profil de ces résumés de joueurs (à passer à refs pour afficher leur visuel). */
  const avatarAlbums = (summaries) => services.summaryAlbums(summaries);

  /**
   * Notes d'un album ou d'un morceau pour celui qui regarde (GET /api/ratings/:type/:id) : résumé, sa note, notes et
   * critiques des amis, première page de la communauté, notes des morceaux (album). Les anciennes clés `reviews` et
   * `friendScores` sont retirées (P1-A) : toutes les pages lisent `friends` et `community`.
   */
  function itemPayload(viewerId, type, id) {
    const viewer = viewerOf(viewerId);
    const mineRow = q(`SELECT ${REVIEW_COLS} FROM ratings WHERE user_id = ? AND item_type = ? AND item_id = ?`).get(viewerId, type, id);
    const mine = mineRow
      ? {
        id: mineRow.id, score: mineRow.score, review: mineRow.review, reviewAt: mineRow.review_at, updatedAt: mineRow.updated_at,
        ...(mineRow.hidden_at ? { moderated: true } : {}),
      }
      : null;
    const friendList = [...viewer.friends];
    const scoreRows = friendList.length
      ? q(`SELECT user_id, score, updated_at FROM ratings WHERE item_type = ? AND item_id = ?
          AND user_id IN (SELECT value FROM json_each(?)) ORDER BY updated_at DESC LIMIT ?`).all(type, id, json(friendList), FRIEND_SCORES)
      : [];
    const scoreUsers = services.userSummaries(scoreRows.map((r) => r.user_id), viewerId, { hidden: viewer.hidden });
    const scores = scoreRows.filter((r) => scoreUsers.has(r.user_id))
      .map((r) => ({ user: scoreUsers.get(r.user_id), score: r.score, updatedAt: r.updated_at }));
    const friendReviews = reviewsPage(viewer, type, id, { scope: 'friends' });
    const community = reviewsPage(viewer, type, id, { scope: 'community' });
    const result = {
      summary: summaryOf(type, id),
      mine,
      friends: { scores, reviews: friendReviews.items, nextCursor: friendReviews.nextCursor },
      community: { reviews: community.items, nextCursor: community.nextCursor },
    };
    if (type === 'album') {
      const trackIds = json(catalog.albumTrackIds(id));
      const averages = {};
      for (const r of q(`SELECT item_id, count, sum FROM rating_stats WHERE item_type = 'track'
          AND item_id IN (SELECT value FROM json_each(?))`).all(trackIds)) {
        if (r.count) averages[r.item_id] = { avg: r.sum / r.count, count: r.count };
      }
      const myTracks = {};
      for (const r of q(`SELECT item_id, score FROM ratings WHERE user_id = ? AND item_type = 'track'
          AND item_id IN (SELECT value FROM json_each(?))`).all(viewerId, trackIds)) myTracks[r.item_id] = r.score;
      result.tracks = { averages, mine: myTracks };
    }
    result.catalog = deps.refs({
      albumIds: avatarAlbums([...scoreUsers.values(), ...friendReviews.users.values(), ...community.users.values()]),
    });
    return result;
  }

  // ----- écriture -------------------------------------------------------------------------------

  /** Texte d'une critique reçu de la requête : nettoyé, null s'il est vide ; `undefined` = garder le texte actuel. */
  function cleanReview(raw) {
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string') return null;
    const text = raw.trim().normalize('NFC');
    if (text.length > REVIEW_MAX) throw new deps.HttpError(400, 'review_too_long');
    return text || null;
  }

  /**
   * Enregistre la note (et la critique) de `user` (ligne users) ; renvoie l'identifiant de la note. Sans champ
   * `review`, le texte déjà écrit est gardé (note changée depuis la tracklist).
   */
  function rateAs(user, type, rawId, score, rawReview) {
    const id = checkItem(type, rawId);
    if (!Number.isInteger(score) || score < 0 || score > 10) throw new deps.HttpError(400, 'invalid_score');
    const existing = q('SELECT id, review, review_at FROM ratings WHERE user_id = ? AND item_type = ? AND item_id = ?').get(user.id, type, id);
    let text = cleanReview(rawReview);
    if (text === undefined) text = existing?.review ?? null;
    let changed = text !== (existing?.review ?? null);
    if (text && changed) {
      // Nouveau texte : compte actif (CGU, suspension), quota du jour, politique des liens, doublons.
      access().assertActive?.(user);
      // Une critique déjà écrite aujourd'hui sur cet élément ne compte pas une seconde fois.
      if (!(existing?.review_at >= periods.dayStart())) deps.quota(user.id, 'reviews');
      const policed = access().linkPolicy?.(text, user);
      if (typeof policed === 'string') text = policed.trim() || null;
      changed = text !== (existing?.review ?? null);
      if (text && changed) {
        const dup = q(`SELECT 1 FROM (SELECT review FROM ratings WHERE user_id = ? AND review_at IS NOT NULL
            AND NOT (item_type = ? AND item_id = ?) ORDER BY review_at DESC LIMIT ?) WHERE review = ?`)
          .get(user.id, type, id, DUPLICATE_WINDOW, text);
        if (dup) throw new deps.HttpError(409, 'duplicate_review');
      }
    }
    const now = Date.now();
    // review_at : date du texte (inchangée quand seule la note bouge, effacée avec le texte).
    const reviewAt = !text ? null : changed ? now : existing?.review_at ?? now;
    const ratingId = atomic(() => {
      const row = q(`INSERT INTO ratings (user_id, item_type, item_id, score, review, review_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET score = excluded.score, review = excluded.review,
          review_at = excluded.review_at, updated_at = excluded.updated_at
        RETURNING id`).get(user.id, type, id, score, text, reviewAt, now, now);
      services.refreshRatingStats(type, id);
      return row.id;
    });
    if (existing?.review && !text) removedReview(ratingId);
    deps.bus.emit('rating.saved', {
      userId: user.id, ratingId, itemType: type, itemId: id, score, isNew: !existing, hasReview: !!text, reviewChanged: changed,
    });
    return ratingId;
  }

  /** Texte d'une critique disparu : ce qui s'y accroche (mentions, réponses, notifications) part avec lui. */
  function removedReview(ratingId) {
    try {
      deps.moderation?.purgeTarget?.('review', ratingId);
    } catch (err) {
      console.error('[ratings] purgeTarget en erreur :', err);
    }
    deps.bus.emit('content.removed', { targetType: 'review', targetId: ratingId, by: 'author' });
  }

  /** Retire la note (et la critique) de `userId` ; renvoie l'identifiant de la note retirée, null s'il n'y en avait pas. */
  function unrate(userId, type, rawId) {
    const id = checkItem(type, rawId);
    const existing = atomic(() => {
      const row = q('SELECT id, review FROM ratings WHERE user_id = ? AND item_type = ? AND item_id = ?').get(userId, type, id);
      if (!row) return null;
      q('DELETE FROM ratings WHERE id = ?').run(row.id);
      services.refreshRatingStats(type, id);
      return row;
    });
    if (!existing) return null;
    if (existing.review) removedReview(existing.id);
    deps.bus.emit('rating.deleted', { userId, ratingId: existing.id, itemType: type, itemId: id, hadReview: !!existing.review });
    return existing.id;
  }

  /** API interne (deps.ratings.rate) : notes rapides du parcours d'accueil (P1-E). */
  function rate(userId, type, id, score, review) {
    const user = services.getUser(userId);
    if (!user) throw new deps.HttpError(404, 'user_not_found');
    return rateAs(user, type, id, score, review);
  }

  // ----- journal d'un joueur, fil des amis ------------------------------------------------------

  // Élément noté encore au catalogue (un album ou un morceau purgé ne s'affiche plus).
  const IN_CATALOG = `((r.item_type = 'album' AND EXISTS (SELECT 1 FROM cat_albums al WHERE al.id = r.item_id))
    OR (r.item_type = 'track' AND EXISTS (SELECT 1 FROM cat_tracks t WHERE t.id = r.item_id)))`;
  const DIST_SQL = Array.from({ length: 11 }, (_, i) => `SUM(r.score = ${i}) AS d${i}`).join(', ');
  const ENTRY_COLS = 'r.id, r.item_type, r.item_id, r.score, r.review, r.review_at, r.updated_at';
  // `id` reste l'identifiant de l'élément noté (forme d'avant) ; `ratingId` est celui de la note (ancre #review-<id>).
  const entryOf = (r) => ({ type: r.item_type, id: r.item_id, ratingId: r.id, score: r.score, review: r.review, updatedAt: r.updated_at });
  const itemRefs = (entries, extraAlbums = []) => deps.refs({
    albumIds: [...entries.filter((e) => e.type === 'album').map((e) => e.id), ...extraAlbums],
    trackIds: entries.filter((e) => e.type === 'track').map((e) => e.id),
  });

  /** Joueur affiché (vérifié, pas bloqué dans un sens ou dans l'autre), sinon 404 user_not_found. */
  function targetUser(viewerId, username) {
    const target = q('SELECT id, username FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(String(username || ''));
    if (!target || (target.id !== viewerId && access().isBlocked?.(viewerId, target.id))) throw new deps.HttpError(404, 'user_not_found');
    return target;
  }

  /** Critiques d'un joueur, les plus récentes d'abord (curseur [review_at, id], index ratings_user_review). */
  function userReviewPage(viewerId, target, cursor, limit = REVIEWS_PAGE) {
    const after = keysetCursor(cursor);
    // Une critique masquée par la modération reste visible de son auteur seulement.
    const hidden = target.id === viewerId ? '' : ' AND r.hidden_at IS NULL';
    const base = `SELECT ${ENTRY_COLS} FROM ratings r
      WHERE r.user_id = ? AND r.review_at IS NOT NULL AND r.review IS NOT NULL${hidden} AND ${IN_CATALOG}`;
    const rows = after
      ? q(`${base} AND (r.review_at, r.id) < (?, ?) ORDER BY r.review_at DESC, r.id DESC LIMIT ?`).all(target.id, after[0], after[1], limit + 1)
      : q(`${base} ORDER BY r.review_at DESC, r.id DESC LIMIT ?`).all(target.id, limit + 1);
    const page = paging.keysetPage(rows, limit, (r) => [r.review_at, r.id]);
    return { items: page.items.map(entryOf), nextCursor: page.nextCursor };
  }

  /**
   * Journal de notes d'un joueur (GET /api/users/:username/ratings) : agrégats SQL et listes bornées, jamais tout
   * l'historique. `reviews` reste une liste (10 critiques) pour la page profil actuelle ; la suite se lit avec
   * `reviewsCursor` sur GET /api/users/:username/reviews.
   */
  function userRatings(viewerId, username) {
    const target = targetUser(viewerId, username);
    const agg = q(`SELECT COUNT(*) AS n, SUM(r.score) AS s, SUM(r.item_type = 'album') AS albums,
        SUM(r.review IS NOT NULL) AS reviews, ${DIST_SQL}
      FROM ratings r WHERE r.user_id = ? AND ${IN_CATALOG}`).get(target.id);
    const count = agg.n || 0;
    const top = (type, n) => q(`SELECT ${ENTRY_COLS} FROM ratings r WHERE r.user_id = ? AND r.item_type = ? AND ${IN_CATALOG}
      ORDER BY r.score DESC, r.updated_at DESC LIMIT ?`).all(target.id, type, n).map(entryOf);
    const recent = q(`SELECT ${ENTRY_COLS} FROM ratings r WHERE r.user_id = ? AND ${IN_CATALOG}
      ORDER BY r.updated_at DESC LIMIT 12`).all(target.id).map(entryOf);
    const reviews = userReviewPage(viewerId, target, null);
    const result = {
      stats: {
        count,
        average: count ? agg.s / count : null,
        distribution: Array.from({ length: 11 }, (_, i) => agg[`d${i}`] || 0),
        albums: agg.albums || 0,
        tracks: count - (agg.albums || 0),
        reviews: agg.reviews || 0,
      },
      topAlbums: top('album', 4),
      topTracks: top('track', 5),
      recent,
      reviews: reviews.items,
      reviewsCursor: reviews.nextCursor,
    };
    result.catalog = itemRefs([...result.topAlbums, ...result.topTracks, ...result.recent, ...result.reviews]);
    return result;
  }

  /** Dernières notes des amis (accueil, en attendant le fil de P1-A) : même forme qu'avant, plus `ratingId`. */
  function friendsFeed(userId) {
    const viewer = viewerOf(userId);
    const ids = [...viewer.friends];
    if (!ids.length) return { items: [], catalog: deps.refs() };
    const rows = q(`SELECT ${ENTRY_COLS}, r.user_id, r.hidden_at FROM ratings r
      WHERE r.user_id IN (SELECT value FROM json_each(?)) AND ${IN_CATALOG} ORDER BY r.updated_at DESC LIMIT 20`).all(json(ids));
    const users = services.userSummaries(rows.map((r) => r.user_id), userId, { hidden: viewer.hidden });
    const items = rows.filter((r) => users.has(r.user_id)).map((r) => ({
      ...entryOf(r), user: users.get(r.user_id), review: r.hidden_at ? null : r.review,
    }));
    return { items, catalog: itemRefs(items, avatarAlbums(users.values())) };
  }

  return {
    rate, rateAs, unrate, summaryOf, itemPayload, reviewsPage, reviewsByIds, viewerOf, checkItem, userRatings, userReviewPage, targetUser,
    friendsFeed,
  };
}

export function routes(r, deps) {
  const { limits, validate, paging } = deps;
  const api = () => deps.ratings;
  const partial = (req) => deps.services.state(req.user.id, { partial: true });
  const itemOf = (req) => ({ type: req.params.type, id: api().checkItem(req.params.type, req.params.id) });
  const pageLimit = (req) => paging.limitOf(req.query.limit, { def: 10, max: 50 });

  // Fil des notes des amis (accueil).
  r.get('/ratings/feed', limits.read, (req, res) => res.json(api().friendsFeed(req.user.id)));

  r.get('/ratings/:type/:id', limits.read, (req, res) => {
    const { type, id } = itemOf(req);
    res.json(api().itemPayload(req.user.id, type, id));
  });

  // Pages suivantes des critiques : ?scope=friends|community&sort=recent|popular&cursor=&limit=
  r.get('/ratings/:type/:id/reviews', limits.read, (req, res) => {
    const { type, id } = itemOf(req);
    const scope = validate.oneOf(req.query.scope, ['friends', 'community'], { optional: true, fallback: 'community', field: 'scope' });
    const sort = validate.oneOf(req.query.sort, ['recent', 'popular'], { optional: true, fallback: 'recent', field: 'sort' });
    const page = api().reviewsPage(api().viewerOf(req.user.id), type, id, { scope, sort, cursor: req.query.cursor, limit: pageLimit(req) });
    res.json({ items: page.items, nextCursor: page.nextCursor, catalog: deps.refs({ albumIds: deps.services.summaryAlbums(page.users.values()) }) });
  });

  // `rating` : le delta de la note du joueur (score null = note retirée), fusionné dans state.ratings par le site.
  r.put('/ratings/:type/:id', limits.write, (req, res) => {
    const { type, id } = itemOf(req);
    api().rateAs(req.user, type, id, req.body.score, req.body.review);
    res.json({ ...api().itemPayload(req.user.id, type, id), rating: { type, id, score: req.body.score }, state: partial(req) });
  });

  r.delete('/ratings/:type/:id', limits.write, (req, res) => {
    const { type, id } = itemOf(req);
    api().unrate(req.user.id, type, id);
    res.json({ ...api().itemPayload(req.user.id, type, id), rating: { type, id, score: null }, state: partial(req) });
  });

  r.get('/users/:username/ratings', limits.read, (req, res) => res.json(api().userRatings(req.user.id, req.params.username)));

  // Critiques d'un joueur, page par page (?cursor=&limit=).
  r.get('/users/:username/reviews', limits.read, (req, res) => {
    const target = api().targetUser(req.user.id, req.params.username);
    const page = api().userReviewPage(req.user.id, target, req.query.cursor, pageLimit(req));
    res.json({
      ...page,
      catalog: deps.refs({
        albumIds: page.items.filter((e) => e.type === 'album').map((e) => e.id),
        trackIds: page.items.filter((e) => e.type === 'track').map((e) => e.id),
      }),
    });
  });
}
