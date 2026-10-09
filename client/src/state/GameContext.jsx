import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { get, post, ApiError, onApiResponse } from '../api.js';
import { recycleValue } from '@shared/rules.js';
import { useI18n } from '../i18n/index.jsx';
import { clearApiCache } from './catalog.js';
import { fullState, mergePartial, mergeResponse } from './mergeState.js';

const EMPTY_RATIO = { owned: 0, total: 0, pct: 0 };
const NO_COUNTS = { pendingFriends: 0, unread: 0 };

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

/** Les progressions gardées en cache (collection, albums commencés) ne sont plus à jour. */
function dropCollectionCaches() {
  clearApiCache('/catalog/mine');
  clearApiCache('/catalog/groups');
  clearApiCache('/catalog/albums?');
}

export function GameProvider({ children }) {
  const { lang, setLang } = useI18n();
  const [status, setStatus] = useState('loading'); // loading | guest | ready
  const [data, setDataState] = useState(null);
  // Dernier état connu, à jour dès la fusion (sans attendre le rendu) : deux réponses arrivées coup sur coup se
  // fusionnent l'une après l'autre, et on sait tout de suite s'il faut recharger l'état complet.
  const dataRef = useRef(null);
  const setData = useCallback((next) => {
    dataRef.current = next;
    setDataState(next);
  }, []);
  const offset = useRef(0);
  const syncedLang = useRef(null);
  // États déjà fusionnés (par la réponse de l'API) : un applyState(res.state) qui suit est sans effet.
  const applied = useRef(new WeakSet());
  const refreshRef = useRef(null);

  /** Fusionne une réponse de l'API (état complet, ou partiel + deltas). */
  const mergeApiResponse = useCallback((res) => {
    const state = res?.state;
    if (!state || typeof state !== 'object' || applied.current.has(state)) return;
    applied.current.add(state);
    if (Number.isFinite(state.serverTime)) offset.current = state.serverTime - Date.now();
    if (!state.partial || res.cards || res.albumDeltas) dropCollectionCaches();
    const next = mergeResponse(dataRef.current, res);
    // État partiel sans état de départ (session ouverte ailleurs, état pas encore chargé) : on recharge l'état complet.
    if (next === null) {
      refreshRef.current?.();
      return;
    }
    if (next !== dataRef.current) setData(next);
    if (!state.partial) setStatus('ready');
  }, [setData]);

  /**
   * Applique un état reçu à part (connexion, ou `res.state` d'une réponse déjà fusionnée : sans effet en double).
   * Un état complet remplace tout ; un état partiel ne met à jour que le joueur, ses boosters et ses pastilles.
   */
  const applyState = useCallback((state) => {
    if (!state || typeof state !== 'object' || applied.current.has(state)) return;
    applied.current.add(state);
    if (Number.isFinite(state.serverTime)) offset.current = state.serverTime - Date.now();
    if (state.partial) {
      if (dataRef.current) setData(mergePartial(dataRef.current, state));
      else refreshRef.current?.();
      return;
    }
    dropCollectionCaches();
    setData(fullState(state));
    setStatus('ready');
  }, [setData]);

  useEffect(() => onApiResponse((res) => mergeApiResponse(res)), [mergeApiResponse]);

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
  }, [applyState, setData, status]);
  refreshRef.current = refresh;

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
  }, [setData]);

  const derived = useMemo(() => {
    if (!data) return null;
    const owned = indexCards(data.cards);
    const ownedSet = new Set(owned.keys());
    const achievements = new Map(data.achievements.map((a) => [a.key, a.at]));
    // « Pressage n° » de chaque album complété : clé du succès -> rang du joueur parmi ceux qui l'ont complété.
    const ranks = new Map(data.achievements.filter((a) => a.rank != null).map((a) => [a.key, a.rank]));
    const duplicates = data.cards.reduce((n, c) => n + Math.max(0, c.c - 1), 0);
    // Valeur des doublons en royalties (chaque ligne de carte porte sa rareté).
    const duplicatesValue = data.cards.reduce((n, c) => n + Math.max(0, c.c - 1) * recycleValue(c.r, c.v), 0);
    // Mes notes : « album:discovery » ou « track:discovery:01 » -> score sur 10
    const ratings = new Map((data.ratings || []).map((r) => [`${r.t}:${r.i}`, r.s]));
    // Statistiques calculées par le serveur : seuls les albums et artistes commencés figurent dans stats.albums / stats.artists.
    const stats = data.stats;
    const albumProgress = (albumId, total = 0) => stats.albums[albumId] || { ...EMPTY_RATIO, total };
    const artistProgress = (artistId, total = 0) => stats.artists[artistId] || { ...EMPTY_RATIO, total };
    return { owned, ownedSet, achievements, ranks, stats, albumProgress, artistProgress, duplicates, duplicatesValue, ratings };
  }, [data]);

  const value = useMemo(
    () => {
      const counts = data?.counts ?? NO_COUNTS;
      return {
        status,
        user: data?.user ?? null,
        packs: data?.packs ?? null,
        cards: data?.cards ?? [],
        // Pastilles : demandes d'ami reçues, notifications non lues (PLAN.md 9.2).
        counts,
        // Ancien nom de counts.pendingFriends, gardé pour les pages existantes.
        pendingFriends: counts.pendingFriends ?? 0,
        prefs: data?.user?.prefs ?? { listen: 'deezer', emailDigest: false },
        isAdmin: data?.user?.role === 'admin',
        ratingScale: data?.user?.ratingScale || 'stars',
        now: () => Date.now() + offset.current,
        ...derived,
        applyState,
        refresh,
        logout,
      };
    },
    [status, data, derived, applyState, refresh, logout],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  return useContext(GameContext);
}
