import { createContext, useCallback, useContext, useState } from 'react';
import { Link } from 'react-router';
import Card, { RarityGem } from './Card.jsx';
import { Modal, Icon, Progress, ProviderMark, useToast } from './ui.jsx';
import { RatingValue, ReviewEditor, useItemRatings } from './Rating.jsx';
import { PROVIDER_NAMES, realCover, useCovers } from '../state/CoversContext.jsx';
import { useAlbum, useTrack } from '../state/catalog.js';
import { RARITY, SHOWCASE_SLOTS } from '@shared/rules.js';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { post } from '../api.js';
import '../styles/album.css';

const CardModalContext = createContext(() => {});

/** Recherche du morceau sur les principales plateformes (le nom de l'artiste vient de la vue de carte). */
export function listenLinks(track) {
  const q = encodeURIComponent(`${track.artist || ''} ${track.title.replace(/\*+/g, '')}`.trim());
  return [
    { name: 'Spotify', href: `https://open.spotify.com/search/${q}` },
    { name: 'Deezer', href: `https://www.deezer.com/search/${q}` },
    { name: 'Apple Music', href: `https://music.apple.com/search?term=${q}` },
    { name: 'YouTube', href: `https://www.youtube.com/results?search_query=${q}` },
  ];
}

/**
 * Lien direct vers le morceau, puis les autres plateformes. Les 20 albums de base passent par /api/covers
 * (Spotify ou Deezer) ; les morceaux importés portent directement leur lien Deezer (track.url).
 */
function ListenBlock({ track, showsCover }) {
  const { t } = useI18n();
  const covers = useCovers();
  const direct = covers.tracks[track.id] || (track.url ? { url: track.url, provider: 'deezer' } : null);
  const cover = realCover(track.art, covers);
  const name = direct && PROVIDER_NAMES[direct.provider];
  return (
    <div className="listen">
      <span className="eyebrow">{t('card.listen')}</span>
      {direct && (
        <a href={direct.url} target="_blank" rel="noreferrer noopener" className="btn btn--primary btn--sm listen__direct">
          <ProviderMark provider={direct.provider} /> {t('covers.listenOn', { p: name })}
        </a>
      )}
      <div className="listen__links">
        {listenLinks(track).filter((l) => l.name !== name).map((l) => (
          <a key={l.name} href={l.href} target="_blank" rel="noreferrer noopener" className="btn btn--ghost btn--sm">
            {l.name} <Icon name="external" size={14} />
          </a>
        ))}
      </div>
      {showsCover && cover && <p className="cover-credit small muted">{t('covers.credit', { p: PROVIDER_NAMES[cover.provider] || cover.provider })}</p>}
    </div>
  );
}

function TrackRating({ trackId }) {
  const { t } = useI18n();
  const ratingsApi = useItemRatings('track', trackId);
  const summary = ratingsApi.data?.summary;
  return (
    <div className="track-rating">
      <div className="track-rating__head">
        <span className="eyebrow">{t('card.yourRating')}</span>
        {summary?.count > 0 && (
          <span className="small muted"><RatingValue value={summary.average} average size={11} /> · {t('rating.count', { n: summary.count })}</span>
        )}
      </div>
      {ratingsApi.data && <ReviewEditor key={trackId} data={ratingsApi.data} save={ratingsApi.save} remove={ratingsApi.remove} compact />}
    </div>
  );
}

/** Fiche en cours de chargement : la carte scintille, quelques lignes vides à côté. */
function CardDetailSkeleton() {
  const { t } = useI18n();
  return (
    <div className="card-detail" role="status" aria-label={t('common.loading')}>
      <div className="card-detail__card"><span className="card card--loading" /></div>
      <div className="card-detail__info card-detail__info--loading">
        <span className="album-skel album-skel--line album-skel--short" />
        <span className="album-skel album-skel--title" />
        <span className="album-skel album-skel--line" />
        <span className="album-skel album-skel--block" />
      </div>
    </div>
  );
}

function CardDetail({ trackId, onClose }) {
  const { t, date, error } = useI18n();
  const { owned, user, applyState } = useGame();
  const toast = useToast();
  const track = useTrack(trackId);
  // L'album complète la fiche (son titre arrive déjà avec la carte, on l'affiche tout de suite).
  const album = useAlbum(track?.albumId || null);
  const [busy, setBusy] = useState(false);
  if (!track) return <CardDetailSkeleton />;
  const mine = owned?.get(trackId);
  const showcase = user?.showcase || [];
  const pinned = showcase.includes(trackId);
  const albumTitle = album?.title || track.album;
  const rarity = RARITY[track.rarity] ? track.rarity : 'common';

  const togglePin = async () => {
    let slots = [...showcase];
    while (slots.length < SHOWCASE_SLOTS) slots.push(null);
    if (pinned) slots = slots.map((id) => (id === trackId ? null : id));
    else {
      const free = slots.indexOf(null);
      if (free < 0) return toast(t('card.studioFull'), 'error');
      slots[free] = trackId;
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
    <div className="card-detail">
      <div className="card-detail__card">
        <Card trackId={trackId} variant={mine?.holo ? 'holo' : 'std'} ghost={!mine} tilt artSizes="300px" />
      </div>
      <div className="card-detail__info">
        <span className="eyebrow card-detail__rarity" style={{ color: RARITY[rarity].color }}><RarityGem rarity={rarity} size={13} /> {t(`rarity.${rarity}`)}</span>
        <h2 className="card-detail__title">{track.title}</h2>
        <p className="card-detail__artist">
          <Link to={`/artist/${encodeURIComponent(track.artistId)}`} onClick={onClose}>{track.artist}</Link>
          {track.feat && <span className="muted"> · {t('card.feat', { names: track.feat })}</span>}
        </p>
        <dl className="facts">
          {track.albumId ? (
            <>
              <dt>{t('card.album')}</dt>
              <dd><Link to={`/album/${encodeURIComponent(track.albumId)}`} onClick={onClose}>{albumTitle || '…'}</Link></dd>
              <dt>&nbsp;</dt>
              <dd className="muted">{t('card.track', { n: track.n, total: track.total || album?.trackCount || '?' })}</dd>
            </>
          ) : (
            <>
              <dt>{t('rarity.promo')}</dt>
              <dd>
                {[track.promoKind ? t(`promoKind.${track.promoKind}`) : null, track.context].filter(Boolean).join(' · ')}
                {(track.promoKind || track.context) ? ' · ' : ''}
                <span className="mono">P{String(track.n).padStart(2, '0')}</span>
              </dd>
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
          {track.year && (
            <>
              <dt>{t('card.year')}</dt>
              <dd className="mono">{track.year}</dd>
            </>
          )}
          <dt>{t('card.owned')}</dt>
          <dd>
            {mine ? (
              <span className="copies">
                <span>{t('card.std')} <b className="mono">×{mine.std}</b></span>
                <span className="copies__holo">{t('card.holo')} <b className="mono">×{mine.holo}</b></span>
              </span>
            ) : <span className="muted">{t('card.notOwned')}</span>}
          </dd>
          {mine && (
            <>
              <dt>&nbsp;</dt>
              <dd className="muted small">{t('card.firstAt', { date: date(mine.at) })}</dd>
            </>
          )}
        </dl>
        <TrackRating trackId={trackId} />
        <ListenBlock track={track} showsCover={!!mine} />
        {mine && (
          <button type="button" className={`btn ${pinned ? 'btn--ghost' : 'btn--primary'}`} onClick={togglePin} disabled={busy}>
            {pinned ? t('card.unpin') : t('card.pin')}
          </button>
        )}
      </div>
    </div>
  );
}

export function CardModalProvider({ children }) {
  const [trackId, setTrackId] = useState(null);
  const close = useCallback(() => setTrackId(null), []);
  const track = useTrack(trackId);
  const { t } = useI18n();
  return (
    <CardModalContext.Provider value={setTrackId}>
      {children}
      <Modal open={!!trackId} onClose={close} className="modal--card" title={trackId ? track?.title || t('common.loading') : ''}>
        {trackId && <CardDetail key={trackId} trackId={trackId} onClose={close} />}
      </Modal>
    </CardModalContext.Provider>
  );
}

export const useCardModal = () => useContext(CardModalContext);
