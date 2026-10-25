// Identifiants du catalogue et des fournisseurs (PLAN.md 3.1, 7.1) — chantier P2-C. Partagé par le serveur
// (importer.js, enrich.js), le site (ListenPanel) et la démo (mock/enrich.js).
//
// 1. Identifiants AlbumMania. La graine garde ses identifiants lisibles (« discovery », « discovery:01 »), l'import
//    Deezer les siens (« dz302127 », « dz302127:01 », « promo:dz3135553 ») ; toute ligne créée par une autre source
//    reçoit un identifiant neutre « ar_… », « al_… », « tr_… » (base 36). Les données du jeu (raretés, codes AM-xxx,
//    coffrets, notes, cartes) pointent toujours vers ces identifiants, jamais vers ceux d'un fournisseur.
// 2. Identifiants des fournisseurs (table external_ids) : leur format est vérifié avant tout usage, aucune adresse
//    n'est construite avec une valeur douteuse.
// 3. Adresses officielles, recherches et lecteurs intégrés, construits à partir de (source, type, identifiant).

export const ENTITY_TYPES = ['artist', 'album', 'track'];
export const SOURCES = ['deezer', 'spotify', 'apple', 'musicbrainz', 'wikidata', 'discogs', 'upc', 'isrc'];
/** Fournisseurs d'écoute proposés par le panneau d'écoute, dans l'ordre par défaut. */
export const LISTEN_PROVIDERS = ['deezer', 'spotify', 'apple', 'youtube'];
export const PROVIDER_NAMES = {
  deezer: 'Deezer', spotify: 'Spotify', apple: 'Apple Music', youtube: 'YouTube', musicbrainz: 'MusicBrainz', wikidata: 'Wikidata',
};

const PREFIX = { artist: 'ar_', album: 'al_', track: 'tr_' };
const NEUTRAL = /^(ar|al|tr)_[0-9a-z]{10,24}$/;

/**
 * Identifiant neutre d'une ligne du catalogue créée par une source autre que Deezer : préfixe du type, instant en
 * base 36 (ordre de création) et 6 caractères aléatoires. `now` et `random` : pour des tests reproductibles.
 */
export function neutralId(type, { now = Date.now(), random = Math.random } = {}) {
  const prefix = PREFIX[type];
  if (!prefix) throw new TypeError(`type d'élément inconnu : ${type}`);
  let tail = '';
  for (let i = 0; i < 6; i++) tail += Math.floor(random() * 36).toString(36);
  return `${prefix}${Math.max(0, Math.floor(now)).toString(36).padStart(9, '0')}${tail}`;
}

/** Vrai pour un identifiant neutre (« al_… »), éventuellement précédé de « promo: ». */
export const isNeutralId = (id) => typeof id === 'string' && NEUTRAL.test(id.replace(/^promo:/, ''));

/**
 * Identifiant AlbumMania d'un artiste, d'un album ou d'une promo venu d'une source : « dz<id> » pour Deezer (forme
 * historique, gardée pour les bases existantes), un identifiant neutre pour toute autre source. Les promos (single
 * hors album) gardent le préfixe « promo: » ; les morceaux d'un album se nomment avec albumTrackId().
 */
export function catalogIdFor(source, type, sourceId, { promo = false, ...opts } = {}) {
  const base = source === 'deezer' && validSourceId('deezer', sourceId) ? `dz${sourceId}` : neutralId(type, opts);
  return type === 'track' && promo ? `promo:${base}` : base;
}

/** Morceau n° `n` d'un album : « <album>:01 ». */
export const albumTrackId = (albumId, n) => `${albumId}:${String(n).padStart(2, '0')}`;

// ---------- identifiants des fournisseurs ----------

const FORMATS = {
  deezer: /^\d{1,14}$/,
  spotify: /^[0-9A-Za-z]{22}$/,
  apple: /^\d{1,14}$/,
  musicbrainz: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  wikidata: /^Q[1-9]\d{0,11}$/,
  discogs: /^\d{1,12}$/,
  upc: /^\d{8,14}$/,
  isrc: /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/,
};

/** Le format de l'identifiant convient-il à la source ? (un nombre est accepté pour les sources numériques) */
export function validSourceId(source, value) {
  const re = FORMATS[source];
  if (!re) return false;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 && re.test(String(value));
  return typeof value === 'string' && re.test(value);
}

/** Forme rangée en base : chaîne, ISRC en majuscules sans tirets, UPC sans espaces ; null si invalide. */
export function cleanSourceId(source, value) {
  if (value == null) return null;
  let v = String(value).trim();
  if (source === 'isrc') v = v.toUpperCase().replace(/[-\s]/g, '');
  if (source === 'upc') v = v.replace(/\s/g, '');
  if (source === 'musicbrainz') v = v.toLowerCase();
  return validSourceId(source, v) ? v : null;
}

/** Deux codes-barres égaux à des zéros de tête près (UPC-A à 12 chiffres, EAN-13 à 13). */
export const sameBarcode = (a, b) => !!a && !!b && String(a).replace(/^0+/, '') === String(b).replace(/^0+/, '');

/** Identifiant Deezer d'un lien de page Deezer (« …deezer.com/fr/album/302127 ») s'il est du bon type, sinon null. */
export function deezerIdOf(url, kind) {
  const m = /^https:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(album|track|artist)\/(\d+)/i.exec(String(url || ''));
  return m && m[1].toLowerCase() === kind ? m[2] : null;
}

const APPLE_TYPE = { album: 'album', track: 'song', artist: 'artist' };
const storefrontOf = (sf) => (/^[a-z]{2}$/.test(String(sf || '')) ? sf : 'fr');

/**
 * Lit une adresse de fournisseur (relations d'URL de MusicBrainz, liens d'une page) : { source, type, id, storefront? }
 * ou null. Seules les adresses officielles reconnues sont gardées.
 */
export function parseProviderUrl(url) {
  const u = String(url || '').trim();
  let m;
  if ((m = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(album|artist|track)\/([0-9A-Za-z]{22})(?:[/?#]|$)/.exec(u))) {
    return { source: 'spotify', type: m[1], id: m[2] };
  }
  if ((m = /^https?:\/\/(?:music|itunes|geo\.music)\.apple\.com\/(?:([a-z]{2})\/)?(album|artist|song)\/(?:[^/?#]+\/)?(?:id)?(\d{1,14})(?:[/?#]|$)/.exec(u))) {
    const type = m[2] === 'song' ? 'track' : m[2];
    const track = type === 'album' && /[?&]i=(\d{1,14})/.exec(u);
    return track ? { source: 'apple', type: 'track', id: track[1], storefront: m[1] || null }
      : { source: 'apple', type, id: m[3], storefront: m[1] || null };
  }
  if ((m = /^https?:\/\/(?:www\.)?wikidata\.org\/(?:wiki|entity)\/(Q[1-9]\d{0,11})(?:[/?#]|$)/.exec(u))) {
    return { source: 'wikidata', type: null, id: m[1] };
  }
  if ((m = /^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(album|artist|track)\/(\d{1,14})(?:[/?#]|$)/.exec(u))) {
    return { source: 'deezer', type: m[1], id: m[2] };
  }
  if ((m = /^https?:\/\/(?:www\.)?discogs\.com\/(?:[a-z]{2}\/)?(master|release|artist)\/(\d{1,12})/.exec(u))) {
    return { source: 'discogs', type: m[1] === 'artist' ? 'artist' : 'album', id: m[2] };
  }
  return null;
}

/**
 * Page officielle d'un élément chez une source (null si l'identifiant est invalide). MusicBrainz : `mbType` précise
 * l'entité (release-group, release, recording, artist), car l'identifiant seul ne le dit pas.
 */
export function sourceUrl(source, type, id, { storefront, mbType } = {}) {
  if (!validSourceId(source, typeof id === 'number' ? id : String(id ?? ''))) return null;
  switch (source) {
    case 'deezer':
      return ENTITY_TYPES.includes(type) ? `https://www.deezer.com/${type}/${id}` : null;
    case 'spotify':
      return ENTITY_TYPES.includes(type) ? `https://open.spotify.com/${type}/${id}` : null;
    case 'apple':
      return APPLE_TYPE[type] ? `https://music.apple.com/${storefrontOf(storefront)}/${APPLE_TYPE[type]}/${id}` : null;
    case 'musicbrainz': {
      const kind = mbType || { artist: 'artist', album: 'release-group', track: 'recording' }[type];
      return ['artist', 'release-group', 'release', 'recording'].includes(kind) ? `https://musicbrainz.org/${kind}/${id}` : null;
    }
    case 'wikidata':
      return `https://www.wikidata.org/wiki/${id}`;
    case 'discogs':
      return `https://www.discogs.com/${type === 'artist' ? 'artist' : 'master'}/${id}`;
    default:
      return null;
  }
}

/** Recherche « artiste titre » sur une plateforme d'écoute (aucune API : une simple page de recherche). */
export function searchUrl(provider, text) {
  const q = encodeURIComponent(String(text || '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim());
  switch (provider) {
    case 'deezer': return `https://www.deezer.com/search/${q}`;
    case 'spotify': return `https://open.spotify.com/search/${q}`;
    case 'apple': return `https://music.apple.com/search?term=${q}`;
    case 'youtube': return `https://www.youtube.com/results?search_query=${q}`;
    default: return null;
  }
}

/** Hauteur (px) de chaque lecteur officiel, selon le type d'élément. */
export const EMBED_HEIGHTS = {
  deezer: { album: 300, track: 150 },
  spotify: { album: 352, track: 152, artist: 352 },
  apple: { album: 450, track: 175 },
};

/**
 * Lecteur officiel d'un élément : { provider, src, height } ou null. Jamais de lecture automatique (aucun paramètre
 * autoplay), jamais de fichier audio servi par AlbumMania : le lecteur est la page intégrable du fournisseur.
 */
export function embedFor(source, type, id, { storefront } = {}) {
  const height = EMBED_HEIGHTS[source]?.[type];
  if (!height || !validSourceId(source, String(id ?? ''))) return null;
  if (source === 'deezer') return { provider: 'deezer', src: `https://widget.deezer.com/widget/dark/${type}/${id}`, height };
  if (source === 'spotify') return { provider: 'spotify', src: `https://open.spotify.com/embed/${type}/${id}`, height };
  if (source === 'apple') return { provider: 'apple', src: `https://embed.music.apple.com/${storefrontOf(storefront)}/${APPLE_TYPE[type]}/${id}`, height };
  return null;
}

/** Vitrine Apple Music d'une langue du site (« fr » par défaut, « us » en anglais). */
export const appleStorefront = (lang) => (lang === 'en' ? 'us' : 'fr');
