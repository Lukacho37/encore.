// Permalien d'une critique (/review/:id) — chantier P1-A (PLAN.md 2.1, 4.2.1, 8.2 P1.1) : l'album ou le morceau critiqué
// (carte de mention avec sa vraie pochette), la critique en entier (note, texte, J'aime et « Aimé par », Partager, ⋯),
// puis ses réponses (un niveau). Ouvert depuis « N réponses » sous une critique, le fil ou une notification. Critique
// retirée ou masquée : « Cette critique n'est plus là ».
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { get } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { EmptyState, ErrorBox } from '../components/feedback.jsx';
import { Icon } from '../components/ui.jsx';
import { useRatedItem } from '../components/Rating.jsx';
import { MentionCard } from '../components/social/MentionCard.jsx';
import { ReviewCard } from '../components/social/ReviewCard.jsx';
import { CommentThread } from '../components/social/CommentThread.jsx';
import { itemHref } from '../components/social/util.js';
import { BackLink, useCommentAnchor } from './PostPage.jsx';
import '../styles/social.css';

export default function ReviewPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const [state, setState] = useState({ data: null, error: null, id: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    get(`/reviews/${encodeURIComponent(id)}`)
      .then((data) => alive && setState({ data, error: null, id }))
      .catch((error) => alive && setState({ data: null, error, id }));
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  const item = state.data?.item || null;
  const rated = useRatedItem(item?.type, item?.id);
  const ready = state.id === id && !!state.data;
  useCommentAnchor(ready);

  if (state.id !== id) {
    return (
      <div className="so-page" aria-busy="true">
        <span className="back-link so-page__back"><Icon name="back" /> …</span>
        <div className="so-skel" />
      </div>
    );
  }
  if (state.error) {
    const gone = state.error.status === 404 || state.error.code === 'not_found';
    return (
      <div className="so-page" data-page="review">
        <BackLink label={t('post.home')} />
        {gone ? (
          <EmptyState icon="star" title={t('reviewPage.notFoundTitle')} body={t('reviewPage.notFoundBody')}
            action={{ label: t('post.home'), to: '/', primary: false }} />
        ) : <ErrorBox error={state.error} onRetry={() => setAttempt((n) => n + 1)} />}
      </div>
    );
  }

  const { review, comments } = state.data;
  const itemPage = itemHref(item?.type, item?.id);
  const self = review.user.relation === 'self';
  // La carte de l'élément est au-dessus : la critique ne le répète pas.
  const { item: _item, ...shown } = review;
  return (
    <div className="so-page" data-page="review">
      <BackLink to={itemPage || '/'} label={rated?.title || t('post.home')} />
      <h1 className="sr-only">{t('reviewPage.kicker', { name: review.user.username })}</h1>
      {item && (
        <div className="so-page__about">
          <span className="eyebrow">{t('reviewPage.about')}</span>
          <MentionCard item={item} />
        </div>
      )}
      <ReviewCard review={shown} variant="page"
        onChange={(next) => setState((s) => ({ ...s, data: { ...s.data, review: { ...s.data.review, ...next } } }))} />
      {self && itemPage && (
        <Link to={`${itemPage}#ma-note`} className="link-btn small so-page__edit"><Icon name="edit" size={14} /> {t('reviewPage.edit')}</Link>
      )}
      <section className="so-page__section" aria-labelledby="review-replies">
        <h2 id="review-replies">{t('reviewPage.replies')} <span className="mono so-count">{review.commentCount}</span></h2>
        <CommentThread target={{ type: 'review', id: review.id }} initial={comments} ownerId={review.user.id} locked={!!review.moderated}
          onCountChange={(d) => setState((s) => ({ ...s, data: { ...s.data, review: { ...s.data.review, commentCount: Math.max(0, (s.data.review.commentCount || 0) + d) } } }))} />
      </section>
      {itemPage && <Link to={`${itemPage}#critiques`} className="btn btn--ghost btn--sm so-page__all">{t('reviewPage.seeAll')}</Link>}
    </div>
  );
}
