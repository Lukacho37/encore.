// Module « badges » : médailles choisies à la main (PLAN.md 4.2.6, 5.7). Chantier : P1-F.
//
// Un badge gagné est une ligne de `achievements` (clé badge:<famille>[:<variante>]:<palier>, data { value, at }).
// Les familles (shared/badges.js) sont réévaluées par des abonnés du bus qui ne relisent que les familles touchées
// par l'événement, avec des comptages indexés et bornés (le plus haut seuil sert de LIMIT) ; une famille dont le
// joueur a déjà le dernier palier n'est plus relue. Rattrapage : au premier contact (première lecture des badges ou
// premier événement d'un joueur d'avant P1), toutes les familles sont évaluées une fois, en silence (une seule
// notification, pas de fil, pas de message), drapeau `badges:v1` dans user_stats_cache.
// Gagner un badge : récompense du palier dans la même transaction (XP par services.gainXp, royalties, booster bonus,
// titre au dernier palier par deps.collection.grantCosmetic), notification badge_earned, événement badge.earned
// (feed.js publie l'or, le platine et la première médaille), message sur le site (POST /badges/seen, `badgesEarned`).
// Familles externes (coffrets, événements, P2-B) : leurs badges sont donnés par server/sets.js et server/events.js ;
// ici, ni mesure ni rattrapage, la page les liste (une médaille par coffret ou événement gagné).
// API interne (deps.badges) : evaluate(userId, family, variant?), backfill(userId), earnedSince(userId, since),
// summary(userId).
import {
  BADGE_DECADES, BADGE_GENRES, FAMILIES, FRIENDLY_SCORE, PEN_MIN_CHARS, badgeKey, familyOf, metricCap, parseBadgeKey,
  rewardFor, tierMetric, tierProgress, tierRank,
} from '../shared/badges.js';
import { decadeOf } from '../shared/battles.js';

export const name = 'badges';

const BACKFILL_KEY = 'badges:v1';
const SEEN_KEY = 'badges:seen';
const PERFECT = 5; // blind test parfait : 5 bonnes réponses sur 5
const DAY = 86_400_000;

export function init(deps) {
  const { db, catalog, services, HttpError } = deps;
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
  const n = (sql, ...args) => Number(q(sql).get(...args)?.n) || 0;
  const cap = (family, metric) => metricCap(family, metric);
  /** Dans la transaction en cours s'il y en a une (abonné appelé pendant une écriture), sinon dans la sienne. */
  const atomic = (fn) => (db.isTransaction ? fn() : services.atomic(fn));
  // Progression de toutes les familles d'un joueur (page Badges, ≈ 25 ms pour le plus gros collectionneur) : 15 s,
  // oubliée à chaque badge gagné.
  const pageCache = deps.lru({ max: 2000, ttlMs: 15_000 });

  // ----- mesures : un comptage borné par famille -------------------------------------------------------

  /** Cartes distinctes d'une rareté : par les cartes du joueur ou par les morceaux de la rareté, le plus court. */
  function rarityCount(userId, rarity, limit) {
    const unique = services.getUser(userId)?.unique_cards ?? 0;
    const total = catalog.totals().rarity?.[rarity] ?? 0;
    if (unique <= total) {
      return n(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT c.track_id FROM cards c CROSS JOIN cat_tracks t
        WHERE c.user_id = ? AND t.id = c.track_id AND t.rarity = ? LIMIT ?)`, userId, rarity, limit);
    }
    return n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM cat_tracks t WHERE t.rarity = ?
      AND EXISTS (SELECT 1 FROM cards c WHERE c.user_id = ? AND c.track_id = t.id) LIMIT ?)`, rarity, userId, limit);
  }

  const decadeRange = (d) => [Number(d), Number(d) + 10];

  const MEASURES = {
    vinyl: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM achievements WHERE user_id = ? AND key >= 'album:' AND key < 'album;'
      LIMIT ?)`, u, cap('vinyl')) }),
    first_press: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM achievements WHERE user_id = ? AND key >= 'album:'
      AND key < 'album;' AND rank <= 10 LIMIT 1)`, u) }),
    master: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM achievements WHERE user_id = ? AND key >= 'artist:' AND key < 'artist;'
      LIMIT ?)`, u, cap('master')) }),
    legendary: (u) => ({ value: rarityCount(u, 'legendary', cap('legendary')) }),
    promo: (u) => ({ value: rarityCount(u, 'promo', cap('promo')) }),
    explorer: (u, decade) => {
      const [from, to] = decadeRange(decade);
      return {
        albums: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM user_album_progress p CROSS JOIN cat_albums al
          WHERE p.user_id = ? AND al.id = p.album_id AND al.year >= ? AND al.year < ? LIMIT ?)`, u, from, to, cap('explorer', 'albums')),
        completed: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM achievements a CROSS JOIN cat_albums al
          WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;' AND al.id = substr(a.key, 7) AND al.year >= ? AND al.year < ?
          LIMIT ?)`, u, from, to, cap('explorer', 'completed')),
      };
    },
    eclectic: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT al.genre FROM user_album_progress p CROSS JOIN cat_albums al
      WHERE p.user_id = ? AND al.id = p.album_id AND al.genre IS NOT NULL LIMIT ?)`, u, cap('eclectic')) }),
    genre_fan: (u, genre) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM achievements a CROSS JOIN cat_albums al
      WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;' AND al.id = substr(a.key, 7) AND al.genre = ? LIMIT ?)`, u, genre, cap('genre_fan')) }),
    deluxe: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM achievements WHERE user_id = ? AND key >= 'deluxe:' AND key < 'deluxe;'
      LIMIT ?)`, u, cap('deluxe')) }),
    critic: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ratings WHERE user_id = ? AND item_type = 'album' LIMIT ?)`, u, cap('critic')) }),
    pen: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ratings WHERE user_id = ? AND review_at IS NOT NULL AND hidden_at IS NULL
      AND length(review) >= ? LIMIT ?)`, u, PEN_MIN_CHARS, cap('pen')) }),
    popular_review: (u) => ({ value: n(`SELECT COALESCE(MAX(like_count), 0) AS n FROM ratings WHERE user_id = ? AND review_at IS NOT NULL
      AND hidden_at IS NULL`, u) }),
    // Albums dont chaque morceau a sa note.
    fine_ear: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT t.album_id FROM ratings r CROSS JOIN cat_tracks t
      WHERE r.user_id = ? AND r.item_type = 'track' AND t.id = r.item_id AND t.album_id IS NOT NULL
      GROUP BY t.album_id HAVING COUNT(*) >= (SELECT track_count FROM cat_albums WHERE id = t.album_id) LIMIT ?)`, u, cap('fine_ear')) }),
    curator: (u) => ({ value: n(`SELECT COALESCE(MAX(like_count), 0) AS n FROM lists WHERE user_id = ? AND kind = 'list'
      AND visibility = 'public' AND hidden_at IS NULL`, u) }),
    nine: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM lists WHERE user_id = ? AND kind = 'grid9' AND item_count >= 9
      AND visibility <> 'private' AND hidden_at IS NULL`, u) }),
    // Amis (encore amis) avec qui le Taste Match calculé dépasse 85 %.
    friendly: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (
        SELECT 1 FROM taste_matches tm WHERE tm.user_a = ? AND tm.score >= ? AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
          AND ((f.requester_id = tm.user_a AND f.addressee_id = tm.user_b) OR (f.requester_id = tm.user_b AND f.addressee_id = tm.user_a)))
        UNION ALL
        SELECT 1 FROM taste_matches tm WHERE tm.user_b = ? AND tm.score >= ? AND EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted'
          AND ((f.requester_id = tm.user_a AND f.addressee_id = tm.user_b) OR (f.requester_id = tm.user_b AND f.addressee_id = tm.user_a)))
        LIMIT ?)`, u, FRIENDLY_SCORE, u, FRIENDLY_SCORE, cap('friendly')) }),
    blindtest: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM blindtest_games WHERE user_id = ? AND finished_at IS NOT NULL
      AND correct >= ? LIMIT ?)`, u, PERFECT, cap('blindtest')) }),
    judge: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM battle_votes WHERE user_id = ? AND counted = 1 LIMIT ?)`, u, cap('judge')) }),
    // Jours où les 3 quêtes du jour ont été réclamées (pas une série : des jours, dans n'importe quel ordre).
    steady: (u) => ({ value: n(`SELECT COUNT(*) AS n FROM (SELECT period_key FROM user_quests WHERE user_id = ? AND period_key >= 'd:'
      AND period_key < 'd;' AND slot < 3 AND claimed_at IS NOT NULL GROUP BY period_key HAVING COUNT(*) >= 3 LIMIT ?)`, u, cap('steady')) }),
  };

  /** Mesures de toutes les variantes d'une famille à variantes, en une requête groupée (page Badges, rattrapage). */
  function measureVariants(userId, familyId) {
    const out = new Map();
    if (familyId === 'explorer') {
      for (const d of BADGE_DECADES) out.set(d, { albums: 0, completed: 0 });
      for (const r of q(`SELECT (al.year / 10) * 10 AS d, COUNT(*) AS n FROM user_album_progress p CROSS JOIN cat_albums al
        WHERE p.user_id = ? AND al.id = p.album_id AND al.year IS NOT NULL GROUP BY d`).all(userId)) {
        if (out.has(r.d)) out.get(r.d).albums = Math.min(r.n, cap('explorer', 'albums'));
      }
      for (const r of q(`SELECT (al.year / 10) * 10 AS d, COUNT(*) AS n FROM achievements a CROSS JOIN cat_albums al
        WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;' AND al.id = substr(a.key, 7) AND al.year IS NOT NULL GROUP BY d`).all(userId)) {
        if (out.has(r.d)) out.get(r.d).completed = Math.min(r.n, cap('explorer', 'completed'));
      }
    } else if (familyId === 'genre_fan') {
      for (const g of BADGE_GENRES) out.set(g, { value: 0 });
      for (const r of q(`SELECT al.genre AS g, COUNT(*) AS n FROM achievements a CROSS JOIN cat_albums al
        WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;' AND al.id = substr(a.key, 7) AND al.genre IS NOT NULL
        GROUP BY al.genre`).all(userId)) {
        if (out.has(r.g)) out.get(r.g).value = Math.min(r.n, cap('genre_fan'));
      }
    }
    return out;
  }

  // ----- attribution -------------------------------------------------------------------------------------

  const earnedKeys = (userId) => new Set(q("SELECT key FROM achievements WHERE user_id = ? AND key >= 'badge:' AND key < 'badge;'")
    .all(userId).map((r) => r.key));

  /**
   * Donne les paliers atteints et pas encore gagnés, avec leur récompense, dans une transaction. `quiet` (rattrapage) :
   * ni événement ni notification par badge. Renvoie [{ key, family, variant, tier, reward }].
   */
  function grantReached(userId, list, { quiet = false, have = earnedKeys(userId) } = {}) {
    const fresh = [];
    for (const { family, variant, values } of list) {
      for (const p of tierProgress(family, values)) {
        const key = badgeKey(family, variant, p.tier);
        if (p.reached && !have.has(key)) fresh.push({ key, family, variant: variant ?? null, tier: p.tier, value: p.progress });
      }
    }
    if (!fresh.length) return [];
    const now = Date.now();
    const won = atomic(() => {
      const user = services.getUser(userId);
      if (!user) return [];
      const out = [];
      const ins = q('INSERT OR IGNORE INTO achievements (user_id, key, created_at, data) VALUES (?, ?, ?, ?)');
      for (const b of fresh) {
        if (!ins.run(userId, b.key, now, json({ value: b.value, at: now, ...(quiet ? { backfill: true } : {}) })).changes) continue;
        const reward = rewardFor(b.family, b.tier);
        if (reward.royalties || reward.boosters) {
          q('UPDATE users SET royalties = royalties + ?, bonus_packs = bonus_packs + ? WHERE id = ?').run(reward.royalties || 0, reward.boosters || 0, userId);
          user.royalties += reward.royalties || 0;
          user.bonus_packs += reward.boosters || 0;
        }
        if (reward.cosmetic) deps.collection?.grantCosmetic?.(userId, reward.cosmetic, `badge:${b.family}`);
        services.gainXp(user, reward.xp, 'badge');
        have.add(b.key);
        out.push({ ...b, reward });
      }
      return out;
    });
    if (!won.length) return won;
    pageCache.delete(userId);
    services.forget?.(userId);
    const day = new Date(now).toISOString().slice(0, 10);
    if (quiet) {
      deps.notify?.(userId, 'badge_earned', { targetType: 'user', targetId: userId, groupKey: `badge:${day}`, data: { count: won.length, backfill: true } });
    } else {
      for (const b of won) {
        deps.notify?.(userId, 'badge_earned', {
          targetType: 'user', targetId: userId, groupKey: `badge:${day}`, data: { key: b.key, family: b.family, variant: b.variant, tier: b.tier },
        });
        deps.bus.emit('badge.earned', { userId, key: b.key, family: b.family, variant: b.variant, tier: b.tier });
      }
    }
    return won;
  }

  /** Tous les paliers de la médaille déjà gagnés ? (l'Explorateur peut gagner l'argent avant le bronze) */
  const allTiers = (userId, family, variant) => {
    const keys = familyOf(family).tiers.map((t) => badgeKey(family, variant, t.tier));
    return n('SELECT COUNT(*) AS n FROM achievements WHERE user_id = ? AND key IN (SELECT value FROM json_each(?))', userId, json(keys)) >= keys.length;
  };

  // Mise en service des badges : un joueur inscrit après n'a rien à rattraper (ses badges arrivent par les événements,
  // avec leur message) ; un joueur d'avant reçoit en silence ce que son historique lui vaut déjà.
  q("INSERT OR IGNORE INTO kv (key, value) VALUES ('badges:since', ?)").run(String(Date.now()));
  const launchedAt = Number(q("SELECT value FROM kv WHERE key = 'badges:since'").get()?.value) || 0;

  /** Rattrapage silencieux, une fois par joueur d'avant les badges : toutes les familles. Renvoie les badges donnés. */
  function backfill(userId) {
    if (q('SELECT 1 FROM user_stats_cache WHERE user_id = ? AND key = ?').get(userId, BACKFILL_KEY)) return [];
    const user = services.getUser(userId);
    if (!user) return [];
    if (user.created_at >= launchedAt) {
      const now = Date.now();
      q('INSERT OR IGNORE INTO user_stats_cache (user_id, key, data, computed_at) VALUES (?, ?, ?, ?)').run(userId, BACKFILL_KEY, '{}', now);
      q('INSERT OR IGNORE INTO user_stats_cache (user_id, key, data, computed_at) VALUES (?, ?, ?, ?)').run(userId, SEEN_KEY, '{}', now);
      return [];
    }
    const list = [];
    for (const f of FAMILIES) {
      // Coffrets et événements : donnés par leurs modules, rien à mesurer ici.
      if (f.external) continue;
      if (f.variants) {
        for (const [variant, values] of measureVariants(userId, f.id)) list.push({ family: f.id, variant, values });
      } else {
        list.push({ family: f.id, variant: null, values: MEASURES[f.id](userId) });
      }
    }
    const now = Date.now();
    // Le drapeau d'abord : deux requêtes croisées ne rattrapent pas deux fois (INSERT OR IGNORE des badges en plus).
    const flagged = q('INSERT OR IGNORE INTO user_stats_cache (user_id, key, data, computed_at) VALUES (?, ?, ?, ?)')
      .run(userId, BACKFILL_KEY, '{}', now).changes;
    if (!flagged) return [];
    q('INSERT OR IGNORE INTO user_stats_cache (user_id, key, data, computed_at) VALUES (?, ?, ?, ?)').run(userId, SEEN_KEY, '{}', now);
    return grantReached(userId, list, { quiet: true });
  }

  /** Réévalue une famille (une variante) pour un joueur ; rattrapage d'abord s'il n'a jamais eu lieu. */
  function evaluate(userId, family, variant = null) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0) return [];
    const f = familyOf(family);
    if (!f || f.external || (f.variants && !f.variants.includes(variant))) return [];
    backfill(uid);
    if (allTiers(uid, family, variant)) return [];
    return grantReached(uid, [{ family, variant, values: MEASURES[family](uid, variant) }]);
  }

  // ----- abonnés du bus : seulement les familles touchées -----------------------------------------------

  const on = (event, fn) => deps.bus.on(event, fn);
  const albumFacts = (albumId) => catalog.album(albumId);

  on('album.completed', ({ userId, albumId, rank }) => {
    evaluate(userId, 'vinyl');
    if (rank != null && rank <= 10) evaluate(userId, 'first_press');
    const album = albumFacts(albumId);
    const decade = decadeOf(album?.year);
    if (BADGE_DECADES.includes(decade)) evaluate(userId, 'explorer', decade);
    if (album?.genre && BADGE_GENRES.includes(album.genre)) evaluate(userId, 'genre_fan', album.genre);
  });
  on('artist.mastered', ({ userId }) => evaluate(userId, 'master'));
  // Édition deluxe gagnée (module workshop, P2-D).
  on('deluxe.earned', ({ userId }) => evaluate(userId, 'deluxe'));
  on('cards.added', ({ userId, cards = [], albumDeltas = [] }) => {
    if (cards.some((c) => c.newTrack && c.rarity === 'legendary')) evaluate(userId, 'legendary');
    if (cards.some((c) => c.newTrack && c.rarity === 'promo')) evaluate(userId, 'promo');
    // Un album commencé pour la première fois : peut-être une nouvelle décennie, un nouveau genre.
    const started = albumDeltas.filter((d) => !d.before).map((d) => albumFacts(d.albumId)).filter(Boolean);
    if (!started.length) return;
    for (const decade of new Set(started.map((a) => decadeOf(a.year)))) if (BADGE_DECADES.includes(decade)) evaluate(userId, 'explorer', decade);
    evaluate(userId, 'eclectic');
  });
  on('rating.saved', ({ userId, itemType, itemId, isNew, hasReview, reviewChanged }) => {
    if (itemType === 'album' && isNew) evaluate(userId, 'critic');
    if (hasReview && reviewChanged) evaluate(userId, 'pen');
    if (itemType === 'track') {
      // L'album de ce morceau a-t-il maintenant toutes ses notes ? Sinon rien à recompter.
      const t = catalog.track(itemId);
      if (!t?.albumId) return;
      const rated = n(`SELECT COUNT(*) AS n FROM ratings r CROSS JOIN cat_tracks t WHERE r.user_id = ? AND r.item_type = 'track'
        AND t.id = r.item_id AND t.album_id = ?`, userId, t.albumId);
      if (rated >= (albumFacts(t.albumId)?.trackCount ?? Infinity)) evaluate(userId, 'fine_ear');
    }
  });
  on('like.created', ({ targetType, ownerId }) => {
    if (targetType === 'review') evaluate(ownerId, 'popular_review');
    if (targetType === 'list') evaluate(ownerId, 'curator');
  });
  on('list.saved', ({ userId, kind, itemCount }) => {
    if (kind === 'grid9' && itemCount >= 9) evaluate(userId, 'nine');
  });
  on('blindtest.finished', ({ userId, correct }) => {
    if (correct >= PERFECT) evaluate(userId, 'blindtest');
  });
  on('battle.voted', ({ userId, counted }) => {
    if (counted) evaluate(userId, 'judge');
  });
  on('quest.claimed', ({ userId, periodKey }) => {
    if (String(periodKey).startsWith('d:')) evaluate(userId, 'steady');
  });
  // Taste Match calculé (module match, P1-E) ou amitié acceptée : « Bonne entente » pour les deux joueurs.
  on('match.computed', (p = {}) => {
    // Un match sous le seuil ne peut rien débloquer : pas de réévaluation (les suggestions en calculent beaucoup).
    if (typeof p.score === 'number' && p.score < FRIENDLY_SCORE) return;
    for (const id of [p.userId, p.otherId, p.userA, p.userB, p.a, p.b]) if (id) evaluate(id, 'friendly');
  });
  on('friend.accepted', ({ userId, friendId }) => {
    evaluate(userId, 'friendly');
    evaluate(friendId, 'friendly');
  });
  // Médaille donnée par un autre module (coffret, événement) : la page Badges du joueur est relue.
  on('badge.earned', ({ userId, family }) => {
    if (familyOf(family)?.external) pageCache.delete(Number(userId));
  });

  // ----- lecture -----------------------------------------------------------------------------------------

  const parse = (text) => {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  };

  /** Badges gagnés d'un joueur : Map clé de médaille (famille|variante) → Map palier → date. */
  function earnedOf(userId) {
    const out = new Map();
    for (const r of q("SELECT key, created_at FROM achievements WHERE user_id = ? AND key >= 'badge:' AND key < 'badge;'").all(userId)) {
      const b = parseBadgeKey(r.key);
      if (!b) continue;
      const k = `${b.family}|${b.variant ?? ''}`;
      if (!out.has(k)) out.set(k, new Map());
      out.get(k).set(b.tier, r.created_at);
    }
    return out;
  }

  /** Médaille : { id, variant, group, icon, tiers: [{ tier, target, progress?, earnedAt }], best, earnedAt }. */
  function medalView(f, variant, earned, values) {
    const progress = values ? tierProgress(f.id, values) : null;
    const tiers = f.tiers.map((t, i) => {
      const earnedAt = earned?.get(t.tier) ?? null;
      const p = progress?.[i];
      return { tier: t.tier, target: t.target, metric: tierMetric(t), earnedAt, ...(p ? { progress: earnedAt ? t.target : p.progress } : {}) };
    });
    const got = tiers.filter((t) => t.earnedAt);
    const best = got.sort((a, b) => tierRank(b.tier) - tierRank(a.tier))[0] || null;
    return { id: f.id, variant: variant ?? null, group: f.group, icon: f.icon, tiers, best: best?.tier ?? null, earnedAt: best?.earnedAt ?? null };
  }

  /**
   * Médailles d'une famille externe (coffrets, événements) : une par variante gagnée, la plus récente d'abord ; aucune
   * gagnée et `placeholder` : la médaille verrouillée de la famille (sans variante), pour montrer qu'elle existe.
   */
  function externalViews(f, earned, { placeholder = false } = {}) {
    const views = [];
    for (const [k, tiers] of earned) if (k.startsWith(`${f.id}|`)) views.push(medalView(f, k.slice(f.id.length + 1), tiers, null));
    views.sort((a, b) => (b.earnedAt || 0) - (a.earnedAt || 0));
    if (!views.length && placeholder) views.push(medalView(f, null, null, null));
    return views;
  }

  /**
   * GET /api/badges : toutes les médailles du joueur, gagnées (avec la date) ou à gagner (avec la progression).
   * « Fan de… » : les genres gagnés, plus le genre le plus avancé. Rattrapage au premier appel.
   */
  function mine(userId) {
    backfill(userId);
    return pageCache.wrap(userId, () => {
      const earned = earnedOf(userId);
      const families = [];
      for (const f of FAMILIES) {
        if (f.external) {
          families.push(...externalViews(f, earned, { placeholder: true }));
          continue;
        }
        if (!f.variants) {
          families.push(medalView(f, null, earned.get(`${f.id}|`), MEASURES[f.id](userId)));
          continue;
        }
        const measured = measureVariants(userId, f.id);
        let shown = [...measured.entries()];
        if (f.hiddenUntilEarned) {
          const won = shown.filter(([v]) => earned.has(`${f.id}|${v}`));
          const next = shown.filter(([v, val]) => !earned.has(`${f.id}|${v}`) && val.value > 0).sort((a, b) => b[1].value - a[1].value)[0];
          shown = next ? [...won, next] : won;
        }
        for (const [variant, values] of shown) families.push(medalView(f, variant, earned.get(`${f.id}|${variant}`), values));
      }
      const total = families.length;
      const earnedCount = families.filter((m) => m.best).length;
      return { families, earned: earnedCount, total };
    });
  }

  /** GET /api/users/:username/badges : médailles gagnées seulement (visibilité du Studio et blocages respectés). */
  function ofUser(viewerId, username) {
    const target = q('SELECT id, profile_visibility FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(String(username || ''));
    if (!target || (target.id !== viewerId && deps.access?.isBlocked?.(viewerId, target.id))) throw new HttpError(404, 'user_not_found');
    if (target.id === viewerId) return mine(viewerId);
    if (deps.access?.canSee && !deps.access.canSee(viewerId, target.id, target.profile_visibility || 'public')) throw new HttpError(403, 'profile_private');
    backfill(target.id);
    const earned = earnedOf(target.id);
    const families = [];
    for (const f of FAMILIES) {
      if (f.external) {
        families.push(...externalViews(f, earned));
        continue;
      }
      for (const variant of f.variants || [null]) {
        const got = earned.get(`${f.id}|${variant ?? ''}`);
        if (!got) continue;
        const view = medalView(f, variant, got, null);
        view.tiers = view.tiers.filter((t) => t.earnedAt);
        families.push(view);
      }
    }
    return { families, earned: families.length, total: null };
  }

  /** Badges gagnés depuis `since` (hors rattrapage) : [{ key, family, variant, tier, at, reward }]. */
  function earnedSince(userId, since) {
    return q(`SELECT key, created_at, data FROM achievements WHERE user_id = ? AND created_at >= ? AND key >= 'badge:' AND key < 'badge;'
      ORDER BY created_at, key LIMIT 20`).all(userId, Number(since) || 0)
      .filter((r) => !parse(r.data).backfill)
      .map((r) => {
        const b = parseBadgeKey(r.key);
        return b ? { key: r.key, ...b, at: r.created_at, reward: rewardFor(b.family, b.tier) } : null;
      })
      .filter(Boolean);
  }

  /** POST /api/badges/seen : badges gagnés depuis le dernier message du site (puis la marque avance). */
  function seen(userId) {
    const now = Date.now();
    const mark = q('SELECT computed_at FROM user_stats_cache WHERE user_id = ? AND key = ?').get(userId, SEEN_KEY)?.computed_at;
    q(`INSERT INTO user_stats_cache (user_id, key, data, computed_at) VALUES (?, ?, '{}', ?)
      ON CONFLICT (user_id, key) DO UPDATE SET computed_at = excluded.computed_at`).run(userId, SEEN_KEY, now);
    // Sans marque (premier passage) : seulement ceux du dernier jour.
    return { items: earnedSince(userId, mark ?? now - DAY) };
  }

  /** Résumé pour un autre module : { earned, best: [clés des meilleurs] }. */
  function summary(userId) {
    const earned = earnedOf(userId);
    return { earned: earned.size };
  }

  return { evaluate, backfill, mine, ofUser, earnedSince, seen, summary };
}

export function routes(r, deps) {
  const { limits } = deps;
  const api = () => deps.badges;
  r.get('/badges', limits.read, (req, res) => res.json(api().mine(req.user.id)));
  r.post('/badges/seen', limits.write, (req, res) => res.json(api().seen(req.user.id)));
  r.get('/users/:username/badges', limits.read, (req, res) => res.json(api().ofUser(req.user.id, req.params.username)));
}
