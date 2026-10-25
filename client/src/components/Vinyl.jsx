import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import CoverArt from './CoverArt.jsx';
import { Modal, Icon, Progress } from './ui.jsx';
import { RatingValue } from './Rating.jsx';
import { getAlbum, useAlbum, useAlbumDetail, useApi } from '../state/catalog.js';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { sound } from '../sound.js';
import { DELUXE_XP, deluxeKey } from '@shared/rules.js';
import '../styles/album.css';
import '../styles/game.css';
import '../styles/workshop.css';

// Compléter un album = posséder son vinyle. Réunir toutes ses cartes en holo = édition holo.
// Les albums viennent du catalogue chargé (vue d'album de l'API) : on peut passer `album` quand on l'a déjà,
// sinon `albumId` suffit et l'album est récupéré par lots.
// Jeu de collection (P1-D, PLAN.md 6.2 et 6.6) : `pressing` = « Pressage n° 37 » (rang du joueur parmi ceux qui ont
// complété l'album), écrit sur l'étiquette du disque et sous le vinyle, jamais par-dessus la pochette (PLAN.md 7.1) ;
// `color` = couleur de vinyle choisie par le joueur (cosmétique « prune », « marbre », « transparent ») ; les éditions
// gagnées album par album passent avant.
// Éditions (P2-D, PLAN.md 6.3) : `edition` = 'deluxe' (album complété, noté, et chacun de ses morceaux noté : un disque
// doré, couleur AlbumMania, jamais la pochette), 'holo' (toutes les cartes en holo) ou 'black' ; `holo` (vinyles du
// Studio) garde l'étiquette « Édition holo » sous une deluxe. Pour ses propres vinyles, l'édition se lit dans l'état du
// joueur (ownVinylEdition : succès deluxe:<albumId>, holos possédées).

/** Couleurs de vinyle connues (shared/cosmetics.js) ; une autre valeur garde le disque noir. */
const DISC_COLORS = new Set(['prune', 'marbre', 'transparent']);
const colorClass = (edition, color) => (edition === 'black' && DISC_COLORS.has(color) ? ` gm-disc gm-disc--${color}` : '');
const editionClass = (edition) => (edition === 'deluxe' ? ' ws-disc ws-disc--deluxe' : '');

// Nombre de cartes holo possédées par album, calculé une fois par état de collection (Map trackId -> { std, holo }).
// L'identifiant d'une carte d'album est « <albumId>:<numéro> » (ex. abbey-road:01, dz123456:07).
const holoIndex = new WeakMap();

function holoCounts(owned) {
  let index = holoIndex.get(owned);
  if (!index) {
    index = new Map();
    for (const [trackId, entry] of owned) {
      if (!(entry?.holo > 0)) continue;
      const cut = trackId.lastIndexOf(':');
      if (cut <= 0) continue;
      const albumId = trackId.slice(0, cut);
      index.set(albumId, (index.get(albumId) || 0) + 1);
    }
    holoIndex.set(owned, index);
  }
  return index;
}

/**
 * Toutes les cartes de l'album en holo ? `tracks` : liste des cartes de l'album (page d'album) ou nombre de cartes
 * de l'album ; sans lui, on lit le nombre de cartes de l'album dans le catalogue chargé (faux s'il n'y est pas).
 */
export function isHoloComplete(albumId, owned, tracks) {
  if (!owned || typeof owned.get !== 'function') return false;
  if (Array.isArray(tracks)) return tracks.length > 0 && tracks.every((t) => (owned.get(t.id)?.holo || 0) > 0);
  const total = typeof tracks === 'number' ? tracks : getAlbum(albumId)?.trackCount;
  if (!total) return false;
  return (holoCounts(owned).get(albumId) || 0) >= total;
}

/**
 * Édition de l'un de ses propres vinyles d'après l'état du joueur : { edition, holo }. `achievements` et `owned` :
 * ceux de useGame() ; `tracks` : liste des cartes de l'album ou leur nombre (voir isHoloComplete).
 */
export function ownVinylEdition(albumId, { achievements, owned, tracks } = {}) {
  const holo = isHoloComplete(albumId, owned, tracks);
  const deluxe = !!achievements?.has?.(deluxeKey(albumId));
  return { edition: deluxe ? 'deluxe' : holo ? 'holo' : 'black', holo };
}

/** Étiquettes d'édition d'un vinyle : « Édition deluxe », et « Édition holo » quand elle est réunie aussi. */
export function EditionTags({ edition, holo }) {
  const { t } = useI18n();
  const isHolo = edition === 'holo' || (edition === 'deluxe' && holo);
  if (edition !== 'deluxe' && !isHolo) return null;
  return (
    <>
      {edition === 'deluxe' && <span className="edition-tag ws-edition ws-edition--deluxe">{t('workshop.deluxe.tag')}</span>}
      {isHolo && <span className="edition-tag edition-tag--holo">{t('vinyl.holo')}</span>}
    </>
  );
}

/** Album passé en prop, ou lu dans le catalogue (undefined le temps du chargement). */
function useVinylAlbum(albumId, album) {
  const fetched = useAlbum(album ? null : albumId);
  return album || fetched;
}

const artOf = (album) => ({ ...album.art, seed: album.art?.seed || album.id });

/** Le disque seul : sillons, reflets et étiquette aux couleurs de l'album. */
export function Disc({ albumId, album: albumProp, edition = 'black', spinning = false, color = null, pressing = null }) {
  const { t } = useI18n();
  const album = useVinylAlbum(albumId, albumProp);
  // Le temps du chargement, étiquette neutre sans texte.
  const [, c1 = '#3a3145', c2 = '#f4eee3'] = album?.art?.palette || [];
  return (
    <span className={`disc disc--${edition}${editionClass(edition)}${colorClass(edition, color)}${spinning ? ' is-spinning' : ''}`} style={{ '--lc': c1, '--lr': c2 }} aria-hidden="true">
      {/* Le corps tourne ; les reflets restent fixes, comme sur une vraie platine. */}
      <span className="disc__body">
        <span className="disc__label">
          {album && (
            <>
              <span className="disc__title">{album.title}</span>
              <span className="disc__artist">{album.artist}</span>
              <span className="disc__brand">{pressing ? t('game.moment.pressingShort', { n: pressing }) : 'AlbumMania · 33⅓'}</span>
            </>
          )}
        </span>
        <span className="disc__hole" />
      </span>
      <span className="disc__sheen" />
    </span>
  );
}

/** Pochette avec le disque qui dépasse ; il sort davantage et tourne au survol. */
export function Vinyl({ albumId, album: albumProp, edition = 'black', onClick, className = '', reveal = false, label, sizes = '(max-width: 700px) 200px, 260px', color = null, pressing = null }) {
  const album = useVinylAlbum(albumId, albumProp);
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`vinyl vinyl--${edition}${reveal ? ' vinyl--reveal' : ''} ${className}`} onClick={onClick}
      aria-label={label || album?.title || undefined} aria-busy={album ? undefined : true}>
      <span className="vinyl__disc"><Disc albumId={album?.id || albumId} album={album} edition={edition} color={color} pressing={pressing} /></span>
      <span className={`vinyl__sleeve${album ? '' : ' vinyl__sleeve--loading'}`}>
        {album && <CoverArt art={artOf(album)} sizes={sizes} />}
        <span className="vinyl__wear" />
      </span>
    </Tag>
  );
}

/** Faces A et B de l'album sur la platine (cartes chargées à l'ouverture). */
function Sides({ tracks, mine }) {
  const { ratings, owned } = useGame();
  const half = Math.ceil(tracks.length / 2);
  return (
    <ol className="sides">
      {tracks.map((tr, i) => {
        const side = i < half ? 'A' : 'B';
        const n = side === 'A' ? i + 1 : i + 1 - half;
        const score = mine ? ratings?.get(`track:${tr.id}`) : null;
        return (
          <li key={tr.id} className={mine && owned?.get(tr.id)?.holo ? 'is-holo' : ''}>
            <span className="sides__pos mono">{side}{n}</span>
            <span className="sides__title">{tr.title}</span>
            {score != null && <RatingValue value={score} size={11} />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Ce qui manque pour l'édition deluxe d'un de ses vinyles (GET /albums/:id/deluxe) : « Édition deluxe : note les
 * 3 morceaux restants », avec un lien vers la page de l'album. Rien tant que ce n'est pas chargé.
 */
export function DeluxeNudge({ albumId, onClose, className = '' }) {
  const { t } = useI18n();
  const status = useApi(albumId ? `/albums/${encodeURIComponent(albumId)}/deluxe` : null, { keep: false }).data;
  if (!status || status.albumId !== albumId || !status.completed) return null;
  if (status.done) return <p className={`ws-deluxe-line ws-deluxe-line--done small ${className}`}><Icon name="disc" size={14} /> {t('workshop.deluxe.done')}</p>;
  const left = status.tracksTotal - status.tracksRated;
  const text = !status.albumRated && left > 0 ? t('workshop.deluxe.nudgeBoth', { n: left })
    : !status.albumRated ? t('workshop.deluxe.nudgeAlbum') : t('workshop.deluxe.nudgeTracks', { n: left });
  return (
    <p className={`ws-deluxe-line small ${className}`} data-deluxe-nudge={albumId}>
      <Icon name="disc" size={14} /> <span>{text}</span>
      <span className="muted"> · +{status.xp ?? DELUXE_XP} XP</span>
      {' '}
      <Link to={`/album/${encodeURIComponent(albumId)}`} onClick={onClose} className="link-btn">{t('workshop.deluxe.open')}</Link>
    </p>
  );
}

/** Platine : le vinyle tourne, le bras se pose, et on entend les craquements. */
export function TurntableModal({ vinyl: shown, onClose }) {
  const { t, date } = useI18n();
  const { ratings, ranks, achievements } = useGame();
  const [playing, setPlaying] = useState(false);
  // Son propre vinyle : l'édition deluxe se lit dans l'état du joueur (la page d'album ne connaît que l'édition holo).
  const vinyl = shown?.mine && achievements?.has?.(deluxeKey(shown.albumId)) && shown.edition !== 'deluxe'
    ? { ...shown, edition: 'deluxe', holo: shown.holo ?? shown.edition === 'holo', color: null }
    : shown;
  const albumId = vinyl?.albumId || null;
  // Album et cartes ne sont chargés qu'à l'ouverture de la platine (puis gardés pour la session).
  const detail = useAlbumDetail(albumId);
  const loaded = detail.data?.album?.id === albumId ? detail.data : null;
  const album = loaded?.album || getAlbum(albumId);
  // Pressage n° : donné par l'étagère, sinon lu dans l'état du joueur (ses vinyles), sinon demandé au serveur.
  const knownRank = vinyl?.rank ?? (vinyl?.mine ? ranks?.get(`album:${albumId}`) : null) ?? null;
  const completion = useApi(vinyl?.mine && knownRank == null && albumId ? `/albums/${encodeURIComponent(albumId)}/completion` : null);
  const pressing = knownRank ?? completion.data?.mine?.rank ?? null;

  useEffect(() => {
    setPlaying(false);
  }, [albumId]);

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
      {vinyl && (
        <div className="turntable-view">
          <div className={`turntable${playing ? ' is-playing' : ''}`}>
            <div className="turntable__plinth">
              <div className="turntable__platter">
                <Disc albumId={albumId} album={album} edition={vinyl.edition} spinning={playing} color={vinyl.color} pressing={pressing} />
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
            <span className="ws-turntable__tags">
              {vinyl.edition === 'deluxe' || vinyl.edition === 'holo' ? <EditionTags edition={vinyl.edition} holo={vinyl.holo} /> : (
                <span className={`edition-tag edition-tag--${vinyl.edition}`}>
                  {DISC_COLORS.has(vinyl.color) ? t('game.vinylColor', { name: t(`cosmetics.vinyl.${vinyl.color}`) }) : t('vinyl.black')}
                </span>
              )}
            </span>
            {album ? (
              <>
                <h3 className="turntable-view__title">{album.title}</h3>
                <Link to={`/artist/${encodeURIComponent(album.artistId)}`} onClick={onClose} className="turntable-view__artist">{album.artist}</Link>
                <p className="small muted mono">
                  {[album.year, vinyl.at ? t('vinyl.pressedOn', { date: date(vinyl.at) }) : null].filter(Boolean).join(' · ')}
                </p>
                {pressing && <p className="gm-pressing mono">{t('game.moment.pressing', { n: pressing })}</p>}
              </>
            ) : (
              <span className="album-skel album-skel--title" aria-hidden="true" />
            )}
            {vinyl.mine && ratings?.get(`album:${albumId}`) != null && (
              <div className="turntable-view__rating"><span className="small muted">{t('rating.yours')}</span> <RatingValue value={ratings.get(`album:${albumId}`)} /></div>
            )}
            {vinyl.mine && vinyl.edition !== 'deluxe' && <DeluxeNudge albumId={albumId} onClose={onClose} />}
            {vinyl.mine && vinyl.edition === 'black' && <p className="small muted">{t('vinyl.holoHint')}</p>}
            {loaded ? (
              <Sides tracks={loaded.tracks} mine={vinyl.mine} />
            ) : detail.error ? (
              <p className="small muted">{t('vinyl.sidesError')}</p>
            ) : (
              <div className="sides-skel" role="status" aria-label={t('common.loading')}>
                {Array.from({ length: 6 }, (_, i) => <span key={i} className="album-skel album-skel--line" />)}
              </div>
            )}
            <Link to={`/album/${encodeURIComponent(albumId)}`} onClick={onClose} className="btn btn--ghost btn--sm">{t('vinyl.open')}</Link>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Un vinyle de l'étagère. */
function ShelfVinyl({ vinyl, onOpen }) {
  const { t } = useI18n();
  const album = useAlbum(vinyl.albumId);
  return (
    <figure className="vinyl-item">
      <Vinyl albumId={vinyl.albumId} album={album} edition={vinyl.edition} onClick={onOpen} color={vinyl.color} pressing={vinyl.rank}
        label={`${album?.title || t('common.loading')} · ${t('vinyl.play')}`} />
      <figcaption>
        <span className="vinyl-item__title">{album?.title || '…'}</span>
        <span className="vinyl-item__artist">{album?.artist || ''}</span>
        {vinyl.rank ? <span className="gm-pressing gm-pressing--shelf mono">{t('game.moment.pressing', { n: vinyl.rank })}</span> : null}
        <EditionTags edition={vinyl.edition} holo={vinyl.holo} />
      </figcaption>
    </figure>
  );
}

/** Un album presque terminé, en attente sur l'étagère. */
function ShelfUpcoming({ albumId, progress }) {
  const { t } = useI18n();
  const album = useAlbum(albumId);
  return (
    <figure className="vinyl-item vinyl-item--upcoming">
      <Link to={`/album/${encodeURIComponent(albumId)}`} className="vinyl vinyl--ghost" aria-label={album?.title || t('vinyl.next')}>
        <span className={`vinyl__sleeve${album ? '' : ' vinyl__sleeve--loading'}`}>
          {album && <CoverArt art={artOf(album)} generated />}
          <span className="vinyl__lock"><Icon name="lock" size={16} /><span className="mono">{progress.owned}/{progress.total}</span></span>
        </span>
      </Link>
      <figcaption>
        <span className="vinyl-item__title">{album?.title || '…'}</span>
        <span className="vinyl-item__artist">{t('vinyl.next')}</span>
        <Progress value={progress.owned} max={progress.total} color={album?.art?.palette?.[1]} size="xs" />
      </figcaption>
    </figure>
  );
}

/**
 * Étagère de vinyles (vinylthèque) en tête du profil. `count` : nombre total de vinyles quand `vinyls` n'en
 * contient qu'une partie (le profil public n'envoie que les plus récents). `color` : couleur de vinyle choisie par
 * le propriétaire de l'étagère (cosmétique ; par défaut, la sienne pour sa propre étagère). Chaque vinyle peut porter
 * `rank` (Pressage n°) ; pour sa propre étagère, il est lu dans l'état du joueur.
 */
export function VinylShelf({ vinyls: list, upcoming = [], title, emptyText, mine, count, color }) {
  const { t } = useI18n();
  const { user, ranks, achievements } = useGame();
  const [open, setOpen] = useState(null);
  const shelfColor = color !== undefined ? color : mine ? user?.cosmetics?.vinyl ?? null : null;
  const vinyls = list.map((v) => {
    // Sa propre étagère : l'édition deluxe se lit aussi dans l'état du joueur (à jour dès qu'elle est gagnée).
    const deluxe = v.edition === 'deluxe' || (mine && !!achievements?.has?.(deluxeKey(v.albumId)));
    const edition = deluxe ? 'deluxe' : v.edition;
    return {
      ...v,
      edition,
      holo: v.holo ?? v.edition === 'holo',
      color: edition === 'black' ? v.color ?? shelfColor : null,
      rank: v.rank ?? (mine ? ranks?.get(`album:${v.albumId}`) ?? null : null),
    };
  });
  return (
    <section className="vinyl-shelf">
      <header className="vinyl-shelf__head">
        <h2>{title}</h2>
        <span className="chip">{t('vinyl.count', { n: Math.max(count || 0, vinyls.length) })}</span>
      </header>
      {vinyls.length === 0 && <p className="vinyl-shelf__empty">{emptyText}</p>}
      <div className="vinyl-shelf__rack">
        {vinyls.map((v) => <ShelfVinyl key={v.albumId} vinyl={v} onOpen={() => setOpen({ ...v, mine })} />)}
        {upcoming.map(({ albumId, progress }) => <ShelfUpcoming key={albumId} albumId={albumId} progress={progress} />)}
      </div>
      <TurntableModal vinyl={open} onClose={() => setOpen(null)} />
    </section>
  );
}
