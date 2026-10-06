// Hooks d'accès au catalogue : renvoient tout de suite ce qui est déjà connu et vont chercher le reste par lots
// (une requête pour 200 cartes ou 100 albums), sans jamais charger tout le catalogue.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { get } from '../api.js';
import { getAlbum, getArtist, getTrack, catalogVersion, registerCatalog, subscribeCatalog } from '../catalogStore.js';

export { getAlbum, getArtist, getTrack, registerCatalog } from '../catalogStore.js';

// ----- chargement par lots ---------------------------------------------------------------

// Après un échec (réseau coupé, session expirée, limite de requêtes…), un identifiant n'est redemandé qu'après
// un délai qui double à chaque nouvel échec : une requête vouée à l'échec ne part jamais en boucle.
const RETRY_MIN = 2000;
const RETRY_MAX = 60_000;

/**
 * Regroupe les demandes d'éléments du catalogue en requêtes `path?ids=…` de `max` identifiants au plus.
 * La fonction renvoyée prend une liste d'identifiants et rend une promesse tenue quand leur requête est terminée
 * (réussie ou non : l'appelant regarde ensuite le catalogue).
 */
function batcher(path, key, max, has) {
  const queue = new Map(); // identifiant -> heure à partir de laquelle on peut le demander
  const pending = new Map(); // identifiant en file ou en cours de chargement -> { promise, resolve }
  const missing = new Set(); // identifiants inconnus du serveur : on ne les redemande pas
  const failures = new Map(); // identifiant -> { count, until } après un échec
  let timer = null;
  let timerAt = Infinity;

  const settle = (id) => {
    pending.get(id)?.resolve();
    pending.delete(id);
  };

  function schedule(wait) {
    if (!queue.size) return;
    const now = Date.now();
    let at = Infinity;
    for (const t of queue.values()) at = Math.min(at, t);
    at = Math.max(at, now + wait);
    if (timer && timerAt <= at) return;
    clearTimeout(timer);
    timerAt = at;
    timer = setTimeout(flush, at - now);
  }

  async function flush() {
    timer = null;
    timerAt = Infinity;
    const now = Date.now();
    const ids = [];
    for (const [id, at] of queue) {
      if (ids.length >= max) break;
      if (at > now) continue;
      queue.delete(id);
      // Arrivé entre-temps (fiche d'album, réponse d'une autre requête) : inutile de le demander.
      if (has(id)) settle(id);
      else ids.push(id);
    }
    schedule(0);
    if (!ids.length) return;
    try {
      const res = await get(`${path}?ids=${ids.map(encodeURIComponent).join(',')}`);
      const list = Array.isArray(res?.[key]) ? res[key] : Array.isArray(res?.items) ? res.items : [];
      registerCatalog({ [key]: list });
      const found = new Set(list.map((x) => x?.id));
      // Seule une réponse du serveur qui ne cite pas l'identifiant le fait passer pour inconnu.
      for (const id of ids) {
        failures.delete(id);
        if (!found.has(id)) missing.add(id);
      }
    } catch {
      const at = Date.now();
      for (const id of ids) {
        const count = (failures.get(id)?.count || 0) + 1;
        failures.set(id, { count, until: at + Math.min(RETRY_MAX, RETRY_MIN * 2 ** (count - 1)) });
      }
    } finally {
      for (const id of ids) settle(id);
    }
  }

  return (ids) => {
    const waits = [];
    for (const id of ids || []) {
      if (typeof id !== 'string' || !id || has(id) || missing.has(id)) continue;
      let entry = pending.get(id);
      if (!entry) {
        // Déjà en échec récemment : la demande attend la fin du délai au lieu de repartir tout de suite.
        entry = {};
        entry.promise = new Promise((resolve) => {
          entry.resolve = resolve;
        });
        pending.set(id, entry);
        queue.set(id, failures.get(id)?.until || 0);
      }
      waits.push(entry.promise);
    }
    schedule(15);
    return Promise.all(waits).then(() => undefined);
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
const loading = new Map(); // requêtes en cours, partagées par les composants qui demandent la même adresse

function fetchShared(path, force) {
  if (!force && loading.has(path)) return loading.get(path);
  const request = get(path).finally(() => {
    if (loading.get(path) === request) loading.delete(path);
  });
  loading.set(path, request);
  return request;
}

/**
 * Charge une ressource de l'API (`path`) une fois par session, partage la réponse entre composants.
 * `onData(data)` est appelé avant l'affichage de la réponse (et quand elle vient du cache) : les données qu'elle
 * apporte sont ainsi rangées dans le catalogue avant que les composants enfants ne les cherchent.
 * Renvoie { data, error, loading, reload }.
 */
export function useApi(path, { keep = true, onData } = {}) {
  const [state, setState] = useState(() => (path && cache.has(path) ? { data: cache.get(path), error: null } : { data: null, error: null }));
  const alive = useRef(true);
  const onDataRef = useRef(onData);
  useEffect(() => {
    onDataRef.current = onData;
  });
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
      const data = cache.get(path);
      onDataRef.current?.(data);
      setState((s) => (s.data === data && !s.error ? s : { data, error: null }));
      return;
    }
    setState((s) => ({ data: force ? s.data : null, error: null }));
    fetchShared(path, force)
      .then((data) => {
        if (keep) cache.set(path, data);
        onDataRef.current?.(data);
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

const registerAlbumDetail = (data) => {
  if (data?.album) registerCatalog({ albums: [data.album], tracks: data.tracks, artists: data.artist ? [data.artist] : [] });
};

const registerArtistDetail = (data) => {
  if (data?.artist) registerCatalog({ artists: [data.artist], albums: data.albums, tracks: data.promos });
};

/** Album complet : { album, tracks, artist }. Les cartes et l'album sont aussi enregistrés dans le catalogue. */
export function useAlbumDetail(albumId) {
  return useApi(albumId ? `/catalog/albums/${encodeURIComponent(albumId)}` : null, { onData: registerAlbumDetail });
}

/** Artiste : { artist, albums, promos }. */
export function useArtistDetail(artistId) {
  return useApi(artistId ? `/catalog/artists/${encodeURIComponent(artistId)}` : null, { onData: registerArtistDetail });
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
