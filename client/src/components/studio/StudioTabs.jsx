// Onglets du Studio autres que la vue d'ensemble — chantier P1-B (PLAN.md 2.5) :
//   Critiques  la section « Notes & critiques » d'avant (chiffres, histogramme, albums les mieux notés, morceaux
//              préférés), puis toutes ses critiques page par page (GET /api/users/:u/reviews, curseur) ;
//   Vinyles    toute la vinylthèque, page par page (GET /api/users/:u/vinyls, curseur), les plus récents d'abord ;
//   Listes, Badges, Posts : les emplacements des autres chantiers (UserLists P1-C, BadgeGrid P1-F, UserPosts P1-A),
//   montés par Profile.jsx.
import { useEffect, useMemo } from 'react';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useApi } from '../../state/catalog.js';
import { useCursorList } from '../../state/paged.js';
import { ErrorBox, LoadMore, Skeleton } from '../feedback.jsx';
import { RatedItemLink, RatingHistogram, RatingValue, ReviewList } from '../Rating.jsx';
import { VinylShelf } from '../Vinyl.jsx';
import { ReviewHead } from './ReviewHead.jsx';
import '../../styles/studio.css';

const enc = encodeURIComponent;

/** Chiffres, histogramme et favoris notés (la section « Notes & critiques » de P0), sans la liste des critiques. */
function RatingsSummary({ username, isSelf }) {
  const { t } = useI18n();
  const { ratings } = useGame();
  // Change dès qu'une de mes notes change : la section se recharge alors (son propre Studio).
  const signature = useMemo(() => (isSelf ? [...ratings].map(([k, v]) => `${k}=${v}`).join('|') : ''), [ratings, isSelf]);
  const { data, error, reload } = useApi(`/users/${enc(username)}/ratings`, { keep: false });
  useEffect(() => {
    if (signature) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.stats) return <div className="rows" aria-busy="true"><Skeleton kind="row" count={3} /></div>;
  const s = data.stats;
  const topAlbums = data.topAlbums || [];
  const topTracks = data.topTracks || [];
  if (s.count === 0) return <p className="empty">{isSelf ? t('ratingsProfile.emptySelf') : t('ratingsProfile.emptyOther', { name: username })}</p>;
  return (
    <div className="ratings-profile__grid">
      <div className="panel ratings-profile__stats">
        <dl className="mini-stats">
          <div><dt>{t('ratingsProfile.statRatings')}</dt><dd className="mono">{s.count}</dd></div>
          <div><dt>{t('ratingsProfile.statAlbums')}</dt><dd className="mono">{s.albums}</dd></div>
          <div><dt>{t('ratingsProfile.statReviews')}</dt><dd className="mono">{s.reviews}</dd></div>
          <div><dt>{t('ratingsProfile.statAverage')}</dt><dd><RatingValue value={s.average} average size={13} /></dd></div>
        </dl>
        <RatingHistogram distribution={s.distribution} />
      </div>
      {(topAlbums.length > 0 || topTracks.length > 0) && (
        <div className="ratings-profile__top">
          {topAlbums.length > 0 && (
            <>
              <h3 className="studio__label">{t('ratingsProfile.favAlbums')}</h3>
              <div className="top-albums">
                {topAlbums.map((r) => (
                  <RatedItemLink key={r.id} type="album" id={r.id} className="top-album" coverClassName="top-album__cover" titleClassName="top-album__title">
                    <RatingValue value={r.score} size={12} />
                  </RatedItemLink>
                ))}
              </div>
            </>
          )}
          {topTracks.length > 0 && (
            <>
              <h3 className="studio__label">{t('ratingsProfile.favTracks')}</h3>
              <ol className="top-tracks">
                {topTracks.map((r) => (
                  <li key={r.id}>
                    <RatedItemLink type="track" id={r.id} className="top-tracks__item" coverClassName="top-tracks__cover" titleClassName="top-tracks__title">
                      <RatingValue value={r.score} size={11} />
                    </RatedItemLink>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Onglet Critiques : le résumé des notes, puis toutes les critiques (curseur). */
export function ReviewsTab({ username, isSelf }) {
  const { t } = useI18n();
  const list = useCursorList(`/users/${enc(username)}/reviews`, { limit: 10, idOf: (r) => r.ratingId ?? `${r.type}:${r.id}` });
  return (
    <div className="st-tab st-reviews" data-studio-tab="reviews">
      <section className="ratings-profile">
        <header className="studio__head"><h2>{t('ratingsProfile.title')}</h2></header>
        <RatingsSummary username={username} isSelf={isSelf} />
      </section>
      <section className="ratings-profile__reviews st-reviews__all">
        <h3 className="studio__label">{isSelf ? t('studio.reviewsTab.allSelf') : t('studio.reviewsTab.all')}</h3>
        {list.error && !list.items.length ? <ErrorBox error={list.error} onRetry={list.reload} />
          : list.loading && !list.items.length ? <div className="rows" aria-busy="true"><Skeleton kind="row" count={3} /></div>
            : (
              <ReviewList reviews={list.items} empty={t('studio.reviewsTab.empty', { name: username })} renderItem={(r) => <ReviewHead review={r} isSelf={isSelf} />} />
            )}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} error={list.items.length ? list.error : null} onRetry={list.loadMore} />
      </section>
    </div>
  );
}

/** Onglet Vinyles : toute l'étagère, page par page (les plus récents d'abord). */
export function VinylsTab({ profile, isSelf }) {
  const { t } = useI18n();
  const list = useCursorList(`/users/${enc(profile.username)}/vinyls`, { limit: 24, idOf: (v) => v.albumId });
  const count = Math.max(profile.vinylCount ?? 0, list.items.length);
  return (
    <div className="st-tab st-vinyls-tab" data-studio-tab="vinyls">
      {list.error && !list.items.length ? <ErrorBox error={list.error} onRetry={list.reload} /> : list.loading && !list.items.length ? (
        <div className="vinyl-shelf st-vinyls-tab__wait" aria-busy="true"><Skeleton kind="tile" count={5} /></div>
      ) : (
        <VinylShelf
          vinyls={list.items}
          count={count}
          mine={isSelf}
          color={isSelf ? undefined : profile.cosmetics?.vinyl ?? null}
          title={isSelf ? t('vinyl.shelf') : t('vinyl.shelfOther', { name: profile.username })}
          emptyText={isSelf ? t('vinyl.emptySelf') : t('studio.vinylsTab.empty')}
        />
      )}
      <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} label={t('studio.vinylsTab.more')}
        error={list.items.length ? list.error : null} onRetry={list.loadMore} />
    </div>
  );
}
