// Message « Niveau 11 ! » — chantier P1-D (PLAN.md 6.6, 9.4). Écoute `levelUp` dans les réponses de l'API
// (onApiResponse : GameContext.jsx reste figé) : boosters bonus, booster spécial des dizaines, cosmétiques et places
// débloqués. Le message attend la fin de l'écran d'ouverture d'un booster pour ne pas cacher les cartes.
// Sans props. Plusieurs exemplaires peuvent être montés (coquille du site, panneau des boosters spéciaux) : un seul,
// le premier monté, affiche les messages ; s'il disparaît, le suivant prend le relais avec la file en cours.
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { onApiResponse } from '../../api.js';
import { Icon } from '../ui.jsx';
import { parseCosmetic } from '@shared/cosmetics.js';
import { useI18n } from '../../i18n/index.jsx';
import { sound } from '../../sound.js';
import '../../styles/game.css';

const SHOW_MS = 6500;
let store = { queue: [], leader: null };
const listeners = new Set();
const instances = [];
let subscribed = false;

function setStore(patch) {
  store = { ...store, ...patch };
  for (const fn of listeners) fn();
}
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const read = () => store;

function listen() {
  if (subscribed) return;
  subscribed = true;
  onApiResponse((res) => {
    const up = res?.levelUp;
    if (up && Number(up.to) > Number(up.from)) setStore({ queue: [...store.queue, up].slice(-3) });
  });
}

/** Nom d'un cosmétique débloqué : « cadre « Ivoire » ». */
function useCosmeticName() {
  const { t } = useI18n();
  return (id) => {
    const c = parseCosmetic(id);
    if (!c) return id;
    const name = t(`cosmetics.${c.kind}.${c.key}`);
    return t('cosmetics.named', { kind: t(`cosmetics.kind.${c.kind}`), name: name.startsWith('cosmetics.') ? c.key : name });
  };
}

export function LevelUpToast() {
  const key = useId();
  const { t } = useI18n();
  const cosmeticName = useCosmeticName();
  const { queue, leader } = useSyncExternalStore(subscribe, read, read);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    listen();
    instances.push(key);
    if (!store.leader) setStore({ leader: key });
    return () => {
      instances.splice(instances.indexOf(key), 1);
      if (store.leader === key) setStore({ leader: instances[0] ?? null });
    };
  }, [key]);

  const current = leader === key ? queue[0] : null;

  // Attente de la fin de l'écran d'ouverture (les cartes d'abord), puis affichage quelques secondes.
  useEffect(() => {
    if (!current) {
      setReady(false);
      return undefined;
    }
    let shownAt = null;
    const id = setInterval(() => {
      const busy = !!document.querySelector('.opening');
      if (shownAt == null && !busy) {
        shownAt = Date.now();
        setReady(true);
        sound.coin();
      }
      if (shownAt != null && Date.now() - shownAt > SHOW_MS) dismiss();
    }, 300);
    return () => clearInterval(id);
  }, [current]);

  function dismiss() {
    setReady(false);
    setStore({ queue: store.queue.slice(1) });
  }

  if (!current || !ready) return null;
  const unlocked = (current.cosmetics || []).map(cosmeticName);
  return createPortal(
    <div className="gm-levelup" role="status" aria-live="polite">
      <span className="gm-levelup__badge" aria-hidden="true"><span className="mono">{current.to}</span></span>
      <div className="gm-levelup__text">
        <strong className="gm-levelup__title">{t('game.levelUp.title', { n: current.to })}</strong>
        <span>{t('game.levelUp.boosters', { n: current.boosters })}</span>
        {current.themed > 0 && <span>{t('game.levelUp.themed', { n: current.themed })}</span>}
        {unlocked.length > 0 && <span>{t('game.levelUp.unlocked', { list: unlocked.join(', ') })}</span>}
        {current.wishlist > 0 && <span>{t('game.levelUp.wishlist', { n: current.wishlist })}</span>}
        {current.showcase > 0 && <span>{t('game.levelUp.showcase', { n: current.showcase })}</span>}
      </div>
      <button type="button" className="icon-btn gm-levelup__close" onClick={dismiss} aria-label={t('game.levelUp.close')}>
        <Icon name="close" size={16} />
      </button>
    </div>,
    document.body,
  );
}

export default LevelUpToast;
