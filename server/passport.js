// Module « passport » : passeport musical et AlbumMania Rétro (PLAN.md 2.5, 4.3, 5.8). Chantier : P2-A.
//
// Routes (joueur connecté) :
//   GET /api/passport                     son propre passeport
//   GET /api/users/:username/passport     celui d'un autre (confidentialité du Studio)
//   GET /api/retro/:year                  son Rétro de l'année (l'année en cours ouvre le 1er décembre, heure de Paris)
//
// Passeport → { totals, favorites, distributions: { genres, decades, countries, countriesKnown, rarities, ratings },
//   timeline: [{ month, start, cards, ratings, completions }] (12 mois, heure de Paris), evolution: { quarters, genres,
//   shift }, memberSince, computedAt, owner (UserSummary), self, retro: { years, current } (soi seulement), catalog }.
// Rétro → { year, status: 'open', totals, months (12), top: { artist, artists, albums, collected, genres, decades },
//   rarities, moments: { firstCard, firstCompletion, rarestPull, busiestMonth, lowestPressing }, thin, years, owner,
//   computedAt, catalog } ; l'année en cours avant le 1er décembre : { year, status: 'locked', opensAt, years, owner }.
//   Année hors de [2020, année en cours] ou d'avant l'inscription : 404 retro_not_found { years }.
//
// Calcul : uniquement des requêtes bornées par le joueur, sur ses index (user_album_progress par clé primaire,
// cards_user_first, ratings_user_time, ach_user_time, battle_votes_user, idx_openings_user…), jamais de parcours du
// catalogue. Les cartes sont lues par tranches de 8 000 lignes, avec une pause de la boucle d'événements entre deux
// tranches : même pour le plus gros joueur de la base peuplée (60 000 cartes), aucune requête ne bloque le serveur
// plus de quelques dizaines de millisecondes. Raretés : cartes × morceaux (≈ 50 ms en tout pour ce joueur), d'où le cache.
// Cache : user_stats_cache, clés `passport` et `retro:<année>` (1 h ; 24 h pour une année terminée). Une action du
// joueur (cartes, notes, vinyles, listes, duels, favoris) marque son cache comme ancien : il est recalculé à la visite
// suivante, au plus une fois par minute. Un recalcul compte dans la limite `heavy` (20 par minute) ; une lecture du
// cache, non. Deux demandes simultanées du même calcul n'en lancent qu'un.
// Confidentialité : un joueur bloqué dans un sens ou dans l'autre n'existe pas (404 user_not_found) ; un Studio
// « amis » n'est lisible que par ses amis, un Studio « privé » par son seul propriétaire (403 passport_private) ; les
// listes comptées pour un autre sont celles qu'il peut voir ; les critiques masquées par la modération ne comptent pas.
// Pays : seulement quand le pays de l'artiste est connu (graine, ou source renseignée par l'enrichissement de P2-C) ;
// `countriesKnown` donne la part des cartes concernées (« données partielles » sur le site).
// API interne (deps.passport) : passportOf(userId), retroOf(userId, year), retroInfo(userId), retroState(year, now),
// forget(userId), isFresh(userId, key).
import { RARITIES } from '../shared/rules.js';
import { parisDate, parisMidnight } from '../shared/periods.js';

export const name = 'passport';

/** Durée de vie du cache : passeport et Rétro de l'année en cours ; Rétro d'une année terminée. */
export const PASSPORT_TTL_MS = 60 * 60_000;
export const RETRO_PAST_TTL_MS = 24 * 60 * 60_000;
/** Délai minimal entre deux recalculs après une action du joueur. */
export const STALE_MIN_MS = 60_000;
/** Première année proposée pour un Rétro. */
export const RETRO_FIRST_YEAR = 2020;
/** Version du contenu gardé en cache (une nouvelle version recalcule tout). */
export const CACHE_VERSION = 1;
/** Cartes lues par tranche ; albums commencés par page ; éléments des classements. */
export const CHUNK_ROWS = 8000;
const UAP_PAGE = 4000;
const TOP = 5;
/** Lignes de cache plus vieilles que 30 jours effacées par la tâche de nuit. */
const CACHE_PURGE_MS = 30 * 86_400_000;
/** Rétention de pack_openings (PLAN.md 3.8) : au-delà, le nombre de boosters ouverts est incomplet. */
const OPENINGS_KEPT_MS = 400 * 86_400_000;
/** Artiste favori : points = cartes + 4 × (note − 5) des albums notés au-dessus de 5/10 + 20 s'il est en favori. */
export const ARTIST_RATING_WEIGHT = 4;
export const ARTIST_FAVORITE_BONUS = 20;
/** Raretés de la plus rare à la plus commune (« ma pépite » du Rétro). */
export const RARE_ORDER = ['legendary', 'promo', 'ultra', 'super', 'rare', 'uncommon', 'common'];
/** Une année « légère » : peu de cartes et de notes, aucun vinyle (le site adapte ses phrases). */
export const THIN_CARDS = 30;
export const THIN_RATINGS = 5;

const pad = (n) => String(n).padStart(2, '0');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const decadeOf = (year) => (Number.isInteger(year) && year > 0 ? Math.floor(year / 10) * 10 : null);
const round1 = (x) => Math.round(x * 10) / 10;
/** Part de 0 à 1, arrondie au millième. */
const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : 0);

/** Clé « AAAA-MM » du mois (heure de Paris) qui contient `ms`. */
export function monthKey(ms) {
  const { y, m } = parisDate(ms);
  return `${y}-${pad(m)}`;
}

/** Les `count` derniers mois civils à Paris (le mois en cours compris), du plus ancien au plus récent. */
export function monthWindows(now = Date.now(), count = 12) {
  const { y, m } = parisDate(now);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = parisMidnight(y, m - i, 1);
    out.push({ key: monthKey(start), start, end: parisMidnight(y, m - i + 1, 1) });
  }
  return out;
}

/** Les `count` derniers trimestres civils à Paris (le trimestre en cours compris) : { key: '2026-T3', start, end }. */
export function quarterWindows(now = Date.now(), count = 4) {
  const { y, m } = parisDate(now);
  const first = m - ((m - 1) % 3);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = parisMidnight(y, first - 3 * i, 1);
    const d = parisDate(start);
    out.push({ key: `${d.y}-T${Math.floor((d.m - 1) / 3) + 1}`, start, end: parisMidnight(y, first - 3 * i + 3, 1) });
  }
  return out;
}

/** Les 12 mois d'une année civile à Paris. */
export function yearMonths(year) {
  return Array.from({ length: 12 }, (_, i) => {
    const start = parisMidnight(year, i + 1, 1);
    return { key: `${year}-${pad(i + 1)}`, start, end: parisMidnight(year, i + 2, 1) };
  });
}

/** Ouverture du Rétro d'une année : le 1er décembre à minuit, heure de Paris. */
export const retroOpensAt = (year) => parisMidnight(year, 12, 1);

/** État du Rétro d'une année : 'open' (année passée, ou décembre), 'locked' (année en cours avant décembre), 'future'. */
export function retroState(year, now = Date.now()) {
  const current = parisDate(now).y;
  if (year > current) return 'future';
  if (year === current && now < retroOpensAt(year)) return 'locked';
  return 'open';
}

/** Index dans un tableau de fenêtres [start, end) triées et contiguës, ou -1. */
function bucketOf(windows, at) {
  if (!windows.length || at < windows[0].start || at >= windows[windows.length - 1].end) return -1;
  let lo = 0;
  let hi = windows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (windows[mid].start <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const inc = (map, key, n = 1) => {
  if (key == null || !n) return;
  map.set(key, (map.get(key) || 0) + n);
};

/** Ajoute `cards` cartes (et un album) à la clé `key` d'une Map clé → { cards, albums }. */
const addTo = (map, key, cards, albums = 1) => {
  if (key == null) return;
  const v = map.get(key) || { cards: 0, albums: 0 };
  v.cards += cards;
  v.albums += albums;
  map.set(key, v);
};

/** Répartition { [keyName], cards, albums, share } d'une Map clé → { cards, albums } (sans les clés vides). */
const shares = (map, total, keyName = 'id') => [...map]
  .map(([k, v]) => ({ [keyName]: k, cards: v.cards, albums: v.albums, share: ratio(v.cards, total) }))
  .filter((x) => x.cards > 0);

/** Classement des artistes : cartes, notes d'albums au-dessus de 5/10, favori (voir ARTIST_*). */
export function rankArtists(cards, rated, favorites) {
  const ids = new Set([...cards.keys(), ...rated.keys(), ...favorites]);
  return [...ids].map((id) => {
    const r = rated.get(id) || { n: 0, plus: 0 };
    const favorite = favorites.has(id);
    const c = cards.get(id) || { cards: 0, albums: 0 };
    return { id, cards: c.cards, albums: c.albums, rated: r.n, favorite, points: c.cards + ARTIST_RATING_WEIGHT * r.plus + (favorite ? ARTIST_FAVORITE_BONUS : 0) };
  }).filter((a) => a.points > 0).sort((a, b) => b.points - a.points || b.cards - a.cards || (a.id < b.id ? -1 : 1));
}

/**
 * Genre qui a le plus gagné entre le premier et le dernier trimestre qui comptent au moins 3 découvertes :
 * { genre, from, to, fromKey, toKey } (parts de 0 à 1), ou null (moins de deux trimestres, ou hausse de moins de 10 points).
 */
export function shiftOf(quarters, genres) {
  const filled = quarters.filter((qt) => qt.total >= 3);
  if (filled.length < 2) return null;
  const a = filled[0];
  const b = filled[filled.length - 1];
  let out = null;
  for (const g of genres) {
    const from = ratio(a.genres[g] || 0, a.total);
    const to = ratio(b.genres[g] || 0, b.total);
    if (to - from >= 0.1 && (!out || to - from > out.to - out.from)) out = { genre: g, from, to, fromKey: a.key, toKey: b.key };
  }
  return out;
}

export function init(deps) {
  const { db, services, catalog, HttpError, bus } = deps;
  const statements = new Map();
  /** Requête préparée une fois par texte SQL. */
  const q = (sql) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    return st;
  };
  const json = (v) => JSON.stringify(v);
  const access = () => deps.access || {};

  // ----- cache ------------------------------------------------------------------------------------

  /** Dernière action de chaque joueur qui change ses statistiques (mémoire du processus, bornée). */
  const touched = new Map();
  const TOUCHED_MAX = 50_000;
  function touch(userId) {
    const id = Number(userId);
    if (!Number.isInteger(id)) return;
    touched.delete(id);
    touched.set(id, Date.now());
    if (touched.size > TOUCHED_MAX) touched.delete(touched.keys().next().value);
  }
  for (const event of ['cards.added', 'rating.saved', 'rating.deleted', 'album.completed', 'artist.mastered', 'list.saved', 'battle.voted', 'favorites.saved']) {
    bus.on(event, (p) => touch(p?.userId));
  }

  /** Année d'une clé `retro:<année>`, ou null (passeport). */
  const yearOfKey = (key) => (key.startsWith('retro:') ? Number(key.slice(6)) : null);

  /** Ligne de cache encore valable (durée de vie, version, pas d'action du joueur depuis plus d'une minute), sinon null. */
  function cached(userId, key, now = Date.now()) {
    const row = q('SELECT data, computed_at FROM user_stats_cache WHERE user_id = ? AND key = ?').get(userId, key);
    if (!row) return null;
    const age = now - row.computed_at;
    const year = yearOfKey(key);
    const past = year != null && year < parisDate(now).y;
    if (age >= (past ? RETRO_PAST_TTL_MS : PASSPORT_TTL_MS)) return null;
    if (!past && (touched.get(userId) || 0) > row.computed_at && age >= STALE_MIN_MS) return null;
    try {
      const data = JSON.parse(row.data);
      return data?.v === CACHE_VERSION ? data : null;
    } catch {
      return null;
    }
  }

  /** Le calcul `key` de ce joueur est-il en cache ? (la limite `heavy` ne compte que les recalculs) */
  const isFresh = (userId, key) => !!cached(Number(userId), String(key).slice(0, 16));

  const inflight = new Map();
  /** Valeur en cache, sinon calculée une fois (demandes simultanées partagées) puis gardée. */
  function through(userId, key, compute) {
    const hit = cached(userId, key);
    if (hit) return Promise.resolve(hit);
    const id = `${userId}:${key}`;
    if (inflight.has(id)) return inflight.get(id);
    const job = (async () => {
      const data = await compute();
      q('INSERT OR REPLACE INTO user_stats_cache (user_id, key, data, computed_at) VALUES (?, ?, ?, ?)')
        .run(userId, key, json(data), data.computedAt);
      return data;
    })().finally(() => inflight.delete(id));
    inflight.set(id, job);
    return job;
  }

  /** Oublie le passeport et les Rétro gardés d'un joueur. */
  function forget(userId) {
    q("DELETE FROM user_stats_cache WHERE user_id = ? AND (key = 'passport' OR key LIKE 'retro:%')").run(Number(userId));
  }

  // ----- lectures bornées ------------------------------------------------------------------------------

  /**
   * Cartes du joueur obtenues dans [start, end), jointes à leur morceau et groupées par `groupBy` (texte SQL fixe du
   * module, jamais reçu d'une requête), par tranches de CHUNK_ROWS lignes de l'index cards_user_first. Chaque groupe
   * donne n (lignes), holo, et sa carte la plus ancienne (trackId, variant, first : colonnes nues de l'unique MIN()).
   */
  async function scanCards(userId, start, end, groupBy, onRow) {
    const sql = `SELECT ${groupBy}, COUNT(*) AS n, SUM(c.variant = 'holo') AS holo, c.track_id AS trackId, c.variant AS variant,
        MIN(c.first_at) AS first
      FROM cards c JOIN cat_tracks t ON t.id = c.track_id
      WHERE c.user_id = ? AND c.first_at >= ? AND c.first_at < ? GROUP BY ${groupBy}`;
    let a = start;
    while (a < end) {
      const edge = q('SELECT first_at FROM cards WHERE user_id = ? AND first_at >= ? AND first_at < ? ORDER BY first_at LIMIT 1 OFFSET ?')
        .get(userId, a, end, CHUNK_ROWS)?.first_at;
      const b = edge && edge > a ? edge : end;
      for (const row of q(sql).all(userId, a, b)) onRow(row);
      a = b;
      if (a < end) await tick();
    }
  }

  /** Albums commencés (user_album_progress, page par page de sa clé primaire) avec leur artiste, genre et année. */
  async function scanAlbums(userId, onRow) {
    let after = '';
    for (;;) {
      const rows = q(`SELECT p.album_id AS id, p.owned, p.total, p.first_at AS firstAt, al.artist_id AS artistId, al.genre, al.year,
          ar.country, ar.source AS artistSource, ar.country_source AS countrySource
        FROM user_album_progress p JOIN cat_albums al ON al.id = p.album_id JOIN cat_artists ar ON ar.id = al.artist_id
        WHERE p.user_id = ? AND p.album_id > ? ORDER BY p.album_id LIMIT ?`).all(userId, after, UAP_PAGE);
      for (const r of rows) onRow(r);
      if (rows.length < UAP_PAGE) return;
      after = rows[rows.length - 1].id;
      await tick();
    }
  }

  /** Pays connu d'un artiste : celui de la graine, ou un pays dont la source est renseignée (enrichissement P2-C). */
  const knownCountry = (r) => (r.country && (r.artistSource !== 'deezer' || r.countrySource) ? r.country : null);

  /** Nombre de lignes par fenêtre [start, end) (requête COUNT sur un index (user_id, date) du joueur). */
  const countByWindow = (sql, userId, windows) => windows.map((w) => q(sql).get(userId, w.start, w.end).n);
  const CARDS_IN = 'SELECT COUNT(*) AS n FROM cards WHERE user_id = ? AND first_at >= ? AND first_at < ?';
  const RATINGS_IN = 'SELECT COUNT(*) AS n FROM ratings WHERE user_id = ? AND created_at >= ? AND created_at < ?';

  /** Artistes des albums notés (dans [start, end) si donné) : Map artiste → { n, plus } (plus = Σ max(note − 5, 0)). */
  function ratedArtists(userId, start = 0, end = Number.MAX_SAFE_INTEGER) {
    return new Map(q(`SELECT al.artist_id AS id, COUNT(*) AS n, SUM(MAX(r.score - 5, 0)) AS plus FROM ratings r
      JOIN cat_albums al ON al.id = r.item_id
      WHERE r.user_id = ? AND r.item_type = 'album' AND r.created_at >= ? AND r.created_at < ? GROUP BY al.artist_id`).all(userId, start, end)
      .map((r) => [r.id, { n: r.n, plus: r.plus || 0 }]));
  }

  const favoriteArtists = (userId) => new Set(q("SELECT item_id FROM user_favorites WHERE user_id = ? AND kind = 'artist'").all(userId).map((r) => r.item_id));

  // ----- passeport --------------------------------------------------------------------------------------

  async function computePassport(userId) {
    const now = Date.now();
    const user = q('SELECT id, created_at, unique_cards FROM users WHERE id = ?').get(userId);
    if (!user) throw new HttpError(404, 'user_not_found');
    const months = monthWindows(now, 12).map((w) => ({ ...w, cards: 0, ratings: 0, completions: 0 }));
    const quarters = quarterWindows(now, 4).map((w) => ({ ...w, total: 0, genres: new Map() }));
    const discover = (at, genre) => {
      const qi = bucketOf(quarters, at);
      if (qi < 0 || !genre) return;
      inc(quarters[qi].genres, genre);
      quarters[qi].total += 1;
    };

    // Albums commencés : artistes, genres, décennies, pays, albums les plus collectionnés, découvertes par trimestre.
    const artistCards = new Map();
    const genres = new Map();
    const decades = new Map();
    const countries = new Map();
    const countryArtists = new Map();
    const collected = [];
    let albumCards = 0;
    let knownCards = 0;
    await scanAlbums(userId, (r) => {
      albumCards += r.owned;
      addTo(artistCards, r.artistId, r.owned);
      addTo(genres, r.genre, r.owned);
      addTo(decades, decadeOf(r.year), r.owned);
      const country = knownCountry(r);
      if (country) {
        knownCards += r.owned;
        addTo(countries, country, r.owned);
        if (!countryArtists.has(country)) countryArtists.set(country, new Set());
        countryArtists.get(country).add(r.artistId);
      }
      collected.push({ id: r.id, owned: r.owned, total: r.total });
      discover(r.firstAt, r.genre);
    });
    await tick();

    // Raretés : morceaux distincts par rareté (une ligne par version, moins les morceaux qui ont les deux versions).
    const rarity = new Map(RARITIES.map((r) => [r, { cards: 0, holo: 0 }]));
    await scanCards(userId, 0, Number.MAX_SAFE_INTEGER, 't.rarity', (row) => {
      const v = rarity.get(row.rarity);
      if (!v) return;
      v.cards += row.n;
      v.holo += row.holo;
    });
    for (const r of q(`SELECT t.rarity, COUNT(*) AS n FROM cards h
        JOIN cards s ON s.user_id = h.user_id AND s.track_id = h.track_id AND s.variant = 'std'
        JOIN cat_tracks t ON t.id = h.track_id
      WHERE h.user_id = ? AND h.variant = 'holo' GROUP BY t.rarity`).all(userId)) {
      const v = rarity.get(r.rarity);
      if (v) v.cards -= r.n;
    }
    const catalogRarity = catalog.rarityTotals();
    await tick();

    // Notes : nombre, moyenne, distribution, critiques, albums les mieux notés, artistes notés, découvertes par trimestre.
    const dist = Array(11).fill(0);
    for (const r of q('SELECT score, COUNT(*) AS n FROM ratings WHERE user_id = ? GROUP BY score').all(userId)) {
      if (r.score >= 0 && r.score <= 10) dist[r.score] = r.n;
    }
    const ratingCount = dist.reduce((s, n) => s + n, 0);
    const ratingSum = dist.reduce((s, n, i) => s + n * i, 0);
    const reviews = q('SELECT COUNT(*) AS n FROM ratings WHERE user_id = ? AND review_at IS NOT NULL AND hidden_at IS NULL').get(userId).n;
    const best = q(`SELECT r.item_id AS id, r.score FROM ratings r JOIN cat_albums al ON al.id = r.item_id
      WHERE r.user_id = ? AND r.item_type = 'album' ORDER BY r.score DESC, r.updated_at DESC LIMIT ?`).all(userId, TOP);
    const rated = ratedArtists(userId);
    for (const r of q(`SELECT al.genre, r.created_at AS at FROM ratings r JOIN cat_albums al ON al.id = r.item_id
      WHERE r.user_id = ? AND r.item_type = 'album' AND r.created_at >= ?`).all(userId, quarters[0].start)) {
      discover(r.at, r.genre);
    }

    // Vinyles et maîtrises (succès encore au catalogue), vinyles par mois.
    const done = q(`SELECT
        (SELECT COUNT(*) FROM achievements a JOIN cat_albums al ON al.id = substr(a.key, 7)
          WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;') AS albums,
        (SELECT COUNT(*) FROM achievements a JOIN cat_artists ar ON ar.id = substr(a.key, 8)
          WHERE a.user_id = ? AND a.key >= 'artist:' AND a.key < 'artist;') AS artists`).get(userId, userId);
    for (const r of q("SELECT created_at AS at FROM achievements WHERE user_id = ? AND created_at >= ? AND key >= 'album:' AND key < 'album;'")
      .all(userId, months[0].start)) {
      const mi = bucketOf(months, r.at);
      if (mi >= 0) months[mi].completions += 1;
    }

    // Cartes et notes par mois (comptes sur les index du joueur).
    countByWindow(CARDS_IN, userId, months).forEach((n, i) => { months[i].cards = n; });
    countByWindow(RATINGS_IN, userId, months).forEach((n, i) => { months[i].ratings = n; });

    // Listes (par visibilité : un autre ne compte que celles qu'il peut voir), duels, favoris, boosters ouverts.
    const lists = { public: 0, friends: 0, private: 0 };
    for (const r of q("SELECT visibility, COUNT(*) AS n FROM lists WHERE user_id = ? AND kind = 'list' AND hidden_at IS NULL GROUP BY visibility").all(userId)) {
      if (r.visibility in lists) lists[r.visibility] = r.n;
    }
    const battleVotes = q('SELECT COUNT(*) AS n FROM battle_votes WHERE user_id = ? AND winner_id IS NOT NULL').get(userId).n;
    const favGenres = q("SELECT item_id FROM user_favorites WHERE user_id = ? AND kind = 'genre' ORDER BY position, created_at").all(userId).map((r) => r.item_id);
    const boosters = q('SELECT COUNT(*) AS n FROM pack_openings WHERE user_id = ? AND created_at >= ?').get(userId, months[0].start).n;

    // Assemblage.
    const artists = rankArtists(artistCards, rated, favoriteArtists(userId));
    const genreList = shares(genres, albumCards).sort((a, b) => b.cards - a.cards || (a.id < b.id ? -1 : 1));
    const decadeList = shares(decades, albumCards, 'decade').sort((a, b) => a.decade - b.decade);
    const countryList = shares(countries, knownCards, 'code')
      .map((c) => ({ ...c, artists: countryArtists.get(c.code)?.size || 0 }))
      .sort((a, b) => b.cards - a.cards).slice(0, 10);
    const holo = [...rarity.values()].reduce((s, v) => s + v.holo, 0);
    collected.sort((a, b) => b.owned - a.owned || b.owned / (b.total || 1) - a.owned / (a.total || 1) || (a.id < b.id ? -1 : 1));
    const evoGenres = new Map();
    for (const qt of quarters) for (const [g, n] of qt.genres) inc(evoGenres, g, n);
    const evoTop = [...evoGenres].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP).map(([g]) => g);
    const evoQuarters = quarters.map((qt) => ({ key: qt.key, start: qt.start, end: qt.end, total: qt.total, genres: Object.fromEntries(qt.genres) }));
    const topDecade = [...decadeList].sort((a, b) => b.cards - a.cards)[0]?.decade ?? null;
    return {
      v: CACHE_VERSION,
      memberSince: user.created_at,
      totals: {
        cards: user.unique_cards || 0,
        holo,
        albumsStarted: collected.length,
        albumsCompleted: done.albums,
        artistsMastered: done.artists,
        artists: artistCards.size,
        genres: genreList.length,
        decades: decadeList.length,
        countries: countries.size,
        ratings: ratingCount,
        average: ratingCount ? round1(ratingSum / ratingCount) : null,
        reviews,
        battleVotes,
        boosters,
      },
      lists,
      favorites: {
        artist: artists[0] || null,
        artists: artists.slice(0, TOP),
        albums: best,
        collected: collected.slice(0, TOP),
        genre: genreList[0]?.id ?? favGenres[0] ?? null,
        decade: topDecade,
        country: countryList[0]?.code ?? null,
        genres: favGenres.slice(0, TOP),
      },
      distributions: {
        genres: genreList,
        decades: decadeList,
        countries: countryList,
        countriesKnown: ratio(knownCards, albumCards),
        rarities: RARITIES.map((id) => ({ id, cards: Math.max(0, rarity.get(id).cards), holo: rarity.get(id).holo, total: catalogRarity[id] || 0 })),
        ratings: dist,
      },
      timeline: months.map((m) => ({ month: m.key, start: m.start, cards: m.cards, ratings: m.ratings, completions: m.completions })),
      evolution: { quarters: evoQuarters, genres: evoTop, shift: shiftOf(evoQuarters, evoTop) },
      computedAt: now,
    };
  }

  // ----- Rétro -----------------------------------------------------------------------------------------

  /** Albums (artiste, genre, année) de ces identifiants, par lots de 500. */
  async function albumMeta(ids) {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      for (const r of q('SELECT id, artist_id AS artistId, genre, year FROM cat_albums WHERE id IN (SELECT value FROM json_each(?))').all(json(ids.slice(i, i + 500)))) {
        out.set(r.id, r);
      }
      if (i + 500 < ids.length) await tick();
    }
    return out;
  }

  async function computeRetro(userId, year) {
    const now = Date.now();
    const months = yearMonths(year).map((w) => ({ ...w, cards: 0, ratings: 0, completions: 0 }));
    const start = months[0].start;
    const end = months[11].end;

    // Cartes de l'année par rareté et par album (la plus ancienne de chaque groupe : première carte, pépite).
    const rarity = new Map(RARITIES.map((r) => [r, { cards: 0, holo: 0, first: null }]));
    const byAlbum = new Map();
    let firstCard = null;
    await scanCards(userId, start, end, 't.rarity, t.album_id', (row) => {
      const card = { trackId: row.trackId, variant: row.variant, at: row.first };
      const v = rarity.get(row.rarity);
      if (v) {
        v.cards += row.n;
        v.holo += row.holo;
        if (!v.first || card.at < v.first.at) v.first = card;
      }
      if (!firstCard || card.at < firstCard.at) firstCard = card;
      if (row.album_id) inc(byAlbum, row.album_id, row.n);
    });
    const meta = await albumMeta([...byAlbum.keys()]);
    const artistCards = new Map();
    const artistAlbum = new Map();
    const genreAlbum = new Map();
    const genres = new Map();
    const decades = new Map();
    let cardsInAlbums = 0;
    const most = (map, key, albumId, n) => {
      if (key != null && (!map.has(key) || byAlbum.get(map.get(key)) < n)) map.set(key, albumId);
    };
    for (const [albumId, n] of byAlbum) {
      const m = meta.get(albumId);
      if (!m) continue;
      cardsInAlbums += n;
      addTo(artistCards, m.artistId, n);
      addTo(genres, m.genre, n);
      addTo(decades, decadeOf(m.year), n);
      most(artistAlbum, m.artistId, albumId, n);
      most(genreAlbum, m.genre, albumId, n);
    }
    await tick();

    // Mois : cartes, notes.
    countByWindow(CARDS_IN, userId, months).forEach((n, i) => { months[i].cards = n; });
    countByWindow(RATINGS_IN, userId, months).forEach((n, i) => { months[i].ratings = n; });

    // Notes de l'année : nombre, moyenne, 5 albums les mieux notés, artistes notés, critiques.
    const rs = q('SELECT COUNT(*) AS n, SUM(score) AS s FROM ratings WHERE user_id = ? AND created_at >= ? AND created_at < ?').get(userId, start, end);
    const bestAlbums = q(`SELECT r.item_id AS id, r.score, al.artist_id AS artistId FROM ratings r JOIN cat_albums al ON al.id = r.item_id
      WHERE r.user_id = ? AND r.item_type = 'album' AND r.created_at >= ? AND r.created_at < ?
      ORDER BY r.score DESC, r.created_at ASC LIMIT ?`).all(userId, start, end, TOP);
    const rated = ratedArtists(userId, start, end);
    const reviews = q('SELECT COUNT(*) AS n FROM ratings WHERE user_id = ? AND review_at >= ? AND review_at < ? AND hidden_at IS NULL').get(userId, start, end).n;

    // Vinyles de l'année (premier, plus petit numéro de pressage), maîtrises.
    let firstCompletion = null;
    let lowestPressing = null;
    const vinyls = q(`SELECT substr(a.key, 7) AS albumId, a.created_at AS at, a.rank FROM achievements a JOIN cat_albums al ON al.id = substr(a.key, 7)
      WHERE a.user_id = ? AND a.created_at >= ? AND a.created_at < ? AND a.key >= 'album:' AND a.key < 'album;'`).all(userId, start, end);
    for (const a of vinyls) {
      const mi = bucketOf(months, a.at);
      if (mi >= 0) months[mi].completions += 1;
      if (!firstCompletion || a.at < firstCompletion.at) firstCompletion = { albumId: a.albumId, at: a.at, rank: a.rank ?? null };
      if (a.rank != null && (!lowestPressing || a.rank < lowestPressing.rank)) lowestPressing = { albumId: a.albumId, at: a.at, rank: a.rank };
    }
    const mastered = q("SELECT COUNT(*) AS n FROM achievements WHERE user_id = ? AND created_at >= ? AND created_at < ? AND key >= 'artist:' AND key < 'artist;'")
      .get(userId, start, end).n;

    // Duels, boosters (rétention de 400 jours), listes créées dans l'année.
    const battleVotes = q('SELECT COUNT(*) AS n FROM battle_votes WHERE user_id = ? AND created_at >= ? AND created_at < ? AND winner_id IS NOT NULL').get(userId, start, end).n;
    const boosters = q('SELECT COUNT(*) AS n FROM pack_openings WHERE user_id = ? AND created_at >= ? AND created_at < ?').get(userId, start, end).n;
    const lists = q("SELECT COUNT(*) AS n FROM lists WHERE user_id = ? AND kind = 'list' AND hidden_at IS NULL AND created_at >= ? AND created_at < ?").get(userId, start, end).n;

    // Assemblage.
    const artists = rankArtists(artistCards, rated, favoriteArtists(userId)).filter((a) => a.cards > 0 || a.rated > 0).slice(0, TOP).map((a) => ({
      ...a, albumId: artistAlbum.get(a.id) || bestAlbums.find((b) => b.artistId === a.id)?.id || null,
    }));
    const cardsTotal = months.reduce((s, m) => s + m.cards, 0);
    let busiest = null;
    for (const m of months) {
      if (!m.cards && !m.ratings) continue;
      if (!busiest || m.cards > busiest.cards || (m.cards === busiest.cards && m.ratings > busiest.ratings)) busiest = { month: m.key, cards: m.cards, ratings: m.ratings };
    }
    const rarest = RARE_ORDER.map((r) => (rarity.get(r)?.first ? { ...rarity.get(r).first, rarity: r } : null)).find(Boolean) || null;
    const ratingCount = rs.n || 0;
    return {
      v: CACHE_VERSION,
      year,
      status: 'open',
      totals: {
        cards: cardsTotal,
        holo: [...rarity.values()].reduce((s, v) => s + v.holo, 0),
        albums: byAlbum.size,
        completed: vinyls.length,
        mastered,
        ratings: ratingCount,
        average: ratingCount ? round1((rs.s || 0) / ratingCount) : null,
        reviews,
        battleVotes,
        boosters,
        boostersPartial: start < now - OPENINGS_KEPT_MS,
        lists,
      },
      months: months.map((m) => ({ month: m.key, start: m.start, cards: m.cards, ratings: m.ratings, completions: m.completions })),
      top: {
        artist: artists[0] || null,
        artists,
        albums: bestAlbums.map((b) => ({ id: b.id, score: b.score })),
        collected: [...byAlbum].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP).map(([id, cards]) => ({ id, cards })),
        genres: shares(genres, cardsInAlbums).sort((a, b) => b.cards - a.cards || (a.id < b.id ? -1 : 1)).slice(0, TOP)
          .map((g) => ({ ...g, albumId: genreAlbum.get(g.id) || null })),
        decades: shares(decades, cardsInAlbums, 'decade').sort((a, b) => b.cards - a.cards || a.decade - b.decade).slice(0, TOP),
      },
      rarities: RARITIES.map((id) => ({ id, cards: rarity.get(id).cards, holo: rarity.get(id).holo })),
      moments: { firstCard, firstCompletion, rarestPull: rarest, busiestMonth: busiest, lowestPressing },
      thin: cardsTotal < THIN_CARDS && ratingCount < THIN_RATINGS && vinyls.length === 0,
      computedAt: now,
    };
  }

  // ----- réponses ---------------------------------------------------------------------------------------

  const USER_COLS = 'id, username, created_at, profile_visibility';

  /** Joueur dont on lit le passeport : vérifié, pas bloqué, Studio lisible (sinon 404 ou 403). */
  function readableTarget(viewerId, username) {
    const target = q(`SELECT ${USER_COLS} FROM users WHERE username = ? AND email_verified_at IS NOT NULL`).get(String(username || '').trim().slice(0, 40));
    if (!target || (target.id !== viewerId && access().isBlocked?.(viewerId, target.id))) throw new HttpError(404, 'user_not_found');
    if (target.id === viewerId) return target;
    const mode = deps.studio?.accessOf ? deps.studio.accessOf(viewerId, target)
      : (target.profile_visibility || 'public') === 'public' ? 'full' : 'header';
    if (mode !== 'full') throw new HttpError(403, 'passport_private', { visibility: target.profile_visibility || 'public' });
    return target;
  }

  /** Années de Rétro disponibles (de la plus récente à la plus ancienne) et état du Rétro de l'année en cours. */
  function retroInfo(userOrId, now = Date.now()) {
    const user = typeof userOrId === 'object' ? userOrId : q(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(Number(userOrId));
    const current = parisDate(now).y;
    const state = retroState(current, now);
    const first = Math.max(RETRO_FIRST_YEAR, parisDate(user?.created_at ?? now).y);
    const years = [];
    for (let y = state === 'open' ? current : current - 1; y >= first; y--) years.push(y);
    return { years, current: { year: current, status: state, opensAt: retroOpensAt(current) } };
  }

  const ownerOf = (viewerId, targetId) => services.userSummaries([targetId], viewerId, { hidden: new Set() }).get(targetId) || null;

  /** Passeport vu par `viewerId` (le sien, ou celui d'un autre joueur par son pseudo). */
  async function passportFor(viewerId, username = null) {
    const target = username == null ? q(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(viewerId) : readableTarget(viewerId, username);
    if (!target) throw new HttpError(401, 'unauthenticated');
    const data = await through(target.id, 'passport', () => computePassport(target.id));
    const self = target.id === viewerId;
    const friend = !self && services.friendIds(viewerId).has(target.id);
    const { lists, v: _v, ...rest } = data;
    const owner = ownerOf(viewerId, target.id);
    const fav = data.favorites;
    return {
      ...rest,
      totals: { ...data.totals, lists: lists.public + (self || friend ? lists.friends : 0) + (self ? lists.private : 0) },
      owner,
      self,
      retro: self ? retroInfo(target) : null,
      catalog: deps.refs({
        albumIds: [...fav.albums.map((a) => a.id), ...fav.collected.map((a) => a.id), ...services.summaryAlbums(owner ? [owner] : [])],
        artistIds: fav.artists.map((a) => a.id),
      }),
    };
  }

  /** Rétro d'une année du joueur connecté. */
  async function retroFor(userId, rawYear) {
    const user = q(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(userId);
    if (!user) throw new HttpError(401, 'unauthenticated');
    const info = retroInfo(user);
    const year = /^\d{4}$/.test(String(rawYear)) ? Number(rawYear) : NaN;
    if (!(year >= RETRO_FIRST_YEAR) || retroState(year) === 'future') throw new HttpError(404, 'retro_not_found', { years: info.years });
    const owner = ownerOf(userId, userId);
    if (retroState(year) === 'locked') return { year, status: 'locked', opensAt: retroOpensAt(year), years: info.years, owner, catalog: deps.refs() };
    if (!info.years.includes(year)) throw new HttpError(404, 'retro_not_found', { years: info.years });
    const data = await through(userId, `retro:${year}`, () => computeRetro(userId, year));
    const { v: _v, ...rest } = data;
    const m = data.moments;
    return {
      ...rest,
      years: info.years,
      owner,
      catalog: deps.refs({
        trackIds: [m.firstCard?.trackId, m.rarestPull?.trackId].filter(Boolean),
        albumIds: [
          ...data.top.albums.map((a) => a.id), ...data.top.collected.map((a) => a.id), ...data.top.artists.map((a) => a.albumId),
          ...data.top.genres.map((g) => g.albumId), m.firstCompletion?.albumId, m.lowestPressing?.albumId,
          ...services.summaryAlbums(owner ? [owner] : []),
        ].filter(Boolean),
        artistIds: data.top.artists.map((a) => a.id),
      }),
    };
  }

  /** Passeport et Rétro bruts d'un joueur (cache compris), pour les autres modules. */
  const passportOf = (userId) => through(Number(userId), 'passport', () => computePassport(Number(userId)));
  const retroOf = (userId, year) => through(Number(userId), `retro:${Number(year)}`, () => computeRetro(Number(userId), Number(year)));

  return { passportFor, retroFor, passportOf, retroOf, retroInfo, retroState, forget, isFresh };
}

export function routes(r, deps) {
  const { limits, db } = deps;
  const api = () => deps.passport;
  // Un recalcul compte dans la limite « heavy » ; une lecture du cache seulement dans la limite de lecture.
  const heavyUnlessFresh = (keyOf) => (req, res, next) => {
    const [userId, key] = keyOf(req);
    return !userId || api().isFresh(userId, key) ? next() : limits.heavy(req, res, next);
  };
  const idOf = (username) => db.prepare('SELECT id FROM users WHERE username = ? AND email_verified_at IS NOT NULL')
    .get(String(username || '').trim().slice(0, 40))?.id ?? null;

  r.get('/passport', limits.read, heavyUnlessFresh((req) => [req.user.id, 'passport']),
    async (req, res) => res.json(await api().passportFor(req.user.id)));
  r.get('/users/:username/passport', limits.read, heavyUnlessFresh((req) => [idOf(req.params.username), 'passport']),
    async (req, res) => res.json(await api().passportFor(req.user.id, req.params.username)));
  // Année refusée ou Rétro pas encore ouvert : rien à calculer, la route répond elle-même.
  const retroKey = (req) => {
    const year = /^\d{4}$/.test(String(req.params.year)) ? Number(req.params.year) : null;
    return year && api().retroState(year) === 'open' ? [req.user.id, `retro:${year}`] : [null];
  };
  r.get('/retro/:year', limits.read, heavyUnlessFresh(retroKey),
    async (req, res) => res.json(await api().retroFor(req.user.id, req.params.year)));
}

export const jobs = [
  {
    // Passeports et Rétro de plus de 30 jours : recalculés à la prochaine visite (la table reste petite).
    name: 'passport-cache',
    run({ db }) {
      const rows = db.prepare("DELETE FROM user_stats_cache WHERE (key = 'passport' OR key LIKE 'retro:%') AND computed_at < ?")
        .run(Date.now() - CACHE_PURGE_MS).changes;
      return { rows };
    },
  },
];
