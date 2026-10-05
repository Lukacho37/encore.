// Catalogue côté site : cartes, albums et artistes reçus du serveur, gardés en mémoire pour toute la session.
// Avec 20 000 albums, le site ne connaît pas tout le catalogue : chaque réponse de l'API apporte les données des
// éléments qu'elle cite (champ `catalog`), et les hooks de state/catalog.js vont chercher le reste par lots.

const tracks = new Map();
const albums = new Map();
const artists = new Map();
const listeners = new Set();
let version = 0;

/** Ajoute ou met à jour des éléments du catalogue : { tracks?, albums?, artists? }. */
export function registerCatalog(refs) {
  if (!refs || typeof refs !== 'object') return;
  let changed = false;
  const put = (map, list) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item.id !== 'string') continue;
      // La progression du joueur (owned) n'appartient pas au catalogue : on ne la garde pas.
      const { owned: _owned, holo: _holo, ...clean } = item;
      map.set(item.id, clean);
      changed = true;
    }
  };
  put(tracks, refs.tracks);
  put(albums, refs.albums);
  put(artists, refs.artists);
  if (changed) {
    version += 1;
    for (const l of listeners) l();
  }
}

export const getTrack = (id) => (typeof id === 'string' ? tracks.get(id) : undefined);
export const getAlbum = (id) => (typeof id === 'string' ? albums.get(id) : undefined);
export const getArtist = (id) => (typeof id === 'string' ? artists.get(id) : undefined);
export const catalogVersion = () => version;

export function subscribeCatalog(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Toute réponse de l'API peut porter un champ `catalog` (et `state.catalog`) : on l'enregistre au passage. */
export function absorbResponse(data) {
  if (!data || typeof data !== 'object') return;
  if (data.catalog && typeof data.catalog === 'object') registerCatalog(data.catalog);
  if (data.state?.catalog) registerCatalog(data.state.catalog);
}
