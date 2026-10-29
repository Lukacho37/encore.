// Prestige mondial : le calcul qui règle les raretés du catalogue (demande du propriétaire du 2026-10-29). Un album
// écouté dans le monde entier et devenu culte (« Graduation ») doit être bien plus dur à compléter qu'un album surtout
// écouté dans un seul pays. Les signaux viennent de server/prestige.js ; ce fichier ne fait que les combiner.
//
// Score d'un album (0 à 1) = 0,45 · culte + 0,40 · auditeurs + 0,15 · fans Deezer, chaque signal en percentile :
//   - culte : nombre d'éditions linguistiques de Wikipédia qui consacrent un article à l'album ;
//   - auditeurs : auditeurs ListenBrainz de l'album dans le monde ;
//   (album introuvable sur Wikidata ou ListenBrainz : une part des chiffres de l'artiste, d'autant plus petite que
//   l'album a peu de fans à côté du plus suivi de l'artiste — une compilation obscure d'une star reste modeste)
//   - fans Deezer de l'album : poids faible, l'audience de Deezer est surtout française.
// Album pas encore évalué : ses fans Deezer seulement.
// Score d'un morceau = 0,7 · score de son album + 0,3 · place du morceau dans son album (rang Deezer comparé aux autres
// morceaux du même album : ses tubes, sans biais de pays). Single promo : score de l'artiste (son meilleur album) et
// rang parmi les promos.

export const PRESTIGE_WEIGHTS = Object.freeze({ links: 0.45, listeners: 0.4, fans: 0.15 });
export const ALBUM_WEIGHT = 0.7;
/** Album sans article Wikipédia ou sans auditeurs connus : part de l'artiste retenue, pour son album le plus suivi. */
export const ARTIST_LINKS_SHARE = 0.3;
export const ARTIST_LISTENERS_SHARE = 0.08;

/** Percentile de chaque valeur (0 à 1, comme percent_rank en SQL : les ex aequo partagent le plus petit rang). */
export function percentiles(values) {
  const n = values.length;
  const out = new Array(n).fill(1);
  if (n < 2) return out;
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  let start = 0;
  for (let k = 1; k <= n; k++) {
    if (k === n || values[order[k]] !== values[order[start]]) {
      for (let j = start; j < k; j++) out[order[j]] = start / (n - 1);
      start = k;
    }
  }
  return out;
}

/**
 * Score de chaque album. albums : [{ id, artistId, links, listeners, fans, known }] (known : signaux collectés) ;
 * artists : Map id → { links, listeners }. Renvoie Map id → score.
 */
export function albumScores(albums, artists = new Map()) {
  const fansOf = (a) => Math.max(0, Number(a.fans) || 0);
  const pFans = percentiles(albums.map((a) => Math.log1p(fansOf(a))));
  const topFans = new Map();
  for (const a of albums) topFans.set(a.artistId, Math.max(topFans.get(a.artistId) || 0, fansOf(a)));
  const known = [];
  const links = [];
  const listeners = [];
  albums.forEach((a, i) => {
    if (!a.known) return;
    const ar = artists.get(a.artistId) || {};
    const weight = Math.sqrt(fansOf(a) / Math.max(1, topFans.get(a.artistId) || 0));
    known.push(i);
    links.push(Math.log1p(a.links > 0 ? a.links : (ar.links || 0) * ARTIST_LINKS_SHARE * weight));
    listeners.push(Math.log1p(a.listeners > 0 ? a.listeners : (ar.listeners || 0) * ARTIST_LISTENERS_SHARE * weight));
  });
  const pLinks = percentiles(links);
  const pListeners = percentiles(listeners);
  const scores = new Map(albums.map((a, i) => [a.id, pFans[i]]));
  known.forEach((i, k) => {
    const w = PRESTIGE_WEIGHTS;
    scores.set(albums[i].id, w.links * pLinks[k] + w.listeners * pListeners[k] + w.fans * pFans[i]);
  });
  return scores;
}

/**
 * Score de chaque morceau. tracks : [{ id, albumId, artistId, kind, rank }] ; albumScore : Map (albumScores).
 * Renvoie un tableau de scores, dans l'ordre de `tracks`.
 */
export function trackScores(tracks, albumScore) {
  const artistScore = new Map();
  for (const t of tracks) {
    const s = t.albumId != null ? albumScore.get(t.albumId) : undefined;
    if (s !== undefined && s > (artistScore.get(t.artistId) ?? -1)) artistScore.set(t.artistId, s);
  }
  // Place de chaque morceau dans son album (les promos entre elles).
  const groups = new Map();
  tracks.forEach((t, i) => {
    const key = t.albumId != null ? `a:${t.albumId}` : 'promo';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const hit = new Array(tracks.length).fill(1);
  for (const idx of groups.values()) {
    const p = percentiles(idx.map((i) => Number(tracks[i].rank) || 0));
    idx.forEach((i, k) => {
      hit[i] = p[k];
    });
  }
  return tracks.map((t, i) => {
    const base = t.albumId != null ? albumScore.get(t.albumId) ?? 0 : artistScore.get(t.artistId) ?? 0;
    return ALBUM_WEIGHT * base + (1 - ALBUM_WEIGHT) * hit[i];
  });
}
