// Bouton J'aime — chantier P1-A (PLAN.md 9.2). Props (contrat, ne pas les renommer) : { targetType, targetId, liked, count }.
// En plus, facultatifs : onChange({ liked, likeCount }) (le parent garde l'état à jour), size (icône), compact (sans
// compteur à zéro), showLikers (le compteur ouvre la liste « Aimé par »).
// Bascule tout de suite (optimiste), puis PUT / DELETE /api/likes/:type/:id ; en cas d'erreur, l'état revient et un
// message s'affiche. Le serveur vérifie compte actif, blocages et visibilité.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, get } from '../../api.js';
import { useI18n } from '../../i18n/index.jsx';
import { Avatar, Icon, Modal, Spinner, useToast } from '../ui.jsx';
import { userHref } from './util.js';
import '../../styles/social.css';

/** Fenêtre « Aimé par » (GET /api/likes/:type/:id, amis d'abord). */
function LikersDialog({ targetType, targetId, onClose }) {
  const { t } = useI18n();
  const [state, setState] = useState({ items: [], next: null, loading: true, error: null });
  const load = (cursor = null) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    get(`/likes/${targetType}/${encodeURIComponent(targetId)}?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      .then((res) => setState((s) => ({ items: cursor ? [...s.items, ...(res.items || [])] : res.items || [], next: res.nextCursor, loading: false, error: null })))
      .catch((error) => setState((s) => ({ ...s, loading: false, error })));
  };
  const first = useRef(false);
  useEffect(() => {
    if (first.current) return;
    first.current = true;
    load();
  });
  return (
    <Modal open onClose={onClose} title={t('social.likers')} className="modal--narrow">
      {state.loading && !state.items.length ? <Spinner /> : state.items.length ? (
        <ul className="so-likers">
          {state.items.map((u) => (
            <li key={u.id}>
              <Link to={userHref(u)} onClick={onClose}>
                <Avatar user={u} size={32} />
                <span>{u.username}</span>
                {u.relation === 'friend' && <span className="chip chip--sm chip--cue">{t('social.friendTag')}</span>}
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="muted">{t('social.likersEmpty')}</p>}
      {state.next && (
        <button type="button" className="btn btn--ghost btn--sm" disabled={state.loading} onClick={() => load(state.next)}>{t('feed.more')}</button>
      )}
    </Modal>
  );
}

export function LikeButton({ targetType, targetId, liked = false, count = 0, onChange, size = 18, compact = false, showLikers = false }) {
  const { t, num, error } = useI18n();
  const toast = useToast();
  const [state, setState] = useState({ liked: !!liked, count: Number(count) || 0 });
  const [busy, setBusy] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const pending = useRef(false);

  // Nouvelles valeurs venues du parent (rechargement) : elles l'emportent, sauf pendant un envoi.
  useEffect(() => {
    if (!pending.current) setState({ liked: !!liked, count: Number(count) || 0 });
  }, [liked, count]);

  if (targetId == null) return null;

  const toggle = async () => {
    if (busy) return;
    const next = !state.liked;
    const before = state;
    setState({ liked: next, count: Math.max(0, before.count + (next ? 1 : -1)) });
    setBusy(true);
    pending.current = true;
    try {
      const res = await api(next ? 'PUT' : 'DELETE', `/likes/${targetType}/${encodeURIComponent(targetId)}`);
      const after = { liked: !!res.liked, count: Number(res.likeCount) || 0 };
      setState(after);
      onChange?.({ liked: after.liked, likeCount: after.count });
    } catch (err) {
      setState(before);
      toast(error(err.code), 'error');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const label = state.liked ? t('social.likedAria', { n: state.count }) : t('social.likeAria', { n: state.count });
  const counter = (!compact || state.count > 0) && <span className="mono">{num(state.count)}</span>;
  return (
    <>
      <button type="button" className={`act-btn act-btn--like${state.liked ? ' is-on' : ''}`} aria-pressed={state.liked}
        aria-label={label} title={t('social.like')} onClick={toggle} data-like={`${targetType}:${targetId}`}>
        <Icon name="heart" size={size} />
        {!showLikers && counter}
      </button>
      {showLikers && state.count > 0 && (
        <button type="button" className="act-btn act-btn--count" onClick={() => setLikersOpen(true)} aria-label={t('social.likers')}>
          {counter}
        </button>
      )}
      {likersOpen && <LikersDialog targetType={targetType} targetId={targetId} onClose={() => setLikersOpen(false)} />}
    </>
  );
}

export default LikeButton;
