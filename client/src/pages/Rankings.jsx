// Pages /rankings et /rankings/:category — chantier P1-F (PLAN.md 2.5 Rankings, 5.4, 8.2 P1.5).
//   Hub : les catégories classées, par rubrique (Global, Décennies, Genres, Années, Genre et décennie, Pays, Artistes),
//     chacune avec son podium (vraies pochettes), ses albums classés et ses votes ; la catégorie du jour en avant.
//   Classement : rang, pochette, titre (lien vers la page de l'album ou du morceau), Elo, votes, « provisoire » sous
//     50 votes ; pages au défilement (500 places au plus) ; « Voter dans cette catégorie ».
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { useAlbum, useApi, useTrack } from '../state/catalog.js';
import { useCursorList } from '../state/paged.js';
import CoverArt from '../components/CoverArt.jsx';
import { EmptyState, ErrorBox, LoadMore, Skeleton } from '../components/feedback.jsx';
import { Icon } from '../components/ui.jsx';
import { BadgeToast } from '../components/play/BadgeToast.jsx';
import { CategoryName, enc, useCategoryLabel } from '../components/play/common.jsx';
import { HUB_GROUPS, PROVISIONAL_VOTES, parseCategory } from '@shared/battles.js';
import '../styles/play.css';

function Cover({ itemType, id, n }) {
  const album = useAlbum(itemType === 'album' ? id : null);
  const track = useTrack(itemType === 'track' ? id : null);
  const item = album || track;
  return (
    <span className="pl-cat__cover">
      {item?.art ? <CoverArt art={{ ...item.art, seed: item.art.seed || item.id }} title={item.title} sizes="90px" /> : <span className="cover skeleton" />}
      {n && <span className="pl-cat__n">{n}</span>}
    </span>
  );
}

function CategoryCard({ cat, featured }) {
  const { t } = useI18n();
  return (
    <Link to={`/rankings/${enc(cat.key)}`} className={`pl-cat${featured ? ' is-featured' : ''}`} data-category={cat.key}>
      <span className="pl-cat__covers">
        {[0, 1, 2].map((i) => (cat.top[i] ? <Cover key={i} itemType={cat.itemType} id={cat.top[i]} n={i + 1} /> : <span key={i} className="pl-cat__cover" />))}
      </span>
      <span className="pl-cat__title"><CategoryName category={cat.key} /></span>
      <span className="pl-cat__meta">
        {featured && <><span className="chip chip--sm chip--cue">{t('rankings.featured')}</span> · </>}
        {t(cat.itemType === 'track' ? 'rankings.trackItems' : 'rankings.items', { n: cat.items })} · {t('rankings.votes', { n: cat.votes })}
      </span>
    </Link>
  );
}

function Hub() {
  const { t } = useI18n();
  const { data, error, reload } = useApi('/rankings', { keep: false });
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <div className="pl-hub"><Skeleton kind="tile" count={6} /></div>;
  if (!data.categories.length) {
    return <EmptyState icon="trophy" title={t('rankings.empty')} body={t('rankings.emptyBody')} action={{ label: t('rankings.emptyAction'), to: '/battles' }} />;
  }
  return (
    <>
      {HUB_GROUPS.map((group) => {
        const list = data.categories.filter((c) => c.kind === group);
        if (!list.length) return null;
        return (
          <section key={group} className="section" data-group={group}>
            <header className="section__head"><h2>{t(`rankings.groups.${group}`)}</h2></header>
            <div className="pl-hub">
              {list.map((c) => <CategoryCard key={c.key} cat={c} featured={c.key === data.featured} />)}
            </div>
          </section>
        );
      })}
    </>
  );
}

function RankRow({ row, itemType }) {
  const { t, num } = useI18n();
  const album = useAlbum(itemType === 'album' ? row.id : null);
  const track = useTrack(itemType === 'track' ? row.id : null);
  const item = album || track;
  const href = itemType === 'track' ? `/track/${enc(row.id)}` : `/album/${enc(row.id)}`;
  const sub = itemType === 'track' ? [track?.artist, track?.album].filter(Boolean).join(' · ') : [album?.artist, album?.year].filter(Boolean).join(' · ');
  return (
    <li className="pl-rank" data-rank={row.rank} data-id={row.id}>
      <span className="pl-rank__n">{row.rank}</span>
      <Link to={href} className="pl-rank__cover" tabIndex={-1} aria-hidden="true">
        {item?.art ? <CoverArt art={{ ...item.art, seed: item.art.seed || item.id }} sizes="56px" /> : <span className="cover skeleton" />}
      </Link>
      <span className="pl-rank__info">
        <Link to={href} className="pl-rank__title">{item?.title || row.id}</Link>
        <span className="pl-rank__sub">{sub}</span>
      </span>
      <span className="pl-rank__stats">
        <span><span className="mono">{num(row.rating)}</span> Elo</span>
        <span>{t('rankings.votes', { n: row.votes })}</span>
        {row.provisional && <span className="chip chip--sm" title={t('rankings.provisionalHint')}>{t('rankings.provisional')}</span>}
      </span>
    </li>
  );
}

function Ranking({ category }) {
  const { t } = useI18n();
  const cat = parseCategory(category);
  const label = useCategoryLabel(category);
  const [meta, setMeta] = useState(null);
  const list = useCursorList(cat ? `/rankings/${enc(category)}` : null, { limit: 25, onPage: (res) => setMeta({ total: res.total, listed: res.listed }) });
  if (!cat) return <EmptyState icon="trophy" title={t('errors.unknown_category')} action={{ label: t('rankings.back'), to: '/rankings', primary: false }} />;
  const provisional = list.items.length > 0 && list.items.some((r) => r.votes < PROVISIONAL_VOTES);
  return (
    <>
      <header className="page-head">
        <div>
          <Link to="/rankings" className="back-link"><Icon name="back" size={16} /> {t('rankings.back')}</Link>
          <span className="eyebrow">{t('rankings.kicker')} · {label.short}</span>
          <h1>{label.long}</h1>
          {meta && <p className="pl-page__intro">{t(cat.itemType === 'track' ? 'rankings.trackItems' : 'rankings.items', { n: meta.total })}</p>}
        </div>
        <Link to={`/battles?category=${enc(category)}`} className="btn btn--primary btn--sm"><Icon name="trophy" size={16} /> {t('rankings.vote')}</Link>
      </header>
      {meta && !meta.listed && meta.total > 0 && <p className="small muted">{t('rankings.notListed')}</p>}
      {provisional && <p className="small muted">{t('rankings.provisionalHint')}</p>}
      {list.error && !list.items.length ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : !list.items.length && list.loading ? (
        <div className="rows"><Skeleton kind="row" count={6} /></div>
      ) : !list.items.length ? (
        <EmptyState icon="trophy" title={t('rankings.empty')} body={t('rankings.emptyBody')} action={{ label: t('rankings.emptyAction'), to: `/battles?category=${enc(category)}` }} />
      ) : (
        <ol className="pl-ranks">
          {list.items.map((row) => <RankRow key={row.id} row={row} itemType={cat.itemType} />)}
        </ol>
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} error={list.items.length ? list.error : null} onRetry={list.loadMore} auto />
    </>
  );
}

export default function Rankings() {
  const { t } = useI18n();
  const { category } = useParams();
  return (
    <div className="pl-page" data-page="rankings">
      {category ? (
        <Ranking category={category} />
      ) : (
        <>
          <header className="page-head">
            <div>
              <span className="eyebrow">{t('rankings.kicker')}</span>
              <h1>{t('rankings.title')}</h1>
              <p className="pl-page__intro">{t('rankings.intro')}</p>
            </div>
            <Link to="/battles" className="btn btn--primary btn--sm"><Icon name="trophy" size={16} /> {t('battles.title')}</Link>
          </header>
          <Hub />
        </>
      )}
      <BadgeToast />
    </div>
  );
}
