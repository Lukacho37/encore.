// Blocs de la vue d'ensemble du Studio — chantier P1-B (PLAN.md 2.5, 9.2). Registre : un composant par bloc
// (blocks.js, même liste que le serveur), affichés dans l'ordre choisi par le joueur, les blocs masqués en moins.
// Les emplacements des autres chantiers sont montés tels quels (ils dessinent leur propre panneau) :
//   nine → Grid9Block (P1-C) · trophies → TrophyShelf (P1-F) · wishlist → WishlistBlock (P1-D) ·
//   stats → StudioStats (P2-A, rien avant P2) sous la mini-statistique ; activity → FeedItem du fil (P1-A).
// Les autres blocs reprennent l'existant : la vitrine (bureau du Studio, cartes exposées), la vinylthèque avec le
// vinyle mis en avant et la platine, les critiques (Rating.jsx), les listes (ListCard, P1-C), les cartes (Card).
// Studio d'un autre : un bloc vide ne s'affiche pas ; le sien : un état vide avec la prochaine action.
// Mise en page : blocs larges sur toute la ligne, blocs étroits deux par deux à partir de 1020 px (un bloc étroit
// seul entre deux larges prend toute la ligne).
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useGame } from '../../state/GameContext.jsx';
import { useI18n } from '../../i18n/index.jsx';
import { useAlbum, useApi, useArtists } from '../../state/catalog.js';
import { useCursorList } from '../../state/paged.js';
import Card from '../Card.jsx';
import { useCardModal } from '../CardModal.jsx';
import { Icon, Progress } from '../ui.jsx';
import { EmptyState, LoadMore, Skeleton } from '../feedback.jsx';
import { ArtistBadge } from '../search/ArtistBadge.jsx';
import { RatedItemLink, ReviewList } from '../Rating.jsx';
import { EditionTags, TurntableModal, Vinyl, VinylShelf } from '../Vinyl.jsx';
import { frameStyle } from '@shared/cosmetics.js';
import { Grid9Block } from '../lists/Grid9.jsx';
import { ListCard } from '../lists/ListCard.jsx';
import { WishlistBlock } from '../game/WishlistToggle.jsx';
import { TrophyShelf } from '../play/slots.jsx';
import { StudioStats } from '../passport/StudioStats.jsx';
import { FeedItem } from '../social/FeedList.jsx';
import { BLOCK_IDS } from './blocks.js';
import { ReviewHead } from './ReviewHead.jsx';
import '../../styles/studio.css';

const enc = encodeURIComponent;
/** Blocs larges (toute la ligne) ; les autres vont par deux sur grand écran. */
const WIDE = new Set(['nine', 'showcase', 'vinyls', 'wishlist', 'recent', 'activity']);
const SHELF_PREVIEW = 13; // vinyles visibles avant « Voir N vinyles de plus » (3 étagères de 5 avec 2 prochains)
const RECENT_MAX = 12;

/** Adresse d'un onglet du Studio (`/studio/<onglet>` pour soi depuis /studio, `/u/<pseudo>/<onglet>` sinon). */
export const tabPath = (base, tab) => (tab && tab !== 'overview' ? `${base}/${tab}` : base);

/** Panneau d'un bloc : titre (icône + texte), lien à droite facultatif. */
function BlockPanel({ id, icon, title, link, className = '', children }) {
  const headId = `st-block-${id}`;
  return (
    <section className={`panel st-panel ${className}`} aria-labelledby={headId}>
      <header className="st-panel__head">
        <h2 className="panel__title" id={headId}>{icon && <Icon name={icon} />} {title}</h2>
        {link}
      </header>
      {children}
    </section>
  );
}

// ----- vitrine -------------------------------------------------------------------------------------------

/** Bureau du Studio (cartes exposées), comme avant ; le cadre cosmétique décore l'extérieur des cartes. */
export function ShowcaseBlock({ profile, isSelf, onPickSlot, onRemoveSlot }) {
  const { t } = useI18n();
  const openCard = useCardModal();
  const { user } = useGame();
  const slots = Math.max(isSelf ? user?.slots?.showcase ?? 6 : 6, profile.showcase?.length || 0);
  const showcase = Array.from({ length: slots }, (_, i) => profile.showcase?.[i] || null);
  const frame = isSelf ? user?.cosmetics?.frame : profile.user?.frame;
  if (!isSelf && !showcase.some(Boolean)) return null;
  return (
    <section className={`studio st-showcase st-showcase--slots-${Math.min(8, slots)}${frame ? ` st-showcase--frame-${frame} ws-showcase-frame--${frameStyle(frame) || 'other'}` : ''}`} aria-labelledby="st-block-showcase">
      <div className="studio__desk">
        <div className="studio__desk-head">
          <h2 className="studio__label" id="st-block-showcase">{isSelf ? t('studio.selection') : t('studio.selectionOther')}</h2>
          {isSelf && <p className="small muted">{t('studio.selectionHint', { n: slots })}</p>}
        </div>
        <div className="showcase st-showcase__grid">
          {showcase.map((item, i) => (
            item ? (
              <div key={i} className="showcase__slot">
                <Card trackId={item.trackId} variant={item.variant} onClick={() => openCard(item.trackId)} />
                {isSelf && <button type="button" className="showcase__remove" onClick={() => onRemoveSlot?.(i)} aria-label={t('studio.remove')}><Icon name="close" size={14} /></button>}
              </div>
            ) : isSelf ? (
              <button key={i} type="button" className="showcase__empty" onClick={() => onPickSlot?.(i)}>
                <Icon name="plus" size={22} />
                <span>{t('studio.add')}</span>
              </button>
            ) : (
              <div key={i} className="showcase__empty showcase__empty--static"><span>{t('studio.empty')}</span></div>
            )
          ))}
        </div>
      </div>
    </section>
  );
}

// ----- vinylthèque ---------------------------------------------------------------------------------------

/** Vinyle mis en avant : la pochette avec son disque, la date, le Pressage n°, la platine au clic. */
function FeaturedVinyl({ vinyl, isSelf, name, onEdit }) {
  const { t, date } = useI18n();
  const { user, ranks } = useGame();
  const [open, setOpen] = useState(null);
  const color = vinyl.color ?? (isSelf ? user?.cosmetics?.vinyl ?? null : null);
  const rank = vinyl.rank ?? (isSelf ? ranks?.get(`album:${vinyl.albumId}`) ?? null : null);
  const play = () => setOpen({ ...vinyl, color, rank, mine: isSelf });
  return (
    <div className="st-featured" data-featured-vinyl={vinyl.albumId}>
      <div className="st-featured__vinyl">
        <Vinyl albumId={vinyl.albumId} edition={vinyl.edition} color={color} pressing={rank} onClick={play} label={t('studio.featured.play')}
          sizes="(max-width: 640px) 180px, 220px" />
      </div>
      <FeaturedText vinyl={vinyl} rank={rank} title={isSelf ? t('studio.featured.title') : t('studio.featured.titleOther', { name })}
        date={date} onPlay={play} onEdit={isSelf ? onEdit : null} />
      <TurntableModal vinyl={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function FeaturedText({ vinyl, rank, title, date, onPlay, onEdit }) {
  const { t } = useI18n();
  const album = useAlbum(vinyl.albumId);
  return (
    <div className="st-featured__text">
      <span className="eyebrow">{title}</span>
      <Link to={`/album/${enc(vinyl.albumId)}`} className="st-featured__title">{album?.title || '…'}</Link>
      <span className="st-featured__artist">{album?.artist || ''}</span>
      <span className="st-featured__facts small muted">
        {vinyl.at ? <span>{t('studio.featured.pressed', { date: date(vinyl.at) })}</span> : null}
        {rank ? <span className="mono">{t('studio.featured.pressing', { n: rank })}</span> : null}
        <EditionTags edition={vinyl.edition} holo={vinyl.holo} />
      </span>
      <span className="st-featured__actions">
        <button type="button" className="btn btn--primary btn--sm" onClick={onPlay}><Icon name="disc" size={16} /> {t('studio.featured.play')}</button>
        {onEdit && <button type="button" className="btn btn--ghost btn--sm" onClick={() => onEdit('spotlight')}>{t('studio.featured.choose')}</button>}
      </span>
    </div>
  );
}

/** Vinylthèque : vinyle mis en avant (choisi, sinon le plus récent) puis l'étagère (13 vinyles, puis tous ceux reçus). */
export function VinylsBlock({ profile, isSelf, base, onEdit }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const all = profile.vinyls || [];
  const count = Math.max(all.length, profile.vinylCount ?? 0);
  const featured = profile.featuredVinyl || all[all.length - 1] || null;
  const foldable = all.length > SHELF_PREVIEW;
  const vinyls = foldable && !open ? all.slice(-SHELF_PREVIEW) : all;
  const upcoming = (profile.upcoming || []).slice(0, all.length ? 2 : 3);
  if (!isSelf && !all.length) return null;
  return (
    <div className="st-vinyls">
      {featured && <FeaturedVinyl vinyl={featured} isSelf={isSelf} name={profile.username} onEdit={onEdit} />}
      <VinylShelf
        vinyls={vinyls}
        count={count}
        upcoming={upcoming}
        mine={isSelf}
        color={isSelf ? undefined : profile.cosmetics?.vinyl ?? null}
        title={isSelf ? t('vinyl.shelf') : t('vinyl.shelfOther', { name: profile.username })}
        emptyText={isSelf ? t('vinyl.emptySelf') : t('vinyl.emptyOther')}
      />
      {(foldable || count > all.length) && (
        <div className="pf-shelf-foot">
          {foldable && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(!open)} aria-expanded={open}>
              <Icon name={open ? 'close' : 'plus'} size={16} />
              {open ? t('profile.shelfLess') : t('profile.shelfMore', { n: all.length - SHELF_PREVIEW })}
            </button>
          )}
          {count > all.length && (
            <Link to={tabPath(base, 'vinyls')} className="section__link">{t('studio.vinylsTab.count', { n: count })}</Link>
          )}
        </div>
      )}
    </div>
  );
}

// ----- favoris -------------------------------------------------------------------------------------------

export function ArtistsBlock({ profile, isSelf, onEdit }) {
  const { t } = useI18n();
  const ids = profile.favorites?.artists || [];
  const genres = profile.favorites?.genres || [];
  const artists = useArtists(ids);
  if (!isSelf && !ids.length && !genres.length) return null;
  return (
    <BlockPanel id="artists" icon="star" title={t('studio.blocks.artists')}
      link={isSelf && (ids.length > 0 || genres.length > 0) ? <button type="button" className="section__link st-linkbtn" onClick={() => onEdit('favorites')}>{t('studio.favorites.choose')}</button> : null}>
      {ids.length > 0 && (
        <ul className="st-artists">
          {ids.map((id, i) => (
            <li key={id}>
              <Link to={`/artist/${enc(id)}`} className="st-artists__item">
                <ArtistBadge artist={artists[i] || { id, name: '?' }} size={56} />
                <span className="st-artists__name">{artists[i]?.name || '…'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {genres.length > 0 && (
        <div className="st-genres">
          <span className="small muted">{t('studio.favorites.genres')}</span>
          <div className="chips">
            {genres.map((g) => <Link key={g} to={`/collection/albums?genre=${enc(g)}`} className="chip chip--quiet">{t(`genre.${g}`)}</Link>)}
          </div>
        </div>
      )}
      {!ids.length && !genres.length && (
        <EmptyState icon="star" body={t('studio.favorites.artistsEmpty')} action={{ label: t('studio.favorites.choose'), onClick: () => onEdit('favorites'), primary: false }} />
      )}
    </BlockPanel>
  );
}

export function TracksBlock({ profile, isSelf, onEdit }) {
  const { t } = useI18n();
  const ids = profile.favorites?.tracks || [];
  if (!isSelf && !ids.length) return null;
  return (
    <BlockPanel id="tracks" icon="headphones" title={t('studio.blocks.tracks')}
      link={isSelf && ids.length > 0 ? <button type="button" className="section__link st-linkbtn" onClick={() => onEdit('favorites')}>{t('studio.favorites.choose')}</button> : null}>
      {ids.length ? (
        <ol className="top-tracks st-tracks">
          {ids.map((id) => (
            <li key={id}>
              <RatedItemLink type="track" id={id} className="top-tracks__item" coverClassName="top-tracks__cover" titleClassName="top-tracks__title" />
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState icon="headphones" body={t('studio.favorites.tracksEmpty')} action={{ label: t('studio.favorites.choose'), onClick: () => onEdit('favorites'), primary: false }} />
      )}
    </BlockPanel>
  );
}

// ----- critiques, listes, cartes, activité ---------------------------------------------------------------------

export function ReviewsBlock({ profile, isSelf, base }) {
  const { t } = useI18n();
  const { data } = useApi(`/users/${enc(profile.username)}/ratings`, { keep: false });
  const reviews = (data?.reviews || []).slice(0, 3);
  if (!isSelf && data && !reviews.length) return null;
  return (
    <BlockPanel id="reviews" icon="quote" title={t('studio.blocks.reviews')}
      link={reviews.length ? <Link to={tabPath(base, 'reviews')} className="section__link">{t('studio.reviewsBlock.all')}</Link> : null}>
      {!data ? (
        <div className="rows" aria-busy="true"><Skeleton kind="row" count={2} /></div>
      ) : reviews.length ? (
        <ReviewList reviews={reviews} renderItem={(r) => <ReviewHead review={r} isSelf={isSelf} />} />
      ) : (
        <EmptyState icon="quote" body={t('studio.reviewsBlock.emptySelf')} action={{ label: t('studio.reviewsBlock.action'), to: '/collection', primary: false }} />
      )}
    </BlockPanel>
  );
}

export function ListsBlock({ profile, isSelf, base, onEdit }) {
  const { t } = useI18n();
  const lists = profile.featuredLists || [];
  if (!isSelf && !lists.length) return null;
  return (
    <BlockPanel id="lists" icon="list" title={t('studio.blocks.lists')}
      link={<Link to={tabPath(base, 'lists')} className="section__link">{isSelf ? t('studio.listsBlock.allSelf') : t('studio.listsBlock.all')}</Link>}>
      {lists.length ? (
        <div className="st-lists">{lists.map((l) => <ListCard key={l.id} list={l} />)}</div>
      ) : (
        <EmptyState icon="list" body={t('studio.listsBlock.emptySelf')} action={{ label: t('studio.listsBlock.pin'), onClick: () => onEdit('spotlight'), primary: false }} />
      )}
    </BlockPanel>
  );
}

/** Derniers morceaux obtenus : les siens depuis l'état du jeu (à jour après un booster), ceux d'un autre depuis le Studio. */
export function RecentBlock({ profile, isSelf }) {
  const { t } = useI18n();
  const { cards } = useGame();
  const openCard = useCardModal();
  const mine = useMemo(() => {
    if (!isSelf) return null;
    const byTrack = new Map();
    for (const c of [...(cards || [])].sort((a, b) => (b.at || 0) - (a.at || 0))) {
      const prev = byTrack.get(c.t);
      if (!prev) byTrack.set(c.t, { trackId: c.t, variant: c.v, at: c.at });
      else if (c.v === 'holo') prev.variant = 'holo';
      if (byTrack.size >= RECENT_MAX && !prev) break;
    }
    return [...byTrack.values()].slice(0, RECENT_MAX);
  }, [isSelf, cards]);
  const recent = isSelf ? mine : profile.recent || [];
  if (!isSelf && !recent.length) return null;
  return (
    <BlockPanel id="recent" icon="pack" title={t('studio.blocks.recent')}>
      {recent.length ? (
        <div className="card-row st-recent">
          {recent.map((c) => <Card key={c.trackId} trackId={c.trackId} variant={c.variant} onClick={() => openCard(c.trackId)} />)}
        </div>
      ) : (
        <EmptyState icon="pack" body={t('studio.recentBlock.emptySelf')} action={{ label: t('studio.recentBlock.open'), to: '/' }} />
      )}
    </BlockPanel>
  );
}

export function ActivityBlock({ profile, isSelf }) {
  const { t } = useI18n();
  const feed = useCursorList(`/users/${enc(profile.username)}/activity`, { limit: 5 });
  if (!isSelf && !feed.loading && !feed.items.length) return null;
  return (
    <BlockPanel id="activity" icon="compass" title={t('studio.blocks.activity')}>
      {feed.loading && !feed.items.length ? (
        <div className="rows" aria-busy="true"><Skeleton kind="row" count={2} /></div>
      ) : feed.items.length ? (
        <>
          <ul className="st-activity">
            {feed.items.map((item) => (
              <li key={`${item.verb}:${item.id}`}>
                <FeedItem item={item} onChange={(next) => feed.update(item.id, () => next)} onRemove={() => feed.remove(item.id)} />
              </li>
            ))}
          </ul>
          <LoadMore hasMore={feed.hasMore} loading={feed.loading} onClick={feed.loadMore} error={feed.error} label={t('studio.activityBlock.more')} />
        </>
      ) : (
        <EmptyState icon="compass" body={t('studio.activityBlock.emptySelf')} />
      )}
    </BlockPanel>
  );
}

/** Mini-statistiques (barres de progression de la collection), puis le bloc du passeport (P2-A, rien avant P2). */
export function StatsBlock({ profile, isSelf }) {
  const { t, num } = useI18n();
  const s = profile.stats || {};
  const rows = [
    { id: 'cards', value: s.unique, total: s.total, color: 'var(--cue)' },
    { id: 'albums', value: s.albumsCompleted, total: s.albumsTotal, color: 'var(--gold)' },
    { id: 'artists', value: s.artistsMastered, total: s.artistsTotal, color: 'var(--r-super)' },
    { id: 'promos', value: s.promos, total: s.promosTotal, color: 'var(--r-promo)' },
  ];
  return (
    <BlockPanel id="stats" icon="grid" title={t('studio.blocks.stats')}
      link={isSelf ? <Link to="/collection" className="section__link">{t('studio.statsBlock.collection')}</Link> : null}>
      <dl className="st-stats">
        {rows.map((r) => (
          <div key={r.id} className="st-stats__row">
            <dt>{t(`studio.statsBlock.${r.id}`)}</dt>
            <dd>
              <Progress value={r.value || 0} max={r.total || 0} color={r.color} size="sm" label={t(`studio.statsBlock.${r.id}`)} />
              <span className="mono">{num(r.value ?? 0)}<small>/{num(r.total ?? 0)}</small></span>
            </dd>
          </div>
        ))}
      </dl>
      <StudioStats username={profile.username} />
    </BlockPanel>
  );
}

// ----- registre ------------------------------------------------------------------------------------------

/** Un composant par bloc ; les emplacements des autres chantiers gardent leurs props de contrat. */
const REGISTRY = {
  nine: ({ profile, isSelf }) => <div className="st-nine"><Grid9Block username={profile.username} editable={isSelf} /></div>,
  showcase: ShowcaseBlock,
  vinyls: VinylsBlock,
  trophies: ({ profile }) => <TrophyShelf username={profile.username} />,
  wishlist: ({ profile }) => <WishlistBlock username={profile.username} />,
  artists: ArtistsBlock,
  tracks: TracksBlock,
  reviews: ReviewsBlock,
  lists: ListsBlock,
  recent: RecentBlock,
  activity: ActivityBlock,
  stats: StatsBlock,
};

/**
 * Blocs affichés, dans l'ordre : `blocks` = [{ id, on }] (réglage du joueur). Un bloc étroit seul entre deux blocs
 * larges (ou en dernier) prend toute la ligne, pour ne pas laisser de trou dans la grille.
 */
export function layoutOf(blocks) {
  const shown = (blocks || []).filter((b) => b.on && BLOCK_IDS.includes(b.id)).map((b) => b.id);
  const out = [];
  let run = [];
  const flush = () => {
    run.forEach((id, i) => out.push({ id, wide: run.length % 2 === 1 && i === run.length - 1 }));
    run = [];
  };
  for (const id of shown) {
    if (WIDE.has(id)) {
      flush();
      out.push({ id, wide: true });
    } else run.push(id);
  }
  flush();
  return out;
}

/**
 * Vue d'ensemble. Props : { profile, isSelf, blocks, base (adresse du Studio), onEdit(onglet de l'éditeur),
 * onPickSlot(i), onRemoveSlot(i) } (les deux derniers : vitrine de son propre Studio).
 */
export function StudioBlocks({ profile, isSelf, blocks, base, onEdit, onPickSlot, onRemoveSlot }) {
  const layout = layoutOf(blocks);
  return (
    <div className="st-blocks" data-studio-blocks={layout.map((b) => b.id).join(',')}>
      {layout.map(({ id, wide }) => {
        const Block = REGISTRY[id];
        return (
          <div key={id} className={`st-block${wide ? ' st-block--wide' : ''}`} data-block={id}>
            <Block profile={profile} isSelf={isSelf} base={base} onEdit={onEdit} onPickSlot={onPickSlot} onRemoveSlot={onRemoveSlot} />
          </div>
        );
      })}
    </div>
  );
}

export default StudioBlocks;
