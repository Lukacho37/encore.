import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import CoverArt from './CoverArt.jsx';
import { Modal, Icon, Progress } from './ui.jsx';
import { RatingValue } from './Rating.jsx';
import { ALBUM_BY_ID, ARTIST_BY_ID, TRACKS_BY_ALBUM } from '@shared/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { sound } from '../sound.js';

// Compléter un album = posséder son vinyle. Réunir toutes ses cartes en holo = édition holo.

export function isHoloComplete(albumId, owned) {
  return TRACKS_BY_ALBUM[albumId].every((t) => (owned?.get(t.id)?.holo || 0) > 0);
}

/** Le disque seul : sillons, reflets et étiquette aux couleurs de l'album. */
export function Disc({ albumId, edition = 'black', spinning = false }) {
  const album = ALBUM_BY_ID[albumId];
  const [, c1, c2] = album.art.palette;
  return (
    <span className={`disc disc--${edition}${spinning ? ' is-spinning' : ''}`} style={{ '--lc': c1, '--lr': c2 }} aria-hidden="true">
      {/* Le corps tourne ; les reflets restent fixes, comme sur une vraie platine. */}
      <span className="disc__body">
        <span className="disc__label">
          <span className="disc__title">{album.title}</span>
          <span className="disc__artist">{ARTIST_BY_ID[album.artist].name}</span>
          <span className="disc__brand">AlbumMania · 33⅓</span>
        </span>
        <span className="disc__hole" />
      </span>
      <span className="disc__sheen" />
    </span>
  );
}

/** Pochette avec le disque qui dépasse ; il sort davantage et tourne au survol. */
export function Vinyl({ albumId, edition = 'black', onClick, className = '', reveal = false, label, sizes = '(max-width: 700px) 200px, 260px' }) {
  const album = ALBUM_BY_ID[albumId];
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`vinyl vinyl--${edition}${reveal ? ' vinyl--reveal' : ''} ${className}`} onClick={onClick}
      aria-label={label || album.title}>
      <span className="vinyl__disc"><Disc albumId={albumId} edition={edition} /></span>
      <span className="vinyl__sleeve">
        <CoverArt art={{ ...album.art, seed: album.id }} sizes={sizes} />
        <span className="vinyl__wear" />
      </span>
    </Tag>
  );
}

/** Platine : le vinyle tourne, le bras se pose, et on entend les craquements. */
export function TurntableModal({ vinyl, onClose }) {
  const { t, date } = useI18n();
  const { ratings, owned } = useGame();
  const [playing, setPlaying] = useState(false);
  const album = vinyl ? ALBUM_BY_ID[vinyl.albumId] : null;

  useEffect(() => {
    setPlaying(false);
  }, [vinyl?.albumId]);

  useEffect(() => {
    if (playing) sound.crackle.start();
    else sound.crackle.stop();
    return () => sound.crackle.stop();
  }, [playing]);

  const toggle = () => {
    sound.unlock();
    sound.click();
    setPlaying((p) => !p);
  };

  return (
    <Modal open={!!vinyl} onClose={onClose} title={album?.title || ''} className="modal--turntable">
      {album && (
        <div className="turntable-view">
          <div className={`turntable${playing ? ' is-playing' : ''}`}>
            <div className="turntable__plinth">
              <div className="turntable__platter">
                <Disc albumId={album.id} edition={vinyl.edition} spinning={playing} />
              </div>
              <div className="turntable__arm" aria-hidden="true">
                <span className="turntable__arm-base" />
                <span className="turntable__arm-rod" />
                <span className="turntable__arm-head" />
              </div>
              <div className="turntable__controls">
                <button type="button" className={`turntable__start${playing ? ' is-on' : ''}`} onClick={toggle} aria-pressed={playing}>
                  {playing ? t('vinyl.stop') : t('vinyl.play')}
                </button>
                <span className="turntable__speed mono">{t('vinyl.speed')}</span>
                <span className={`turntable__led${playing ? ' is-on' : ''}`} aria-hidden="true" />
              </div>
            </div>
          </div>
          <div className="turntable-view__info">
            <span className={`edition-tag edition-tag--${vinyl.edition}`}>{vinyl.edition === 'holo' ? t('vinyl.holo') : t('vinyl.black')}</span>
            <h3 className="turntable-view__title">{album.title}</h3>
            <Link to={`/artist/${album.artist}`} onClick={onClose} className="turntable-view__artist">{ARTIST_BY_ID[album.artist].name}</Link>
            <p className="small muted mono">{album.year}{vinyl.at ? ` · ${t('vinyl.pressedOn', { date: date(vinyl.at) })}` : ''}</p>
            {vinyl.mine && ratings?.get(`album:${album.id}`) != null && (
              <div className="turntable-view__rating"><span className="small muted">{t('rating.yours')}</span> <RatingValue value={ratings.get(`album:${album.id}`)} /></div>
            )}
            {vinyl.mine && vinyl.edition !== 'holo' && <p className="small muted">{t('vinyl.holoHint')}</p>}
            <ol className="sides">
              {TRACKS_BY_ALBUM[album.id].map((tr, i, list) => {
                const side = i < Math.ceil(list.length / 2) ? 'A' : 'B';
                const n = side === 'A' ? i + 1 : i + 1 - Math.ceil(list.length / 2);
                const mine = vinyl.mine ? ratings?.get(`track:${tr.id}`) : null;
                return (
                  <li key={tr.id} className={vinyl.mine && owned?.get(tr.id)?.holo ? 'is-holo' : ''}>
                    <span className="sides__pos mono">{side}{n}</span>
                    <span className="sides__title">{tr.title}</span>
                    {mine != null && <RatingValue value={mine} size={11} />}
                  </li>
                );
              })}
            </ol>
            <Link to={`/album/${album.id}`} onClick={onClose} className="btn btn--ghost btn--sm">{t('vinyl.open')}</Link>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Étagère de vinyles (vinylthèque) en tête du profil. */
export function VinylShelf({ vinyls, upcoming = [], title, emptyText, mine }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(null);
  return (
    <section className="vinyl-shelf">
      <header className="vinyl-shelf__head">
        <h2>{title}</h2>
        <span className="chip">{t('vinyl.count', { n: vinyls.length })}</span>
      </header>
      {vinyls.length === 0 && <p className="vinyl-shelf__empty">{emptyText}</p>}
      <div className="vinyl-shelf__rack">
        {vinyls.map((v) => {
          const album = ALBUM_BY_ID[v.albumId];
          return (
            <figure key={v.albumId} className="vinyl-item">
              <Vinyl albumId={v.albumId} edition={v.edition} onClick={() => setOpen({ ...v, mine })} label={`${album.title} · ${t('vinyl.play')}`} />
              <figcaption>
                <span className="vinyl-item__title">{album.title}</span>
                <span className="vinyl-item__artist">{ARTIST_BY_ID[album.artist].name}</span>
                {v.edition === 'holo' && <span className="edition-tag edition-tag--holo">{t('vinyl.holo')}</span>}
              </figcaption>
            </figure>
          );
        })}
        {upcoming.map(({ albumId, progress }) => {
          const album = ALBUM_BY_ID[albumId];
          return (
            <figure key={albumId} className="vinyl-item vinyl-item--upcoming">
              <Link to={`/album/${albumId}`} className="vinyl vinyl--ghost" aria-label={album.title}>
                <span className="vinyl__sleeve">
                  <CoverArt art={{ ...album.art, seed: album.id }} generated />
                  <span className="vinyl__lock"><Icon name="lock" size={16} /><span className="mono">{progress.owned}/{progress.total}</span></span>
                </span>
              </Link>
              <figcaption>
                <span className="vinyl-item__title">{album.title}</span>
                <span className="vinyl-item__artist">{t('vinyl.next')}</span>
                <Progress value={progress.owned} max={progress.total} color={album.art.palette[1]} size="xs" />
              </figcaption>
            </figure>
          );
        })}
      </div>
      <TurntableModal vinyl={open} onClose={() => setOpen(null)} />
    </section>
  );
}
