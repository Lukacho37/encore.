// Faux serveur pour la démo autonome : reproduit l'API du vrai serveur dans le navigateur.
// Les données restent dans le localStorage du visiteur. Utilisé uniquement par `npm run build:demo`.
// Le catalogue est celui des 20 albums de base (shared/staticCatalog.js), avec la même interface que la base du serveur.
import { ApiError } from '../api.js';
import { storage } from '../storage.js';
import { registerCatalog } from '../catalogStore.js';
import { staticCatalog } from '@shared/staticCatalog.js';
import {
  rollPack, rollAlbumPack, newAchievements, xpForCard, newCardRoyalties, recycleValue, pressCost, levelFromXp,
  ECONOMY, BLINDTEST, SHOWCASE_SLOTS, AVATAR_COLORS, RARITY, RARITIES, packOdds, PACK_SLOTS,
  buildBlindtest, blindtestClues, blindtestPoints, blindtestReward,
  validateEmail, validatePassword, validateUsername,
  ADVANCED_ALBUMS, isHit, levelRewards, showcaseSlots, wishlistMax, parseBoosterTheme, themeFilterOf, THEME_GENRES,
} from '@shared/rules.js';
import { cleanSelection, cosmeticsBetween, cosmeticsForLevel, levelCosmetic } from '@shared/cosmetics.js';
import { dayStart as parisDayStart } from '@shared/periods.js';
import MODULES from './mock/index.js';
import { DEMO_COVERS, coversSnapshot } from './covers.js';

const KEY = 'albummania.demo.v1';
const REGEN_MS = 30 * 60_000;
const MAX_STOCK = 5;
const GAME_TTL = 2 * 86_400_000; // parties de blind test gardées deux jours (le quota est quotidien)
// Comme le vrai serveur (server/config.js, server/services.js) : version des CGU en vigueur, plateformes d'écoute,
// délai avant de renvoyer une demande d'ami refusée.
const TERMS_VERSION = '2026-10-06';
const LISTEN_PLATFORMS = ['deezer', 'spotify', 'apple'];
const FRIEND_COOLDOWN_MS = 7 * 86_400_000;

const fail = (status, code, extra) => {
  throw new ApiError(status, code, { error: code, ...extra });
};
const rand = Math.random;
const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `h${h >>> 0}`;
};
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
/** Identifiant reçu d'une requête : une chaîne courte, sinon rien (comme le vrai serveur). */
const idOf = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);

// ---------- catalogue ----------

// Tout le catalogue de la démo, lu une fois par l'interface du catalogue statique.
const ALL_ALBUMS = staticCatalog.searchAlbums({ limit: 10_000 }).items.map(({ owned: _owned, ...a }) => a);
const ALL_TRACKS = [...ALL_ALBUMS.flatMap((a) => staticCatalog.albumTracks(a.id)), ...staticCatalog.promos({ limit: 10_000 }).items];
const ALL_ARTISTS = [...new Set(ALL_TRACKS.map((t) => t.artistId))].map((id) => staticCatalog.artist(id)).filter(Boolean);
const TRACK = new Map(ALL_TRACKS.map((t) => [t.id, t]));
const ALBUM = new Map(ALL_ALBUMS.map((a) => [a.id, a]));
const ARTIST = new Map(ALL_ARTISTS.map((a) => [a.id, a]));
const trackOf = (id) => (typeof id === 'string' ? TRACK.get(id) : undefined);

// Les pages de la démo s'affichent tout de suite : le catalogue du site connaît déjà toutes les cartes.
registerCatalog({ tracks: ALL_TRACKS, albums: ALL_ALBUMS, artists: ALL_ARTISTS });

/** Données des cartes, albums et artistes cités dans une réponse (champ `catalog`, comme le vrai serveur). */
function refs({ trackIds = [], albumIds = [], artistIds = [] } = {}) {
  const uniq = (list) => [...new Set(list.filter(idOf))];
  return {
    tracks: staticCatalog.tracks(uniq(trackIds).slice(0, 500)),
    albums: uniq(albumIds).slice(0, 300).map((id) => staticCatalog.album(id)).filter(Boolean),
    artists: uniq(artistIds).slice(0, 300).map((id) => staticCatalog.artist(id)).filter(Boolean),
  };
}

/** Album de la photo de profil (« album:<id> »). */
const avatarAlbum = (avatar) => (typeof avatar === 'string' && avatar.startsWith('album:') ? avatar.slice(6) : null);

let db = null;

function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Albums commencés les plus avancés, vers lesquels une partie des boosters est orientée (comme services.focusAlbums) :
 * les 200 albums pas finis les plus récemment enrichis, puis les ADVANCED_ALBUMS plus avancés d'entre eux.
 */
function focusAlbums(cards) {
  const byAlbum = new Map();
  for (const [k, v] of Object.entries(cards)) {
    const t = trackOf(k.split('|')[0]);
    if (!t?.albumId) continue;
    const e = byAlbum.get(t.albumId) || { ids: new Set(), at: 0, total: t.total };
    e.ids.add(t.id);
    e.at = Math.max(e.at, v.at || 0);
    byAlbum.set(t.albumId, e);
  }
  return [...byAlbum.entries()].filter(([, e]) => e.ids.size < e.total)
    .sort((a, b) => b[1].at - a[1].at).slice(0, 200)
    .sort((a, b) => b[1].ids.size / b[1].total - a[1].ids.size / a[1].total || b[1].ids.size - a[1].ids.size)
    .slice(0, ADVANCED_ALBUMS)
    .map(([id]) => id);
}

function fresh() {
  const now = Date.now();
  // boosters : boosters spéciaux (user_boosters) ; wishlists : albums recherchés par joueur ; cosmeticGrants :
  // cosmétiques accordés hors niveau (user_cosmetics : badges, coffrets, événements).
  const data = {
    nextId: 1, users: [], cards: {}, achievements: {}, friendships: [], tokens: [], games: {}, ratings: [], session: null,
    boosters: [], wishlists: {}, cosmeticGrants: {},
  };
  // Quelques joueurs fictifs pour tester les amis.
  const bots = [
    { username: 'lea.beats', packs: 60, color: '#3fd6c4' },
    { username: 'maxvinyl', packs: 140, color: '#ffd35a' },
    { username: 'soulcollector', packs: 30, color: '#b17dff' },
    { username: 'k.dot_fan', packs: 90, color: '#ff8b3d' },
  ];
  for (const [i, b] of bots.entries()) {
    const id = data.nextId++;
    const user = {
      id, email: `${b.username}@demo.albummania`, username: b.username, password: hash('demo-bot'), verified: now - 86_400_000 * (30 + i * 9),
      role: 'player', lang: 'fr', avatar: 'initials', avatarColor: b.color, royalties: 500, xp: 0, packs: 0, packsAt: now, bonusPacks: 0,
      showcase: [], createdAt: now - 86_400_000 * (30 + i * 9), openings: b.packs, bot: true, pity: 0, cosmetics: {},
      prefs: {}, onboardedAt: now - 86_400_000 * (30 + i * 9), termsAcceptedAt: now - 86_400_000 * (30 + i * 9), termsVersion: TERMS_VERSION,
    };
    data.users.push(user);
    const rng = seededRng(1234 + i * 77);
    const cards = (data.cards[id] = {});
    for (let p = 0; p < b.packs; p++) {
      // Même tirage que pour un vrai joueur : une partie des emplacements vise les albums commencés.
      for (const c of rollPack(rng, staticCatalog, { focusAlbumIds: focusAlbums(cards) })) {
        const k = `${c.trackId}|${c.variant}`;
        const isNew = !cards[`${c.trackId}|std`] && !cards[`${c.trackId}|holo`];
        cards[k] = { count: (cards[k]?.count || 0) + 1, at: cards[k]?.at || now - (b.packs - p) * 3_600_000 };
        user.xp += xpForCard(c.rarity, isNew);
      }
    }
    const owned = new Set(Object.keys(cards).map((k) => k.split('|')[0]));
    data.achievements[id] = {};
    const done = newAchievements({ owned, already: new Set(), touched: [...owned].map(trackOf), catalog: staticCatalog });
    for (const a of done) {
      data.achievements[id][a.key] = now - 86_400_000 * (done.length - done.indexOf(a));
      user.xp += a.xp;
    }
    // Vitrine : les cartes les plus rares (promos au rang des légendaires, pour varier), puis les plus populaires.
    const rank = (id) => RARITY[trackOf(id).rarity === 'promo' ? 'legendary' : trackOf(id).rarity].rank * 1000 + trackOf(id).pop;
    const best = [...owned].sort((x, y) => rank(y) - rank(x)).slice(0, 4);
    user.showcase = [...best, null, null];
    const firstDone = Object.keys(data.achievements[id]).find((k) => k.startsWith('album:'));
    if (firstDone) user.avatar = firstDone;
  }
  // Notes et critiques des joueurs fictifs, pour que les pages d'albums ne soient pas vides.
  const byName = (n) => data.users.find((u) => u.username === n).id;
  const seed = [
    ['maxvinyl', 'album', 'discovery', 10, 'Le disque qui m’a fait aimer l’électro. Digital Love, c’est le soleil en musique.'],
    ['maxvinyl', 'album', 'abbey-road', 9, 'La face B s’enchaîne sans un temps mort, du début à la fin.'],
    ['maxvinyl', 'album', 'thriller', 8, null],
    ['maxvinyl', 'track', 'thriller:06', 10, null],
    ['lea.beats', 'album', 'racine-carree', 9, 'Des textes qui piquent sur des rythmes qui font danser. Formidable reste mon préféré.'],
    ['lea.beats', 'album', 'back-to-black', 10, 'Une voix incroyable, chaque morceau raconte une histoire.'],
    ['lea.beats', 'album', '21', 7, null],
    ['lea.beats', 'album', 'discovery', 8, null],
    ['lea.beats', 'track', 'when-we-all-fall-asleep:02', 8, null],
    ['soulcollector', 'album', 'kind-of-blue', 10, 'À écouter tard le soir. Blue in Green me donne des frissons à chaque fois.'],
    ['soulcollector', 'album', 'exodus', 8, null],
    ['soulcollector', 'album', 'back-to-black', 9, 'Rehab tourne en boucle chez moi depuis des années.'],
    ['k.dot_fan', 'album', 'good-kid-maad-city', 10, 'Un vrai film en album. Le passage de Sherane à Compton est parfait.'],
    ['k.dot_fan', 'album', 'the-college-dropout', 9, 'Jesus Walks, rien à ajouter.'],
    ['k.dot_fan', 'album', 'the-marshall-mathers-lp', 8, null],
    ['k.dot_fan', 'album', 'graduation', 8, 'Flashing Lights a très bien vieilli.'],
    ['k.dot_fan', 'track', 'discovery:04', 9, null],
  ];
  seed.forEach(([name, type, itemId, score, review], i) => {
    if (!itemExists(type, itemId)) return;
    const at = now - (i + 1) * 5_400_000;
    data.ratings.push({ userId: byName(name), type, id: itemId, score, review, createdAt: at, updatedAt: at });
  });
  return data;
}

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x, fallback) => (Number.isFinite(x) ? x : fallback);

/** Répare une sauvegarde d'une version précédente de la démo ; null si elle est inutilisable. */
function sanitize(d) {
  if (!isObj(d) || !Array.isArray(d.users)) return null;
  const now = Date.now();
  for (const k of ['friendships', 'tokens', 'ratings', 'boosters']) if (!Array.isArray(d[k])) d[k] = [];
  for (const k of ['cards', 'achievements', 'games', 'wishlists', 'cosmeticGrants']) if (!isObj(d[k])) d[k] = {};
  d.users = d.users.filter((u) => isObj(u) && Number.isInteger(u.id) && typeof u.username === 'string' && u.username);
  if (!d.users.length) return null;
  for (const u of d.users) {
    u.xp = num(u.xp, 0);
    // Vitrine : 6 cartes, +1 aux niveaux 10 et 30 (PLAN.md 6.6).
    u.showcase = Array.from({ length: showcaseSlots(levelFromXp(u.xp).level) }, (_, i) => (Array.isArray(u.showcase) && trackOf(u.showcase[i]) ? u.showcase[i] : null));
    if (typeof u.avatar !== 'string' || (u.avatar !== 'initials' && !ALBUM.has(avatarAlbum(u.avatar)))) u.avatar = 'initials';
    if (u.avatarColor !== 'auto' && !AVATAR_COLORS.includes(u.avatarColor)) u.avatarColor = 'auto';
    if (u.lang !== 'fr' && u.lang !== 'en') u.lang = 'fr';
    if (u.role !== 'admin') u.role = 'player';
    if (u.ratingScale !== 'stars' && u.ratingScale !== 'points') delete u.ratingScale;
    u.royalties = num(u.royalties, 0);
    u.packs = num(u.packs, 0);
    u.bonusPacks = num(u.bonusPacks, 0);
    u.packsAt = num(u.packsAt, now);
    u.createdAt = num(u.createdAt, now);
    u.openings = num(u.openings, 0);
    // Jeu de collection (P1-D) : compteur de pitié, cosmétiques choisis.
    u.pity = Math.max(0, Math.floor(num(u.pity, 0)));
    if (!isObj(u.cosmetics)) u.cosmetics = {};
    // Champs ajoutés en P0 (préférences, parcours d'accueil, CGU) : une ancienne sauvegarde a déjà fait son accueil
    // (comme l'étape v8 du serveur) et ses joueurs avaient accepté les CGU de l'époque.
    if (!isObj(u.prefs)) u.prefs = {};
    if (!LISTEN_PLATFORMS.includes(u.prefs.listen)) delete u.prefs.listen;
    if (u.onboardedAt === undefined) u.onboardedAt = u.createdAt;
    u.onboardedAt = u.onboardedAt === null ? null : num(u.onboardedAt, u.createdAt);
    if (u.termsVersion === undefined) {
      u.termsVersion = TERMS_VERSION;
      u.termsAcceptedAt = u.createdAt;
    }
  }
  const ids = new Set(d.users.map((u) => u.id));
  for (const key of Object.keys(d.cards)) {
    const cards = d.cards[key];
    if (!ids.has(Number(key)) || !isObj(cards)) {
      delete d.cards[key];
      continue;
    }
    for (const k of Object.keys(cards)) {
      const [t, v] = k.split('|');
      if (!trackOf(t) || (v !== 'std' && v !== 'holo') || !isObj(cards[k]) || !(cards[k].count > 0)) delete cards[k];
      else cards[k].at = num(cards[k].at, now);
    }
  }
  for (const key of Object.keys(d.achievements)) {
    const list = d.achievements[key];
    if (!ids.has(Number(key)) || !isObj(list)) {
      delete d.achievements[key];
      continue;
    }
    for (const k of Object.keys(list)) {
      const [type, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      // deluxe:<albumId> : édition deluxe d'un album (P2-D, mock/workshop.js).
      if (!(((type === 'album' || type === 'deluxe') && ALBUM.has(id)) || (type === 'artist' && ARTIST.has(id)))) delete list[k];
      else list[k] = num(list[k], now);
    }
  }
  for (const [id, g] of Object.entries(d.games)) {
    if (!isObj(g) || !Array.isArray(g.questions) || !(now - num(g.createdAt, 0) < GAME_TTL)) delete d.games[id];
  }
  d.ratings = d.ratings.filter((r) => isObj(r) && ids.has(r.userId) && Number.isInteger(r.score) && r.score >= 0 && r.score <= 10
    && itemExists(r.type, r.id));
  d.friendships = d.friendships.filter((f) => isObj(f) && ids.has(f.requester) && ids.has(f.addressee)
    && ['pending', 'accepted', 'declined'].includes(f.status));
  // Boosters spéciaux au thème connu, albums recherchés encore au catalogue, cosmétiques accordés bien formés.
  d.boosters = d.boosters.filter((b) => isObj(b) && Number.isInteger(b.id) && ids.has(b.userId) && parseBoosterTheme(b.theme)
    && (b.kind === 'theme' || b.kind === 'album'));
  for (const key of Object.keys(d.wishlists)) {
    if (!ids.has(Number(key)) || !Array.isArray(d.wishlists[key])) delete d.wishlists[key];
    else d.wishlists[key] = [...new Set(d.wishlists[key].filter((id) => ALBUM.has(id)))];
  }
  for (const key of Object.keys(d.cosmeticGrants)) {
    if (!ids.has(Number(key)) || !Array.isArray(d.cosmeticGrants[key])) delete d.cosmeticGrants[key];
    else d.cosmeticGrants[key] = d.cosmeticGrants[key].filter((c) => isObj(c) && typeof c.id === 'string');
  }
  d.nextId = Math.max(num(d.nextId, 1), ...d.users.map((u) => u.id + 1));
  if (!ids.has(d.session)) d.session = null;
  return d;
}

function load() {
  if (db) return;
  try {
    db = sanitize(JSON.parse(storage.get(KEY) || 'null'));
  } catch {
    db = null;
  }
  if (db) {
    // Sauvegarde existante : chaque module complète ses données (idempotent).
    for (const mod of MODULES) mod.migrate?.(db, ctx);
  } else {
    db = fresh();
    // Base neuve : chaque module sème ses contenus d'exemple (bots, posts…).
    for (const mod of MODULES) mod.seed?.(db, ctx);
  }
}

function save() {
  storage.set(KEY, JSON.stringify(db));
}

// ---------- utilitaires ----------

const userById = (id) => db.users.find((u) => u.id === id);
const userByName = (name) => db.users.find((u) => u.username.toLowerCase() === String(name || '').trim().toLowerCase());
const cardsOf = (id) => (db.cards[id] ||= {});
const achOf = (id) => (db.achievements[id] ||= {});
const ownedSet = (id) => new Set(Object.keys(cardsOf(id)).map((k) => k.split('|')[0]));
const holoSet = (id) => new Set(Object.keys(cardsOf(id)).filter((k) => k.endsWith('|holo')).map((k) => k.split('|')[0]));
const isAdmin = (u) => u?.role === 'admin';

function me() {
  const u = db.session && userById(db.session);
  if (!u) fail(401, 'unauthenticated');
  return u;
}

function syncPacks(u) {
  const now = Date.now();
  if (u.packs >= MAX_STOCK) u.packsAt = now;
  else {
    const gained = Math.floor((now - u.packsAt) / REGEN_MS);
    if (gained > 0) {
      u.packs = Math.min(MAX_STOCK, u.packs + gained);
      u.packsAt = u.packs >= MAX_STOCK ? now : u.packsAt + gained * REGEN_MS;
    }
  }
}

function botsRespond(u) {
  // Les joueurs fictifs acceptent les demandes d'ami au bout de quelques secondes.
  for (const f of db.friendships) {
    if (f.status === 'pending' && f.requester === u.id && userById(f.addressee)?.bot && Date.now() - f.createdAt > 4000) {
      f.status = 'accepted';
      f.respondedAt = Date.now();
    }
  }
}

/**
 * « Pressage n° » d'un album complété : rang du joueur parmi ceux qui l'ont complété (date, puis identifiant),
 * comme achievements.rank côté serveur ; null pour un artiste maîtrisé.
 */
function rankOf(uid, key) {
  if (!key.startsWith('album:')) return null;
  const at = achOf(uid)[key];
  if (at === undefined) return null;
  let rank = 1;
  for (const [other, list] of Object.entries(db.achievements)) {
    const t = list?.[key];
    if (Number(other) !== uid && t !== undefined && (t < at || (t === at && Number(other) < uid))) rank += 1;
  }
  return rank;
}

// ---------- jeu de collection (P1-D : PLAN.md 6.2 à 6.6, 6.10 ; même calcul que server/services.js) ----------

const levelOf = (u) => levelFromXp(u.xp).level;

/** Cosmétiques débloqués (identifiants complets) : ceux du niveau, puis ceux accordés (badges, coffrets…). */
function unlockedCosmetics(uid) {
  const u = userById(uid);
  if (!u) return [];
  const out = cosmeticsForLevel(levelOf(u));
  const seen = new Set(out.map((c) => c.id));
  for (const c of db.cosmeticGrants[uid] || []) if (!seen.has(c.id)) out.push({ id: c.id, source: c.source });
  return out;
}

/** Sélection de cosmétiques affichée : seulement ce qui est débloqué. */
const cosmeticsOf = (u) => cleanSelection(u.cosmetics || {}, unlockedCosmetics(u.id).map((c) => c.id));

/** Cadre ou titre d'un résumé de joueur : null si le cosmétique de niveau n'est plus débloqué. */
function shownCosmetic(kind, key, level) {
  if (typeof key !== 'string' || !key) return null;
  const def = levelCosmetic(`${kind}:${key}`);
  return def && def.level > level ? null : key;
}

/** Albums recherchés du joueur (liste d'envies), dans l'ordre d'ajout. */
const wishlistOf = (uid) => (db.wishlists[uid] ||= []);

/** Ajoute un booster spécial à l'inventaire (user_boosters) ; renvoie son identifiant. */
function insertBooster(uid, kind, theme, source) {
  const id = db.nextId++;
  db.boosters.push({ id, userId: uid, kind, theme: String(theme).slice(0, 100), source: String(source || 'game').slice(0, 80), createdAt: Date.now(), openedAt: null });
  return id;
}

/**
 * Ajoute de l'XP et applique les récompenses de niveau (PLAN.md 6.6) : un booster bonus par niveau gagné, un booster
 * spécial « À ton goût » tous les 10 niveaux. Renvoie `levelUp` ({ from, to, boosters, themed, cosmetics, wishlist,
 * showcase }) ou null, comme services.gainXp.
 */
function gainXp(u, xp) {
  const amount = Math.floor(Number(xp) || 0);
  if (amount <= 0) return null;
  const from = levelOf(u);
  u.xp += amount;
  const to = levelOf(u);
  if (to <= from) return null;
  const rewards = levelRewards(from, to);
  u.bonusPacks += rewards.boosters;
  for (const l of rewards.themed) insertBooster(u.id, 'theme', 'taste', `level:${l}`);
  return {
    from, to, boosters: rewards.boosters, themed: rewards.themed.length, cosmetics: cosmeticsBetween(from, to),
    wishlist: rewards.wishlist, showcase: rewards.showcase,
  };
}

/** Liste d'envies pour le tirage : albums recherchés pas encore complets et cartes déjà possédées parmi les leurs. */
function wishlistFocus(uid) {
  const owned = ownedSet(uid);
  const albumIds = wishlistOf(uid).filter((id) => staticCatalog.albumTrackIds(id).some((t) => !owned.has(t)));
  return { albumIds, owned };
}

/** Artistes du joueur qui ont des promos : cartes possédées ou albums recherchés. */
function promoArtistsOf(uid, wishlistIds = []) {
  const withPromos = new Set(staticCatalog.promoArtists());
  const mine = new Set();
  for (const id of ownedSet(uid)) {
    const artistId = trackOf(id)?.artistId;
    if (withPromos.has(artistId)) mine.add(artistId);
  }
  for (const id of wishlistIds) {
    const artistId = ALBUM.get(id)?.artistId;
    if (withPromos.has(artistId)) mine.add(artistId);
  }
  return [...mine];
}

/** Ciblage complet d'un booster du joueur (rollPack) : liste d'envies, albums avancés, promos de ses artistes. */
function packFocus(uid) {
  const wishlist = wishlistFocus(uid);
  return { wishlist, focusAlbumIds: focusAlbums(cardsOf(uid)), promoArtistIds: () => promoArtistsOf(uid, wishlist.albumIds) };
}

/** Boosters tirés l'un après l'autre : la pitié de chacun dépend des précédents. */
function rollSeries(count, pity, options) {
  const packs = [];
  let n = pity;
  for (let i = 0; i < count; i++) {
    const pack = rollPack(rand, staticCatalog, { ...options, pity: n });
    packs.push(pack);
    n = pack.some((c) => isHit(c.rarity)) ? 0 : n + 1;
  }
  return { packs, pity: n };
}

/** Une carte ultra ou mieux d'un booster d'album remet la pitié à zéro (sans compter le booster). */
function resetPityOnHit(u, cards) {
  if (cards.some((c) => isHit(c.rarity))) u.pity = 0;
  return u.pity || 0;
}

/** Promos pressables : un album de l'artiste complété (PLAN.md 6.4). */
const promoUnlocked = (uid, artistId) => Object.keys(achOf(uid)).some((k) => k.startsWith('album:') && ALBUM.get(k.slice(6))?.artistId === artistId);

/** Ce que coûte le pressage d'une carte pour ce joueur (GET /me/press/:trackId), comme services.pressInfo. */
function pressInfo(u, trackId) {
  const track = trackOf(idOf(trackId));
  if (!track) fail(404, 'unknown_track');
  const base = pressCost(track.rarity, { promoUnlocked: track.rarity === 'promo' && promoUnlocked(u.id, track.artistId) });
  const owned = ownedSet(u.id).has(track.id);
  return {
    trackId: track.id, cost: isAdmin(u) ? 0 : base, pressable: !owned && (base != null || isAdmin(u)),
    reason: owned ? 'owned' : base == null ? 'promo_locked' : null, artistId: track.artistId,
  };
}

/** Genres d'un booster « À ton goût » : ceux où le joueur a le plus de cartes (au plus 3). */
function tasteGenres(uid) {
  const count = new Map();
  for (const id of ownedSet(uid)) {
    const g = trackOf(id)?.genre;
    if (g && THEME_GENRES.includes(g)) count.set(g, (count.get(g) || 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);
}

/**
 * Ouvre un booster spécial de l'inventaire (PLAN.md 6.10), comme services.openSpecialPack : thématique (chances du
 * booster standard, pitié comprise, réservoir filtré par le thème) ou d'album (5 cartes de l'album, manquantes
 * d'abord ; `albumId` pour « album:choice »).
 */
function openSpecialPack(u, boosterId, { albumId } = {}) {
  const row = db.boosters.find((b) => b.id === Number(boosterId) && b.userId === u.id);
  if (!row) fail(404, 'booster_not_found');
  if (row.openedAt) fail(409, 'booster_opened');
  const parsed = parseBoosterTheme(row.theme);
  let cards;
  let target = null;
  if (parsed?.kind === 'album' || parsed?.kind === 'choice') {
    target = parsed.kind === 'album' ? parsed.value : idOf(albumId);
    if (!target) fail(400, 'album_required');
    if (!ALBUM.has(target)) fail(404, 'unknown_album');
    cards = rollAlbumPack(rand, staticCatalog, target, ownedSet(u.id));
    resetPityOnHit(u, cards);
  } else {
    // Thème inconnu (événement retiré…) : booster standard, sans ciblage.
    const theme = themeFilterOf(parsed, { tasteGenres: parsed?.kind === 'taste' ? tasteGenres(u.id) : [] });
    const series = rollSeries(1, u.pity || 0, { theme });
    cards = series.packs[0];
    u.pity = series.pity;
  }
  row.openedAt = Date.now();
  const result = addCards(u, cards, 'special');
  return { booster: { id: row.id, kind: row.kind, theme: row.theme }, albumId: target, packs: [cards.length], ...result, pity: u.pity || 0 };
}

/**
 * Démo seulement : boosters spéciaux offerts à l'activation du compte (un thématique, une décennie, un album au
 * choix), une fois par joueur. Sur le vrai site, ils viennent de l'accueil, des quêtes, des paliers et des événements.
 */
function demoGift(u) {
  if (u.bot || u.demoGift) return;
  u.demoGift = true;
  for (const theme of ['genre:rap', 'decade:1970', 'album:choice']) insertBooster(u.id, theme.startsWith('album:') ? 'album' : 'theme', theme, 'demo');
}

/** Préférences du joueur avec leurs valeurs par défaut (comme prefsOf côté serveur). */
const prefsOf = (u) => ({
  listen: LISTEN_PLATFORMS.includes(u.prefs?.listen) ? u.prefs.listen : 'deezer',
  emailDigest: u.prefs?.emailDigest === true,
});

/** Partie « joueur » de l'état (state.user), commune à l'état complet et à l'état partiel. */
function selfPayload(u) {
  return {
    id: u.id, username: u.username, email: u.email, role: u.role, lang: u.lang, avatar: u.avatar, avatarColor: u.avatarColor,
    royalties: u.royalties, level: levelFromXp(u.xp), showcase: u.showcase, createdAt: u.createdAt, ratingScale: u.ratingScale || 'stars',
    // Jeu de collection (PLAN.md 6.4 à 6.6) : places selon le niveau, compteur de pitié, cosmétiques choisis.
    slots: { wishlist: wishlistMax(levelOf(u)), showcase: showcaseSlots(levelOf(u)) },
    pity: u.pity || 0,
    cosmetics: cosmeticsOf(u),
    prefs: prefsOf(u),
    onboarded: u.onboardedAt != null,
    termsOk: !!u.termsAcceptedAt && u.termsVersion === TERMS_VERSION,
    termsVersion: u.termsVersion || null,
  };
}

function packInfo(u) {
  return {
    regen: u.packs, bonus: u.bonusPacks, available: u.packs + u.bonusPacks, max: MAX_STOCK, intervalMs: REGEN_MS,
    nextAt: u.packs < MAX_STOCK ? u.packsAt + REGEN_MS : null, unlimited: isAdmin(u),
  };
}

/**
 * Pastilles du joueur : demandes d'ami reçues, notifications non lues. Un module de la démo peut en fournir
 * (`export function counts(db, ctx, userId) { return { unread: 3 } }`, ex. mock/notifications.js) : seules les
 * valeurs numériques sont gardées.
 */
function countsFor(uid) {
  const counts = { pendingFriends: db.friendships.filter((f) => f.addressee === uid && f.status === 'pending').length, unread: 0 };
  for (const mod of MODULES) {
    try {
      for (const [k, v] of Object.entries(mod.counts?.(db, ctx, uid) || {})) if (Number.isFinite(v)) counts[k] = v;
    } catch (err) {
      console.error('[démo] pastilles d’un module en erreur :', err);
    }
  }
  return counts;
}

/** État complet du joueur connecté, comme le vrai serveur (statistiques calculées ici, cartes avec leur rareté). */
function state() {
  const u = me();
  syncPacks(u);
  botsRespond(u);
  const counts = countsFor(u.id);
  return {
    user: selfPayload(u),
    packs: packInfo(u),
    // r : rareté (les sauvegardes des anciennes versions de la démo ne la stockaient pas : on la lit dans le catalogue).
    cards: Object.entries(cardsOf(u.id)).map(([k, v]) => {
      const [t, variant] = k.split('|');
      return { t, v: variant, c: v.count, at: v.at, r: trackOf(t)?.rarity || 'common' };
    }),
    achievements: Object.entries(achOf(u.id)).map(([key, at]) => ({ key, at, rank: rankOf(u.id, key) })),
    ratings: db.ratings.filter((r) => r.userId === u.id).map((r) => ({ t: r.type, i: r.id, s: r.score })),
    counts,
    // Ancien nom de counts.pendingFriends, gardé pendant P0.
    pendingFriends: counts.pendingFriends,
    stats: staticCatalog.stats(ownedSet(u.id), Object.keys(achOf(u.id))),
    catalog: refs({ trackIds: u.showcase.filter(Boolean), albumIds: [avatarAlbum(u.avatar)].filter(Boolean) }),
    serverTime: Date.now(),
    partial: false,
  };
}

/**
 * État partiel renvoyé par les actions (PLAN.md 4.1.1), comme le vrai serveur : joueur, boosters, pastilles et
 * résumé des statistiques ; le site déduit le reste des deltas de la réponse (client/src/state/mergeState.js).
 */
function partialState() {
  const u = me();
  syncPacks(u);
  botsRespond(u);
  const s = staticCatalog.stats(ownedSet(u.id), Object.keys(achOf(u.id)));
  return {
    partial: true,
    user: selfPayload(u),
    packs: packInfo(u),
    counts: countsFor(u.id),
    stats: { summary: { total: s.total, albumsCompleted: s.albumsCompleted, artistsMastered: s.artistsMastered, catalog: s.catalog } },
    serverTime: Date.now(),
  };
}

/** Cartes possédées de ces albums : { albumId: nombre }. */
function albumCounts(owned, albumIds) {
  return new Map(albumIds.map((id) => [id, staticCatalog.albumTrackIds(id).filter((t) => owned.has(t)).length]));
}

/** Cartes possédées de ces artistes : { artistId: nombre }. */
function artistCounts(owned, artistIds) {
  return new Map(artistIds.map((id) => [id, staticCatalog.artistTrackIds(id).filter((t) => owned.has(t)).length]));
}

/**
 * Ajoute des cartes à la collection, attribue XP, royalties, succès et récompenses (même calcul que le serveur).
 * `source` : 'pack', 'admin-pack', 'album-pack', 'special' ou 'press' (une carte pressée ne rapporte pas de
 * royalties). Renvoie les deltas de la réponse, comme services.addCards : cards, at, xp, royalties, achievements
 * (album complété : rang « Pressage n° », date et première carte de l'album, PLAN.md 6.2), albumDeltas,
 * artistDeltas, levelUp (paliers de niveau, PLAN.md 6.6), catalog. Chaque carte garde sa rareté au moment du tirage
 * (`r`, comme cards.pulled_rarity).
 */
function addCards(u, cards, source) {
  const now = Date.now();
  const mine = cardsOf(u.id);
  const list = cards.filter((c) => trackOf(c.trackId));
  const ids = [...new Set(list.map((c) => c.trackId))];
  const views = ids.map(trackOf);
  const albumIds = [...new Set(views.map((t) => t.albumId).filter(Boolean))];
  const artistIds = [...new Set(views.map((t) => t.artistId).filter(Boolean))];
  const before = ownedSet(u.id);
  const beforeCounts = albumCounts(before, albumIds);
  const beforeArtists = artistCounts(before, artistIds);
  const owned = new Set(before);
  let xp = 0;
  let cardRoyalties = 0;
  const results = list.map(({ trackId, variant }) => {
    const rarity = trackOf(trackId).rarity;
    const k = `${trackId}|${variant}`;
    const newTrack = !owned.has(trackId);
    const newVariant = !mine[k];
    mine[k] = { count: (mine[k]?.count || 0) + 1, at: mine[k]?.at || now, r: mine[k]?.r || rarity };
    owned.add(trackId);
    xp += xpForCard(rarity, newTrack);
    if (newTrack && source !== 'press') cardRoyalties += newCardRoyalties(rarity);
    return { trackId, variant, rarity, newTrack, newVariant };
  });
  const ach = achOf(u.id);
  const achievements = newAchievements({ owned, already: new Set(Object.keys(ach)), touched: views, catalog: staticCatalog });
  let royalties = cardRoyalties;
  for (const a of achievements) {
    ach[a.key] = now;
    royalties += a.royalties;
    xp += a.xp;
  }
  for (const a of achievements) {
    if (a.type !== 'album') continue;
    a.rank = rankOf(u.id, a.key);
    a.at = now;
    // Première carte de l'album (« 6 jours après ta première carte »).
    a.firstCardAt = Math.min(now, ...staticCatalog.albumTrackIds(a.id).flatMap((t) => [mine[`${t}|std`]?.at, mine[`${t}|holo`]?.at]).filter(Number.isFinite));
  }
  const levelUp = gainXp(u, xp);
  u.royalties += royalties;
  u.openings = (u.openings || 0) + 1;
  const afterCounts = albumCounts(owned, albumIds);
  const albumDeltas = albumIds.map((albumId) => ({
    albumId,
    before: beforeCounts.get(albumId) || 0,
    after: afterCounts.get(albumId) || 0,
    total: views.find((t) => t.albumId === albumId).total,
  })).filter((d) => d.after > d.before);
  const afterArtists = artistCounts(owned, artistIds);
  const artistDeltas = artistIds.map((artistId) => ({
    artistId,
    before: beforeArtists.get(artistId) || 0,
    after: afterArtists.get(artistId) || 0,
    total: staticCatalog.artistTrackIds(artistId).length,
  })).filter((d) => d.after > d.before);
  return {
    cards: results,
    // Date des nouvelles cartes et des succès, pour la fusion du site.
    at: now,
    xp,
    royalties,
    cardRoyalties,
    achievements,
    albumDeltas,
    artistDeltas,
    levelUp,
    catalog: refs({ trackIds: ids, albumIds, artistIds: achievements.filter((a) => a.type === 'artist').map((a) => a.id) }),
  };
}

/** Joueur d'une liste d'amis : UserSummary, plus `unique` et `total` (noms d'avant, gardés pour les pages existantes). */
function summary(u) {
  const s = summaries([u.id]).get(u.id);
  return { ...s, unique: s.uniqueCards, total: ALL_TRACKS.length };
}

function between(a, b) {
  return db.friendships.find((f) => (f.requester === a && f.addressee === b) || (f.requester === b && f.addressee === a));
}

/**
 * Résumés de joueurs (UserSummary, PLAN.md 4.0) par identifiant : Map id → { id, username, avatar, avatarColor,
 * level, uniqueCards, frame, title, relation }, `relation` vu du joueur connecté ('self', 'friend', 'incoming',
 * 'outgoing' ou null). Les identifiants inconnus sont ignorés.
 */
function summaries(ids) {
  const viewer = db.session;
  const out = new Map();
  for (const id of new Set(ids)) {
    const u = userById(id);
    if (!u) continue;
    let relation = null;
    if (id === viewer) relation = 'self';
    else if (viewer) {
      const f = between(viewer, id);
      if (f?.status === 'accepted') relation = 'friend';
      else if (f?.status === 'pending') relation = f.requester === viewer ? 'outgoing' : 'incoming';
    }
    // Cadre et titre choisis (PLAN.md 6.6) ; un cosmétique de niveau au-dessus du niveau actuel ne s'affiche plus.
    const level = levelOf(u);
    out.set(id, {
      id, username: u.username, avatar: u.avatar, avatarColor: u.avatarColor, level,
      uniqueCards: ownedSet(id).size, frame: shownCosmetic('frame', u.cosmetics?.frame, level),
      title: shownCosmetic('title', u.cosmetics?.title, level), relation,
    });
  }
  return out;
}

function friendsOf(uid) {
  const out = { friends: [], incoming: [], outgoing: [] };
  for (const f of [...db.friendships].sort((a, b) => b.createdAt - a.createdAt)) {
    // Une demande refusée reste 7 jours (délai avant de pouvoir la renvoyer) sans apparaître nulle part.
    if ((f.requester !== uid && f.addressee !== uid) || f.status === 'declined') continue;
    const other = userById(f.requester === uid ? f.addressee : f.requester);
    const entry = { requestId: f.id, since: f.respondedAt || f.createdAt, user: summary(other) };
    if (f.status === 'accepted') out.friends.push(entry);
    else if (f.addressee === uid) out.incoming.push(entry);
    else out.outgoing.push(entry);
  }
  const albumIds = [...out.friends, ...out.incoming, ...out.outgoing].map((e) => avatarAlbum(e.user.avatar)).filter(Boolean);
  return { ...out, catalog: refs({ albumIds }) };
}

/** Profil public d'un joueur : statistiques, vitrine, vinyles, prochains vinyles (même forme que le serveur, sans `role`). */
function publicProfile(viewer, target) {
  const owned = ownedSet(target.id);
  const holo = holoSet(target.id);
  const stats = staticCatalog.stats(owned, Object.keys(achOf(target.id)));
  let friendship = 'none';
  let requestId = null;
  if (target.id === viewer.id) friendship = 'self';
  else {
    const f = between(viewer.id, target.id);
    if (f && f.status !== 'declined') {
      requestId = f.id;
      friendship = f.status === 'accepted' ? 'friends' : f.requester === viewer.id ? 'outgoing' : 'incoming';
    }
  }
  const entries = Object.entries(achOf(target.id));
  const cosmetics = cosmeticsOf(target);
  // Vinyles : les 120 albums complétés les plus récents, du plus ancien au plus récent ; holo si toutes les cartes le sont.
  // Couleur de vinyle choisie (cosmétique) sur chaque disque noir, comme le serveur.
  const vinyls = entries.filter(([k]) => k.startsWith('album:') && ALBUM.has(k.slice(6)))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 120).reverse()
    .map(([k, at]) => {
      const albumId = k.slice(6);
      const edition = staticCatalog.albumTrackIds(albumId).every((id) => holo.has(id)) ? 'holo' : 'black';
      return { albumId, at, rank: rankOf(target.id, k), edition, color: edition === 'black' ? cosmetics.vinyl : null };
    });
  const mastered = entries.filter(([k]) => k.startsWith('artist:')).sort((a, b) => b[1] - a[1]).slice(0, 100).map(([k]) => k.slice(7));
  // Prochains vinyles : les albums commencés les plus avancés.
  const upcoming = Object.entries(stats.albums).filter(([, p]) => p.pct < 1)
    .sort((a, b) => b[1].pct - a[1].pct || b[1].owned - a[1].owned).slice(0, 3)
    .map(([albumId, progress]) => ({ albumId, progress }));
  const slotIds = target.showcase.map(idOf);
  return {
    id: target.id, username: target.username, avatar: target.avatar, avatarColor: target.avatarColor, level: levelFromXp(target.xp),
    createdAt: target.createdAt,
    stats: {
      unique: stats.total.owned, total: stats.total.total,
      albumsCompleted: stats.albumsCompleted, albumsTotal: stats.catalog.albums,
      artistsMastered: stats.artistsMastered, artistsTotal: stats.catalog.artists,
      promos: stats.promos.owned, promosTotal: stats.promos.total,
    },
    showcase: slotIds.map((id) => (id && owned.has(id) ? { trackId: id, variant: holo.has(id) ? 'holo' : 'std' } : null)),
    // Cosmétiques choisis (cadre, couleur de vinyle, thème, titre : PLAN.md 6.6).
    cosmetics,
    completedAlbums: vinyls.map((v) => v.albumId),
    vinyls,
    masteredArtists: mastered,
    upcoming,
    friendship,
    requestId,
    catalog: refs({
      trackIds: slotIds.filter(Boolean),
      albumIds: [...vinyls.map((v) => v.albumId), ...upcoming.map((x) => x.albumId), avatarAlbum(target.avatar)].filter(Boolean),
      artistIds: mastered,
    }),
  };
}

function demoEmail(kind, u, tok) {
  const fr = u.lang !== 'en';
  if (kind === 'verify') {
    return {
      subject: fr ? 'Confirme ton adresse e-mail · AlbumMania' : 'Confirm your email address · AlbumMania',
      text: fr ? `Salut ${u.username}, confirme ton adresse e-mail pour activer ton compte. Tes 5 boosters de bienvenue t’attendent.`
        : `Hi ${u.username}, confirm your email address to activate your account. Your 5 welcome packs are waiting.`,
      cta: fr ? 'Confirmer mon adresse' : 'Confirm my email',
      path: `/verify?token=${tok}`,
    };
  }
  // Inscription avec une adresse qui a déjà un compte confirmé : même réponse qu'une inscription réussie (pas de
  // fuite des adresses inscrites), et un e-mail qui prévient le titulaire du compte.
  if (kind === 'exists') {
    return {
      subject: fr ? 'Ton compte AlbumMania existe déjà' : 'Your AlbumMania account already exists',
      text: fr ? `Salut ${u.username}, quelqu’un a voulu créer un compte avec ton adresse. Si c’était toi, connecte-toi simplement.`
        : `Hi ${u.username}, someone tried to sign up with your address. If it was you, just log in.`,
      cta: fr ? 'Me connecter' : 'Log in',
      path: '/login',
    };
  }
  return {
    subject: fr ? 'Réinitialise ton mot de passe · AlbumMania' : 'Reset your password · AlbumMania',
    text: fr ? `Salut ${u.username}, clique sur le bouton pour choisir un nouveau mot de passe.` : `Hi ${u.username}, click the button to choose a new password.`,
    cta: fr ? 'Choisir un mot de passe' : 'Choose a password',
    path: `/reset?token=${tok}`,
  };
}

function issue(u, purpose) {
  db.tokens = db.tokens.filter((x) => !(x.userId === u.id && x.purpose === purpose));
  const tok = token();
  db.tokens.push({ token: tok, userId: u.id, purpose, expiresAt: Date.now() + 86_400_000 });
  return tok;
}

function consume(tok, purpose) {
  const row = db.tokens.find((x) => x.token === tok && x.purpose === purpose);
  if (!row) return null;
  db.tokens = db.tokens.filter((x) => x !== row);
  return row.expiresAt > Date.now() ? userById(row.userId) : null;
}

// ---------- blind test ----------

// Parties récompensées du jour : jour civil à Paris (shared/periods.js), comme le vrai serveur.
const rewardedToday = (uid) => Object.values(db.games).filter((g) => g.userId === uid && g.rewarded && g.createdAt >= parisDayStart()).length;

function roundPayload(questions, index, admin) {
  const q = questions[index];
  const views = new Map(staticCatalog.tracks(q.choices).map((t) => [t.id, t]));
  const answer = views.get(q.answer);
  return {
    // L'admin reçoit la bonne réponse pour pouvoir tester le jeu rapidement.
    answer: admin ? q.answer : undefined,
    index,
    rounds: questions.length,
    choices: q.choices.filter((id) => views.has(id)).map((id) => ({ id, title: views.get(id).title, artist: views.get(id).artist })),
    // La démo est coupée d'Internet : pas d'extrait audio, les indices le remplacent.
    audio: null,
    clues: answer ? blindtestClues(answer) : null,
    seconds: BLINDTEST.roundSeconds,
  };
}

function loadGame(u, gameId) {
  const g = db.games[gameId];
  if (!g || g.userId !== u.id) fail(404, 'game_not_found');
  if (g.finishedAt) fail(409, 'game_finished');
  return g;
}

// ---------- éléments notés, code de l'admin ----------

const ADMIN_CODE_SHA256 = '22ecf3278dbed86211363046e3c6cc4a43be18686bc9a35e9815f6ac4d949fd9';

function itemExists(type, id) {
  if (!idOf(id)) return false;
  return type === 'album' ? ALBUM.has(id) : type === 'track' ? TRACK.has(id) : false;
}

function requireAdmin() {
  const u = me();
  if (!isAdmin(u)) fail(403, 'forbidden');
  return u;
}

// ---------- navigation dans le catalogue ----------

const SORTS = new Set(['popular', 'progress', 'title', 'year', 'recent']);
const idList = (raw, max) => String(raw || '').split(',').map((x) => x.trim()).filter((x) => x && x.length <= 80).slice(0, max);
const clampInt = (raw, min, max, fallback) => Math.min(max, Math.max(min, Math.floor(Number(raw) || fallback)));

// Curseurs opaques (comme server/paging.js) : JSON en base64url ; un curseur illisible répond 400 invalid_input.
const encodeCursor = (values) => btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const values = JSON.parse(atob(String(raw).replace(/-/g, '+').replace(/_/g, '/')));
    if (Array.isArray(values) && values.length) return values;
  } catch {
    // curseur illisible
  }
  return fail(400, 'invalid_input', { field: 'cursor' });
}

function browseAlbums(u, query) {
  const owned = ownedSet(u.id);
  // ?ids=a,b,c : ces albums précis, avec la progression du joueur.
  if (query.get('ids') != null) {
    const items = idList(query.get('ids'), 100).map((id) => staticCatalog.album(id)).filter(Boolean);
    const counts = albumCounts(owned, items.map((a) => a.id));
    return { total: items.length, items: items.map((a) => ({ ...a, owned: counts.get(a.id) || 0 })) };
  }
  const genre = query.get('genre');
  const decade = query.get('decade');
  const mine = query.get('mine');
  return staticCatalog.searchAlbums({
    q: (query.get('q') || '').slice(0, 100),
    genre: genre && genre.length <= 30 ? genre : null,
    decade: /^\d{4}$/.test(decade || '') ? Number(decade) : null,
    artistId: idOf(query.get('artist')),
    sort: SORTS.has(query.get('sort')) ? query.get('sort') : 'popular',
    mine: mine === '1' || mine === 'true',
    offset: clampInt(query.get('offset'), 0, 10_000, 0),
    limit: clampInt(query.get('limit'), 1, 60, 36),
    owned,
  });
}

// État de l'import du catalogue : la démo n'a que les 20 albums de base et ne peut rien importer (pas d'Internet).
function catalogStatus() {
  const totals = staticCatalog.totals();
  return {
    mode: 'off', target: 20_000, running: false, phase: 'idle', albums: totals.imported, totalAlbums: totals.albums,
    tracks: totals.tracks, promos: totals.promos, artists: { pending: 0, done: 0, skipped: 0, error: 0 }, requests: 0,
    startedAt: null, finishedAt: null, lastError: null, demo: true,
  };
}

// ---------- routes ----------

// La démo est coupée d'Internet : ses vraies pochettes sont celles intégrées à la page au build (./covers.js), sinon
// les visuels générés restent affichés.
const coverStatus = () => ({
  mode: DEMO_COVERS ? 'deezer' : 'off', providers: DEMO_COVERS ? ['deezer'] : [], spotifyKeys: false, total: 34,
  found: DEMO_COVERS ? Object.keys(DEMO_COVERS.items).length : 0, missing: [], running: false, lastRun: null, lastError: null, demo: true,
});

const routes = [
  ['GET', /^\/covers$/, () => coversSnapshot()],
  ['GET', /^\/auth\/username-available$/, ({ query }) => {
    const u = query.get('u') || '';
    const error = validateUsername(u);
    if (error) return { available: false, reason: error };
    const taken = !!userByName(u);
    return { available: !taken, reason: taken ? 'username_taken' : null };
  }],
  ['POST', /^\/auth\/signup$/, ({ body }) => {
    const email = String(body.email || '').trim().toLowerCase();
    const username = String(body.username || '').trim();
    const error = validateEmail(email) || validateUsername(username) || validatePassword(body.password);
    if (error) fail(400, error);
    // Comme le vrai serveur (PLAN.md 4.1.5) : CGU acceptées et 15 ans ou plus, deux cases distinctes.
    if (body.acceptTerms !== true) fail(400, 'terms_required');
    if (body.age15 !== true) fail(400, 'age_required');
    // Comme le vrai serveur : un compte jamais vérifié ne bloque ni l'adresse ni le pseudo.
    const existing = db.users.find((u) => u.email === email);
    // Adresse déjà inscrite et confirmée : même réponse qu'une inscription réussie (pas de fuite des adresses
    // inscrites) ; le titulaire reçoit un e-mail qui l'invite à se connecter.
    if (existing?.verified) return { ok: true, email, demoEmail: demoEmail('exists', existing) };
    const owner = userByName(username);
    if (owner && owner !== existing) fail(409, 'username_taken');
    if (existing) {
      db.users = db.users.filter((u) => u !== existing);
      db.tokens = db.tokens.filter((x) => x.userId !== existing.id);
    }
    const now = Date.now();
    const u = {
      id: db.nextId++, email, username, password: hash(body.password), verified: null, role: 'player',
      // « auto » : couleur déterminée par l'identifiant du joueur (calculée par le site).
      lang: body.lang === 'en' ? 'en' : 'fr', avatar: 'initials', avatarColor: 'auto',
      royalties: ECONOMY.welcomeRoyalties, xp: 0, packs: 0, packsAt: now, bonusPacks: ECONOMY.welcomePacks, showcase: [], createdAt: now, openings: 0,
      prefs: {}, onboardedAt: null, termsAcceptedAt: now, termsVersion: TERMS_VERSION,
    };
    db.users.push(u);
    return { ok: true, email, demoEmail: demoEmail('verify', u, issue(u, 'verify')) };
  }],
  ['POST', /^\/auth\/resend$/, ({ body }) => {
    const u = db.users.find((x) => x.email === String(body.email || '').trim().toLowerCase());
    if (!u || u.verified) return { ok: true };
    return { ok: true, demoEmail: demoEmail('verify', u, issue(u, 'verify')) };
  }],
  ['POST', /^\/auth\/verify$/, ({ body }) => {
    const u = consume(body.token, 'verify');
    if (!u) fail(400, 'invalid_token');
    if (!u.verified) {
      u.verified = Date.now();
      u.packsAt = Date.now();
      // Un joueur fictif t'envoie une demande d'ami pour montrer la fonctionnalité.
      const bot = userByName('maxvinyl');
      if (bot && !between(bot.id, u.id)) db.friendships.push({ id: db.nextId++, requester: bot.id, addressee: u.id, status: 'pending', createdAt: Date.now() });
      // Et quelques boosters spéciaux offerts, pour essayer le panneau « Boosters spéciaux » tout de suite.
      demoGift(u);
    }
    db.session = u.id;
    return state();
  }],
  ['POST', /^\/auth\/login$/, ({ body }) => {
    const id = String(body.identifier || '').trim();
    const u = id.includes('@') ? db.users.find((x) => x.email === id.toLowerCase()) : userByName(id);
    if (!u || u.bot || u.password !== hash(String(body.password || ''))) fail(401, 'invalid_credentials');
    if (!u.verified) fail(403, 'email_unverified', { email: u.email });
    db.session = u.id;
    return state();
  }],
  ['POST', /^\/auth\/logout$/, () => {
    db.session = null;
    return { ok: true };
  }],
  ['POST', /^\/auth\/forgot$/, ({ body }) => {
    const u = db.users.find((x) => x.email === String(body.email || '').trim().toLowerCase() && !x.bot);
    return u ? { ok: true, demoEmail: demoEmail('reset', u, issue(u, 'reset')) } : { ok: true };
  }],
  ['POST', /^\/auth\/reset$/, ({ body }) => {
    const error = validatePassword(body.password);
    if (error) fail(400, error);
    const u = consume(body.token, 'reset');
    if (!u) fail(400, 'invalid_token');
    u.password = hash(body.password);
    u.verified ||= Date.now();
    db.session = u.id;
    return state();
  }],

  // Catalogue : mêmes routes, filtres et limites que le vrai serveur. Chiffres et cartes lisibles sans compte
  // (l'écran de connexion affiche quelques cartes), tout le reste demande d'être connecté.
  ['GET', /^\/catalog\/info$/, () => ({ totals: staticCatalog.totals(), genres: staticCatalog.genres(), decades: staticCatalog.decades() })],
  ['GET', /^\/catalog\/albums$/, ({ query }) => browseAlbums(me(), query)],
  ['GET', /^\/catalog\/albums\/([^/]+)$/, ({ params }) => {
    me();
    const album = staticCatalog.album(idOf(decodeURIComponent(params[0])));
    if (!album) fail(404, 'unknown_album');
    return { album, tracks: staticCatalog.albumTracks(album.id), artist: staticCatalog.artist(album.artistId) };
  }],
  ['GET', /^\/catalog\/artists$/, ({ query }) => {
    me();
    return { artists: idList(query.get('ids'), 100).map((id) => staticCatalog.artist(id)).filter(Boolean) };
  }],
  ['GET', /^\/catalog\/artists\/([^/]+)$/, ({ params }) => {
    me();
    const artist = staticCatalog.artist(idOf(decodeURIComponent(params[0])));
    if (!artist) fail(404, 'unknown_artist');
    return { artist, albums: staticCatalog.artistAlbums(artist.id), promos: staticCatalog.artistTracks(artist.id).filter((t) => t.kind === 'promo') };
  }],
  ['GET', /^\/catalog\/tracks$/, ({ query }) => ({ tracks: staticCatalog.tracks(idList(query.get('ids'), 200)) })],
  ['GET', /^\/catalog\/promos$/, ({ query }) => {
    me();
    return staticCatalog.promos({ offset: clampInt(query.get('offset'), 0, 100_000, 0), limit: clampInt(query.get('limit'), 1, 120, 60) });
  }],
  ['GET', /^\/catalog\/mine$/, ({ query }) => {
    const u = me();
    const rarity = query.get('rarity');
    return staticCatalog.ownedTracks(ownedSet(u.id), {
      q: (query.get('q') || '').slice(0, 80),
      rarity: RARITIES.includes(rarity) ? rarity : null,
      offset: clampInt(query.get('offset'), 0, 100_000, 0),
      limit: clampInt(query.get('limit'), 1, 120, 60),
      holo: holoSet(u.id),
    });
  }],
  ['GET', /^\/catalog\/groups$/, ({ query }) => {
    const u = me();
    const by = query.get('by');
    if (by !== 'genre' && by !== 'decade') fail(400, 'invalid_group');
    return { by, groups: staticCatalog.groupStats(ownedSet(u.id), by) };
  }],

  ['GET', /^\/state$/, () => state()],
  ['POST', /^\/packs\/open$/, ({ body }) => {
    const u = me();
    syncPacks(u);
    const admin = isAdmin(u);
    const n = Math.floor(Number(body.count) || 1);
    if (n < 1 || n > (admin ? 50 : 1)) fail(400, 'invalid_count');
    if (!admin) {
      if (u.packs + u.bonusPacks < 1) fail(409, 'no_packs');
      if (u.packs > 0) {
        if (u.packs >= MAX_STOCK) u.packsAt = Date.now();
        u.packs -= 1;
      } else u.bonusPacks -= 1;
    }
    // Ciblage (liste d'envies, albums avancés, promos de ses artistes) et pitié douce, comme le serveur.
    const { packs, pity } = rollSeries(n, u.pity || 0, packFocus(u.id));
    u.pity = pity;
    return { packs: packs.map((p) => p.length), ...addCards(u, packs.flat(), admin ? 'admin-pack' : 'pack'), pity, state: partialState() };
  }],
  // Booster d'album : 5 cartes de l'album choisi, en priorité celles qui manquent ; payé en royalties (gratuit pour l'admin).
  ['POST', /^\/packs\/album$/, ({ body }) => {
    const u = me();
    const album = staticCatalog.album(idOf(body.albumId));
    if (!album) fail(404, 'unknown_album');
    const cost = isAdmin(u) ? 0 : ECONOMY.albumPackPrice;
    if (u.royalties < cost) fail(409, 'not_enough_royalties');
    u.royalties -= cost;
    const owned = ownedSet(u.id);
    const cards = rollAlbumPack(rand, staticCatalog, album.id, owned);
    const pity = resetPityOnHit(u, cards);
    return { spent: cost, albumId: album.id, packs: [cards.length], ...addCards(u, cards, 'album-pack'), pity, state: partialState() };
  }],
  ['POST', /^\/shop\/buy-pack$/, () => {
    const u = me();
    if (u.royalties < ECONOMY.packPrice) fail(409, 'not_enough_royalties');
    u.royalties -= ECONOMY.packPrice;
    u.bonusPacks += 1;
    return { spent: ECONOMY.packPrice, state: partialState() };
  }],
  ['POST', /^\/collection\/recycle$/, () => {
    const u = me();
    let royalties = 0;
    let recycled = 0;
    for (const [k, v] of Object.entries(cardsOf(u.id))) {
      if (v.count > 1) {
        const [t, variant] = k.split('|');
        royalties += recycleValue(trackOf(t)?.rarity, variant) * (v.count - 1);
        recycled += v.count - 1;
        v.count = 1;
      }
    }
    u.royalties += royalties;
    // Recycler change le nombre d'exemplaires de chaque carte : état complet, comme le vrai serveur.
    return { royalties, recycled, state: state() };
  }],
  ['POST', /^\/collection\/press$/, ({ body }) => {
    const u = me();
    const track = trackOf(idOf(body.trackId));
    if (!track) fail(404, 'unknown_track');
    const admin = isAdmin(u);
    // Promo : pressable une fois un album de son artiste complété (1 200 royalties, PLAN.md 6.4).
    const base = pressCost(track.rarity, { promoUnlocked: track.rarity === 'promo' && promoUnlocked(u.id, track.artistId) });
    // L'admin presse gratuitement, promos comprises, pour tester.
    if (base == null && !admin) fail(409, 'promo_locked', { artistId: track.artistId });
    const cost = admin ? 0 : base;
    if (ownedSet(u.id).has(track.id)) fail(409, 'already_owned');
    if (u.royalties < cost) fail(409, 'not_enough_royalties');
    u.royalties -= cost;
    return { spent: cost, ...addCards(u, [{ trackId: track.id, variant: 'std' }], 'press'), state: partialState() };
  }],
  ['POST', /^\/profile\/avatar$/, ({ body }) => {
    const u = me();
    // « auto » : couleur déterminée par l'identifiant du joueur (comme le vrai serveur).
    if (body.color !== undefined && body.color !== 'auto' && !AVATAR_COLORS.includes(body.color)) fail(400, 'invalid_color');
    if (body.avatar !== undefined && body.avatar !== 'initials') {
      const m = /^album:(.+)$/.exec(String(body.avatar));
      if (!m || !ALBUM.has(m[1])) fail(400, 'invalid_avatar');
      if (!isAdmin(u) && !achOf(u.id)[`album:${m[1]}`]) fail(403, 'avatar_locked');
    }
    u.avatar = body.avatar ?? u.avatar;
    u.avatarColor = body.color ?? u.avatarColor;
    return { state: partialState() };
  }],
  ['POST', /^\/profile\/showcase$/, ({ body }) => {
    const u = me();
    // Vitrine : 6 cartes, +1 aux niveaux 10 et 30 (PLAN.md 6.6).
    const max = showcaseSlots(levelOf(u));
    if (!Array.isArray(body.slots) || body.slots.length > max) fail(400, 'invalid_showcase');
    const owned = ownedSet(u.id);
    const clean = body.slots.map((id) => (idOf(id) && owned.has(id) ? id : null));
    while (clean.length < max) clean.push(null);
    u.showcase = clean;
    return { state: partialState() };
  }],
  ['POST', /^\/profile\/lang$/, ({ body }) => {
    if (body.lang !== 'fr' && body.lang !== 'en') fail(400, 'invalid_lang');
    me().lang = body.lang;
    return { ok: true };
  }],
  ['POST', /^\/profile\/settings$/, ({ body }) => {
    const u = me();
    // Tout est validé avant d'écrire : un champ refusé n'en enregistre aucun (comme le vrai serveur).
    if (body.ratingScale !== undefined && !['stars', 'points'].includes(body.ratingScale)) fail(400, 'invalid_scale');
    const prefs = body.prefs;
    if (prefs !== undefined) {
      if (!isObj(prefs)) fail(400, 'invalid_input', { field: 'prefs' });
      if (prefs.listen !== undefined && !LISTEN_PLATFORMS.includes(prefs.listen)) fail(400, 'invalid_input', { field: 'prefs.listen' });
      if (prefs.emailDigest !== undefined && typeof prefs.emailDigest !== 'boolean') fail(400, 'invalid_input', { field: 'prefs.emailDigest' });
      u.prefs = { ...u.prefs, ...(prefs.listen !== undefined && { listen: prefs.listen }), ...(prefs.emailDigest !== undefined && { emailDigest: prefs.emailDigest }) };
    }
    if (body.ratingScale !== undefined) u.ratingScale = body.ratingScale;
    return { state: partialState() };
  }],
  ['GET', /^\/users\/([^/]+)$/, ({ params }) => {
    const viewer = me();
    const target = userByName(decodeURIComponent(params[0]));
    if (!target || !target.verified) fail(404, 'user_not_found');
    return publicProfile(viewer, target);
  }],
  // Notes et critiques (/ratings/*, /users/:u/ratings) : jumeau du module ratings (mock/ratings.js).
  // Démo : l'accès admin se déverrouille avec le code du propriétaire (seule son empreinte SHA-256 est ici).
  ['POST', /^\/demo\/unlock-admin$/, async ({ body }) => {
    const u = me();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(body.code || '').trim().toUpperCase()));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== ADMIN_CODE_SHA256) fail(403, 'invalid_code');
    u.role = 'admin';
    return { state: state() };
  }],
  ['GET', /^\/friends$/, () => {
    const u = me();
    botsRespond(u);
    return friendsOf(u.id);
  }],
  ['POST', /^\/friends\/request$/, ({ body }) => {
    const u = me();
    const target = userByName(body.username);
    if (!target || !target.verified) fail(404, 'user_not_found');
    if (target.id === u.id) fail(400, 'cannot_add_self');
    const f = between(u.id, target.id);
    const now = Date.now();
    if (f?.status === 'accepted') fail(409, 'already_friends');
    if (f?.status === 'pending') {
      if (f.requester === u.id) fail(409, 'already_requested');
      // L'autre joueur nous avait déjà invité : on accepte directement.
      f.status = 'accepted';
      f.respondedAt = now;
      return { status: 'accepted', username: target.username, state: partialState() };
    }
    // Demande refusée : 7 jours avant de pouvoir la renvoyer (comme le vrai serveur).
    if (f?.status === 'declined' && f.requester === u.id) {
      const until = (f.respondedAt || f.createdAt) + FRIEND_COOLDOWN_MS;
      if (now < until) fail(409, 'request_cooldown', { until });
    }
    if (f) Object.assign(f, { requester: u.id, addressee: target.id, status: 'pending', createdAt: now, respondedAt: undefined });
    else db.friendships.push({ id: db.nextId++, requester: u.id, addressee: target.id, status: 'pending', createdAt: now });
    return { status: 'pending', username: target.username, state: partialState() };
  }],
  ['POST', /^\/friends\/(\d+)\/(accept|decline)$/, ({ params }) => {
    const u = me();
    const f = db.friendships.find((x) => x.id === Number(params[0]));
    if (!f || f.status !== 'pending') fail(404, 'request_not_found');
    if (params[1] === 'accept') {
      if (f.addressee !== u.id) fail(403, 'forbidden');
      f.status = 'accepted';
      f.respondedAt = Date.now();
    } else if (f.addressee === u.id) {
      // Refuser : la demande reste 7 jours (délai avant que l'expéditeur puisse la renvoyer).
      f.status = 'declined';
      f.respondedAt = Date.now();
    } else if (f.requester === u.id) {
      // Annuler sa propre demande : elle disparaît.
      db.friendships = db.friendships.filter((x) => x !== f);
    } else {
      fail(403, 'forbidden');
    }
    return { ...friendsOf(u.id), state: partialState() };
  }],
  ['DELETE', /^\/friends\/(\d+)$/, ({ params }) => {
    const u = me();
    const f = between(u.id, Number(params[0]));
    if (!f || f.status !== 'accepted') fail(404, 'not_friends');
    db.friendships = db.friendships.filter((x) => x !== f);
    return { ...friendsOf(u.id), state: partialState() };
  }],

  ['GET', /^\/blindtest$/, () => {
    const u = me();
    return {
      genres: [{ id: 'all', count: staticCatalog.totals().tracks }, ...staticCatalog.genres().map((g) => ({ id: g.id, count: g.tracks }))],
      rewardedToday: rewardedToday(u.id), rewardedLimit: isAdmin(u) ? null : BLINDTEST.rewardedGamesPerDay,
      rounds: BLINDTEST.rounds, roundSeconds: BLINDTEST.roundSeconds, rewards: BLINDTEST.rewards, audio: false,
    };
  }],
  ['POST', /^\/blindtest\/start$/, ({ body }) => {
    const u = me();
    const genre = body.genre;
    if (typeof genre !== 'string' || (genre !== 'all' && !staticCatalog.genres().some((g) => g.id === genre))) fail(400, 'invalid_genre');
    const rewarded = isAdmin(u) || rewardedToday(u.id) < BLINDTEST.rewardedGamesPerDay;
    const questions = buildBlindtest(genre, rand, staticCatalog);
    if (questions.length < BLINDTEST.rounds || questions.some((qq) => qq.choices.length < 2)) fail(409, 'not_enough_tracks');
    const id = token();
    const round = roundPayload(questions, 0, isAdmin(u));
    questions[0].startedAt = Date.now();
    db.games[id] = { id, userId: u.id, genre, questions, current: 0, score: 0, correct: 0, rewarded, createdAt: Date.now() };
    return { gameId: id, rewarded, round };
  }],
  ['POST', /^\/blindtest\/([^/]+)\/answer$/, ({ params, body }) => {
    const u = me();
    const g = loadGame(u, params[0]);
    const q = g.questions[g.current];
    if (!q.startedAt || q.picked !== undefined) fail(409, 'round_not_active');
    const elapsed = Date.now() - q.startedAt;
    const correct = elapsed <= (BLINDTEST.roundSeconds + 2) * 1000 && body.choice === q.answer;
    const points = blindtestPoints(correct, elapsed);
    q.picked = idOf(body.choice);
    q.points = points;
    g.score += points;
    if (correct) g.correct += 1;
    let final = null;
    let levelUp = null;
    if (g.current === g.questions.length - 1) {
      const rewardPacks = g.rewarded ? blindtestReward(g.correct) : 0;
      const xp = g.correct * 10;
      u.bonusPacks += rewardPacks;
      // L'XP passe par les paliers de niveau (booster bonus, PLAN.md 6.6), comme toute autre source.
      levelUp = gainXp(u, xp);
      g.finishedAt = Date.now();
      final = { score: g.score, correct: g.correct, rounds: g.questions.length, rewardPacks, rewarded: g.rewarded, xp };
    }
    const result = { result: { correct, answer: q.answer, picked: q.picked, points, score: g.score }, final, levelUp, catalog: refs({ trackIds: [q.answer] }) };
    return final ? { ...result, state: partialState() } : result;
  }],
  ['POST', /^\/blindtest\/([^/]+)\/next$/, ({ params }) => {
    const u = me();
    const g = loadGame(u, params[0]);
    if (g.questions[g.current].picked === undefined) fail(409, 'round_not_answered');
    const index = g.current + 1;
    if (index >= g.questions.length) fail(409, 'game_finished');
    const round = roundPayload(g.questions, index, isAdmin(u));
    g.current = index;
    g.questions[index].startedAt = Date.now();
    return { round };
  }],

  // Vue d'ensemble : joueurs par pages de 50 (curseur sur la date d'inscription puis l'identifiant, comme le serveur).
  ['GET', /^\/admin\/overview$/, ({ query }) => {
    requireAdmin();
    const limit = clampInt(query.get('limit'), 1, 100, 50);
    const after = decodeCursor(query.get('cursor'));
    const sorted = [...db.users].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
    const rest = after ? sorted.filter((u) => u.createdAt < after[0] || (u.createdAt === after[0] && u.id < after[1])) : sorted;
    const page = rest.slice(0, limit);
    const users = page.map((u) => ({
      id: u.id, username: u.username, email: u.email, role: u.role, verified: !!u.verified, unique: ownedSet(u.id).size,
      openings: u.openings || 0, royalties: u.royalties, packs: u.packs + u.bonusPacks, level: levelFromXp(u.xp).level, createdAt: u.createdAt, lastSeenAt: null,
    }));
    const last = page[page.length - 1];
    return {
      users,
      nextCursor: rest.length > limit && last ? encodeCursor([last.createdAt, last.id]) : null,
      totals: {
        users: db.users.length,
        verified: db.users.filter((u) => u.verified).length,
        openings: db.users.reduce((n, u) => n + (u.openings || 0), 0),
        // Cartes distinctes de tous les joueurs (comme la somme des compteurs users.unique_cards du serveur).
        cards: db.users.reduce((n, u) => n + ownedSet(u.id).size, 0),
        ratings: db.ratings.length,
      },
      catalog: staticCatalog.totals(),
      adminCount: 1,
      odds: packOdds(),
      slots: PACK_SLOTS,
      rarities: RARITIES,
      config: { packRegenMinutes: REGEN_MS / 60_000, packMaxStock: MAX_STOCK, blindtestAudio: 'off (démo)' },
    };
  }],
  ['POST', /^\/admin\/users\/(\d+)\/grant$/, ({ params, body }) => {
    requireAdmin();
    const t = userById(Number(params[0]));
    if (!t) fail(404, 'user_not_found');
    const packs = Math.max(0, Math.min(1000, Math.floor(Number(body.packs) || 0)));
    const royalties = Math.max(0, Math.min(1_000_000, Math.floor(Number(body.royalties) || 0)));
    t.bonusPacks += packs;
    t.royalties += royalties;
    return { packs, royalties };
  }],
  // Critiques récentes et suppression d'une critique : file de modération (mock/moderation.js).
  ['GET', /^\/admin\/covers$/, () => {
    requireAdmin();
    return coverStatus();
  }],
  ['POST', /^\/admin\/covers\/refresh$/, () => {
    requireAdmin();
    return coverStatus();
  }],
  ['GET', /^\/admin\/catalog$/, () => {
    requireAdmin();
    return catalogStatus();
  }],
  // Import et pause : rien à faire dans la démo, l'état reste celui des 20 albums de base.
  ['POST', /^\/admin\/catalog\/(import|pause)$/, () => {
    requireAdmin();
    return catalogStatus();
  }],
  ['POST', /^\/admin\/me\/reset$/, () => {
    const u = requireAdmin();
    db.cards[u.id] = {};
    db.achievements[u.id] = {};
    u.xp = 0;
    u.pity = 0;
    u.avatar = 'initials';
    u.showcase = [];
    return { state: state() };
  }],
  // Sans albumId : les 20 albums de base (tout le catalogue de la démo) ; avec albumId : cet album seulement.
  ['POST', /^\/admin\/me\/complete$/, ({ body }) => {
    const u = requireAdmin();
    const id = idOf(body.albumId);
    if (body.albumId != null && !(id && ALBUM.has(id))) fail(404, 'unknown_album');
    const mine = cardsOf(u.id);
    const ach = achOf(u.id);
    const now = Date.now();
    const list = id ? staticCatalog.albumTracks(id) : ALL_TRACKS;
    for (const t of list) if (!mine[`${t.id}|std`] && !mine[`${t.id}|holo`]) mine[`${t.id}|std`] = { count: 1, at: now };
    for (const albumId of id ? [id] : ALBUM.keys()) ach[`album:${albumId}`] ||= now;
    // Artistes dont toutes les cartes sont maintenant possédées.
    const owned = ownedSet(u.id);
    for (const artistId of new Set(list.map((t) => t.artistId))) {
      const ids = staticCatalog.artistTrackIds(artistId);
      if (ids.length && ids.every((x) => owned.has(x))) ach[`artist:${artistId}`] ||= now;
    }
    return { state: state() };
  }],
  // Prépare un album complet à une carte près, pour tester la célébration de fin d'album.
  ['POST', /^\/admin\/me\/almost$/, ({ body }) => {
    const u = requireAdmin();
    const id = idOf(body.albumId);
    const list = id ? staticCatalog.albumTracks(id) : [];
    if (!list.length) fail(404, 'unknown_album');
    const missing = list[Math.floor(rand() * list.length)];
    const mine = cardsOf(u.id);
    for (const t of list) if (t.id !== missing.id && !mine[`${t.id}|std`] && !mine[`${t.id}|holo`]) mine[`${t.id}|std`] = { count: 1, at: Date.now() };
    delete mine[`${missing.id}|std`];
    delete mine[`${missing.id}|holo`];
    delete achOf(u.id)[`album:${id}`];
    delete achOf(u.id)[`artist:${missing.artistId}`];
    return { missing: missing.id, catalog: refs({ trackIds: [missing.id], albumIds: [id] }), state: state() };
  }],
];

/**
 * Outils du faux serveur pour les jumeaux de modules (client/src/demo/mock/<module>.js) : reçus par seed/migrate
 * et par chaque route ({ params, body, query, ctx }). `state()` : état complet ; `partialState()` : état partiel
 * renvoyé par une action (PLAN.md 4.1.1 : { partial, user, packs, counts, stats: { summary }, serverTime }), à
 * accompagner des deltas de l'action. Un module peut aussi exporter `counts(db, ctx, userId)` → { unread… } pour
 * les pastilles de state.counts (ex. notifications non lues).
 * `ctx.collection` : le jeu de collection (jumeau de deps.collection et des services de P1-D), pour les autres
 * jumeaux : addXp(userId, xp, source) → levelUp | null (la seule façon d'ajouter de l'XP : paliers de niveau),
 * grantBooster(userId, kind, theme, source) → id, unlockedCosmetics(userId), grantCosmetic(userId, id, source),
 * cosmeticsOf(userId), setCosmetics(userId, selection), wishlist(userId), addToWishlist(userId, albumIds) ; et pour
 * mock/collection.js : ownedSet, achOf, rankOf, levelOf, pressInfo, openSpecialPack, demoGift ; pour mock/workshop.js
 * (P2-D) : cardsOf, holoSet, addCards(userId, cards, source), insertBooster(userId, kind, theme, source).
 * Un module peut aussi compléter la réponse de n'importe quelle route, comme un abonné du bus du vrai serveur :
 * `export function after({ method, path, query, body, result, ctx })` (appelé après chaque route, dans l'ordre des
 * modules ; renvoie la réponse, modifiée ou non). Exemple : l'édition deluxe donnée après une note (mock/workshop.js).
 */
export const ctx = {
  get db() {
    return db;
  },
  me,
  userById,
  userByName,
  summaries,
  refs,
  state,
  partialState,
  fail,
  save,
  now: () => Date.now(),
  rand,
  staticCatalog,
  TRACK,
  ALBUM,
  ARTIST,
  collection: {
    addXp(userId, xp) {
      const u = userById(userId);
      if (!u) fail(404, 'user_not_found');
      return gainXp(u, xp);
    },
    grantBooster(userId, kind, theme, source = 'game') {
      // Comme deps.collection.grantBooster : le type se déduit du thème quand il est omis.
      let [k, t] = [kind, theme];
      if (k !== 'theme' && k !== 'album') [k, t] = [null, kind];
      const parsed = parseBoosterTheme(t);
      if (!parsed) fail(400, 'invalid_theme');
      if (parsed.kind === 'album' && !ALBUM.has(parsed.value)) fail(404, 'unknown_album');
      return insertBooster(userId, parsed.kind === 'album' || parsed.kind === 'choice' ? 'album' : 'theme', t, source);
    },
    unlockedCosmetics,
    grantCosmetic(userId, id, source = 'game') {
      const list = (db.cosmeticGrants[userId] ||= []);
      if (!list.some((c) => c.id === id)) list.push({ id, source: String(source).slice(0, 80), at: Date.now() });
    },
    cosmeticsOf: (userId) => cosmeticsOf(userById(userId) || { id: userId }),
    /** Comme deps.collection.setCosmetics : { frame, vinyl, theme, title } (clé courte ou complète, null = aucun). */
    setCosmetics(userId, selection) {
      const u = userById(userId);
      if (!u) fail(404, 'user_not_found');
      if (!selection || typeof selection !== 'object' || Array.isArray(selection)) fail(400, 'invalid_input', { field: 'cosmetics' });
      const unlocked = new Set(unlockedCosmetics(userId).map((c) => c.id));
      const next = { ...cosmeticsOf(u) };
      for (const kind of ['frame', 'vinyl', 'theme', 'title']) {
        if (!(kind in selection)) continue;
        const value = selection[kind];
        if (value === null || value === '') {
          next[kind] = null;
          continue;
        }
        if (typeof value !== 'string') fail(400, 'invalid_input', { field: kind });
        const key = value.startsWith(`${kind}:`) ? value.slice(kind.length + 1) : value;
        if (!unlocked.has(`${kind}:${key}`)) fail(409, 'cosmetic_locked', { id: `${kind}:${key}` });
        next[kind] = key;
      }
      u.cosmetics = next;
      return next;
    },
    wishlist: (userId) => [...wishlistOf(userId)],
    addToWishlist(userId, albumIds = []) {
      const u = userById(userId);
      const list = wishlistOf(userId);
      const max = wishlistMax(u ? levelOf(u) : 1);
      for (const id of [...new Set(albumIds)].slice(0, 50)) if (ALBUM.has(id) && !list.includes(id) && list.length < max) list.push(id);
      return [...list];
    },
    ownedSet,
    achOf,
    rankOf,
    levelOf,
    pressInfo,
    openSpecialPack,
    demoGift,
    // Atelier (P2-D, mock/workshop.js) : exemplaires du joueur ({ 'trackId|variant': { count, at, r } }), cartes holo,
    // ajout de cartes (même calcul que services.addCards), booster spécial ajouté à l'inventaire.
    cardsOf,
    holoSet,
    addCards: (userId, cards, source) => addCards(userById(userId), cards, source),
    insertBooster,
  },
};

// Routes des modules d'abord : un module peut préciser ou remplacer une route du cœur.
const ALL_ROUTES = [...MODULES.flatMap((mod) => mod.routes || []), ...routes];

export async function handle(method, path, body = {}) {
  load();
  const [pathname, qs] = path.split('?');
  // Petit délai réseau simulé (plus court pour la navigation dans le catalogue : défilement, recherche).
  const browsing = method === 'GET' && pathname.startsWith('/catalog/');
  await new Promise((r) => setTimeout(r, browsing ? 40 + rand() * 60 : 90 + rand() * 110));
  for (const [m, re, fn] of ALL_ROUTES) {
    if (m !== method) continue;
    const match = re.exec(pathname);
    if (!match) continue;
    const query = new URLSearchParams(qs || '');
    let result = await fn({ params: match.slice(1), body: body || {}, query, ctx });
    // Abonnés des modules (comme le bus du serveur) : chacun dans son try/catch, une erreur ne casse pas la route.
    for (const mod of MODULES) {
      if (!mod.after) continue;
      try {
        result = mod.after({ method, path: pathname, query, body: body || {}, result, ctx }) ?? result;
      } catch (err) {
        console.error(`[démo] abonné du module ${mod.name} en erreur :`, err);
      }
    }
    save();
    return JSON.parse(JSON.stringify(result));
  }
  throw new ApiError(404, 'not_found');
}
