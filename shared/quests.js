// Quêtes quotidiennes, hebdomadaires et « Premiers pas » (PLAN.md 5.6, 6.7) — chantier P1-F. Partagé par le serveur
// (server/quests.js), la démo (client/src/demo/mock/quests.js) et le site (textes, anneaux de progression).
//
// Une définition : { id, scope: 'daily' | 'weekly' | 'first', category: 'collect' | 'rate' | 'discover', metric, target,
// params?, vary?, social?, weight, reward: { royalties, xp, boosters? } }. `vary` ('genre' | 'decade') : la valeur est
// tirée au moment du tirage et gardée dans l'identifiant de la quête du joueur (« d-genre:electro ») ; `social` : la
// quête n'est tirée que pour un joueur qui a au moins un ami. La progression se calcule toujours depuis les tables
// sources (cartes, notes, votes…) dans la fenêtre de la période : rien n'est compté à part, rien ne dérive.
// Périodes (shared/periods.js, heure de Paris) : jour `d:2026-10-06`, semaine ISO `w:2026-W41`, `first` (sans fin).
// Les récompenses suivent l'économie (PLAN.md 6.7) : aucun jour n'est « perdu », rien ne punit une absence.

export const QUEST_SCOPES = ['daily', 'weekly', 'first'];
export const QUEST_CATEGORIES = ['collect', 'rate', 'discover'];
/** Quêtes tirées par période (une par catégorie, dans l'ordre de QUEST_CATEGORIES). */
export const QUEST_SLOTS = 3;
/** Ligne de user_quests qui garde le bonus de la période (« Bonus du jour », booster thématique de la semaine). */
export const BONUS_SLOT = 9;
/** Relances gratuites par jour (quêtes du jour seulement). */
export const FREE_REROLLS = 1;
/** Clé de période des « Premiers pas ». */
export const FIRST_KEY = 'first';

/** Récompenses des quêtes du jour par catégorie, de la semaine, et des bonus de fin de période (PLAN.md 6.7). */
export const DAILY_REWARDS = {
  collect: { royalties: 40, xp: 30 },
  rate: { royalties: 50, xp: 30 },
  discover: { royalties: 60, xp: 40 },
};
export const WEEKLY_REWARD = { royalties: 100, xp: 100 };
/** Les 3 quêtes du jour réclamées : un booster bonus ; les 3 de la semaine : un booster thématique (ton genre favori). */
export const BONUS_REWARDS = { daily: { boosters: 1 }, weekly: { themed: 1 } };

/** Raretés qui comptent pour « Obtiens 2 cartes rares ou mieux ». */
export const RARE_OR_BETTER = ['rare', 'super', 'ultra', 'legendary', 'promo'];
/** Décennies proposées par une quête « des années 90 » (celles du catalogue où il y a de quoi faire). */
export const QUEST_DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020];
/** Genres proposés quand le joueur n'a pas encore de goûts connus (mêmes clés que shared/rules.js THEME_GENRES). */
export const QUEST_GENRES = ['pop', 'rock', 'rap', 'electro', 'soul', 'jazz', 'reggae', 'chanson', 'latin', 'metal', 'country', 'classical', 'soundtrack', 'world'];
/** Une critique compte pour une quête à partir de 140 caractères, avec au moins 40 % de mots différents. */
export const REVIEW_MIN_CHARS = 140;
export const REVIEW_MIN_VARIETY = 0.4;
/** Blind test « réussi » : au moins 4 bonnes réponses sur 5. */
export const BLINDTEST_GOOD = 4;

/**
 * Métriques et leur source (PLAN.md 5.6). Les « J'aime » ne sont jamais une métrique (ils récompenseraient le spam).
 * `icon` : icône de l'anneau sur le site (components/ui.jsx).
 */
export const METRICS = {
  open_boosters: { icon: 'pack' },
  new_cards: { icon: 'grid' },
  new_artist: { icon: 'compass' },
  complete_album: { icon: 'disc' },
  rate_albums: { icon: 'star' },
  rate_tracks: { icon: 'star' },
  write_review: { icon: 'quote' },
  rate_genres: { icon: 'star' },
  battle_votes: { icon: 'trophy' },
  blindtest_play: { icon: 'headphones' },
  blindtest_score: { icon: 'headphones' },
  add_to_list: { icon: 'list' },
  post: { icon: 'comment' },
  comment: { icon: 'comment' },
  onboarded: { icon: 'user' },
  add_friend: { icon: 'users' },
};

const daily = (category, def) => ({ scope: 'daily', category, weight: 1, reward: DAILY_REWARDS[category], ...def });
const weekly = (category, def) => ({ scope: 'weekly', category, weight: 1, reward: WEEKLY_REWARD, ...def });

/** Toutes les quêtes. L'identifiant ne change jamais (il est gardé dans user_quests). */
export const QUESTS = [
  // ----- du jour : collectionner -----
  daily('collect', { id: 'd-open', metric: 'open_boosters', target: 3, weight: 3 }),
  daily('collect', { id: 'd-cards', metric: 'new_cards', target: 8, weight: 3 }),
  daily('collect', { id: 'd-rare', metric: 'new_cards', params: { rarities: RARE_OR_BETTER }, target: 2, weight: 2 }),
  daily('collect', { id: 'd-genre', metric: 'new_cards', vary: 'genre', target: 3, weight: 2 }),
  daily('collect', { id: 'd-decade', metric: 'new_cards', vary: 'decade', target: 3, weight: 1 }),
  // ----- du jour : noter -----
  daily('rate', { id: 'd-rate', metric: 'rate_albums', target: 3, weight: 3 }),
  daily('rate', { id: 'd-tracks', metric: 'rate_tracks', target: 5, weight: 2 }),
  daily('rate', { id: 'd-review', metric: 'write_review', target: 1, weight: 1 }),
  daily('rate', { id: 'd-genres', metric: 'rate_genres', target: 2, weight: 1 }),
  // ----- du jour : découvrir et partager -----
  daily('discover', { id: 'd-artist', metric: 'new_artist', target: 1, weight: 3 }),
  daily('discover', { id: 'd-battles', metric: 'battle_votes', target: 10, weight: 3 }),
  daily('discover', { id: 'd-blindtest', metric: 'blindtest_play', target: 1, weight: 2 }),
  daily('discover', { id: 'd-list', metric: 'add_to_list', target: 1, weight: 1 }),
  daily('discover', { id: 'd-post', metric: 'post', target: 1, weight: 1, social: true }),
  daily('discover', { id: 'd-comment', metric: 'comment', target: 2, weight: 1, social: true }),
  // ----- de la semaine -----
  weekly('collect', { id: 'w-cards', metric: 'new_cards', target: 40, weight: 3 }),
  weekly('collect', { id: 'w-open', metric: 'open_boosters', target: 15, weight: 2 }),
  weekly('collect', { id: 'w-complete', metric: 'complete_album', target: 1, weight: 2 }),
  weekly('collect', { id: 'w-genre', metric: 'new_cards', vary: 'genre', target: 12, weight: 2 }),
  weekly('rate', { id: 'w-rate', metric: 'rate_albums', target: 10, weight: 3 }),
  weekly('rate', { id: 'w-reviews', metric: 'write_review', target: 3, weight: 2 }),
  weekly('rate', { id: 'w-genres', metric: 'rate_genres', target: 4, weight: 2 }),
  weekly('rate', { id: 'w-tracks', metric: 'rate_tracks', target: 20, weight: 1 }),
  weekly('discover', { id: 'w-artists', metric: 'new_artist', target: 5, weight: 3 }),
  weekly('discover', { id: 'w-battles', metric: 'battle_votes', target: 50, weight: 2 }),
  weekly('discover', { id: 'w-blindtest', metric: 'blindtest_score', target: 2, weight: 2 }),
  weekly('discover', { id: 'w-lists', metric: 'add_to_list', target: 5, weight: 1 }),
  weekly('discover', { id: 'w-posts', metric: 'post', target: 3, weight: 1, social: true }),
  weekly('discover', { id: 'w-comments', metric: 'comment', target: 5, weight: 1, social: true }),
];

/**
 * « Premiers pas » : sept petites quêtes, une seule fois, montrées tant qu'elles ne sont pas toutes réclamées
 * (≈ 2 boosters et 300 royalties en tout : un nouveau compte complète vite son premier album). Ordre = slot.
 */
export const FIRST_STEPS = [
  { id: 'f-onboard', metric: 'onboarded', target: 1, reward: { royalties: 30, xp: 20 } },
  { id: 'f-rate', metric: 'rate_albums', target: 5, reward: { royalties: 50, xp: 30 } },
  { id: 'f-open', metric: 'open_boosters', target: 1, reward: { royalties: 30, xp: 20 } },
  { id: 'f-friend', metric: 'add_friend', target: 1, reward: { royalties: 40, xp: 20, boosters: 1 } },
  { id: 'f-review', metric: 'write_review', target: 1, reward: { royalties: 50, xp: 30 } },
  { id: 'f-battles', metric: 'battle_votes', target: 5, reward: { royalties: 40, xp: 20 } },
  { id: 'f-complete', metric: 'complete_album', target: 1, reward: { royalties: 60, xp: 40, boosters: 1 } },
].map((q) => ({ ...q, scope: 'first', category: 'first', weight: 0 }));

const BY_ID = new Map([...QUESTS, ...FIRST_STEPS].map((q) => [q.id, q]));

/** Définition d'une quête par son identifiant (sans la valeur tirée). */
export const questDef = (id) => BY_ID.get(String(id || '').split(':')[0]) || null;

/**
 * Identifiant d'une quête du joueur → { def, vars } (vars : { genre } ou { decade }) ; null s'il est inconnu ou si la
 * valeur tirée n'est pas valide (une quête retirée du jeu disparaît simplement de la liste).
 */
export function parseQuest(questId) {
  const [base, value] = String(questId || '').split(':');
  const def = BY_ID.get(base);
  if (!def) return null;
  if (!def.vary) return value === undefined ? { def, vars: {} } : null;
  if (def.vary === 'genre' && QUEST_GENRES.includes(value)) return { def, vars: { genre: value } };
  if (def.vary === 'decade' && QUEST_DECADES.includes(Number(value))) return { def, vars: { decade: Number(value) } };
  return null;
}

/** Paramètres effectifs de la métrique : ceux de la définition, plus la valeur tirée. */
export const metricParams = ({ def, vars }) => ({ ...(def.params || {}), ...vars });

/** Portée d'une clé de période : 'daily' (d:…), 'weekly' (w:…), 'first', 'event' (e:…, P2) ou null. */
export function scopeOfKey(key) {
  const s = String(key || '');
  if (/^d:\d{4}-\d{2}-\d{2}$/.test(s)) return 'daily';
  if (/^w:\d{4}-W\d{2}$/.test(s)) return 'weekly';
  if (s === FIRST_KEY) return 'first';
  if (/^e:[a-z0-9][a-z0-9-]{0,39}$/.test(s)) return 'event';
  return null;
}

// ----- tirage déterministe ---------------------------------------------------------------------------

/** Empreinte 32 bits (FNV-1a) d'une chaîne. */
export function hash32(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Générateur pseudo-aléatoire (mulberry32) : même graine, même suite. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Graine d'un tirage : hash(userId, periodKey[, sel]). */
export const questSeed = (userId, periodKey, salt = '') => hash32(`${userId}|${periodKey}|${salt}`);

function weighted(list, rng) {
  const total = list.reduce((s, q) => s + q.weight, 0);
  let roll = rng() * total;
  for (const q of list) {
    roll -= q.weight;
    if (roll < 0) return q;
  }
  return list[list.length - 1];
}

/** Valeur tirée d'une quête « vary » : un des genres du joueur (ses 3 favoris) s'il en a, sinon tout le catalogue. */
function varyValue(def, rng, { genres = [] } = {}) {
  if (def.vary === 'genre') {
    const own = genres.filter((g) => QUEST_GENRES.includes(g));
    const pool = own.length ? own : QUEST_GENRES;
    return pool[Math.floor(rng() * pool.length)];
  }
  if (def.vary === 'decade') return QUEST_DECADES[Math.floor(rng() * QUEST_DECADES.length)];
  return null;
}

const idWith = (def, value) => (value == null ? def.id : `${def.id}:${value}`);

/** Quêtes possibles d'une portée et d'une catégorie pour ce joueur (sans ami : aucune quête sociale). */
export function candidates(scope, category, { hasFriends = false } = {}) {
  return QUESTS.filter((q) => q.scope === scope && q.category === category && (!q.social || hasFriends));
}

/**
 * Tirage des quêtes d'une période : une par catégorie, avec un générateur graine hash(userId, periodKey). Même joueur,
 * même période, même contexte → mêmes quêtes. `context` : { hasFriends, genres (favoris, au plus 3) }.
 * Renvoie [{ slot, questId }].
 */
export function rollQuests(userId, periodKey, scope, context = {}) {
  if (scope === 'first') return FIRST_STEPS.map((def, slot) => ({ slot, questId: def.id }));
  const rng = seededRandom(questSeed(userId, periodKey));
  return QUEST_CATEGORIES.map((category, slot) => {
    const def = weighted(candidates(scope, category, context), rng);
    return { slot, questId: idWith(def, varyValue(def, rng, context)) };
  });
}

/**
 * Relance d'une quête : une autre quête de la même catégorie (jamais la même définition), graine
 * hash(userId, periodKey, 'reroll:<slot>'). Renvoie l'identifiant de la nouvelle quête, ou null s'il n'y en a pas.
 */
export function rerollQuest(userId, periodKey, scope, slot, currentId, context = {}) {
  const category = QUEST_CATEGORIES[slot];
  const current = questDef(currentId);
  const list = candidates(scope, category, context).filter((q) => q.id !== current?.id);
  if (!list.length) return null;
  const rng = seededRandom(questSeed(userId, periodKey, `reroll:${slot}`));
  const def = weighted(list, rng);
  return idWith(def, varyValue(def, rng, context));
}

// ----- textes de critique -------------------------------------------------------------------------------

/** Critique qui compte pour une quête : assez longue et pas répétitive (mots différents / mots ≥ 0,4). */
export function reviewCounts(text) {
  const s = String(text || '');
  if ([...s].length < REVIEW_MIN_CHARS) return false;
  const words = s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length < 5) return false;
  return new Set(words).size / words.length >= REVIEW_MIN_VARIETY;
}

/** Récompense d'une quête (copie, pour la réponse). */
export const rewardOf = (def) => ({ royalties: def.reward.royalties || 0, xp: def.reward.xp || 0, ...(def.reward.boosters ? { boosters: def.reward.boosters } : {}) });
