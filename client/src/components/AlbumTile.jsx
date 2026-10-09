// Vignette d'album partagée — chantier P0-B (PLAN.md 9.2). Une seule vignette pour tout le site (accueil, collection,
// page d'artiste, recherche, Découvrir…) : elle réunit celles de l'accueil et de la collection, au rendu inchangé.
// Props (contrat) : { album, progress?, to?, compact?, onClick? } ; en plus, gardés des deux anciennes vignettes :
//   owned    : nombre de cartes possédées (la collection le lit dans les statistiques du joueur) ;
//   discover : affiche le genre et le nombre de cartes à la place de la progression ;
//   sizes    : attribut `sizes` de l'image (vraie pochette) ;
//   className.
// `progress` : { owned, total } ; sans lui, `owned` puis album.owned (résultats de recherche). Sans `album` : emplacement
// de chargement de même taille. Styles : app.css (.album-tile*).
import { memo } from 'react';
import { Link } from 'react-router';
import CoverArt, { shownCover } from './CoverArt.jsx';
import { Icon, Progress } from './ui.jsx';
import { useI18n } from '../i18n/index.jsx';
import { useCovers } from '../state/CoversContext.jsx';

/**
 * Couleur de barre lisible sur le fond sombre : la teinte vive de la palette, ou la claire si elle est trop sombre
 * (règle de la vignette de la collection).
 */
export function accentOf(palette = []) {
  const light = (hex) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return !Number.isNaN(n) && (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 >= 0.35;
  };
  return [palette[1], palette[2]].find((c) => c && light(c)) || 'var(--paper)';
}

/** Vignette d'album pas encore chargée : même place que la vraie. */
export function AlbumTileSkeleton() {
  return (
    <span className="album-tile album-tile--loading" aria-hidden="true">
      <span className="album-tile__cover" />
      <span className="album-tile__meta">
        <span className="album-tile__skel" />
        <span className="album-tile__skel album-tile__skel--short" />
      </span>
    </span>
  );
}

const SIZES = '(max-width: 700px) 45vw, 270px';
const SIZES_COMPACT = '(max-width: 700px) 45vw, (max-width: 1020px) 50vw, 270px';

export const AlbumTile = memo(function AlbumTile({ album, progress, owned: ownedProp, to, compact = false, discover = false, onClick, sizes, className = '' }) {
  const { t } = useI18n();
  const covers = useCovers();
  if (!album) return <AlbumTileSkeleton />;
  const total = progress?.total || album.trackCount || 0;
  const owned = progress?.owned ?? ownedProp ?? album.owned ?? 0;
  const done = total > 0 && owned >= total;
  // Le badge « complété » ne se pose pas sur une vraie pochette : il passe sous l'image.
  const real = !!shownCover(album.art, covers);
  const badge = done && <span className="album-tile__badge"><Icon name="disc" size={14} /> {t('collection.completed')}</span>;
  const genre = album.genre ? t(`genre.${album.genre}`) : null;
  const href = to || `/album/${encodeURIComponent(album.id)}`;
  return (
    <Link to={href} onClick={onClick}
      className={`album-tile${done ? ' album-tile--done' : ''}${compact ? ' album-tile--compact' : ''}${className ? ` ${className}` : ''}`}>
      <span className="album-tile__cover">
        <CoverArt art={album.art} sizes={sizes || (compact ? SIZES_COMPACT : SIZES)} />
        {!real && badge}
      </span>
      <span className="album-tile__meta">
        <span className="album-tile__title">{album.title}</span>
        <span className="album-tile__artist">{album.artist}{album.year ? <> · <span className="mono">{album.year}</span></> : null}</span>
        {discover ? (
          <span className="album-tile__info">
            {genre && genre !== `genre.${album.genre}` ? `${genre} · ` : ''}{t('home.tracks', { n: total })}
          </span>
        ) : (
          <span className="album-tile__progress">
            <Progress value={owned} max={total} color={accentOf(album.art?.palette)} size="sm" label={`${album.title} · ${owned}/${total}`} />
            <span className="mono small">{owned}/{total}</span>
            {real && badge}
          </span>
        )}
      </span>
    </Link>
  );
});

export default AlbumTile;
