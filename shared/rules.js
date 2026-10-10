// Règles du jeu partagées par le serveur, le client et la démo.
// Tous les réglages d'équilibrage sont regroupés ici.
//
// Les fonctions qui ont besoin du catalogue le reçoivent en argument : la base de données côté serveur
// (server/catalog.js, jusqu'à 20 000 albums et plus) ou le catalogue statique de la démo (shared/staticCatalog.js).
// Ces deux catalogues ont la même interface.
import { decadeOf } from './catalog.js';

export const RARITIES = ['common', 'uncommon', 'rare', 'super', 'ultra', 'legendary', 'promo'];

export const RARITY = {
  // Couleurs calquées sur ⚪ 🟢 🔵 🟣 🟠 ⭐ 🟥
  common: { rank: 0, pips: 1, color: '#e6e1ec', xp: 5, recycle: 5, press: 40 },
  uncommon: { rank: 1, pips: 2, color: '#7fd36b', xp: 10, recycle: 10, press: 80 },
  rare: { rank: 2, pips: 3, color: '#4f9dff', xp: 20, recycle: 25, press: 200 },
  super: { rank: 3, pips: 4, color: '#b17dff', xp: 40, recycle: 50, press: 400 },
  ultra: { rank: 4, pips: 5, color: '#ff8b3d', xp: 80, recycle: 100, press: 800 },
  legendary: { rank: 5, pips: 6, color: '#ffd35a', xp: 150, recycle: 250, press: 1600 },
  // Les promos ne peuvent pas être pressées : on ne les obtient qu'en booster.
  promo: { rank: 6, pips: 0, color: '#ef3b3b', xp: 100, recycle: 150, press: null },
};

export const PACK_SIZE = 5;

// Probabilités (en %) de chaque emplacement du booster. Le 5e est l'emplacement « hit ».
export const PACK_SLOTS = [
  { common: 70, uncommon: 25, rare: 5 },
  { common: 70, uncommon: 25, rare: 5 },
  { common: 55, uncommon: 35, rare: 10 },
  { uncommon: 50, rare: 35, super: 12, ultra: 3 },
  { rare: 52, super: 26, ultra: 11, legendary: 5, promo: 6 },
];

export const HOLO_CHANCE = 0.05;
// Booster gratuit : chaque emplacement (hors promo) a 35 % de chances de viser les albums du joueur, sinon avec
// 20 000 albums compléter un album par hasard serait presque impossible (PLAN.md 6.4) :
//   25 % : cartes manquantes de ses « Albums recherchés » (liste d'envies) ;
//   10 % : ses 20 albums commencés les plus avancés (ceux à 50 % ou plus d'abord).
// Liste d'envies vide (ou déjà complète) : les 35 % vont aux albums les plus avancés.
export const WISHLIST_FOCUS = 0.25;
export const ADVANCED_FOCUS = 0.1;
export const FOCUS_CHANCE = WISHLIST_FOCUS + ADVANCED_FOCUS;
export const ADVANCED_ALBUMS = 20;
// Emplacement promo : une fois sur deux, une promo d'un artiste dont le joueur a des cartes ou un album recherché.
export const PROMO_FOCUS = 0.5;
// Pitié douce (PLAN.md 6.5) : le 10e booster d'affilée sans carte ultra ou mieux tire son emplacement « hit » parmi
// ultra, légendaire et promo seulement, en gardant leurs poids (11 : 5 : 6 → 50 % / 23 % / 27 %).
export const PITY_AFTER = 10;
export const PITY_SLOT = { ultra: 11, legendary: 5, promo: 6 };
/** Carte « ultra ou mieux » : elle remet le compteur de pitié à zéro. */
export const isHit = (rarity) => rarity === 'ultra' || rarity === 'legendary' || rarity === 'promo';
// Promos pressables (PLAN.md 6.4) : 1 200 royalties, une fois un album de l'artiste complété.
export const PROMO_PRESS_COST = 1200;
// Booster d'album : poids de tirage par rareté (les cartes manquantes passent toujours avant celles déjà possédées).
export const ALBUM_PACK_WEIGHTS = { common: 8, uncommon: 6, rare: 4, super: 2.5, ultra: 1.5, legendary: 1, promo: 1 };
export const HOLO_CHANCE_TOP = 0.12; // légendaires et promos

export const ECONOMY = {
  packPrice: 120, // royalties
  albumPackPrice: 300, // booster d'album : 5 cartes de l'album choisi, en priorité celles qui manquent
  duplicateXpRatio: 0.2,
  holoRecycleMultiplier: 2,
  albumRewardPerTrack: 20, // royalties par piste de l'album complété
  albumXpPerTrack: 15,
  artistReward: 500,
  artistXp: 400,
  welcomePacks: 5,
  welcomeRoyalties: 200,
  // Droits d'auteur touchés pour chaque nouvelle carte (hors pressage) : avec 250 000 cartes, les doublons à recycler
  // sont rares, c'est la principale source de royalties pour les boosters d'album (≈ 30 par booster gratuit).
  newCardRoyalties: { common: 2, uncommon: 3, rare: 6, super: 12, ultra: 30, legendary: 75, promo: 50 },
};

export const BLINDTEST = {
  rounds: 5,
  roundSeconds: 20,
  rewardedGamesPerDay: 3,
  // bonnes réponses -> boosters gagnés
  rewards: { 5: 3, 4: 2, 3: 1 },
};

export const SHOWCASE_SLOTS = 6;
export const AVATAR_COLORS = ['#ff4f7e', '#ff8b3d', '#ffd35a', '#7fd36b', '#3fd6c4', '#4f9dff', '#b17dff', '#f4eee3'];

/** Niveau de collectionneur à partir de l'XP. */
export function levelFromXp(xp) {
  const level = Math.floor(Math.sqrt(xp / 50)) + 1;
  const floor = 50 * (level - 1) ** 2;
  const next = 50 * level ** 2;
  return { level, xp, floor, next, progress: (xp - floor) / (next - floor) };
}

// --- Paliers de niveau (PLAN.md 6.6) -----------------------------------------------------------------------------

// Chaque niveau gagné rapporte un booster bonus, quelle que soit la source de l'XP ; tous les 10 niveaux, un
// booster spécial « À ton goût » en plus. Les cosmétiques des paliers sont dans shared/cosmetics.js.
export const LEVEL_UP_BOOSTERS = 1;
export const THEMED_BOOSTER_EVERY = 10;
// Albums recherchés : 12 places, +4 aux niveaux 10, 25 et 50. Vitrine : 6 cartes, +1 aux niveaux 10 et 30.
export const WISHLIST_SLOTS = 12;
export const WISHLIST_BONUS_LEVELS = [10, 25, 50];
export const SHOWCASE_BONUS_LEVELS = [10, 30];

export const wishlistMax = (level) => WISHLIST_SLOTS + 4 * WISHLIST_BONUS_LEVELS.filter((l) => level >= l).length;
export const showcaseSlots = (level) => SHOWCASE_SLOTS + SHOWCASE_BONUS_LEVELS.filter((l) => level >= l).length;

/**
 * Récompenses du passage du niveau `from` au niveau `to` : boosters bonus (un par niveau gagné), niveaux qui
 * donnent un booster spécial (multiples de 10) et places gagnées (albums recherchés, vitrine).
 */
export function levelRewards(from, to) {
  const themed = [];
  for (let l = from + 1; l <= to; l++) if (l % THEMED_BOOSTER_EVERY === 0) themed.push(l);
  return {
    from,
    to,
    boosters: Math.max(0, to - from) * LEVEL_UP_BOOSTERS,
    themed,
    wishlist: wishlistMax(to) - wishlistMax(from),
    showcase: showcaseSlots(to) - showcaseSlots(from),
  };
}

function pickWeighted(weights, rng) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll < 0) return key;
  }
  return entries[entries.length - 1][0];
}

// Si une rareté manque dans le catalogue (aucune promo par exemple), on descend d'un cran.
const FALLBACK = ['promo', 'legendary', 'ultra', 'super', 'rare', 'uncommon', 'common'];

const holoRoll = (rarity, rng) => rng() < (rarity === 'legendary' || rarity === 'promo' ? HOLO_CHANCE_TOP : HOLO_CHANCE);
const byRank = (a, b) => RARITY[a.rarity].rank - RARITY[b.rarity].rank;

/** Emplacements du booster quand la pitié douce joue : l'emplacement « hit » ne tire plus qu'ultra, légendaire ou promo. */
export const PITY_SLOTS = [...PACK_SLOTS.slice(0, -1), PITY_SLOT];

/** Une carte d'un thème (genres et/ou décennie) : un genre au hasard parmi ceux du thème à chaque emplacement. */
function themeFilter(theme, rng) {
  const filter = {};
  if (theme.genres?.length) filter.genre = theme.genres[Math.floor(rng() * theme.genres.length)];
  if (theme.decade != null) filter.decade = theme.decade;
  return filter;
}

/**
 * Tire le contenu d'un booster (5 cartes, probabilités de PACK_SLOTS). `rng` renvoie un flottant dans [0, 1).
 * Options :
 *   wishlist        { albumIds, owned } : albums recherchés pas encore complets et cartes déjà possédées parmi eux ;
 *                   WISHLIST_FOCUS des emplacements (hors promo) tirent une de leurs cartes manquantes ;
 *   focusAlbumIds   albums commencés les plus avancés : ADVANCED_FOCUS des emplacements (FOCUS_CHANCE sans liste
 *                   d'envies) ;
 *   promoArtistIds  artistes du joueur (tableau, ou fonction appelée seulement si l'emplacement promo sort) :
 *                   PROMO_FOCUS des promos tirées viennent de ces artistes ;
 *   pity            boosters d'affilée sans carte ultra ou mieux : à partir de PITY_AFTER - 1, l'emplacement hit de
 *                   ce booster tire parmi ultra, légendaire et promo (PITY_SLOT) ;
 *   theme           { genres?, decade? } : booster thématique, toutes les cartes viennent du thème (sans ciblage) ;
 * Rareté absente (du thème, des albums visés, du catalogue) : on descend d'un cran, puis on tire dans tout le
 * catalogue. Les cartes sont triées de la moins rare à la plus rare : la meilleure arrive en dernier.
 */
export function rollPack(rng, catalog, { wishlist = null, focusAlbumIds = [], promoArtistIds = null, pity = 0, theme = null } = {}) {
  const exclude = new Set();
  const cards = [];
  const wish = wishlist?.albumIds?.length ? wishlist : null;
  // Cartes déjà dans ce booster ou déjà possédées : la liste d'envies ne vise que les cartes manquantes.
  const wishExclude = wish ? { has: (id) => exclude.has(id) || !!wish.owned?.has(id) } : null;
  const advanced = focusAlbumIds?.length ? focusAlbumIds : null;
  const slots = pity >= PITY_AFTER - 1 ? PITY_SLOTS : PACK_SLOTS;
  for (const slot of slots) {
    const wanted = pickWeighted(slot, rng);
    let track = null;
    if (theme) {
      for (let i = FALLBACK.indexOf(wanted); !track && i < FALLBACK.length; i++) {
        track = catalog.randomTrack({ rarity: FALLBACK[i], ...themeFilter(theme, rng), exclude }, rng);
      }
    } else if (wanted === 'promo') {
      if (promoArtistIds && rng() < PROMO_FOCUS) {
        const artistIds = typeof promoArtistIds === 'function' ? promoArtistIds() : promoArtistIds;
        if (artistIds?.length) track = catalog.randomTrack({ rarity: 'promo', artistIds, exclude }, rng);
      }
    } else if (wish || advanced) {
      const roll = rng();
      if (wish && roll < WISHLIST_FOCUS) track = catalog.randomTrack({ rarity: wanted, albumIds: wish.albumIds, exclude: wishExclude }, rng);
      else if (advanced && roll < FOCUS_CHANCE) track = catalog.randomTrack({ rarity: wanted, albumIds: advanced, exclude }, rng);
    }
    for (let i = FALLBACK.indexOf(wanted); !track && i < FALLBACK.length; i++) {
      track = catalog.randomTrack({ rarity: FALLBACK[i], exclude }, rng);
    }
    if (!track) continue;
    exclude.add(track.id);
    cards.push({ trackId: track.id, rarity: track.rarity, variant: holoRoll(track.rarity, rng) ? 'holo' : 'std' });
  }
  return cards.sort(byRank);
}

/** Une carte au hasard dans une liste, pondérée par rareté (booster d'album). */
function pickByRarity(list, rng) {
  const weights = list.map((t) => ALBUM_PACK_WEIGHTS[t.rarity] || 1);
  let roll = rng() * weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < list.length; k++) {
    roll -= weights[k];
    if (roll < 0) return list[k];
  }
  return list[list.length - 1];
}

/**
 * Booster d'album : 5 cartes de l'album choisi, différentes tant que l'album en a assez, pondérées par rareté.
 * Les cartes que le joueur n'a pas sortent d'abord : une carte déjà possédée ne complète le booster que lorsqu'il
 * ne reste plus aucune carte manquante à tirer.
 */
export function rollAlbumPack(rng, catalog, albumId, owned = new Set()) {
  const pool = catalog.albumTracks(albumId);
  if (!pool.length) return [];
  const missing = pool.filter((t) => !owned.has(t.id));
  const have = pool.filter((t) => owned.has(t.id));
  const cards = [];
  const used = new Set();
  for (let i = 0; i < PACK_SIZE; i++) {
    let candidates = missing.filter((t) => !used.has(t.id));
    if (!candidates.length) candidates = have.filter((t) => !used.has(t.id));
    // Album de moins de 5 cartes : toutes y sont déjà, le reste du booster est tiré dans tout l'album.
    if (!candidates.length) candidates = pool;
    const pick = pickByRarity(candidates, rng);
    used.add(pick.id);
    cards.push({ trackId: pick.id, rarity: pick.rarity, variant: holoRoll(pick.rarity, rng) ? 'holo' : 'std' });
  }
  return cards.sort(byRank);
}

// --- Boosters spéciaux (PLAN.md 6.10) -----------------------------------------------------------------------------

// Inventaire user_boosters : boosters thématiques (kind 'theme') et boosters d'album (kind 'album'). Thèmes :
//   genre:<genre>   cartes de ce genre (« genre:electro ») ;
//   decade:<année>  cartes de cette décennie (« decade:1990 ») ;
//   taste           « À ton goût » : les 3 genres où le joueur a le plus de cartes (ses genres favoris d'abord) ;
//   event:<slug>    thème d'un événement (EVENT_THEMES ; les événements eux-mêmes arrivent en P2) ;
//   album:<id>      booster d'album offert (5 cartes de cet album, manquantes d'abord) ;
//   album:choice    booster d'album au choix : le joueur choisit l'album à l'ouverture.
// Les chances par emplacement sont celles du booster standard (pitié comprise), seul le réservoir change.
export const THEME_GENRES = ['pop', 'rock', 'rap', 'electro', 'soul', 'jazz', 'reggae', 'chanson', 'latin', 'metal', 'country', 'classical', 'soundtrack', 'world'];
/** Thèmes des événements du calendrier (shared/events.js en P2) : genres et/ou décennie. */
export const EVENT_THEMES = {
  'french-touch': { genres: ['electro'] },
  'annees-80': { decade: 1980 },
  'rap-us-90': { genres: ['rap'], decade: 1990 },
  'rock-legends': { genres: ['rock'] },
  'chansons-d-europe': { genres: ['pop', 'chanson'] },
};

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ALBUM_ID = /^[\w.:-]{1,80}$/;

/**
 * Lit le thème d'un booster spécial : { kind: 'genre' | 'decade' | 'taste' | 'event' | 'album' | 'choice', value }
 * (value : le genre, la décennie, le slug ou l'identifiant d'album) ; null si le thème est inconnu.
 */
export function parseBoosterTheme(theme) {
  const s = String(theme ?? '');
  if (s === 'taste') return { kind: 'taste', value: null };
  if (s === 'album:choice') return { kind: 'choice', value: null };
  const i = s.indexOf(':');
  if (i <= 0) return null;
  const [kind, value] = [s.slice(0, i), s.slice(i + 1)];
  if (kind === 'genre' && THEME_GENRES.includes(value)) return { kind, value };
  if (kind === 'decade' && /^(19[5-9]0|20[0-3]0)$/.test(value)) return { kind, value: Number(value) };
  if (kind === 'event' && SLUG.test(value)) return { kind, value };
  if (kind === 'album' && ALBUM_ID.test(value)) return { kind, value };
  return null;
}

/** Réservoir d'un booster thématique pour rollPack ({ genres, decade }) ; null = tout le catalogue. */
export function themeFilterOf(parsed, { tasteGenres = [] } = {}) {
  if (!parsed) return null;
  if (parsed.kind === 'genre') return { genres: [parsed.value] };
  if (parsed.kind === 'decade') return { decade: parsed.value };
  if (parsed.kind === 'taste') return tasteGenres.length ? { genres: tasteGenres.slice(0, 3) } : null;
  if (parsed.kind === 'event') return EVENT_THEMES[parsed.value] || null;
  return null;
}

/** Chances d'un booster, telles que la page « Voir les chances » les affiche (GET /api/boosters/odds). */
export function boosterOdds(theme = null) {
  const parsed = theme ? parseBoosterTheme(theme) : null;
  const album = parsed?.kind === 'album' || parsed?.kind === 'choice';
  return {
    theme: theme || null,
    kind: parsed?.kind || 'standard',
    // Booster d'album : poids par carte (les cartes manquantes d'abord), pas d'emplacements.
    ...(album
      ? { albumWeights: ALBUM_PACK_WEIGHTS, missingFirst: true }
      : {
        slots: PACK_SLOTS,
        perBooster: packOdds(),
        pity: { after: PITY_AFTER, slot: PITY_SLOT, perBooster: packOdds(PITY_SLOTS) },
        ...(parsed ? {} : { focus: { wishlist: WISHLIST_FOCUS, advanced: ADVANCED_FOCUS, advancedAlbums: ADVANCED_ALBUMS, promo: PROMO_FOCUS } }),
      }),
    holo: HOLO_CHANCE,
    holoTop: HOLO_CHANCE_TOP,
  };
}

/** Probabilité d'obtenir au moins une carte de chaque rareté dans un booster (`slots` : PITY_SLOTS quand la pitié joue). */
export function packOdds(slots = PACK_SLOTS) {
  const odds = {};
  for (const r of RARITIES) {
    let none = 1;
    for (const slot of slots) {
      const total = Object.values(slot).reduce((s, w) => s + w, 0);
      none *= 1 - (slot[r] || 0) / total;
    }
    odds[r] = 1 - none;
  }
  return odds;
}

/** Valeur en royalties d'un doublon. */
export function recycleValue(rarity, variant) {
  const base = RARITY[rarity]?.recycle || 0;
  return variant === 'holo' ? base * ECONOMY.holoRecycleMultiplier : base;
}

/** Royalties gagnées en obtenant une carte qu'on n'avait pas. */
export function newCardRoyalties(rarity) {
  return ECONOMY.newCardRoyalties[rarity] || 0;
}

export function xpForCard(rarity, isNew) {
  const base = RARITY[rarity]?.xp || 0;
  return isNew ? base : Math.round(base * ECONOMY.duplicateXpRatio);
}

/**
 * Coût pour « presser » (fabriquer) une carte manquante ; null si impossible. Une promo se presse seulement une fois
 * un album de son artiste complété (`promoUnlocked`, vérifié par le serveur).
 */
export function pressCost(rarity, { promoUnlocked = false } = {}) {
  if (rarity === 'promo') return promoUnlocked ? PROMO_PRESS_COST : null;
  return RARITY[rarity]?.press ?? null;
}

export function albumReward(trackCount) {
  return { royalties: trackCount * ECONOMY.albumRewardPerTrack, xp: trackCount * ECONOMY.albumXpPerTrack };
}

/**
 * Détermine les albums et artistes nouvellement complétés.
 * `owned` : Set des trackId possédés (toutes variantes). `already` : Set des clés de succès déjà obtenues.
 * `touched` : cartes qui viennent d'être obtenues (objets du catalogue, avec albumId et artistId).
 */
export function newAchievements({ owned, already, touched, catalog }) {
  const result = [];
  const albums = new Set();
  const artists = new Set();
  for (const t of touched) {
    if (!t) continue;
    if (t.albumId) albums.add(t.albumId);
    artists.add(t.artistId);
  }
  for (const albumId of albums) {
    const key = `album:${albumId}`;
    if (already.has(key)) continue;
    const ids = catalog.albumTrackIds(albumId);
    if (ids.length && ids.every((id) => owned.has(id))) result.push({ key, type: 'album', id: albumId, ...albumReward(ids.length) });
  }
  for (const artistId of artists) {
    const key = `artist:${artistId}`;
    if (already.has(key)) continue;
    const ids = catalog.artistTrackIds(artistId);
    if (ids.length && ids.every((id) => owned.has(id))) {
      result.push({ key, type: 'artist', id: artistId, royalties: ECONOMY.artistReward, xp: ECONOMY.artistXp });
    }
  }
  return result;
}

// --- Blind test ------------------------------------------------------------

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Morceaux connus d'abord : on n'abaisse le seuil de popularité que si le genre en manque. */
function knownTracks(catalog, { genre, count, exclude }, rng) {
  for (const minPop of [70, 55, 35, 0]) {
    const list = catalog.randomTracks({ genre, minPop, count, exclude }, rng);
    if (list.length >= count || minPop === 0) return list;
  }
  return [];
}

/** Prépare les questions d'une partie : un morceau connu à deviner + 3 leurres du même genre. */
export function buildBlindtest(genre, rng, catalog) {
  const answers = knownTracks(catalog, { genre, count: BLINDTEST.rounds }, rng);
  return answers.map((answer) => {
    const exclude = new Set([answer.id]);
    const sameGenre = genre === 'all' ? answer.genre : genre;
    const decoys = knownTracks(catalog, { genre: sameGenre, count: 6, exclude }, rng)
      .filter((t) => t.title.toLowerCase() !== answer.title.toLowerCase())
      .slice(0, 3);
    return { answer: answer.id, choices: shuffle([answer.id, ...decoys.map((t) => t.id)], rng) };
  });
}

/** Indices révélés progressivement quand aucun extrait audio n'est disponible (carte du catalogue). */
export function blindtestClues(t) {
  const words = t.title.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return [
    { type: 'decade', value: t.year ? decadeOf(t.year) : null },
    { type: 'country', value: t.country || null },
    { type: 'year', value: t.year || null },
    { type: 'position', value: t.kind === 'promo' ? null : { n: t.n, total: t.total } },
    { type: 'words', value: { count: words.length, initial: words[0]?.[0]?.toUpperCase() || '?' } },
  ];
}

export function blindtestPoints(correct, elapsedMs) {
  if (!correct) return 0;
  const seconds = Math.min(BLINDTEST.roundSeconds, Math.max(0, elapsedMs / 1000));
  return Math.round(200 + 800 * (1 - seconds / BLINDTEST.roundSeconds));
}

export function blindtestReward(correctCount) {
  return BLINDTEST.rewards[correctCount] || 0;
}

// --- Recherche -------------------------------------------------------------

// Lettres sans décomposition Unicode (ø n'est pas « o + accent ») : repliées à la main.
const FOLD_LETTERS = { ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/**
 * Texte replié pour comparer sans tenir compte des accents ni de la casse, dans toutes les écritures :
 * « FÊTE » et « fete » donnent la même chose, comme « Røyksopp » et « royksopp ». Sert à la recherche dans ses cartes
 * (fonction SQL fold() du serveur) et dans le catalogue statique de la démo.
 */
export function foldText(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[øæœßłđðþı]/g, (c) => FOLD_LETTERS[c]);
}

// --- Comptes ---------------------------------------------------------------

export const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;
export const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'albummania', 'support', 'moderator', 'modo', 'system', 'root', 'staff']);
export const PASSWORD_MIN = 8;

export function validateUsername(u) {
  if (typeof u !== 'string' || !USERNAME_RE.test(u)) return 'username_format';
  if (/^[._]|[._]$/.test(u) || u.includes('..')) return 'username_format';
  if (RESERVED_USERNAMES.has(u.toLowerCase())) return 'username_reserved';
  return null;
}

export function validateEmail(e) {
  if (typeof e !== 'string' || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return 'email_format';
  return null;
}

export function validatePassword(p) {
  if (typeof p !== 'string' || p.length < PASSWORD_MIN) return 'password_short';
  if (p.length > 200) return 'password_long';
  return null;
}
