// Jumeau de démo du module « tracks » (server/tracks.js, P0-C, PLAN.md 4.1.3) : mêmes routes, mêmes formes.
// GET /catalog/tracks/:id : le morceau, son album et son artiste, les autres morceaux de l'album (ou les promos de
// l'artiste), la carte du joueur, qui la possède (amis ≤ 8), le résumé des notes et les joueurs qui ont complété
// l'album, calculés sur la base de la démo. Les joueurs fictifs (semés par le cœur) possèdent déjà des cartes.
import { summaryOf, viewerOf } from './ratings.js';

export const name = 'tracks';

const avatarAlbum = (avatar) => (typeof avatar === 'string' && avatar.startsWith('album:') ? avatar.slice(6) : null);

function trackPage(ctx, raw) {
  const u = ctx.me();
  const { db, staticCatalog } = ctx;
  const id = decodeURIComponent(raw);
  const track = ctx.TRACK.has(id) ? staticCatalog.track(id) : null;
  if (!track) ctx.fail(404, 'unknown_track');
  const album = track.albumId ? staticCatalog.album(track.albumId) : null;
  const artist = staticCatalog.artist(track.artistId);
  const siblings = album
    ? staticCatalog.albumTrackIds(album.id).slice(0, 40)
    : staticCatalog.artistTracks(track.artistId).filter((t) => t.kind === 'promo').sort((a, b) => a.n - b.n).slice(0, 12).map((t) => t.id);
  const cardOf = (uid, variant) => db.cards?.[uid]?.[`${id}|${variant}`];
  const mineOf = (variant) => {
    const c = cardOf(u.id, variant);
    return c ? { count: c.count, firstAt: c.at } : null;
  };
  const mine = mineOf('std') || mineOf('holo') ? { std: mineOf('std'), holo: mineOf('holo'), pulledRarity: null } : null;
  const owners = db.users.filter((x) => cardOf(x.id, 'std') || cardOf(x.id, 'holo'));
  const viewer = viewerOf(ctx, u.id);
  const friendOwners = owners.filter((x) => viewer.friends.has(x.id))
    .sort((a, b) => Math.min(cardOf(a.id, 'std')?.at ?? Infinity, cardOf(a.id, 'holo')?.at ?? Infinity)
      - Math.min(cardOf(b.id, 'std')?.at ?? Infinity, cardOf(b.id, 'holo')?.at ?? Infinity))
    .slice(0, 8);
  const users = ctx.summaries(friendOwners.map((x) => x.id));
  const friends = friendOwners.map((x) => users.get(x.id)).filter(Boolean);
  const my = db.ratings.find((r) => r.userId === u.id && r.type === 'track' && r.id === id);
  return {
    track,
    album,
    artist,
    siblings,
    mine,
    owners: { count: owners.length, friends },
    ratings: { summary: summaryOf(db, 'track', id), myScore: my ? my.score : null },
    albumCompletedBy: album ? Object.values(db.achievements || {}).filter((list) => list?.[`album:${album.id}`] !== undefined).length : null,
    catalog: ctx.refs({
      trackIds: [id, ...siblings],
      albumIds: [album?.id, ...friends.map((f) => avatarAlbum(f.avatar))].filter(Boolean),
      artistIds: [track.artistId],
    }),
  };
}

export const routes = [
  ['GET', /^\/catalog\/tracks\/([^/]+)$/, ({ params, ctx }) => trackPage(ctx, params[0])],
];

export function seed() {}

export function migrate() {}
