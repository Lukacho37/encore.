import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get } from '../api.js';

// Pochettes officielles et liens d'écoute fournis par le serveur (Spotify ou Deezer).
// Sans réponse, l'application garde ses visuels générés : rien ne dépend de ces données.
const EMPTY = { providers: [], items: {}, all: {}, tracks: {}, broken: new Set(), markBroken: () => {} };
const CoversContext = createContext(EMPTY);

export const PROVIDER_NAMES = { spotify: 'Spotify', deezer: 'Deezer' };

export function CoversProvider({ children }) {
  const [data, setData] = useState(EMPTY);
  // Une image qui ne charge pas est retirée partout : carte, crédits et pied de page reviennent au visuel généré.
  const [broken, setBroken] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    get('/covers')
      .then((res) => {
        if (alive && res && typeof res.items === 'object') setData({ ...EMPTY, ...res });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const markBroken = useCallback((seed) => {
    setBroken((prev) => (prev.has(seed) ? prev : new Set(prev).add(seed)));
  }, []);

  const value = useMemo(() => {
    const items = broken.size ? Object.fromEntries(Object.entries(data.items).filter(([seed]) => !broken.has(seed))) : data.items;
    // all : toutes les entrées, y compris celles dont l'image ne charge pas (leurs liens d'écoute restent valables).
    return { ...data, all: data.items, items, broken, markBroken };
  }, [data, broken, markBroken]);

  return <CoversContext.Provider value={value}>{children}</CoversContext.Provider>;
}

export const useCovers = () => useContext(CoversContext);

/**
 * Vraie pochette d'un visuel (`art` d'une carte ou d'un album), ou null pour garder le visuel généré.
 * Les 20 albums de base passent par /api/covers (Spotify ou Deezer) ; les albums importés portent directement
 * leur pochette Deezer (art.cover). Une image qui ne charge pas est oubliée dans les deux cas.
 */
export function realCover(art, covers) {
  if (!art) return null;
  const fromServer = covers.items[art.seed];
  if (fromServer) return fromServer;
  if (art.cover && !covers.broken?.has(art.seed)) {
    return { cover: art.cover, coverW: art.coverW, thumb: art.thumb || art.cover, thumbW: art.thumbW, provider: art.provider || 'deezer' };
  }
  return null;
}
