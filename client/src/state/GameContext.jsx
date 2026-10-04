import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get, post, ApiError } from '../api.js';
import { collectionStats } from '@shared/rules.js';
import { useI18n } from '../i18n/index.jsx';

const GameContext = createContext(null);

/** Index de la collection : trackId -> { std, holo, at }. */
function indexCards(cards) {
  const map = new Map();
  for (const { t, v, c, at } of cards) {
    const entry = map.get(t) || { std: 0, holo: 0, at: Infinity };
    entry[v] = c;
    entry.at = Math.min(entry.at, at);
    map.set(t, entry);
  }
  return map;
}

export function GameProvider({ children }) {
  const { lang, setLang } = useI18n();
  const [status, setStatus] = useState('loading'); // loading | guest | ready
  const [data, setData] = useState(null);
  const offset = useRef(0);
  const syncedLang = useRef(null);

  const applyState = useCallback((state) => {
    if (!state) return;
    offset.current = state.serverTime - Date.now();
    setData(state);
    setStatus('ready');
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyState(await get('/state'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setData(null);
        setStatus('guest');
      } else if (status === 'loading') {
        setStatus('guest');
      }
    }
  }, [applyState, status]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // La langue du compte suit le sélecteur (et inversement à la connexion).
  useEffect(() => {
    if (!data) return;
    if (syncedLang.current === null) {
      syncedLang.current = data.user.lang;
      if (data.user.lang !== lang) setLang(data.user.lang);
      return;
    }
    if (syncedLang.current !== lang) {
      syncedLang.current = lang;
      post('/profile/lang', { lang }).catch(() => {});
    }
  }, [data, lang, setLang]);

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => {});
    syncedLang.current = null;
    setData(null);
    setStatus('guest');
  }, []);

  const derived = useMemo(() => {
    if (!data) return null;
    const owned = indexCards(data.cards);
    const ownedSet = new Set(owned.keys());
    const achievements = new Map(data.achievements.map((a) => [a.key, a.at]));
    const duplicates = data.cards.reduce((n, c) => n + Math.max(0, c.c - 1), 0);
    // Mes notes : « album:discovery » ou « track:discovery:01 » -> score sur 10
    const ratings = new Map((data.ratings || []).map((r) => [`${r.t}:${r.i}`, r.s]));
    return { owned, ownedSet, achievements, stats: collectionStats(ownedSet), duplicates, ratings };
  }, [data]);

  const value = useMemo(
    () => ({
      status,
      user: data?.user ?? null,
      packs: data?.packs ?? null,
      cards: data?.cards ?? [],
      pendingFriends: data?.pendingFriends ?? 0,
      isAdmin: data?.user?.role === 'admin',
      ratingScale: data?.user?.ratingScale || 'stars',
      now: () => Date.now() + offset.current,
      ...derived,
      applyState,
      refresh,
      logout,
    }),
    [status, data, derived, applyState, refresh, logout],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  return useContext(GameContext);
}
