import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useGame } from '../state/GameContext.jsx';
import { useI18n } from '../i18n/index.jsx';
import Card, { RarityGem } from '../components/Card.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { useCardModal } from '../components/CardModal.jsx';
import { Celebration } from '../components/Achievements.jsx';
import { Icon, Modal, Progress, RoyaltyIcon, useToast } from '../components/ui.jsx';
import { Vinyl, TurntableModal, isHoloComplete } from '../components/Vinyl.jsx';
import {
  RatingHistogram, RatingInput, RatingValue, ReviewEditor, ReviewList, useItemRatings,
} from '../components/Rating.jsx';
import { ALBUM_BY_ID, ARTIST_BY_ID, TRACKS_BY_ALBUM, TRACK_BY_ID, catalogCode } from '@shared/catalog.js';
import { albumReward, pressCost } from '@shared/rules.js';
import { post, api } from '../api.js';
import { sound } from '../sound.js';
import { storage } from '../storage.js';

export function PressDialog({ trackId, onClose, onDone }) {
  const { t, error } = useI18n();
  const { user, applyState, isAdmin } = useGame();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const track = trackId ? TRACK_BY_ID[trackId] : null;
  const cost = !track || isAdmin ? 0 : pressCost(trackId);
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
              <Icon name="press" /> {t('album.press')} · {isAdmin ? t('album.pressFree') : <><RoyaltyIcon size={14} /> <span className="mono">{cost}</span></>}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function TrackGrid({ tracks, onPress }) {
  const { owned, isAdmin } = useGame();
  const { t } = useI18n();
  const openCard = useCardModal();
  return (
    <div className="card-grid">
      {tracks.map((tr) => {
        const mine = owned.get(tr.id);
        const cost = isAdmin ? 0 : pressCost(tr.id);
        return (
          <div key={tr.id} className="card-cell">
            <Card trackId={tr.id} variant={mine?.holo ? 'holo' : 'std'} ghost={!mine} count={mine ? mine.std + mine.holo : 0}
              onClick={() => openCard(tr.id)} />
            {!mine && cost != null && onPress && (
              <button type="button" className="press-btn" onClick={() => onPress(tr.id)}>
                <Icon name="press" size={14} /> {t('album.press')} · {isAdmin ? t('album.pressFree') : <span className="mono">{cost}</span>}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Tracklist façon fiche d'album : rareté, carte possédée, moyenne et ta note pour chaque morceau. */
function Tracklist({ tracks, trackRatings, onPress }) {
  const { t, error } = useI18n();
  const { owned, ratings, isAdmin, applyState } = useGame();
  const openCard = useCardModal();
  const toast = useToast();
  const timers = useRef({});
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  // Petite attente avant l'envoi : plusieurs appuis rapides ne font qu'une seule requête.
  const rateTrack = (trackId, score) => {
    clearTimeout(timers.current[trackId]);
    timers.current[trackId] = setTimeout(async () => {
      try {
        const res = await api('PUT', `/ratings/track/${encodeURIComponent(trackId)}`, { score });
        applyState(res.state);
      } catch (err) {
        toast(error(err.code), 'error');
      }
    }, 350);
  };
  return (
    <div className="table-wrap tracklist-wrap">
      <table className="tracklist">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>{t('album.colTrack')}</th>
            <th>{t('card.rarity')}</th>
            <th>{t('album.colOwned')}</th>
            <th>{t('album.colAvg')}</th>
            <th>{t('album.colMine')}</th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((tr) => {
            const mine = owned.get(tr.id);
            const community = trackRatings?.[tr.id];
            const cost = isAdmin ? 0 : pressCost(tr.id);
            return (
              <tr key={tr.id} className={mine ? 'is-owned' : ''}>
                <td className="num mono muted">{tr.n}</td>
                <td>
                  <button type="button" className="tracklist__title" onClick={() => openCard(tr.id)}>
                    {tr.title}
                    {tr.feat && <span className="muted small"> · feat. {tr.feat}</span>}
                  </button>
                </td>
                <td><span className="tracklist__rarity"><RarityGem rarity={tr.rarity} size={12} /> {t(`rarity.${tr.rarity}`)}</span></td>
                <td>
                  {mine ? (
                    <span className={`owned-chip${mine.holo ? ' owned-chip--holo' : ''}`}><Icon name="check" size={13} /> {mine.holo ? t('card.holo') : `×${mine.std}`}</span>
                  ) : cost != null ? (
                    <button type="button" className="press-btn press-btn--inline" onClick={() => onPress(tr.id)}>
                      <Icon name="press" size={13} /> {isAdmin ? t('album.pressFree') : <span className="mono">{cost}</span>}
                    </button>
                  ) : null}
                </td>
                <td>{community?.count ? <span className="tracklist__avg"><RatingValue value={community.average} average size={11} /> <span className="muted small mono">({community.count})</span></span> : <span className="muted">·</span>}</td>
                <td><RatingInput value={ratings.get(`track:${tr.id}`) ?? null} onChange={(v) => rateTrack(tr.id, v)} size={15} compact label={`${t('rating.yours')} · ${tr.title}`} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AlbumRatings({ albumId, ratingsApi }) {
  const { t } = useI18n();
  const { data, save, remove } = ratingsApi;
  if (!data) return null;
  const { summary } = data;
  return (
    <section className="section album-ratings" id="critiques">
      <header className="section__head"><h2>{t('reviews.title')}</h2></header>
      <div className="album-ratings__grid">
        <div className="panel">
          <h3 className="panel__title">{t('reviews.yours')}</h3>
          <ReviewEditor key={albumId} data={data} save={save} remove={remove} />
        </div>
        <div className="panel album-ratings__community">
          <h3 className="panel__title">{t('rating.community')}</h3>
          {summary.count ? (
            <>
              <div className="community-score">
                <RatingValue value={summary.average} average size={22} />
                <span className="muted small">{t('rating.count', { n: summary.count })}</span>
              </div>
              <RatingHistogram distribution={summary.distribution} mine={data.mine?.score} />
            </>
          ) : <p className="muted">{t('rating.empty')}</p>}
          {data.friendScores.length > 0 && (
            <div className="friend-scores">
              <span className="studio__label">{t('rating.friends')}</span>
              <ul>
                {data.friendScores.map((f) => (
                  <li key={f.user.id}>
                    <Link to={`/u/${f.user.username}`} className="friend-score">
                      <span className="friend-score__name">{f.user.username}</span>
                      <RatingValue value={f.score} size={11} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <h3 className="studio__label album-ratings__list-title">{t('reviews.list')}</h3>
      <ReviewList reviews={data.reviews} />
    </section>
  );
}

export default function AlbumPage() {
  const { id } = useParams();
  const { t, date } = useI18n();
  const { stats, achievements, owned, ratings } = useGame();
  const [pressing, setPressing] = useState(null);
  const [celebrate, setCelebrate] = useState([]);
  const [view, setView] = useState(() => storage.get('albummania.albumView') || 'cards');
  const [turntable, setTurntable] = useState(null);
  const album = ALBUM_BY_ID[id];
  const ratingsApi = useItemRatings('album', album ? id : 'discovery');
  // Quand une de mes notes de morceau change (tracklist ou fiche carte), on recharge les moyennes.
  const trackSignature = useMemo(
    () => (album ? TRACKS_BY_ALBUM[id].map((tr) => ratings.get(`track:${tr.id}`) ?? '-').join(',') : ''),
    [ratings, album, id],
  );
  const firstSignature = useRef(trackSignature);
  const { reload } = ratingsApi;
  useEffect(() => {
    if (trackSignature !== firstSignature.current) {
      firstSignature.current = trackSignature;
      reload();
    }
  }, [trackSignature, reload]);
  if (!album) return <Navigate to="/collection" replace />;
  const artist = ARTIST_BY_ID[album.artist];
  const tracks = TRACKS_BY_ALBUM[id];
  const p = stats.albums[id];
  const doneAt = achievements.get(`album:${id}`);
  const reward = albumReward(id);
  const edition = doneAt && isHoloComplete(id, owned) ? 'holo' : 'black';
  const summary = ratingsApi.data?.summary;
  const chooseView = (v) => {
    setView(v);
    storage.set('albummania.albumView', v);
  };

  return (
    <div className="album-page" style={{ '--album-c0': album.art.palette[0], '--album-c1': album.art.palette[1] }}>
      <Link to="/collection" className="back-link"><Icon name="back" /> {t('album.back')}</Link>
      <header className={`album-head${doneAt ? ' album-head--vinyl' : ''}`}>
        {doneAt ? (
          <div className="album-head__vinyl">
            <Vinyl albumId={id} edition={edition} onClick={() => setTurntable({ albumId: id, edition, at: doneAt, mine: true })} label={t('album.playVinyl')} />
          </div>
        ) : (
          <div className="album-head__cover">
            <CoverArt art={{ ...album.art, seed: album.id }} title={album.title} />
          </div>
        )}
        <div className="album-head__info">
          <span className="eyebrow mono">{catalogCode(tracks[0])} · {t(`genre.${album.genre}`)} · {album.year}</span>
          <h1>{album.title}</h1>
          <Link to={`/artist/${artist.id}`} className="album-head__artist">{artist.name}</Link>
          {summary?.count > 0 && (
            <a href="#critiques" className="album-head__score">
              <RatingValue value={summary.average} average size={16} />
              <span className="muted small">{t('rating.count', { n: summary.count })}</span>
            </a>
          )}
          <div className="album-head__progress">
            <Progress value={p.owned} max={p.total} color={album.art.palette[1]} size="lg" />
            <span className="mono">{p.owned}/{p.total}</span>
          </div>
          {doneAt ? (
            <p className="gold-note">
              <Icon name="disc" /> {t('album.completedOn', { date: date(doneAt) })}
              {edition === 'holo' && <span className="edition-tag edition-tag--holo">{t('vinyl.holo')}</span>}
            </p>
          ) : (
            <div className="reward-box">
              <span className="eyebrow">{t('album.reward')}</span>
              <p>{t('album.rewardBody', { r: reward.royalties, x: reward.xp })}</p>
              <p className="small muted">{t('album.pressHint')}</p>
            </div>
          )}
        </div>
      </header>

      <div className="toolbar">
        <div className="seg" role="group" aria-label={t('album.view')}>
          {[['cards', t('album.viewCards')], ['tracklist', t('album.viewTracklist')]].map(([v, label]) => (
            <button key={v} type="button" className={`seg__btn seg__btn--wide${view === v ? ' is-on' : ''}`} aria-pressed={view === v} onClick={() => chooseView(v)}>{label}</button>
          ))}
        </div>
      </div>

      {view === 'cards'
        ? <TrackGrid tracks={tracks} onPress={setPressing} />
        : <Tracklist tracks={tracks} trackRatings={ratingsApi.data?.tracks} onPress={setPressing} />}

      <AlbumRatings albumId={id} ratingsApi={ratingsApi} />

      <PressDialog trackId={pressing} onClose={() => setPressing(null)} onDone={(res) => setCelebrate(res.achievements || [])} />
      <Celebration achievements={celebrate} onClose={() => setCelebrate([])} />
      <TurntableModal vinyl={turntable} onClose={() => setTurntable(null)} />
    </div>
  );
}
