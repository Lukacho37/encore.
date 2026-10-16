// Outils partagés des composants sociaux — chantier P1-A : adresses des contenus, heure relative, partage d'un lien,
// retrait des contenus d'un joueur bloqué (événement `albummania:blocks` diffusé par SafetyMenu), post publié ailleurs
// que dans le fil (événement `albummania:posted` : partage d'une critique, d'une liste), requête média.
import { useEffect, useRef, useState } from 'react';
import { BLOCKS_EVENT } from '../safety/SafetyMenu.jsx';
import { timeAgo } from '../safety/NotificationRow.jsx';

export { timeAgo };

const enc = encodeURIComponent;

/** Page d'un élément cité (album, morceau, artiste, liste, critique, post), ou null. */
export function itemHref(type, id) {
  if (id == null || id === '') return null;
  switch (type) {
    case 'album': return `/album/${enc(id)}`;
    case 'track': return `/track/${enc(id)}`;
    case 'artist': return `/artist/${enc(id)}`;
    case 'list': return `/list/${enc(id)}`;
    case 'review': return `/review/${enc(id)}`;
    case 'post': return `/post/${enc(id)}`;
    default: return null;
  }
}

export const userHref = (user) => (user?.username ? `/u/${enc(user.username)}` : null);

/**
 * Partage d'une adresse du site : feuille de partage du système quand elle existe, sinon copie dans le presse-papiers.
 * Renvoie 'shared' | 'copied' | null (annulé ou impossible).
 */
export async function shareLink(path, title) {
  const url = new URL(path, window.location.origin).href;
  try {
    if (typeof navigator.share === 'function' && window.matchMedia?.('(pointer: coarse)').matches) {
      await navigator.share({ url, title });
      return 'shared';
    }
  } catch (err) {
    if (err?.name === 'AbortError') return null;
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return null;
  }
}

/** Appelle `onBlocked(userId)` quand le joueur bloque quelqu'un depuis un menu ⋯ (pour retirer ses contenus tout de suite). */
export function useOnBlocked(onBlocked) {
  const ref = useRef(onBlocked);
  useEffect(() => {
    ref.current = onBlocked;
  });
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.blocked) ref.current?.(Number(e.detail.userId));
    };
    window.addEventListener(BLOCKS_EVENT, handler);
    return () => window.removeEventListener(BLOCKS_EVENT, handler);
  }, []);
}

/** Événement d'un post publié hors du compositeur de l'accueil (fenêtre « Publier dans le fil »). */
export const POSTED_EVENT = 'albummania:posted';

/** Annonce un post qu'on vient de publier (le fil de l'accueil le met en tête sans recharger). */
export function announcePosted(post) {
  if (post && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(POSTED_EVENT, { detail: { post } }));
}

/** Appelle `onPosted(post)` pour chaque post annoncé par announcePosted. */
export function useOnPosted(onPosted) {
  const ref = useRef(onPosted);
  useEffect(() => {
    ref.current = onPosted;
  });
  useEffect(() => {
    const handler = (e) => e.detail?.post && ref.current?.(e.detail.post);
    window.addEventListener(POSTED_EVENT, handler);
    return () => window.removeEventListener(POSTED_EVENT, handler);
  }, []);
}

/** Vrai tant que la requête média `query` est satisfaite (suit les changements de taille de la fenêtre). */
export function useMedia(query) {
  const read = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
