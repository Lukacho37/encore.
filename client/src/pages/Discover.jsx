// Découvrir personnalisé — chantier P1-E (PLAN.md 2.5, 5.5), reconstruit sur le hub P0 (P0-D).
// GET /api/discover → { sections, tiles, progress, catalog } : jusqu'à 8 sections d'albums choisis pour le joueur,
// chacune avec sa raison en une ligne (« Parce que tu as aimé Discovery », « Très apprécié par tes amis » avec leurs
// avatars…), « Voir plus » par curseur (GET /api/discover/:sectionId?cursor=). Au-dessus : les tuiles Battles ·
// Classements · Listes · Mes 9 albums · Blind test ; un compte qui n'a pas encore fait ses premiers pas est invité à
// créer son profil musical (/welcome). En dessous, ce que le hub P0 offrait déjà : la recherche et les chips Par genre
// et Par décennie (vers la collection filtrée). Mêmes composants que le reste du site : .page-head, .panel,
// .panel--bt, .chip, vignettes d'album (AlbumTile) en étagère.
import { Link } from 'react-router';
import { useI18n } from '../i18n/index.jsx';
import { useGame } from '../state/GameContext.jsx';
import { useAlbum, useApi, useArtist, useCatalogInfo } from '../state/catalog.js';
import { Icon } from '../components/ui.jsx';
import { AlbumTileSkeleton } from '../components/AlbumTile.jsx';
import { EmptyState, ErrorBox } from '../components/feedback.jsx';
import { SearchBox } from '../components/shell/SearchBox.jsx';
import { Shelf } from '../components/discover/Shelf.jsx';
import { decadeLabel, genreName } from '../components/match/parts.jsx';
import '../styles/home.css';
import '../styles/discover.css';

const enc = encodeURIComponent;
const TILE_ICONS = { battles: 'trophy', rankings: 'star', lists: 'list', nine: 'grid', blindtest: 'headphones' };
const DEFAULT_TILES = [
  { id: 'battles', to: '/battles' },
  { id: 'rankings', to: '/rankings' },
  { id: 'lists', to: '/lists' },
  { id: 'nine', to: '/nine' },
  { id: 'blindtest', to: '/blindtest' },
];
const MARK = '\u0000';

/** Texte traduit dont la variable `name` est remplacée par un nœud React (un lien dans un titre). */
function withNode(t, key, name, node, vars = {}) {
  const [before, after = ''] = t(key, { ...vars, [name]: MARK }).split(MARK);
  return <>{before}{node}{after}</>;
}

/** Titre d'une section : album, artiste, décennie ou genre de la section quand il y en a un. */
function SectionTitle({ section }) {
  const { t } = useI18n();
  const v = section.titleVars || {};
  const album = useAlbum(v.albumId || null);
  const artist = useArtist(v.artistId || null);
  if (v.albumId) {
    const node = <Link to={`/album/${enc(v.albumId)}`}>{album?.title || '…'}</Link>;
    return withNode(t, section.titleKey, 'album', node);
  }
  if (v.artistId) {
    const node = <Link to={`/artist/${enc(v.artistId)}`}>{artist?.name || '…'}</Link>;
    return withNode(t, section.titleKey, 'artist', node);
  }
  if (v.decade) return t(section.titleKey, { decade: decadeLabel(t, v.decade) });
  if (v.genre) return t(section.titleKey, { genre: genreName(t, v.genre) });
  return t(section.titleKey);
}

/** Tuiles Battles · Classements · Listes · Mes 9 albums · Blind test. */
function Tiles({ tiles }) {
  const { t } = useI18n();
  return (
    <nav className="dc-tiles" aria-label={t('discover.tilesLabel')}>
      {tiles.map((tile) => {
        const bt = tile.id === 'blindtest';
        return (
          <Link key={tile.id} to={tile.to} className={`panel dc-tile${bt ? ' panel--bt' : ''}`} data-tile={tile.id}>
            {bt && <span className="panel--bt__eq" aria-hidden="true"><i /><i /><i /><i /><i /></span>}
            <span className="dc-tile__icon" aria-hidden="true"><Icon name={TILE_ICONS[tile.id] || 'compass'} size={18} /></span>
            <span className="dc-tile__title">
              <span>{t(`discover.tiles.${tile.id}.title`)}</span>
              {tile.id === 'nine' && tile.count > 0 && <span className="chip chip--sm chip--mono">{t('discover.tiles.nine.count', { n: tile.count })}</span>}
            </span>
            <p className="dc-tile__body">{t(`discover.tiles.${tile.id}.body`)}</p>
          </Link>
        );
      })}
    </nav>
  );
}

/** Invitation aux premiers pas (compte qui n'a pas encore choisi ses genres et ses artistes). */
function Invite() {
  const { t } = useI18n();
  return (
    <section className="panel dc-invite" data-discover="invite" aria-labelledby="dc-discover-invite">
      <span className="eyebrow">{t('discover.invite.eyebrow')}</span>
      <h2 className="panel__title" id="dc-discover-invite">{t('discover.invite.title')}</h2>
      <p>{t('discover.invite.body')}</p>
      <Link to="/welcome" className="btn btn--primary">{t('discover.invite.cta')}</Link>
    </section>
  );
}

/** Étagères en attente de la réponse (même hauteur que les vraies). */
function LoadingShelves() {
  return Array.from({ length: 3 }, (_, i) => (
    <section key={i} className="dc-shelf" aria-hidden="true">
      <span className="skel-row" />
      <div className="dc-shelf__track">
        {Array.from({ length: 6 }, (_, j) => <AlbumTileSkeleton key={j} />)}
      </div>
    </section>
  ));
}

/** Ce que le hub P0 offrait : recherche, genres et décennies (vers la collection filtrée). */
function Browse() {
  const { t, num } = useI18n();
  const info = useCatalogInfo();
  const genres = (info?.genres || []).slice(0, 18);
  const decades = [...(info?.decades || [])].filter((d) => d.albums > 0).reverse();
  return (
    <section className="section dc-browse" aria-labelledby="dc-browse-title">
      <header className="section__head"><h2 id="dc-browse-title">{t('discover.browse')}</h2></header>
      <div className="panel dc-browse__search">
        <h3 className="panel__title"><Icon name="search" /> {t('hub.searchTitle')}</h3>
        <p className="muted">{t('hub.searchBody')}</p>
        <SearchBox />
      </div>
      {genres.length > 0 && (
        <div className="dc-browse__group">
          <h3 className="label">{t('hub.genres')}</h3>
          <div className="dc-chips">
            {genres.map((g) => (
              <Link key={g.id} to={`/collection/albums?genre=${enc(g.id)}`} className="chip chip--toggle">
                {genreName(t, g.id)}
                <span className="chip__n">{num(g.albums)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {decades.length > 0 && (
        <div className="dc-browse__group">
          <h3 className="label">{t('hub.decades')}</h3>
          <div className="dc-chips">
            {decades.map((d) => (
              <Link key={d.decade} to={`/collection/albums?decade=${d.decade}`} className="chip chip--toggle">
                {t('decade', { d: d.decade })}
                <span className="chip__n">{num(d.albums)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function Discover() {
  const { t } = useI18n();
  const { user } = useGame();
  const { data, error, reload } = useApi('/discover', { keep: false });
  const sections = data?.sections || [];
  const progress = data?.progress || {};
  return (
    <div className="dc-page" data-discover="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">{t('discover.eyebrow')}</p>
          <h1>{t('discover.title')}</h1>
          <p className="muted">{t('discover.intro')}</p>
        </div>
      </header>

      {user?.onboarded === false && <Invite />}
      <Tiles tiles={data?.tiles || DEFAULT_TILES} />

      {error ? (
        <ErrorBox error={error} onRetry={reload} className="section" />
      ) : !data ? (
        <LoadingShelves />
      ) : sections.length ? (
        sections.map((s) => (
          <Shelf
            key={s.id}
            id={s.id}
            title={<SectionTitle section={s} />}
            reason={t(s.reason.key, s.reason.vars || {})}
            users={s.users || []}
            albumIds={s.items.map((x) => x.id)}
            progress={progress}
            morePath={`/discover/${enc(s.id)}`}
            moreCursor={s.moreCursor}
          />
        ))
      ) : (
        <EmptyState icon="compass" title={t('discover.empty')} body={t('discover.emptyBody')} action={{ label: t('home.open'), to: '/' }} className="section" />
      )}

      <Browse />
    </div>
  );
}
