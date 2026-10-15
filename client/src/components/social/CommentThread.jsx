// Fil de commentaires d'un post, d'une critique ou d'une liste — chantier P1-A (PLAN.md 4.2.1, components.css .thread,
// .comment, .composer). Un seul niveau de réponse : répondre à une réponse la rattache au commentaire de tête, avec
// « à @nom ». Les commentaires de tête arrivent du plus ancien au plus récent avec leurs deux premières réponses ;
// « Voir N autres réponses » lit la suite (GET /api/comments/:id/replies). Un commentaire supprimé qui a des réponses
// reste en place, vidé (« Commentaire supprimé »). Textes par UgcText, ⋯ Signaler / Bloquer sur ceux des autres ;
// l'auteur modifie et supprime les siens, le propriétaire du fil supprime ceux des autres.
// Props : { target: { type, id }, initial?: { items, nextCursor }, ownerId?, locked?, onCountChange?(delta), autoFocus? }.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, get, post } from '../../api.js';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { Avatar, ConfirmButton, Spinner, useToast } from '../ui.jsx';
import UgcText from '../UgcText.jsx';
import SafetyMenu from '../safety/SafetyMenu.jsx';
import { LikeButton } from './LikeButton.jsx';
import { timeAgo, userHref, useOnBlocked } from './util.js';
import '../../styles/social.css';

const COMMENT_MAX = 1000;
const enc = encodeURIComponent;

/** Champ d'une ligne (répondre, commenter) : avatar, texte, « Envoyer ». */
function ReplyBox({ placeholder, onSend, autoFocus = false, root = false, onCancel }) {
  const { t } = useI18n();
  const { user } = useGame();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const submit = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      if (await onSend(body)) setText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={`composer${root ? ' composer--root' : ''}`} onSubmit={submit}>
      <Avatar user={user} size={root ? 32 : 28} />
      <input ref={ref} className="input" value={text} maxLength={COMMENT_MAX} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel?.()} />
      <button type="submit" className="btn btn--primary btn--sm" disabled={!text.trim() || busy}>{busy ? <Spinner /> : t('comment.send')}</button>
    </form>
  );
}

/** Un commentaire (de tête ou réponse). */
function Comment({ c, target, canModerate, onReply, onChange, onDelete }) {
  const { t, lang, error } = useI18n();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body || '');
  const [busy, setBusy] = useState(false);

  if (c.deleted) {
    return (
      <div className="comment comment--gone" id={`comment-${c.id}`}>
        <span className="so-ghost-avatar" aria-hidden="true" />
        <div className="comment__body"><p className="comment__text comment__text--gone">{t('comment.deleted')}</p></div>
      </div>
    );
  }

  const save = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const res = await api('PATCH', `/comments/${c.id}`, { body });
      onChange(res.comment);
      setEditing(false);
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="comment" id={`comment-${c.id}`} data-comment={c.id}>
      <Link to={userHref(c.user)} tabIndex={-1} aria-hidden="true"><Avatar user={c.user} size={28} /></Link>
      <div className="comment__body">
        <div className="comment__head">
          <Link to={userHref(c.user)} className="comment__name">{c.user.username}</Link>
          {c.replyToUser && <span className="comment__to">{t('comment.replyTo', { name: c.replyToUser.username })}</span>}
          <time className="comment__time" dateTime={new Date(c.createdAt).toISOString()}>
            {timeAgo(c.createdAt, lang)}{c.editedAt ? ` · ${t('social.edited')}` : ''}
          </time>
          {c.moderated && <span className="chip chip--sm chip--danger">{t('comment.moderated')}</span>}
        </div>
        {editing ? (
          <div className="so-edit">
            <textarea className="input textarea" rows={2} maxLength={COMMENT_MAX} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('comment.label')} />
            <div className="so-edit__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setEditing(false); setDraft(c.body || ''); }}>{t('common.cancel')}</button>
              <button type="button" className="btn btn--primary btn--sm" disabled={busy || !draft.trim()} onClick={save}>{t('social.save')}</button>
            </div>
          </div>
        ) : (
          <div className="comment__text"><UgcText text={c.body} clamp /></div>
        )}
        <div className="comment__actions">
          <LikeButton targetType="comment" targetId={c.id} liked={c.liked} count={c.likeCount} size={14} compact
            onChange={({ liked, likeCount }) => onChange({ ...c, liked, likeCount })} />
          {onReply && <button type="button" className="act-btn" onClick={() => onReply(c)}>{t('social.reply')}</button>}
          {c.mine && !editing && <button type="button" className="act-btn" onClick={() => setEditing(true)}>{t('social.edit')}</button>}
          {(c.mine || canModerate) && (
            <ConfirmButton className="act-btn" confirmLabel={t('comment.deleteConfirm')} onConfirm={() => onDelete(c)}>{t('social.delete')}</ConfirmButton>
          )}
          {!c.mine && <SafetyMenu target={{ type: 'comment', id: c.id }} user={c.user} />}
        </div>
      </div>
    </div>
  );
}

export function CommentThread({ target, initial = null, ownerId = null, locked = false, onCountChange, autoFocus = false }) {
  const { t, error } = useI18n();
  const { user } = useGame();
  const toast = useToast();
  const [state, setState] = useState(() => ({
    items: initial?.items || [],
    next: initial?.nextCursor ?? null,
    loading: !initial,
    error: null,
  }));
  const [replyTo, setReplyTo] = useState(null); // { parentId, user }
  const [moreReplies, setMoreReplies] = useState({}); // parentId → { next, loading }
  const key = `${target.type}:${target.id}`;
  const canModerate = ownerId != null && user && ownerId === user.id;

  const load = useCallback((cursor = null) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    get(`/comments?target=${enc(key)}&limit=20${cursor ? `&cursor=${enc(cursor)}` : ''}`)
      .then((res) => setState((s) => {
        const kept = cursor ? s.items : [];
        const seen = new Set(kept.map((c) => c.id));
        return { items: [...kept, ...(res.items || []).filter((c) => !seen.has(c.id))], next: res.nextCursor ?? null, loading: false, error: null };
      }))
      .catch((err) => setState((s) => ({ ...s, loading: false, error: err })));
  }, [key]);

  useEffect(() => {
    if (!initial) load(null);
    // Nouvelle cible : on repart de la première page ; `initial` n'est lu qu'au premier rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Joueur bloqué depuis un menu ⋯ : ses commentaires disparaissent tout de suite.
  useOnBlocked((userId) => setState((s) => ({
    ...s,
    items: s.items.filter((c) => c.user?.id !== userId).map((c) => (c.replies ? { ...c, replies: c.replies.filter((r) => r.user?.id !== userId) } : c)),
  })));

  const patch = (id, fn) => setState((s) => ({
    ...s,
    items: s.items.map((c) => (c.id === id ? fn(c) : c.replies?.some((r) => r.id === id) ? { ...c, replies: c.replies.map((r) => (r.id === id ? fn(r) : r)) } : c)),
  }));

  const send = async (body, parent = null) => {
    try {
      const res = await post('/comments', { targetType: target.type, targetId: target.id, body, ...(parent ? { parentId: parent.id } : {}) });
      const comment = res.comment;
      if (comment.parentId) {
        setState((s) => ({
          ...s,
          items: s.items.map((c) => (c.id === comment.parentId
            ? { ...c, replyCount: (c.replyCount || 0) + 1, replies: [...(c.replies || []), comment] }
            : c)),
        }));
        setReplyTo(null);
      } else {
        setState((s) => ({ ...s, items: [...s.items, comment] }));
      }
      onCountChange?.(1);
      return true;
    } catch (err) {
      toast(error(err.code), 'error');
      return false;
    }
  };

  const remove = async (c) => {
    try {
      await api('DELETE', `/comments/${c.id}`);
      setState((s) => {
        if (!c.parentId) {
          const soft = (c.replyCount || 0) > 0;
          return { ...s, items: soft ? s.items.map((x) => (x.id === c.id ? { ...x, deleted: true, body: null, user: null, mine: false } : x)) : s.items.filter((x) => x.id !== c.id) };
        }
        return {
          ...s,
          items: s.items.map((x) => {
            if (x.id !== c.parentId) return x;
            const replies = (x.replies || []).filter((r) => r.id !== c.id);
            const replyCount = Math.max(0, (x.replyCount || 0) - 1);
            // Commentaire de tête déjà supprimé dont la dernière réponse part : il disparaît aussi (comme sur le serveur).
            return x.deleted && !replyCount ? null : { ...x, replies, replyCount };
          }).filter(Boolean),
        };
      });
      onCountChange?.(-1);
      toast(t('comment.removed'), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    }
  };

  /** Toutes les réponses d'un commentaire de tête, page par page (les deux premières sont déjà là). */
  const loadReplies = async (parent) => {
    const cur = moreReplies[parent.id];
    setMoreReplies((m) => ({ ...m, [parent.id]: { next: cur?.next ?? null, loading: true } }));
    try {
      const res = await get(`/comments/${parent.id}/replies?limit=20${cur?.next ? `&cursor=${enc(cur.next)}` : ''}`);
      setState((s) => ({
        ...s,
        items: s.items.map((c) => {
          if (c.id !== parent.id) return c;
          const kept = cur?.next ? c.replies || [] : [];
          const seen = new Set(kept.map((r) => r.id));
          return { ...c, replies: [...kept, ...(res.items || []).filter((r) => !seen.has(r.id))] };
        }),
      }));
      setMoreReplies((m) => ({ ...m, [parent.id]: { next: res.nextCursor ?? null, loading: false, done: !res.nextCursor } }));
    } catch (err) {
      setMoreReplies((m) => ({ ...m, [parent.id]: { next: cur?.next ?? null, loading: false } }));
      toast(error(err.code), 'error');
    }
  };

  const startReply = (c, parentId) => setReplyTo({ parentId, comment: c });

  return (
    <div className="thread thread--root" data-thread={key}>
      {state.loading && !state.items.length && <Spinner />}
      {state.error && !state.items.length && (
        <p className="so-note">{t('feedback.loadError')} <button type="button" className="link-btn" onClick={() => load(null)}>{t('feedback.retry')}</button></p>
      )}
      {!state.loading && !state.error && !state.items.length && <p className="so-note">{t('comment.empty')}</p>}
      {state.items.map((c) => {
        const replies = c.replies || [];
        const extra = moreReplies[c.id];
        const hidden = Math.max(0, (c.replyCount || 0) - replies.length);
        const replying = replyTo?.parentId === c.id;
        return (
          <div key={c.id} className="so-comment-group">
            <Comment c={c} target={target} canModerate={canModerate} onReply={locked || c.deleted ? null : (x) => startReply(x, c.id)}
              onChange={(next) => patch(c.id, (old) => ({ ...old, ...next, replies: old.replies, replyCount: old.replyCount }))} onDelete={remove} />
            {(replies.length > 0 || replying || hidden > 0) && (
              <div className="thread">
                {replies.map((r) => (
                  <Comment key={r.id} c={r} target={target} canModerate={canModerate} onReply={locked ? null : (x) => startReply(x, c.id)}
                    onChange={(next) => patch(r.id, (old) => ({ ...old, ...next }))} onDelete={remove} />
                ))}
                {(hidden > 0 || extra?.next) && !extra?.done && (
                  <button type="button" className="act-btn so-thread-more" disabled={extra?.loading} onClick={() => loadReplies(c)}>
                    {extra?.loading ? <Spinner /> : null}
                    {replies.length ? t('comment.moreReplies', { n: hidden || 1 }) : t('comment.showReplies', { n: hidden })}
                  </button>
                )}
                {replying && (
                  <ReplyBox autoFocus placeholder={t('comment.replyPlaceholder', { name: replyTo.comment.user?.username || '' })}
                    onCancel={() => setReplyTo(null)} onSend={(body) => send(body, replyTo.comment)} />
                )}
              </div>
            )}
          </div>
        );
      })}
      {state.next && (
        <button type="button" className="act-btn so-thread-more" disabled={state.loading} onClick={() => load(state.next)}>
          {state.loading ? <Spinner /> : null}{t('comment.more')}
        </button>
      )}
      {locked ? <p className="so-note">{t('comment.locked')}</p> : (
        <ReplyBox root autoFocus={autoFocus} placeholder={t('comment.placeholder')} onSend={(body) => send(body)} />
      )}
    </div>
  );
}

export default CommentThread;
