// Onglet « Coffrets » de la collection — chantier P2-B (PLAN.md 6.8, 9.2). Props (contrat, ne pas les renommer) : aucune.
// GET /api/sets?kind=&cursor= : les coffrets, commencés d'abord (les plus avancés), puis la sélection, les événements et
// genre × décennie. Filtres en pastilles (comme les genres de l'onglet Albums), gardés dans l'adresse (?kind=) ; pages
// de 24 avec « Voir plus ». Progression en albums complétés (« 3/8 »), jamais en pourcentage du catalogue.
import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { apiPath } from '../../state/catalog.js';
import { useCursorList } from '../../state/paged.js';
import { EmptyState, ErrorBox, LoadMore } from '../feedback.jsx';
import { Icon, useToast } from '../ui.jsx';
import { SetCard } from './parts.jsx';
import '../../styles/sets.css';

export const SET_FILTERS = ['all', 'started', 'editorial', 'event', 'generated'];
const PAGE = 24;
const SKELETONS = Array.from({ length: 6 }, (_, i) => <span key={i} className="panel set-card set-card--skel" aria-hidden="true" />);

export function SetsTab() {
  const { t, num } = useI18n();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const kind = SET_FILTERS.includes(params.get('kind')) ? params.get('kind') : 'all';
  const [counts, setCounts] = useState(null);
  const onPage = useCallback((res) => {
    if (res?.counts) setCounts(res.counts);
    // Coffret créé après coup : ce qui est déjà fait est récompensé à la lecture.
    for (const r of res?.rewards || []) toast(t(`sets.rewardToast.${r.reward}`), 'success');
  }, [t, toast]);
  const list = useCursorList(apiPath('/sets', { kind: kind === 'all' ? null : kind }), { limit: PAGE, onPage });
  const choose = (k) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (k === 'all') next.delete('kind');
    else next.set('kind', k);
    return next;
  }, { replace: true });

  let body;
  if (list.error && !list.items.length) body = <ErrorBox error={list.error} onRetry={list.reload} />;
  else if (list.loading && !list.items.length) body = <div className="set-grid" aria-busy="true">{SKELETONS}</div>;
  else if (!list.items.length) {
    body = (
      <EmptyState icon="disc" className="coll-empty"
        body={kind === 'started' ? t('sets.empty.started') : kind === 'all' ? t('sets.empty.all') : t('sets.empty.kind')}
        action={kind === 'started' ? { label: t('sets.empty.startedAction'), onClick: () => choose('all') } : null} />
    );
  } else {
    body = (
      <>
        <div className="set-grid" aria-busy={list.loading || undefined}>
          {list.items.map((s) => <SetCard key={s.id} set={s} />)}
        </div>
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} error={list.error} onRetry={list.reload} />
      </>
    );
  }

  return (
    <div className="set-tab" data-tab="sets">
      <p className="coll-hint"><Icon name="disc" size={16} /><span>{t('sets.intro')}</span></p>
      <div className="chips coll-chips" role="group" aria-label={t('sets.filterLabel')}>
        {SET_FILTERS.map((k) => (
          <button key={k} type="button" className={`chip-btn${kind === k ? ' is-on' : ''}`} aria-pressed={kind === k} onClick={() => choose(k)} data-kind={k}>
            {t(`sets.kinds.${k}`)}
            {counts?.[k] != null && <span className="coll-chip__n">{num(counts[k])}</span>}
          </button>
        ))}
      </div>
      {body}
      <p className="set-tab__foot">
        <Link to="/events" className="link-btn"><Icon name="star" size={15} /> {t('sets.calendar')}</Link>
      </p>
    </div>
  );
}

export default SetsTab;
