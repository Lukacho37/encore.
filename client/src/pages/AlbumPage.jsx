// Page d'album /album/:id — P0-C, version 2 de P1-B (PLAN.md 2.5 « Album ») : en-tête (pochette ou vinyle, titre,
// artiste et maîtrise, progression, ligne de complétion, actions Presser les manquantes · Rechercher · Ajouter à une
// liste · Partager, écoute officielle), booster d'album, tracklist (vue par défaut) ou cartes avec « Tes amis » à côté
// sur grand écran, notes et critiques (moi, amis, communauté), discussions, statistiques, albums similaires, puis
// « Autour de l'album » (classements et listes qui le contiennent). Les blocs des autres chantiers sont montés tels
// quels (contrats PLAN.md 9.2).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import Card, { RarityGem } from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { PackArt } from '../components/PackOpening.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import ListenPanel from '../components/ListenPanel.jsx';
import { Celebration } from '../components/Achievements.jsx';
import { Avatar, Icon, Modal, Progress, RoyaltyIcon, Spinner, useToast } from '../components/ui.jsx';
import { Skeleton } from '../components/feedback.jsx';
import { UgcText } from '../components/UgcText.jsx';
import { SafetyMenu } from '../components/safety/SafetyMenu.jsx';
import { EditionTags, Vinyl, TurntableModal, ownVinylEdition } from '../components/Vinyl.jsx';
import { DeluxeLine } from '../components/game/VernirButton.jsx';
import { RatingInput, RatingValue, RatingsSection, itemPath, useItemRatings } from '../components/Rating.jsx';
import { getAlbum, useAlbumDetail, useApi, useTrack } from '../state/catalog.js';
import { useBoosterFlow } from '../state/boosterFlow.js';
import { ECONOMY, albumReward, pressCost } from '@shared/rules.js';
import { post, api } from '../api.js';
import { sound } from '../sound.js';
import { storage } from '../storage.js';
import { PressButton } from '../components/game/PressButton.jsx';
import { usePressCost } from '../components/game/press.js';
import { CompletionLine } from '../components/game/CompletionLine.jsx';
import { WishlistToggle } from '../components/game/WishlistToggle.jsx';
import { AddToListButton, AlbumListsBlock } from '../components/lists/AddToList.jsx';
import { Discussions } from '../components/social/Discussions.jsx';
import { ShareButton } from '../components/social/ShareButton.jsx';
import { SimilarAlbums } from '../components/discover/SimilarAlbums.jsx';
import { AlbumRankings } from '../components/play/slots.jsx';
import '../styles/album.css';
import '../styles/track.css';
import '../styles/studio.css';

export function PressDialog({ trackId, onClose, onDone }) {
  const { t, error } = useI18n();
  const { user, applyState, isAdmin } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const track = useTrack(trackId || null);
  // Coût lu par usePressCost (P1-D) : une promo se presse 1 200 royalties une fois un album de son artiste complété.
  const press = usePressCost(track);
  const cost = !track || isAdmin ? 0 : press.cost ?? pressCost(track.rarity) ?? 0;
  const missing = Math.max(0, cost - (user?.royalties || 0));

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await post('/collection/press', { trackId });
      applyState(res.state);
      sound.reveal(track.rarity);
      toast(t('album.pressed', { title: track.title }), 'success');
      onDone?.(res);
      onClose();
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!trackId && !!track} onClose={onClose} title={t('album.pressTitle')} className="modal--narrow">
      {track && (
        <div className="press">
          <div className="press__card"><Card trackId={trackId} ghost /></div>
          <p>{t('album.pressBody', { title: track.title, n: cost })}</p>
          {missing > 0 && <p className="form-error">{t('album.pressMissing', { n: missing })}</p>}
          <div className="press__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--primary" onClick={confirm} disabled={busy || missing > 0} data-autofocus>
              <Icon name="press" /> {t('album.press')} · {isAdmin ? t('album.pressFree') : <><RoyaltyIcon size={14} /> <span className="mono">{cost}</span></>}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Grille de cartes (objets carte de l'API) : possédées en couleur, manquantes en fantôme avec « Presser ». */
export function TrackGrid({ tracks, onPress }) {
  const { owned } = useGame();
  const openCard = useCardModal();
  return (
    <div className="card-grid">
      {tracks.map((tr) => {
        const mine = owned.get(tr.id);
        return (
          <div key={tr.id} className="card-cell">
            <Card trackId={tr.id} variant={mine?.holo ? 'holo' : 'std'} ghost={!mine} count={mine ? mine.std + mine.holo : 0}
              onClick={() => openCard(tr.id)} />
            {/* « Presser · N » (P1-D) : même rendu, coût réel (promo pressable après un album de l'artiste complété). */}
            {!mine && onPress && <PressButton track={tr} onPress={onPress} />}
          </div>
        );
      })}
    </div>
  );
}

/** Emplacements de cartes le temps du chargement. */
export function TrackGridSkeleton({ count = 12 }) {
  return (
    <div className="card-grid" aria-hidden="true">
      {Array.from({ length: Math.min(24, Math.max(1, count)) }, (_, i) => (
        <div key={i} className="card-cell"><span className="card card--loading" /></div>
      ))}
    </div>
  );
}

/**
 * Tracklist façon fiche d'album : rareté, carte possédée, moyenne et ta note pour chaque morceau ; chaque titre mène
 * à la page du morceau. `trackRatings` : `tracks` des notes de l'album ({ averages: { id: { avg, count } } }).
 * `currentId` : morceau mis en avant (page morceau, « Autres morceaux de l'album »).
 */
/**
 * Pastille « Presser » d'une ligne de la tracklist : même coût que PressButton (usePressCost, P1-D), donc une promo
 * débloquée (un album de son artiste complété) se presse aussi depuis la tracklist ; rien si la carte n'est pas pressable.
 */
function InlinePress({ track, onPress }) {
  const { t } = useI18n();
  const { isAdmin } = useGame();
  const { cost } = usePressCost(track);
  if (cost == null || !onPress) return null;
  return (
    <button type="button" className="press-btn press-btn--inline" onClick={() => onPress(track.id)}
      aria-label={`${t('album.press')} · ${track.title}`}>
      <Icon name="press" size={13} /> {isAdmin ? t('album.pressFree') : <span className="mono">{cost}</span>}
    </button>
  );
}

export function Tracklist({ tracks, trackRatings, onPress, currentId = null }) {
  const { t, error } = useI18n();
  const { owned, ratings, isAdmin } = useGame();
  const toast = useToast();
  const pending = useRef({});
  const [resetKey, setResetKey] = useState(0);
  const send = async (trackId, score) => {
    try {
      // L'état du joueur (state.ratings) est fusionné par api.js avec la réponse.
      await api('PUT', `/ratings/track/${encodeURIComponent(trackId)}`, { score });
    } catch (err) {
      toast(error(err.code), 'error');
      setResetKey((k) => k + 1); // la note affichée revient à celle du serveur
    }
  };
  // En quittant la tracklist, les notes en attente partent tout de suite au lieu d'être perdues.
  useEffect(() => () => {
    for (const [trackId, { timer, score }] of Object.entries(pending.current)) {
      clearTimeout(timer);
      send(trackId, score);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Petite attente avant l'envoi : plusieurs appuis rapides ne font qu'une seule requête.
  const rateTrack = (trackId, score) => {
    clearTimeout(pending.current[trackId]?.timer);
    const timer = setTimeout(() => {
      delete pending.current[trackId];
      send(trackId, score);
    }, 350);
    pending.current[trackId] = { timer, score };
  };
  return (
    <div className="table-wrap tracklist-wrap">
      {/* Sur téléphone, la moyenne passe sous le titre (trk-avg-inline) pour que « Ta note » reste à l'écran. */}
      <table className="tracklist trk-tracklist">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>{t('album.colTrack')}</th>
            <th>{t('card.rarity')}</th>
            <th>{t('album.colOwned')}</th>
            <th className="trk-col-avg">{t('album.colAvg')}</th>
            <th className="trk-col-mine">{t('album.colMine')}</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((tr) => {
            const mine = owned.get(tr.id);
            const community = trackRatings?.averages?.[tr.id];
            const current = tr.id === currentId;
            const average = community?.count
              ? <><RatingValue value={community.avg} average size={11} /> <span className="muted small mono">({community.count})</span></>
              : null;
            return (
              <tr key={tr.id} className={`${mine ? 'is-owned' : ''}${current ? ' trk-row--current' : ''}`} aria-current={current ? 'true' : undefined}>
                <td className="num mono muted">{tr.kind === 'promo' ? `P${String(tr.n).padStart(2, '0')}` : tr.n}</td>
                <td>
                  <Link to={itemPath('track', tr.id)} className="tracklist__title">
                    {tr.title}
                    {tr.feat && <span className="muted small"> · feat. {tr.feat}</span>}
                  </Link>
                  {average && <span className="trk-avg-inline">{average}</span>}
                </td>
                <td><span className="tracklist__rarity"><RarityGem rarity={tr.rarity} size={12} /> {t(`rarity.${tr.rarity}`)}</span></td>
                <td>
                  {mine ? (
                    <span className={`owned-chip${mine.holo ? ' owned-chip--holo' : ''}`}><Icon name="check" size={13} /> {mine.holo ? t('card.holo') : `×${mine.std}`}</span>
                  ) : <InlinePress track={tr} onPress={onPress} />}
                </td>
                <td className="trk-col-avg">{average ? <span className="tracklist__avg">{average}</span> : <span className="muted">·</span>}</td>
                <td className="trk-col-mine"><RatingInput key={`${tr.id}-${resetKey}`} value={ratings.get(`track:${tr.id}`) ?? null} onChange={(v) => rateTrack(tr.id, v)} size={15} compact label={`${t('rating.yours')} · ${tr.title}`} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Booster d'album : 5 cartes de cet album, celles qui manquent d'abord, payé en royalties.
 * Gratuit et illimité pour l'admin (même album complet, pour tester).
 */
function AlbumBooster({ album, complete, onOpen }) {
  const { t, num } = useI18n();
  const { user, isAdmin } = useGame();
  const uid = useId();
  const price = isAdmin ? 0 : ECONOMY.albumPackPrice;
  const missing = Math.max(0, price - (user?.royalties ?? 0));
  const blocked = !isAdmin && (complete || missing > 0);
  let hint = null;
  if (complete) hint = t(isAdmin ? 'album.booster.completeAdmin' : 'album.booster.complete');
  else if (missing > 0) hint = t('album.booster.missing', { n: num(missing) });
  return (
    <section className={`album-booster${blocked ? ' album-booster--blocked' : ''}`} aria-labelledby={`${uid}-title`}>
      <PackArt className="album-booster__pack" album={album} />
      <div className="album-booster__text">
        <h2 id={`${uid}-title`} className="album-booster__title">{t('album.booster.title')}</h2>
        <p className="album-booster__body">
          {price ? t('album.booster.body', { price: num(price) }) : t('album.booster.bodyFree')}
        </p>
        {hint && <p id={`${uid}-hint`} className="album-booster__hint small">{hint}</p>}
      </div>
      <button type="button" className="btn btn--primary album-booster__btn" onClick={onOpen} disabled={blocked}
        aria-describedby={hint ? `${uid}-hint` : undefined}>
        <Icon name="pack" /> {t('album.booster.open')}
        {price > 0 && <span className="album-booster__price"><RoyaltyIcon size={14} /> <span className="mono">{num(price)}</span></span>}
      </button>
    </section>
  );
}

/** Album ou artiste introuvable (404), ou erreur de chargement avec « Réessayer ». */
export function MissingState({ err, notFoundTitle, notFoundBody, loadError, onRetry, backTo, backLabel }) {
  const { t, error } = useI18n();
  const notFound = err?.status === 404 || /^unknown_/.test(err?.code || '');
  return (
    <div className="empty-page catalog-missing">
      <Icon name={notFound ? 'search' : 'disc'} size={40} />
      <h1 className="catalog-missing__title">{notFound ? notFoundTitle : loadError}</h1>
      <p>{notFound ? notFoundBody : error(err?.code)}</p>
      <div className="catalog-missing__actions">
        {!notFound && onRetry && <button type="button" className="btn btn--primary" onClick={onRetry}>{t('album.retry')}</button>}
        <Link to={backTo} className="btn btn--ghost"><Icon name="back" /> {backLabel}</Link>
      </div>
    </div>
  );
}

/** En-tête vide le temps de charger un album jamais vu dans la session. */
function AlbumSkeleton() {
  const { t } = useI18n();
  return (
    <div className="album-page" aria-busy="true">
      <span className="sr-only" role="status">{t('album.loading')}</span>
      <Link to="/collection" className="back-link"><Icon name="back" /> {t('album.back')}</Link>
      <header className="album-head">
        <div className="album-head__cover album-skel album-skel--cover" />
        <div className="album-head__info">
          <span className="album-skel album-skel--line album-skel--short" />
          <span className="album-skel album-skel--title" />
          <span className="album-skel album-skel--line album-skel--short" />
          <span className="album-skel album-skel--bar" />
          <span className="album-skel album-skel--block" />
        </div>
      </header>
      <TrackGridSkeleton count={12} />
    </div>
  );
}

/**
 * « Presser les N manquantes » : toutes les cartes manquantes de l'album, pressées une par une (POST
 * /collection/press, le serveur vérifie le prix et les royalties de chacune), dans l'ordre de l'album ; s'arrête à la
 * première erreur (royalties épuisées…). L'admin presse gratuitement.
 */
function PressAllDialog({ open, tracks, onClose, onDone }) {
  const { t, num, error } = useI18n();
  const { user, applyState, isAdmin } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const total = isAdmin ? 0 : tracks.reduce((n, tr) => n + (pressCost(tr.rarity) ?? 0), 0);
  const missing = Math.max(0, total - (user?.royalties || 0));
  const confirm = async () => {
    setBusy(true);
    let done = 0;
    const achievements = [];
    let last = null;
    try {
      for (const tr of tracks) {
        last = await post('/collection/press', { trackId: tr.id });
        done += 1;
        achievements.push(...(last.achievements || []));
      }
      toast(t('studio.album.pressAllDone', { n: done }), 'success');
    } catch (err) {
      toast(t('studio.album.pressAllPartial', { n: done, error: error(err.code) }), 'error');
    } finally {
      if (last?.state) applyState(last.state);
      if (done) sound.reveal(tracks[done - 1]?.rarity);
      setBusy(false);
      onDone?.(achievements);
      onClose();
    }
  };
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={t('studio.album.pressAllTitle')} className="modal--narrow">
      <div className="press st-pressall">
        <p>{isAdmin ? t('studio.album.pressAllFree', { n: tracks.length }) : t('studio.album.pressAllBody', { n: tracks.length, cost: num(total) })}</p>
        {missing > 0 && <p className="form-error">{t('studio.album.pressAllMissing', { n: num(missing) })}</p>}
        <div className="press__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="button" className="btn btn--primary" onClick={confirm} disabled={busy || missing > 0} data-autofocus data-press-all-confirm="">
            {busy ? <Spinner /> : <Icon name="press" />} {t('album.press')} · {isAdmin ? t('album.pressFree') : <><RoyaltyIcon size={14} /> <span className="mono">{num(total)}</span></>}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Actions de l'en-tête : Presser les manquantes · Rechercher (liste d'envies) · Ajouter à une liste · Partager. */
function AlbumActions({ album, missing, complete, onPressAll }) {
  const { t, num } = useI18n();
  const { isAdmin } = useGame();
  const cost = isAdmin ? 0 : missing.reduce((n, tr) => n + (pressCost(tr.rarity) ?? 0), 0);
  return (
    <div className="st-album-actions" role="group" aria-label={t('studio.album.actions')}>
      {missing.length > 0 && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onPressAll} data-press-all={missing.length}>
          <Icon name="press" size={16} /> {t('studio.album.pressMissing', { n: missing.length })}
          <span className="st-album-actions__cost">· {isAdmin ? t('album.pressFreeShort') : <><RoyaltyIcon size={13} /> <span className="mono">{num(cost)}</span></>}</span>
        </button>
      )}
      <WishlistToggle albumId={album.id} />
      <AddToListButton item={{ type: 'album', id: album.id }} className="btn--sm" />
      {complete && (
        <span className="st-album-share">
          <ShareButton path={`/album/${encodeURIComponent(album.id)}`} title={t('studio.album.shareTitle', { title: album.title })} item={{ type: 'album', id: album.id }} />
        </span>
      )}
    </div>
  );
}

/** Statistiques de l'album : complété par N joueurs, nombre de notes, moyenne, moyenne des amis. */
function AlbumStats({ albumId, ratings }) {
  const { t, num } = useI18n();
  // Même adresse que la ligne de complétion (CompletionLine) : une seule requête pour les deux (fetchShared).
  const { data } = useApi(`/albums/${encodeURIComponent(albumId)}/completion`, { keep: false });
  const summary = ratings?.summary;
  const scores = (ratings?.friends?.scores || []).map((s) => s.score).filter((s) => Number.isFinite(s));
  const friendsAvg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const none = <span className="muted">{t('studio.album.statNone')}</span>;
  return (
    <section className="section st-album-stats" aria-labelledby="st-album-stats-title" data-album="stats">
      <header className="section__head"><h2 id="st-album-stats-title">{t('studio.album.stats')}</h2></header>
      <dl className="profile-stats st-album-stats__grid">
        <div><dt>{t('studio.album.statCompleted')}</dt><dd>{data ? <span className="mono">{t('studio.album.statCompletedValue', { n: num(data.completedBy) })}</span> : none}</dd></div>
        <div><dt>{t('studio.album.statRatings')}</dt><dd className="mono">{summary ? num(summary.count || 0) : '…'}</dd></div>
        <div><dt>{t('studio.album.statAverage')}</dt><dd>{summary?.count ? <RatingValue value={summary.average} average size={15} /> : none}</dd></div>
        <div><dt>{t('studio.album.statFriends')}</dt><dd>{friendsAvg != null ? <RatingValue value={friendsAvg} average size={15} /> : none}</dd></div>
      </dl>
    </section>
  );
}

/**
 * « Tes amis », à droite de la tracklist sur grand écran (≥ 1080 px, PLAN.md 2.5) : leurs notes (avatar, étoiles) et
 * leurs dernières critiques en extrait (UgcText, menu ⋯ Signaler), qui mènent à la critique entière plus bas ; sinon
 * une invitation à trouver des amis. Plus étroit, l'encart disparaît : les mêmes notes sont dans « Notes & critiques ».
 * `ratings` : réponse de useItemRatings (null le temps du chargement).
 */
function FriendsAside({ ratings }) {
  const { t } = useI18n();
  const scores = (ratings?.friends?.scores || []).slice(0, 6);
  const reviews = (ratings?.friends?.reviews || []).filter((r) => r.review && !r.moderated).slice(0, 2);
  let body;
  if (!ratings) body = <Skeleton kind="row" count={2} />;
  else if (!scores.length && !reviews.length) {
    body = (
      <div className="st-aside__empty">
        <p className="small muted">{t('studio.album.friendsEmpty')}</p>
        <Link to="/friends?tab=suggestions" className="btn btn--ghost btn--sm"><Icon name="users" size={16} /> {t('studio.album.friendsFind')}</Link>
      </div>
    );
  } else {
    body = (
      <>
        {scores.length > 0 && (
          <ul className="st-aside__scores">
            {scores.map((s) => (
              <li key={s.user.id}>
                <Link to={`/u/${encodeURIComponent(s.user.username)}`} className="st-aside__who">
                  <Avatar user={s.user} size={28} />
                  <span className="st-aside__name">{s.user.username}</span>
                </Link>
                <RatingValue value={s.score} size={12} />
              </li>
            ))}
          </ul>
        )}
        {reviews.length > 0 && (
          <ul className="st-aside__reviews">
            {reviews.map((r) => (
              <li key={r.id} className="st-aside__review">
                <div className="st-aside__review-head">
                  <a href={`#review-${r.id}`} className="st-aside__who" aria-label={t('studio.album.friendsRead', { name: r.user.username })}>
                    <Avatar user={r.user} size={24} />
                    <span className="st-aside__name">{r.user.username}</span>
                  </a>
                  <SafetyMenu target={{ type: 'review', id: r.id }} user={r.user} />
                </div>
                <div className="st-aside__text"><UgcText text={r.review} clamp /></div>
              </li>
            ))}
          </ul>
        )}
        <a href="#critiques" className="section__link st-aside__all">{t('studio.album.friendsAll')}</a>
      </>
    );
  }
  return (
    <aside className="panel st-aside" aria-labelledby="st-aside-title" data-album="friends">
      <h2 className="panel__title" id="st-aside-title"><Icon name="users" /> {t('studio.album.friendsTitle')}</h2>
      {body}
    </aside>
  );
}

function AlbumView({ id }) {
  const { t } = useI18n();
  const { user, achievements, ranks, owned, ratings, albumProgress, isAdmin } = useGame();
  const [pressing, setPressing] = useState(null);
  const [pressAll, setPressAll] = useState(false);
  const [celebrate, setCelebrate] = useState([]);
  // Vue par défaut : la tracklist (PLAN.md 2.5) ; le choix du joueur est gardé.
  const [view, setView] = useState(() => storage.get('albummania.albumView') || 'tracklist');
  const [turntable, setTurntable] = useState(null);
  const booster = useBoosterFlow();
  const detail = useAlbumDetail(id);
  const loaded = detail.data?.album?.id === id ? detail.data : null;
  // Album déjà croisé ailleurs (liste, recherche, booster) : l'en-tête s'affiche pendant que les cartes arrivent.
  const album = loaded?.album || getAlbum(id);
  const tracks = loaded?.tracks || null;
  const ratingsApi = useItemRatings('album', id);

  // Quand une de mes notes de morceau change (tracklist ou fiche carte), on recharge les moyennes.
  const trackSignature = useMemo(
    () => (tracks ? tracks.map((tr) => ratings.get(`track:${tr.id}`) ?? '-').join(',') : null),
    [ratings, tracks],
  );
  const firstSignature = useRef(null);
  const { reload } = ratingsApi;
  useEffect(() => {
    if (trackSignature === null) return;
    if (firstSignature.current === null) firstSignature.current = trackSignature;
    else if (trackSignature !== firstSignature.current) {
      firstSignature.current = trackSignature;
      reload();
    }
  }, [trackSignature, reload]);

  const notFound = detail.error && (detail.error.status === 404 || detail.error.code === 'unknown_album');
  if (!album || notFound) {
    if (detail.error) {
      return (
        <MissingState err={detail.error} notFoundTitle={t('album.notFound')} notFoundBody={t('album.notFoundBody')}
          loadError={t('album.loadError')} onRetry={detail.reload} backTo="/collection" backLabel={t('album.back')} />
      );
    }
    return <AlbumSkeleton />;
  }

  const total = tracks ? tracks.length : album.trackCount || 0;
  const ownedCount = tracks
    ? tracks.reduce((n, tr) => n + (owned.has(tr.id) ? 1 : 0), 0)
    : albumProgress(id, album.trackCount).owned;
  const complete = total > 0 && ownedCount >= total;
  const doneAt = achievements.get(`album:${id}`);
  const reward = albumReward(album.trackCount || total);
  // Éditions du vinyle (P2-D) : deluxe (album, sa note et celles de ses morceaux) > holo > noire.
  const { edition, holo: holoEdition } = doneAt ? ownVinylEdition(id, { achievements, owned, tracks: tracks || album.trackCount }) : { edition: 'black', holo: false };
  // Couleur de vinyle choisie dans le Studio (cosmétique P1-D) : seulement pour l'édition noire, comme sur l'étagère.
  const vinylColor = edition === 'black' ? user?.cosmetics?.vinyl ?? null : null;
  const summary = ratingsApi.data?.summary;
  const palette = album.art?.palette || [];
  const genre = album.genre ? t(`genre.${album.genre}`) : null;
  const eyebrow = [album.code, genre && genre !== `genre.${album.genre}` ? genre : null, album.year].filter(Boolean).join(' · ');
  const mastered = achievements.has(`artist:${album.artistId}`);
  // Cartes manquantes pressables (cartes d'album : barème de shared/rules.js), dans l'ordre de l'album.
  const missing = tracks ? tracks.filter((tr) => !owned.has(tr.id) && (isAdmin || pressCost(tr.rarity) != null)) : [];
  const chooseView = (v) => {
    setView(v);
    storage.set('albummania.albumView', v);
  };

  return (
    <div className="album-page st-album" style={{ '--album-c0': palette[0], '--album-c1': palette[1] }}>
      <Link to="/collection" className="back-link"><Icon name="back" /> {t('album.back')}</Link>
      <header className={`album-head${doneAt ? ' album-head--vinyl' : ''}`}>
        {doneAt ? (
          <div className="album-head__vinyl">
            <Vinyl albumId={id} album={album} edition={edition} color={vinylColor} pressing={ranks?.get(`album:${id}`) ?? null}
              onClick={() => setTurntable({ albumId: id, edition, holo: holoEdition, at: doneAt, mine: true, color: vinylColor })} label={t('album.playVinyl')} />
          </div>
        ) : (
          <div className="album-head__cover">
            <CoverArt art={{ ...album.art, seed: album.art?.seed || album.id }} title={album.title} sizes="(max-width: 860px) 220px, 280px" />
          </div>
        )}
        <div className="album-head__info">
          {eyebrow && <span className="eyebrow mono">{eyebrow}</span>}
          <h1>{album.title}</h1>
          <span className="st-album-artist">
            <Link to={`/artist/${encodeURIComponent(album.artistId)}`} className="album-head__artist">{album.artist}</Link>
            {mastered && <span className="master-tag"><Icon name="star" size={12} /> {t('studio.album.mastered')}</span>}
          </span>
          {summary?.count > 0 && (
            <a href="#critiques" className="album-head__score">
              <RatingValue value={summary.average} average size={16} />
              <span className="muted small">{t('rating.count', { n: summary.count })}</span>
            </a>
          )}
          <div className="album-head__progress">
            <Progress value={ownedCount} max={total} color={palette[1]} size="lg" />
            <span className="mono">{ownedCount}/{total}</span>
          </div>
          {/* Ligne de complétion (P1-D) : « Complété le … · Pressage n° … » puis « Complété par N joueurs · N amis ». */}
          <CompletionLine albumId={id} />
          {doneAt && <EditionTags edition={edition} holo={holoEdition} />}
          {doneAt && <DeluxeLine albumId={id} />}
          {!doneAt && (
            <div className="reward-box">
              <span className="label">{t('album.reward')}</span>
              <p>{t('album.rewardBody', { r: reward.royalties, x: reward.xp })}</p>
              <p className="small muted">{t('album.pressHint')}</p>
            </div>
          )}
          <AlbumActions album={album} missing={missing} complete={!!doneAt} onPressAll={() => setPressAll(true)} />
          <ListenPanel kind="album" item={album} />
        </div>
      </header>

      <AlbumBooster album={album} complete={complete} onOpen={() => booster.openAlbum(album)} />

      {/* Tracklist (ou cartes) sur deux tiers, « Tes amis » sur le dernier tiers à partir de 1080 px (studio.css). */}
      <div className={`st-album-main${view === 'cards' ? ' st-album-main--cards' : ''}`}>
        <div className="st-album-main__tracks">
          <div className="toolbar">
            <div className="seg" role="group" aria-label={t('album.view')}>
              {[['tracklist', t('album.viewTracklist')], ['cards', t('album.viewCards')]].map(([v, label]) => (
                <button key={v} type="button" className={`seg__btn seg__btn--wide${view === v ? ' is-on' : ''}`} aria-pressed={view === v} onClick={() => chooseView(v)}>{label}</button>
              ))}
            </div>
          </div>

          {!tracks ? (
            detail.error ? (
              <div className="empty album-tracks-error">
                <p>{t('album.tracksError')}</p>
                <button type="button" className="btn btn--ghost btn--sm" onClick={detail.reload}>{t('album.retry')}</button>
              </div>
            ) : (
              <>
                <span className="sr-only" role="status">{t('album.loading')}</span>
                <TrackGridSkeleton count={album.trackCount || 12} />
              </>
            )
          ) : view === 'cards'
            ? <TrackGrid tracks={tracks} onPress={setPressing} />
            : <Tracklist tracks={tracks} trackRatings={ratingsApi.data?.tracks} onPress={setPressing} />}
        </div>
        <FriendsAside ratings={ratingsApi.data} />
      </div>

      <RatingsSection type="album" id={id} ratingsApi={ratingsApi} />

      <div className="st-album-block" data-album="discussions"><Discussions itemType="album" itemId={id} /></div>
      <AlbumStats albumId={id} ratings={ratingsApi.data} />
      <div className="st-album-block" data-album="similar"><SimilarAlbums albumId={id} /></div>
      <div className="st-around" data-album="around">
        <AlbumRankings albumId={id} />
        <AlbumListsBlock albumId={id} />
      </div>

      <PressDialog trackId={pressing} onClose={() => setPressing(null)} onDone={(res) => setCelebrate(res.achievements || [])} />
      <PressAllDialog open={pressAll} tracks={missing} onClose={() => setPressAll(false)} onDone={(list) => setCelebrate(list)} />
      <Celebration achievements={celebrate} onClose={() => setCelebrate([])} />
      <TurntableModal vinyl={turntable} onClose={() => setTurntable(null)} />
      {booster.overlay}
    </div>
  );
}

export default function AlbumPage() {
  const { id } = useParams();
  // Un album = un état neuf (vue, modales, chargement) : on remonte la page à chaque changement d'album.
  return <AlbumView key={id} id={id} />;
}
