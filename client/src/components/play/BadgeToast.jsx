// Message « Nouvelle médaille ! » — chantier P1-F (PLAN.md 5.7, 8.2 P1.7). Deux sources :
//   - `badgesEarned` dans la réponse d'une action de P1-F (quête réclamée, vote) ;
//   - toute autre action dont l'état partiel fait monter les notifications non lues (un booster qui complète un album,
//     une critique aimée…) : POST /api/badges/seen renvoie les badges gagnés depuis le dernier message.
// Le message attend la fin de l'écran d'ouverture d'un booster et la fermeture d'une fenêtre, comme celui du niveau.
// Sans props. Plusieurs exemplaires peuvent être montés (accueil, Studio, pages de P1-F) : le premier monté affiche.
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router';
import { onApiResponse, post } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { sound } from '../../sound.js';
import { Icon } from '../ui.jsx';
import { familyOf } from '@shared/badges.js';
import { medalName, medalTone } from './common.jsx';

const SHOW_MS = 6000;
let store = { queue: [], leader: null };
const listeners = new Set();
const instances = [];
let subscribed = false;
let lastUnread = null;
let asking = false;
const shown = new Set();

function setStore(patch) {
  store = { ...store, ...patch };
  for (const fn of listeners) fn();
}
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const read = () => store;

/** Ajoute des badges gagnés à la file (une fois chacun). */
function push(list = []) {
  const fresh = list.filter((b) => b?.key && !shown.has(b.key));
  if (!fresh.length) return;
  for (const b of fresh) shown.add(b.key);
  setStore({ queue: [...store.queue, fresh].slice(-3) });
}

function ask() {
  if (asking) return;
  asking = true;
  post('/badges/seen')
    .then((res) => push(res?.items || []))
    .catch(() => {})
    .finally(() => {
      asking = false;
    });
}

function listen() {
  if (subscribed) return;
  subscribed = true;
  onApiResponse((res, { path }) => {
    if (Array.isArray(res?.badgesEarned) && res.badgesEarned.length) push(res.badgesEarned);
    const unread = res?.state?.counts?.unread;
    if (typeof unread !== 'number') return;
    const before = lastUnread;
    lastUnread = unread;
    if (before != null && unread > before && !String(path).startsWith('/badges') && !res.badgesEarned) ask();
  });
}

export function BadgeToast() {
  const key = useId();
  const { t } = useI18n();
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

  useEffect(() => {
    if (!current) {
      setReady(false);
      return undefined;
    }
    let shownAt = null;
    const id = setInterval(() => {
      const busy = !!document.querySelector('.opening, .modal-backdrop, .gm-levelup');
      if (shownAt == null && !busy) {
        shownAt = Date.now();
        setReady(true);
        sound.coin?.();
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
  const first = current[0];
  const medal = { id: first.family, variant: first.variant };
  const icon = familyOf(first.family)?.icon || 'trophy';
  return createPortal(
    <div className="pl-toast" role="status" aria-live="polite" data-toast="badge">
      <span className={`medal ${medalTone(first.tier)}`} aria-hidden="true">
        <span className="medal__disc"><Icon name={icon} size={18} /></span>
      </span>
      <span className="pl-toast__text">
        <strong className="pl-toast__title">{t('badges.toastTitle')}</strong>
        <span className="pl-toast__body">
          {t('badges.toastBody', { name: medalName(t, medal), tier: t(`badges.tiers.${first.tier}`) })}
          {current.length > 1 && ` ${t('badges.toastMore', { n: current.length - 1 })}`}
        </span>
        <Link to="/badges" className="pl-toast__link" onClick={dismiss}>{t('badges.see')}</Link>
      </span>
      <button type="button" className="icon-btn" onClick={dismiss} aria-label={t('badges.close')}>
        <Icon name="close" size={16} />
      </button>
    </div>,
    document.body,
  );
}

export default BadgeToast;
