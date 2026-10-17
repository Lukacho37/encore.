// Duels (« battles ») et classements (PLAN.md 5.4) — chantier P1-F. Partagé par le serveur (server/battles.js), la
// démo (client/src/demo/mock/battles.js) et le site (libellés des catégories, badge « provisoire »).
//
// Catégories (clés) : `global:album`, `artist:<artistId>`, `decade:<1990>`, `genre:<electro>`, `year:<2026>`,
// `genre_decade:<rap>:<1990>`, `country:<FR>` pour les duels d'albums ; `album_tracks:<albumId>` et
// `artist_tracks:<artistId>` pour les duels de morceaux. Un vote met à jour l'Elo de TOUTES les catégories qui
// contiennent les deux éléments (battle_votes.categories garde la liste) : un vote nourrit à la fois le classement
// global, celui de la décennie, du genre et de l'artiste.
// Elo : note de départ tirée de la moyenne de la communauté (bayésienne), K = 32 sous 30 votes, 24 sous 100, 16 après ;
// anti-brigade : K × 0,25 au-delà de 10 votes du même joueur sur le même élément dans la journée, K × 0,5 pour un
// compte de moins de 24 h. Un classement est « provisoire » sous 50 votes ; une catégorie est listée dès qu'elle a
// 20 éléments classés (ou tous ses éléments, quand elle en compte moins).

export const ITEM_TYPES = ['album', 'track'];
export const ALBUM_KINDS = ['global', 'artist', 'decade', 'genre', 'year', 'genre_decade', 'country'];
export const TRACK_KINDS = ['album_tracks', 'artist_tracks'];
export const CATEGORY_KINDS = [...ALBUM_KINDS, ...TRACK_KINDS];
/** Rubriques du hub des classements, dans l'ordre d'affichage. */
export const HUB_GROUPS = ['global', 'decade', 'genre', 'year', 'genre_decade', 'country', 'artist'];

export const BASE_RATING = 1500;
export const SEED_SPREAD = 60;
export const SEED_CLAMP = 200;
export const PRIOR_COUNT = 10;
export const PRIOR_MEAN = 6.0;
export const PIVOT = 6.5;
export const PROVISIONAL_VOTES = 50;
export const MIN_RANKED_ITEMS = 20;
/** Écart d'Elo visé entre les deux albums d'un duel (duels informatifs) et part des duels d'exploration. */
export const PAIR_GAP = 150;
export const EXPLORE_SHARE = 0.3;
export const EXPLORE_VOTES = 20;
export const KNOWN_SHARE = 0.7;
/** Mélange des catégories quand le joueur n'en choisit pas : goûts, global, artiste connu. */
export const MIX = { taste: 0.5, global: 0.3, artist: 0.2 };
export const XP_PER_VOTE = 5;
export const XP_VOTES_PER_DAY = 20;
export const TOKEN_TTL_MS = 30 * 60_000;
export const BRIGADE_VOTES = 10;
export const BRIGADE_FACTOR = 0.25;
export const NEW_ACCOUNT_MS = 24 * 3_600_000;
export const NEW_ACCOUNT_FACTOR = 0.5;
/** Pages des classements : décalage plafonné (PLAN.md 4.0). */
export const RANKING_CAP = 500;

const ID = /^[\w.:-]{1,80}$/;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const GENRE = /^[a-z][a-z0-9_-]{0,29}$/;

export const decadeOf = (year) => (Number.isInteger(year) ? Math.floor(year / 10) * 10 : null);

/**
 * Clé de catégorie lue → { key, kind, itemType, value, value2 } ; null si la forme est fausse. `value` : identifiant,
 * genre, décennie ou année (nombre), pays ; `value2` : la décennie de genre_decade.
 */
export function parseCategory(key) {
  const s = String(key ?? '');
  if (s.length > 100) return null;
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const kind = s.slice(0, i);
  const rest = s.slice(i + 1);
  const out = (value, value2 = null) => ({ key: s, kind, itemType: TRACK_KINDS.includes(kind) ? 'track' : 'album', value, value2 });
  switch (kind) {
    case 'global':
      return rest === 'album' ? out('album') : null;
    case 'artist':
    case 'album_tracks':
    case 'artist_tracks':
      return ID.test(rest) && !rest.includes(':') ? out(rest) : null;
    case 'decade':
      return /^(19[0-9]0|20[0-9]0)$/.test(rest) ? out(Number(rest)) : null;
    case 'year':
      return /^(19\d\d|20\d\d)$/.test(rest) ? out(Number(rest)) : null;
    case 'genre':
      return GENRE.test(rest) ? out(rest) : null;
    case 'genre_decade': {
      const [g, d] = rest.split(':');
      return GENRE.test(g || '') && /^(19[0-9]0|20[0-9]0)$/.test(d || '') ? out(g, Number(d)) : null;
    }
    case 'country':
      return /^[A-Z]{2}$/.test(rest) ? out(rest) : null;
    case 'event':
      return SLUG.test(rest) ? out(rest) : null;
    default:
      return null;
  }
}

/** Catégories d'un album seul (`facts` : { artistId, year, genre, country }), de la plus large à la plus fine. */
export function albumCategories({ artistId, year, genre, country } = {}) {
  const out = ['global:album'];
  const decade = decadeOf(year);
  if (decade != null) out.push(`decade:${decade}`);
  if (genre) out.push(`genre:${genre}`);
  if (Number.isInteger(year)) out.push(`year:${year}`);
  if (genre && decade != null) out.push(`genre_decade:${genre}:${decade}`);
  if (country) out.push(`country:${country}`);
  if (artistId) out.push(`artist:${artistId}`);
  return out;
}

/** Catégories d'un morceau seul (`facts` : { albumId, artistId }). */
export function trackCategories({ albumId, artistId } = {}) {
  const out = [];
  if (albumId) out.push(`album_tracks:${albumId}`);
  if (artistId) out.push(`artist_tracks:${artistId}`);
  return out;
}

/** Catégories qui contiennent les deux éléments d'un duel (celles que le vote met à jour). */
export function sharedCategories(itemType, a, b) {
  const of = itemType === 'track' ? trackCategories : albumCategories;
  const mine = new Set(of(b));
  return of(a).filter((k) => mine.has(k));
}

/** Un élément appartient-il à la catégorie ? (`facts` comme albumCategories / trackCategories) */
export function inCategory(cat, facts) {
  const parsed = typeof cat === 'string' ? parseCategory(cat) : cat;
  if (!parsed || !facts) return false;
  const list = parsed.itemType === 'track' ? trackCategories(facts) : albumCategories(facts);
  return list.includes(parsed.key);
}

// ----- Elo ---------------------------------------------------------------------------------------------------

/**
 * Note de départ d'un élément d'après les notes de la communauté (rating_stats : `count`, `sum` sur 10) :
 * R0 = 1500 + 60 × (bayes − 6,5), bornée à ± 200, avec bayes = (sum + 10 × 6,0) / (count + 10).
 */
export function seedRating({ count = 0, sum = 0 } = {}) {
  const bayes = (Number(sum) + PRIOR_COUNT * PRIOR_MEAN) / (Number(count) + PRIOR_COUNT);
  const delta = Math.max(-SEED_CLAMP, Math.min(SEED_CLAMP, SEED_SPREAD * (bayes - PIVOT)));
  return BASE_RATING + delta;
}

/** Probabilité que A gagne : E_A = 1 / (1 + 10^((R_B − R_A) / 400)). */
export const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));

/** K d'un élément selon ses votes dans la catégorie : 32 sous 30, 24 sous 100, 16 ensuite. */
export const kFactor = (votes) => (votes < 30 ? 32 : votes < 100 ? 24 : 16);

/**
 * Multiplicateur anti-brigade du votant pour un élément : × 0,25 au-delà de 10 votes sur cet élément aujourd'hui,
 * × 0,5 pour un compte de moins de 24 h (les deux se cumulent).
 */
export function brigadeFactor({ votesOnItemToday = 0, accountAgeMs = Infinity } = {}) {
  let f = 1;
  if (votesOnItemToday >= BRIGADE_VOTES) f *= BRIGADE_FACTOR;
  if (accountAgeMs < NEW_ACCOUNT_MS) f *= NEW_ACCOUNT_FACTOR;
  return f;
}

/**
 * Mise à jour Elo : R' = R + K × (S − E). `a`, `b` : { rating, votes } ; `winner` : 'a' | 'b' ; `factorA/B` :
 * multiplicateurs anti-brigade. Renvoie { ratingA, ratingB, deltaA, deltaB }.
 */
export function eloUpdate(a, b, winner, { factorA = 1, factorB = 1 } = {}) {
  const ea = expected(a.rating, b.rating);
  const sa = winner === 'a' ? 1 : 0;
  const deltaA = kFactor(a.votes) * factorA * (sa - ea);
  const deltaB = kFactor(b.votes) * factorB * ((1 - sa) - (1 - ea));
  return { ratingA: a.rating + deltaA, ratingB: b.rating + deltaB, deltaA, deltaB };
}

export const isProvisional = (votes) => Number(votes) < PROVISIONAL_VOTES;

/** Catégorie listée dans le hub : 20 éléments classés, ou tous ses éléments quand elle en a moins (au moins 2). */
export const isListed = (ranked, size = Infinity) => ranked >= 2 && ranked >= Math.min(MIN_RANKED_ITEMS, size);

/** Paire ordonnée (a < b, comme battle_votes) et côté gagnant traduit dans cet ordre. */
export function orderPair(x, y) {
  return x < y ? { a: x, b: y, swapped: false } : { a: y, b: x, swapped: true };
}
