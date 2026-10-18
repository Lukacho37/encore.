// Module « match » : Taste Match (PLAN.md 4.2.7, 5.3). Chantier : P1-E.
//
// Profil de goûts d'un joueur, lu dans ses tables indexées (une requête chacune, clé primaire du joueur) : ses notes
// (albums et morceaux), sa progression par album (user_album_progress → cartes par artiste, genre, décennie), ses
// favoris (user_favorites) et « Mes 9 albums ». Le calcul (shared/match.js) compare deux profils : score sur 100,
// confiance, composantes expliquées, albums / artistes / morceaux / genres en commun, différences, recommandations
// dans les deux sens.
// Cache : taste_matches (paire rangée avec user_a < user_b), 6 h, recalculée plus tôt quand l'un des deux a 5 notes de
// plus ou de moins qu'au calcul (comptes gardés dans `data`) ; la tâche taste-cache efface les paires de plus de 7 jours.
// Confidentialité : indisponible entre joueurs bloqués (dans un sens ou dans l'autre), pour un Studio privé, ou réservé
// aux amis quand on n'est pas ami (403 match_unavailable). Les résumés de joueurs sont hydratés à chaque réponse
// (services.userSummaries), jamais gardés en cache.
// Routes : GET /match/batch?usernames=a,b (≤ 30, 5 calculs neufs au plus par appel), GET /match/suggestions,
// GET /match/top (meilleur ami pour la carte de l'accueil), GET /match/:username.
// API interne (deps.match) : cachedScore(a, b), scoreBetween(a, b), suggestions(viewerId, { limit, fresh }),
// forget(userId), profileOf(userId).
import {
  MATCH_PURGE_MS, MATCH_RECOUNT, MATCH_TTL_MS, LOVED_SCORE, FAVORITE_FACTOR, FAVORITE_FLOOR, RATED_GENRE_WEIGHT,
  bayes, compareProfiles, flipResult, recommendations,
} from '../shared/match.js';

export const name = 'match';

/** Pseudos au plus par appel de /match/batch, et calculs neufs au plus par appel. */
export const BATCH_MAX = 30;
export const BATCH_FRESH = 5;
/** Amis suggérés : candidats par source, candidats dont on calcule le match, suggestions renvoyées. */
const CANDIDATES = 200;
const SCORED = 20;
const SUGGESTIONS = 8;
const SUGGESTIONS_MAX = 12;
/** Albums adorés récents qui servent à trouver des joueurs proches ; notes en commun nécessaires. */
const RECENT_LOVED = 30;
const SHARED_LOVED_MIN = 3;
/** Carte de l'accueil : calculs neufs au plus parmi les amis sans match en cache. */
const TOP_FRESH = 5;
const TEN_MIN = 10 * 60_000;

export function init(deps) {
  const { db, services, HttpError, lru } = deps;
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
  const hiddenOf = (viewerId) => access().hiddenIds?.(viewerId) ?? new Set();

  // Profils (60 s : les suggestions comparent le même joueur à 20 autres), suggestions et carte de l'accueil (10 min).
  const profiles = lru({ max: 500, ttlMs: 60_000 });
  const suggestionCache = lru({ max: 2000, ttlMs: TEN_MIN });
  const topCache = lru({ max: 2000, ttlMs: TEN_MIN });

  function forget(userId) {
    profiles.delete(Number(userId));
    topCache.delete(Number(userId));
    suggestionCache.delete(Number(userId));
  }

  // ----- profil de goûts ----------------------------------------------------------------------------

  /**
   * Artiste, genre et décennie de chaque album actif, gardés 30 min (35 ms pour 20 000 albums) : un profil lit ses notes et sa progression par
   * la clé primaire du joueur, sans jointure (5 000 albums commencés pour le plus gros joueur de la base peuplée).
   */
  const metaCache = lru({ max: 1, ttlMs: 3 * TEN_MIN });
  const albumMeta = () => metaCache.wrap('all', () => {
    const map = new Map();
    for (const r of db.prepare("SELECT id, artist_id, genre, year FROM cat_albums WHERE status = 'active'").all()) {
      map.set(r.id, { ar: r.artist_id, g: r.genre, d: decadeOf(r.year) });
    }
    return map;
  });

  const decadeOf = (year) => (Number.isInteger(year) && year > 0 ? Math.floor(year / 10) * 10 : null);
  const add = (map, key, w) => {
    if (key == null || !w) return;
    map.set(key, (map.get(key) || 0) + w);
  };

  /** Profil de goûts (voir shared/match.js) ; null pour un joueur inconnu. */
  function profileOf(userId) {
    const id = Number(userId);
    const hit = profiles.get(id);
    if (hit) return hit;
    const user = q('SELECT id, unique_cards FROM users WHERE id = ?').get(id);
    if (!user) return null;
    const ratings = new Map();
    const loved = new Set();
    const artists = new Map();
    const genres = new Map();
    const decades = new Map();
    const completed = new Set();
    const meta = albumMeta();
    const rows = q('SELECT item_type AS t, item_id AS id, score AS s FROM ratings WHERE user_id = ?').all(id);
    for (const r of rows) {
      ratings.set(`${r.t}:${r.id}`, r.s);
      const m = r.t === 'album' ? meta.get(r.id) : null;
      if (!m) continue;
      if (r.s >= LOVED_SCORE) loved.add(r.id);
      add(artists, m.ar, r.s - 5);
      add(genres, m.g, RATED_GENRE_WEIGHT);
      add(decades, m.d, RATED_GENRE_WEIGHT);
    }
    for (const p of q('SELECT album_id AS id, owned, total FROM user_album_progress WHERE user_id = ?').all(id)) {
      const m = meta.get(p.id);
      if (!m) continue;
      add(artists, m.ar, p.owned);
      add(genres, m.g, p.owned);
      add(decades, m.d, p.owned);
      if (p.total > 0 && p.owned >= p.total) completed.add(p.id);
    }
    // « Mes 9 albums » : adorés, et comptés comme une note de 10 quand ils ne sont pas notés.
    for (const g of q(`SELECT li.item_id AS id FROM lists l JOIN list_items li ON li.list_id = l.id
      WHERE l.user_id = ? AND l.kind = 'grid9' AND li.item_type = 'album'`).all(id)) {
      const m = meta.get(g.id);
      if (!m) continue;
      loved.add(g.id);
      if (ratings.has(`album:${g.id}`)) continue;
      add(artists, m.ar, 5);
      add(genres, m.g, RATED_GENRE_WEIGHT);
      add(decades, m.d, RATED_GENRE_WEIGHT);
    }
    const favorites = { artist: [], genre: [], track: [] };
    for (const f of q('SELECT kind, item_id FROM user_favorites WHERE user_id = ? ORDER BY position, created_at').all(id)) {
      favorites[f.kind]?.push(f.item_id);
    }
    for (const a of favorites.artist) artists.set(a, Math.max(artists.get(a) || 0, FAVORITE_FLOOR) * FAVORITE_FACTOR);
    for (const g of favorites.genre) add(genres, g, FAVORITE_FLOOR);
    const profile = {
      id, ratings, loved, artists, genres, decades, completed, favorites,
      cards: user.unique_cards || 0,
      ratingCount: rows.length,
    };
    profiles.set(id, profile);
    return profile;
  }

  // ----- calcul et cache d'une paire --------------------------------------------------------------------

  const ratingCount = (userId) => q('SELECT COUNT(*) AS n FROM ratings WHERE user_id = ?').get(userId).n;
  const pairOf = (a, b) => (a < b ? [a, b] : [b, a]);

  /** Ligne de cache encore valable (moins de 6 h, comptes de notes à moins de 5 près), sinon null. */
  function validRow(lo, hi, now = Date.now()) {
    const row = q('SELECT score, confidence, data, computed_at FROM taste_matches WHERE user_a = ? AND user_b = ?').get(lo, hi);
    if (!row || now - row.computed_at >= MATCH_TTL_MS) return null;
    let data;
    try {
      data = JSON.parse(row.data);
    } catch {
      return null;
    }
    if (data?.v !== 1) return null;
    const counts = data.counts || {};
    if (Math.abs(ratingCount(lo) - (counts.a ?? -99)) >= MATCH_RECOUNT) return null;
    if (Math.abs(ratingCount(hi) - (counts.b ?? -99)) >= MATCH_RECOUNT) return null;
    return { ...data, score: row.score, confidence: row.confidence, computedAt: row.computed_at };
  }

  /** Métadonnées des albums recommandables (artiste, genre, moyenne bayésienne), en une requête. */
  function albumInfo(ids) {
    const out = new Map();
    if (!ids.length) return out;
    for (const r of q(`SELECT al.id, al.artist_id, al.genre, rs.count, rs.sum FROM cat_albums al
      LEFT JOIN rating_stats rs ON rs.item_type = 'album' AND rs.item_id = al.id
      WHERE al.id IN (SELECT value FROM json_each(?)) AND al.status = 'active'`).all(json(ids))) {
      out.set(r.id, { artistId: r.artist_id, genre: r.genre, bayes: bayes(r.sum || 0, r.count || 0) });
    }
    return out;
  }

  /** Calcule la paire (lo < hi), l'écrit dans taste_matches ; renvoie le résultat vu de `lo`. */
  function compute(lo, hi) {
    const A = profileOf(lo);
    const B = profileOf(hi);
    if (!A || !B) return null;
    const result = compareProfiles(A, B);
    const info = albumInfo([...new Set([...A.loved, ...B.loved])]);
    const meta = (id) => info.get(id) || null;
    const now = Date.now();
    const data = {
      v: 1,
      hasData: result.hasData,
      components: result.components,
      shared: result.shared,
      differences: result.differences,
      recAtoB: recommendations(A, B, meta),
      recBtoA: recommendations(B, A, meta),
      corated: result.corated,
      counts: { a: A.ratingCount, b: B.ratingCount },
    };
    q(`INSERT OR REPLACE INTO taste_matches (user_a, user_b, score, confidence, data, computed_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(lo, hi, result.score, result.confidence, json(data), now);
    return { ...data, score: result.score, confidence: result.confidence, computedAt: now };
  }

  /**
   * Résultat de la paire vu de `viewerId` (différences : a = moi ; recAtoB = mes recommandations à l'autre), depuis
   * le cache s'il est valable, sinon calculé (`fresh: false` : null plutôt que de calculer).
   */
  function pairResult(viewerId, otherId, { fresh = true } = {}) {
    const [lo, hi] = pairOf(viewerId, otherId);
    const data = validRow(lo, hi) || (fresh ? compute(lo, hi) : null);
    if (!data) return null;
    return viewerId === lo ? data : flipResult(data);
  }

  // ----- confidentialité ----------------------------------------------------------------------------

  /** Joueur cible (vérifié) par pseudo, sinon null. */
  const userByName = (username) => q('SELECT id, username, profile_visibility FROM users WHERE username = ? AND email_verified_at IS NOT NULL')
    .get(String(username || '').trim().slice(0, 40));

  /** Taste Match possible entre `viewerId` et `target` (blocages, Studio privé ou réservé aux amis). */
  function canMatch(viewerId, target, hidden = hiddenOf(viewerId), friends = null) {
    if (!target || target.id === viewerId || hidden.has(target.id)) return false;
    const privacy = target.profile_visibility || 'public';
    if (privacy === 'public') return true;
    if (privacy !== 'friends') return false;
    return (friends || services.friendIds(viewerId)).has(target.id);
  }

  // ----- réponses -------------------------------------------------------------------------------------

  /** Références du catalogue d'un résultat (albums, morceaux, artistes) et des photos de profil. */
  function refsOf(results, summaries = []) {
    const albumIds = [];
    const trackIds = [];
    const artistIds = [];
    for (const r of results) {
      if (!r) continue;
      albumIds.push(...(r.shared?.albums || []), ...(r.recAtoB || []), ...(r.recBtoA || []));
      trackIds.push(...(r.shared?.tracks || []));
      artistIds.push(...(r.shared?.artists || []));
      for (const c of r.components || []) if (c.key === 'artists') artistIds.push(...(c.vars?.ids || []));
      for (const d of r.differences || []) (d.type === 'track' ? trackIds : albumIds).push(d.id);
    }
    albumIds.push(...services.summaryAlbums(summaries));
    return deps.refs({ albumIds, trackIds, artistIds });
  }

  /** Charge utile d'un match vu de celui qui regarde. */
  function payloadOf(r, user) {
    return {
      score: r.score,
      confidence: r.confidence,
      estimate: r.confidence === 'low',
      hasData: r.hasData !== false,
      components: r.components,
      shared: r.shared,
      differences: (r.differences || []).map((d) => ({ type: d.type, id: d.id, mine: d.a, theirs: d.b })),
      recommendsToMe: r.recBtoA || [],
      recommendsToThem: r.recAtoB || [],
      user,
      computedAt: r.computedAt,
    };
  }

  /** GET /match/:username */
  function matchPage(viewerId, username) {
    const target = userByName(username);
    if (!target) throw new HttpError(404, 'user_not_found');
    if (target.id === viewerId) throw new HttpError(400, 'match_self');
    const hidden = hiddenOf(viewerId);
    if (!canMatch(viewerId, target, hidden)) throw new HttpError(403, 'match_unavailable');
    const r = pairResult(viewerId, target.id);
    const user = services.userSummaries([target.id], viewerId, { hidden }).get(target.id) || null;
    return { ...payloadOf(r, user), catalog: refsOf([r], user ? [user] : []) };
  }

  /** Le match de cette page est-il déjà en cache ? (la limite `heavy` ne s'applique qu'à un calcul neuf) */
  function isCached(viewerId, username) {
    const target = userByName(username);
    if (!target || target.id === viewerId) return true;
    const [lo, hi] = pairOf(viewerId, target.id);
    return !!validRow(lo, hi);
  }

  /** GET /match/batch?usernames=a,b,… → { scores: { [pseudo]: score | null }, pending: [pseudos pas encore calculés] } */
  function batch(viewerId, raw) {
    const names = [...new Set(String(raw || '').split(',').map((s) => s.trim()).filter((s) => s && s.length <= 40))].slice(0, BATCH_MAX);
    const scores = {};
    const pending = [];
    if (!names.length) return { scores, pending };
    const rows = q(`SELECT id, username, profile_visibility FROM users
      WHERE username IN (SELECT value FROM json_each(?)) AND email_verified_at IS NOT NULL`).all(json(names));
    const byName = new Map(rows.map((r) => [r.username.toLowerCase(), r]));
    const hidden = hiddenOf(viewerId);
    const friends = services.friendIds(viewerId);
    let fresh = 0;
    for (const name of names) {
      const target = byName.get(name.toLowerCase());
      scores[name] = null;
      if (!canMatch(viewerId, target, hidden, friends)) continue;
      let r = pairResult(viewerId, target.id, { fresh: false });
      if (!r && fresh < BATCH_FRESH) {
        fresh += 1;
        r = pairResult(viewerId, target.id);
      }
      if (r) scores[name] = r.hasData === false ? null : r.score;
      else pending.push(name);
    }
    return { scores, pending };
  }

  /** Score de la paire en cache (taste_matches, moins de 7 jours) ; null sinon. Jamais de calcul. */
  function cachedScore(a, b) {
    const x = Number(a);
    const y = Number(b);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x === y) return null;
    const [lo, hi] = pairOf(x, y);
    const row = q('SELECT score, computed_at FROM taste_matches WHERE user_a = ? AND user_b = ?').get(lo, hi);
    return row && Date.now() - row.computed_at < MATCH_PURGE_MS ? row.score : null;
  }

  /** Score de deux joueurs (cache ou calcul), sans contrôle de confidentialité : usage interne seulement. */
  function scoreBetween(a, b) {
    const r = Number(a) === Number(b) ? null : pairResult(Number(a), Number(b));
    return r && r.hasData !== false ? r.score : null;
  }

  // ----- amis suggérés --------------------------------------------------------------------------------

  /** Joueurs liés à `userId` par une amitié, une demande (dans un sens ou dans l'autre) ou un refus. */
  const relatedIds = (userId) => new Set(q(`SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id
    FROM friendships WHERE requester_id = ? OR addressee_id = ?`).all(userId, userId, userId).map((r) => r.id));

  /**
   * Candidats (PLAN.md 5.3) : joueurs qui ont noté au moins 3 de mes 30 derniers albums adorés, amis de mes amis
   * (amis en commun), joueurs qui partagent au moins 2 de mes artistes favoris ; moins mes amis, demandes, refus et
   * blocages. Le match est calculé pour les 20 meilleurs ; renvoie [{ id, score, reason, mutualFriends, artists }].
   */
  function computeSuggestions(viewerId) {
    const me = profileOf(viewerId);
    if (!me) return [];
    const exclude = relatedIds(viewerId);
    exclude.add(viewerId);
    for (const id of hiddenOf(viewerId)) exclude.add(id);
    const cand = new Map();
    const entry = (id) => {
      let c = cand.get(id);
      if (!c) {
        c = { id, loved: 0, mutual: 0, favs: 0, artists: [] };
        cand.set(id, c);
      }
      return c;
    };
    // (a) Albums adorés récents (et ceux de « Mes 9 albums »).
    const recent = q(`SELECT item_id FROM ratings WHERE user_id = ? AND item_type = 'album' AND score >= ?
      ORDER BY updated_at DESC LIMIT ?`).all(viewerId, LOVED_SCORE, RECENT_LOVED).map((r) => r.item_id);
    for (const id of me.loved) if (recent.length < RECENT_LOVED && !recent.includes(id)) recent.push(id);
    if (recent.length >= SHARED_LOVED_MIN) {
      for (const r of q(`SELECT user_id, COUNT(*) AS n FROM ratings WHERE item_type = 'album' AND item_id IN (SELECT value FROM json_each(?))
        AND user_id <> ? GROUP BY user_id HAVING n >= ? ORDER BY n DESC LIMIT ?`).all(json(recent), viewerId, SHARED_LOVED_MIN, CANDIDATES)) {
        if (!exclude.has(r.user_id)) entry(r.user_id).loved = r.n;
      }
    }
    // (b) Amis de mes amis (deux moitiés, chacune sur son index).
    const fof = q(`WITH mine AS (
        SELECT addressee_id AS f FROM friendships WHERE requester_id = :me AND status = 'accepted'
        UNION SELECT requester_id FROM friendships WHERE addressee_id = :me AND status = 'accepted')
      SELECT other, COUNT(*) AS mutual FROM (
        SELECT fr.addressee_id AS other FROM mine JOIN friendships fr ON fr.requester_id = mine.f AND fr.status = 'accepted'
        UNION ALL SELECT fr.requester_id FROM mine JOIN friendships fr ON fr.addressee_id = mine.f AND fr.status = 'accepted')
      WHERE other <> :me GROUP BY other ORDER BY mutual DESC LIMIT :n`).all({ me: viewerId, n: CANDIDATES });
    for (const r of fof) if (!exclude.has(r.other)) entry(r.other).mutual = r.mutual;
    // (c) Artistes favoris en commun.
    const favs = me.favorites.artist;
    if (favs.length >= 2) {
      for (const r of q(`SELECT user_id, COUNT(*) AS n, json_group_array(item_id) AS ids FROM user_favorites
        WHERE kind = 'artist' AND item_id IN (SELECT value FROM json_each(?)) AND user_id <> ?
        GROUP BY user_id HAVING n >= 2 ORDER BY n DESC LIMIT ?`).all(json(favs), viewerId, CANDIDATES)) {
        if (exclude.has(r.user_id)) continue;
        const c = entry(r.user_id);
        c.favs = r.n;
        try {
          c.artists = JSON.parse(r.ids).slice(0, 2);
        } catch {
          c.artists = [];
        }
      }
    }
    if (!cand.size) return [];
    // Comptes vérifiés seulement ; Studio public pour un score (sinon : amis en commun seulement, sans score).
    const users = new Map(q(`SELECT id, profile_visibility FROM users WHERE id IN (SELECT value FROM json_each(?)) AND email_verified_at IS NOT NULL`)
      .all(json([...cand.keys()])).map((u) => [u.id, u]));
    const isPublic = (id) => (users.get(id)?.profile_visibility || 'public') === 'public';
    const strength = (c) => 2 * c.loved + 3 * c.mutual + 2 * c.favs;
    const ranked = [...cand.values()].filter((c) => users.has(c.id) && (isPublic(c.id) || c.mutual > 0))
      .sort((a, b) => strength(b) - strength(a) || a.id - b.id)
      .slice(0, SCORED);
    const scored = ranked.map((c) => {
      const r = isPublic(c.id) ? pairResult(viewerId, c.id) : null;
      const score = r && r.hasData !== false ? r.score : null;
      const reason = score != null && score >= 70 ? 'taste' : c.mutual > 0 ? 'friends_of_friends' : c.favs >= 2 ? 'favorites' : 'taste';
      return { id: c.id, score, reason, mutualFriends: c.mutual, artists: reason === 'favorites' ? c.artists : [] };
    });
    scored.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.mutualFriends - a.mutualFriends || a.id - b.id);
    return scored.slice(0, SUGGESTIONS_MAX);
  }

  /**
   * Amis suggérés de `viewerId` : { items: [{ user, score, reason, mutualFriends, artists }], friendCount, catalog }
   * (résumés hydratés à chaque appel, en écartant ceux devenus amis, invités ou bloqués entre-temps). `fresh` :
   * recalcul sans le cache de 10 min.
   */
  function suggestions(viewerId, { limit = SUGGESTIONS, fresh = false } = {}) {
    const id = Number(viewerId);
    if (fresh) suggestionCache.delete(id);
    const list = suggestionCache.wrap(id, () => computeSuggestions(id));
    const related = relatedIds(id);
    const hidden = hiddenOf(id);
    const kept = list.filter((s) => !related.has(s.id) && !hidden.has(s.id)).slice(0, limit);
    const summaries = services.userSummaries(kept.map((s) => s.id), id, { hidden });
    const items = kept.filter((s) => summaries.has(s.id)).map((s) => ({
      user: summaries.get(s.id), score: s.score, reason: s.reason, mutualFriends: s.mutualFriends, artists: s.artists,
    }));
    return {
      items,
      friendCount: services.friendIds(id).size,
      catalog: deps.refs({ albumIds: services.summaryAlbums(items.map((x) => x.user)), artistIds: items.flatMap((x) => x.artists) }),
    };
  }

  // ----- carte de l'accueil : l'ami le plus proche ----------------------------------------------------

  /** Meilleur match parmi mes amis (cache, plus 5 calculs neufs au plus) : { id, result } ou false. */
  function computeTop(viewerId) {
    const hidden = hiddenOf(viewerId);
    const friends = [...services.friendIds(viewerId)].filter((f) => !hidden.has(f));
    if (!friends.length) return false;
    const rows = q(`SELECT id, profile_visibility FROM users WHERE id IN (SELECT value FROM json_each(?)) AND email_verified_at IS NOT NULL
      ORDER BY last_seen_at DESC LIMIT 200`).all(json(friends)).filter((u) => (u.profile_visibility || 'public') !== 'private');
    let best = null;
    let fresh = 0;
    for (const u of rows) {
      let r = pairResult(viewerId, u.id, { fresh: false });
      if (!r && fresh < TOP_FRESH) {
        fresh += 1;
        r = pairResult(viewerId, u.id);
      }
      if (!r || r.hasData === false) continue;
      const rank = r.score - (r.confidence === 'low' ? 15 : 0);
      if (!best || rank > best.rank) best = { id: u.id, rank, result: r };
    }
    return best || false;
  }

  /** GET /match/top → { match: { user, score, confidence, estimate, components, shared, computedAt } | null, friendCount } */
  function top(viewerId) {
    const id = Number(viewerId);
    const best = topCache.wrap(id, () => computeTop(id));
    const friendCount = services.friendIds(id).size;
    const none = { match: null, friendCount, catalog: deps.refs({}) };
    if (!best) return none;
    const user = services.userSummaries([best.id], id, { hidden: hiddenOf(id) }).get(best.id);
    if (!user || user.relation !== 'friend') {
      topCache.delete(id);
      return none;
    }
    const p = payloadOf(best.result, user);
    const match = { user, score: p.score, confidence: p.confidence, estimate: p.estimate, components: p.components, shared: p.shared, computedAt: p.computedAt };
    return { match, friendCount, catalog: refsOf([{ shared: best.result.shared, components: best.result.components }], [user]) };
  }

  // ----- caches oubliés quand les goûts ou les amitiés changent ----------------------------------------

  const { bus } = deps;
  bus.on('rating.saved', ({ userId }) => forget(userId));
  bus.on('rating.deleted', ({ userId }) => forget(userId));
  bus.on('cards.added', ({ userId }) => profiles.delete(Number(userId)));
  bus.on('list.saved', ({ userId, kind }) => kind === 'grid9' && forget(userId));
  for (const event of ['friend.requested', 'friend.accepted']) {
    bus.on(event, (p) => {
      for (const id of [p.fromId, p.toId, p.userId, p.friendId]) {
        if (id == null) continue;
        suggestionCache.delete(Number(id));
        topCache.delete(Number(id));
      }
    });
  }

  return { cachedScore, scoreBetween, suggestions, forget, profileOf, matchPage, isCached, batch, top, canMatch };
}

export function routes(r, deps) {
  const { limits } = deps;
  const api = () => deps.match;
  // La limite « heavy » (20 par minute) ne compte que les calculs neufs d'une page de match.
  const heavyIfUncached = (req, res, next) => (api().isCached(req.user.id, req.params.username) ? next() : limits.heavy(req, res, next));

  // Avant /match/:username (un pseudo « batch » ou « top » reste joignable par son Studio, pas par ces adresses).
  r.get('/match/batch', limits.heavy, (req, res) => res.json(api().batch(req.user.id, req.query.usernames)));
  r.get('/match/suggestions', limits.read, (req, res) => {
    const limit = deps.paging.limitOf(req.query.limit, { def: 8, max: 12 });
    res.json(api().suggestions(req.user.id, { limit }));
  });
  r.get('/match/top', limits.read, (req, res) => res.json(api().top(req.user.id)));
  r.get('/match/:username', limits.read, heavyIfUncached, (req, res) => res.json(api().matchPage(req.user.id, req.params.username)));
}

export const jobs = [
  {
    // Paires de plus de 7 jours (PLAN.md 3.8) : recalculées à la prochaine visite.
    name: 'taste-cache',
    run({ db }) {
      return { pairs: db.prepare('DELETE FROM taste_matches WHERE computed_at < ?').run(Date.now() - MATCH_PURGE_MS).changes };
    },
  },
];
