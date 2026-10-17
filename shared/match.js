// Taste Match : un score de goûts communs explicable (PLAN.md 5.3) — chantier P1-E. Partagé par le serveur
// (server/match.js) et le jumeau de démo (client/src/demo/mock/match.js) : mêmes constantes, mêmes calculs.
//
// Un « profil » de goûts (construit par l'appelant depuis ses tables) :
//   { ratings: Map<'album:<id>' | 'track:<id>', note 0–10>, loved: Set<albumId>, artists: Map<artistId, poids>,
//     genres: Map<genre, poids>, decades: Map<décennie, poids>, cards: cartes uniques }
// « Adorés » : albums notés 8/10 ou plus, ou dans « Mes 9 albums ».
// Cinq composantes, chacune dans [0, 1] ; une composante sans données sort du calcul et son poids est redistribué :
//   ratings  0.40  accord des notes sur les éléments notés par les deux (n ≥ 3), rapproché de 0,5 quand n est petit ;
//   loved    0.20  albums adorés en commun, rapportés au plus petit des deux ensembles (+ 3) ;
//   artists  0.20  cosinus des vecteurs d'artistes (cartes par artiste, 60 premiers ; favoris × 3 ; note − 5) ;
//   genres   0.10  1 − divergence de Jensen–Shannon (base 2) des parts de genres ;
//   decades  0.10  idem sur les décennies.
// Les constantes se règlent ici seulement (server/test/match.test.js vérifie la distribution sur la base peuplée).

export const MATCH_WEIGHTS = { ratings: 0.4, loved: 0.2, artists: 0.2, genres: 0.1, decades: 0.1 };
export const MATCH_KEYS = Object.keys(MATCH_WEIGHTS);

/** Note à partir de laquelle un album est « adoré ». */
export const LOVED_SCORE = 8;
/** Éléments notés en commun nécessaires pour l'accord des notes ; poids du rapprochement vers 0,5. */
export const CORATED_MIN = 3;
export const CORATED_SHRINK = 5;
/** Lissage des albums adorés en commun : inter / (min(|A|, |B|) + LOVED_PRIOR). */
export const LOVED_PRIOR = 3;
/** Artistes gardés dans chaque vecteur ; multiplicateur des artistes favoris ; poids plancher d'un favori. */
export const ARTIST_TOP = 60;
export const FAVORITE_FACTOR = 3;
export const FAVORITE_FLOOR = 5;
/** Poids d'un album noté dans les parts de genres et de décennies (en plus des cartes possédées). */
export const RATED_GENRE_WEIGHT = 2;
/**
 * Courbe des composantes de recouvrement (valeur ^ exposant) : entre deux inconnus, albums adorés et artistes en
 * commun sont presque toujours proches de 0 ; la racine cubique étale les petits recouvrements, pour que deux profils
 * pris au hasard tombent vers 40–60 et deux profils proches au-dessus de 80 (réglé sur la base peuplée : médiane 42,
 * moyenne 43 pour 400 paires au hasard, 93 pour des profils proches).
 */
export const CURVE = { loved: 1 / 3, artists: 1 / 3 };

/** Seuils de confiance (PLAN.md 5.3). */
export const CONFIDENCE = { high: { corated: 10, cards: 50 }, medium: { corated: 3, loved: 2 } };

/** Cache des paires (taste_matches) : 6 h, recalcul avant si l'un des deux a noté 5 éléments de plus ou de moins. */
export const MATCH_TTL_MS = 6 * 3_600_000;
export const MATCH_RECOUNT = 5;
/** La tâche taste-cache efface les paires de plus de 7 jours. */
export const MATCH_PURGE_MS = 7 * 86_400_000;

/** Tailles des listes du résultat. */
export const SHARED_MAX = 12;
export const DIFFERENCES_MAX = 5;
export const DIFFERENCE_MIN = 5;
export const RECOMMEND_MAX = 6;
export const RECOMMEND_PER_ARTIST = 2;
/** Albums partagés : notés 7 ou plus par les deux, ou adorés par les deux ; morceaux : 8 ou plus par les deux. */
export const SHARED_ALBUM_SCORE = 7;
export const SHARED_TRACK_SCORE = 8;

/** Moyenne bayésienne de la communauté (C = 10 notes fictives à 6,0), comme Découvrir et les battles. */
export const BAYES = { C: 10, m: 6 };
export const bayes = (sum = 0, count = 0) => (sum + BAYES.C * BAYES.m) / (count + BAYES.C);

// ----- outils -------------------------------------------------------------------------------------

const toMap = (x) => (x instanceof Map ? x : new Map(Object.entries(x || {})));

/** Les `n` plus grands poids d'une Map (poids > 0), dans l'ordre décroissant. */
export function topEntries(map, n = Infinity) {
  return [...toMap(map)].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
}

/** Cosinus de deux vecteurs creux (Map clé → poids) ; null si l'un est vide. */
export function cosine(a, b) {
  const A = toMap(a);
  const B = toMap(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of A) na += v * v;
  for (const [k, v] of B) {
    nb += v * v;
    const w = A.get(k);
    if (w) dot += w * v;
  }
  if (!na || !nb) return null;
  return Math.max(0, Math.min(1, dot / Math.sqrt(na * nb)));
}

/** Parts (somme 1) d'une distribution de poids ; null si elle est vide. */
function shares(map) {
  let total = 0;
  for (const [, v] of toMap(map)) if (v > 0) total += v;
  if (!total) return null;
  const out = new Map();
  for (const [k, v] of toMap(map)) if (v > 0) out.set(k, v / total);
  return out;
}

/** 1 − divergence de Jensen–Shannon (base 2) de deux distributions ; null si l'une est vide. Dans [0, 1]. */
export function jsSimilarity(a, b) {
  const P = shares(a);
  const Q = shares(b);
  if (!P || !Q) return null;
  let d = 0;
  for (const k of new Set([...P.keys(), ...Q.keys()])) {
    const p = P.get(k) || 0;
    const q = Q.get(k) || 0;
    const m = (p + q) / 2;
    if (p) d += 0.5 * p * Math.log2(p / m);
    if (q) d += 0.5 * q * Math.log2(q / m);
  }
  return Math.max(0, Math.min(1, 1 - d));
}

/** Accord des notes : 1 − écart moyen / 10, rapproché de 0,5 (n · a + k · 0,5) / (n + k) ; null sous CORATED_MIN. */
export function ratingAgreement(pairs) {
  const n = pairs.length;
  if (n < CORATED_MIN) return null;
  const gap = pairs.reduce((s, [x, y]) => s + Math.abs(x - y), 0) / n;
  const a = 1 - gap / 10;
  return (n * a + CORATED_SHRINK * 0.5) / (n + CORATED_SHRINK);
}

/** Albums adorés en commun : inter / (min + LOVED_PRIOR) ; null si l'un des deux n'a aucun album adoré. */
export function lovedOverlap(inter, sizeA, sizeB) {
  const min = Math.min(sizeA, sizeB);
  if (!min) return null;
  return Math.min(1, inter / (min + LOVED_PRIOR));
}

/** Score sur 100 des composantes qui ont des données (poids redistribués) ; null si aucune n'en a. */
export function matchScore(values) {
  let sum = 0;
  let weights = 0;
  for (const key of MATCH_KEYS) {
    const v = values[key];
    if (v == null || !Number.isFinite(v)) continue;
    sum += MATCH_WEIGHTS[key] * v;
    weights += MATCH_WEIGHTS[key];
  }
  return weights ? Math.round((100 * sum) / weights) : null;
}

/** Confiance : 'high' (≥ 10 notés en commun et ≥ 50 cartes chacun), 'medium' (≥ 3 notés ou ≥ 2 adorés), 'low'. */
export function confidenceOf({ corated = 0, lovedShared = 0, cardsA = 0, cardsB = 0 } = {}) {
  if (corated >= CONFIDENCE.high.corated && cardsA >= CONFIDENCE.high.cards && cardsB >= CONFIDENCE.high.cards) return 'high';
  if (corated >= CONFIDENCE.medium.corated || lovedShared >= CONFIDENCE.medium.loved) return 'medium';
  return 'low';
}

/** Arrondi à une décimale (écarts de notes affichés). */
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Compare deux profils. Renvoie { score, confidence, components, shared, differences, corated } :
 *   components : [{ key, value (0–100 | null), weight, vars }] dans l'ordre de MATCH_KEYS ;
 *   shared     : { albums, artists, tracks, genres } (identifiants, les meilleurs d'abord) ;
 *   differences: [{ type, id, a, b }] (|a − b| ≥ 5, les plus grands écarts d'abord).
 * Les recommandations (qui demandent le catalogue) sont calculées par l'appelant (recommendations()).
 */
export function compareProfiles(A, B) {
  // Éléments notés par les deux.
  const [small, big, flip] = A.ratings.size <= B.ratings.size ? [A.ratings, B.ratings, false] : [B.ratings, A.ratings, true];
  const corated = [];
  for (const [key, s] of small) {
    const t = big.get(key);
    if (t === undefined) continue;
    const [a, b] = flip ? [t, s] : [s, t];
    const i = key.indexOf(':');
    corated.push({ type: key.slice(0, i), id: key.slice(i + 1), a, b });
  }
  const agreement = ratingAgreement(corated.map((c) => [c.a, c.b]));
  const gap = corated.length ? corated.reduce((s, c) => s + Math.abs(c.a - c.b), 0) / corated.length : null;

  // Albums adorés.
  const lovedShared = [...A.loved].filter((id) => B.loved.has(id));
  const loved = lovedOverlap(lovedShared.length, A.loved.size, B.loved.size);

  // Artistes : les 60 premiers de chacun.
  const topA = new Map(topEntries(A.artists, ARTIST_TOP));
  const topB = new Map(topEntries(B.artists, ARTIST_TOP));
  const artists = cosine(topA, topB);
  const sharedArtists = [...topA.keys()].filter((id) => topB.has(id))
    .sort((x, y) => Math.min(topB.get(y), topA.get(y)) - Math.min(topB.get(x), topA.get(x)) || String(x).localeCompare(String(y)));

  // Genres et décennies.
  const genres = jsSimilarity(A.genres, B.genres);
  const decades = jsSimilarity(A.decades, B.decades);
  const common = (ma, mb) => {
    const pa = shares(ma);
    const pb = shares(mb);
    if (!pa || !pb) return [];
    return [...pa.keys()].filter((k) => pb.has(k)).map((k) => [k, Math.min(pa.get(k), pb.get(k))])
      .sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0]))).map(([k]) => k);
  };
  const commonGenres = common(A.genres, B.genres);
  const commonDecades = common(A.decades, B.decades);

  const curve = (key, v) => (v == null ? null : CURVE[key] ? v ** CURVE[key] : v);
  const values = { ratings: agreement, loved: curve('loved', loved), artists: curve('artists', artists), genres, decades };
  const score = matchScore(values);
  const vars = {
    ratings: { n: corated.length, gap: gap == null ? null : round1(gap) },
    loved: { n: lovedShared.length },
    artists: { ids: sharedArtists.slice(0, 3), n: sharedArtists.length },
    genres: { ids: commonGenres.slice(0, 2) },
    decades: { ids: commonDecades.slice(0, 1).map(Number) },
  };
  const components = MATCH_KEYS.map((key) => ({
    key,
    value: values[key] == null ? null : Math.round(values[key] * 100),
    weight: MATCH_WEIGHTS[key],
    vars: vars[key],
  }));

  // Albums partagés : notés 7+ par les deux ou adorés par les deux, par score combiné (un album de « Mes 9 albums »
  // non noté compte 9).
  const albumScore = (P, id) => P.ratings.get(`album:${id}`) ?? (P.loved.has(id) ? 9 : null);
  const sharedAlbums = new Map();
  for (const c of corated) {
    if (c.type === 'album' && c.a >= SHARED_ALBUM_SCORE && c.b >= SHARED_ALBUM_SCORE) sharedAlbums.set(c.id, c.a + c.b);
  }
  for (const id of lovedShared) if (!sharedAlbums.has(id)) sharedAlbums.set(id, (albumScore(A, id) ?? 9) + (albumScore(B, id) ?? 9));
  const albums = [...sharedAlbums].sort((x, y) => y[1] - x[1] || String(x[0]).localeCompare(String(y[0]))).map(([id]) => id);
  const tracks = corated.filter((c) => c.type === 'track' && c.a >= SHARED_TRACK_SCORE && c.b >= SHARED_TRACK_SCORE)
    .sort((x, y) => y.a + y.b - (x.a + x.b) || String(x.id).localeCompare(String(y.id))).map((c) => c.id);

  const differences = corated.filter((c) => Math.abs(c.a - c.b) >= DIFFERENCE_MIN)
    .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b) || String(x.id).localeCompare(String(y.id)))
    .slice(0, DIFFERENCES_MAX)
    .map(({ type, id, a, b }) => ({ type, id, a, b }));

  return {
    score: score ?? 0,
    hasData: score != null,
    confidence: confidenceOf({ corated: corated.length, lovedShared: lovedShared.length, cardsA: A.cards || 0, cardsB: B.cards || 0 }),
    components,
    shared: {
      albums: albums.slice(0, SHARED_MAX),
      artists: sharedArtists.slice(0, SHARED_MAX),
      tracks: tracks.slice(0, SHARED_MAX),
      genres: commonGenres.slice(0, 3),
      counts: { albums: albums.length, artists: sharedArtists.length, tracks: tracks.length },
    },
    differences,
    corated: corated.length,
  };
}

/**
 * « @from te recommande » : albums adorés par `from` que `to` n'a jamais notés ni complétés, classés par la note de
 * `from` (+ 1,5 si le genre est dans les 3 premiers de `to`), puis par la moyenne bayésienne de la communauté ;
 * au plus RECOMMEND_MAX, RECOMMEND_PER_ARTIST par artiste. `info(albumId)` → { artistId, genre, bayes } ou null
 * (album absent du catalogue) ; `to.completed` : Set des albums complétés de `to`.
 */
export function recommendations(from, to, info) {
  const topGenres = new Set(topEntries(to.genres, 3).map(([g]) => g));
  const out = [];
  for (const id of from.loved) {
    if (to.ratings.has(`album:${id}`) || to.completed?.has(id)) continue;
    const meta = info(id);
    if (!meta) continue;
    const mine = from.ratings.get(`album:${id}`) ?? 9;
    out.push({ id, artistId: meta.artistId, key: mine + (meta.genre && topGenres.has(meta.genre) ? 1.5 : 0), bayes: meta.bayes ?? BAYES.m });
  }
  out.sort((x, y) => y.key - x.key || y.bayes - x.bayes || String(x.id).localeCompare(String(y.id)));
  const perArtist = new Map();
  const picked = [];
  for (const r of out) {
    const n = perArtist.get(r.artistId) || 0;
    if (n >= RECOMMEND_PER_ARTIST) continue;
    perArtist.set(r.artistId, n + 1);
    picked.push(r.id);
    if (picked.length >= RECOMMEND_MAX) break;
  }
  return picked;
}

/** Résultat vu de l'autre côté de la paire : différences et recommandations inversées. */
export function flipResult(data) {
  return {
    ...data,
    differences: (data.differences || []).map((d) => ({ ...d, a: d.b, b: d.a })),
    recAtoB: data.recBtoA || [],
    recBtoA: data.recAtoB || [],
  };
}
