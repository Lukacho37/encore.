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
// Booster gratuit : chaque emplacement a cette chance de piocher dans un album que le joueur a commencé
// (sinon, avec 20 000 albums, compléter un album par hasard serait presque impossible).
export const FOCUS_CHANCE = 0.35;
// Booster d'album : poids de tirage par rareté (une carte manquante compte triple).
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

/**
 * Tire le contenu d'un booster gratuit. `rng` renvoie un flottant dans [0, 1).
 * `focusAlbumIds` : albums commencés par le joueur, vers lesquels une partie des emplacements est orientée.
 * Les cartes sont triées de la moins rare à la plus rare : la meilleure arrive en dernier.
 */
export function rollPack(rng, catalog, { focusAlbumIds = [] } = {}) {
  const exclude = new Set();
  const cards = [];
  for (const slot of PACK_SLOTS) {
    const wanted = pickWeighted(slot, rng);
    let track = null;
    if (focusAlbumIds.length && wanted !== 'promo' && rng() < FOCUS_CHANCE) {
      track = catalog.randomTrack({ rarity: wanted, albumIds: focusAlbumIds, exclude }, rng);
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

/**
 * Booster d'album : 5 cartes de l'album choisi, différentes tant que l'album en a assez, tirées en priorité
 * parmi celles que le joueur n'a pas (poids ×3) et pondérées par rareté.
 */
export function rollAlbumPack(rng, catalog, albumId, owned = new Set()) {
  const pool = catalog.albumTracks(albumId);
  if (!pool.length) return [];
  const cards = [];
  const used = new Set();
  for (let i = 0; i < PACK_SIZE; i++) {
    const candidates = pool.length - used.size >= 1 ? pool.filter((t) => !used.has(t.id)) : pool;
    const weights = candidates.map((t) => (ALBUM_PACK_WEIGHTS[t.rarity] || 1) * (owned.has(t.id) ? 1 : 3));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng() * total;
    let pick = candidates[candidates.length - 1];
    for (let k = 0; k < candidates.length; k++) {
      roll -= weights[k];
      if (roll < 0) {
        pick = candidates[k];
        break;
      }
    }
    used.add(pick.id);
    if (used.size >= pool.length) used.clear();
    cards.push({ trackId: pick.id, rarity: pick.rarity, variant: holoRoll(pick.rarity, rng) ? 'holo' : 'std' });
  }
  return cards.sort(byRank);
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

/** Coût pour « presser » (fabriquer) une carte manquante. null si impossible. */
export function pressCost(rarity) {
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
