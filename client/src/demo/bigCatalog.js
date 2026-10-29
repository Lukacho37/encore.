// Grand catalogue de la démo publiée : demo-catalog.json, publié à côté de la page (scripts/demo-catalog.mjs), ajouté
// au catalogue de base avant la première requête du faux serveur. Démo ouverte en local (file://) ou fichier absent :
// la démo garde ses 20 albums de base.
import { extendCatalog } from '@shared/catalog.js';
import { generatedArt } from '@shared/art.js';

export const BIG_CATALOG_FILE = 'demo-catalog.json';

/** Charge et ajoute le grand catalogue ; renvoie { albumIds, artistIds } des éléments ajoutés (vides sans fichier). */
export async function loadBigCatalog() {
  const none = { albumIds: [], artistIds: [] };
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol) || typeof fetch !== 'function') return none;
  try {
    const res = await fetch(BIG_CATALOG_FILE, { cache: 'force-cache' });
    if (!res.ok) return none;
    const data = await res.json();
    if (!extendCatalog(data, { artOf: generatedArt })) return none;
    return { albumIds: data.albums.map((a) => a[0]), artistIds: data.artists.map((a) => a[0]) };
  } catch (err) {
    console.warn('[démo] grand catalogue indisponible :', err?.message || err);
    return none;
  }
}
