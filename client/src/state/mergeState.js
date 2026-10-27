// Fusion des réponses de l'API dans l'état du joueur (PLAN.md 4.1.1). Fonctions pures, sans React ni alias de
// Vite : le serveur les teste telles quelles (server/test/foundation.test.js) pour vérifier qu'après une suite
// d'actions, l'état fusionné est égal à un GET /api/state tout neuf.
//
// Une action renvoie `state` partiel : { partial: true, user, packs, counts, stats: { summary }, serverTime },
// et ses deltas dans la réponse : `cards` [{ trackId, variant, rarity, newTrack, newVariant }], `at` (date des
// nouvelles cartes et des succès), `achievements` [{ key, rank? }], `albumDeltas` [{ albumId, after, total }],
// `artistDeltas` [{ artistId, after, total }], `rating` { type, id, score | null }. Deltas qui retirent des
// exemplaires (P2-E) : `cardCounts` [{ t, v, c, at?, r? }] (nombre d'exemplaires après l'action, c = 0 : version
// plus possédée ; Vernir, Comptoir) et `dedupe: true` (recyclage : chaque carte revient à un exemplaire).
// Un état complet (`partial` absent ou false) remplace tout ; celui d'un gros collectionneur arrive compacté
// (`packed`, server/services.js packCollection) et se déplie ici (unpackState), sous la même forme qu'un autre.

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

/**
 * Cartes après des nombres d'exemplaires donnés (`counts` : [{ t, v, c, at?, r? }]) : la version prend ce nombre,
 * disparaît à 0, arrive si elle manquait (avec sa date et sa rareté).
 */
export function applyCardCounts(list = [], counts = []) {
  if (!counts.length) return list;
  const wanted = new Map(counts.filter((x) => x?.t && x.v).map((x) => [`${x.t}|${x.v}`, x]));
  const next = [];
  for (const c of list) {
    const key = `${c.t}|${c.v}`;
    const w = wanted.get(key);
    if (!w) next.push(c);
    else {
      wanted.delete(key);
      if (w.c > 0) next.push({ ...c, c: w.c });
    }
  }
  for (const w of wanted.values()) if (w.c > 0) next.push({ t: w.t, v: w.v, c: w.c, at: w.at, r: w.r });
  return next;
}

/** Recyclage des doublons : chaque carte garde un exemplaire. */
export function dedupeCards(list = []) {
  return list.some((c) => c.c > 1) ? list.map((c) => (c.c > 1 ? { ...c, c: 1 } : c)) : list;
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

/**
 * Déplie la collection compactée d'un gros collectionneur (`packed`, format v 1 de server/services.js,
 * packCollection) : `cards`, `achievements`, `stats.albums` et `stats.artists`, exactement comme un état normal.
 * Un état sans `packed` est rendu tel quel.
 */
export function unpackState(state) {
  const p = state?.packed;
  if (!p || p.v !== 1) return state;
  const cards = [];
  // Version et rareté : un chiffre en base 36 chacun.
  const variants = new Map((p.variants || []).map((v, i) => [i.toString(36), v]));
  const rarities = new Map((p.rarities || []).map((r, i) => [i.toString(36), r]));
  for (const [prefix, line] of Object.entries(p.cards || {})) {
    let at = p.t0;
    if (!line) continue;
    for (const entry of line.split(',')) {
      const dot = entry.indexOf('.');
      if (dot < 1 || entry.length < dot + 3) continue;
      const tilde = entry.indexOf('~', dot + 3);
      const count = tilde < 0 ? entry.slice(dot + 3) : entry.slice(dot + 3, tilde);
      if (tilde >= 0) at += parseInt(entry.slice(tilde + 1), 36);
      cards.push({ t: prefix + entry.slice(0, dot), v: variants.get(entry[dot + 1]), c: count ? Number(count) : 1, at, r: rarities.get(entry[dot + 2]) });
    }
  }
  for (const c of p.rest || []) cards.push({ ...c });
  const ratios = (list) => Object.fromEntries((list || []).map(([id, owned, total]) => [id, { owned, total, pct: total ? owned / total : 0 }]));
  const { packed: _packed, ...rest } = state;
  return {
    ...rest,
    cards,
    achievements: (p.achievements || []).map(([key, at, rank]) => ({ key, at, rank: rank ?? null })),
    stats: { ...state.stats, albums: ratios(p.albums), artists: ratios(p.artists) },
  };
}

/** Normalise un état complet reçu du serveur (collection compactée dépliée ; anciens serveurs : pendingFriends sans counts). */
export function fullState(state) {
  const open = unpackState(state);
  const counts = open.counts || { pendingFriends: open.pendingFriends || 0, unread: 0 };
  return { ...open, counts, pendingFriends: counts.pendingFriends, partial: false };
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
  let cards = current.cards;
  if (response.dedupe === true) cards = dedupeCards(cards);
  if (Array.isArray(response.cards) && response.cards.length && response.cards[0]?.trackId) cards = mergeCards(cards, response.cards, at);
  const before = cards;
  if (Array.isArray(response.cardCounts) && response.cardCounts.length) cards = applyCardCounts(cards, response.cardCounts);
  if (cards !== current.cards) next.cards = cards;
  if (Array.isArray(response.achievements)) next.achievements = mergeAchievements(current.achievements, response.achievements, at);
  if (response.rating) next.ratings = mergeRating(current.ratings, response.rating);
  next.stats = mergeStats(next.stats, null, response);
  if (cards !== before) next.stats = dropLostTracks(next.stats, before, cards);
  return next;
}

/**
 * Cartes dont plus aucune version n'est possédée après un delta `cardCounts` : une de moins dans leur rareté (les
 * albums et artistes touchés arrivent, eux, en albumDeltas / artistDeltas). Le total vient du résumé du serveur.
 */
function dropLostTracks(stats, before, after) {
  if (!stats?.byRarity) return stats;
  const still = new Set(after.map((c) => c.t));
  const lost = new Map();
  for (const c of before) if (!still.has(c.t) && !lost.has(c.t)) lost.set(c.t, c.r);
  if (!lost.size) return stats;
  const byRarity = { ...stats.byRarity };
  for (const r of lost.values()) {
    const entry = byRarity[r];
    if (entry) byRarity[r] = { ...entry, owned: Math.max(0, entry.owned - 1) };
  }
  const next = { ...stats, byRarity };
  if (next.promos && byRarity.promo) next.promos = ratio(byRarity.promo.owned, next.promos.total);
  return next;
}
