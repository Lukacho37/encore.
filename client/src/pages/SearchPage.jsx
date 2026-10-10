// Page de résultats de la recherche globale (/search?q=&type=) — chantier P0-E (PLAN.md 2.1, 2.5, 4.1.4).
// Champ (le même que dans la barre du haut) puis onglets Tout · Albums · Morceaux · Artistes · Membres · Listes avec
// leurs compteurs. « Tout » montre les groupes des suggestions ; un onglet pagine son type (24 par page, chargement
// automatique en bas de page) : albums en vignettes, le reste en lignes. Champ vide : recherches récentes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { clearRecentSearches, recentSearches, rememberSearch, resultPath, searchPagePath, useSearchSuggest } from '../state/search.js';
import { useCursorList } from '../state/paged.js';
import { useAlbums } from '../state/catalog.js';
import { prepareQuery, SEARCH_KINDS } from '@shared/search.js';
import { AlbumTile } from '../components/AlbumTile.jsx';
import { EmptyState, ErrorBox, LoadMore, Skeleton } from '../components/feedback.jsx';
import { SearchCombobox } from '../components/search/SearchCombobox.jsx';
import { countLabel, lookupOf, optionFor, recentEntryOf, RecentBody, ResultLink } from '../components/search/results.jsx';
import '../styles/search.css';

const TABS = ['all', ...SEARCH_KINDS];

/** Vignettes d'albums (réponse de suggestions ou page d'un onglet), avec la progression du joueur. */
function AlbumGrid({ rows, progress }) {
  const albums = useAlbums(rows.map((r) => r.id));
  return (
    <div className="album-grid">
      {rows.map((r, i) => (albums[i] ? <AlbumTile key={r.id} album={albums[i]} progress={progress[r.id]} /> : null))}
    </div>
  );
}

/** Lignes (morceaux, artistes, membres, listes) : liens vers chaque résultat. */
function Rows({ kind, rows, lookup, query }) {
  const { t } = useI18n();
  const options = rows.map((row) => optionFor(kind, row, lookup)).filter(Boolean);
  return (
    <ul className="gs-rows">
      {options.map((o) => (
        <li key={o.key}>
          <ResultLink option={o} query={query} to={resultPath(o.pick)} onClick={() => rememberSearch(recentEntryOf(o, t))} />
        </li>
      ))}
    </ul>
  );
}

/** Onglet « Tout » : un bloc par type, dans l'ordre des suggestions (le type du meilleur résultat en tête). */
function AllResults({ data, query, onTab }) {
  const { t } = useI18n();
  const lookup = useMemo(() => lookupOf(data), [data]);
  const lead = data.top?.kind;
  const kinds = SEARCH_KINDS.filter((k) => data.groups?.[k]?.length).sort((a, b) => (b === lead) - (a === lead));
  return kinds.map((kind) => {
    const rows = data.groups[kind];
    const n = data.counts?.[kind] || rows.length;
    return (
      <section key={kind} className="gs-page__section" aria-labelledby={`gs-page-${kind}`}>
        <header className="gs-page__head">
          <h2 id={`gs-page-${kind}`}>{t(`search.kinds.${kind}`)} <span className="gs-page__n">{countLabel(n)}</span></h2>
          {n > rows.length && <button type="button" className="gs-link section__link" onClick={() => onTab(kind)}>{t('search.seeAll')}</button>}
        </header>
        {kind === 'album' ? <AlbumGrid rows={rows} progress={data.progress || {}} /> : <Rows kind={kind} rows={rows} lookup={lookup} query={query} />}
      </section>
    );
  });
}

/** Onglet d'un type : pages de 24, chargées en bas de page. */
function TypedResults({ type, query, fq }) {
  const { t } = useI18n();
  const [progress, setProgress] = useState({});
  const [total, setTotal] = useState(null);
  const path = `/search?type=${type}&q=${encodeURIComponent(fq)}`;
  const onPage = useCallback((res) => {
    if (res?.progress) setProgress((p) => ({ ...p, ...res.progress }));
    if (Number.isFinite(res?.total)) setTotal(res.total);
  }, []);
  useEffect(() => {
    setProgress({});
    setTotal(null);
  }, [path]);
  const list = useCursorList(path, { limit: 24, onPage });
  const lookup = useMemo(() => ({ progress }), [progress]);

  if (list.error && !list.items.length) return <ErrorBox error={list.error} onRetry={list.reload} />;
  if (list.loading && !list.items.length) {
    return type === 'album'
      ? <div className="album-grid" aria-busy="true"><Skeleton kind="tile" count={8} /></div>
      : <div className="gs-rows" aria-busy="true"><Skeleton kind="row" count={6} /></div>;
  }
  if (!list.items.length) {
    return <EmptyState icon="search" title={t('search.none', { q: query })} body={t('search.noneHint')} />;
  }
  return (
    <>
      {total != null && <p className="muted small gs-page__count" aria-live="polite">{t('search.page.count', { n: total })}</p>}
      {type === 'album'
        ? <AlbumGrid rows={list.items} progress={progress} />
        : <Rows kind={type} rows={list.items} lookup={lookup} query={query} />}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} error={list.items.length ? list.error : null} onRetry={list.loadMore} auto />
    </>
  );
}

function Recents() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState(recentSearches);
  if (!items.length) return <EmptyState icon="search" title={t('search.page.empty')} body={t('search.page.hint')} />;
  return (
    <section className="gs-page__section" aria-labelledby="gs-page-recent">
      <header className="gs-page__head">
        <h2 id="gs-page-recent">{t('search.recent')}</h2>
        <button type="button" className="gs-link section__link" onClick={() => { setItems([]); clearRecentSearches(); }}>{t('search.clearRecent')}</button>
      </header>
      <ul className="gs-rows">
        {items.map((entry, i) => (
          <li key={i}>
            <Link className="gsearch__opt gs-row" to={entry.kind === 'query' ? searchPagePath(entry.q) : resultPath(entry)}
              onClick={(e) => {
                if (entry.kind !== 'query') return;
                e.preventDefault();
                navigate(searchPagePath(entry.q));
              }}>
              <RecentBody entry={entry} size={48} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SearchPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') || '').trim().slice(0, 100);
  const type = TABS.includes(params.get('type')) ? params.get('type') : 'all';
  const [text, setText] = useState(q);
  const top = useRef(null);
  // Précédent / suivant, nouvelle recherche depuis la barre du haut : le champ reprend la requête de l'adresse.
  useEffect(() => {
    setText(q);
  }, [q]);
  const prepared = prepareQuery(q);
  const all = useSearchSuggest(q);
  const counts = all.data?.counts || {};
  const go = (next) => setParams((prev) => {
    const out = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(next)) {
      if (!v || v === 'all') out.delete(k);
      else out.set(k, v);
    }
    return out;
  });
  const onTab = (kind) => {
    go({ type: kind });
    top.current?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="gs-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{t('search.page.eyebrow')}</span>
          <h1>{q ? t('search.page.title', { q }) : t('search.page.empty')}</h1>
        </div>
      </header>

      <div className="gs-page__field">
        <SearchCombobox variant="inline" value={text} onChange={setText} id="gs-page"
          onSubmit={(v) => go({ q: v, type })} placeholder={t('search.placeholder')} />
      </div>

      {prepared && (
        <nav className="tabs gs-page__tabs" aria-label={t('search.filterKinds')} ref={top}>
          {TABS.map((k) => (
            <Link key={k} to={searchPagePath(q, k)} replace aria-current={type === k ? 'page' : undefined}
              className={`tabs__tab${type === k ? ' active' : ''}${k !== 'all' && all.data && !counts[k] ? ' gs-page__tab--empty' : ''}`}>
              {t(`search.kinds.${k}`)}
              {k !== 'all' && all.data && <span className="gs-page__n">{countLabel(counts[k])}</span>}
            </Link>
          ))}
        </nav>
      )}

      {prepared && all.data?.suggestion && (
        <p className="gs-page__fuzzy">
          {t('search.didYouMean')}{' '}
          <Link to={searchPagePath(all.data.suggestion, type)} className="gs-link"><b>{all.data.suggestion}</b></Link>
          {t('search.didYouMeanEnd')}
        </p>
      )}

      {!q && <Recents />}
      {q && !prepared && <EmptyState icon="search" title={t('search.minChars')} />}
      {prepared && type === 'all' && (
        all.error && !all.data ? <ErrorBox error={all.error} onRetry={all.retry} />
          : !all.data ? <div className="album-grid" aria-busy="true"><Skeleton kind="tile" count={4} /></div>
            : SEARCH_KINDS.some((k) => all.data.groups?.[k]?.length) ? <AllResults data={all.data} query={q} onTab={onTab} />
              : <EmptyState icon="search" title={t('search.none', { q })} body={t('search.noneHint')} />
      )}
      {prepared && type !== 'all' && <TypedResults key={`${type}|${prepared.fq}`} type={type} query={q} fq={prepared.fq} />}
    </div>
  );
}

