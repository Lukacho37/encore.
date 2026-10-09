// Module « tracks » : page morceau (PLAN.md 4.1.3). Chantier : P0-C.
// GET /api/catalog/tracks/:id (l'identifiant contient « : » et arrive encodé, ex. discovery%3A01) : le morceau, son
// album et son artiste, les autres morceaux de l'album (ou les promos de l'artiste pour un single promo), la carte du
// joueur (standard / holo), qui la possède (nombre gardé 5 min par morceau, amis ≤ 8), le résumé des notes (les
// critiques viennent de GET /api/ratings/track/:id) et le nombre de joueurs qui ont complété l'album.
// Toutes les requêtes passent par un index (cards_track, cards PK, cat_tracks_album, ach_key, rating_stats PK).
export const name = 'tracks';

/** Morceaux de l'album renvoyés au plus ; promos de l'artiste pour un single promo ; amis propriétaires affichés. */
export const MAX_SIBLINGS = 40;
export const MAX_PROMO_SIBLINGS = 12;
export const MAX_OWNER_FRIENDS = 8;

export function init(deps) {
  const { db, catalog, services, validate } = deps;
  const q = (sql) => db.prepare(sql);
  const stSiblings = q('SELECT id FROM cat_tracks WHERE album_id = ? ORDER BY n LIMIT ?');
  const stPromos = q("SELECT id FROM cat_tracks WHERE artist_id = ? AND kind = 'promo' ORDER BY n LIMIT ?");
  const stMine = q('SELECT variant, count, first_at, pulled_rarity FROM cards WHERE user_id = ? AND track_id = ?');
  const stOwners = q('SELECT COUNT(DISTINCT user_id) AS n FROM cards WHERE track_id = ?');
  const stFriendOwners = q(`SELECT user_id, MIN(first_at) AS at FROM cards WHERE track_id = ? AND user_id IN (SELECT value FROM json_each(?))
    GROUP BY user_id ORDER BY at LIMIT ?`);
  const stMyScore = q("SELECT score FROM ratings WHERE user_id = ? AND item_type = 'track' AND item_id = ?");
  const stCompleted = q('SELECT COUNT(*) AS n FROM achievements WHERE key = ?');
  // Nombre de propriétaires d'un morceau : 3 ms pour le plus collectionné, gardé 5 minutes (PLAN.md 7.3).
  const ownersCache = deps.lru({ max: 5000, ttlMs: 5 * 60_000 });

  /** Nombre de joueurs qui possèdent ce morceau (toutes variantes), gardé 5 minutes. */
  const ownerCount = (trackId) => ownersCache.wrap(trackId, () => stOwners.get(trackId).n);

  /** Carte du joueur : exemplaires et date de la première, par variante ; null s'il ne l'a pas. */
  function mineOf(userId, trackId) {
    const rows = stMine.all(userId, trackId);
    if (!rows.length) return null;
    const of = (variant) => {
      const r = rows.find((x) => x.variant === variant);
      return r ? { count: r.count, firstAt: r.first_at } : null;
    };
    return { std: of('std'), holo: of('holo'), pulledRarity: rows.find((r) => r.pulled_rarity)?.pulled_rarity ?? null };
  }

  /** Page morceau pour `viewerId` ; 404 unknown_track si le morceau n'existe pas. */
  function trackPage(viewerId, rawId) {
    const id = validate.id(rawId);
    const track = id ? catalog.track(id) : null;
    if (!track) throw new deps.HttpError(404, 'unknown_track');
    const album = track.albumId ? catalog.album(track.albumId) : null;
    const artist = catalog.artist(track.artistId);
    const siblings = album
      ? stSiblings.all(album.id, MAX_SIBLINGS).map((r) => r.id)
      : stPromos.all(track.artistId, MAX_PROMO_SIBLINGS).map((r) => r.id);
    // Amis qui possèdent la carte : les joueurs masqués (blocages) n'apparaissent pas.
    const hidden = deps.access?.hiddenIds?.(viewerId) ?? new Set();
    const friendIds = [...services.friendIds(viewerId)].filter((f) => !hidden.has(f));
    const friendRows = friendIds.length ? stFriendOwners.all(id, JSON.stringify(friendIds), MAX_OWNER_FRIENDS) : [];
    const users = services.userSummaries(friendRows.map((r) => r.user_id), viewerId, { hidden });
    const friends = friendRows.map((r) => users.get(r.user_id)).filter(Boolean);
    return {
      track,
      album,
      artist,
      siblings,
      mine: mineOf(viewerId, id),
      owners: { count: ownerCount(id), friends },
      ratings: { summary: deps.ratings.summaryOf('track', id), myScore: stMyScore.get(viewerId, id)?.score ?? null },
      albumCompletedBy: album ? stCompleted.get(`album:${album.id}`).n : null,
      catalog: deps.refs({
        trackIds: [id, ...siblings],
        albumIds: [album?.id, ...services.summaryAlbums(friends)].filter(Boolean),
        artistIds: [track.artistId],
      }),
    };
  }

  return { trackPage, ownerCount, forgetOwners: (trackId) => ownersCache.delete(trackId) };
}

export function routes(r, deps) {
  r.get('/catalog/tracks/:id', deps.limits.read, (req, res) => res.json(deps.tracks.trackPage(req.user.id, req.params.id)));
}
