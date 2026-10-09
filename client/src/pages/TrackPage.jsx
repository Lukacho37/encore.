// Page morceau /track/:id — chantier P0-C (PLAN.md 2.5, 4.1.3). L'identifiant contient « : » (discovery:01) et
// arrive encodé dans l'adresse. Ordre : en-tête (pochette, surtitre, titre, artiste · album, rareté, carte possédée,
// note de la communauté, « Noter »), ma carte (ou la carte fantôme + « Presser · N ») et qui la possède, l'écoute
// (ListenPanel : liens officiels + lecteur Deezer chargé au clic), mes notes et critiques, celles des amis puis de la
// communauté, et les autres morceaux de l'album (ou les promos de l'artiste). Identifiant inconnu : « Cette face
// n'existe pas » (NotFound).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import { useApi, useTracks } from '../state/catalog.js';
import { useCovers } from '../state/CoversContext.jsx';
import Card, { PopIcon, RarityGem } from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import ListenPanel, { directLink, listenLinks } from '../components/ListenPanel.jsx';
import { Celebration } from '../components/Achievements.jsx';
import { Avatar, Icon, Progress, RoyaltyIcon, useToast } from '../components/ui.jsx';
import { RatingValue, RatingsSection, itemPath, useItemRatings } from '../components/Rating.jsx';
import { MissingState, PressDialog, Tracklist } from './AlbumPage.jsx';
import NotFound from './NotFound.jsx';
import { RARITY, SHOWCASE_SLOTS, pressCost } from '@shared/rules.js';
import { post } from '../api.js';
import '../styles/album.css';
import '../styles/track.css';

const pad = (n) => String(n ?? 0).padStart(2, '0');

/** En-tête vide le temps de charger un morceau. */
function TrackSkeleton() {
  const { t } = useI18n();
  return (
    <div className="trk-page" aria-busy="true">
      <span className="sr-only" role="status">{t('track.loading')}</span>
      <span className="back-link"><Icon name="back" /> …</span>
      <header className="track-head trk-head">
        <div className="track-head__cover album-skel album-skel--cover" />
        <div className="track-head__info">
          <span className="album-skel album-skel--line album-skel--short" />
          <span className="album-skel album-skel--title" />
          <span className="album-skel album-skel--line album-skel--short" />
          <span className="album-skel album-skel--block" />
        </div>
      </header>
    </div>
  );
}

/** Retour : la page précédente quand on vient du site, sinon l'album (ou l'artiste d'une promo). */
function BackLink({ to, label }) {
  const navigate = useNavigate();
  const onClick = (e) => {
    if (window.history.state?.idx > 0) {
      e.preventDefault();
      navigate(-1);
    }
  };
  return <Link to={to} className="back-link" onClick={onClick}><Icon name="back" /> {label}</Link>;
}

/** Ma carte : exemplaires, date, popularité, qui la possède ; « Presser · N » si elle manque, « Exposer » sinon. */
function MyCard({ page, onPress }) {
  const { t, date, error } = useI18n();
  const { user, isAdmin, owned, applyState } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { track, owners, albumCompletedBy } = page;
  // Collection du joueur : l'état du jeu (à jour après un pressage), sinon la réponse de la page.
  const live = owned.get(track.id);
  const mine = live ? { std: live.std, holo: live.holo, at: live.at } : page.mine
    ? { std: page.mine.std?.count || 0, holo: page.mine.holo?.count || 0, at: Math.min(page.mine.std?.firstAt ?? Infinity, page.mine.holo?.firstAt ?? Infinity) }
    : null;
  const rarity = RARITY[track.rarity] ? track.rarity : 'common';
  const cost = isAdmin ? 0 : pressCost(rarity);
  const showcase = user?.showcase || [];
  const pinned = showcase.includes(track.id);
  const friends = owners.friends || [];

  const togglePin = async () => {
    let slots = [...showcase];
    while (slots.length < SHOWCASE_SLOTS) slots.push(null);
    if (pinned) slots = slots.map((x) => (x === track.id ? null : x));
    else {
      const free = slots.indexOf(null);
      if (free < 0) return toast(t('card.studioFull'), 'error');
      slots[free] = track.id;
    }
    setBusy(true);
    try {
      const res = await post('/profile/showcase', { slots });
      applyState(res.state);
      if (!pinned) toast(t('card.pinned'), 'success');
    } catch (err) {
      toast(error(err.code), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel trk-mine" aria-labelledby="trk-mine-title">
      <h2 className="panel__title" id="trk-mine-title">{t('track.mine.title')}</h2>
      <div className="trk-mine__body">
        <div className="trk-mine__card">
          <Card trackId={track.id} variant={mine?.holo ? 'holo' : 'std'} ghost={!mine} count={mine ? mine.std + mine.holo : 0} artSizes="200px" />
        </div>
        <dl className="facts trk-mine__facts">
          <dt>{t('card.owned')}</dt>
          <dd>
            {mine ? (
              <span className="copies">
                <span>{t('card.std')} <b className="mono">×{mine.std}</b></span>
                <span className="copies__holo">{t('card.holo')} <b className="mono">×{mine.holo}</b></span>
              </span>
            ) : <span className="muted">{t('card.notOwned')}</span>}
          </dd>
          {mine && Number.isFinite(mine.at) && (
            <>
              <dt>{t('track.mine.since')}</dt>
              <dd>{date(mine.at)}</dd>
            </>
          )}
          {track.pop != null && (
            <>
              <dt>{t('card.popularity')}</dt>
              <dd className="pop-line">
                <Progress value={track.pop} max={100} color={RARITY[rarity].color} size="sm" />
                <span className="mono">{t('card.popularityValue', { v: track.pop })}</span>
              </dd>
            </>
          )}
          <dt>{t('track.mine.collectors')}</dt>
          <dd>
            {t('track.owners', { n: owners.count })}
            {friends.length > 0 && <span className="muted"> · {t('track.ownersFriends', { n: friends.length })}</span>}
          </dd>
          {albumCompletedBy != null && (
            <>
              <dt>{t('card.album')}</dt>
              <dd>{t('track.completedBy', { n: albumCompletedBy })}</dd>
            </>
          )}
        </dl>
      </div>
      {friends.length > 0 && (
        <ul className="trk-owners" aria-label={t('track.ownersFriendsLabel')}>
          {friends.map((u) => (
            <li key={u.id}>
              <Link to={`/u/${u.username}`} className="trk-owners__link" title={u.username}>
                <Avatar user={u} size={30} />
                <span className="sr-only">{u.username}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="trk-mine__actions">
        {!mine && cost != null && (
          <button type="button" className="btn btn--ghost" onClick={() => onPress(track.id)}>
            <Icon name="press" /> {t('album.press')} · {isAdmin ? t('album.pressFreeShort') : <><RoyaltyIcon size={14} /> <span className="mono">{cost}</span></>}
          </button>
        )}
        {!mine && cost == null && <p className="small muted">{t('track.mine.promoHint')}</p>}
        {mine && (
          <button type="button" className="btn btn--ghost" onClick={togglePin} disabled={busy}>
            {pinned ? t('card.unpin') : t('card.pin')}
          </button>
        )}
      </div>
    </section>
  );
}

function TrackView({ id }) {
  const { t, error } = useI18n();
  const { owned, ratings, user } = useGame();
  const covers = useCovers();
  const page = useApi(`/catalog/tracks/${encodeURIComponent(id)}`, { keep: false });
  const ratingsApi = useItemRatings('track', id);
  const data = page.data?.track?.id === id ? page.data : null;
  const albumId = data?.album?.id || null;
  // Moyennes des autres morceaux de l'album (tracklist du bas).
  const albumRatings = useItemRatings('album', albumId);
  const siblings = useTracks(data?.siblings || []).filter(Boolean);
  const [pressing, setPressing] = useState(null);
  const [celebrate, setCelebrate] = useState([]);

  // Ma note changée ailleurs (tracklist du bas) : on recharge le bloc des notes.
  const myScore = ratings.get(`track:${id}`) ?? null;
  const shownScore = ratingsApi.data ? ratingsApi.data.mine?.score ?? null : myScore;
  const { reload } = ratingsApi;
  const reloadAlbum = albumRatings.reload;
  useEffect(() => {
    if (shownScore !== myScore) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myScore]);
  const siblingScores = siblings.map((tr) => ratings.get(`track:${tr.id}`) ?? '-').join(',');
  const [firstScores, setFirstScores] = useState(null);
  useEffect(() => {
    if (!siblings.length) return;
    if (firstScores === null) setFirstScores(siblingScores);
    else if (firstScores !== siblingScores) {
      setFirstScores(siblingScores);
      reloadAlbum();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siblingScores]);

  if (page.error) {
    const notFound = page.error.status === 404 || page.error.code === 'unknown_track';
    if (notFound) return <NotFound />;
    return (
      <MissingState err={page.error} notFoundTitle={t('shell.notFound.title')} notFoundBody="" loadError={t('track.loadError')}
        onRetry={page.reload} backTo="/collection" backLabel={t('album.back')} />
    );
  }
  if (!data) return <TrackSkeleton />;

  const { track, album, artist } = data;
  const rarity = RARITY[track.rarity] ? track.rarity : 'common';
  const promo = track.kind === 'promo';
  const live = owned.get(track.id);
  const copies = live ? live.std + live.holo : data.mine ? (data.mine.std?.count || 0) + (data.mine.holo?.count || 0) : 0;
  const holo = live ? live.holo > 0 : !!data.mine?.holo;
  const summary = ratingsApi.data?.summary || data.ratings.summary;
  const palette = track.art?.palette || [];
  const backTo = album ? itemPath('album', album.id) : `/artist/${encodeURIComponent(track.artistId)}`;
  const kicker = promo
    ? [t('track.kickerPromo'), track.promoKind ? t(`promoKind.${track.promoKind}`) : null, `P${pad(track.n)}`, track.year].filter(Boolean).join(' · ')
    : [t('track.kicker', { n: track.n, total: track.total || album?.trackCount || '?' }), track.year].filter(Boolean).join(' · ');
  const listen = listenLinks('track', track, { direct: directLink('track', track, covers), prefer: user?.prefs?.listen })[0];
  const rated = myScore != null;

  return (
    <div className="trk-page" style={{ '--album-c0': palette[0], '--album-c1': palette[1] }}>
      <BackLink to={backTo} label={album?.title || artist?.name || track.artist} />
      <header className="track-head trk-head">
        <div className="track-head__cover">
          <CoverArt art={{ ...track.art, seed: track.art?.seed || track.albumId || track.id }} title={album?.title || track.title} sizes="(max-width: 860px) 240px, 220px" />
        </div>
        <div className="track-head__info">
          <span className="eyebrow">{kicker}</span>
          <h1>{track.title}</h1>
          <p className="track-head__artist">
            <Link to={`/artist/${encodeURIComponent(track.artistId)}`}>{track.artist}</Link>
            {album && <> · <Link to={itemPath('album', album.id)}>{album.title}</Link></>}
            {track.feat && <span className="muted trk-feat"> · {t('card.feat', { names: track.feat })}</span>}
          </p>
          <div className="track-head__chips">
            <span className="chip chip--rarity" style={{ '--rc': RARITY[rarity].color }}><RarityGem rarity={rarity} size={12} /> {t(`rarity.${rarity}`)}</span>
            {copies > 0
              ? <span className="chip chip--ok"><Icon name="check" size={14} /> {t('track.owned')} <span className="mono">×{copies}</span></span>
              : <span className="chip chip--quiet">{t('card.notOwned')}</span>}
            {holo && <span className="chip chip--holo">{t('card.holo')}</span>}
            {track.pop != null && (
              <span className="chip chip--quiet" title={`${t('card.popularity')} ${t('card.popularityValue', { v: track.pop })}`}>
                <PopIcon /> <span className="mono">{track.pop}</span>
              </span>
            )}
            {summary?.count > 0 && (
              <a href="#critiques" className="album-head__score trk-score">
                <RatingValue value={summary.average} average size={14} />
                <span className="muted small">{t('rating.count', { n: summary.count })}</span>
              </a>
            )}
          </div>
          <div className="trk-head__actions">
            <a href="#ma-note" className="btn btn--primary"><Icon name="star" /> {rated ? t('track.rateAgain') : t('track.rate')}</a>
            {listen && (
              <a href={listen.href} target="_blank" rel="noreferrer noopener" className="btn btn--ghost">
                {t('track.listenOn', { p: listen.name })} <Icon name="external" size={16} />
              </a>
            )}
          </div>
        </div>
        <div className="track-head__card">
          <Card trackId={track.id} variant={holo ? 'holo' : 'std'} ghost={!copies} count={copies} tilt artSizes="168px" />
        </div>
      </header>

      <div className="trk-panels">
        <MyCard page={data} onPress={setPressing} />
        <section className="panel trk-listen-panel" aria-labelledby="trk-listen-title">
          <h2 className="panel__title" id="trk-listen-title"><Icon name="headphones" /> {t('track.listen.title')}</h2>
          <ListenPanel kind="track" item={track} />
        </section>
      </div>

      <RatingsSection type="track" id={track.id} ratingsApi={ratingsApi} />

      {siblings.length > 1 && (
        <section className="section trk-siblings">
          <header className="section__head">
            <h2>{album ? t('track.siblings') : t('track.siblingsPromo', { artist: track.artist })}</h2>
            {album && <Link to={itemPath('album', album.id)} className="section__link">{t('track.albumLink')}</Link>}
          </header>
          <Tracklist tracks={siblings} trackRatings={albumRatings.data?.tracks} onPress={setPressing} currentId={track.id} />
        </section>
      )}

      <PressDialog trackId={pressing} onClose={() => setPressing(null)} onDone={(res) => {
        setCelebrate(res.achievements || []);
        page.reload();
      }} />
      <Celebration achievements={celebrate} onClose={() => setCelebrate([])} />
      {/* Message d'erreur du chargement des notes (le bloc reste utilisable). */}
      {ratingsApi.error && <p className="sr-only" role="status">{error(ratingsApi.error.code)}</p>}
    </div>
  );
}

export default function TrackPage() {
  const { id } = useParams();
  // Un morceau = un état neuf (dialogues, chargement) : la page se remonte à chaque changement de morceau.
  return <TrackView key={id} id={id} />;
}
