import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get } from '../api.js';

// Pochettes officielles et liens d'écoute fournis par le serveur (Spotify ou Deezer).
// Sans réponse, l'application garde ses visuels générés : rien ne dépend de ces données.
const EMPTY = { providers: [], items: {}, tracks: {}, markBroken: () => {} };
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
    return { ...data, items, markBroken };
  }, [data, broken, markBroken]);

  return <CoversContext.Provider value={value}>{children}</CoversContext.Provider>;
}

export const useCovers = () => useContext(CoversContext);
