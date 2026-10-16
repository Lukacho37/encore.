// Page d'un post (/post/:id) — chantier P1-A (PLAN.md 2.1, 4.2.1) : le post en entier (texte, carte de mention avec la
// vraie pochette, J'aime et « Aimé par », Partager, ⋯), puis ses commentaires (un niveau de réponse). Ouverte depuis le
// fil, une notification ou un lien partagé. Post supprimé, masqué ou réservé aux amis de son auteur : « Ce post n'est
// plus là » (le serveur répond 404 sans dire pourquoi).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { get } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { EmptyState, ErrorBox } from '../components/feedback.jsx';
import { Icon } from '../components/ui.jsx';
import { PostCard } from '../components/social/PostCard.jsx';
import { CommentThread } from '../components/social/CommentThread.jsx';
import '../styles/social.css';

/** Retour : la page précédente quand on vient du site, sinon l'accueil. */
export function BackLink({ to = '/', label }) {
  const navigate = useNavigate();
  const onClick = (e) => {
    if (window.history.state?.idx > 0) {
      e.preventDefault();
      navigate(-1);
    }
  };
  return <Link to={to} className="back-link so-page__back" onClick={onClick}><Icon name="back" /> {label}</Link>;
}

/** Une fois la page chargée, défile jusqu'au commentaire visé par l'ancre (#comment-<id>, notifications). */
export function useCommentAnchor(ready) {
  useEffect(() => {
    if (!ready || !/^#comment-\d+$/.test(window.location.hash)) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.classList.add('so-flash');
    }
  }, [ready]);
}

export default function PostPage() {
  const { id } = useParams();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [state, setState] = useState({ data: null, error: null, id: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    get(`/posts/${encodeURIComponent(id)}`)
      .then((data) => alive && setState({ data, error: null, id }))
      .catch((error) => alive && setState({ data: null, error, id }));
    return () => {
      alive = false;
    };
  }, [id, attempt]);

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
      <div className="so-page" data-page="post">
        <BackLink label={t('post.home')} />
        {gone ? (
          <EmptyState icon="comment" title={t('post.notFoundTitle')} body={t('post.notFoundBody')}
            action={{ label: t('post.home'), to: '/', primary: false }} />
        ) : <ErrorBox error={state.error} onRetry={() => setAttempt((n) => n + 1)} />}
      </div>
    );
  }

  const { post, comments } = state.data;
  return (
    <div className="so-page" data-page="post">
      <BackLink label={t('post.home')} />
      <h1 className="sr-only">{t('post.kicker', { name: post.user.username })}</h1>
      <PostCard post={post} page onRemove={() => navigate('/', { replace: true })}
        onChange={(next) => setState((s) => ({ ...s, data: { ...s.data, post: next } }))} />
      <section className="so-page__section" aria-labelledby="post-comments">
        <h2 id="post-comments">{t('post.comments')} <span className="mono so-count">{post.commentCount}</span></h2>
        <CommentThread target={{ type: 'post', id: post.id }} initial={comments} ownerId={post.user.id} locked={!!post.moderated}
          onCountChange={(d) => setState((s) => ({ ...s, data: { ...s.data, post: { ...s.data.post, commentCount: Math.max(0, s.data.post.commentCount + d) } } }))} />
      </section>
    </div>
  );
}
