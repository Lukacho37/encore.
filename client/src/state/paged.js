// Listes chargées page par page — chantier P0-B (PLAN.md 9.2). Un seul outil pour tout le site :
//  - usePagedList(path, opts) : pages par décalage (?offset=&limit=), avec total ; c'est la liste de la Collection,
//    déplacée ici sans changement de comportement (mémoire des pages au retour sur l'onglet, rechargement d'un coup
//    quand la collection a changé, réponses dépassées ignorées) ;
//  - useCursorList(path, { limit }) : pages par curseur opaque (?cursor=&limit= → { items, nextCursor }, PLAN.md 4.0),
//    pour les fils, critiques, notifications, listes… avec ajout en tête, mise à jour et retrait sur place ;
//  - useDebounced(value, ms) : valeur retardée (recherche au fil de la frappe).
// Les réponses de l'API apportent leurs références de catalogue (`catalog`) : api.js les enregistre déjà.
import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '../api.js';

const noop = () => {};

/** Ajoute `offset`/`limit` (ou `cursor`/`limit`) à une adresse qui a peut-être déjà des paramètres. */
const withParams = (path, params) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
};

const itemsOf = (res) => (Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : []);

// ----- pages par décalage --------------------------------------------------------------------

// Dernier état de chaque liste (par `id`) : en revenant sur un onglet, les pages déjà chargées réapparaissent sans
// requête, tant que la collection n'a pas changé entre-temps (`signature`). Si elle a changé (booster ouvert sur une
// fiche album…), la liste d'avant reste affichée le temps de recharger d'un coup ses pages (jusqu'à RELOAD_PAGES) :
// la page garde sa hauteur et le bouton précédent retrouve la position de défilement.
const snapshots = new Map();
const RELOAD_PAGES = 5;
const EMPTY_LIST = { key: null, items: [], total: null, end: false, sig: null, loading: true, error: null };

/**
 * Liste paginée par décalage d'une adresse de l'API (`path`, filtres compris).
 * opts : { id (clé de mémoire, défaut : path), pageSize (48), register (appelée avec chaque page reçue),
 *          signature (change quand les données ont changé ailleurs), maxOffset (10 000 : au-delà, il faut affiner) }.
 * Renvoie { items, total, loading, error, initial, stale, restored, hasMore, capped, remaining,
 *           more() / loadMore(), retry(), reload() }.
 * Les pages suivantes s'ajoutent aux précédentes ; une réponse arrivée après un changement de filtres est ignorée.
 * `path` null : rien n'est chargé.
 */
export function usePagedList(path, { id, pageSize = 48, register = noop, signature = null, maxOffset = 10_000 } = {}) {
  const key = path || null;
  const memo = id || key;
  const [initial] = useState(() => {
    const snap = memo ? snapshots.get(memo) : null;
    if (!snap || snap.key !== key) return null;
    if (snap.sig === signature) return { ...snap, loading: false, error: null };
    return snap.items.length <= pageSize * RELOAD_PAGES ? { ...snap, loading: true, error: null } : null;
  });
  const [state, setState] = useState(initial || EMPTY_LIST);
  const req = useRef(0);
  const latest = useRef(state);
  const sig = useRef(signature);
  // `register` peut être une fonction recréée à chaque rendu : on garde la dernière sans relancer le chargement.
  const registerRef = useRef(register);
  useEffect(() => {
    latest.current = state;
    sig.current = signature;
    registerRef.current = register;
  });

  const load = useCallback((offset) => {
    if (!key) return;
    const ticket = ++req.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    get(withParams(key, { offset, limit: pageSize }))
      .then((res) => {
        if (ticket !== req.current) return; // réponse d'une recherche dépassée
        const list = itemsOf(res);
        registerRef.current(list);
        setState((s) => {
          const kept = offset > 0 && s.key === key ? s.items : [];
          const seen = new Set(kept.map((x) => x.id));
          const items = [...kept, ...list.filter((x) => !seen.has(x.id))];
          return {
            key,
            items,
            total: Number.isFinite(res?.total) ? res.total : items.length,
            end: list.length < pageSize,
            sig: sig.current,
            loading: false,
            error: null,
          };
        });
      })
      .catch((error) => {
        if (ticket === req.current) setState((s) => ({ ...s, loading: false, error }));
      });
  }, [key, pageSize]);

  // Recharge les `count` premiers éléments en une fois ; la liste affichée reste en place jusqu'à la réponse.
  const reloadAll = useCallback((count) => {
    if (!key) return;
    const ticket = ++req.current;
    const offsets = [];
    for (let offset = 0; offset < count; offset += pageSize) offsets.push(offset);
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.all(offsets.map((offset) => get(withParams(key, { offset, limit: pageSize }))))
      .then((pages) => {
        if (ticket !== req.current) return;
        const seen = new Set();
        const items = [];
        for (const res of pages) {
          const list = itemsOf(res);
          registerRef.current(list);
          for (const x of list) {
            if (seen.has(x.id)) continue;
            seen.add(x.id);
            items.push(x);
          }
        }
        const last = pages[pages.length - 1];
        setState({
          key,
          items,
          total: Number.isFinite(last?.total) ? last.total : items.length,
          end: itemsOf(last).length < pageSize,
          sig: sig.current,
          loading: false,
          error: null,
        });
      })
      .catch(() => {
        // La liste d'avant reste affichée ; elle sera rechargée à la prochaine visite.
        if (ticket === req.current) setState((s) => ({ ...s, loading: false }));
      });
  }, [key, pageSize]);

  useEffect(() => {
    if (!key) return;
    const s = latest.current;
    if (s.key === key && s.items.length && !s.error) {
      if (s.sig !== sig.current) {
        reloadAll(s.items.length);
        return;
      }
      // Liste déjà là : une réponse encore en route pour d'autres filtres ne doit plus s'afficher.
      req.current += 1;
      if (s.loading) setState((prev) => ({ ...prev, loading: false }));
      return;
    }
    load(0);
  }, [key, load, reloadAll]);

  useEffect(() => () => {
    const s = latest.current;
    if (memo && s.key && s.items.length) snapshots.set(memo, { key: s.key, items: s.items, total: s.total, end: s.end, sig: s.sig });
  }, [memo]);

  const fresh = state.key === key;
  const count = fresh ? state.items.length : 0;
  const more = fresh && !state.end && count < state.total;
  const loadMore = () => load(count);
  return {
    items: state.items,
    total: fresh ? state.total : null,
    loading: !!key && state.loading,
    error: state.error,
    initial: state.key === null,
    stale: !fresh && state.items.length > 0,
    restored: !!initial,
    hasMore: more && count < maxOffset,
    capped: more && count >= maxOffset,
    remaining: fresh ? Math.max(0, state.total - count) : 0,
    more: loadMore,
    loadMore,
    retry: loadMore,
    reload: () => load(0),
  };
}

// ----- pages par curseur ---------------------------------------------------------------------

/**
 * Liste paginée par curseur (PLAN.md 4.0) : `GET path?cursor=…&limit=…` → { items, nextCursor }.
 * opts : { limit (20, 50 au plus côté serveur), idOf (clé d'un élément, défaut item.id), onPage (appelée avec chaque
 *          réponse complète, ex. pour lire un compteur) }.
 * Renvoie { items, loading, error, hasMore, loadMore(), reload(), prepend(item | items), update(id, fn), remove(id) }.
 * Changer `path` repart de zéro ; `path` null : liste vide, rien n'est chargé.
 */
export function useCursorList(path, { limit = 20, idOf = (x) => x?.id, onPage } = {}) {
  const [state, setState] = useState({ path: null, items: [], cursor: null, end: false, loading: !!path, error: null });
  const req = useRef(0);
  const latest = useRef(state);
  const opts = useRef({ idOf, onPage });
  useEffect(() => {
    latest.current = state;
    opts.current = { idOf, onPage };
  });

  const fetchPage = useCallback((cursor) => {
    if (!path) return;
    const ticket = ++req.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    get(withParams(path, { cursor, limit }))
      .then((res) => {
        if (ticket !== req.current) return;
        opts.current.onPage?.(res);
        const list = itemsOf(res);
        const keyOf = opts.current.idOf;
        setState((s) => {
          const kept = cursor && s.path === path ? s.items : [];
          const seen = new Set(kept.map(keyOf));
          return {
            path,
            items: [...kept, ...list.filter((x) => !seen.has(keyOf(x)))],
            cursor: res?.nextCursor ?? null,
            end: !res?.nextCursor,
            loading: false,
            error: null,
          };
        });
      })
      .catch((error) => {
        if (ticket === req.current) setState((s) => ({ ...s, loading: false, error }));
      });
  }, [path, limit]);

  useEffect(() => {
    if (!path) {
      req.current += 1;
      setState({ path: null, items: [], cursor: null, end: true, loading: false, error: null });
      return;
    }
    fetchPage(null);
  }, [path, fetchPage]);

  const loadMore = useCallback(() => {
    const s = latest.current;
    if (s.loading || s.end || s.path !== path) return;
    fetchPage(s.cursor);
  }, [fetchPage, path]);

  const reload = useCallback(() => fetchPage(null), [fetchPage]);

  /** Ajoute en tête (nouveau post, nouvelle critique…) sans recharger ; un élément déjà présent est remplacé. */
  const prepend = useCallback((added) => {
    const list = Array.isArray(added) ? added : [added];
    const keyOf = opts.current.idOf;
    const ids = new Set(list.map(keyOf));
    setState((s) => ({ ...s, items: [...list, ...s.items.filter((x) => !ids.has(keyOf(x)))] }));
  }, []);

  /** Met à jour un élément sur place : update(id, (item) => nouvelItem). */
  const update = useCallback((id, fn) => {
    const keyOf = opts.current.idOf;
    setState((s) => ({ ...s, items: s.items.map((x) => (keyOf(x) === id ? fn(x) : x)) }));
  }, []);

  /** Retire un élément (supprimé, masqué, auteur bloqué…). */
  const remove = useCallback((id) => {
    const keyOf = opts.current.idOf;
    setState((s) => ({ ...s, items: s.items.filter((x) => keyOf(x) !== id) }));
  }, []);

  const fresh = state.path === path;
  return {
    items: fresh ? state.items : [],
    loading: !!path && (state.loading || !fresh),
    error: fresh ? state.error : null,
    hasMore: fresh && !state.end,
    loadMore,
    reload,
    prepend,
    update,
    remove,
  };
}

// ----- valeur retardée -----------------------------------------------------------------------

/** Renvoie `value` une fois qu'elle n'a plus changé pendant `ms` millisecondes. */
export function useDebounced(value, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return undefined;
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms, settled]);
  return settled;
}
