// Module « discover » : Découvrir personnalisé (PLAN.md 4.2.7, 5.5). Chantier : P1-E.
//
// GET /discover → { sections: [{ id, kind, titleKey, titleVars, reason: { key, vars }, users?, items: [{ type: 'album', id }],
//   moreCursor }], tiles, progress, catalog }. Huit sections au plus, 12 albums par page (48 au plus avec « Voir plus »),
// chacune avec sa raison en une ligne ; les albums notés ou complétés sont écartés (sauf de « À compléter »), une
// section trop courte est sautée, 2 albums par artiste au plus par section, et un album n'apparaît qu'une fois sur la
// page (première page de chaque section). Sections, dans l'ordre :
//   because   « Parce que tu as aimé Discovery » : graine = mon dernier album noté 8+ (ou un de « Mes 9 albums »),
//             albums proches (album_similar une fois rempli par P2-C, sinon co-notes, artiste, genre et décennie) ;
//             sans note : mon premier artiste favori (onboarding) ;
//   friends   « Très apprécié par tes amis » : notes 8+ de mes amis, par nombre d'amis puis moyenne (avatars) ;
//   cult      « Albums cultes jamais notés » : rating_stats, 20 notes au moins, moyenne bayésienne (C = 10, m = 6) ;
//   complete  « À compléter » : albums recherchés d'abord, puis ceux à 50 % ou plus ;
//   decade    « Découvre les années 90 » : la décennie (200 albums au moins) où ma part de cartes est la plus basse
//             par rapport à sa part du catalogue ; les plus suivis ;
//   genre     « Ton genre : électro » : mon premier genre (cartes, sinon favoris), meilleures moyennes non notées ;
//   trending  « Tendances AlbumMania » : les plus notés des 7 derniers jours ;
//   new       « Nouveau au catalogue » : ajoutés depuis 30 jours, les plus suivis ;
//   popular   repli d'un compte tout neuf sur un catalogue sans notes : les plus suivis.
// Tuiles : Battles · Classements · Listes · Mes 9 albums · Blind test. Coûts : listes globales (cultes, tendances,
// nouveautés, par genre, par décennie, populaires) gardées 10 min ; la page d'un joueur 10 min (server/lru.js),
// oubliée quand il note, obtient des cartes ou change « Mes 9 albums ». GET /discover/:sectionId?cursor= → page suivante.
// GET /albums/:id/similar → { items: [{ id, reason: 'corated' | 'artist' | 'genre_decade' }], catalog } (1 h par album).
// API interne (deps.discover) : similar(albumId), forget(userId).
import { bayes } from '../shared/match.js';

export const name = 'discover';

export const SECTION_IDS = ['because', 'friends', 'cult', 'complete', 'decade', 'genre', 'trending', 'new', 'popular'];
/** Albums par page de section, au plus par section, au moins pour qu'elle s'affiche ; par artiste et par section. */
export const PAGE = 12;
export const SECTION_CAP = 48;
export const SECTION_MIN = 4;
export const PER_ARTIST = 2;
/** Section « Albums cultes » : notes au moins ; décennie : albums au catalogue au moins. */
const CULT_MIN = 20;
const DECADE_MIN_ALBUMS = 200;
const DAY = 86_400_000;
const TEN_MIN = 10 * 60_000;
/** Albums proches : au plus, notes 8+ récentes lues pour les co-notes, amateurs en commun nécessaires. */
const SIMILAR_MAX = 12;
const CORATERS = 200;
const CORATED_MIN = 3;

export function init(deps) {
  const { db, catalog, services, HttpError, lru, paging } = deps;
  const statements = new Map();
  const q = (sql) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    return st;
  };
  const json = (v) => JSON.stringify(v);
  const hiddenOf = (viewerId) => deps.access?.hiddenIds?.(viewerId) ?? new Set();

  const globalCache = lru({ max: 200, ttlMs: TEN_MIN });
  const userCache = lru({ max: 2000, ttlMs: TEN_MIN });
  const similarCache = lru({ max: 2000, ttlMs: 6 * TEN_MIN });
  const forget = (userId) => userCache.delete(Number(userId));

  // ----- listes globales (10 min) --------------------------------------------------------------------

  /** { id, artistId } des albums actifs parmi `ids`, dans l'ordre de `ids`. */
  function withArtists(ids) {
    if (!ids.length) return [];
    const by = new Map(q(`SELECT id, artist_id FROM cat_albums WHERE id IN (SELECT value FROM json_each(?)) AND status = 'active'`)
      .all(json(ids)).map((r) => [r.id, r.artist_id]));
    return ids.filter((id) => by.has(id)).map((id) => ({ id, artistId: by.get(id) }));
  }

  const cultList = () => globalCache.wrap('cult', () => q(`SELECT rs.item_id AS id, rs.count, rs.sum, al.artist_id FROM rating_stats rs
      JOIN cat_albums al ON al.id = rs.item_id AND al.status = 'active' WHERE rs.item_type = 'album' AND rs.count >= ?`).all(CULT_MIN)
    .map((r) => ({ id: r.id, artistId: r.artist_id, b: bayes(r.sum, r.count) }))
    .sort((a, b) => b.b - a.b || a.id.localeCompare(b.id)).slice(0, 300));

  const trendingList = () => globalCache.wrap('trending', () => withArtists(q(`SELECT item_id AS id, COUNT(*) AS n FROM ratings
      WHERE item_type = 'album' AND created_at >= ? GROUP BY item_id ORDER BY n DESC, item_id LIMIT 200`).all(Date.now() - 7 * DAY).map((r) => r.id)));

  const newList = () => globalCache.wrap('new', () => q(`SELECT id, artist_id, fans FROM cat_albums WHERE status = 'active' AND created_at >= ?
      ORDER BY created_at DESC LIMIT 2000`).all(Date.now() - 30 * DAY)
    .sort((a, b) => b.fans - a.fans || a.id.localeCompare(b.id)).slice(0, 200).map((r) => ({ id: r.id, artistId: r.artist_id })));

  const popularList = () => globalCache.wrap('popular', () => q(`SELECT id, artist_id FROM cat_albums WHERE status = 'active'
      ORDER BY fans DESC LIMIT 200`).all().map((r) => ({ id: r.id, artistId: r.artist_id })));

  /** Albums d'un genre : les mieux notés (5 notes au moins, moyenne bayésienne), puis les plus suivis. */
  const genreList = (genre) => globalCache.wrap(`genre:${genre}`, () => {
    const rows = q(`SELECT al.id, al.artist_id, al.fans, rs.count, rs.sum FROM cat_albums al
      LEFT JOIN rating_stats rs ON rs.item_type = 'album' AND rs.item_id = al.id
      WHERE al.genre = ? AND al.status = 'active' ORDER BY al.fans DESC LIMIT 400`).all(genre);
    const rated = rows.filter((r) => r.count >= 5).sort((a, b) => bayes(b.sum, b.count) - bayes(a.sum, a.count) || b.fans - a.fans);
    const rest = rows.filter((r) => !(r.count >= 5));
    return [...rated, ...rest].slice(0, 200).map((r) => ({ id: r.id, artistId: r.artist_id }));
  });

  const decadeList = (decade) => globalCache.wrap(`decade:${decade}`, () => q(`SELECT id, artist_id FROM cat_albums
      WHERE year BETWEEN ? AND ? AND status = 'active' ORDER BY fans DESC LIMIT 200`).all(decade, decade + 9)
    .map((r) => ({ id: r.id, artistId: r.artist_id })));

  // ----- albums proches -------------------------------------------------------------------------------

  /**
   * Albums proches d'un album : [{ id, artistId, reason }] (12 au plus). album_similar quand P2-C l'a rempli ; sinon
   * (ou en complément) : albums notés 8+ par au moins 3 des 200 derniers amateurs (8+) de l'album, autres albums de
   * l'artiste (3 au plus), puis même genre et même décennie (les plus suivis). 2 albums par artiste au plus, sauf
   * pour l'artiste lui-même.
   */
  function similarOf(albumId) {
    return similarCache.wrap(albumId, () => {
      const base = q("SELECT id, artist_id, genre, year FROM cat_albums WHERE id = ? AND status = 'active'").get(albumId);
      if (!base) return [];
      const out = [];
      const seen = new Set([albumId]);
      const perArtist = new Map();
      const push = (id, artistId, reason, cap = PER_ARTIST) => {
        if (seen.has(id) || out.length >= SIMILAR_MAX) return;
        const n = perArtist.get(artistId) || 0;
        if (n >= cap) return;
        seen.add(id);
        perArtist.set(artistId, n + 1);
        out.push({ id, artistId, reason });
      };
      const stored = q(`SELECT s.similar_id AS id, s.reason, al.artist_id FROM album_similar s JOIN cat_albums al ON al.id = s.similar_id AND al.status = 'active'
        WHERE s.album_id = ? ORDER BY s.score DESC LIMIT ?`).all(albumId, SIMILAR_MAX);
      for (const r of stored) push(r.id, r.artist_id, r.reason, r.reason === 'artist' ? 3 : PER_ARTIST);
      if (out.length < SIMILAR_MAX) {
        const fans = q(`SELECT user_id FROM ratings WHERE item_type = 'album' AND item_id = ? AND score >= 8
          ORDER BY updated_at DESC LIMIT ?`).all(albumId, CORATERS).map((r) => r.user_id);
        if (fans.length >= CORATED_MIN) {
          const rows = q(`SELECT r.item_id AS id, COUNT(*) AS n, al.artist_id FROM ratings r JOIN cat_albums al ON al.id = r.item_id AND al.status = 'active'
            WHERE r.user_id IN (SELECT value FROM json_each(?)) AND r.item_type = 'album' AND r.score >= 8 AND r.item_id <> ?
            GROUP BY r.item_id HAVING n >= ? ORDER BY n DESC, r.item_id LIMIT 24`).all(json(fans), albumId, CORATED_MIN);
          for (const r of rows.slice(0, 6)) push(r.id, r.artist_id, 'corated');
        }
      }
      if (out.length < SIMILAR_MAX) {
        for (const r of q(`SELECT id FROM cat_albums WHERE artist_id = ? AND id <> ? AND status = 'active' ORDER BY fans DESC LIMIT 6`).all(base.artist_id, albumId)) {
          push(r.id, base.artist_id, 'artist', 3);
        }
      }
      if (out.length < SIMILAR_MAX && base.genre && base.year) {
        const d = Math.floor(base.year / 10) * 10;
        for (const r of q(`SELECT id, artist_id FROM cat_albums WHERE genre = ? AND year BETWEEN ? AND ? AND status = 'active' AND id <> ?
          ORDER BY fans DESC LIMIT 60`).all(base.genre, d, d + 9, albumId)) {
          push(r.id, r.artist_id, 'genre_decade');
        }
      }
      return out;
    });
  }

  /** GET /albums/:id/similar */
  function similar(rawId) {
    const id = deps.validate.id(rawId);
    if (!id || !catalog.album(id)) throw new HttpError(404, 'unknown_album');
    const items = similarOf(id).map(({ id: a, reason }) => ({ id: a, reason }));
    return { items, catalog: deps.refs({ albumIds: items.map((x) => x.id) }) };
  }

  // ----- page d'un joueur ---------------------------------------------------------------------------

  /** Ce que la page sait du joueur : profil de goûts (deps.match), exclusions, graines. */
  function viewerOf(userId) {
    const profile = deps.match?.profileOf?.(userId) || null;
    const rated = new Set();
    if (profile) {
      for (const k of profile.ratings.keys()) if (k.startsWith('album:')) rated.add(k.slice(6));
    } else {
      for (const r of q("SELECT item_id FROM ratings WHERE user_id = ? AND item_type = 'album'").all(userId)) rated.add(r.item_id);
    }
    const completed = profile?.completed
      || new Set(q('SELECT album_id FROM user_album_progress WHERE user_id = ? AND total > 0 AND owned >= total').all(userId).map((r) => r.album_id));
    const favorites = profile?.favorites
      || { artist: [], genre: [], track: [] };
    return { id: userId, profile, rated, completed, favorites };
  }

  /** Liste candidate → identifiants gardés (exclusions, 2 par artiste, pas déjà montrés), SECTION_CAP au plus. */
  function pick(list, { exclude, seen, perArtist = PER_ARTIST }) {
    const out = [];
    const counts = new Map();
    for (const it of list) {
      if (!it || exclude(it.id) || out.includes(it.id)) continue;
      const n = counts.get(it.artistId) || 0;
      if (n >= perArtist) continue;
      counts.set(it.artistId, n + 1);
      out.push(it.id);
      if (out.length >= SECTION_CAP) break;
    }
    // Un album déjà sur la page (première page d'une section précédente) passe après les autres.
    const fresh = out.filter((id) => !seen.has(id));
    return fresh.length >= SECTION_MIN ? fresh : out;
  }

  const dayIndex = () => Math.floor(Date.now() / DAY);

  /** Décennie à découvrir : ma part de cartes la plus basse par rapport à sa part du catalogue. */
  function decadeFor(v) {
    const eligible = catalog.decades().filter((d) => d.albums >= DECADE_MIN_ALBUMS);
    if (!eligible.length) return null;
    const mine = v.profile?.decades || new Map();
    let total = 0;
    for (const [, n] of mine) total += n;
    if (!total) return { decade: eligible[dayIndex() % eligible.length].decade, cold: true };
    const all = eligible.reduce((s, d) => s + d.albums, 0);
    let best = null;
    for (const d of eligible) {
      const ratio = ((mine.get(d.decade) || 0) / total) / (d.albums / all);
      if (!best || ratio < best.ratio) best = { decade: d.decade, ratio };
    }
    return { decade: best.decade, cold: false };
  }

  /** Mon premier genre : celui de mes cartes et notes, sinon mon premier genre favori. */
  function genreFor(v) {
    const fav = v.favorites.genre?.[0] || null;
    let best = null;
    for (const [g, n] of v.profile?.genres || []) if (g && (!best || n > best[1])) best = [g, n];
    if (best && (!fav || best[1] > 10)) return { genre: best[0], cold: false };
    return fav ? { genre: fav, cold: true } : null;
  }

  /** Construit toutes les sections du joueur : { sections, lists: { id: [albumId] } }. */
  function build(userId) {
    const v = viewerOf(userId);
    const hidden = hiddenOf(userId);
    const seen = new Set();
    const sections = [];
    const lists = {};
    const usersOf = {};
    const notMine = (id) => v.rated.has(id) || v.completed.has(id);
    const add = (id, kind, list, { titleKey, titleVars = {}, reason, users, perArtist, exclude = notMine }) => {
      if (sections.length >= 8) return;
      const ids = pick(list, { exclude, seen, perArtist });
      if (ids.length < SECTION_MIN) return;
      for (const x of ids.slice(0, PAGE)) seen.add(x);
      lists[id] = ids;
      sections.push({ id, kind, titleKey, titleVars, reason, ...(users ? { users } : {}) });
      if (users) usersOf[id] = users;
    };

    // 1. Parce que tu as aimé…
    const seed = q(`SELECT item_id FROM ratings WHERE user_id = ? AND item_type = 'album' AND score >= 8
      ORDER BY updated_at DESC LIMIT 1`).get(userId)?.item_id
      || q(`SELECT li.item_id FROM lists l JOIN list_items li ON li.list_id = l.id WHERE l.user_id = ? AND l.kind = 'grid9'
        ORDER BY li.position LIMIT 1`).get(userId)?.item_id;
    if (seed && catalog.album(seed)) {
      add('because', 'similar', similarOf(seed), {
        titleKey: 'discover.sections.because', titleVars: { albumId: seed }, reason: { key: 'discover.reasons.because', vars: { albumId: seed } },
      });
    } else if (v.favorites.artist?.length) {
      const artistId = v.favorites.artist[0];
      const artist = catalog.artist(artistId);
      if (artist) {
        const own = q(`SELECT id, artist_id FROM cat_albums WHERE artist_id = ? AND status = 'active' ORDER BY fans DESC LIMIT 6`).all(artistId)
          .map((r) => ({ id: r.id, artistId: r.artist_id }));
        const others = v.favorites.artist.slice(1, 5).flatMap((a) => q(`SELECT id, artist_id FROM cat_albums WHERE artist_id = ? AND status = 'active'
          ORDER BY fans DESC LIMIT 3`).all(a).map((r) => ({ id: r.id, artistId: r.artist_id })));
        const sameGenre = artist.genre ? genreList(artist.genre) : [];
        add('because', 'artist', [...own, ...others, ...sameGenre], {
          titleKey: 'discover.sections.becauseArtist', titleVars: { artistId },
          reason: { key: 'discover.reasons.becauseArtist', vars: { artistId } }, perArtist: 3,
        });
      }
    }

    // 2. Très apprécié par tes amis.
    const friends = [...services.friendIds(userId)].filter((f) => !hidden.has(f));
    if (friends.length) {
      const rows = q(`SELECT item_id AS id, COUNT(*) AS n, AVG(score) AS avg, json_group_array(user_id) AS users FROM ratings
        WHERE user_id IN (SELECT value FROM json_each(?)) AND item_type = 'album' AND score >= 8
        GROUP BY item_id ORDER BY n DESC, avg DESC, item_id LIMIT 200`).all(json(friends));
      const list = withArtists(rows.map((r) => r.id));
      const fans = new Map(rows.map((r) => [r.id, JSON.parse(r.users)]));
      const ids = pick(list, { exclude: notMine, seen });
      const who = [...new Set(ids.slice(0, PAGE).flatMap((id) => fans.get(id) || []))];
      const summaries = services.userSummaries(who.slice(0, 3), userId, { hidden });
      add('friends', 'friends', list, {
        titleKey: 'discover.sections.friends', reason: { key: 'discover.reasons.friends', vars: { n: who.length } },
        users: [...summaries.values()],
      });
    }

    // 3. Albums cultes jamais notés.
    add('cult', 'cult', cultList(), { titleKey: 'discover.sections.cult', reason: { key: 'discover.reasons.cult', vars: { n: CULT_MIN } } });

    // 4. À compléter : albums recherchés, puis ceux à 50 % ou plus.
    const wanted = (services.wishlistAlbumIds?.(userId) || []).filter((id) => !v.completed.has(id));
    const half = q(`SELECT album_id FROM user_album_progress WHERE user_id = ? AND total > 0 AND owned < total AND owned * 2 >= total
      ORDER BY CAST(owned AS REAL) / total DESC, updated_at DESC LIMIT 60`).all(userId).map((r) => r.album_id);
    add('complete', 'complete', withArtists([...new Set([...wanted, ...half])]), {
      titleKey: 'discover.sections.complete', reason: { key: wanted.length ? 'discover.reasons.completeWanted' : 'discover.reasons.complete', vars: {} },
      exclude: (id) => v.completed.has(id), perArtist: 3,
    });

    // 5. Découvre une décennie.
    const dec = decadeFor(v);
    if (dec) {
      add('decade', 'decade', decadeList(dec.decade), {
        titleKey: 'discover.sections.decade', titleVars: { decade: dec.decade },
        reason: { key: dec.cold ? 'discover.reasons.decadeCold' : 'discover.reasons.decade', vars: { decade: dec.decade } },
      });
    }

    // 6. Ton genre.
    const gen = genreFor(v);
    if (gen) {
      add('genre', 'genre', genreList(gen.genre), {
        titleKey: 'discover.sections.genre', titleVars: { genre: gen.genre },
        reason: { key: gen.cold ? 'discover.reasons.genreCold' : 'discover.reasons.genre', vars: { genre: gen.genre } },
      });
    }

    // 7. Tendances ; 8. Nouveautés.
    add('trending', 'trending', trendingList(), { titleKey: 'discover.sections.trending', reason: { key: 'discover.reasons.trending', vars: { days: 7 } } });
    add('new', 'new', newList(), { titleKey: 'discover.sections.new', reason: { key: 'discover.reasons.new', vars: { days: 30 } } });

    // Compte tout neuf sur un catalogue sans notes : les albums les plus suivis.
    if (sections.length < 3) {
      add('popular', 'popular', popularList(), { titleKey: 'discover.sections.popular', reason: { key: 'discover.reasons.popular', vars: {} } });
    }
    return { sections, lists, usersOf, seedArtist: sections.find((s) => s.kind === 'artist')?.titleVars?.artistId || null };
  }

  /** Progression du joueur sur ces albums : { albumId: { owned, total } }. */
  function progressOf(userId, ids) {
    const out = {};
    if (!ids.length) return out;
    for (const r of q(`SELECT album_id, owned, total FROM user_album_progress WHERE user_id = ? AND album_id IN (SELECT value FROM json_each(?))`)
      .all(userId, json(ids))) out[r.album_id] = { owned: r.owned, total: r.total };
    return out;
  }

  const items = (ids) => ids.map((id) => ({ type: 'album', id }));
  const cursorAt = (list, offset) => (list.length > offset ? paging.encodeCursor([offset]) : null);

  /** Page complète d'un joueur (gardée 10 min). */
  function entryOf(userId) {
    return userCache.wrap(userId, () => {
      const built = build(userId);
      const shown = [];
      const sections = built.sections.map((s) => {
        const list = built.lists[s.id];
        const first = list.slice(0, PAGE);
        shown.push(...first);
        return { ...s, items: items(first), moreCursor: cursorAt(list, PAGE) };
      });
      const nine = q("SELECT item_count FROM lists WHERE user_id = ? AND kind = 'grid9'").get(userId)?.item_count || 0;
      const tiles = [
        { id: 'battles', to: '/battles' },
        { id: 'rankings', to: '/rankings' },
        { id: 'lists', to: '/lists' },
        { id: 'nine', to: '/nine', count: nine },
        { id: 'blindtest', to: '/blindtest' },
      ];
      const seeds = sections.map((s) => s.titleVars?.albumId).filter(Boolean);
      const avatars = services.summaryAlbums(Object.values(built.usersOf).flat());
      return {
        lists: built.lists,
        payload: {
          sections,
          tiles,
          progress: progressOf(userId, [...new Set(shown)]),
          catalog: deps.refs({ albumIds: [...shown, ...seeds, ...avatars], artistIds: built.seedArtist ? [built.seedArtist] : [] }),
        },
      };
    });
  }

  /** GET /discover */
  const page = (userId) => entryOf(Number(userId)).payload;

  /** GET /discover/:sectionId?cursor= → { items, nextCursor, progress, catalog } */
  function more(userId, sectionId, rawCursor) {
    if (!SECTION_IDS.includes(sectionId)) throw new HttpError(404, 'section_not_found');
    const list = entryOf(Number(userId)).lists[sectionId];
    if (!list) throw new HttpError(404, 'section_not_found');
    const offset = paging.offsetOf(rawCursor, { cap: SECTION_CAP });
    const rows = list.slice(offset, offset + PAGE + 1);
    const pageIds = rows.slice(0, PAGE);
    const { nextCursor } = paging.offsetPage(rows, offset, PAGE, { cap: SECTION_CAP });
    return { items: items(pageIds), nextCursor, progress: progressOf(Number(userId), pageIds), catalog: deps.refs({ albumIds: pageIds }) };
  }

  // La page d'un joueur change quand il note, obtient des cartes, change « Mes 9 albums » ou se fait un ami.
  const { bus } = deps;
  bus.on('rating.saved', ({ userId }) => forget(userId));
  bus.on('rating.deleted', ({ userId }) => forget(userId));
  bus.on('cards.added', ({ userId }) => forget(userId));
  bus.on('list.saved', ({ userId, kind }) => kind === 'grid9' && forget(userId));
  bus.on('friend.accepted', ({ userId, friendId }) => {
    forget(userId);
    forget(friendId);
  });

  return { page, more, similar, similarOf, forget };
}

export function routes(r, deps) {
  const { limits } = deps;
  const api = () => deps.discover;
  r.get('/discover', limits.read, (req, res) => res.json(api().page(req.user.id)));
  r.get('/discover/:sectionId', limits.read, (req, res) => res.json(api().more(req.user.id, req.params.sectionId, req.query.cursor)));
  r.get('/albums/:id/similar', limits.read, (req, res) => res.json(api().similar(req.params.id)));
}
