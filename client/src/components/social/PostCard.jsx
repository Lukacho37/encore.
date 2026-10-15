// Carte d'un post — chantier P1-A (PLAN.md 4.2.1, 8.2 P1.1, components.css .post) : auteur (avatar, « Ami », raison
// du fil), heure (lien vers /post/:id), visibilité, texte (UgcText), carte de mention (album, morceau, artiste, liste)
// ou critique partagée, J'aime, commentaires (fil sous le post ou sur sa page), Partager. ⋯ Signaler / Bloquer sur les
// posts des autres, Modifier / Supprimer sur les siens. Un post masqué par la modération n'est rendu qu'à son auteur.
// Props : { post, onChange?(post), onRemove?(id), reason?, hideItem?, page?, thread? }.
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { Avatar, Icon, useToast } from '../ui.jsx';
import UgcText from '../UgcText.jsx';
import SafetyMenu from '../safety/SafetyMenu.jsx';
import { LikeButton } from './LikeButton.jsx';
import { MentionCard } from './MentionCard.jsx';
import { ReviewCard, ShareButton } from './ReviewCard.jsx';
import { CommentThread } from './CommentThread.jsx';
import { OwnMenu } from './OwnMenu.jsx';
import { itemHref, timeAgo, userHref } from './util.js';
import '../../styles/social.css';

const POST_MAX = 1000;

/** Ce que cite le post : critique partagée, liste, ou album / morceau / artiste. */
function Attachment({ post }) {
  if (!post.item) return null;
  if (post.item.type === 'review') return post.review ? <ReviewCard review={post.review} variant="embed" /> : <MentionCard item={{ type: 'review' }} />;
  if (post.item.type === 'list') return <MentionCard list={post.list || null} />;
  return <MentionCard item={post.item} stats={post.itemStats} />;
}

export function PostCard({ post: initial, onChange, onRemove, reason, hideItem = false, page = false, thread = false }) {
  const { t, lang, error } = useI18n();
  const toast = useToast();
  const [post, setPost] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial.body || '');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(thread);
  if (post !== initial && initial.id === post.id && initial.likeCount !== post.likeCount && !busy) {
    // Le parent a rechargé le post (fil rafraîchi) : la nouvelle version l'emporte.
    setPost(initial);
  }
  const update = (next) => {
    setPost(next);
    onChange?.(next);
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await api('PATCH', `/posts/${post.id}`, { body: draft });
      update({ ...post, ...res.post });
      setEditing(false);
      toast(t('social.postEdited'), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api('DELETE', `/posts/${post.id}`);
      toast(t('social.postDeleted'), 'success');
      onRemove?.(post.id);
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  const href = itemHref('post', post.id);
  const user = post.user;
  const friend = user.relation === 'friend';
  return (
    <article className={`post${post.moderated ? ' is-moderated' : ''}`} id={`post-${post.id}`} data-post={post.id}>
      <div className="post__head">
        <Link to={userHref(user)} className="post__avatar" tabIndex={-1} aria-hidden="true"><Avatar user={user} size={40} /></Link>
        <div className="post__who">
          <span className="post__name">
            <Link to={userHref(user)}>{user.username}</Link>
            {friend && <span className="chip chip--sm chip--cue">{t('social.friendTag')}</span>}
            {reason && reason !== 'friend' && <span className="chip chip--sm chip--quiet">{t(`feed.reasons.${reason}`)}</span>}
          </span>
          <span className="post__meta">
            <span>@{user.username}</span>
            <span aria-hidden="true">·</span>
            <Link to={href} title={t('social.openPost')}><time dateTime={new Date(post.createdAt).toISOString()}>{timeAgo(post.createdAt, lang)}</time></Link>
            {post.visibility === 'friends' && (
              <span title={t('social.visibilityHint.friends')} className="so-vis"><Icon name="users" size={13} /> {t('social.visibility.friends')}</span>
            )}
            {post.editedAt && <span>· {t('social.edited')}</span>}
          </span>
        </div>
        {post.mine
          ? <OwnMenu onEdit={() => { setDraft(post.body || ''); setEditing(true); }} onDelete={remove} deleteTitle={t('social.deletePostTitle')} deleteBody={t('social.deletePostBody')} />
          : <SafetyMenu target={{ type: 'post', id: post.id }} user={user} />}
      </div>
      {post.moderated && <p className="so-note">{t('social.moderated')}</p>}
      {editing ? (
        <div className="so-edit">
          <textarea className="input textarea" rows={3} maxLength={POST_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('composer.label')} />
          <div className="so-edit__actions">
            <span className="so-composer__count mono">{t('composer.counter', { n: draft.length })}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--primary btn--sm" disabled={busy || (!draft.trim() && !post.item)} onClick={save}>{t('social.save')}</button>
          </div>
        </div>
      ) : post.body ? (
        <div className="post__text"><UgcText text={post.body} clamp={!page} /></div>
      ) : null}
      {!hideItem && <Attachment post={post} />}
      <div className="post__actions">
        <LikeButton targetType="post" targetId={post.id} liked={post.liked} count={post.likeCount} showLikers={page}
          onChange={({ liked, likeCount }) => update({ ...post, liked, likeCount })} />
        {page ? (
          <span className="act-btn" aria-hidden="true"><Icon name="comment" size={18} /><span className="mono">{post.commentCount}</span></span>
        ) : (
          <button type="button" className="act-btn" aria-expanded={open} aria-label={t('social.comments', { n: post.commentCount })} onClick={() => setOpen((o) => !o)}>
            <Icon name="comment" size={18} /><span className="mono">{post.commentCount}</span>
          </button>
        )}
        <ShareButton path={href} title={t('post.kicker', { name: user.username })} />
      </div>
      {open && !page && (
        <CommentThread target={{ type: 'post', id: post.id }} ownerId={user.id} locked={!!post.moderated} autoFocus={!post.commentCount}
          onCountChange={(d) => update({ ...post, commentCount: Math.max(0, post.commentCount + d) })} />
      )}
    </article>
  );
}

export default PostCard;
