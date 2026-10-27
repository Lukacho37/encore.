// Badges (médailles) choisis à la main (PLAN.md 5.7) — chantier P1-F. Partagé par le serveur (server/badges.js), la
// démo (client/src/demo/mock/badges.js) et le site (pages Badges, étagère de trophées du Studio).
//
// Un badge gagné est une ligne de `achievements` de clé `badge:<famille>[:<variante>]:<palier>` (data JSON
// { value, at }) ; les paliers vont du bronze au platine. Chaque famille a ses seuils, tous vérifiables en base par un
// comptage indexé et borné (le plus haut seuil sert de LIMIT). Une famille à variantes (décennies, genres) se décline
// en médailles distinctes ; « Fan de… » ne montre que les variantes gagnées. Récompenses : Bronze 50 XP · Argent
// 150 XP + 100 royalties · Or 400 XP + 1 booster bonus · Platine 1 000 XP + un cosmétique (un titre, shared/cosmetics.js).
// Aucun badge ne récompense une dépense de royalties.

export const TIERS = ['bronze', 'silver', 'gold', 'platinum'];
export const TIER_REWARDS = {
  bronze: { xp: 50, royalties: 0 },
  silver: { xp: 150, royalties: 100 },
  gold: { xp: 400, royalties: 0, boosters: 1 },
  platinum: { xp: 1000, royalties: 0 },
};
/** Décennies de l'Explorateur (7 variantes). */
export const BADGE_DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020];
export const BADGE_GENRES = ['pop', 'rock', 'rap', 'electro', 'soul', 'jazz', 'reggae', 'chanson', 'latin', 'metal', 'country', 'classical', 'soundtrack', 'world'];
/** Taste Match qui compte pour « Bonne entente ». */
export const FRIENDLY_SCORE = 85;
/** Une critique compte pour « Plume » à partir de 140 caractères. */
export const PEN_MIN_CHARS = 140;

/**
 * Familles (ordre d'affichage). `tiers` : [{ tier, target, metric? }] du plus facile au plus dur (`metric` quand un
 * palier ne mesure pas la même chose que le premier, comme l'Explorateur) ; `variants` : liste des variantes ;
 * `hiddenUntilEarned` : variantes montrées seulement une fois gagnées ; `events` : événements du bus qui la font
 * réévaluer ; `cosmetic` : titre offert au palier platine ; `group` : rubrique de la page Badges.
 */
export const FAMILIES = [
  { id: 'vinyl', group: 'collect', icon: 'disc', events: ['album.completed'], cosmetic: 'title:vinylophile',
    tiers: [{ tier: 'bronze', target: 1 }, { tier: 'silver', target: 10 }, { tier: 'gold', target: 50 }, { tier: 'platinum', target: 250 }] },
  { id: 'first_press', group: 'collect', icon: 'press', events: ['album.completed'],
    tiers: [{ tier: 'gold', target: 1 }] },
  { id: 'master', group: 'collect', icon: 'star', events: ['artist.mastered'], cosmetic: 'title:maitre',
    tiers: [{ tier: 'silver', target: 1 }, { tier: 'gold', target: 5 }, { tier: 'platinum', target: 20 }] },
  { id: 'legendary', group: 'collect', icon: 'star', events: ['cards.added'],
    tiers: [{ tier: 'bronze', target: 10 }, { tier: 'silver', target: 50 }, { tier: 'gold', target: 200 }] },
  { id: 'promo', group: 'collect', icon: 'flag', events: ['cards.added'],
    tiers: [{ tier: 'bronze', target: 5 }, { tier: 'silver', target: 25 }, { tier: 'gold', target: 100 }] },
  { id: 'explorer', group: 'collect', icon: 'compass', variants: BADGE_DECADES, events: ['cards.added', 'album.completed'],
    tiers: [{ tier: 'bronze', target: 10, metric: 'albums' }, { tier: 'silver', target: 3, metric: 'completed' }] },
  { id: 'eclectic', group: 'collect', icon: 'globe', events: ['cards.added'],
    tiers: [{ tier: 'silver', target: 10 }, { tier: 'gold', target: 14 }] },
  { id: 'genre_fan', group: 'collect', icon: 'headphones', variants: BADGE_GENRES, hiddenUntilEarned: true, events: ['album.completed'],
    tiers: [{ tier: 'silver', target: 5 }] },
  // Édition deluxe (P2-D, PLAN.md 6.3) : album complété, noté, et chacun de ses morceaux noté (succès deluxe:<albumId>).
  { id: 'deluxe', group: 'rate', icon: 'disc', events: ['deluxe.earned'], cosmetic: 'title:deluxe',
    tiers: [{ tier: 'gold', target: 1 }, { tier: 'platinum', target: 10 }] },
  { id: 'critic', group: 'rate', icon: 'star', events: ['rating.saved'], cosmetic: 'title:critique',
    tiers: [{ tier: 'bronze', target: 25 }, { tier: 'silver', target: 100 }, { tier: 'gold', target: 500 }] },
  { id: 'pen', group: 'rate', icon: 'quote', events: ['rating.saved'],
    tiers: [{ tier: 'silver', target: 10 }, { tier: 'gold', target: 50 }] },
  { id: 'popular_review', group: 'rate', icon: 'heart', events: ['like.created'],
    tiers: [{ tier: 'silver', target: 10 }, { tier: 'gold', target: 50 }] },
  { id: 'fine_ear', group: 'rate', icon: 'headphones', events: ['rating.saved'],
    tiers: [{ tier: 'bronze', target: 1 }, { tier: 'silver', target: 10 }] },
  { id: 'curator', group: 'social', icon: 'list', events: ['like.created'],
    tiers: [{ tier: 'silver', target: 10 }, { tier: 'gold', target: 50 }] },
  { id: 'nine', group: 'social', icon: 'grid', events: ['list.saved'],
    tiers: [{ tier: 'bronze', target: 1 }] },
  { id: 'friendly', group: 'social', icon: 'users', events: ['match.computed', 'friend.accepted'],
    tiers: [{ tier: 'silver', target: 3 }] },
  { id: 'blindtest', group: 'play', icon: 'headphones', events: ['blindtest.finished'],
    tiers: [{ tier: 'bronze', target: 1 }, { tier: 'silver', target: 10 }, { tier: 'gold', target: 50 }] },
  { id: 'judge', group: 'play', icon: 'trophy', events: ['battle.voted'], cosmetic: 'title:juge',
    tiers: [{ tier: 'bronze', target: 50 }, { tier: 'silver', target: 250 }, { tier: 'gold', target: 1000 }] },
  { id: 'steady', group: 'play', icon: 'check', events: ['quest.claimed'],
    tiers: [{ tier: 'silver', target: 7 }, { tier: 'gold', target: 30 }] },
];

// Les familles « platine » sans palier platine (critique, juge) offrent leur titre au palier le plus haut.
for (const f of FAMILIES) f.top = f.tiers[f.tiers.length - 1].tier;

export const BADGE_GROUPS = ['collect', 'rate', 'social', 'play'];
const BY_ID = new Map(FAMILIES.map((f) => [f.id, f]));
export const familyOf = (id) => BY_ID.get(id) || null;

/** Clé d'un badge : badge:<famille>[:<variante>]:<palier>. */
export const badgeKey = (family, variant, tier) => (variant == null || variant === '' ? `badge:${family}:${tier}` : `badge:${family}:${variant}:${tier}`);

/** Clé lue → { family, variant (null, nombre ou texte), tier } ; null si elle n'est pas celle d'un badge connu. */
export function parseBadgeKey(key) {
  const parts = String(key || '').split(':');
  if (parts[0] !== 'badge' || parts.length < 3 || parts.length > 4) return null;
  const f = BY_ID.get(parts[1]);
  if (!f) return null;
  const tier = parts[parts.length - 1];
  if (!f.tiers.some((t) => t.tier === tier)) return null;
  if (parts.length === 3) return f.variants ? null : { family: f.id, variant: null, tier };
  if (!f.variants) return null;
  const raw = parts[2];
  const variant = f.variants.find((v) => String(v) === raw);
  return variant === undefined ? null : { family: f.id, variant, tier };
}

/** Rang d'un palier (bronze 0 … platine 3), pour trier les médailles. */
export const tierRank = (tier) => TIERS.indexOf(tier);

/**
 * Récompense d'un palier : { xp, royalties, boosters?, cosmetic? }. Le titre de la famille arrive avec son palier le
 * plus haut quand c'est le platine, ou avec l'or pour une famille qui s'arrête à l'or et offre un titre.
 */
export function rewardFor(familyId, tier) {
  const f = BY_ID.get(familyId);
  const base = TIER_REWARDS[tier] || { xp: 0, royalties: 0 };
  const out = { xp: base.xp, royalties: base.royalties || 0, ...(base.boosters ? { boosters: base.boosters } : {}) };
  if (f?.cosmetic && tier === f.top) out.cosmetic = f.cosmetic;
  return out;
}

/** Mesure d'un palier : 'value' par défaut, ou celle du palier (« albums », « completed » de l'Explorateur). */
export const tierMetric = (t) => t.metric || 'value';

/**
 * Paliers atteints : `values` = { value } (ou { albums, completed }…) mesurées pour la famille ; renvoie
 * [{ tier, target, progress }] de chaque palier, avec `reached`.
 */
export function tierProgress(familyId, values = {}) {
  const f = BY_ID.get(familyId);
  if (!f) return [];
  return f.tiers.map((t) => {
    const progress = Math.max(0, Math.floor(Number(values[tierMetric(t)]) || 0));
    return { tier: t.tier, target: t.target, progress: Math.min(progress, t.target), reached: progress >= t.target };
  });
}

/** Plus grande valeur utile d'une mesure (LIMIT des comptages : au-delà du dernier seuil, compter ne sert à rien). */
export function metricCap(familyId, metric = 'value') {
  const f = BY_ID.get(familyId);
  return f ? Math.max(1, ...f.tiers.filter((t) => tierMetric(t) === metric).map((t) => t.target)) : 1;
}

/** Toutes les médailles affichables : [{ family, variant }] (variantes cachées comprises, à filtrer à l'affichage). */
export function allMedals() {
  return FAMILIES.flatMap((f) => (f.variants ? f.variants.map((v) => ({ family: f.id, variant: v })) : [{ family: f.id, variant: null }]));
}
