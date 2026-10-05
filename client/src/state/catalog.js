// Hooks d'accès au catalogue : renvoient tout de suite ce qui est déjà connu et vont chercher le reste par lots
// (une requête pour 200 cartes ou 100 albums), sans jamais charger tout le catalogue.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { get } from '../api.js';
import { getAlbum, getArtist, getTrack, catalogVersion, registerCatalog, subscribeCatalog } from '../catalogStore.js';

export { getAlbum, getArtist, getTrack, registerCatalog } from '../catalogStore.js';

// ----- chargement par lots ---------------------------------------------------------------

function batcher(path, key, max, has) {
  const queue = new Set();
  const inflight = new Set();
  const missing = new Set(); // identifiants inconnus du serveur : on ne les redemande pas
  let timer = null;
  async function flush() {
    timer = null;
    const ids = [...queue].slice(0, max);
    for (const id of ids) {
      queue.delete(id);
      inflight.add(id);
    }
    if (queue.size) timer = setTimeout(flush, 0);
    try {
      const res = await get(`${path}?ids=${ids.map(encodeURIComponent).join(',')}`);
      const list = res[key] || res.items || [];
      registerCatalog({ [key]: list });
      const found = new Set(list.map((x) => x.id));
      for (const id of ids) if (!found.has(id)) missing.add(id);
    } catch {
      // Réseau coupé : on pourra réessayer au prochain affichage.
    } finally {
      for (const id of ids) inflight.delete(id);
    }
  }
  return (ids) => {
    for (const id of ids) {
      if (typeof id !== 'string' || !id || has(id) || inflight.has(id) || missing.has(id)) continue;
      queue.add(id);
    }
    if (queue.size && !timer) timer = setTimeout(flush, 15);
  };
}

export const requestTracks = batcher('/catalog/tracks', 'tracks', 200, (id) => !!getTrack(id));
export const requestAlbums = batcher('/catalog/albums', 'albums', 100, (id) => !!getAlbum(id));
export const requestArtists = batcher('/catalog/artists', 'artists', 100, (id) => !!getArtist(id));

// ----- un élément ---------------------------------------------------------------------------

function useOne(getter, request, id) {
  const value = useSyncExternalStore(subscribeCatalog, () => getter(id));
  useEffect(() => {
    if (id && !value) request([id]);
  }, [id, value, request]);
  return value;
}

/** Carte du catalogue (undefined le temps du chargement). */
export const useTrack = (id) => useOne(getTrack, requestTracks, id);
export const useAlbum = (id) => useOne(getAlbum, requestAlbums, id);
export const useArtist = (id) => useOne(getArtist, requestArtists, id);

// ----- plusieurs éléments -------------------------------------------------------------------

function useMany(getter, request, ids) {
  const version = useSyncExternalStore(subscribeCatalog, catalogVersion);
  const key = (ids || []).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => (ids || []).map((id) => getter(id)), [key, version]);
  useEffect(() => {
    if (ids?.length) request(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
  return list;
}

/** Liste de cartes dans l'ordre demandé (undefined pour celles en cours de chargement). */
export const useTracks = (ids) => useMany(getTrack, requestTracks, ids);
export const useAlbums = (ids) => useMany(getAlbum, requestAlbums, ids);
export const useArtists = (ids) => useMany(getArtist, requestArtists, ids);

// ----- requêtes de l'API mises en cache pour la session -------------------------------------

const cache = new Map();

/**
 * Charge une ressource de l'API (`path`) une fois par session, partage la réponse entre composants.
 * Renvoie { data, error, loading, reload }.
 */
export function useApi(path, { keep = true } = {}) {
  const [state, setState] = useState(() => (path && cache.has(path) ? { data: cache.get(path), error: null } : { data: null, error: null }));
  const alive = useRef(true);
  // Remis à true au montage : le mode strict de React démonte puis remonte chaque composant en développement.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback((force = false) => {
    if (!path) return;
    if (!force && keep && cache.has(path)) {
      setState({ data: cache.get(path), error: null });
      return;
    }
    setState((s) => ({ data: force ? s.data : null, error: null }));
    get(path)
      .then((data) => {
        if (keep) cache.set(path, data);
        if (alive.current) setState({ data, error: null });
      })
      .catch((error) => {
        if (alive.current) setState({ data: null, error });
      });
  }, [path, keep]);
  useEffect(() => {
    load(false);
  }, [load]);
  return { data: state.data, error: state.error, loading: !!path && !state.data && !state.error, reload: () => load(true) };
}

/** Oublie les réponses gardées (après une ouverture de booster, les progressions changent). */
export function clearApiCache(prefix = '') {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

/** Album complet : { album, tracks, artist }. Les cartes et l'album sont aussi enregistrés dans le catalogue. */
export function useAlbumDetail(albumId) {
  const res = useApi(albumId ? `/catalog/albums/${encodeURIComponent(albumId)}` : null);
  useEffect(() => {
    if (res.data) registerCatalog({ albums: [res.data.album], tracks: res.data.tracks, artists: res.data.artist ? [res.data.artist] : [] });
  }, [res.data]);
  return res;
}

/** Artiste : { artist, albums, promos }. */
export function useArtistDetail(artistId) {
  const res = useApi(artistId ? `/catalog/artists/${encodeURIComponent(artistId)}` : null);
  useEffect(() => {
    if (res.data) registerCatalog({ artists: [res.data.artist], albums: res.data.albums, tracks: res.data.promos });
  }, [res.data]);
  return res;
}

/** Totaux, genres et décennies du catalogue (une requête par session). */
export function useCatalogInfo() {
  return useApi('/catalog/info').data;
}

/** Construit une adresse de l'API avec ses paramètres (les valeurs vides sont ignorées). */
export function apiPath(path, params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `${path}?${qs}` : path;
}
