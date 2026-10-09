// Page /notifications — chantier P0-F (PLAN.md 2.5, 4.1.7). Notifications groupées (« Camille et 3 autres… »), non lues
// d'abord et marquées comme telles, « Tout marquer comme lu », un clic mène à l'objet. Les décisions de modération se
// lisent ici en entier : motif, exposé des motifs, contenu concerné et « Contester » (DSA art. 17). Sur téléphone, c'est
// là que mène la cloche.
import { useCallback, useEffect, useState } from 'react';
import { get, post } from '../api.js';
import { useGame } from '../state/GameContext.jsx';
import { useCursorList } from '../state/paged.js';
import { useI18n } from '../i18n/index.jsx';
import { useToast } from '../components/ui.jsx';
import { EmptyState, ErrorBox, LoadMore, Skeleton } from '../components/feedback.jsx';
import { NotificationRow } from '../components/safety/NotificationRow.jsx';
import { answerFriend } from '../components/shell/NotificationBell.jsx';
import '../styles/safety.css';

export default function Notifications() {
  const { t, error } = useI18n();
  const toast = useToast();
  const { counts } = useGame();
  const list = useCursorList('/notifications', { limit: 20 });
  const [decisions, setDecisions] = useState(new Map());
  const hasDecisions = list.items.some((n) => n.kind === 'moderation_action');

  // État des contestations (GET /api/moderation/mine), lu seulement s'il y a des décisions à afficher.
  const loadDecisions = useCallback(() => {
    get('/moderation/mine').then((res) => setDecisions(new Map((res.items || []).map((d) => [d.id, d])))).catch(() => {});
  }, []);
  useEffect(() => {
    if (hasDecisions) loadDecisions();
  }, [hasDecisions, loadDecisions]);

  const markRead = (ids) => {
    for (const n of list.items) if (ids === 'all' || ids.includes(n.id)) list.update(n.id, (x) => ({ ...x, read: true }));
    post('/notifications/read', ids === 'all' ? { all: true } : { ids }).catch((ex) => toast(error(ex.code), 'error'));
  };
  const onOpen = (n) => {
    if (!n.read) markRead([n.id]);
  };
  const onFriend = async (n, accept) => {
    if (await answerFriend(n, accept, { toast, t, error })) list.update(n.id, (x) => ({ ...x, read: true, data: { ...x.data, pending: false } }));
  };
  const unread = list.items.some((n) => !n.read) || counts?.unread > 0;

  return (
    <div className="sf-notifs">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('notify.kicker')}</span>
          <h1>{t('notify.title')}</h1>
        </div>
        {unread && list.items.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => markRead('all')}>{t('notify.markAll')}</button>
        )}
      </header>
      {list.error && !list.items.length ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : !list.items.length && list.loading ? (
        <div className="rows"><Skeleton kind="row" count={4} /></div>
      ) : !list.items.length ? (
        <EmptyState icon="bell" title={t('notify.empty')} body={t('notify.emptyBody')} action={{ label: t('notify.emptyAction'), to: '/friends', primary: false }} />
      ) : (
        <section className="panel sf-notifs__panel">
          <ul className="notif-list">
            {list.items.map((n) => (
              <NotificationRow key={n.id} n={n} variant="page" onOpen={onOpen} onFriend={onFriend}
                decision={decisions.get(n.data?.actionId)} onAppealed={loadDecisions} />
            ))}
          </ul>
        </section>
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} error={list.items.length ? list.error : null} onRetry={list.loadMore} auto />
    </div>
  );
}
