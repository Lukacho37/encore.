// Critique dans le fil, dans un post qui la partage et sur son permalien /review/:id — chantier P1-A (PLAN.md 4.2.1,
// components.css .review__head, .review__album, .review__foot). Auteur, album ou morceau noté (vraie pochette), note,
// texte (UgcText), J'aime, « N réponses » (fil sous la critique ou lien vers son permalien), Partager ; ⋯ Signaler /
// Bloquer sur celles des autres.
// Props : { review (Review + item), variant: 'feed' | 'embed' | 'page', headline?, reason?, onChange?(review), thread? }.
import { useState } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import CoverArt from '../CoverArt.jsx';
import { RatingValue, useRatedItem } from '../Rating.jsx';
import { Avatar, Icon, useToast } from '../ui.jsx';
import UgcText from '../UgcText.jsx';
import SafetyMenu from '../safety/SafetyMenu.jsx';
import { LikeButton } from './LikeButton.jsx';
import { CommentThread } from './CommentThread.jsx';
import { itemHref, shareLink, timeAgo, userHref } from './util.js';
import '../../styles/social.css';

/** Album ou morceau noté : petite pochette, titre, artiste. */
export function ReviewItem({ item }) {
  const rated = useRatedItem(item?.type, item?.id);
  if (!rated) return null;
  return (
    <Link to={rated.to} className="review__album">
      <span className="review__cover"><CoverArt art={rated.art} sizes="36px" /></span>
      <span><strong>{rated.title}</strong>{rated.artist && <><br />{rated.artist}</>}</span>
    </Link>
  );
}

/** Bouton Partager d'une adresse du site (feuille de partage du système, sinon lien copié). */
export function ShareButton({ path, title, label = true }) {
  const { t } = useI18n();
  const toast = useToast();
  const share = async () => {
    const done = await shareLink(path, title || t('social.shareText'));
    if (done === 'copied') toast(t('social.shareCopied'), 'success');
  };
  return (
    <button type="button" className="act-btn" onClick={share} aria-label={t('social.share')}>
      <Icon name="share" size={18} />{label && <span>{t('social.share')}</span>}
    </button>
  );
}

export function ReviewCard({ review, variant = 'feed', headline, reason, onChange, thread = false }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(thread);
  const [count, setCount] = useState(review.commentCount || 0);
  if (!review?.user) return null;
  const href = itemHref('review', review.id);
  const self = review.user.relation === 'self';
  const page = variant === 'page';

  if (variant === 'embed') {
    return (
      <div className="review so-review so-review--embed">
        <div className="review__head">
          <span className="review__author">
            <Avatar user={review.user} size={28} />
            <span className="review__name">{review.user.username}</span>
          </span>
          <RatingValue value={review.score} size={14} />
        </div>
        <ReviewItem item={review.item} />
        {review.review && <div className="review__text"><UgcText text={review.review} clamp /></div>}
        <Link to={href} className="link-btn small">{t('social.openReview')}</Link>
      </div>
    );
  }

  return (
    <article className={`review so-review${page ? ' so-review--page' : ''}`} id={`review-${review.id}`} data-review={review.id}>
      <div className="review__head">
        <div className="review__author">
          <Link to={userHref(review.user)} className="post__avatar" tabIndex={-1} aria-hidden="true"><Avatar user={review.user} size={40} /></Link>
          <div className="post__who">
            <span className="post__name">
              <Link to={userHref(review.user)}>{review.user.username}</Link>
              {review.user.relation === 'friend' && <span className="chip chip--sm chip--cue">{t('social.friendTag')}</span>}
              {reason && reason !== 'friend' && <span className="chip chip--sm chip--quiet">{t(`feed.reasons.${reason}`)}</span>}
            </span>
            <span className="post__meta">
              {headline && <span>{headline} ·</span>}
              <Link to={href}><time dateTime={new Date(review.reviewAt || review.updatedAt).toISOString()}>{timeAgo(review.reviewAt || review.updatedAt, lang)}</time></Link>
            </span>
          </div>
        </div>
        {!self && <SafetyMenu target={{ type: 'review', id: review.id }} user={review.user} />}
      </div>
      <ReviewItem item={review.item} />
      <div className="review__meta"><RatingValue value={review.score} size={15} /></div>
      {review.moderated && <p className="so-note">{t('social.moderated')}</p>}
      {review.review && <div className="review__text"><UgcText text={review.review} clamp={!page} /></div>}
      <div className="review__foot">
        <LikeButton targetType="review" targetId={review.id} liked={review.liked} count={review.likeCount} showLikers={page}
          onChange={({ liked, likeCount }) => onChange?.({ ...review, liked, likeCount })} />
        {page ? null : (
          <button type="button" className="act-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <Icon name="comment" size={18} />
            <span>{count ? t('reviewFoot.replies', { n: count }) : t('reviewFoot.reply')}</span>
          </button>
        )}
        <ShareButton path={href} title={t('reviewPage.kicker', { name: review.user.username })} />
      </div>
      {open && !page && (
        <CommentThread target={{ type: 'review', id: review.id }} ownerId={review.user.id} locked={!!review.moderated} autoFocus={!count}
          onCountChange={(d) => setCount((c) => Math.max(0, c + d))} />
      )}
    </article>
  );
}

export default ReviewCard;
