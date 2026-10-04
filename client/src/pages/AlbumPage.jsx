import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import Card from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import { Celebration } from '../components/Achievements.jsx';
import { Icon, Modal, Progress, RoyaltyIcon, useToast } from '../components/ui.jsx';
import { ALBUM_BY_ID, ARTIST_BY_ID, TRACKS_BY_ALBUM, TRACK_BY_ID, catalogCode } from '@shared/catalog.js';
import { albumReward, pressCost } from '@shared/rules.js';
import { post } from '../api.js';
import { sound } from '../sound.js';

export function PressDialog({ trackId, onClose, onDone }) {
  const { t, error } = useI18n();
  const { user, applyState } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const track = trackId ? TRACK_BY_ID[trackId] : null;
  const cost = track ? pressCost(trackId) : 0;
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
    <Modal open={!!track} onClose={onClose} title={t('album.pressTitle')} className="modal--narrow">
      {track && (
        <div className="press">
          <div className="press__card"><Card trackId={trackId} ghost /></div>
          <p>{t('album.pressBody', { title: track.title, n: cost })}</p>
          {missing > 0 && <p className="form-error">{t('album.pressMissing', { n: missing })}</p>}
          <div className="press__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="button" className="btn btn--primary" onClick={confirm} disabled={busy || missing > 0} data-autofocus>
              <Icon name="press" /> {t('album.press')} · <RoyaltyIcon size={14} /> <span className="mono">{cost}</span>
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function TrackGrid({ tracks, onPress }) {
  const { owned } = useGame();
  const { t } = useI18n();
  const openCard = useCardModal();
  return (
    <div className="card-grid">
      {tracks.map((tr) => {
        const mine = owned.get(tr.id);
        const cost = pressCost(tr.id);
        return (
          <div key={tr.id} className="card-cell">
            <Card trackId={tr.id} variant={mine?.holo ? 'holo' : 'std'} ghost={!mine} count={mine ? mine.std + mine.holo : 0}
              onClick={() => openCard(tr.id)} />
            {!mine && cost != null && onPress && (
              <button type="button" className="press-btn" onClick={() => onPress(tr.id)}>
                <Icon name="press" size={14} /> {t('album.press')} · <span className="mono">{cost}</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AlbumPage() {
  const { id } = useParams();
  const { t, date } = useI18n();
  const { stats, achievements } = useGame();
  const [pressing, setPressing] = useState(null);
  const [celebrate, setCelebrate] = useState([]);
  const album = ALBUM_BY_ID[id];
  if (!album) return <Navigate to="/collection" replace />;
  const artist = ARTIST_BY_ID[album.artist];
  const tracks = TRACKS_BY_ALBUM[id];
  const p = stats.albums[id];
  const doneAt = achievements.get(`album:${id}`);
  const reward = albumReward(id);

  return (
    <div className="album-page" style={{ '--album-c0': album.art.palette[0], '--album-c1': album.art.palette[1] }}>
      <Link to="/collection" className="back-link"><Icon name="back" /> {t('album.back')}</Link>
      <header className="album-head">
        <div className={`album-head__cover${doneAt ? ' is-gold' : ''}`}>
          <CoverArt art={{ ...album.art, seed: album.id }} title={album.title} />
        </div>
        <div className="album-head__info">
          <span className="eyebrow mono">{catalogCode(tracks[0])} · {t(`genre.${album.genre}`)} · {album.year}</span>
          <h1>{album.title}</h1>
          <Link to={`/artist/${artist.id}`} className="album-head__artist">{artist.name}</Link>
          <div className="album-head__progress">
            <Progress value={p.owned} max={p.total} color={album.art.palette[1]} size="lg" />
            <span className="mono">{p.owned}/{p.total}</span>
          </div>
          {doneAt ? (
            <p className="gold-note"><Icon name="disc" /> {t('album.completedOn', { date: date(doneAt) })}</p>
          ) : (
            <div className="reward-box">
              <span className="eyebrow">{t('album.reward')}</span>
              <p>{t('album.rewardBody', { r: reward.royalties, x: reward.xp })}</p>
              <p className="small muted">{t('album.pressHint')}</p>
            </div>
          )}
        </div>
      </header>

      <TrackGrid tracks={tracks} onPress={setPressing} />

      <PressDialog trackId={pressing} onClose={() => setPressing(null)} onDone={(res) => setCelebrate(res.achievements || [])} />
      <Celebration achievements={celebrate} onClose={() => setCelebrate([])} />
    </div>
  );
}
