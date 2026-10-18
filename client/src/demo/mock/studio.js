// Jumeau de démo du module « studio » (server/studio.js, P1-B, PLAN.md 4.2.3) : mêmes routes, mêmes formes.
//   GET /users/:username            le Studio (remplace la route du cœur : mêmes champs, plus ceux du Studio)
//   GET /users/:username/vinyls     l'étagère complète, page par page (curseur [date, clé])
//   GET /me/profile · PUT /me/profile { bio, visibility } · PUT /me/studio { blocks, featuredVinyl, featuredLists }
//   PUT /me/favorites/:kind { ids ≤ 5 } (artist | track | genre) · PUT /me/cosmetics { frame, vinyl, theme, title }
// Données : u.bio, u.profileVisibility (même champ que les jumeaux des listes, du fil, des badges et du Taste Match),
// u.studio = { blocks, featuredVinyl, featuredLists } ; favoris dans db.favorites[userId] = { artist, track, genre }
// (même table que le jumeau du Taste Match, mock/match.js). Mêmes règles que le serveur : joueur bloqué introuvable,
// Studio « amis » ou « privé » réduit à l'en-tête (`access: 'header'`), bio cachée pendant une suspension,
// cosmétiques vérifiés (409 cosmetic_locked), vinyle mis en avant pressé, listes épinglées à soi.
// Les joueurs fictifs ont une bio, des morceaux favoris, un vinyle mis en avant, une liste épinglée et des réglages
// variés (blocs réordonnés ou masqués ; soulcollector réserve son Studio à ses amis) : les Studios de la démo vivent.
import { THEME_GENRES, levelFromXp } from '@shared/rules.js';
import { BIO_MAX, BLOCK_IDS, FAVORITES_MAX, FEATURED_LISTS_MAX, blocksOf } from '../../components/studio/blocks.js';
import { viewerOf } from './ratings.js';
import { decodeCursor, encodeCursor, listSummaries } from './social.js';
import * as match from './match.js';

export const name = 'studio';

const VISIBILITIES = ['public', 'friends', 'private'];
const FAVORITE_KINDS = ['artist', 'track', 'genre'];
const VINYLS_KEPT = 120; // vinyles lus pour le Studio (comme le cœur), 24 envoyés
const VINYLS_SHOWN = 24;
const RECENT_MAX = 12;
const MASTERS_MAX = 100;

// Studios des joueurs fictifs (une fois) : bio, ordre des blocs, blocs masqués, confidentialité.
const BOTS = {
  'lea.beats': {
    bio: 'Électro le jour, soul la nuit. Je complète tout ce que Daft Punk a sorti, une carte après l’autre.',
    blocks: ['showcase', 'nine', 'vinyls', 'artists', 'tracks', 'reviews', 'trophies', 'lists', 'wishlist', 'recent', 'activity', 'stats'],
  },
  maxvinyl: {
    bio: 'Collectionneur de vinyles depuis 1998. Si tu cherches une face B introuvable, demande-moi.',
  },
  soulcollector: {
    bio: 'Jazz, soul et reggae. Mon Studio est réservé à mes amis : envoie-moi une demande !',
    visibility: 'friends',
  },
  'k.dot_fan': {
    bio: 'Rap US, beats et grands albums concepts. good kid, m.A.A.d city tourne en boucle.',
    hidden: ['stats'],
  },
};

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const toId = (raw) => (/^\d{1,15}$/.test(String(raw ?? '')) ? Number(raw) : null);
const idOf = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);
const visibilityOf = (u) => (VISIBILITIES.includes(u?.profileVisibility) ? u.profileVisibility : 'public');
const avatarAlbum = (avatar) => (typeof avatar === 'string' && avatar.startsWith('album:') ? avatar.slice(6) : null);
const cardsOf = (ctx, uid) => ctx.db.cards[uid] || {};
const holoSet = (ctx, uid) => new Set(Object.keys(cardsOf(ctx, uid)).filter((k) => k.endsWith('|holo')).map((k) => k.split('|')[0]));
const withoutKey = ({ key, ...v }) => v;

/** Réglages du Studio d'un joueur, nettoyés : { blocks, featuredVinyl, featuredLists }. */
function studioOf(u) {
  const raw = isObj(u?.studio) ? u.studio : {};
  return {
    blocks: blocksOf(raw.blocks),
    featuredVinyl: idOf(raw.featuredVinyl),
    featuredLists: (Array.isArray(raw.featuredLists) ? raw.featuredLists : []).map(toId).filter(Boolean).slice(0, FEATURED_LISTS_MAX),
  };
}

/** Favoris d'un joueur : { artists, tracks, genres } (5 au plus chacun), lus dans db.favorites comme le Taste Match. */
function favoritesOf(ctx, uid) {
  const f = isObj(ctx.db.favorites?.[uid]) ? ctx.db.favorites[uid] : {};
  const list = (x) => (Array.isArray(x) ? x.filter((id) => typeof id === 'string').slice(0, FAVORITES_MAX) : []);
  return {
    artists: list(f.artist).filter((id) => ctx.ARTIST.has(id)),
    tracks: list(f.track).filter((id) => ctx.TRACK.has(id)),
    genres: list(f.genre).filter((g) => THEME_GENRES.includes(g)),
  };
}

/** Joueur affiché, vérifié, pas bloqué dans un sens ou dans l'autre ; sinon 404 user_not_found. */
function targetUser(ctx, viewer, raw) {
  const target = ctx.userByName(decodeURIComponent(String(raw || '')));
  if (!target || !target.verified || (target.id !== viewer.id && viewer.hidden.has(target.id))) ctx.fail(404, 'user_not_found');
  return target;
}

/** 'full' ou 'header' : ce que `viewer` voit du Studio de `target`. */
function accessOf(viewer, target) {
  if (target.id === viewer.id) return 'full';
  const vis = visibilityOf(target);
  if (vis === 'public') return 'full';
  return vis === 'friends' && viewer.friends.has(target.id) ? 'full' : 'header';
}

/** Amitié vue du joueur connecté (champ `friendship` de P0) et identifiant de la demande. */
function friendshipOf(ctx, viewerId, targetId) {
  if (viewerId === targetId) return { friendship: 'self', requestId: null };
  const f = ctx.db.friendships.find((x) => x.status !== 'declined'
    && ((x.requester === viewerId && x.addressee === targetId) || (x.requester === targetId && x.addressee === viewerId)));
  if (!f) return { friendship: 'none', requestId: null };
  return { friendship: f.status === 'accepted' ? 'friends' : f.requester === viewerId ? 'outgoing' : 'incoming', requestId: f.id };
}

const friendsCount = (ctx, uid) => ctx.db.friendships.filter((f) => f.status === 'accepted' && (f.requester === uid || f.addressee === uid)).length;

/** Vinyles d'un joueur, du plus récent au plus ancien : [{ albumId, at, rank, edition, color, key }]. */
function vinylsOf(ctx, target, limit = Infinity) {
  const holo = holoSet(ctx, target.id);
  const color = ctx.collection.cosmeticsOf(target.id)?.vinyl ?? null;
  return Object.entries(ctx.collection.achOf(target.id))
    .filter(([k]) => k.startsWith('album:') && ctx.ALBUM.has(k.slice(6)))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))
    .slice(0, limit)
    .map(([key, at]) => {
      const albumId = key.slice(6);
      const edition = ctx.staticCatalog.albumTrackIds(albumId).every((id) => holo.has(id)) ? 'holo' : 'black';
      return { albumId, at, rank: ctx.collection.rankOf(target.id, key), edition, color: edition === 'black' ? color : null, key };
    });
}

/** Derniers morceaux obtenus : un par morceau (la version holo si elle existe), les plus récents d'abord. */
function recentOf(ctx, uid) {
  const byTrack = new Map();
  const rows = Object.entries(cardsOf(ctx, uid))
    .map(([k, c]) => ({ trackId: k.split('|')[0], variant: k.split('|')[1], at: c?.at || 0 }))
    .sort((a, b) => b.at - a.at);
  for (const r of rows) {
    const prev = byTrack.get(r.trackId);
    if (!prev) {
      if (byTrack.size < RECENT_MAX) byTrack.set(r.trackId, { trackId: r.trackId, variant: r.variant, at: r.at });
    } else if (r.variant === 'holo') prev.variant = 'holo';
  }
  return [...byTrack.values()].filter((r) => ctx.TRACK.has(r.trackId));
}

/** GET /users/:username : le Studio (voir server/studio.js). */
function studio(ctx, rawName) {
  const me = ctx.me();
  const viewer = viewerOf(ctx, me.id);
  const target = targetUser(ctx, viewer, rawName);
  const mode = accessOf(viewer, target);
  const full = mode === 'full';
  const summary = ctx.summaries([target.id]).get(target.id);
  const config = studioOf(target);
  const owned = ctx.collection.ownedSet(target.id);
  const holo = holoSet(ctx, target.id);
  const ach = ctx.collection.achOf(target.id);
  const stats = ctx.staticCatalog.stats(owned, Object.keys(ach));
  const { friendship, requestId } = friendshipOf(ctx, me.id, target.id);
  const suspended = target.id !== me.id && target.suspendedUntil && target.suspendedUntil > Date.now();

  const all = full ? vinylsOf(ctx, target, VINYLS_KEPT) : [];
  const vinyls = all.slice(0, VINYLS_SHOWN).reverse().map(withoutKey);
  const vinylCount = full ? Object.keys(ach).filter((k) => k.startsWith('album:') && ctx.ALBUM.has(k.slice(6))).length : 0;
  const featuredRow = full && config.featuredVinyl ? vinylsOf(ctx, target).find((v) => v.albumId === config.featuredVinyl) : null;
  const featured = featuredRow ? withoutKey(featuredRow) : null;
  const masters = full
    ? Object.entries(ach).filter(([k]) => k.startsWith('artist:')).sort((a, b) => b[1] - a[1]).slice(0, MASTERS_MAX).map(([k]) => k.slice(7))
    : [];
  const upcoming = full
    ? Object.entries(stats.albums).filter(([, p]) => p.pct < 1)
      .sort((a, b) => b[1].pct - a[1].pct || b[1].owned - a[1].owned).slice(0, 3).map(([albumId, progress]) => ({ albumId, progress }))
    : [];
  const showcase = full ? (target.showcase || []).map((s) => {
    const id = typeof s === 'string' ? s : s?.trackId;
    return id && owned.has(id) ? { trackId: id, variant: holo.has(id) ? 'holo' : 'std' } : null;
  }) : [];
  const favorites = full ? favoritesOf(ctx, target.id) : { artists: [], tracks: [], genres: [] };
  const recent = full ? recentOf(ctx, target.id) : [];
  const lists = full && config.featuredLists.length
    ? [...listSummaries(ctx, viewer, config.featuredLists).values()].filter((l) => l.kind === 'list' && l.user?.id === target.id)
      .sort((a, b) => config.featuredLists.indexOf(a.id) - config.featuredLists.indexOf(b.id))
    : [];

  return {
    // Champs du profil de P0 (même forme que le cœur de la démo).
    id: target.id,
    username: target.username,
    avatar: target.avatar,
    avatarColor: target.avatarColor,
    level: levelFromXp(target.xp),
    createdAt: target.createdAt,
    stats: {
      unique: stats.total.owned, total: stats.total.total,
      albumsCompleted: stats.albumsCompleted, albumsTotal: stats.catalog.albums,
      artistsMastered: stats.artistsMastered, artistsTotal: stats.catalog.artists,
      promos: stats.promos.owned, promosTotal: stats.promos.total,
    },
    showcase,
    cosmetics: ctx.collection.cosmeticsOf(target.id) || {},
    completedAlbums: vinyls.map((v) => v.albumId),
    vinyls,
    vinylCount,
    masteredArtists: masters,
    upcoming,
    friendship,
    requestId,
    // Studio (P1).
    user: {
      ...summary,
      bio: suspended ? null : target.bio || null,
      createdAt: target.createdAt,
      friendsCount: friendsCount(ctx, target.id),
      visibility: visibilityOf(target),
    },
    relation: summary?.relation ?? null,
    access: mode,
    blocks: config.blocks,
    featuredVinyl: featured,
    favorites,
    featuredLists: lists,
    recent,
    catalog: ctx.refs({
      trackIds: [...showcase.filter(Boolean).map((s) => s.trackId), ...recent.map((r) => r.trackId), ...favorites.tracks],
      albumIds: [
        ...vinyls.map((v) => v.albumId), ...upcoming.map((u) => u.albumId), featured?.albumId, avatarAlbum(target.avatar),
        ...lists.flatMap((l) => l.coverAlbumIds || []),
      ].filter(Boolean),
      artistIds: [...masters, ...favorites.artists],
    }),
  };
}

/** GET /users/:username/vinyls?cursor=&limit= : toute l'étagère, les plus récents d'abord. */
function vinylPage(ctx, rawName, query) {
  const me = ctx.me();
  const viewer = viewerOf(ctx, me.id);
  const target = targetUser(ctx, viewer, rawName);
  if (accessOf(viewer, target) !== 'full') return { items: [], nextCursor: null, restricted: true, catalog: ctx.refs({}) };
  const limit = Math.min(48, Math.max(1, Math.floor(Number(query.get('limit')) || 24)));
  const cursor = query.get('cursor') ? decodeCursor(query.get('cursor'), ctx) : null;
  let rows = vinylsOf(ctx, target);
  if (cursor) rows = rows.filter((v) => v.at < cursor[0] || (v.at === cursor[0] && v.key < cursor[1]));
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(withoutKey),
    nextCursor: rows.length > limit && last ? encodeCursor([last.at, last.key]) : null,
    catalog: ctx.refs({ albumIds: page.map((v) => v.albumId) }),
  };
}

/** GET /me/profile : réglages seuls (éditeur, Paramètres). */
function myProfile(ctx) {
  const u = ctx.me();
  const config = studioOf(u);
  const favorites = favoritesOf(ctx, u.id);
  return {
    bio: u.bio || null,
    visibility: visibilityOf(u),
    ...config,
    favorites,
    catalog: ctx.refs({ trackIds: favorites.tracks, artistIds: favorites.artists, albumIds: [config.featuredVinyl].filter(Boolean) }),
  };
}

/** Compte actif pour écrire un contenu (suspension, CGU), comme deps.access.assertActive. */
function assertActive(ctx, u) {
  if (u.suspendedUntil && u.suspendedUntil > Date.now()) ctx.fail(403, 'suspended', { until: u.suspendedUntil });
  if (!u.termsAcceptedAt) ctx.fail(403, 'terms_required');
}

/** PUT /me/profile { bio?, visibility? } → { profile: { bio, visibility } }. */
function setProfile(ctx, body) {
  const u = ctx.me();
  let visibility = visibilityOf(u);
  if (body.visibility !== undefined) {
    if (!VISIBILITIES.includes(body.visibility)) ctx.fail(400, 'invalid_input', { field: 'visibility' });
    visibility = body.visibility;
  }
  let bio = u.bio || null;
  if (body.bio !== undefined) {
    if (body.bio !== null && typeof body.bio !== 'string') ctx.fail(400, 'invalid_input', { field: 'bio' });
    const text = (body.bio || '').replace(/\r\n?/g, '\n').normalize('NFC').trim().replace(/\n{3,}/g, '\n\n');
    if ([...text].length > BIO_MAX) ctx.fail(400, 'invalid_input', { field: 'bio', max: BIO_MAX });
    if (text && text !== bio) assertActive(ctx, u);
    bio = text || null;
  }
  u.bio = bio;
  u.profileVisibility = visibility;
  return { profile: { bio, visibility } };
}

/** PUT /me/studio { blocks?, featuredVinyl?, featuredLists? } → { studio }. */
function setStudio(ctx, body) {
  const u = ctx.me();
  const next = studioOf(u);
  if (body.blocks !== undefined) {
    if (!Array.isArray(body.blocks) || body.blocks.length > BLOCK_IDS.length) ctx.fail(400, 'invalid_input', { field: 'blocks' });
    const seen = new Set();
    for (const b of body.blocks) {
      if (!isObj(b) || !BLOCK_IDS.includes(b.id) || seen.has(b.id) || (b.on !== undefined && typeof b.on !== 'boolean')) {
        ctx.fail(400, 'invalid_input', { field: 'blocks' });
      }
      seen.add(b.id);
    }
    next.blocks = blocksOf(body.blocks);
  }
  if (body.featuredVinyl !== undefined) {
    if (body.featuredVinyl === null || body.featuredVinyl === '') next.featuredVinyl = null;
    else {
      const albumId = idOf(body.featuredVinyl);
      if (!albumId || !ctx.ALBUM.has(albumId) || ctx.collection.achOf(u.id)[`album:${albumId}`] === undefined) {
        ctx.fail(400, 'vinyl_not_owned', { field: 'featuredVinyl' });
      }
      next.featuredVinyl = albumId;
    }
  }
  if (body.featuredLists !== undefined) {
    if (!Array.isArray(body.featuredLists) || body.featuredLists.length > FEATURED_LISTS_MAX) {
      ctx.fail(400, 'invalid_input', { field: 'featuredLists', max: FEATURED_LISTS_MAX });
    }
    const ids = [...new Set(body.featuredLists.map(toId))];
    if (ids.some((x) => !x)) ctx.fail(400, 'invalid_input', { field: 'featuredLists' });
    const mine = new Set((ctx.db.lists || []).filter((l) => l.userId === u.id && l.kind === 'list').map((l) => l.id));
    if (ids.some((x) => !mine.has(x))) ctx.fail(404, 'not_found', { field: 'featuredLists' });
    next.featuredLists = ids;
  }
  u.studio = next;
  return { studio: next };
}

/** PUT /me/favorites/:kind { ids ≤ 5 } → { favorites, catalog } (remplace la liste de ce type, dans l'ordre). */
function setFavorites(ctx, kind, body) {
  const u = ctx.me();
  if (!FAVORITE_KINDS.includes(kind)) ctx.fail(400, 'invalid_input', { field: 'kind' });
  if (!Array.isArray(body.ids) || body.ids.length > FAVORITES_MAX) ctx.fail(400, 'invalid_input', { field: 'ids', max: FAVORITES_MAX });
  const ids = [...new Set(body.ids.map(idOf))];
  if (ids.length !== body.ids.length || ids.some((x) => !x)) ctx.fail(400, 'invalid_input', { field: 'ids' });
  const exists = kind === 'artist' ? (id) => ctx.ARTIST.has(id) : kind === 'track' ? (id) => ctx.TRACK.has(id) : (id) => THEME_GENRES.includes(id);
  const unknown = ids.find((id) => !exists(id));
  if (unknown) ctx.fail(404, 'unknown_item', { id: unknown });
  if (!isObj(ctx.db.favorites)) ctx.db.favorites = {};
  const current = isObj(ctx.db.favorites[u.id]) ? ctx.db.favorites[u.id] : {};
  ctx.db.favorites[u.id] = { artist: [], genre: [], track: [], ...current, [kind]: ids };
  const favorites = favoritesOf(ctx, u.id);
  return { favorites, catalog: ctx.refs({ trackIds: favorites.tracks, artistIds: favorites.artists }) };
}

export const routes = [
  ['GET', /^\/users\/([^/]+)$/, ({ params, ctx }) => studio(ctx, params[0])],
  ['GET', /^\/users\/([^/]+)\/vinyls$/, ({ params, query, ctx }) => vinylPage(ctx, params[0], query)],
  ['GET', /^\/me\/profile$/, ({ ctx }) => myProfile(ctx)],
  ['PUT', /^\/me\/profile$/, ({ body, ctx }) => setProfile(ctx, body)],
  ['PUT', /^\/me\/studio$/, ({ body, ctx }) => setStudio(ctx, body)],
  ['PUT', /^\/me\/favorites\/([^/]+)$/, ({ params, body, ctx }) => setFavorites(ctx, params[0], body)],
  ['PUT', /^\/me\/cosmetics$/, ({ body, ctx }) => {
    const u = ctx.me();
    const cosmetics = ctx.collection.setCosmetics(u.id, body);
    return { cosmetics, state: ctx.partialState() };
  }],
];

/** Studios des joueurs fictifs (idempotent : un joueur déjà réglé n'est pas retouché). */
function seedBots(db, ctx) {
  // Favoris d'artistes et de genres des joueurs fictifs : ceux du jumeau du Taste Match, posés d'abord (son seed ne
  // touche jamais un joueur qui a déjà des favoris) ; on y ajoute leurs morceaux favoris.
  match.seed?.(db, ctx);
  if (!isObj(db.favorites)) db.favorites = {};
  for (const [username, bot] of Object.entries(BOTS)) {
    const u = ctx.userByName(username);
    if (!u?.bot || u.studioSeeded) continue;
    u.studioSeeded = true;
    if (u.bio == null) u.bio = bot.bio;
    if (!u.profileVisibility) u.profileVisibility = bot.visibility || 'public';
    const blocks = (bot.blocks || BLOCK_IDS).map((id) => ({ id, on: !(bot.hidden || []).includes(id) }));
    // Vinyle mis en avant : son premier album complété ; liste épinglée : sa première liste publique.
    const done = Object.entries(ctx.collection.achOf(u.id)).filter(([k]) => k.startsWith('album:') && ctx.ALBUM.has(k.slice(6)))
      .sort((a, b) => a[1] - b[1]);
    const list = (db.lists || []).find((l) => l.userId === u.id && l.kind === 'list' && (l.visibility || 'public') === 'public');
    u.studio = { blocks, featuredVinyl: done[0] ? done[0][0].slice(6) : null, featuredLists: list ? [list.id] : [] };
    // Morceaux favoris : les cartes de sa vitrine (les plus rares), puis d'autres de ses cartes.
    const showcase = (u.showcase || []).map((s) => (typeof s === 'string' ? s : s?.trackId)).filter((id) => id && ctx.TRACK.has(id));
    const owned = [...ctx.collection.ownedSet(u.id)].filter((id) => ctx.TRACK.has(id));
    const tracks = [...new Set([...showcase, ...owned])].slice(0, 4);
    const fav = isObj(db.favorites[u.id]) ? db.favorites[u.id] : { artist: [], genre: [] };
    if (!Array.isArray(fav.track) || !fav.track.length) db.favorites[u.id] = { ...fav, track: tracks };
  }
}

export function seed(db, ctx) {
  seedBots(db, ctx);
}

export function migrate(db, ctx) {
  // Sauvegarde d'avant le Studio : les réglages des joueurs fictifs (les autres joueurs gardent les valeurs par défaut).
  seedBots(db, ctx);
}
