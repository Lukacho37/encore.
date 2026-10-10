// Lignes de résultats de la recherche globale — chantier P0-E (design-system-current §4.1).
// Partagées par la liste déroulante (SearchCombobox), la feuille plein écran du téléphone et la page /search :
// vignette (pochette de l'album, de l'album du morceau, pastille d'artiste, avatar, pochettes empilées d'une liste),
// titre avec la partie tapée soulignée (<mark class="hl">), seconde ligne qui commence par le type, et à droite la
// progression de l'album, les exemplaires du morceau, « Maître », « Ami » ou les j'aime d'une liste.
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { getAlbum, getArtist, getTrack, useAlbum } from '../../state/catalog.js';
import { highlightParts, SEARCH_KINDS } from '@shared/search.js';
import { accentOf } from '../AlbumTile.jsx';
import CoverArt from '../CoverArt.jsx';
import { RarityGem } from '../Card.jsx';
import { Avatar, Icon, Progress } from '../ui.jsx';
import { ArtistBadge } from './ArtistBadge.jsx';

/** Texte avec les débuts de mots tapés soulignés. */
export function Highlight({ text, query }) {
  const parts = useMemo(() => highlightParts(text, query), [text, query]);
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i} className="hl">{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** Petite horloge (recherches récentes), au trait des icônes du site. */
export function ClockIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

/** Nombre affiché d'un compteur plafonné à 100 par le serveur. */
export const countLabel = (n) => (n >= 100 ? '99+' : String(n || 0));

/**
 * Options d'une réponse de suggestions, dans l'ordre d'affichage des groupes : { key, kind, id, item, typo, pick }.
 * `pick` est le résultat transmis à onPick ({ kind, id } ; membre : id = pseudo, userId en plus).
 * Les références du catalogue viennent de la réponse (`catalog`), sinon du catalogue déjà connu du site.
 */
export function optionsOf(data, kinds = SEARCH_KINDS) {
  if (!data?.groups) return [];
  const lookup = lookupOf(data);
  const out = [];
  for (const kind of kinds) {
    for (const row of data.groups[kind] || []) {
      const option = optionFor(kind, row, lookup);
      if (option) out.push(option);
    }
  }
  return out;
}

/** Références du catalogue d'une réponse (albums, morceaux, artistes) et progression du joueur. */
export function lookupOf(data) {
  return {
    albums: new Map((data?.catalog?.albums || []).map((a) => [a.id, a])),
    tracks: new Map((data?.catalog?.tracks || []).map((t) => [t.id, t])),
    artists: new Map((data?.catalog?.artists || []).map((a) => [a.id, a])),
    progress: data?.progress || {},
  };
}

/** Option d'une ligne de résultat ({ id, typo } pour le catalogue, l'objet complet pour un membre ou une liste). */
export function optionFor(kind, row, lookup = {}) {
  let item = row;
  if (kind === 'album') item = lookup.albums?.get(row.id) || getAlbum(row.id);
  else if (kind === 'track') item = lookup.tracks?.get(row.id) || getTrack(row.id);
  else if (kind === 'artist') item = lookup.artists?.get(row.id) || getArtist(row.id);
  if (!item) return null;
  const pick = kind === 'user' ? { kind, id: item.username, userId: item.id } : { kind, id: item.id };
  return { key: `${kind}:${item.id}`, kind, id: item.id, item, typo: !!row.typo, pick, progress: lookup.progress?.[item.id] };
}

/** Entrée « recherches récentes » d'un résultat ouvert (titre et seconde ligne gardés pour l'afficher sans requête). */
export function recentEntryOf(option, t) {
  const { kind, item } = option;
  const base = { kind, id: option.pick.id };
  if (kind === 'album') return { ...base, title: item.title, sub: [item.artist, item.year].filter(Boolean).join(' · '), albumId: item.id };
  if (kind === 'track') return { ...base, title: item.title, sub: [item.artist, item.album].filter(Boolean).join(' · '), albumId: item.albumId || null, trackId: item.id };
  if (kind === 'artist') return { ...base, title: item.name, sub: t('search.kind.artist') };
  if (kind === 'user') return { ...base, title: item.username, sub: t('search.kind.user'), user: { id: item.id, username: item.username, avatar: item.avatar, avatarColor: item.avatarColor } };
  if (kind === 'list') return { ...base, title: item.title, sub: t('search.kind.list'), albumId: item.coverAlbumId || null };
  return null;
}

// ----- vignettes -----

function AlbumThumb({ albumId, art, size, className = '' }) {
  const known = useAlbum(art ? null : albumId);
  const visual = art || known?.art;
  return (
    <span className={`gsearch__thumb ${className}`}>
      {visual ? <CoverArt art={{ ...visual, seed: visual.seed || albumId }} sizes={`${size}px`} /> : <Icon name="disc" size={size * 0.5} />}
    </span>
  );
}

export function Thumb({ option, size = 40 }) {
  const { owned } = useGame();
  const { kind, item } = option;
  if (kind === 'album') return <AlbumThumb albumId={item.id} art={item.art} size={size} />;
  if (kind === 'track') {
    const mine = owned?.get(item.id);
    return (
      <span className="gsearch__thumb">
        <CoverArt art={item.art} sizes={`${size}px`} />
        {mine && <RarityGem rarity={item.rarity} size={Math.round(size * 0.3)} />}
      </span>
    );
  }
  if (kind === 'artist') return <span className="gsearch__thumb gsearch__thumb--round"><ArtistBadge artist={item} size={size} /></span>;
  if (kind === 'user') return <span className="gsearch__thumb gsearch__thumb--round gs-thumb--avatar"><Avatar user={item} size={size} /></span>;
  if (kind === 'list') {
    const covers = (item.coverAlbumIds || []).slice(0, 3);
    return (
      <span className="stack-thumb" style={{ '--gs-stack': `${size}px` }}>
        {covers.length ? covers.map((id) => <StackCover key={id} albumId={id} />) : <span className="gs-stack-empty"><Icon name="list" size={16} /></span>}
      </span>
    );
  }
  return <span className="gsearch__thumb" />;
}

function StackCover({ albumId }) {
  const album = useAlbum(albumId);
  return <span>{album?.art ? <CoverArt art={album.art} sizes="32px" /> : null}</span>;
}

// ----- lignes -----

/** Seconde ligne : le type d'abord, puis les données (artiste, année, album…), surlignées elles aussi. */
function SubLine({ option, query }) {
  const { t, num } = useI18n();
  const { kind, item } = option;
  const genre = (id) => {
    const label = id ? t(`genre.${id}`) : null;
    return label && label !== `genre.${id}` ? label : id;
  };
  const parts = [t(`search.kind.${kind}`)];
  if (kind === 'album') parts.push(<Highlight key="a" text={item.artist} query={query} />, item.year && <span key="y" className="mono">{item.year}</span>);
  if (kind === 'track') parts.push(<Highlight key="a" text={item.artist} query={query} />, item.album && <Highlight key="al" text={item.album} query={query} />);
  if (kind === 'artist') parts.push(item.genre && genre(item.genre), item.albumCount ? t('search.albums', { n: item.albumCount }) : null);
  if (kind === 'user') parts.push(t('search.level', { n: item.level }), item.uniqueCards ? t('search.cards', { n: num(item.uniqueCards) }) : null);
  if (kind === 'list') parts.push(<span key="by">{t('search.by')} <Highlight text={`@${item.user?.username || ''}`} query={query} /></span>, t('search.items', { n: item.itemCount || 0 }));
  const shown = parts.filter(Boolean);
  return (
    <span className="gsearch__sub">
      {shown.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>)}
    </span>
  );
}

/** Partie droite : progression, exemplaires, « Maître », relation, j'aime. */
function Meta({ option }) {
  const { t } = useI18n();
  const { owned, achievements, albumProgress } = useGame();
  const { kind, item } = option;
  if (kind === 'album') {
    const p = option.progress || albumProgress?.(item.id, item.trackCount);
    const have = p?.owned || 0;
    const total = p?.total || item.trackCount || 0;
    if (!have) return <span className="gsearch__meta gs-meta--quiet">{t('search.notStarted')}</span>;
    return (
      <span className="gsearch__meta">
        <span className="gs-meta__bar"><Progress value={have} max={total} color={accentOf(item.art?.palette)} size="xs" label={`${have}/${total}`} /></span>
        <span className="mono">{have}/{total}</span>
      </span>
    );
  }
  if (kind === 'track') {
    const mine = owned?.get(item.id);
    const n = mine ? (mine.std || 0) + (mine.holo || 0) : 0;
    return n
      ? <span className="gsearch__meta"><span className="chip chip--sm chip--ok mono">×{n}</span></span>
      : <span className="gsearch__meta gs-meta--quiet">{t('search.missing')}</span>;
  }
  if (kind === 'artist') {
    return achievements?.has(`artist:${item.id}`)
      ? <span className="gsearch__meta"><span className="chip chip--sm chip--gold"><Icon name="star" size={12} /> {t('search.master')}</span></span>
      : null;
  }
  if (kind === 'user') {
    if (item.relation === 'friend') return <span className="gsearch__meta"><span className="chip chip--sm chip--cue">{t('search.friend')}</span></span>;
    if (item.relation === 'self') return <span className="gsearch__meta gs-meta--quiet">{t('search.you')}</span>;
    return null;
  }
  if (kind === 'list') {
    return <span className="gsearch__meta"><Icon name="heart" size={15} /> <span className="mono">{item.likeCount || 0}</span></span>;
  }
  return null;
}

/** Titre d'une option (nom de l'artiste, pseudo du membre…). */
export const titleOf = (option) => {
  const { kind, item } = option;
  if (kind === 'artist') return item.name;
  if (kind === 'user') return item.username;
  return item.title;
};

/** Contenu d'une ligne (vignette, textes, partie droite), dans une option de liste ou un lien de la page /search. */
export function RowBody({ option, query, size = 40 }) {
  const { t } = useI18n();
  return (
    <>
      <Thumb option={option} size={size} />
      <span className="gsearch__text">
        <span className="gsearch__title">
          {option.typo && <span className="gs-approx" title={t('search.approx')} aria-label={t('search.approx')}>≈ </span>}
          <Highlight text={titleOf(option)} query={query} />
        </span>
        <SubLine option={option} query={query} />
      </span>
      <Meta option={option} />
    </>
  );
}

/** Ligne de la page de résultats : un lien vers l'album, le morceau, l'artiste, le membre ou la liste. */
export function ResultLink({ option, query, to, onClick }) {
  return (
    <Link to={to} className="gsearch__opt gs-row" onClick={onClick}>
      <RowBody option={option} query={query} size={48} />
    </Link>
  );
}

/** Vignette et textes d'une recherche récente (requête ou résultat déjà ouvert). */
export function RecentBody({ entry, size = 40 }) {
  if (entry.kind === 'query') {
    return (
      <>
        <span className="gsearch__thumb gs-thumb--icon"><ClockIcon /></span>
        <span className="gsearch__text"><span className="gsearch__title">{entry.q}</span></span>
        <span className="gsearch__meta gs-meta--quiet"><Icon name="search" size={15} /></span>
      </>
    );
  }
  let thumb;
  if (entry.kind === 'artist') thumb = <span className="gsearch__thumb gsearch__thumb--round"><ArtistBadge artist={{ id: entry.id, name: entry.title }} size={size} /></span>;
  else if (entry.kind === 'user') thumb = <span className="gsearch__thumb gsearch__thumb--round gs-thumb--avatar"><Avatar user={entry.user || { username: entry.title }} size={size} /></span>;
  else if (entry.albumId) thumb = <AlbumThumb albumId={entry.albumId} size={size} />;
  else thumb = <span className="gsearch__thumb gs-thumb--icon"><ClockIcon /></span>;
  return (
    <>
      {thumb}
      <span className="gsearch__text">
        <span className="gsearch__title">{entry.title}</span>
        {entry.sub && <span className="gsearch__sub">{entry.sub}</span>}
      </span>
      <span className="gsearch__meta gs-meta--quiet"><ClockIcon size={15} /></span>
    </>
  );
}
