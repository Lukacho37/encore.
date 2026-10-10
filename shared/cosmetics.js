// Cosmétiques gagnés en jouant (PLAN.md 6.6) : définitions partagées par le serveur, le site et la démo.
// Tous sont des créations AlbumMania dessinées dans le style actuel (jetons de couleur, jamais une pochette) ;
// ils ne se vendent pas et ne se tirent jamais au hasard. Ceux d'un niveau se déduisent du niveau (rien n'est
// stocké) ; ceux des badges, coffrets et événements (P2) sont écrits dans user_cosmetics. Seule la sélection est
// gardée dans users.cosmetics : { frame, vinyl, theme, title }, chaque valeur étant la clé courte (« ivoire »).
//
// Identifiant complet d'un cosmétique : « <type>:<clé> » (ex. frame:ivoire, vinyl:prune) ; c'est la forme des listes
// `unlocked` (GET /api/me/cosmetics, deps.collection.unlockedCosmetics).

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
