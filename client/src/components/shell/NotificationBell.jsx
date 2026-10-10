// Cloche des notifications — chantier P0-F (PLAN.md 2.2, 4.1.7, design-system-current §4.2). Props : aucune ; montée
// par la coque (P0-D) dans la barre du haut. Pastille rouge (.count-badge) = notifications non lues (state.counts.unread).
// Ordinateur : menu déroulant des 5 dernières (.menu.notif-panel), « Tout marquer comme lu », « Voir toutes les
// notifications ». Téléphone (< 860 px) : la cloche mène à la page /notifications. Les pastilles sont relues toutes les
// 90 s quand l'onglet est visible (GET /api/notifications/unread, état partiel fusionné par api.js).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { get, post } from '../../api.js';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { Icon, Spinner, useToast } from '../ui.jsx';
import { NotificationRow } from '../safety/NotificationRow.jsx';
import '../../styles/safety.css';

const POLL_MS = 90_000;
const PHONE = '(max-width: 859px)';

/** Requête « téléphone » (une seule pour toutes les cloches), ou null sans matchMedia. */
let phoneQuery;
const getPhoneQuery = () => {
  if (phoneQuery === undefined) phoneQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(PHONE) : null;
  return phoneQuery;
};

function usePhone() {
  const [phone, setPhone] = useState(() => !!getPhoneQuery()?.matches);
  useEffect(() => {
    const query = getPhoneQuery();
    if (!query) return undefined;
    const on = () => setPhone(query.matches);
    on();
    query.addEventListener?.('change', on);
    return () => query.removeEventListener?.('change', on);
  }, []);
  return phone;
}

/** Relit les pastilles de temps en temps (onglet visible) et au retour sur l'onglet. */
function usePollCounts(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    let last = Date.now();
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      last = Date.now();
      get('/notifications/unread').catch(() => {});
    };
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && Date.now() - last > 20_000 && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled]);
}

/** Répond à une demande d'ami depuis une notification ; renvoie true si c'est fait. */
export async function answerFriend(n, accept, { toast, t, error }) {
  try {
    await post(`/friends/${n.data.requestId}/${accept ? 'accept' : 'decline'}`);
    await post('/notifications/read', { ids: [n.id] }).catch(() => {});
    toast(t(accept ? 'notify.accepted' : 'notify.declined'), 'success');
    return true;
  } catch (ex) {
    toast(error(ex.code), 'error');
    return false;
  }
}

function BellIcon({ unread }) {
  return (
    <>
      <Icon name="bell" size={20} />
      {unread > 0 && <span className="count-badge" aria-hidden="true">{unread >= 99 ? '99+' : unread}</span>}
    </>
  );
}

export function NotificationBell() {
  const { status, counts } = useGame();
  const { t, error } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const phone = usePhone();
  const unread = counts?.unread ?? 0;
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null); // { items } | { error }
  const ref = useRef(null);
  usePollCounts(status === 'ready');

  const load = useCallback(() => {
    setData(null);
    get('/notifications?limit=5').then((res) => setData({ items: res.items || [] })).catch((err) => setData({ error: err }));
  }, []);

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = unread > 0 ? t('notify.bellUnread', { n: unread }) : t('notify.bell');

  if (phone) {
    return (
      <Link to="/notifications" className="icon-btn bell" aria-label={label} title={t('notify.bell')}>
        <BellIcon unread={unread} />
      </Link>
    );
  }

  const markRead = (ids) => {
    setData((d) => (d?.items ? { items: d.items.map((x) => (ids === 'all' || ids.includes(x.id) ? { ...x, read: true } : x)) } : d));
    post('/notifications/read', ids === 'all' ? { all: true } : { ids }).catch(() => {});
  };
  const onOpen = (n, e) => {
    if (!n.read) markRead([n.id]);
    // Une notification qui se lit sur place (décision, signalement) ouvre la page des notifications.
    if (e?.currentTarget?.tagName === 'BUTTON') navigate('/notifications');
    setOpen(false);
  };
  const onFriend = async (n, accept) => {
    if (await answerFriend(n, accept, { toast, t, error })) {
      setData((d) => ({ items: d.items.map((x) => (x.id === n.id ? { ...x, read: true, data: { ...x.data, pending: false } } : x)) }));
    }
  };

  return (
    <div className="sf-bell" ref={ref}>
      <button type="button" className="icon-btn bell" aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={t('notify.bell')}
        onClick={() => setOpen((o) => !o)}>
        <BellIcon unread={unread} />
      </button>
      {open && (
        <div className="menu notif-panel" role="dialog" aria-label={t('notify.title')}>
          <div className="notif-panel__head">
            <h2>{t('notify.title')}</h2>
            {data?.items?.some((x) => !x.read) && (
              <button type="button" className="link-btn small" onClick={() => markRead('all')}>{t('notify.markAll')}</button>
            )}
          </div>
          {!data ? (
            <div className="sf-panel-state"><Spinner /></div>
          ) : data.error ? (
            <p className="sf-panel-state small muted">{error(data.error.code)}</p>
          ) : !data.items.length ? (
            <p className="sf-panel-state small muted">{t('notify.empty')}</p>
          ) : (
            <ul className="notif-list">
              {data.items.map((n) => <NotificationRow key={n.id} n={n} onOpen={onOpen} onFriend={onFriend} />)}
            </ul>
          )}
          <div className="notif-panel__foot">
            <Link to="/notifications" className="section__link" onClick={() => setOpen(false)}>{t('notify.seeAll')}</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
