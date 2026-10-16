// Listes d'un joueur (onglet « Listes » du Studio) — chantier P1-C (PLAN.md 2.5, 9.2). Props (contrat, ne pas les
// renommer) : { username, editable }. Ses listes lisibles par celui qui regarde (GET /api/lists?owner=<pseudo>, curseur) ;
// Studio « amis » ou « privé » vu par un autre : message, rien d'autre. `editable` (son propre Studio) : « Nouvelle liste »
// et accès à « Mes 9 albums ».
import { useState } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { useCursorList } from '../../state/paged.js';
import { EmptyState, ErrorBox, LoadMore, Skeleton } from '../feedback.jsx';
import { Icon } from '../ui.jsx';
import { ListCard } from './ListCard.jsx';
import '../../styles/lists.css';

const enc = encodeURIComponent;

export function UserLists({ username, editable = false }) {
  const { t } = useI18n();
  const [restricted, setRestricted] = useState(false);
  const lists = useCursorList(username ? `/lists?owner=${enc(username)}` : null, {
    limit: 12,
    onPage: (res) => setRestricted(!!res?.restricted),
  });
  if (!username) return null;
  return (
    <section className="ls-user-lists" data-user-lists="">
      {editable && (
        <div className="ls-user-lists__bar">
          <Link to="/lists/new" className="btn btn--primary btn--sm"><Icon name="plus" size={16} /> {t('lists.new')}</Link>
          <Link to="/nine" className="btn btn--ghost btn--sm"><Icon name="grid" size={16} /> {t('nine.title')}</Link>
          <Link to="/lists" className="section__link ls-user-lists__all">{t('lists.allLists')}</Link>
        </div>
      )}
      {restricted ? (
        <EmptyState icon="lock" title={t('lists.restrictedTitle')} body={t('lists.restrictedBody', { name: username })} />
      ) : lists.error && !lists.items.length ? (
        <ErrorBox error={lists.error} onRetry={lists.reload} />
      ) : lists.items.length ? (
        <div className="ls-cards">{lists.items.map((l) => <ListCard key={l.id} list={l} />)}</div>
      ) : lists.loading ? (
        <div className="ls-cards"><Skeleton kind="row" count={3} /></div>
      ) : (
        <EmptyState icon="list"
          title={editable ? t('lists.emptyMineTitle') : t('lists.emptyUserTitle', { name: username })}
          body={editable ? t('lists.emptyMineBody') : null}
          action={editable ? { label: t('lists.new'), to: '/lists/new', icon: 'plus' } : null} />
      )}
      <LoadMore hasMore={lists.hasMore} loading={lists.loading} onClick={lists.loadMore} auto />
    </section>
  );
}

export default UserLists;
