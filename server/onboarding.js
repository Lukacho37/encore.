// Module « onboarding » : premiers pas, profil musical (PLAN.md 4.2.7, 5.9). Chantier : P1-E.
//
// GET /onboarding?genres=a,b,c&artists=x,y&exclude=ids → { genres, artists, artistAlbums, albums, quickRate, mine, catalog } :
//   les 14 genres (avec leur nombre d'albums), les artistes les plus suivis des genres choisis (30 au plus, répartis
//   entre les genres), l'album le plus suivi de chacun (visuel de sa pastille), les albums populaires des artistes
//   choisis puis de chaque genre (étape « 9 albums »), 10 albums populaires de ces genres à noter vite (sans ceux de
//   `exclude` ni ceux déjà notés), et ce que le joueur avait déjà choisi (« Refaire mon profil musical »).
// POST /onboarding { genres (0 ou 3 à 14), artists (0 ou 3 à 10), grid9: [albumId ≤ 9], ratings: [{ albumId, score | null }] ≤ 10 }
//   ou { skip: true } → { result: { profile, recommendations, suggestedFriends, boosters, firstSteps }, state, catalog }.
//   Chaque étape peut être passée : une liste vide n'écrit rien pour elle. Écrit : onboarded_at (la première fois),
//   les favoris (user_favorites, 5 genres et 5 artistes au plus, remplacés), « Mes 9 albums » (deps.lists.setGrid9),
//   la liste d'envies (les 9 albums, deps.collection.addToWishlist), les notes rapides (deps.ratings.rate ; null = « Pas
//   écouté »), et une seule fois par compte les boosters de bienvenue thématiques : genre:<g> pour les 3 premiers
//   genres et un booster d'album au choix (album:choice) parmi les 9 albums (deps.collection.grantBooster, source
//   'onboarding'). Les 5 boosters de bienvenue de l'inscription restent. Refaire le parcours ne redonne rien.
import { THEME_GENRES } from '../shared/rules.js';
import { FIRST_STEPS } from '../shared/quests.js';
import { bayes } from '../shared/match.js';

export const name = 'onboarding';

export const GENRES_MIN = 3;
export const ARTISTS_MIN = 3;
export const ARTISTS_MAX = 10;
export const GRID_MAX = 9;
export const RATINGS_MAX = 10;
/** Favoris gardés par sorte (comme le Studio). */
export const FAVORITES_MAX = 5;
/** Boosters thématiques offerts (un par genre parmi les premiers). */
export const THEMED_BOOSTERS = 3;
const ARTISTS_LIST = 30;
const ALBUMS_PER_GENRE = 8;
const ALBUMS_PER_ARTIST = 4;
const QUICK = 10;
const RECOMMENDATIONS = 12;
const PER_ARTIST = 2;

export function init(deps) {
  const { db, catalog, services, HttpError, validate } = deps;
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
  const bad = (field) => new HttpError(400, 'invalid_input', { field });
  const decadeOf = (year) => (Number.isInteger(year) && year > 0 ? Math.floor(year / 10) * 10 : null);

  /** Genres valides d'une liste (tableau ou « a,b »), sans doublon, dans l'ordre reçu. */
  const genresOf = (raw) => validate.ids(raw, THEME_GENRES.length).filter((g) => THEME_GENRES.includes(g));

  /** Albums actifs parmi ces identifiants : Map id → { id, artistId, genre, year, fans }. */
  function albumsOf(ids) {
    if (!ids.length) return new Map();
    return new Map(q(`SELECT id, artist_id, genre, year, fans FROM cat_albums WHERE id IN (SELECT value FROM json_each(?)) AND status = 'active'`)
      .all(json(ids)).map((r) => [r.id, { id: r.id, artistId: r.artist_id, genre: r.genre, year: r.year, fans: r.fans }]));
  }

  /** Artistes actifs parmi ces identifiants : Map id → { id, genre }. */
  function artistsOf(ids) {
    if (!ids.length) return new Map();
    return new Map(q(`SELECT id, genre FROM cat_artists WHERE id IN (SELECT value FROM json_each(?)) AND status = 'active'`)
      .all(json(ids)).map((r) => [r.id, r]));
  }

  /** Listes rangées en alternance (une de chaque, puis la deuxième de chaque…), sans doublon, `max` au plus. */
  function interleave(lists, max) {
    const out = [];
    const seen = new Set();
    for (let i = 0; out.length < max && lists.some((l) => i < l.length); i++) {
      for (const l of lists) {
        const x = l[i];
        if (x === undefined || seen.has(x)) continue;
        seen.add(x);
        out.push(x);
        if (out.length >= max) break;
      }
    }
    return out;
  }

  /** Ce que le joueur a déjà choisi (favoris, « Mes 9 albums »), pour « Refaire mon profil musical ». */
  function mineOf(userId) {
    const favs = q('SELECT kind, item_id FROM user_favorites WHERE user_id = ? ORDER BY position, created_at').all(userId);
    const grid = deps.lists?.grid9Of?.(userId)?.slots?.filter(Boolean)
      || q(`SELECT li.item_id FROM lists l JOIN list_items li ON li.list_id = l.id WHERE l.user_id = ? AND l.kind = 'grid9' ORDER BY li.position`)
        .all(userId).map((r) => r.item_id);
    const onboarded = q('SELECT onboarded_at FROM users WHERE id = ?').get(userId)?.onboarded_at != null;
    return {
      genres: favs.filter((f) => f.kind === 'genre').map((f) => f.item_id).filter((g) => THEME_GENRES.includes(g)),
      artists: favs.filter((f) => f.kind === 'artist').map((f) => f.item_id),
      grid9: grid,
      onboarded,
    };
  }

  // ----- GET /onboarding -----------------------------------------------------------------------------

  function options(userId, query = {}) {
    const chosen = genresOf(query.genres);
    const chosenArtists = validate.ids(query.artists, ARTISTS_MAX);
    const exclude = new Set(validate.ids(query.exclude, GRID_MAX + RATINGS_MAX));
    const counts = new Map(catalog.genres().map((g) => [g.id, g.albums]));
    const genres = THEME_GENRES.map((id) => ({ id, albums: counts.get(id) || 0 })).filter((g) => g.albums > 0);

    // Artistes les plus suivis des genres choisis (ou de tout le catalogue), répartis entre les genres.
    const rows = chosen.length
      ? q(`SELECT id, genre FROM cat_artists WHERE status = 'active' AND genre IN (SELECT value FROM json_each(?)) ORDER BY fans DESC, id LIMIT 400`).all(json(chosen))
      : q("SELECT id, genre FROM cat_artists WHERE status = 'active' ORDER BY fans DESC, id LIMIT ?").all(ARTISTS_LIST);
    const byGenre = chosen.map((g) => rows.filter((r) => r.genre === g).map((r) => r.id));
    const artists = chosen.length ? interleave(byGenre, ARTISTS_LIST) : rows.map((r) => r.id);
    const known = artistsOf(chosenArtists);
    for (const id of chosenArtists) if (known.has(id) && !artists.includes(id)) artists.unshift(id);

    // Album le plus suivi de chaque artiste (visuel de sa pastille).
    const artistAlbums = {};
    if (artists.length) {
      for (const r of q(`SELECT artist_id, id FROM cat_albums WHERE artist_id IN (SELECT value FROM json_each(?)) AND status = 'active'
        ORDER BY fans DESC`).all(json(artists))) artistAlbums[r.artist_id] ??= r.id;
    }

    // Étape « 9 albums » : albums des artistes choisis, puis les plus suivis de chaque genre.
    const albums = [];
    const fromArtists = chosenArtists.filter((id) => known.has(id)).flatMap((a) => q(`SELECT id FROM cat_albums WHERE artist_id = ? AND status = 'active'
      ORDER BY fans DESC LIMIT ?`).all(a, ALBUMS_PER_ARTIST).map((r) => r.id));
    if (fromArtists.length) albums.push({ key: 'artists', items: fromArtists });
    const perGenre = (chosen.length ? chosen : THEME_GENRES.slice(0, 4)).map((g) => ({
      key: g,
      items: q(`SELECT id FROM cat_albums WHERE genre = ? AND status = 'active' ORDER BY fans DESC LIMIT ?`).all(g, ALBUMS_PER_GENRE).map((r) => r.id),
    })).filter((g) => g.items.length);
    albums.push(...perGenre);

    // Notes rapides : albums populaires de ces genres (en alternance), pas déjà notés ni dans `exclude`.
    const rated = new Set(q("SELECT item_id FROM ratings WHERE user_id = ? AND item_type = 'album'").all(userId).map((r) => r.item_id));
    const pools = (chosen.length ? chosen : THEME_GENRES).map((g) => q(`SELECT id FROM cat_albums WHERE genre = ? AND status = 'active'
      ORDER BY fans DESC LIMIT 30`).all(g).map((r) => r.id).filter((id) => !exclude.has(id) && !rated.has(id)));
    const quickRate = interleave(pools, QUICK);

    const albumIds = [...albums.flatMap((g) => g.items), ...quickRate, ...Object.values(artistAlbums)];
    return {
      genres,
      artists,
      artistAlbums,
      albums,
      quickRate,
      mine: mineOf(userId),
      catalog: deps.refs({ albumIds, artistIds: artists }),
    };
  }

  // ----- POST /onboarding ----------------------------------------------------------------------------

  /** Corps reçu → { genres, artists, grid9, ratings } validés (400 invalid_input { field } sinon). */
  function parse(body = {}) {
    if (body.genres !== undefined && !Array.isArray(body.genres)) throw bad('genres');
    const genres = genresOf(body.genres || []);
    if (genres.length && genres.length < GENRES_MIN) throw bad('genres');
    if (body.artists !== undefined && !Array.isArray(body.artists)) throw bad('artists');
    const askedArtists = validate.ids(body.artists || [], ARTISTS_MAX + 1);
    if (askedArtists.length > ARTISTS_MAX) throw bad('artists');
    const known = artistsOf(askedArtists);
    const artists = askedArtists.filter((id) => known.has(id));
    if (artists.length && artists.length < ARTISTS_MIN) throw bad('artists');
    if (body.grid9 !== undefined && (!Array.isArray(body.grid9) || body.grid9.length > GRID_MAX)) throw bad('grid9');
    const askedGrid = validate.ids((body.grid9 || []).filter(Boolean), GRID_MAX);
    const gridAlbums = albumsOf(askedGrid);
    const grid9 = askedGrid.filter((id) => gridAlbums.has(id));
    if (body.ratings !== undefined && (!Array.isArray(body.ratings) || body.ratings.length > RATINGS_MAX)) throw bad('ratings');
    const ratings = [];
    const seen = new Set();
    for (const r of body.ratings || []) {
      const albumId = validate.id(r?.albumId);
      if (!albumId || seen.has(albumId)) continue;
      if (r.score === null || r.score === undefined) continue; // « Pas écouté »
      if (!Number.isInteger(r.score) || r.score < 0 || r.score > 10) throw bad('ratings');
      seen.add(albumId);
      ratings.push({ albumId, score: r.score });
    }
    const ratedAlbums = albumsOf(ratings.map((r) => r.albumId));
    return { genres, artists, artistInfo: known, grid9, gridAlbums, ratings: ratings.filter((r) => ratedAlbums.has(r.albumId)), ratedAlbums };
  }

  /** Remplace les favoris d'une sorte (5 au plus, dans l'ordre). */
  function writeFavorites(userId, kind, ids) {
    const now = Date.now();
    deps.tx(() => {
      q('DELETE FROM user_favorites WHERE user_id = ? AND kind = ?').run(userId, kind);
      ids.slice(0, FAVORITES_MAX).forEach((id, position) => {
        q('INSERT OR IGNORE INTO user_favorites (user_id, kind, item_id, position, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, kind, id, position, now);
      });
    });
  }

  /** Genres du profil : ceux choisis, rangés selon le nombre d'artistes et d'albums choisis de chaque genre. */
  function rankGenres(input) {
    const weight = new Map();
    const bump = (g) => g && weight.set(g, (weight.get(g) || 0) + 1);
    for (const id of input.artists) bump(input.artistInfo.get(id)?.genre);
    for (const id of input.grid9) bump(input.gridAlbums.get(id)?.genre);
    for (const r of input.ratings) if (r.score >= 6) bump(input.ratedAlbums.get(r.albumId)?.genre);
    const base = input.genres.length ? input.genres : [...weight.keys()].filter((g) => THEME_GENRES.includes(g));
    return base.map((g, i) => [g, weight.get(g) || 0, i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map(([g]) => g);
  }

  /** 90e centile du nombre de fans des albums (« albums cultes »), gardé jusqu'au prochain import. */
  let fansCut = null;
  function cultCut() {
    if (fansCut !== null) return fansCut;
    const total = q("SELECT COUNT(*) AS n FROM cat_albums WHERE status = 'active'").get().n;
    fansCut = total ? q("SELECT fans FROM cat_albums WHERE status = 'active' ORDER BY fans DESC LIMIT 1 OFFSET ?").get(Math.floor(total / 10))?.fans ?? 0 : 0;
    return fansCut;
  }

  /** Profil musical : { genres, decades, flavour } (la phrase est composée par le site depuis ces morceaux). */
  function profileOf(input, topGenres) {
    const albums = [...input.grid9.map((id) => input.gridAlbums.get(id)), ...input.ratings.filter((r) => r.score >= 6).map((r) => input.ratedAlbums.get(r.albumId))]
      .filter(Boolean);
    const decades = new Map();
    for (const a of albums) {
      const d = decadeOf(a.year);
      if (d) decades.set(d, (decades.get(d) || 0) + 1);
    }
    const topDecades = [...decades].sort((a, b) => b[1] - a[1] || b[0] - a[0]).slice(0, 2).map(([d]) => d);
    let flavour = null;
    if (albums.length >= 3) {
      const cut = cultCut();
      const cult = albums.filter((a) => a.fans >= cut).length / albums.length;
      const years = albums.map((a) => a.year).filter((y) => y > 0);
      const avgYear = years.length ? years.reduce((s, y) => s + y, 0) / years.length : null;
      if (cult >= 0.6) flavour = 'cult';
      else if (cult <= 0.2) flavour = 'gems';
      else if (avgYear && avgYear >= 2015) flavour = 'recent';
      else if (avgYear && avgYear < 1985) flavour = 'classics';
      else flavour = 'mixed';
    }
    return { genres: topGenres.slice(0, 3), decades: topDecades, flavour };
  }

  /**
   * 12 recommandations : autres albums des artistes choisis (les plus suivis, hors des 9), meilleurs albums des
   * genres choisis jamais notés, albums proches des 9 ; en alternance, sans doublon, 2 par artiste au plus.
   */
  function recommend(userId, input, topGenres) {
    const rated = new Set(q("SELECT item_id FROM ratings WHERE user_id = ? AND item_type = 'album'").all(userId).map((r) => r.item_id));
    const skip = new Set([...input.grid9, ...rated]);
    const fromArtists = input.artists.flatMap((a) => q(`SELECT id, artist_id FROM cat_albums WHERE artist_id = ? AND status = 'active'
      ORDER BY fans DESC LIMIT 4`).all(a)).filter((r) => !skip.has(r.id)).map((r) => ({ id: r.id, artistId: r.artist_id, reason: 'artist' }));
    const fromGenres = [];
    for (const g of topGenres.slice(0, 3)) {
      const rows = q(`SELECT al.id, al.artist_id, al.fans, rs.count, rs.sum FROM cat_albums al
        LEFT JOIN rating_stats rs ON rs.item_type = 'album' AND rs.item_id = al.id
        WHERE al.genre = ? AND al.status = 'active' ORDER BY al.fans DESC LIMIT 120`).all(g);
      rows.sort((a, b) => bayes(b.sum || 0, b.count || 0) - bayes(a.sum || 0, a.count || 0) || b.fans - a.fans);
      fromGenres.push(...rows.filter((r) => !skip.has(r.id)).slice(0, 12).map((r) => ({ id: r.id, artistId: r.artist_id, reason: 'genre' })));
    }
    const fromSimilar = input.grid9.slice(0, 5).flatMap((id) => deps.discover?.similarOf?.(id) || [])
      .filter((r) => !skip.has(r.id)).map((r) => ({ id: r.id, artistId: r.artistId, reason: 'similar' }));
    const out = [];
    const seen = new Set();
    const perArtist = new Map();
    const lists = [fromArtists, fromGenres, fromSimilar];
    for (let i = 0; out.length < RECOMMENDATIONS && lists.some((l) => i < l.length); i++) {
      for (const l of lists) {
        const r = l[i];
        if (!r || seen.has(r.id)) continue;
        const n = perArtist.get(r.artistId) || 0;
        if (n >= PER_ARTIST) continue;
        seen.add(r.id);
        perArtist.set(r.artistId, n + 1);
        out.push({ id: r.id, reason: r.reason });
        if (out.length >= RECOMMENDATIONS) break;
      }
    }
    // Compte qui a tout passé : les albums les plus suivis.
    if (out.length < RECOMMENDATIONS) {
      for (const r of q("SELECT id, artist_id FROM cat_albums WHERE status = 'active' ORDER BY fans DESC LIMIT 60").all()) {
        if (out.length >= RECOMMENDATIONS) break;
        if (seen.has(r.id) || skip.has(r.id) || (perArtist.get(r.artist_id) || 0) >= PER_ARTIST) continue;
        seen.add(r.id);
        perArtist.set(r.artist_id, (perArtist.get(r.artist_id) || 0) + 1);
        out.push({ id: r.id, reason: 'popular' });
      }
    }
    return out;
  }

  /** Boosters de bienvenue thématiques, une seule fois par compte ; renvoie ceux de l'onboarding pas encore ouverts. */
  function grantBoosters(userId, topGenres, input) {
    const already = !!q("SELECT 1 FROM user_boosters WHERE user_id = ? AND source = 'onboarding' LIMIT 1").get(userId);
    if (!already) {
      for (const g of topGenres.slice(0, THEMED_BOOSTERS)) deps.collection?.grantBooster?.(userId, `genre:${g}`, null, 'onboarding');
      if (input.grid9.length) deps.collection?.grantBooster?.(userId, 'album:choice', null, 'onboarding');
    }
    return q("SELECT id, kind, theme FROM user_boosters WHERE user_id = ? AND source = 'onboarding' AND opened_at IS NULL ORDER BY id").all(userId)
      .map((r) => ({ id: r.id, kind: r.kind, theme: r.theme }));
  }

  function submit(user, body = {}) {
    const userId = user.id;
    const skip = body.skip === true;
    const input = skip
      ? { genres: [], artists: [], artistInfo: new Map(), grid9: [], gridAlbums: new Map(), ratings: [], ratedAlbums: new Map() }
      : parse(body);
    const topGenres = rankGenres(input);

    if (topGenres.length) writeFavorites(userId, 'genre', topGenres);
    if (input.artists.length) writeFavorites(userId, 'artist', input.artists);
    if (input.grid9.length) {
      deps.lists?.setGrid9?.(userId, input.grid9);
      const completed = new Set(q(`SELECT album_id FROM user_album_progress WHERE user_id = ? AND total > 0 AND owned >= total
        AND album_id IN (SELECT value FROM json_each(?))`).all(userId, json(input.grid9)).map((r) => r.album_id));
      deps.collection?.addToWishlist?.(userId, input.grid9.filter((id) => !completed.has(id)));
    }
    for (const r of input.ratings) deps.ratings.rate(userId, 'album', r.albumId, r.score);
    const boosters = grantBoosters(userId, topGenres, input);
    q('UPDATE users SET onboarded_at = COALESCE(onboarded_at, ?) WHERE id = ?').run(Date.now(), userId);
    // Goûts changés : profil du Taste Match et page Découvrir recalculés.
    deps.match?.forget?.(userId);
    deps.discover?.forget?.(userId);

    const profile = profileOf(input, topGenres);
    const recommendations = recommend(userId, input, topGenres);
    const friends = deps.match?.suggestions?.(userId, { limit: 6, fresh: true }) || { items: [], catalog: {} };
    const suggestedFriends = friends.items.slice(0, 6);
    const albumIds = [...recommendations.map((r) => r.id), ...input.grid9, ...boosters.map((b) => (b.theme.startsWith('album:') && b.theme !== 'album:choice' ? b.theme.slice(6) : null)).filter(Boolean),
      ...services.summaryAlbums(suggestedFriends.map((s) => s.user))];
    return {
      result: {
        profile,
        recommendations,
        suggestedFriends,
        boosters,
        grid9: input.grid9,
        firstSteps: FIRST_STEPS.map((s) => ({ id: s.id, metric: s.metric, target: s.target })),
      },
      state: services.state(userId, { partial: true }),
      catalog: deps.refs({ albumIds, artistIds: suggestedFriends.flatMap((s) => s.artists || []) }),
    };
  }

  return { options, submit };
}

export function routes(r, deps) {
  const { limits } = deps;
  const api = () => deps.onboarding;
  r.get('/onboarding', limits.read, (req, res) => res.json(api().options(req.user.id, req.query)));
  r.post('/onboarding', limits.write, (req, res) => res.json(api().submit(req.user, req.body)));
}
