import { createContext, useCallback, useContext, useState } from 'react';
import { Link } from 'react-router';
import Card, { RarityGem } from './Card.jsx';
import { Modal, Icon, Progress, useToast } from './ui.jsx';
import { RatingValue, ReviewEditor, useItemRatings } from './Rating.jsx';
import { TRACK_BY_ID, ARTIST_BY_ID, ALBUM_BY_ID } from '@shared/catalog.js';
import { RARITY, SHOWCASE_SLOTS } from '@shared/rules.js';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { post } from '../api.js';

const CardModalContext = createContext(() => {});

export function listenLinks(track) {
  const q = encodeURIComponent(`${ARTIST_BY_ID[track.artistId].name} ${track.title.replace(/\*+/g, '')}`);
  return [
    { name: 'Spotify', href: `https://open.spotify.com/search/${q}` },
    { name: 'Deezer', href: `https://www.deezer.com/search/${q}` },
    { name: 'Apple Music', href: `https://music.apple.com/search?term=${q}` },
    { name: 'YouTube', href: `https://www.youtube.com/results?search_query=${q}` },
  ];
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

function CardDetail({ trackId, onClose }) {
  const { t, date, error } = useI18n();
  const { owned, user, applyState } = useGame();
  const toast = useToast();
  const track = TRACK_BY_ID[trackId];
  const mine = owned?.get(trackId);
  const artist = ARTIST_BY_ID[track.artistId];
  const album = track.albumId ? ALBUM_BY_ID[track.albumId] : null;
  const showcase = user?.showcase || [];
  const pinned = showcase.includes(trackId);
  const [busy, setBusy] = useState(false);

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
        <Card trackId={trackId} variant={mine?.holo ? 'holo' : 'std'} ghost={!mine} tilt />
      </div>
      <div className="card-detail__info">
        <span className="eyebrow card-detail__rarity" style={{ color: RARITY[track.rarity].color }}><RarityGem rarity={track.rarity} size={13} /> {t(`rarity.${track.rarity}`)}</span>
        <h2 className="card-detail__title">{track.title}</h2>
        <p className="card-detail__artist">
          <Link to={`/artist/${artist.id}`} onClick={onClose}>{artist.name}</Link>
          {track.feat && <span className="muted"> · {t('card.feat', { names: track.feat })}</span>}
        </p>
        <dl className="facts">
          {album ? (
            <>
              <dt>{t('card.album')}</dt>
              <dd><Link to={`/album/${album.id}`} onClick={onClose}>{album.title}</Link></dd>
              <dt>&nbsp;</dt>
              <dd className="muted">{t('card.track', { n: track.n, total: track.total })}</dd>
            </>
          ) : (
            <>
              <dt>{t('rarity.promo')}</dt>
              <dd>{t(`promoKind.${track.promoKind}`)}{track.context ? ` · ${track.context}` : ''}</dd>
            </>
          )}
          <dt>{t('card.popularity')}</dt>
          <dd className="pop-line">
            <Progress value={track.pop} max={100} color={RARITY[track.rarity].color} size="sm" />
            <span className="mono">{t('card.popularityValue', { v: track.pop })}</span>
          </dd>
          <dt>{t('card.year')}</dt>
          <dd className="mono">{track.year}</dd>
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
        <div className="listen">
          <span className="eyebrow">{t('card.listen')}</span>
          <div className="listen__links">
            {listenLinks(track).map((l) => (
              <a key={l.name} href={l.href} target="_blank" rel="noreferrer noopener" className="btn btn--ghost btn--sm">
                {l.name} <Icon name="external" size={14} />
              </a>
            ))}
          </div>
        </div>
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
  return (
    <CardModalContext.Provider value={setTrackId}>
      {children}
      <Modal open={!!trackId} onClose={close} className="modal--card" title={trackId ? TRACK_BY_ID[trackId]?.title : ''}>
        {trackId && <CardDetail trackId={trackId} onClose={close} />}
      </Modal>
    </CardModalContext.Provider>
  );
}

export const useCardModal = () => useContext(CardModalContext);
