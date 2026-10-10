// Recherche globale côté site — chantier P0-E (PLAN.md 5.1, contrat 9.2).
//   useSearchSuggest(q, { scope, enabled }) → { data, loading, error, stale, retry }
//     suggestions de GET /api/search/suggest : la première requête d'une saisie part tout de suite, les suivantes
//     150 ms après la dernière frappe, 2 caractères au moins,
//     requête précédente annulée, réponses gardées par requête (100 au plus) : revenir en arrière avec la touche
//     d'effacement réaffiche tout de suite les suggestions déjà vues ; une réponse arrivée après une requête plus
//     récente est ignorée (tickets). Pendant le chargement, les suggestions précédentes restent affichées (`stale`).
//   recentSearches(), rememberSearch(entry), clearRecentSearches() : 5 recherches récentes (localStorage).
//   resultPath(result), searchPagePath(q, type) : adresses d'un résultat et de la page de résultats.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, get } from '../api.js';
import { absorbResponse } from '../catalogStore.js';
import { storage } from '../storage.js';
import { prepareQuery } from '@shared/search.js';
import { useDebounced } from './paged.js';

const DEBOUNCE_MS = 150;
const CACHE_MAX = 100;
const RECENT_KEY = 'albummania.search.recent';
const RECENT_MAX = 5;

const cache = new Map();
function remember(key, data) {
  cache.delete(key);
  cache.set(key, data);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/** Oublie les suggestions gardées (après un changement qui les rend fausses, ex. un blocage). */
export function clearSearchCache() {
  cache.clear();
}

// Un blocage (SafetyMenu, P0-F, événement « albummania:blocks ») retire ce membre des suggestions déjà gardées.
if (typeof window !== 'undefined') window.addEventListener('albummania:blocks', clearSearchCache);

/**
 * GET annulable. La démo passe par son faux serveur (api.js) ; sinon fetch avec un signal d'annulation, et les
 * références du catalogue de la réponse sont enregistrées comme pour tout appel de l'API.
 */
async function getAbortable(path, signal) {
  if (__DEMO__) return get(path);
  let res;
  try {
    res = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'X-AlbumMania': '1' }, signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'server_error', data);
  absorbResponse(data);
  return data;
}

/** Adresse de l'API des suggestions d'une requête normalisée. */
const suggestPath = (fq, scope) => `/search/suggest?q=${encodeURIComponent(fq)}${scope && scope !== 'all' ? `&scope=${encodeURIComponent(scope)}` : ''}`;

/**
 * Suggestions d'une requête : { data, loading, error, stale, retry }. `data` = réponse de /api/search/suggest
 * ({ q, suggestion, top, groups, counts, progress, catalog }), null tant que la requête a moins de 2 caractères.
 * `scope` : 'all' (défaut), un type, ou plusieurs séparés par des virgules ('album,track').
 */
export function useSearchSuggest(q, { scope = 'all', enabled = true } = {}) {
  const prepared = useMemo(() => prepareQuery(q), [q]);
  const key = enabled && prepared ? `${scope}|${prepared.fq}` : null;
  const debounced = useDebounced(key, DEBOUNCE_MS);
  // Première requête d'une saisie (le champ n'avait encore rien à chercher) : envoyée tout de suite, les premières
  // suggestions s'affichent sans attendre ; les frappes suivantes attendent les 150 ms habituelles.
  const [lead, setLead] = useState(null);
  const prevKey = useRef(null);
  useEffect(() => {
    if (key && !prevKey.current) setLead(key);
    prevKey.current = key;
  }, [key]);
  const settled = key && key === lead ? key : debounced;
  const [state, setState] = useState({ key: null, data: null, loading: false, error: null });
  const ticket = useRef(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!settled || cache.has(settled)) return undefined;
    const n = ++ticket.current;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const sep = settled.indexOf('|');
    setState((s) => ({ ...s, loading: true, error: null }));
    getAbortable(suggestPath(settled.slice(sep + 1), settled.slice(0, sep)), controller?.signal)
      .then((data) => {
        remember(settled, data);
        if (n === ticket.current) setState({ key: settled, data, loading: false, error: null });
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        if (n === ticket.current) setState((s) => ({ ...s, loading: false, error }));
      });
    return () => controller?.abort();
  }, [settled, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  if (!key) return { data: null, loading: false, error: null, stale: false, retry };
  const hit = cache.get(key);
  if (hit) return { data: hit, loading: false, error: null, stale: false, retry };
  const waiting = settled !== key || state.loading;
  return {
    data: state.data,
    loading: waiting,
    error: waiting ? null : state.error,
    stale: !!state.data && state.key !== key,
    retry,
  };
}

// ----- recherches récentes -----

/**
 * Entrées : { kind: 'query', q } (recherche validée) ou un résultat ouvert { kind, id, title, sub, albumId?, user? }.
 * Gardées dans le navigateur (localStorage, jamais indispensable : une lecture ratée donne une liste vide).
 */
export function recentSearches() {
  try {
    const list = JSON.parse(storage.get(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.filter((e) => e && typeof e.kind === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

const sameEntry = (a, b) => a.kind === b.kind && (a.kind === 'query' ? String(a.q).toLowerCase() === String(b.q).toLowerCase() : String(a.id) === String(b.id));

export function rememberSearch(entry) {
  if (!entry || !entry.kind || (entry.kind === 'query' && !String(entry.q || '').trim())) return;
  const clean = entry.kind === 'query' ? { kind: 'query', q: String(entry.q).trim().slice(0, 100) } : entry;
  const next = [clean, ...recentSearches().filter((e) => !sameEntry(e, clean))].slice(0, RECENT_MAX);
  storage.set(RECENT_KEY, JSON.stringify(next));
}

export function clearRecentSearches() {
  storage.remove(RECENT_KEY);
}

// ----- adresses -----

/**
 * Adresse d'un résultat choisi ({ kind, id }). Membre : `id` est son pseudo (adresse /u/:username) ; liste : son
 * identifiant numérique.
 */
export function resultPath({ kind, id } = {}) {
  const enc = encodeURIComponent(String(id ?? ''));
  switch (kind) {
    case 'album': return `/album/${enc}`;
    case 'track': return `/track/${enc}`;
    case 'artist': return `/artist/${enc}`;
    case 'user': return `/u/${enc}`;
    case 'list': return `/list/${enc}`;
    default: return null;
  }
}

/** Page de résultats d'une recherche (onglet facultatif : album, track, artist, user, list). */
export const searchPagePath = (q, type) => `/search?q=${encodeURIComponent(String(q || '').trim())}${type && type !== 'all' ? `&type=${type}` : ''}`;
