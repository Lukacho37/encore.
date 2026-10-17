// Module « quests » : quêtes du jour, de la semaine et « Premiers pas » (PLAN.md 4.2.6, 5.6, 6.7). Chantier : P1-F.
//
// Les quêtes d'une période sont tirées à la première lecture de la période (une par catégorie : collectionner, noter,
// découvrir), avec un générateur graine hash(joueur, période) (shared/quests.js), puis gardées dans user_quests. La
// progression n'est jamais stockée : c'est un COUNT borné sur la table source dans la fenêtre de la période
// (`SELECT COUNT(*) FROM (… LIMIT :cible)`, le parcours s'arrête à la cible), par un index sur (joueur, date).
// Réclamer recalcule la progression puis, dans une transaction : claimed_at et la récompense, royalties, XP (paliers de
// niveau par services.gainXp, comme deps.collection.addXp), boosters bonus. Les 3 quêtes du jour réclamées donnent le
// « Bonus du jour » (un booster bonus), les 3 de la semaine un booster thématique du genre favori du joueur ; la ligne
// du bonus est le slot BONUS_SLOT de la période. Une relance gratuite par jour. Une période finie ne se réclame plus
// (410 period_over) ; rien d'autre n'expire, aucun jour manqué n'est puni.
// API interne (deps.quests) : list(userId), claim, reroll, claimBonus, progress(userId, questId, periodKey).
// Événement : quest.claimed { userId, periodKey, slot } après la validation.
import {
  BLINDTEST_GOOD, BONUS_REWARDS, BONUS_SLOT, FIRST_KEY, FIRST_STEPS, FREE_REROLLS, QUEST_SLOTS, metricParams, parseQuest,
  rerollQuest, reviewCounts, rewardOf, rollQuests, scopeOfKey,
} from '../shared/quests.js';

export const name = 'quests';

const FAR = Number.MAX_SAFE_INTEGER;
const BOOSTER_SOURCES = ['pack', 'admin-pack', 'album-pack', 'special', 'theme', 'quest'];
const SLOT_RE = /^\d{1,2}$/;

export function init(deps) {
  const { db, services, periods, HttpError } = deps;
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
  const parse = (text, fallback) => {
    try {
      return text ? JSON.parse(text) : fallback;
    } catch {
      return fallback;
    }
  };
  const n = (sql, ...args) => q(sql).get(...args).n;

  // ----- périodes -----------------------------------------------------------------------------------------

  /** Fenêtre { start, end } d'une clé de période (« first » : depuis toujours). */
  function windowOf(periodKey) {
    if (periodKey === FIRST_KEY) return { start: 0, end: FAR };
    return periods.periodBounds(periodKey);
  }

  /** Clés des périodes en cours : { daily, weekly } avec leurs bornes. */
  const current = (now = Date.now()) => ({ daily: periods.currentPeriod('daily', now), weekly: periods.currentPeriod('weekly', now) });

  /** Portée d'une clé reçue, si elle est en cours ; 400 si elle est illisible, 410 si elle est finie (ou pas commencée). */
  function liveScope(periodKey) {
    const scope = scopeOfKey(periodKey);
    if (!scope || scope === 'event') throw new HttpError(400, 'invalid_input', { field: 'periodKey' });
    if (scope === 'first') return scope;
    if (current()[scope].key !== periodKey) throw new HttpError(410, 'period_over');
    return scope;
  }

  // ----- progression : comptages bornés sur les tables sources -------------------------------------------

  /** Cartes dont le PREMIER exemplaire (toutes variantes) a été obtenu dans la fenêtre, avec les filtres demandés. */
  function newCards(userId, params, start, end, limit) {
    const where = [];
    const args = [userId, start, end, start];
    if (params.genre) {
      where.push('t.genre = ?');
      args.push(params.genre);
    }
    if (params.decade) {
      where.push('t.year >= ? AND t.year < ?');
      args.push(params.decade, params.decade + 10);
    }
    if (params.rarities) {
      where.push('COALESCE(c.pulled_rarity, t.rarity) IN (SELECT value FROM json_each(?))');
      args.push(json(params.rarities));
    }
    const join = where.length ? 'JOIN cat_tracks t ON t.id = c.track_id' : '';
    return n(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT c.track_id FROM cards c ${join}
      WHERE c.user_id = ? AND c.first_at >= ? AND c.first_at < ?
        AND NOT EXISTS (SELECT 1 FROM cards o WHERE o.user_id = c.user_id AND o.track_id = c.track_id AND o.first_at < ?)
        ${where.length ? `AND ${where.join(' AND ')}` : ''}
      LIMIT ?)`, ...args, limit);
  }

  /** Critiques écrites dans la fenêtre qui comptent (≥ 140 caractères, pas répétitives : vérifié ici). */
  function reviews(userId, start, end, limit) {
    const rows = q(`SELECT review FROM ratings WHERE user_id = ? AND review_at >= ? AND review_at < ? AND hidden_at IS NULL
      AND length(review) >= 140 ORDER BY review_at LIMIT ?`).all(userId, start, end, limit * 4 + 4);
    return Math.min(limit, rows.filter((r) => reviewCounts(r.review)).length);
  }

  const COUNTERS = {
    open_boosters: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM pack_openings WHERE user_id = ? AND created_at >= ?
      AND created_at < ? AND source IN (SELECT value FROM json_each(?)) LIMIT ?)`, u, s, e, json(BOOSTER_SOURCES), l),
    new_cards: newCards,
    // Premier album d'un artiste dans la fenêtre (aucun album de cet artiste commencé avant). updated_at ≥ first_at :
    // le filtre sur updated_at prend l'index uap_user_recent.
    new_artist: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT al.artist_id FROM user_album_progress p
      JOIN cat_albums al ON al.id = p.album_id
      WHERE p.user_id = ? AND p.updated_at >= ? AND p.first_at >= ? AND p.first_at < ?
        AND NOT EXISTS (SELECT 1 FROM cat_albums a2 JOIN user_album_progress p2 ON p2.user_id = p.user_id AND p2.album_id = a2.id
          WHERE a2.artist_id = al.artist_id AND p2.first_at < ?)
      LIMIT ?)`, u, s, s, e, s, l),
    complete_album: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM achievements WHERE user_id = ? AND created_at >= ?
      AND created_at < ? AND key >= 'album:' AND key < 'album;' LIMIT ?)`, u, s, e, l),
    rate_albums: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ratings WHERE user_id = ? AND created_at >= ?
      AND created_at < ? AND item_type = 'album' LIMIT ?)`, u, s, e, l),
    rate_tracks: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ratings WHERE user_id = ? AND created_at >= ?
      AND created_at < ? AND item_type = 'track' LIMIT ?)`, u, s, e, l),
    write_review: (u, _p, s, e, l) => reviews(u, s, e, l),
    rate_genres: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT al.genre FROM ratings r JOIN cat_albums al ON al.id = r.item_id
      WHERE r.user_id = ? AND r.created_at >= ? AND r.created_at < ? AND r.item_type = 'album' AND al.genre IS NOT NULL LIMIT ?)`, u, s, e, l),
    battle_votes: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM battle_votes WHERE user_id = ? AND created_at >= ?
      AND created_at < ? AND counted = 1 LIMIT ?)`, u, s, e, l),
    blindtest_play: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM blindtest_games WHERE user_id = ? AND finished_at >= ?
      AND finished_at < ? LIMIT ?)`, u, s, e, l),
    blindtest_score: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM blindtest_games WHERE user_id = ? AND finished_at >= ?
      AND finished_at < ? AND correct >= ? LIMIT ?)`, u, s, e, BLINDTEST_GOOD, l),
    // Éléments ajoutés à mes listes et à « Mes 9 albums » (pas la liste d'envies) ; une liste modifiée dans la fenêtre a
    // un updated_at dans la fenêtre (index lists_user).
    add_to_list: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM lists l JOIN list_items li ON li.list_id = l.id
      WHERE l.user_id = ? AND l.updated_at >= ? AND l.kind IN ('list', 'grid9') AND li.added_at >= ? AND li.added_at < ? LIMIT ?)`, u, s, s, e, l),
    post: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM posts WHERE user_id = ? AND created_at >= ? AND created_at < ?
      AND hidden_at IS NULL LIMIT ?)`, u, s, e, l),
    comment: (u, _p, s, e, l) => n(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM comments WHERE user_id = ? AND created_at >= ? AND created_at < ?
      AND hidden_at IS NULL AND deleted_at IS NULL LIMIT ?)`, u, s, e, l),
    onboarded: (u) => n('SELECT COUNT(*) AS n FROM users WHERE id = ? AND onboarded_at IS NOT NULL', u),
    add_friend: (u) => n(`SELECT (EXISTS (SELECT 1 FROM friendships WHERE requester_id = ? AND status = 'accepted')
      OR EXISTS (SELECT 1 FROM friendships WHERE addressee_id = ? AND status = 'accepted')) AS n`, u, u),
  };

  /** Progression d'une quête lue (parseQuest) dans une fenêtre, bornée à sa cible. */
  function progressOf(userId, parsed, win) {
    const counter = COUNTERS[parsed.def.metric];
    if (!counter) return 0;
    return Math.min(parsed.def.target, counter(userId, metricParams(parsed), win.start, win.end, parsed.def.target));
  }

  // ----- tirage et lecture ------------------------------------------------------------------------------

  /** Contexte du tirage : a-t-il des amis (quêtes sociales) ; ses genres favoris (onboarding, sinon ses cartes). */
  function contextOf(userId) {
    const hasFriends = !!COUNTERS.add_friend(userId);
    let genres = q("SELECT item_id FROM user_favorites WHERE user_id = ? AND kind = 'genre' ORDER BY position, created_at LIMIT 3")
      .all(userId).map((r) => r.item_id);
    if (!genres.length) {
      // Les 200 albums les plus récemment enrichis suffisent à dire ce qu'il écoute (index uap_user_recent).
      genres = q(`SELECT al.genre AS g, SUM(r.owned) AS n FROM (SELECT album_id, owned FROM user_album_progress WHERE user_id = ?
        ORDER BY updated_at DESC LIMIT 200) r JOIN cat_albums al ON al.id = r.album_id WHERE al.genre IS NOT NULL
        GROUP BY al.genre ORDER BY n DESC, al.genre LIMIT 3`).all(userId).map((r) => r.g);
    }
    return { hasFriends, genres };
  }

  const rowsOf = (userId, periodKey) => q(`SELECT slot, quest_id, rerolled, claimed_at, reward, created_at FROM user_quests
    WHERE user_id = ? AND period_key = ? ORDER BY slot`).all(userId, periodKey);

  /** Lignes de la période ; les quêtes manquantes sont tirées et écrites à la première lecture. */
  function ensure(userId, periodKey, scope) {
    const rows = rowsOf(userId, periodKey);
    const wanted = scope === 'first' ? FIRST_STEPS.length : QUEST_SLOTS;
    const have = new Set(rows.filter((r) => r.slot < BONUS_SLOT).map((r) => r.slot));
    if (have.size >= wanted) return rows;
    const rolled = rollQuests(userId, periodKey, scope, scope === 'first' ? {} : contextOf(userId));
    const ins = q(`INSERT OR IGNORE INTO user_quests (user_id, period_key, slot, quest_id, rerolled, created_at)
      VALUES (?, ?, ?, ?, 0, ?)`);
    const now = Date.now();
    for (const r of rolled) if (!have.has(r.slot)) ins.run(userId, periodKey, r.slot, r.questId, now);
    return rowsOf(userId, periodKey);
  }

  /** Quest (PLAN.md 4.2.6) d'une ligne de user_quests ; null si la quête n'existe plus. */
  function questView(userId, row, win) {
    const parsed = parseQuest(row.quest_id);
    if (!parsed) return null;
    const { def, vars } = parsed;
    const claimed = row.claimed_at != null;
    const progress = claimed ? def.target : progressOf(userId, parsed, win);
    return {
      slot: row.slot,
      id: row.quest_id,
      defId: def.id,
      scope: def.scope,
      category: def.category,
      metric: def.metric,
      target: def.target,
      progress,
      done: progress >= def.target,
      claimed,
      claimedAt: row.claimed_at ?? null,
      rerolled: !!row.rerolled,
      reward: claimed ? parse(row.reward, rewardOf(def)) : rewardOf(def),
      vars,
    };
  }

  const bonusReward = (scope) => (scope === 'daily' ? { boosters: BONUS_REWARDS.daily.boosters } : { themed: BONUS_REWARDS.weekly.themed });

  /** Une période (jour ou semaine) : { periodKey, startsAt, endsAt, slots, rerollsLeft?, bonus }. */
  function periodView(userId, scope, period) {
    const rows = ensure(userId, period.key, scope);
    const slots = rows.filter((r) => r.slot < QUEST_SLOTS).map((r) => questView(userId, r, period)).filter(Boolean);
    const bonusRow = rows.find((r) => r.slot === BONUS_SLOT);
    const allClaimed = slots.length === QUEST_SLOTS && slots.every((s) => s.claimed);
    const out = {
      periodKey: period.key,
      startsAt: period.start,
      endsAt: period.end,
      slots,
      bonus: {
        claimable: allClaimed && !bonusRow,
        claimed: !!bonusRow,
        reward: bonusRow ? parse(bonusRow.reward, bonusReward(scope)) : bonusReward(scope),
      },
    };
    if (scope === 'daily') out.rerollsLeft = Math.max(0, FREE_REROLLS - rows.filter((r) => r.rerolled).length);
    return out;
  }

  /** GET /api/quests : { daily, weekly, firstSteps, serverTime } (au plus 13 comptages bornés). */
  function list(userId) {
    const now = current();
    const first = ensure(userId, FIRST_KEY, 'first');
    const firstDone = first.length >= FIRST_STEPS.length && first.every((r) => r.claimed_at != null);
    return {
      daily: periodView(userId, 'daily', now.daily),
      weekly: periodView(userId, 'weekly', now.weekly),
      firstSteps: firstDone ? [] : first.map((r) => questView(userId, r, windowOf(FIRST_KEY))).filter(Boolean),
      serverTime: Date.now(),
    };
  }

  const slotOf = (raw, scope) => {
    const slot = SLOT_RE.test(String(raw)) ? Number(raw) : -1;
    const max = scope === 'first' ? FIRST_STEPS.length : QUEST_SLOTS;
    if (slot < 0 || slot >= max) throw new HttpError(404, 'quest_not_found');
    return slot;
  };

  const rowOf = (userId, periodKey, slot) => q(`SELECT slot, quest_id, rerolled, claimed_at, reward FROM user_quests
    WHERE user_id = ? AND period_key = ? AND slot = ?`).get(userId, periodKey, slot);

  /** Applique une récompense dans la transaction en cours : royalties, boosters bonus, booster thématique, XP. */
  function grant(user, reward, source) {
    const royalties = Math.max(0, Math.floor(reward.royalties || 0));
    const boosters = Math.max(0, Math.floor(reward.boosters || 0));
    if (royalties || boosters) {
      q('UPDATE users SET royalties = royalties + ?, bonus_packs = bonus_packs + ? WHERE id = ?').run(royalties, boosters, user.id);
      user.royalties += royalties;
      user.bonus_packs += boosters;
    }
    if (reward.theme) services.insertBooster(user.id, 'theme', reward.theme, source);
    return services.gainXp(user, reward.xp || 0, source);
  }

  /** POST /api/quests/:periodKey/:slot/claim → { reward, quest, levelUp }. */
  function claim(userId, periodKey, rawSlot) {
    const scope = liveScope(periodKey);
    const slot = slotOf(rawSlot, scope);
    const win = scope === 'first' ? windowOf(FIRST_KEY) : current()[scope];
    // La ligne existe dès la première lecture de la période ; on la tire ici aussi (réclamation sans lecture).
    ensure(userId, periodKey, scope);
    const result = services.atomic(() => {
      const row = rowOf(userId, periodKey, slot);
      const parsed = row && parseQuest(row.quest_id);
      if (!parsed) throw new HttpError(404, 'quest_not_found');
      if (row.claimed_at != null) throw new HttpError(409, 'already_claimed');
      const progress = progressOf(userId, parsed, win);
      if (progress < parsed.def.target) throw new HttpError(409, 'quest_not_done', { progress, target: parsed.def.target });
      const reward = rewardOf(parsed.def);
      const now = Date.now();
      const done = q(`UPDATE user_quests SET claimed_at = ?, reward = ? WHERE user_id = ? AND period_key = ? AND slot = ?
        AND claimed_at IS NULL`).run(now, json(reward), userId, periodKey, slot);
      if (!done.changes) throw new HttpError(409, 'already_claimed');
      const user = services.getUser(userId);
      const levelUp = grant(user, reward, `quest:${scope === 'first' ? 'f' : scope[0]}`);
      return { reward, levelUp, row: { ...row, claimed_at: now, reward: json(reward) } };
    });
    deps.bus.emit('quest.claimed', { userId, periodKey, slot });
    return { reward: result.reward, quest: questView(userId, result.row, win), levelUp: result.levelUp };
  }

  /** POST /api/quests/:periodKey/:slot/reroll → { quest, rerollsLeft } (une relance gratuite par jour). */
  function reroll(userId, periodKey, rawSlot) {
    const scope = liveScope(periodKey);
    if (scope !== 'daily') throw new HttpError(409, 'no_reroll');
    const slot = slotOf(rawSlot, scope);
    const win = current().daily;
    ensure(userId, periodKey, scope);
    const context = contextOf(userId);
    return deps.tx(() => {
      const rows = rowsOf(userId, periodKey);
      const used = rows.filter((r) => r.rerolled).length;
      if (used >= FREE_REROLLS) throw new HttpError(409, 'no_reroll');
      const row = rows.find((r) => r.slot === slot);
      if (!row) throw new HttpError(404, 'quest_not_found');
      if (row.claimed_at != null) throw new HttpError(409, 'already_claimed');
      const next = rerollQuest(userId, periodKey, scope, slot, row.quest_id, context);
      if (!next) throw new HttpError(409, 'no_reroll');
      q('UPDATE user_quests SET quest_id = ?, rerolled = 1 WHERE user_id = ? AND period_key = ? AND slot = ? AND claimed_at IS NULL')
        .run(next, userId, periodKey, slot);
      return { quest: questView(userId, { ...row, quest_id: next, rerolled: 1 }, win), rerollsLeft: Math.max(0, FREE_REROLLS - used - 1) };
    });
  }

  /** Genre favori du joueur (booster thématique de la semaine) ; « À ton goût » s'il n'en a pas encore. */
  function themeOf(userId) {
    const g = contextOf(userId).genres[0];
    return g ? `genre:${g}` : 'taste';
  }

  /** POST /api/quests/bonus/:periodKey → { reward } quand les 3 quêtes de la période sont réclamées. */
  function claimBonus(userId, periodKey) {
    const scope = liveScope(periodKey);
    if (scope === 'first') throw new HttpError(409, 'bonus_locked');
    const theme = scope === 'weekly' ? themeOf(userId) : null;
    const result = services.atomic(() => {
      const rows = rowsOf(userId, periodKey);
      if (rows.some((r) => r.slot === BONUS_SLOT)) throw new HttpError(409, 'already_claimed');
      const claimed = rows.filter((r) => r.slot < QUEST_SLOTS && r.claimed_at != null).length;
      if (claimed < QUEST_SLOTS) throw new HttpError(409, 'bonus_locked', { claimed, needed: QUEST_SLOTS });
      const reward = scope === 'daily' ? { boosters: BONUS_REWARDS.daily.boosters } : { theme, themed: BONUS_REWARDS.weekly.themed };
      const now = Date.now();
      q(`INSERT INTO user_quests (user_id, period_key, slot, quest_id, rerolled, claimed_at, reward, created_at)
        VALUES (?, ?, ?, 'bonus', 0, ?, ?, ?)`).run(userId, periodKey, BONUS_SLOT, now, json(reward), now);
      grant(services.getUser(userId), reward, `quest:${scope[0]}:bonus`);
      return { reward };
    });
    return result;
  }

  /** Progression d'une quête du joueur dans une période (tests, outils). */
  function progress(userId, questId, periodKey) {
    const parsed = parseQuest(questId);
    const win = windowOf(periodKey);
    return parsed && win ? progressOf(userId, parsed, win) : null;
  }

  return { list, claim, reroll, claimBonus, progress, windowOf };
}

export function routes(r, deps) {
  const { limits, services } = deps;
  const api = () => deps.quests;
  const partial = (req) => services.state(req.user.id, { partial: true });
  /** Badges gagnés pendant la requête (Assidu…), pour le message du site. */
  const earned = (req, since) => deps.badges?.earnedSince?.(req.user.id, since) ?? [];

  r.get('/quests', limits.read, (req, res) => res.json(api().list(req.user.id)));
  r.post('/quests/bonus/:periodKey', limits.write, (req, res) => {
    const since = Date.now();
    const result = api().claimBonus(req.user.id, req.params.periodKey);
    res.json({ ...result, badgesEarned: earned(req, since), state: partial(req) });
  });
  r.post('/quests/:periodKey/:slot/claim', limits.write, (req, res) => {
    const since = Date.now();
    const result = api().claim(req.user.id, req.params.periodKey, req.params.slot);
    res.json({ ...result, badgesEarned: earned(req, since), state: partial(req) });
  });
  r.post('/quests/:periodKey/:slot/reroll', limits.write, (req, res) => res.json(api().reroll(req.user.id, req.params.periodKey, req.params.slot)));
}
