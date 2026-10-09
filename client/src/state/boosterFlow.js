// Ouverture des boosters (machine d'états partagée) — chantier P0-B (PLAN.md 9.2).
// La logique copiée hier dans Home.jsx, AlbumPage.jsx et Admin.jsx vit ici une seule fois :
//   const flow = useBoosterFlow();
//   flow.openFree(count)      boosters gratuits / achetés (POST /packs/open)
//   flow.openAlbum(album|id)  booster d'album (POST /packs/album) : l'album entier ({ id, art, title… }) ou son id
//   flow.openSpecial(id)      booster spécial de l'inventaire (POST /me/boosters/:id/open, P1-D)
//   flow.buy()                acheter un booster en royalties (POST /shop/buy-pack)
//   flow.recycle()            recycler les doublons (POST /collection/recycle)
//   flow.overlay              l'écran d'ouverture (PackOpening inchangé) à rendre dans la page, ou null
//   flow.busy                 achat ou recyclage en cours (boutons désactivés)
// Options : { onClose(err?) } appelée à la fermeture de l'écran d'ouverture (ex. recharger une page d'admin).
// Fichier .js : l'écran est créé avec createElement (pas de JSX ici).
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { post } from '../api.js';
import PackOpening from '../components/PackOpening.jsx';
import { useToast } from '../components/ui.jsx';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from './GameContext.jsx';
import { getAlbum } from './catalog.js';
import { sound } from '../sound.js';

export function useBoosterFlow({ onClose } = {}) {
  const { t, error, num } = useI18n();
  const { applyState } = useGame();
  const toast = useToast();
  const [opening, setOpening] = useState(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  const start = useCallback((promise, extra) => {
    // Le son se débloque sur le geste de l'utilisateur, avant toute attente.
    sound.unlock();
    setOpening({ promise, count: 1, key: Date.now(), ...extra });
  }, []);

  const openFree = useCallback((count = 1) => start(post('/packs/open', { count }), { count }), [start]);

  // Booster d'album : 5 cartes de cet album, celles qui manquent d'abord (payé en royalties).
  const openAlbum = useCallback((albumOrId) => {
    const album = typeof albumOrId === 'string' ? getAlbum(albumOrId) || { id: albumOrId } : albumOrId;
    if (!album?.id) return;
    start(post('/packs/album', { albumId: album.id }), { album });
  }, [start]);

  const openSpecial = useCallback((id) => {
    if (id == null) return;
    start(post(`/me/boosters/${encodeURIComponent(id)}/open`), { special: id });
  }, [start]);

  const close = useCallback((err) => {
    setOpening(null);
    if (err) toast(error(err.code), 'error');
    closeRef.current?.(err);
  }, [toast, error]);

  // Achat et recyclage : une requête, le nouvel état, un son et un message.
  const action = useCallback(async (path, success) => {
    setBusy(true);
    try {
      const res = await post(path);
      applyState(res.state);
      sound.coin();
      toast(success(res), 'success');
      return res;
    } catch (err) {
      toast(error(err.code), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }, [applyState, toast, error]);

  const buy = useCallback(() => action('/shop/buy-pack', () => t('home.bought')), [action, t]);
  const recycle = useCallback(() => action('/collection/recycle', (r) => t('home.recycled', { v: num(r.royalties), n: r.recycled })), [action, t, num]);

  // « Encore un » : même type de booster ; un booster spécial ne se rejoue pas (il vient de l'inventaire).
  const again = opening && !opening.special
    ? () => (opening.album ? openAlbum(opening.album) : openFree(opening.count))
    : undefined;

  const overlay = opening
    ? createElement(PackOpening, { key: opening.key, promise: opening.promise, count: opening.count, album: opening.album, onClose: close, onAgain: again })
    : null;

  return { openFree, openAlbum, openSpecial, buy, recycle, overlay, busy, opening: !!opening };
}

export default useBoosterFlow;
