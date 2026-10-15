// Albums recherchés du joueur connecté (liste d'envies, PLAN.md 6.4) — chantier P1-D.
// Un seul magasin pour toutes les pages : le bouton « Rechercher » de la page d'album, des vignettes et des lignes de
// recherche, et le bloc du Studio lisent le même ensemble, chargé une fois (GET /me/wishlist) puis tenu à jour par
// chaque ajout ou retrait (réponse { wanted, count, max } du serveur). Changement de joueur : rechargé.
import { useEffect, useSyncExternalStore } from 'react';
import { get, put, del } from '../../api.js';

const EMPTY = { status: 'idle', owner: null, ids: new Set(), order: [], count: 0, max: 12 };
let snapshot = EMPTY;
let ticket = 0;
const listeners = new Set();

function set(patch) {
  snapshot = { ...snapshot, ...patch };
  for (const fn of listeners) fn();
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const read = () => snapshot;

/** Charge (ou recharge) la liste du joueur `owner` ; les réponses d'un ancien joueur sont ignorées. */
export function loadWishlist(owner) {
  const id = ++ticket;
  set({ status: 'loading', owner, ...(snapshot.owner === owner ? {} : { ids: new Set(), order: [], count: 0 }) });
  return get('/me/wishlist')
    .then((res) => {
      if (id !== ticket) return;
      const order = Array.isArray(res.items) ? res.items : [];
      set({ status: 'ready', ids: new Set(order), order, count: res.count ?? order.length, max: res.max ?? snapshot.max });
    })
    .catch(() => {
      if (id === ticket) set({ status: 'error' });
    });
}

/**
 * Ajoute (`want` vrai) ou retire un album. Mise à jour immédiate, annulée si le serveur refuse (409 wishlist_full :
 * l'erreur est relancée avec `data.max`). Renvoie la réponse { wanted, count, max }.
 */
export async function toggleWishlist(albumId, want) {
  const before = snapshot;
  const ids = new Set(before.ids);
  let order = before.order.filter((x) => x !== albumId);
  if (want) {
    ids.add(albumId);
    order = [...order, albumId];
  } else ids.delete(albumId);
  set({ ids, order, count: order.length });
  try {
    const res = want ? await put(`/me/wishlist/${encodeURIComponent(albumId)}`) : await del(`/me/wishlist/${encodeURIComponent(albumId)}`);
    set({ count: res.count ?? snapshot.count, max: res.max ?? snapshot.max });
    return res;
  } catch (err) {
    set({ ids: before.ids, order: before.order, count: before.count, ...(err?.data?.max ? { max: err.data.max } : {}) });
    throw err;
  }
}

/** { status, ids (Set), order, count, max } du joueur `owner` (identifiant du joueur connecté). */
export function useWishlist(owner) {
  const state = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    if (owner == null) return;
    if (snapshot.owner !== owner || snapshot.status === 'idle') loadWishlist(owner);
  }, [owner]);
  return state.owner === owner ? state : EMPTY;
}
