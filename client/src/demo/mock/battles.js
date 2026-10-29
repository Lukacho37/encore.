// Jumeau de démo du module « battles » (server/battles.js, P1-F, PLAN.md 4.2.6, 5.4) : mêmes routes, mêmes formes.
//   GET  /battles/next?category=&n=        → { duels: [{ token, category, itemType, a, b }], featured, today, catalog }
//   POST /battles/vote { token, winner, category? } → { ratingA, ratingB, deltaA, deltaB, xp, todayCount, next, … }
//   GET  /rankings                         → { categories: [{ key, kind, itemType, items, votes, top }], featured, catalog }
//   GET  /rankings/:category?cursor=       → { items: [{ rank, id, rating, votes, wins, provisional }], nextCursor, total, listed, catalog }
//   GET  /items/:type/:id/rankings          → { items: [{ category, rank, total, … }], vote, catalog } (« Autour de l'album »)
// Données : db.battleVotes = [{ id, userId, itemType, a, b, winner, context, categories, counted, createdAt }] (a < b,
// une ligne par paire et par joueur, « Je ne connais pas » compris), db.battleRatings = { '<catégorie>|<type>':
// { <élément>: { rating, votes, wins } } }, db.battleSecret (signature des jetons), db.battleFeatured (catégorie du jour).
// Mêmes règles que le serveur (shared/battles.js) : jeton signé (joueur · éléments · catégorie · 30 min), un vote par
// paire, Elo de chaque catégorie qui contient les deux éléments, anti-brigade, 5 XP pour les 20 premiers votes du jour,
// quota de 200 votes, « provisoire » sous 50 votes. Les joueurs fictifs ont déjà voté (≈ 600 duels sur deux semaines,
// les albums populaires plus souvent) : les classements existent dès l'ouverture de la démo, avec des albums classés
// et d'autres encore provisoires. Pas de pays tant que moins de 30 albums en ont un (PLAN.md 5.4) : la démo en a 20.
import {
  EXPLORE_SHARE, EXPLORE_VOTES, HUB_GROUPS, KNOWN_SHARE, MIX, PAIR_GAP, RANKING_CAP, TOKEN_TTL_MS, XP_PER_VOTE, XP_VOTES_PER_DAY,
  albumCategories, brigadeFactor, decadeOf, eloUpdate, inCategory, isListed, isProvisional, orderPair, parseCategory, seedRating,
  sharedCategories, trackCategories,
} from '@shared/battles.js';
import { THEME_GENRES } from '@shared/rules.js';
import { dayKey, dayStart } from '@shared/periods.js';
import { hash32, seededRandom } from '@shared/quests.js';
import { evaluateBadges } from './badges.js';

export const name = 'battles';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const POPULAR = 200;
const HUB_PER_GROUP = 12;
const DUELS_MAX = 5;
const ATTEMPTS = 40;
const QUOTA = 200;
const COUNTRY_MIN_ALBUMS = 30;
const FEATURED_DECADES = [1960, 1970, 1980, 1990, 2000, 2010];
const ITEM_PREF = ['artist', 'album_tracks', 'genre_decade', 'decade', 'genre', 'year', 'artist_tracks', 'country', 'global'];

// Curseurs opaques, comme server/paging.js : JSON en base64url, `[offset]` pour les classements.
const encodeCursor = (values) => btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function offsetOf(raw, ctx) {
  if (!raw) return 0;
  try {
    const values = JSON.parse(atob(String(raw).replace(/-/g, '+').replace(/_/g, '/')));
    if (Array.isArray(values) && values.length === 1 && Number.isInteger(values[0]) && values[0] >= 0) return Math.min(values[0], RANKING_CAP);
  } catch {
    // curseur illisible
  }
  return ctx.fail(400, 'invalid_input', { field: 'cursor' });
}
const limitOf = (query, def = 20) => Math.min(50, Math.max(1, Math.floor(Number(query.get('limit')) || def)));
const decode = (raw) => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
};

function ensure(db) {
  if (!Array.isArray(db.battleVotes)) db.battleVotes = [];
  if (!db.battleRatings || typeof db.battleRatings !== 'object' || Array.isArray(db.battleRatings)) db.battleRatings = {};
  if (!Number.isInteger(db.nextBattleVoteId)) db.nextBattleVoteId = 1 + Math.max(0, ...db.battleVotes.map((v) => v.id || 0));
  if (typeof db.battleSecret !== 'string' || db.battleSecret.length < 16) {
    db.battleSecret = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  }
}

// ----- jetons signés (pas de HMAC synchrone dans le navigateur : deux empreintes du secret et du contenu) ----------

const b64 = (text) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text) => decodeURIComponent(escape(atob(String(text).replace(/-/g, '+').replace(/_/g, '/'))));
const mac = (db, data) => `${hash32(`${db.battleSecret}|${data}`).toString(36)}${hash32(`${data}|${db.battleSecret}|2`).toString(36)}`;
const sign = (db, payload) => {
  const data = b64(JSON.stringify(payload));
  return `${data}.${mac(db, data)}`;
};
/** Contenu d'un jeton authentique, sinon null. */
function verify(db, token) {
  if (typeof token !== 'string' || token.length > 800) return null;
  const [data, sig, extra] = token.split('.');
  if (!data || !sig || extra !== undefined || sig !== mac(db, data)) return null;
  try {
    const p = JSON.parse(unb64(data));
    return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

// ----- faits du catalogue -----------------------------------------------------------------------------------

let countryReady = null;
/** Les pays n'entrent dans les catégories qu'à partir de 30 albums qui en ont un (PLAN.md 5.4). */
function countriesOn(ctx) {
  if (countryReady == null) countryReady = [...ctx.ALBUM.values()].filter((a) => a.country).length >= COUNTRY_MIN_ALBUMS;
  return countryReady;
}

function albumFacts(ctx, id) {
  const a = ctx.ALBUM.get(id);
  return a ? { id, artistId: a.artistId, year: a.year, genre: a.genre, country: countriesOn(ctx) ? a.country || null : null } : null;
}
function trackFacts(ctx, id) {
  const t = ctx.TRACK.get(id);
  return t ? { id, albumId: t.albumId || null, artistId: t.artistId } : null;
}
const factsOf = (ctx, itemType, id) => (itemType === 'track' ? trackFacts(ctx, id) : albumFacts(ctx, id));

/** Popularité d'un album (moyenne de ses morceaux), pour les réservoirs et les goûts des joueurs fictifs. */
function albumPop(ctx, id) {
  return ctx.staticCatalog.albumPop(id);
}

/** Éléments d'une catégorie, les plus populaires d'abord (200 au plus). */
function popularPool(ctx, cat) {
  if (cat.kind === 'album_tracks') return ctx.staticCatalog.albumTrackIds(cat.value).slice(0, POPULAR);
  if (cat.kind === 'artist_tracks') {
    return ctx.staticCatalog.artistTracks(cat.value).sort((x, y) => (y.pop || 0) - (x.pop || 0) || (x.id < y.id ? -1 : 1))
      .slice(0, POPULAR).map((t) => t.id);
  }
  if (cat.kind === 'event') return [];
  return [...ctx.ALBUM.keys()].filter((id) => inCategory(cat, albumFacts(ctx, id)))
    .sort((x, y) => albumPop(ctx, y) - albumPop(ctx, x) || (x < y ? -1 : 1)).slice(0, POPULAR);
}
const sizeOf = (ctx, cat) => popularPool(ctx, cat).length;

/** Albums que le joueur connaît : cartes, notes, « Mes 9 albums ». */
function knownAlbums(ctx, uid) {
  const { db } = ctx;
  const out = new Set();
  for (const t of ctx.collection.ownedSet(uid)) {
    const albumId = ctx.TRACK.get(t)?.albumId;
    if (albumId) out.add(albumId);
  }
  for (const r of db.ratings) if (r.userId === uid && r.type === 'album' && ctx.ALBUM.has(r.id)) out.add(r.id);
  for (const l of Array.isArray(db.lists) ? db.lists : []) {
    if (l.userId === uid && l.kind === 'grid9') for (const it of l.items || []) if (it.type === 'album' && ctx.ALBUM.has(it.id)) out.add(it.id);
  }
  return [...out];
}

function knownPool(ctx, uid, cat, pool) {
  if (cat.itemType === 'track') {
    const owned = ctx.collection.ownedSet(uid);
    const rated = new Set(ctx.db.ratings.filter((r) => r.userId === uid && r.type === 'track').map((r) => r.id));
    return pool.filter((id) => owned.has(id) || rated.has(id));
  }
  return knownAlbums(ctx, uid).filter((id) => inCategory(cat, albumFacts(ctx, id)));
}

/** Notes de la communauté d'un élément (rating_stats) : { count, sum } sur 10. */
function statsOf(ctx, itemType, id) {
  let count = 0;
  let sum = 0;
  for (const r of ctx.db.ratings) {
    if (r.type === itemType && r.id === id && !r.hiddenAt) {
      count += 1;
      sum += r.score;
    }
  }
  return { count, sum };
}

const bucket = (db, cat) => (db.battleRatings[`${cat.key}|${cat.itemType}`] ||= {});

/** Note Elo d'un élément dans la catégorie ; sans vote, celle de départ (moyenne de la communauté). */
function ratingOf(ctx, cat, id) {
  const r = ctx.db.battleRatings[`${cat.key}|${cat.itemType}`]?.[id];
  return r ? { ...r, stored: true } : { rating: seedRating(statsOf(ctx, cat.itemType, id)), votes: 0, wins: 0, stored: false };
}

// ----- tirage des duels --------------------------------------------------------------------------------------

const pick = (list, rng = Math.random) => list[Math.floor(rng() * list.length)];

/** Catégorie du jour : un genre ou une décennie où la démo a de quoi faire des duels, la même pour tous ce jour-là. */
function featured(ctx) {
  const { db } = ctx;
  const day = dayKey(Date.now()).slice(2);
  if (db.battleFeatured?.day === day && parseCategory(db.battleFeatured.value)) return db.battleFeatured.value;
  const options = [...THEME_GENRES.slice(0, 8).map((g) => `genre:${g}`), ...FEATURED_DECADES.map((d) => `decade:${d}`)]
    .filter((key) => sizeOf(ctx, parseCategory(key)) >= 3);
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const value = options.length ? options[h % options.length] : 'global:album';
  db.battleFeatured = { day, value };
  return value;
}

/** Goûts du joueur pour le mélange : genres, décennies et artistes de ses albums connus. */
function tasteOf(ctx, uid) {
  const albums = knownAlbums(ctx, uid).map((id) => ctx.ALBUM.get(id)).filter(Boolean);
  const top = (fn) => {
    const m = new Map();
    for (const a of albums) {
      const k = fn(a);
      if (k != null) m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k, c]) => ({ k, c }));
  };
  return {
    genres: top((a) => a.genre).map((x) => x.k).slice(0, 3),
    decades: top((a) => decadeOf(a.year)).map((x) => x.k).filter((d) => d >= 1950).slice(0, 3),
    artists: top((a) => a.artistId).filter((x) => x.c >= 2).map((x) => x.k).slice(0, 10),
  };
}

/** Catégorie du mélange : 50 % tes goûts, 30 % global, 20 % un artiste dont tu connais deux albums. */
function mixCategory(ctx, uid) {
  const taste = tasteOf(ctx, uid);
  const roll = Math.random();
  if (roll < MIX.taste) {
    const options = [...taste.genres.map((g) => `genre:${g}`), ...taste.decades.map((d) => `decade:${d}`)];
    if (options.length) return pick(options);
  } else if (roll >= MIX.taste + MIX.global && taste.artists.length) {
    return `artist:${pick(taste.artists)}`;
  }
  return 'global:album';
}

const votedSet = (db, uid, itemType) => new Set(db.battleVotes.filter((v) => v.userId === uid && v.itemType === itemType).map((v) => `${v.a}|${v.b}`));

/** Une paire de la catégorie pour ce joueur (mêmes règles que le serveur), ou null quand il n'en reste plus. */
function pairIn(ctx, uid, cat, taken, rng = Math.random) {
  const pool = popularPool(ctx, cat);
  const known = knownPool(ctx, uid, cat, pool);
  const all = [...new Set([...known, ...pool])];
  if (all.length < 2) return null;
  const voted = votedSet(ctx.db, uid, cat.itemType);
  const ratings = new Map(all.map((id) => [id, ratingOf(ctx, cat, id)]));
  const side = () => (known.length && rng() < KNOWN_SHARE ? pick(known, rng) : pick(all, rng));
  for (let i = 0; i < ATTEMPTS; i++) {
    const first = side();
    let others = (known.length > 1 && rng() < KNOWN_SHARE ? known : all).filter((id) => id !== first);
    if (!others.length) others = all.filter((id) => id !== first);
    if (rng() < EXPLORE_SHARE) {
      const fresh = others.filter((id) => ratings.get(id).votes < EXPLORE_VOTES);
      if (fresh.length) others = fresh;
    }
    const r1 = ratings.get(first).rating;
    const close = others.filter((id) => Math.abs(ratings.get(id).rating - r1) <= PAIR_GAP);
    const { a, b } = orderPair(first, pick(close.length ? close : others, rng));
    if (!taken.has(`${a}|${b}`) && !voted.has(`${a}|${b}`)) return [a, b];
  }
  // Petite catégorie presque épuisée : la première paire libre, s'il en reste.
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const { a, b } = orderPair(all[i], all[j]);
      if (!taken.has(`${a}|${b}`) && !voted.has(`${a}|${b}`)) return [a, b];
    }
  }
  return null;
}

const duelOf = (ctx, uid, cat, [a, b]) => ({
  token: sign(ctx.db, { u: uid, t: cat.itemType, a, b, c: cat.key, e: Date.now() + TOKEN_TTL_MS }),
  category: cat.key, itemType: cat.itemType, a, b,
});

const votesToday = (db, uid) => db.battleVotes.filter((v) => v.userId === uid && v.createdAt >= dayStart()).length;
const countedToday = (db, uid) => db.battleVotes.filter((v) => v.userId === uid && v.counted && v.createdAt >= dayStart()).length;

function requested(ctx, raw) {
  if (raw == null || raw === '' || raw === 'mix') return null;
  const cat = parseCategory(raw);
  if (!cat || cat.kind === 'event') ctx.fail(404, 'unknown_category');
  return cat;
}

function next(ctx, uid, { category, n } = {}) {
  const { db } = ctx;
  ensure(db);
  const wanted = requested(ctx, category);
  const count = Math.min(DUELS_MAX, Math.max(1, Math.floor(Number(n)) || 3));
  const feat = featured(ctx);
  const today = votesToday(db, uid);
  const taken = new Set();
  const duels = [];
  const tried = new Set();
  for (let i = 0; duels.length < count && i < count * 3; i++) {
    const key = wanted ? wanted.key : i === 0 && today < 5 ? feat : mixCategory(ctx, uid);
    const cat = parseCategory(key);
    const pair = pairIn(ctx, uid, cat, taken);
    if (!pair) {
      tried.add(key);
      if (wanted) break;
      continue;
    }
    taken.add(`${pair[0]}|${pair[1]}`);
    duels.push(duelOf(ctx, uid, cat, pair));
  }
  // Mélange épuisé : le classement global en dernier recours.
  if (!duels.length && !wanted && !tried.has('global:album')) {
    const cat = parseCategory('global:album');
    const pair = pairIn(ctx, uid, cat, taken);
    if (pair) duels.push(duelOf(ctx, uid, cat, pair));
  }
  if (!duels.length) ctx.fail(404, 'no_duel');
  const ids = duels.flatMap((d) => [d.a, d.b]);
  const counted = countedToday(db, uid);
  return {
    duels,
    featured: feat,
    today: { votes: counted, xp: Math.min(counted, XP_VOTES_PER_DAY) * XP_PER_VOTE, xpLeft: Math.max(0, XP_VOTES_PER_DAY - counted) * XP_PER_VOTE },
    catalog: duels[0].itemType === 'track' ? ctx.refs({ trackIds: ids }) : ctx.refs({ albumIds: ids }),
  };
}

// ----- vote ---------------------------------------------------------------------------------------------------

/**
 * Enregistre un vote (ou un « Je ne connais pas ») et met à jour l'Elo de chaque catégorie commune, avec l'anti-brigade
 * du serveur. Sert aux routes et aux votes des joueurs fictifs (`at` dans le passé). Renvoie { voteId, shown, categories }.
 */
function record(ctx, user, { itemType, a, b, context, winner, at = Date.now() }) {
  const { db } = ctx;
  const categories = sharedCategories(itemType, factsOf(ctx, itemType, a), factsOf(ctx, itemType, b));
  const counted = winner !== null;
  const id = db.nextBattleVoteId++;
  db.battleVotes.push({ id, userId: user.id, itemType, a, b, winner: counted ? (winner === 'a' ? a : b) : null, context, categories, counted, createdAt: at });
  if (!counted) return { voteId: id, shown: null, categories };
  const start = dayStart(at);
  const onItem = (itemId) => db.battleVotes.filter((v) => v.userId === user.id && v.counted && v.itemType === itemType && v.createdAt >= start
    && v.createdAt <= at && (v.a === itemId || v.b === itemId)).length - 1;
  const ageMs = at - (user.createdAt ?? at);
  const factorA = brigadeFactor({ votesOnItemToday: onItem(a), accountAgeMs: ageMs });
  const factorB = brigadeFactor({ votesOnItemToday: onItem(b), accountAgeMs: ageMs });
  let shown = null;
  for (const key of categories) {
    const cat = parseCategory(key);
    const ra = ratingOf(ctx, cat, a);
    const rb = ratingOf(ctx, cat, b);
    const res = eloUpdate(ra, rb, winner, { factorA, factorB });
    const store = bucket(db, cat);
    store[a] = { rating: res.ratingA, votes: ra.votes + 1, wins: ra.wins + (winner === 'a' ? 1 : 0) };
    store[b] = { rating: res.ratingB, votes: rb.votes + 1, wins: rb.wins + (winner === 'b' ? 1 : 0) };
    if (key === context) shown = { ...res, votesA: ra.votes + 1, votesB: rb.votes + 1 };
  }
  return { voteId: id, shown, categories };
}

function vote(ctx, u, { token, winner } = {}) {
  const { db } = ctx;
  ensure(db);
  if (winner !== 'a' && winner !== 'b' && winner !== null) ctx.fail(400, 'invalid_input', { field: 'winner' });
  const p = verify(db, token);
  if (!p || p.u !== u.id || !['album', 'track'].includes(p.t) || typeof p.a !== 'string' || typeof p.b !== 'string' || !(p.a < p.b)) ctx.fail(400, 'bad_token');
  if (!Number.isFinite(p.e) || p.e < Date.now()) ctx.fail(400, 'bad_token', { expired: true });
  const cat = parseCategory(p.c);
  if (!cat || cat.itemType !== p.t) ctx.fail(400, 'bad_token');
  const fa = factsOf(ctx, p.t, p.a);
  const fb = factsOf(ctx, p.t, p.b);
  if (!fa || !fb || !sharedCategories(p.t, fa, fb).includes(cat.key)) ctx.fail(400, 'bad_token');
  if (votesToday(db, u.id) >= QUOTA) ctx.fail(429, 'quota_exceeded', { kind: 'battle_votes', resetAt: dayStart() + DAY });
  if (db.battleVotes.some((v) => v.userId === u.id && v.itemType === p.t && v.a === p.a && v.b === p.b)) ctx.fail(409, 'already_voted');
  const { shown, categories } = record(ctx, u, { itemType: p.t, a: p.a, b: p.b, context: cat.key, winner });
  const todayCount = countedToday(db, u.id);
  // XP : 5 par vote, pour les 20 premiers votes comptés du jour (celui-ci compris).
  const xp = winner !== null && todayCount <= XP_VOTES_PER_DAY ? XP_PER_VOTE : 0;
  const levelUp = xp ? ctx.collection.addXp(u.id, xp, 'battle') : null;
  const base = { category: cat.key, itemType: p.t, a: p.a, b: p.b, winner, todayCount, xp, levelUp };
  if (winner === null) return { ...base, skipped: true };
  return {
    ...base,
    ratingA: Math.round(shown.ratingA), ratingB: Math.round(shown.ratingB),
    deltaA: Math.round(shown.deltaA * 10) / 10, deltaB: Math.round(shown.deltaB * 10) / 10,
    votesA: shown.votesA, votesB: shown.votesB,
    categories: categories.length,
  };
}

// ----- classements -----------------------------------------------------------------------------------------------

/** Lignes classées d'une catégorie : [{ id, rating, votes, wins }], note décroissante. */
function rankedOf(ctx, cat) {
  const store = ctx.db.battleRatings[`${cat.key}|${cat.itemType}`] || {};
  const exists = cat.itemType === 'track' ? (id) => ctx.TRACK.has(id) : (id) => ctx.ALBUM.has(id);
  return Object.entries(store).filter(([id]) => exists(id)).map(([id, r]) => ({ id, ...r }))
    .sort((x, y) => y.rating - x.rating || (x.id < y.id ? -1 : 1));
}

function ranking(ctx, key, query) {
  ensure(ctx.db);
  const cat = parseCategory(key);
  if (!cat || cat.kind === 'event') ctx.fail(404, 'unknown_category');
  const size = limitOf(query, 20);
  const offset = offsetOf(query.get('cursor'), ctx);
  const all = rankedOf(ctx, cat);
  const rows = all.slice(offset, offset + size + 1);
  const page = rows.slice(0, size);
  const nextOffset = offset + page.length;
  const items = page.map((r, i) => ({
    rank: offset + i + 1, id: r.id, rating: Math.round(r.rating), votes: r.votes, wins: r.wins, provisional: isProvisional(r.votes),
  }));
  const ids = items.map((x) => x.id);
  const extra = cat.kind === 'artist' || cat.kind === 'artist_tracks' ? [cat.value] : [];
  return {
    category: cat.key, kind: cat.kind, itemType: cat.itemType, items,
    nextCursor: rows.length > size && nextOffset < RANKING_CAP ? encodeCursor([nextOffset]) : null,
    total: all.length,
    listed: isListed(all.length, sizeOf(ctx, cat)),
    catalog: cat.itemType === 'track'
      ? ctx.refs({ trackIds: ids, albumIds: cat.kind === 'album_tracks' ? [cat.value] : [], artistIds: extra })
      : ctx.refs({ albumIds: ids, artistIds: extra }),
  };
}

/** Hub : catégories listées par rubrique (les plus votées d'abord), avec leur podium. */
function hub(ctx) {
  const { db } = ctx;
  ensure(db);
  const byKind = new Map(HUB_GROUPS.map((k) => [k, []]));
  const rows = Object.keys(db.battleRatings).map((k) => {
    const [category, itemType] = k.split('|');
    const cat = parseCategory(category);
    if (!cat || cat.itemType !== itemType) return null;
    const ranked = rankedOf(ctx, cat);
    return { cat, ranked, votes: ranked.reduce((s, r) => s + r.votes, 0) };
  }).filter(Boolean).sort((x, y) => y.votes - x.votes || (x.cat.key < y.cat.key ? -1 : 1));
  for (const { cat, ranked, votes } of rows) {
    const list = byKind.get(cat.kind);
    if (!list || list.length >= HUB_PER_GROUP || !isListed(ranked.length, sizeOf(ctx, cat))) continue;
    list.push({ key: cat.key, kind: cat.kind, itemType: cat.itemType, items: ranked.length, votes: Math.round(votes / 2), top: ranked.slice(0, 3).map((r) => r.id) });
  }
  const categories = HUB_GROUPS.flatMap((k) => byKind.get(k));
  return {
    categories,
    featured: featured(ctx),
    catalog: ctx.refs({ albumIds: categories.flatMap((c) => c.top), artistIds: categories.filter((c) => c.kind === 'artist').map((c) => parseCategory(c.key).value) }),
  };
}

/** « Autour de l'album » : jusqu'à 5 catégories où l'élément est classé, et la catégorie où l'envoyer voter. */
function itemRankings(ctx, itemType, id) {
  ensure(ctx.db);
  if (itemType !== 'album' && itemType !== 'track') ctx.fail(404, 'not_found');
  const facts = factsOf(ctx, itemType, id);
  if (!facts) ctx.fail(404, 'not_found');
  const keys = itemType === 'track' ? trackCategories(facts) : albumCategories(facts);
  const items = [];
  for (const key of keys) {
    const cat = parseCategory(key);
    const ranked = rankedOf(ctx, cat);
    const mine = ranked.find((r) => r.id === id);
    if (!mine || ranked.length < 2) continue;
    items.push({
      category: key, kind: cat.kind, rank: ranked.filter((r) => r.rating > mine.rating).length + 1, total: ranked.length,
      rating: Math.round(mine.rating), votes: mine.votes, provisional: isProvisional(mine.votes), listed: isListed(ranked.length, sizeOf(ctx, cat)),
    });
  }
  items.sort((x, y) => x.rank / x.total - y.rank / y.total || ITEM_PREF.indexOf(x.kind) - ITEM_PREF.indexOf(y.kind));
  let voteKey;
  if (itemType === 'track') voteKey = `album_tracks:${facts.albumId}`;
  else {
    const albums = [...ctx.ALBUM.values()].filter((a) => a.artistId === facts.artistId).length;
    const decade = decadeOf(facts.year);
    voteKey = albums >= 2 ? `artist:${facts.artistId}` : facts.genre && decade != null ? `genre_decade:${facts.genre}:${decade}` : 'global:album';
  }
  return {
    itemType, id, items: items.slice(0, 5), vote: voteKey,
    catalog: ctx.refs(itemType === 'track' ? { trackIds: [id] } : { albumIds: [id], artistIds: [facts.artistId] }),
  };
}

// ----- votes des joueurs fictifs ---------------------------------------------------------------------------------

/**
 * Votes des joueurs fictifs sur les 14 derniers jours (≈ 150 chacun, dont des duels de morceaux de Discovery, Thriller
 * et Abbey Road) : leurs préférences suivent la popularité des albums et leur genre favori, avec du hasard. Les albums
 * populaires reviennent plus souvent : une partie du classement dépasse 50 votes, le reste reste « provisoire ».
 */
function seedVotes(ctx) {
  const { db } = ctx;
  ensure(db);
  if (db.battleVotes.length) return;
  const bots = db.users.filter((u) => u.bot);
  if (!bots.length) return;
  const albums = [...ctx.ALBUM.keys()];
  const quality = new Map(albums.map((id) => [id, albumPop(ctx, id) + (statsOf(ctx, 'album', id).count ? 6 : 0)]));
  const now = Date.now();
  const plan = [
    { votes: 120 },
    { albumId: 'discovery', votes: 14 },
    { albumId: 'thriller', votes: 10 },
    { albumId: 'abbey-road', votes: 8 },
  ].filter((p) => !p.albumId || ctx.ALBUM.has(p.albumId));
  // Plus un album est populaire, plus il revient dans les duels.
  const weighted = albums.flatMap((id) => Array(Math.max(1, Math.round((quality.get(id) - 40) / 8))).fill(id));
  bots.forEach((bot, bi) => {
    const rng = seededRandom(hash32(`battles|${bot.username}`));
    const favourite = THEME_GENRES[(bi * 3) % 6];
    const seen = new Set();
    const step = (14 * DAY - 2 * HOUR) / 160;
    let at = now - 14 * DAY + bi * HOUR;
    for (const p of plan) {
      const itemType = p.albumId ? 'track' : 'album';
      const ids = p.albumId ? ctx.staticCatalog.albumTrackIds(p.albumId) : weighted;
      for (let v = 0, guard = 0; v < p.votes && guard < p.votes * 20; guard++) {
        const x = pick(ids, rng);
        const y = pick(ids, rng);
        if (!x || !y || x === y) continue;
        const { a, b } = orderPair(x, y);
        if (seen.has(`${itemType}|${a}|${b}`)) continue;
        seen.add(`${itemType}|${a}|${b}`);
        const shared = sharedCategories(itemType, factsOf(ctx, itemType, a), factsOf(ctx, itemType, b));
        // Le duel vient d'une catégorie qu'ils partagent (artiste, genre, décennie…) ou du global.
        const context = itemType === 'track' ? shared[0] : pick(shared.filter((c) => c !== 'global:album'), rng) || 'global:album';
        const score = (id) => (itemType === 'track'
          ? (ctx.TRACK.get(id)?.pop || 0) / 4
          : quality.get(id) / 4 + (ctx.ALBUM.get(id)?.genre === favourite ? 3 : 0));
        const pa = 1 / (1 + 10 ** ((score(b) - score(a)) / 6));
        // Un « Je ne connais pas » de temps en temps : la paire est gardée, rien ne change.
        const winner = rng() < 0.06 ? null : rng() < pa ? 'a' : 'b';
        at = Math.min(now - HOUR, at + step * (0.5 + rng()));
        record(ctx, bot, { itemType, a, b, context, winner, at: Math.round(at) });
        v += 1;
      }
    }
  });
}

// ----- routes ------------------------------------------------------------------------------------------------------

export const routes = [
  ['GET', /^\/battles\/next$/, ({ query, ctx }) => {
    const u = ctx.me();
    return next(ctx, u.id, { category: query.get('category'), n: query.get('n') });
  }],
  ['POST', /^\/battles\/vote$/, ({ body, ctx }) => {
    const u = ctx.me();
    const since = Date.now();
    const result = vote(ctx, u, { token: body.token, winner: body.winner });
    // Le duel suivant de la même file (catégorie demandée ou mélange), pour l'enchaîner sans attendre.
    let following = null;
    try {
      following = next(ctx, u.id, { category: body.category, n: 1 });
    } catch (err) {
      if (!err?.code) throw err;
    }
    const badgesEarned = evaluateBadges(ctx, u.id, { since });
    return { ...result, next: following, badgesEarned, ...(result.xp || badgesEarned.length ? { state: ctx.partialState() } : {}) };
  }],
  ['GET', /^\/rankings$/, ({ ctx }) => {
    ctx.me();
    return hub(ctx);
  }],
  ['GET', /^\/rankings\/([^/]+)$/, ({ params, query, ctx }) => {
    ctx.me();
    return ranking(ctx, decode(params[0]), query);
  }],
  ['GET', /^\/items\/([^/]+)\/([^/]+)\/rankings$/, ({ params, ctx }) => {
    ctx.me();
    return itemRankings(ctx, decode(params[0]), decode(params[1]));
  }],
];

export function seed(db, ctx) {
  ensure(db);
  seedVotes(ctx);
}

export function migrate(db, ctx) {
  ensure(db);
  // Sauvegarde d'avant les battles : les joueurs fictifs votent une fois.
  seedVotes(ctx);
}
