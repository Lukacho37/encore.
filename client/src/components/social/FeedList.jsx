// Fil d'actualité — chantier P1-A (PLAN.md 4.2.2, 5.2, 8.2 P1.1, design-system-current §4.3).
// useFeed(tab) : GET /api/feed?tab=&cursor= page par page (useCursorList) ; sans onglet demandé, le serveur choisit
// (Tes amis quand un ami a été actif dans les 14 derniers jours, sinon Communauté) et le dit dans `tab`.
// FeedList : les éléments (posts, critiques, notes du jour, albums complétés, cartes d'exception, médailles, listes,
// « Mes 9 albums », nouveaux amis), squelettes, état vide par onglet, invitation « Trouve des amis » sans ami,
// chargement automatique des pages suivantes (puis « Voir plus » : le bas de la page reste atteignable).
// Chaque élément dit pourquoi il est là (« Ami », « Proche de tes goûts », « Populaire »). La liste garde aussi la classe
// historique .feed de l'accueil (le parcours scripts/e2e.mjs la vise ; .so-feed.feed l'emporte sur son ancien style).
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n/index.jsx';
import { useCursorList } from '../../state/paged.js';
import { useAlbum, useTrack } from '../../state/catalog.js';
import CoverArt from '../CoverArt.jsx';
import { RarityGem } from '../Card.jsx';
import { RatingValue } from '../Rating.jsx';
import { Avatar, Icon } from '../ui.jsx';
import { EmptyState, ErrorBox, LoadMore } from '../feedback.jsx';
import SafetyMenu from '../safety/SafetyMenu.jsx';
import { LikeButton } from './LikeButton.jsx';
import { MentionCard } from './MentionCard.jsx';
import { PostCard } from './PostCard.jsx';
import { ReviewCard } from './ReviewCard.jsx';
import { itemHref, timeAgo, userHref, useOnBlocked } from './util.js';
import { parseBadgeKey } from '@shared/badges.js';
import { medalName } from '../play/common.jsx';
import '../../styles/social.css';

export const FEED_TABS = ['friends', 'foryou', 'community'];
const PAGE = 20;
// Pages chargées toutes seules en approchant du bas ; ensuite « Voir plus » (le pied de page reste atteignable).
const AUTO_ITEMS = 80;

/** Clé d'un élément du fil : un post (aussi celui qu'on vient de publier) par son identifiant, le reste par son activité. */
export const feedKey = (x) => (x?.verb === 'post' && x.post ? `p${x.post.id}` : `a${x?.id}`);

/** Élément du fil fabriqué à partir d'un post qu'on vient de publier (affiché en tête sans recharger). */
export function feedItemOfPost(post) {
  return {
    id: `new-${post.id}`, verb: 'post', actor: post.user, object: { type: 'post', id: String(post.id) }, item: post.item,
    groupCount: 1, data: {}, post, likeCount: post.likeCount, commentCount: post.commentCount, liked: post.liked,
    reason: 'friend', createdAt: post.createdAt, updatedAt: post.createdAt,
  };
}

/**
 * Fil d'un onglet (null : celui que le serveur choisit). Renvoie la liste (useCursorList) plus `tab` (onglet servi)
 * et `hasFriends`.
 */
export function useFeed(tab) {
  const [meta, setMeta] = useState({ tab: null, hasFriends: true });
  const path = tab ? `/feed?tab=${tab}` : '/feed';
  const list = useCursorList(path, {
    limit: PAGE,
    idOf: feedKey,
    onPage: (res) => setMeta((m) => ({
      tab: FEED_TABS.includes(res?.tab) ? res.tab : m.tab,
      hasFriends: typeof res?.hasFriends === 'boolean' ? res.hasFriends : m.hasFriends,
    })),
  });
  return { ...list, tab: tab || meta.tab, hasFriends: meta.hasFriends };
}

/** Tête d'une activité : avatar, nom, « Ami » ou raison, ce qu'il a fait et quand. */
function ActivityHead({ item, headline }) {
  const { t, lang } = useI18n();
  const { actor } = item;
  const friend = actor.relation === 'friend';
  return (
    <div className="post__head">
      <Link to={userHref(actor)} className="post__avatar" tabIndex={-1} aria-hidden="true"><Avatar user={actor} size={40} /></Link>
      <div className="post__who">
        <span className="post__name">
          <Link to={userHref(actor)}>{actor.username}</Link>
          {friend && <span className="chip chip--sm chip--cue">{t('social.friendTag')}</span>}
          {!friend && actor.relation !== 'self' && item.reason && item.reason !== 'friend' && (
            <span className="chip chip--sm chip--quiet">{t(`feed.reasons.${item.reason}`)}</span>
          )}
        </span>
        <span className="post__meta">
          <span className="so-headline">{headline}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(item.updatedAt || item.createdAt).toISOString()}>{timeAgo(item.updatedAt || item.createdAt, lang)}</time>
        </span>
      </div>
      {actor.relation !== 'self' && <SafetyMenu target={{ type: 'user', id: actor.id }} user={actor} />}
    </div>
  );
}

/** Une vignette d'album ou de morceau noté (bandeau « a noté 5 albums aujourd'hui »). */
function RatedTile({ type, id, score }) {
  const album = useAlbum(type === 'album' ? id : null);
  const track = useTrack(type === 'track' ? id : null);
  const it = type === 'album' ? album : track;
  if (!it) return <span className="so-strip__item" aria-hidden="true"><span className="so-strip__cover" /></span>;
  return (
    <Link to={itemHref(type, it.id)} className="so-strip__item" title={it.artist ? `${it.title} · ${it.artist}` : it.title}>
      <span className="so-strip__cover"><CoverArt art={{ ...it.art, seed: it.art?.seed || it.albumId || it.id }} sizes="84px" /></span>
      <span className="so-strip__title">{it.title}</span>
      {score != null && <RatingValue value={score} size={11} />}
    </Link>
  );
}

/** Une carte obtenue (bandeau « a obtenu 2 cartes d'exception ») : pochette de l'album, gemme de rareté dans le coin. */
function PulledTile({ trackId, rarity }) {
  const track = useTrack(trackId);
  if (!track) return <span className="so-strip__item" aria-hidden="true"><span className="so-strip__cover" /></span>;
  return (
    <Link to={itemHref('track', track.id)} className="so-strip__item" title={`${track.title} · ${track.artist}`}>
      <span className="so-strip__cover">
        <CoverArt art={{ ...track.art, seed: track.art?.seed || track.albumId || track.id }} sizes="84px" />
        <RarityGem rarity={rarity || track.rarity} size={12} />
      </span>
      <span className="so-strip__title">{track.title}</span>
    </Link>
  );
}

/** Notes du jour (une ligne agrégée) : une seule → carte de mention, plusieurs → bandeau de pochettes. */
function RateActivity({ item }) {
  const { t } = useI18n();
  const items = item.data?.items || [];
  const count = Math.max(item.groupCount || 0, items.length);
  if (!items.length) return null;
  const types = new Set(items.map((x) => x.type));
  const headline = count <= 1
    ? t('feed.rateOne')
    : types.size > 1 ? t('feed.rateMixed', { n: count }) : types.has('track') ? t('feed.rateTracks', { n: count }) : t('feed.rateAlbums', { n: count });
  return (
    <article className="post so-act" data-feed="rate">
      <ActivityHead item={item} headline={headline} />
      {count <= 1 ? (
        <div className="so-act__one">
          <MentionCard item={{ type: items[0].type, id: items[0].id }} size="sm" />
          <RatingValue value={items[0].score} size={15} />
        </div>
      ) : (
        <div className="so-strip">{items.map((x) => <RatedTile key={`${x.type}:${x.id}`} {...x} />)}</div>
      )}
    </article>
  );
}

/** Cartes d'exception obtenues aujourd'hui (légendaires, promos). */
function PullActivity({ item }) {
  const { t } = useI18n();
  const items = item.data?.items || [];
  const count = Math.max(item.groupCount || 0, items.length);
  if (!items.length) return null;
  const headline = count <= 1 ? t('feed.pullOne', { rarity: t(`rarity.${items[0].rarity}`).toLowerCase() }) : t('feed.pullMany', { n: count });
  return (
    <article className="post so-act" data-feed="pull">
      <ActivityHead item={item} headline={headline} />
      <div className="so-strip">{items.map((x) => <PulledTile key={x.trackId} trackId={x.trackId} rarity={x.rarity} />)}</div>
    </article>
  );
}

/** Album complété (Pressage n°) ou artiste maîtrisé : la carte de mention de l'album ou de l'artiste. */
function CatalogActivity({ item, headline, extra }) {
  return (
    <article className="post so-act" data-feed={item.verb}>
      <ActivityHead item={item} headline={headline} />
      {item.item && <MentionCard item={item.item} />}
      {extra}
    </article>
  );
}

/** Liste publiée (ou « Mes 9 albums ») : carte de la liste, J'aime, commentaires sur sa page. */
function ListActivity({ item, onChange }) {
  const { t } = useI18n();
  const { list } = item;
  if (!list) return null;
  const grid = item.verb === 'grid';
  const added = Number(item.data?.added) || 0;
  const headline = grid ? t('feed.grid') : added > 0 ? t('feed.listAdded', { n: added }) : t('feed.list');
  return (
    <article className="post so-act" data-feed={item.verb}>
      <ActivityHead item={item} headline={headline} />
      <MentionCard list={list} />
      <div className="post__actions">
        <LikeButton targetType="list" targetId={list.id} liked={item.liked} count={item.likeCount}
          onChange={({ liked, likeCount }) => onChange?.({ ...item, liked, likeCount, list: { ...list, liked, likeCount } })} />
        <Link to={itemHref('list', list.id)} className="act-btn" aria-label={t('social.comments', { n: item.commentCount })}>
          <Icon name="comment" size={18} /><span className="mono">{item.commentCount}</span>
        </Link>
        {grid && <Link to={`${userHref(item.actor)}/nine`} className="act-btn">{t('feed.seeGrid')}</Link>}
      </div>
    </article>
  );
}

/** Médaille (or, platine, première) : la pastille de la médaille et le lien vers les médailles du joueur. */
function BadgeActivity({ item }) {
  const { t, lang } = useI18n();
  const tier = item.data?.tier;
  const tierLabel = tier ? t(`feed.tiers.${tier}`) : t('feed.badge');
  // Nom de la médaille (« Explorateur des années 90 ») lu dans sa clé badge:<famille>[:<variante>]:<palier> (P1-F).
  const parsed = item.object?.type === 'badge' ? parseBadgeKey(item.object.id) : null;
  const name = parsed ? medalName(t, { id: parsed.family, variant: parsed.variant }, lang) : null;
  return (
    <article className="post so-act" data-feed="badge">
      <ActivityHead item={item} headline={item.data?.first ? t('feed.badgeFirst') : t('feed.badge')} />
      <Link to={`${userHref(item.actor)}/badges`} className="so-badge">
        <span className="so-badge__icon" aria-hidden="true"><Icon name="trophy" size={18} /></span>
        <span>{name ? <><b>{name}</b> · {tierLabel}</> : tierLabel}</span>
        <span className="so-badge__go">{t('feed.seeBadges')}</span>
      </Link>
    </article>
  );
}

/** Nouveaux amis du jour. */
function FriendActivity({ item }) {
  const { t } = useI18n();
  const users = item.data?.users || [];
  if (!users.length) return null;
  const headline = users.length === 1 ? t('feed.friendOne', { name: users[0].username }) : t('feed.friendMany', { n: users.length });
  return (
    <article className="post so-act" data-feed="friend">
      <ActivityHead item={item} headline={headline} />
      <div className="so-people">
        {users.map((u) => <Link key={u.id} to={userHref(u)}><Avatar user={u} size={28} /> {u.username}</Link>)}
      </div>
    </article>
  );
}

/** Un élément du fil selon son type. `onChange(item)` garde le fil à jour (J'aime, commentaires) ; `onRemove()`. */
export function FeedItem({ item, onChange, onRemove }) {
  const { t } = useI18n();
  switch (item.verb) {
    case 'post':
      return item.post ? (
        <PostCard post={item.post} reason={item.reason} onRemove={onRemove}
          onChange={(post) => onChange?.({ ...item, post, likeCount: post.likeCount, commentCount: post.commentCount, liked: post.liked })} />
      ) : null;
    case 'review':
      return item.review ? (
        <ReviewCard review={item.review} reason={item.reason} headline={t(`feed.review.${item.review.item?.type === 'track' ? 'track' : 'album'}`)}
          onChange={(review) => onChange?.({ ...item, review, likeCount: review.likeCount, liked: review.liked })} />
      ) : null;
    case 'rate':
      return <RateActivity item={item} />;
    case 'pull':
      return <PullActivity item={item} />;
    case 'complete':
      return (
        <CatalogActivity item={item} headline={t('feed.complete')}
          extra={item.data?.rank ? <span className="chip chip--sm chip--gold so-act__rank">{t('feed.completeRank', { rank: item.data.rank })}</span> : null} />
      );
    case 'master':
      return <CatalogActivity item={item} headline={t('feed.master')} />;
    case 'list':
    case 'grid':
      return <ListActivity item={item} onChange={onChange} />;
    case 'badge':
      return <BadgeActivity item={item} />;
    case 'friend':
      return <FriendActivity item={item} />;
    default:
      return null;
  }
}

/** Squelettes du premier chargement (même hauteur qu'un post). */
function FeedSkeleton({ count = 3 }) {
  return Array.from({ length: count }, (_, i) => <li key={i} className="so-skel" aria-hidden="true" />);
}

/** Invitation à trouver des amis (compte sans ami : le fil commence par la communauté). */
export function FindFriends() {
  const { t } = useI18n();
  return (
    <div className="so-invite" data-invite="friends">
      <span className="so-invite__icon" aria-hidden="true"><Icon name="users" size={22} /></span>
      <div>
        <p className="so-invite__title">{t('feed.invite.title')}</p>
        <p className="so-invite__body">{t('feed.invite.body')}</p>
      </div>
      <Link to="/friends" className="btn btn--ghost btn--sm">{t('feed.invite.cta')}</Link>
    </div>
  );
}

/**
 * Liste du fil. Props : { feed (résultat de useFeed), onCompose?() (état vide de la communauté : « Écrire un post »),
 * insert?: { after, node } (bloc posé après les `after` premiers éléments : la colonne sur téléphone) }.
 */
export function FeedList({ feed, onCompose, insert = null }) {
  const { t } = useI18n();
  const { items, loading, error, hasMore, loadMore, reload, update, remove, tab } = feed;
  useOnBlocked((userId) => {
    for (const x of items) if (x.actor?.id === userId) remove(feedKey(x));
  });
  const at = insert ? Math.min(insert.after, items.length) : -1;
  const rows = useMemo(() => items.map((x) => (
    <li key={feedKey(x)} data-feed-item={x.verb}>
      <FeedItem item={x} onChange={(next) => update(feedKey(x), () => next)} onRemove={() => remove(feedKey(x))} />
    </li>
  )), [items, update, remove]);

  if (error && !items.length) return <ErrorBox error={error} onRetry={reload} />;
  const first = loading && !items.length;
  const empty = !loading && !items.length;
  const emptyKey = FEED_TABS.includes(tab) ? tab : 'community';
  const emptyAction = emptyKey === 'friends' ? { label: t('feed.empty.friends.cta'), to: '/friends', icon: 'users' }
    : emptyKey === 'foryou' ? { label: t('feed.empty.foryou.cta'), to: '/discover', icon: 'compass' }
      : onCompose ? { label: t('feed.empty.community.cta'), onClick: onCompose, icon: 'edit' } : null;
  return (
    <div className="so-feedwrap" data-feed-tab={tab || ''}>
      {feed.hasFriends === false && tab !== 'friends' && <FindFriends />}
      <ul className="so-feed feed" aria-busy={loading}>
        {first ? <FeedSkeleton /> : at >= 0 ? [...rows.slice(0, at), <li key="insert" className="so-insert">{insert.node}</li>, ...rows.slice(at)] : rows}
      </ul>
      {empty && (
        <EmptyState icon={emptyKey === 'friends' ? 'users' : emptyKey === 'foryou' ? 'compass' : 'comment'}
          title={t(`feed.empty.${emptyKey}.title`)} body={t(`feed.empty.${emptyKey}.body`)} action={emptyAction} />
      )}
      {!first && (
        <LoadMore hasMore={hasMore} loading={loading} onClick={loadMore} auto={items.length < AUTO_ITEMS}
          error={items.length ? error : null} onRetry={loadMore} label={t('feed.more')} />
      )}
      {!first && !hasMore && items.length > 0 && <p className="so-end">{t('feed.end')}</p>}
    </div>
  );
}

export default FeedList;
