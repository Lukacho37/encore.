// Fusion des réponses de l'API dans l'état du joueur (PLAN.md 4.1.1). Fonctions pures, sans React ni alias de
// Vite : le serveur les teste telles quelles (server/test/foundation.test.js) pour vérifier qu'après une suite
// d'actions, l'état fusionné est égal à un GET /api/state tout neuf.
//
// Une action renvoie `state` partiel : { partial: true, user, packs, counts, stats: { summary }, serverTime },
// et ses deltas dans la réponse : `cards` [{ trackId, variant, rarity, newTrack, newVariant }], `at` (date des
// nouvelles cartes et des succès), `achievements` [{ key, rank? }], `albumDeltas` [{ albumId, after, total }],
// `artistDeltas` [{ artistId, after, total }], `rating` { type, id, score | null }. Un état complet
// (`partial` absent ou false) remplace tout.

const ratio = (owned, total) => ({ owned, total, pct: total ? owned / total : 0 });

/** Cartes du joueur ([{ t, v, c, at, r }]) après l'arrivée de `cards` (un exemplaire de plus par carte reçue). */
export function mergeCards(list = [], cards = [], at = Date.now()) {
  if (!cards.length) return list;
  const next = list.map((c) => ({ ...c }));
  const index = new Map(next.map((c, i) => [`${c.t}|${c.v}`, i]));
  for (const card of cards) {
    const key = `${card.trackId}|${card.variant}`;
    if (index.has(key)) next[index.get(key)].c += 1;
    else {
      index.set(key, next.length);
      next.push({ t: card.trackId, v: card.variant, c: 1, at, r: card.rarity });
    }
  }
  return next;
}

/** Succès du joueur ([{ key, at, rank }]) avec ceux qui viennent d'être obtenus. */
export function mergeAchievements(list = [], achievements = [], at = Date.now()) {
  if (!achievements.length) return list;
  const known = new Set(list.map((a) => a.key));
  const added = achievements.filter((a) => a?.key && !known.has(a.key)).map((a) => ({ key: a.key, at, rank: a.rank ?? null }));
  return added.length ? [...list, ...added] : list;
}

/** Notes du joueur ([{ t, i, s }]) après une note donnée (score) ou retirée (score null). */
export function mergeRating(list = [], rating) {
  if (!rating?.type || rating.id == null) return list;
  const rest = list.filter((r) => !(r.t === rating.type && r.i === rating.id));
  return rating.score == null ? rest : [...rest, { t: rating.type, i: rating.id, s: rating.score }];
}

/**
 * Statistiques de collection : le résumé du serveur (total, albums complétés, artistes maîtrisés, catalogue), plus
 * les cartes par rareté, les promos et la progression des albums et artistes touchés, déduites des deltas.
 */
export function mergeStats(stats, summary, response = {}) {
  if (!stats) return stats;
  const next = { ...stats };
  if (summary) {
    if (summary.total) next.total = { ...summary.total };
    if (summary.albumsCompleted != null) next.albumsCompleted = summary.albumsCompleted;
    if (summary.artistsMastered != null) next.artistsMastered = summary.artistsMastered;
    if (summary.catalog) next.catalog = { ...summary.catalog };
  }
  const fresh = (response.cards || []).filter((c) => c.newTrack);
  if (fresh.length && next.byRarity) {
    const byRarity = { ...next.byRarity };
    for (const c of fresh) {
      const entry = byRarity[c.rarity];
      if (entry) byRarity[c.rarity] = { ...entry, owned: entry.owned + 1 };
    }
    next.byRarity = byRarity;
    if (next.promos && byRarity.promo) next.promos = ratio(byRarity.promo.owned, next.promos.total);
  }
  if (response.albumDeltas?.length) {
    next.albums = { ...next.albums };
    for (const d of response.albumDeltas) next.albums[d.albumId] = ratio(d.after, d.total);
  }
  if (response.artistDeltas?.length) {
    next.artists = { ...next.artists };
    for (const d of response.artistDeltas) next.artists[d.artistId] = ratio(d.after, d.total);
  }
  return next;
}

/** Applique un état partiel (sans deltas) : joueur, boosters, pastilles, résumé des statistiques. */
export function mergePartial(current, partial) {
  const counts = partial.counts || current.counts;
  return {
    ...current,
    user: partial.user || current.user,
    packs: partial.packs || current.packs,
    counts,
    pendingFriends: counts?.pendingFriends ?? current.pendingFriends ?? 0,
    stats: mergeStats(current.stats, partial.stats?.summary),
    serverTime: partial.serverTime ?? current.serverTime,
    partial: false,
  };
}

/** Normalise un état complet reçu du serveur (anciens serveurs : pendingFriends sans counts). */
export function fullState(state) {
  const counts = state.counts || { pendingFriends: state.pendingFriends || 0, unread: 0 };
  return { ...state, counts, pendingFriends: counts.pendingFriends, partial: false };
}

/**
 * État après une réponse de l'API : `current` inchangé si la réponse n'a pas d'état ; l'état complet s'il est
 * complet ; sinon l'état partiel et les deltas de la réponse fusionnés. Renvoie null quand un état partiel arrive
 * sans état de départ (l'appelant recharge alors GET /api/state).
 */
export function mergeResponse(current, response) {
  const state = response?.state;
  if (!state || typeof state !== 'object') return current;
  if (!state.partial) return fullState(state);
  if (!current) return null;
  const at = response.at ?? state.serverTime ?? Date.now();
  const next = mergePartial(current, state);
  if (Array.isArray(response.cards) && response.cards.length && response.cards[0]?.trackId) next.cards = mergeCards(current.cards, response.cards, at);
  if (Array.isArray(response.achievements)) next.achievements = mergeAchievements(current.achievements, response.achievements, at);
  if (response.rating) next.ratings = mergeRating(current.ratings, response.rating);
  next.stats = mergeStats(next.stats, null, response);
  return next;
}
