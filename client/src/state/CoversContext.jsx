import { createContext, useContext, useEffect, useState } from 'react';
import { get } from '../api.js';

// Pochettes officielles et liens d'écoute fournis par le serveur (Spotify ou Deezer).
// Sans réponse, l'application garde ses visuels générés : rien ne dépend de ces données.
const EMPTY = { providers: [], items: {}, tracks: {} };
const CoversContext = createContext(EMPTY);

export const PROVIDER_NAMES = { spotify: 'Spotify', deezer: 'Deezer' };

export function CoversProvider({ children }) {
  const [covers, setCovers] = useState(EMPTY);
  useEffect(() => {
    let alive = true;
    get('/covers')
      .then((data) => {
        if (alive && data && typeof data.items === 'object') setCovers({ ...EMPTY, ...data });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return <CoversContext.Provider value={covers}>{children}</CoversContext.Provider>;
}

export const useCovers = () => useContext(CoversContext);
