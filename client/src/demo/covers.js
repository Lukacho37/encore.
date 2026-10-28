// Vraies pochettes de la démo publiée : copies réduites intégrées à la page au moment du build
// (scripts/demo-covers.mjs puis DEMO_COVERS=<fichier> npm run build:demo). Sans elles : visuels générés partout.
import data from 'virtual:demo-covers';

export const DEMO_COVERS = data && Object.keys(data.items || {}).length ? data : null;

/** GET /covers : même forme que server/covers.js (snapshot). */
export const coversSnapshot = () => (DEMO_COVERS
  ? { providers: ['deezer'], items: DEMO_COVERS.items, tracks: DEMO_COVERS.tracks }
  : { providers: [], items: {}, tracks: {} });

/** Lien Deezer direct d'un album (pochette trouvée) ou d'un morceau de la graine, sinon null. */
export function deezerLink(type, id) {
  if (!DEMO_COVERS) return null;
  if (type === 'album') return DEMO_COVERS.items[id]?.url || null;
  if (type === 'track') return DEMO_COVERS.tracks[id]?.url || null;
  return null;
}
