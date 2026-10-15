// Carte de mention d'un post — chantier P1-A (PLAN.md 8.2 P1.1, design-system-current, components.css .mention) :
// l'album, le morceau, l'artiste ou la liste cités, cliquables vers leur page. Vraie pochette (CoverArt : Deezer, ou
// Spotify si configuré), le visuel généré n'étant qu'un repli (pochette indisponible ou retirée par l'admin) ; rien n'est
// posé sur l'image (la gemme de rareté d'un morceau reste dans le coin, hors de l'illustration, comme en recherche).
// Les fiches viennent du catalogue du site (`catalog` des réponses) ; un élément absent est chargé par lots.
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { useAlbum, useAlbums, useArtist, useTrack } from '../../state/catalog.js';
import CoverArt from '../CoverArt.jsx';
import { RarityGem } from '../Card.jsx';
import { ArtistBadge } from '../search/ArtistBadge.jsx';
import { RatingValue } from '../Rating.jsx';
import { Icon } from '../ui.jsx';
import { itemHref } from './util.js';
import '../../styles/social.css';

/** Libellé traduit, ou null quand la clé n'existe pas (genres importés). */
function useLabel() {
  const { t } = useI18n();
  return (key) => {
    const v = t(key);
    return typeof v === 'string' && v !== key ? v : null;
  };
}

function Frame({ to, kind, size, children, label }) {
  const cls = `mention mention--${kind}${size === 'sm' ? ' mention--sm' : ''}`;
  return to
    ? <Link to={to} className={cls} aria-label={label} data-mention={kind}>{children}<span className="mention__go" aria-hidden="true"><Icon name="chevron" size={18} /></span></Link>
    : <div className={cls}>{children}</div>;
}

function Placeholder({ kind, size }) {
  const { t } = useI18n();
  return (
    <div className={`mention mention--${kind}${size === 'sm' ? ' mention--sm' : ''}`} aria-busy="true">
      <span className="mention__cover" />
      <span className="mention__body"><span className="mention__title muted">{t('common.loading')}</span></span>
    </div>
  );
}

function AlbumMention({ id, stats, size }) {
  const { t } = useI18n();
  const label = useLabel();
  const album = useAlbum(id);
  if (!album) return <Placeholder kind="album" size={size} />;
  const eyebrow = [t('mention.album'), album.genre && label(`genre.${album.genre}`), album.year].filter(Boolean).join(' · ');
  return (
    <Frame to={itemHref('album', album.id)} kind="album" size={size} label={`${album.title} · ${album.artist}`}>
      <span className="mention__cover"><CoverArt art={{ ...album.art, seed: album.art?.seed || album.id }} sizes="72px" /></span>
      <span className="mention__body">
        <span className="eyebrow">{eyebrow}</span>
        <span className="mention__title">{album.title}</span>
        {album.artist && <span className="mention__artist">{album.artist}</span>}
        {stats?.count > 0 && (
          <span className="mention__line">
            <RatingValue value={stats.average} average size={14} />
            <span>{t('mention.ratings', { n: stats.count })}</span>
          </span>
        )}
      </span>
    </Frame>
  );
}

function TrackMention({ id, stats, size }) {
  const { t } = useI18n();
  const track = useTrack(id);
  if (!track) return <Placeholder kind="track" size={size} />;
  const eyebrow = [t('mention.track'), track.album].filter(Boolean).join(' · ');
  const rarity = track.rarity;
  return (
    <Frame to={itemHref('track', track.id)} kind="track" size={size} label={`${track.title} · ${track.artist}`}>
      <span className={`mention__cover${rarity === 'legendary' ? ' is-gold' : ''}`}>
        <CoverArt art={{ ...track.art, seed: track.art?.seed || track.albumId || track.id }} sizes="56px" />
        {rarity && <RarityGem rarity={rarity} size={12} />}
      </span>
      <span className="mention__body">
        <span className="eyebrow">{eyebrow}</span>
        <span className="mention__title">{track.title}</span>
        <span className="mention__line">
          {rarity && <span className="chip chip--sm chip--rarity" style={{ '--rc': `var(--r-${rarity})` }}>{t(`rarity.${rarity}`)}</span>}
          {track.artist && <span>{track.artist}</span>}
          {stats?.count > 0 && <RatingValue value={stats.average} average size={13} />}
        </span>
      </span>
    </Frame>
  );
}

function ArtistMention({ id, size }) {
  const { t } = useI18n();
  const label = useLabel();
  const artist = useArtist(id);
  if (!artist) return <Placeholder kind="artist" size={size} />;
  const eyebrow = [t('mention.artist'), artist.genre && label(`genre.${artist.genre}`)].filter(Boolean).join(' · ');
  return (
    <Frame to={itemHref('artist', artist.id)} kind="artist" size={size} label={artist.name}>
      <span className="mention__cover"><ArtistBadge artist={artist} size={size === 'sm' ? 48 : 72} /></span>
      <span className="mention__body">
        <span className="eyebrow">{eyebrow}</span>
        <span className="mention__title">{artist.name}</span>
        {artist.albumCount > 0 && <span className="mention__line"><span>{t('mention.albums', { n: artist.albumCount })}</span></span>}
      </span>
    </Frame>
  );
}

/** Liste citée (ListSummary) : quatre pochettes de ses albums, titre, auteur, nombre d'éléments. */
function ListMention({ list, size }) {
  const { t } = useI18n();
  const ids = list?.coverAlbumIds || [];
  const albums = useAlbums(ids);
  if (!list) return <div className="mention mention--missing">{t('mention.unavailable')}</div>;
  return (
    <Frame to={itemHref('list', list.id)} kind="list" size={size} label={list.title}>
      <span className="mention__cover">
        {albums.filter(Boolean).slice(0, 4).map((a) => <CoverArt key={a.id} art={{ ...a.art, seed: a.art?.seed || a.id }} sizes="36px" />)}
      </span>
      <span className="mention__body">
        <span className="eyebrow">{[t('mention.list'), t('mention.items', { n: list.itemCount || 0 })].join(' · ')}</span>
        <span className="mention__title">{list.title}</span>
        {list.user && <span className="mention__artist">{t('mention.by', { name: list.user.username })}</span>}
      </span>
    </Frame>
  );
}

/**
 * Carte de mention. `item` = { type: 'album' | 'track' | 'artist', id } ; `list` = ListSummary (type 'list') ;
 * `stats` = { average, count } (moyenne de l'élément, fournie par le post) ; `size` = 'md' | 'sm'.
 */
export function MentionCard({ item, list, stats, size = 'md' }) {
  const { t } = useI18n();
  if (list || item?.type === 'list') return <ListMention list={list} size={size} />;
  if (!item?.id) return null;
  if (item.type === 'album') return <AlbumMention id={item.id} stats={stats} size={size} />;
  if (item.type === 'track') return <TrackMention id={item.id} stats={stats} size={size} />;
  if (item.type === 'artist') return <ArtistMention id={item.id} size={size} />;
  return <div className="mention mention--missing">{t('mention.unavailable')}</div>;
}

export default MentionCard;
