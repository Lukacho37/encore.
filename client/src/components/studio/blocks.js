// Blocs de la vue d'ensemble du Studio — chantier P1-B (PLAN.md 2.5). Même liste, dans le même ordre par défaut, que
// le serveur (server/studio.js, BLOCK_IDS ; vérifié par server/test/studio.test.js) et que la démo (mock/studio.js).
//   nine      Mes 9 albums (+ Partager)          showcase  Vitrine (cartes exposées)
//   vinyls    Vinyle mis en avant + étagère      trophies  Trophées (8 médailles)
//   wishlist  Albums recherchés                  artists   Artistes favoris (et genres)
//   tracks    Morceaux favoris                   reviews   Critiques récentes
//   lists     Listes épinglées (3 au plus)       recent    Derniers morceaux obtenus
//   activity  Activité récente                   stats     Statistiques (mini passeport)
export const BLOCK_IDS = ['nine', 'showcase', 'vinyls', 'trophies', 'wishlist', 'artists', 'tracks', 'reviews', 'lists', 'recent', 'activity', 'stats'];

/** Configuration reçue → [{ id, on }] complète (ids connus, sans doublon, blocs absents à la fin) : comme le serveur. */
export function blocksOf(raw) {
  const out = [];
  const seen = new Set();
  for (const b of Array.isArray(raw) ? raw : []) {
    const id = typeof b === 'string' ? b : b?.id;
    if (!BLOCK_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, on: typeof b === 'object' && b ? b.on !== false : true });
  }
  for (const id of BLOCK_IDS) if (!seen.has(id)) out.push({ id, on: true });
  return out;
}

/** Onglets du Studio (/u/:pseudo/:onglet) ; « overview » n'a pas de segment d'adresse. */
export const STUDIO_TABS = ['overview', 'reviews', 'lists', 'vinyls', 'badges', 'posts'];

export const BIO_MAX = 280;
export const FAVORITES_MAX = 5;
export const FEATURED_LISTS_MAX = 3;
