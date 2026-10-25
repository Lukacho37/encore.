// Cosmétiques gagnés en jouant (PLAN.md 6.6) : définitions partagées par le serveur, le site et la démo.
// Tous sont des créations AlbumMania dessinées dans le style actuel (jetons de couleur, jamais une pochette) ;
// ils ne se vendent pas et ne se tirent jamais au hasard. Ceux d'un niveau se déduisent du niveau (rien n'est
// stocké) ; ceux des badges, coffrets et événements (P2) sont écrits dans user_cosmetics. Seule la sélection est
// gardée dans users.cosmetics : { frame, vinyl, theme, title }, chaque valeur étant la clé courte (« ivoire »).
//
// Identifiant complet d'un cosmétique : « <type>:<clé> » (ex. frame:ivoire, vinyl:prune) ; c'est la forme des listes
// `unlocked` (GET /api/me/cosmetics, deps.collection.unlockedCosmetics).
//
// Cosmétiques en plus des paliers (P2-D, PLAN.md 6.6, 6.8, 6.9) : ceux des coffrets (un cadre par coffret,
// « frame:set-<id> », source set:<id>, accordé par server/sets.js au coffret complet), des événements (cadres
// « frame:french-touch » et « frame:rock-legends », source event:<slug>, accordés par server/events.js avec le bonus
// de l'événement), des badges (titres du dernier palier, source badge:<famille>, server/badges.js) et de l'atelier
// (titre « Oreille deluxe » à la DELUXE_TITLE_AT-ième édition deluxe, source deluxe:<n>, server/workshop.js).
// cosmeticDef(id) les décrit tous ; frameStyle(clé) donne le dessin d'un cadre (classe ws-frame--<style> du site).

/** Types de cosmétiques, dans l'ordre d'affichage. */
export const COSMETIC_KINDS = ['frame', 'vinyl', 'theme', 'title'];

/**
 * Cosmétiques débloqués par le niveau du joueur. `level` : niveau requis. Les cadres décorent l'anneau de l'avatar
 * et l'extérieur des cartes de la vitrine (jamais le cadre de rareté d'une carte ni une pochette) ; les couleurs de
 * vinyle s'appliquent au disque de l'étagère et de la platine ; les thèmes teintent le dégradé de l'en-tête du Studio ;
 * les titres sont un court texte sous le pseudo.
 */
export const LEVEL_COSMETICS = [
  { id: 'frame:ivoire', kind: 'frame', key: 'ivoire', level: 3 },
  { id: 'vinyl:prune', kind: 'vinyl', key: 'prune', level: 5 },
  { id: 'theme:turquoise', kind: 'theme', key: 'turquoise', level: 8 },
  { id: 'vinyl:marbre', kind: 'vinyl', key: 'marbre', level: 15 },
  { id: 'frame:neon', kind: 'frame', key: 'neon', level: 20 },
  { id: 'title:disquaire', kind: 'title', key: 'disquaire', level: 25 },
  { id: 'frame:or', kind: 'frame', key: 'or', level: 30 },
  { id: 'vinyl:transparent', kind: 'vinyl', key: 'transparent', level: 40 },
  { id: 'frame:holo', kind: 'frame', key: 'holo', level: 50 },
  { id: 'theme:minuit', kind: 'theme', key: 'minuit', level: 75 },
  { id: 'title:legende', kind: 'title', key: 'legende', level: 100 },
];

const BY_ID = new Map(LEVEL_COSMETICS.map((c) => [c.id, c]));

/** Identifiant complet d'un cosmétique. */
export const cosmeticId = (kind, key) => `${kind}:${key}`;

/** Découpe « frame:ivoire » → { kind: 'frame', key: 'ivoire' } ; null si la forme est fausse. */
export function parseCosmetic(id) {
  const m = /^(frame|vinyl|theme|title):([a-z0-9][a-z0-9-]{0,39})$/.exec(String(id || ''));
  return m ? { kind: m[1], key: m[2] } : null;
}

/** Définition d'un cosmétique de niveau (null pour un cosmétique de badge, coffret ou événement). */
export const levelCosmetic = (id) => BY_ID.get(id) || null;

/** Cosmétiques débloqués à ce niveau : [{ id, source: 'level:N' }]. */
export function cosmeticsForLevel(level) {
  return LEVEL_COSMETICS.filter((c) => level >= c.level).map((c) => ({ id: c.id, source: `level:${c.level}` }));
}

/** Cosmétiques gagnés en passant du niveau `from` au niveau `to` (exclus / inclus). */
export function cosmeticsBetween(from, to) {
  return LEVEL_COSMETICS.filter((c) => c.level > from && c.level <= to).map((c) => c.id);
}

/**
 * Sélection lue dans users.cosmetics, nettoyée : seules les clés de `unlockedIds` (identifiants complets) restent
 * (un cosmétique retiré ou un niveau perdu ne s'affiche plus). Forme : { frame, vinyl, theme, title } (null = aucun).
 */
export function cleanSelection(raw, unlockedIds) {
  const unlocked = unlockedIds instanceof Set ? unlockedIds : new Set(unlockedIds || []);
  const out = {};
  for (const kind of COSMETIC_KINDS) {
    const value = raw && typeof raw === 'object' ? raw[kind] : null;
    const key = typeof value === 'string' ? value.replace(new RegExp(`^${kind}:`), '') : null;
    out[kind] = key && unlocked.has(cosmeticId(kind, key)) ? key : null;
  }
  return out;
}

// ----- cosmétiques en plus des paliers (P2-D) -----------------------------------------------------------------

/** Cadres des événements (shared/events.js) : dessin propre à chacun, jamais de logo ni de nom d'artiste. */
export const EVENT_FRAMES = [
  { id: 'frame:french-touch', kind: 'frame', key: 'french-touch', source: 'event:french-touch', style: 'french-touch' },
  { id: 'frame:rock-legends', kind: 'frame', key: 'rock-legends', source: 'event:rock-legends', style: 'rock-legends' },
];

/** Titres offerts au dernier palier d'une famille de badges (shared/badges.js), et celui de l'atelier. */
export const EXTRA_TITLES = [
  { id: 'title:vinylophile', kind: 'title', key: 'vinylophile', source: 'badge:vinyl' },
  { id: 'title:maitre', kind: 'title', key: 'maitre', source: 'badge:master' },
  { id: 'title:critique', kind: 'title', key: 'critique', source: 'badge:critic' },
  { id: 'title:juge', kind: 'title', key: 'juge', source: 'badge:judge' },
  { id: 'title:deluxe', kind: 'title', key: 'deluxe', source: 'deluxe' },
];

/** Nombre d'éditions deluxe qui débloque le titre « Oreille deluxe » (title:deluxe). */
export const DELUXE_TITLE_AT = 10;
export const DELUXE_TITLE = 'title:deluxe';

/** Préfixe des cadres de coffret : « frame:set-<id du coffret> » (shared/sets.js setFrameId). */
export const SET_FRAME_PREFIX = 'set-';

const EXTRA = new Map([...EVENT_FRAMES, ...EXTRA_TITLES].map((c) => [c.id, c]));
/** Dessins des cadres : ceux des paliers, le cadre commun des coffrets, ceux des événements. */
export const FRAME_STYLES = ['ivoire', 'neon', 'or', 'holo', 'set', 'french-touch', 'rock-legends'];

/**
 * Définition d'un cosmétique : { id, kind, key, level? (palier), source?, style? (cadres), setId? (cadre de coffret) } ;
 * null pour un identifiant inconnu ou mal formé.
 */
export function cosmeticDef(id) {
  const level = levelCosmetic(id);
  if (level) return { ...level, source: `level:${level.level}`, ...(level.kind === 'frame' ? { style: level.key } : {}) };
  const extra = EXTRA.get(id);
  if (extra) return extra;
  const parsed = parseCosmetic(id);
  if (parsed?.kind === 'frame' && parsed.key.startsWith(SET_FRAME_PREFIX) && parsed.key.length > SET_FRAME_PREFIX.length) {
    const setId = parsed.key.slice(SET_FRAME_PREFIX.length);
    return { id, kind: 'frame', key: parsed.key, source: `set:${setId}`, style: 'set', setId };
  }
  return null;
}

/**
 * Dessin d'un cadre choisi (clé courte « ivoire » ou identifiant « frame:ivoire ») : un de FRAME_STYLES, ou null
 * (cadre inconnu : l'anneau neutre). Les cadres de coffret partagent le dessin « set ».
 */
export function frameStyle(key) {
  if (typeof key !== 'string' || !key) return null;
  const id = key.startsWith('frame:') ? key : `frame:${key}`;
  return cosmeticDef(id)?.style ?? null;
}
