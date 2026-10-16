// Listes (/lists) — chantier P1-C (PLAN.md 2.1, 2.5) : « Mes 9 albums » épinglé en tête, puis les onglets Mes listes ·
// Amis · Populaires (GET /api/lists?owner=me|friends|popular, curseur, chargement au défilement) et « Nouvelle liste ».
// L'onglet est dans l'adresse (?tab=friends) : un retour arrière garde le bon onglet.
import { Link, useSearchParams } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { useCursorList } from '../state/paged.js';
import { EmptyState, ErrorBox, LoadMore, Skeleton } from '../components/feedback.jsx';
import { Icon } from '../components/ui.jsx';
import { ListCard } from '../components/lists/ListCard.jsx';
import { Grid9Card } from '../components/lists/Grid9.jsx';
import '../styles/lists.css';

const TABS = ['mine', 'friends', 'popular'];
const OWNER = { mine: 'me', friends: 'friends', popular: 'popular' };

export default function Lists() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'mine';
  const lists = useCursorList(`/lists?owner=${OWNER[tab]}`, { limit: 20 });

  const empty = {
    mine: { icon: 'list', title: t('lists.emptyMineTitle'), body: t('lists.emptyMineBody'), action: { label: t('lists.new'), to: '/lists/new', icon: 'plus' } },
    friends: { icon: 'users', title: t('lists.emptyFriendsTitle'), body: t('lists.emptyFriendsBody'), action: { label: t('lists.findFriends'), to: '/friends', primary: false } },
    popular: { icon: 'heart', title: t('lists.emptyPopularTitle'), body: t('lists.emptyPopularBody'), action: { label: t('lists.new'), to: '/lists/new', icon: 'plus' } },
  }[tab];

  return (
    <div className="page ls-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('lists.eyebrow')}</span>
          <h1>{t('lists.title')}</h1>
          <p className="muted">{t('lists.lead')}</p>
        </div>
        <Link to="/lists/new" className="btn btn--primary" data-new-list=""><Icon name="plus" size={18} /> {t('lists.new')}</Link>
      </header>

      <div className="ls-pinned"><Grid9Card /></div>

      <nav className="tabs ls-tabs" aria-label={t('lists.tabsLabel')}>
        {TABS.map((k) => (
          <button key={k} type="button" className={`tabs__tab${tab === k ? ' active' : ''}`} aria-current={tab === k ? 'page' : undefined}
            onClick={() => setParams(k === 'mine' ? {} : { tab: k }, { replace: true })}>
            {t(`lists.tabs.${k}`)}
          </button>
        ))}
      </nav>

      {lists.error && !lists.items.length ? (
        <ErrorBox error={lists.error} onRetry={lists.reload} />
      ) : lists.items.length ? (
        <div className="ls-cards">{lists.items.map((l) => <ListCard key={l.id} list={l} />)}</div>
      ) : lists.loading ? (
        <div className="ls-cards"><Skeleton kind="row" count={4} /></div>
      ) : (
        <EmptyState {...empty} />
      )}
      <LoadMore hasMore={lists.hasMore} loading={lists.loading} onClick={lists.loadMore} auto
        error={lists.items.length ? lists.error : null} onRetry={lists.loadMore} />
    </div>
  );
}
