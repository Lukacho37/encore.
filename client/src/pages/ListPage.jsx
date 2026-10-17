// Page d'une liste (/list/:id) — chantier P1-C (PLAN.md 2.5, 4.2.4) : titre, auteur, description, éléments numérotés
// (liste classée) ou en grille, notes, « J'aime », commentaires (un niveau de réponse), partage dans le fil, image à
// partager, « Modifier » pour son auteur, « Signaler » pour les autres. Liste privée, réservée aux amis, masquée ou
// supprimée : « Cette liste n'est plus là » (le serveur répond 404 sans dire pourquoi). Une grille « Mes 9 albums » se lit
// sur /u/:pseudo/nine. Tous les textes du joueur passent par UgcText.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { get } from '../api.js';
import { useI18n } from '../i18n/index.jsx';
import { useAlbum, useAlbums, useTrack } from '../state/catalog.js';
import { EmptyState, ErrorBox, Skeleton } from '../components/feedback.jsx';
import CoverArt from '../components/CoverArt.jsx';
import UgcText from '../components/UgcText.jsx';
import { Avatar, Icon } from '../components/ui.jsx';
import { SafetyMenu } from '../components/safety/SafetyMenu.jsx';
import { LikeButton } from '../components/social/LikeButton.jsx';
import { ShareButton } from '../components/social/ShareButton.jsx';
import { CommentThread } from '../components/social/CommentThread.jsx';
import { useOnBlocked, userHref } from '../components/social/util.js';
import { useItemCount } from '../components/lists/ListCard.jsx';
import { AddToListButton } from '../components/lists/AddToList.jsx';
import { ListIcon } from '../components/lists/icons.jsx';
import { BackLink, useCommentAnchor } from './PostPage.jsx';
import '../styles/lists.css';

const ShareSheet = lazy(() => import('../share/ShareSheet.jsx'));
const enc = encodeURIComponent;

/** Un élément de la liste (album ou morceau) : pochette, titre, artiste, note de l'auteur, « Ajouter à une liste ». */
function ItemRow({ item, rank }) {
  const { t } = useI18n();
  const album = useAlbum(item.type === 'album' ? item.id : null);
  const track = useTrack(item.type === 'track' ? item.id : null);
  const x = album || track;
  const href = item.type === 'album' ? `/album/${enc(item.id)}` : `/track/${enc(item.id)}`;
  const meta = item.type === 'album'
    ? [album?.artist, album?.year].filter(Boolean).join(' · ')
    : [track?.artist, track?.album].filter(Boolean).join(' · ');
  return (
    <li className="ls-item" data-item={`${item.type}:${item.id}`}>
      {rank != null && <span className="ls-item__rank" aria-label={t('lists.page.rank', { n: rank })}>{rank}</span>}
      <Link to={href} className="ls-item__cover" tabIndex={-1} aria-hidden="true">
        {x ? <CoverArt art={{ ...x.art, seed: x.art?.seed || x.albumId || x.id }} sizes="(max-width: 640px) 45vw, 180px" /> : <span className="ls-item__skel" />}
      </Link>
      <div className="ls-item__body">
        <span className="ls-item__line">
          <Link to={href} className="ls-item__title">{x ? x.title : t('common.loading')}</Link>
          <AddToListButton item={{ type: item.type, id: item.id }} compact className="ls-item__add" />
        </span>
        {meta && <span className="ls-item__meta">{item.type === 'track' && <span className="chip chip--sm chip--quiet">{t('lists.track')}</span>}{meta}</span>}
        {item.note && <p className="ls-item__note"><UgcText text={item.note} clamp /></p>}
      </div>
    </li>
  );
}

/** Mosaïque 2 × 2 des premières pochettes (en-tête). */
function Mosaic({ ids }) {
  const albums = useAlbums(ids.slice(0, 4));
  return (
    <span className={`ls-head__mosaic ls-head__mosaic--${Math.max(1, Math.min(4, ids.length))}`} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i}>{albums[i] && <CoverArt art={{ ...albums[i].art, seed: albums[i].art?.seed || albums[i].id }} sizes="120px" />}</span>
      ))}
    </span>
  );
}

export default function ListPage() {
  const { id } = useParams();
  const { t, date } = useI18n();
  const count = useItemCount();
  const [state, setState] = useState({ data: null, error: null, id: null });
  const [attempt, setAttempt] = useState(0);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let alive = true;
    get(`/lists/${enc(id)}`)
      .then((data) => alive && setState({ data, error: null, id }))
      .catch((error) => alive && setState({ data: null, error, id }));
    return () => {
      alive = false;
    };
  }, [id, attempt]);

  const ready = state.id === id && !!state.data;
  useCommentAnchor(ready);
  // L'auteur bloqué depuis le menu ⋯ : la liste disparaît de la page.
  useOnBlocked((userId) => {
    if (state.data?.list?.user?.id === userId) setState((s) => ({ ...s, data: null, error: { status: 404, code: 'not_found' } }));
  });

  if (state.id !== id) {
    return (
      <div className="page ls-page">
        <div className="ls-head ls-head--loading"><span className="ls-head__mosaic" /><Skeleton kind="row" count={2} /></div>
      </div>
    );
  }
  if (state.error) {
    const gone = state.error.status === 404 || state.error.status === 403;
    return (
      <div className="page ls-page">
        <BackLink to="/lists" label={t('lists.title')} />
        {gone
          ? <EmptyState icon="list" title={t('lists.page.goneTitle')} body={t('lists.page.goneBody')} action={{ label: t('lists.page.allLists'), to: '/lists', primary: false }} />
          : <ErrorBox error={state.error} onRetry={() => setAttempt((n) => n + 1)} />}
      </div>
    );
  }

  const { list, description, items, comments } = state.data;
  if (list.kind === 'grid9') return <Navigate to={`/u/${enc(list.user.username)}/nine`} replace />;
  const mine = !!list.mine;
  const eyebrow = [list.ranked ? t('lists.page.ranked') : t('lists.page.list'), count(list), t(`lists.visibility.${list.visibility}`)].join(' · ');
  const patchList = (fn) => setState((s) => ({ ...s, data: { ...s.data, list: fn(s.data.list) } }));
  const spec = items.length ? {
    format: 'portrait',
    theme: 'ink',
    title: list.title,
    subtitle: `@${list.user.username}`,
    tiles: items.slice(0, 9).map((it) => (it.type === 'album' ? { albumId: it.id } : { trackId: it.id })),
    footer: 'AlbumMania',
  } : null;

  return (
    <div className="page ls-page" data-list-page={list.id}>
      <BackLink to="/lists" label={t('lists.title')} />
      <header className="ls-head">
        <Mosaic ids={list.coverAlbumIds || []} />
        <div className="ls-head__body">
          <span className="eyebrow">{eyebrow}</span>
          <h1 className="ls-head__title"><UgcText text={list.title} /></h1>
          <p className="ls-head__by">
            <Link to={userHref(list.user)} className="ls-head__user"><Avatar user={list.user} size={28} /> <span>@{list.user.username}</span></Link>
            <span className="muted ls-head__date">{t('lists.page.updated', { date: date(list.updatedAt) })}</span>
          </p>
          {list.moderated && <p className="ls-head__flag"><span className="chip chip--danger">{t('lists.moderated')}</span> <span className="small muted">{t('lists.page.moderatedBody')}</span></p>}
          {description && <div className="ls-head__desc"><UgcText text={description} clamp /></div>}
          <div className="ls-head__actions">
            <LikeButton targetType="list" targetId={list.id} liked={list.liked} count={list.likeCount} showLikers
              onChange={({ liked, likeCount }) => patchList((l) => ({ ...l, liked, likeCount }))} />
            {list.visibility === 'public' && <ShareButton path={`/list/${list.id}`} title={list.title} item={{ type: 'list', id: list.id }} />}
            {spec && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSharing(true)} data-list-image="">
                <ListIcon name="image" size={16} /> {t('lists.page.image')}
              </button>
            )}
            {mine
              ? <Link to={`/list/${list.id}/edit`} className="btn btn--ghost btn--sm" data-edit-list=""><Icon name="edit" size={15} /> {t('lists.page.edit')}</Link>
              : <SafetyMenu target={{ type: 'list', id: list.id }} user={list.user} />}
          </div>
        </div>
      </header>

      <section className="section ls-items-section" aria-label={t('lists.page.itemsLabel')}>
        {items.length ? (
          list.ranked ? (
            <ol className="ls-items ls-items--ranked">{items.map((it, i) => <ItemRow key={`${it.type}:${it.id}`} item={it} rank={i + 1} />)}</ol>
          ) : (
            <ul className="ls-items ls-items--grid">{items.map((it) => <ItemRow key={`${it.type}:${it.id}`} item={it} />)}</ul>
          )
        ) : (
          <EmptyState icon="list" title={t('lists.page.emptyTitle')} body={mine ? t('lists.page.emptyMine') : null}
            action={mine ? { label: t('lists.page.addItems'), to: `/list/${list.id}/edit`, icon: 'plus' } : null} />
        )}
      </section>

      <section className="section ls-comments" id="commentaires">
        <header className="section__head"><h2><Icon name="comment" size={20} /> {t('lists.page.comments', { n: list.commentCount || 0 })}</h2></header>
        <CommentThread target={{ type: 'list', id: list.id }} initial={comments} ownerId={list.user.id} locked={!!list.moderated}
          onCountChange={(d) => patchList((l) => ({ ...l, commentCount: Math.max(0, (l.commentCount || 0) + d) }))} />
      </section>

      {sharing && spec && (
        <Suspense fallback={null}>
          <ShareSheet spec={spec} title={t('lists.page.imageTitle')} onClose={() => setSharing(false)} fileName={list.title} />
        </Suspense>
      )}
    </div>
  );
}
