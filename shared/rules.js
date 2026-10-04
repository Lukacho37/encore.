// Règles du jeu partagées par le serveur, le client et la démo.
// Tous les réglages d'équilibrage sont regroupés ici.
import {
  TRACKS, TRACK_BY_ID, ALBUMS, TRACKS_BY_ALBUM, TRACKS_BY_ARTIST, PROMO_TRACKS, ARTISTS,
  GENRES, DECADES, COUNTRIES, ARTIST_BY_ID, decadeOf,
} from './catalog.js';

export const RARITIES = ['common', 'uncommon', 'rare', 'super', 'ultra', 'legendary', 'promo'];

export const RARITY = {
  common: { rank: 0, pips: 1, color: '#a29cb0', xp: 5, recycle: 5, press: 40 },
  uncommon: { rank: 1, pips: 2, color: '#7fd36b', xp: 10, recycle: 10, press: 80 },
  rare: { rank: 2, pips: 3, color: '#4f9dff', xp: 20, recycle: 25, press: 200 },
  super: { rank: 3, pips: 4, color: '#b17dff', xp: 40, recycle: 50, press: 400 },
  ultra: { rank: 4, pips: 5, color: '#ff8b3d', xp: 80, recycle: 100, press: 800 },
  legendary: { rank: 5, pips: 6, color: '#ffd35a', xp: 150, recycle: 250, press: 1600 },
  // Les promos ne peuvent pas être pressées : on ne les obtient qu'en booster.
  promo: { rank: 6, pips: 0, color: '#ff4f7e', xp: 100, recycle: 150, press: null },
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
export const HOLO_CHANCE_TOP = 0.12; // légendaires et promos

export const ECONOMY = {
  packPrice: 120, // royalties
  duplicateXpRatio: 0.2,
  holoRecycleMultiplier: 2,
  albumRewardPerTrack: 20, // royalties par piste de l'album complété
  albumXpPerTrack: 15,
  artistReward: 500,
  artistXp: 400,
  welcomePacks: 5,
  welcomeRoyalties: 200,
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

const POOLS = {};
for (const r of RARITIES) POOLS[r] = TRACKS.filter((t) => t.rarity === r);

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

/**
 * Tire le contenu d'un booster. `rng` renvoie un flottant dans [0, 1).
 * Les cartes sont triées de la moins rare à la plus rare : la meilleure arrive en dernier.
 */
export function rollPack(rng) {
  const picked = new Set();
  const cards = PACK_SLOTS.map((slot) => {
    const rarity = pickWeighted(slot, rng);
    const pool = POOLS[rarity];
    let track;
    for (let tries = 0; tries < 20; tries++) {
      track = pool[Math.floor(rng() * pool.length)];
      if (!picked.has(track.id)) break;
    }
    picked.add(track.id);
    const top = rarity === 'legendary' || rarity === 'promo';
    const holo = rng() < (top ? HOLO_CHANCE_TOP : HOLO_CHANCE);
    return { trackId: track.id, variant: holo ? 'holo' : 'std' };
  });
  return cards.sort((a, b) => RARITY[TRACK_BY_ID[a.trackId].rarity].rank - RARITY[TRACK_BY_ID[b.trackId].rarity].rank);
}

/** Probabilité d'obtenir au moins une carte de chaque rareté dans un booster. */
export function packOdds() {
  const odds = {};
  for (const r of RARITIES) {
    let none = 1;
    for (const slot of PACK_SLOTS) {
      const total = Object.values(slot).reduce((s, w) => s + w, 0);
      none *= 1 - (slot[r] || 0) / total;
    }
    odds[r] = 1 - none;
  }
  return odds;
}

/** Valeur en royalties d'un doublon. */
export function recycleValue(trackId, variant) {
  const base = RARITY[TRACK_BY_ID[trackId].rarity].recycle;
  return variant === 'holo' ? base * ECONOMY.holoRecycleMultiplier : base;
}

export function xpForCard(trackId, isNew) {
  const base = RARITY[TRACK_BY_ID[trackId].rarity].xp;
  return isNew ? base : Math.round(base * ECONOMY.duplicateXpRatio);
}

/** Coût pour « presser » (fabriquer) une carte manquante. null si impossible. */
export function pressCost(trackId) {
  return RARITY[TRACK_BY_ID[trackId].rarity].press;
}

export function albumReward(albumId) {
  const n = TRACKS_BY_ALBUM[albumId].length;
  return { royalties: n * ECONOMY.albumRewardPerTrack, xp: n * ECONOMY.albumXpPerTrack };
}

/**
 * Détermine les albums et artistes nouvellement complétés.
 * `owned` : Set des trackId possédés (toutes variantes). `already` : Set des clés de succès déjà obtenues.
 */
export function newAchievements(owned, already, touchedTrackIds) {
  const result = [];
  const albums = new Set();
  const artists = new Set();
  for (const id of touchedTrackIds) {
    const t = TRACK_BY_ID[id];
    if (t.albumId) albums.add(t.albumId);
    artists.add(t.artistId);
  }
  for (const albumId of albums) {
    const key = `album:${albumId}`;
    if (already.has(key)) continue;
    if (TRACKS_BY_ALBUM[albumId].every((t) => owned.has(t.id))) {
      result.push({ key, type: 'album', id: albumId, ...albumReward(albumId) });
    }
  }
  for (const artistId of artists) {
    const key = `artist:${artistId}`;
    if (already.has(key)) continue;
    if (TRACKS_BY_ARTIST[artistId].every((t) => owned.has(t.id))) {
      result.push({ key, type: 'artist', id: artistId, royalties: ECONOMY.artistReward, xp: ECONOMY.artistXp });
    }
  }
  return result;
}

function ratio(list, owned) {
  const have = list.reduce((n, t) => n + (owned.has(t.id) ? 1 : 0), 0);
  return { owned: have, total: list.length, pct: list.length ? have / list.length : 0 };
}

/** Statistiques complètes de collection à partir d'un Set de trackId possédés. */
export function collectionStats(owned) {
  const albums = {};
  for (const a of ALBUMS) albums[a.id] = ratio(TRACKS_BY_ALBUM[a.id], owned);
  const artists = {};
  for (const a of ARTISTS) artists[a.id] = ratio(TRACKS_BY_ARTIST[a.id], owned);
  const genres = {};
  for (const g of GENRES) genres[g] = ratio(TRACKS.filter((t) => t.genre === g), owned);
  const decades = {};
  for (const d of DECADES) decades[d] = ratio(TRACKS.filter((t) => decadeOf(t.year) === d), owned);
  const countries = {};
  for (const c of COUNTRIES) countries[c] = ratio(TRACKS.filter((t) => ARTIST_BY_ID[t.artistId].country === c), owned);
  const byRarity = {};
  for (const r of RARITIES) byRarity[r] = ratio(TRACKS.filter((t) => t.rarity === r), owned);
  return {
    total: ratio(TRACKS, owned),
    promos: ratio(PROMO_TRACKS, owned),
    albums, artists, genres, decades, countries, byRarity,
    albumsCompleted: Object.values(albums).filter((x) => x.pct === 1).length,
    artistsMastered: Object.values(artists).filter((x) => x.pct === 1).length,
  };
}

// --- Blind test ------------------------------------------------------------

export function blindtestPool(genre) {
  return genre === 'all' ? TRACKS : TRACKS.filter((t) => t.genre === genre);
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Prépare les questions d'une partie : un morceau à deviner + 3 leurres du même genre. */
export function buildBlindtest(genre, rng) {
  const pool = blindtestPool(genre);
  const answers = shuffle(pool, rng).slice(0, BLINDTEST.rounds);
  return answers.map((answer) => {
    // Leurres tirés au hasard dans le même genre : l'artiste de la bonne réponse ne doit pas se distinguer.
    const decoys = shuffle(pool.filter((t) => t.id !== answer.id && t.title !== answer.title), rng).slice(0, 3);
    return { answer: answer.id, choices: shuffle([answer.id, ...decoys.map((t) => t.id)], rng) };
  });
}

/** Indices révélés progressivement quand aucun extrait audio n'est disponible. */
export function blindtestClues(trackId) {
  const t = TRACK_BY_ID[trackId];
  const artist = ARTIST_BY_ID[t.artistId];
  const words = t.title.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  return [
    { type: 'decade', value: decadeOf(t.year) },
    { type: 'country', value: artist.country },
    { type: 'year', value: t.year },
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

// --- Comptes ---------------------------------------------------------------

export const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;
export const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'encore', 'support', 'moderator', 'modo', 'system', 'root', 'staff']);
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
