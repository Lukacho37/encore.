// Faux serveur pour la démo autonome : reproduit l'API du vrai serveur dans le navigateur.
// Les données restent dans le localStorage du visiteur. Utilisé uniquement par `npm run build:demo`.
import { ApiError } from '../api.js';
import { storage } from '../storage.js';
import {
  TRACKS, TRACK_BY_ID, TRACKS_BY_ALBUM, ALBUM_BY_ID, ARTIST_BY_ID, GENRES,
} from '@shared/catalog.js';
import {
  rollPack, newAchievements, xpForCard, recycleValue, pressCost, levelFromXp, collectionStats,
  ECONOMY, BLINDTEST, SHOWCASE_SLOTS, AVATAR_COLORS, packOdds, PACK_SLOTS,
  buildBlindtest, blindtestClues, blindtestPoints, blindtestReward, blindtestPool,
  validateEmail, validatePassword, validateUsername,
} from '@shared/rules.js';

const KEY = 'albummania.demo.v1';
const REGEN_MS = 30 * 60_000;
const MAX_STOCK = 5;

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

function fresh() {
  const now = Date.now();
  const data = { nextId: 1, users: [], cards: {}, achievements: {}, friendships: [], tokens: [], games: {}, session: null };
  // Quelques joueurs fictifs pour tester les amis.
  const bots = [
    { username: 'lea.beats', packs: 60, color: '#3fd6c4' },
    { username: 'maxvinyl', packs: 140, color: '#ffd35a' },
    { username: 'soulcollector', packs: 30, color: '#b17dff' },
    { username: 'k.dot_fan', packs: 90, color: '#ff8b3d' },
  ];
  for (const [i, b] of bots.entries()) {
    const id = data.nextId++;
    data.users.push({
      id, email: `${b.username}@demo.albummania`, username: b.username, password: hash('demo-bot'), verified: now - 86_400_000 * (30 + i * 9),
      role: 'player', lang: 'fr', avatar: 'initials', avatarColor: b.color, royalties: 500, xp: 0, packs: 0, packsAt: now, bonusPacks: 0,
      showcase: [], createdAt: now - 86_400_000 * (30 + i * 9), bot: true,
    });
    const rng = seededRng(1234 + i * 77);
    const user = data.users[data.users.length - 1];
    const cards = (data.cards[id] = {});
    for (let p = 0; p < b.packs; p++) {
      for (const c of rollPack(rng)) {
        const k = `${c.trackId}|${c.variant}`;
        cards[k] = { count: (cards[k]?.count || 0) + 1, at: now - p * 3_600_000 };
        user.xp += 8;
      }
    }
    const owned = new Set(Object.keys(cards).map((k) => k.split('|')[0]));
    data.achievements[id] = {};
    for (const a of newAchievements(owned, new Set(), [...owned])) data.achievements[id][a.key] = now;
    const best = [...owned].sort((x, y) => (TRACK_BY_ID[y].rarity === 'legendary') - (TRACK_BY_ID[x].rarity === 'legendary')).slice(0, 4);
    user.showcase = [...best, null, null];
    const firstDone = Object.keys(data.achievements[id]).find((k) => k.startsWith('album:'));
    if (firstDone) user.avatar = firstDone;
  }
  return data;
}

function load() {
  if (db) return;
  try {
    db = JSON.parse(storage.get(KEY) || 'null');
  } catch {
    db = null;
  }
  if (!db || !db.users) db = fresh();
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

function state() {
  const u = me();
  syncPacks(u);
  botsRespond(u);
  const admin = u.role === 'admin';
  return {
    user: {
      id: u.id, username: u.username, email: u.email, role: u.role, lang: u.lang, avatar: u.avatar, avatarColor: u.avatarColor,
      royalties: u.royalties, level: levelFromXp(u.xp), showcase: u.showcase, createdAt: u.createdAt,
    },
    packs: {
      regen: u.packs, bonus: u.bonusPacks, available: u.packs + u.bonusPacks, max: MAX_STOCK, intervalMs: REGEN_MS,
      nextAt: u.packs < MAX_STOCK ? u.packsAt + REGEN_MS : null, unlimited: admin,
    },
    cards: Object.entries(cardsOf(u.id)).map(([k, v]) => {
      const [t, variant] = k.split('|');
      return { t, v: variant, c: v.count, at: v.at };
    }),
    achievements: Object.entries(achOf(u.id)).map(([key, at]) => ({ key, at })),
    pendingFriends: db.friendships.filter((f) => f.addressee === u.id && f.status === 'pending').length,
    serverTime: Date.now(),
  };
}

function addCards(u, cards) {
  const now = Date.now();
  const mine = cardsOf(u.id);
  const before = ownedSet(u.id);
  const owned = new Set(before);
  let xp = 0;
  const results = cards.map(({ trackId, variant }) => {
    const k = `${trackId}|${variant}`;
    const newTrack = !owned.has(trackId);
    const newVariant = !mine[k];
    mine[k] = { count: (mine[k]?.count || 0) + 1, at: mine[k]?.at || now };
    owned.add(trackId);
    xp += xpForCard(trackId, newTrack);
    return { trackId, variant, newTrack, newVariant };
  });
  const ach = achOf(u.id);
  const achievements = newAchievements(owned, new Set(Object.keys(ach)), cards.map((c) => c.trackId));
  let royalties = 0;
  for (const a of achievements) {
    ach[a.key] = now;
    royalties += a.royalties;
    xp += a.xp;
  }
  u.xp += xp;
  u.royalties += royalties;
  const albumIds = [...new Set(cards.map((c) => TRACK_BY_ID[c.trackId].albumId).filter(Boolean))];
  const albumDeltas = albumIds.map((albumId) => {
    const list = TRACKS_BY_ALBUM[albumId];
    return { albumId, before: list.filter((t) => before.has(t.id)).length, after: list.filter((t) => owned.has(t.id)).length, total: list.length };
  }).filter((d) => d.after > d.before);
  return { cards: results, xp, royalties, achievements, albumDeltas };
}

function summary(u) {
  return { id: u.id, username: u.username, avatar: u.avatar, avatarColor: u.avatarColor, level: levelFromXp(u.xp).level, unique: ownedSet(u.id).size, total: TRACKS.length };
}

function between(a, b) {
  return db.friendships.find((f) => (f.requester === a && f.addressee === b) || (f.requester === b && f.addressee === a));
}

function friendsOf(uid) {
  const out = { friends: [], incoming: [], outgoing: [] };
  for (const f of [...db.friendships].sort((a, b) => b.createdAt - a.createdAt)) {
    if (f.requester !== uid && f.addressee !== uid) continue;
    const other = userById(f.requester === uid ? f.addressee : f.requester);
    const entry = { requestId: f.id, since: f.respondedAt || f.createdAt, user: summary(other) };
    if (f.status === 'accepted') out.friends.push(entry);
    else if (f.addressee === uid) out.incoming.push(entry);
    else out.outgoing.push(entry);
  }
  return out;
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

const dayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const rewardedToday = (uid) => Object.values(db.games).filter((g) => g.userId === uid && g.rewarded && g.createdAt >= dayStart()).length;

function roundPayload(questions, index) {
  const q = questions[index];
  return {
    index, rounds: questions.length,
    choices: q.choices.map((id) => ({ id, title: TRACK_BY_ID[id].title, artist: ARTIST_BY_ID[TRACK_BY_ID[id].artistId].name })),
    audio: null, clues: blindtestClues(q.answer), seconds: BLINDTEST.roundSeconds,
  };
}

function requireAdmin() {
  const u = me();
  if (u.role !== 'admin') fail(403, 'forbidden');
  return u;
}

// ---------- routes ----------

const routes = [
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
    if (db.users.some((u) => u.email === email)) fail(409, 'email_taken');
    if (userByName(username)) fail(409, 'username_taken');
    const now = Date.now();
    const first = !db.users.some((u) => !u.bot);
    const u = {
      id: db.nextId++, email, username, password: hash(body.password), verified: null, role: first ? 'admin' : 'player',
      lang: body.lang === 'en' ? 'en' : 'fr', avatar: 'initials', avatarColor: AVATAR_COLORS[Math.floor(rand() * AVATAR_COLORS.length)],
      royalties: ECONOMY.welcomeRoyalties, xp: 0, packs: 0, packsAt: now, bonusPacks: ECONOMY.welcomePacks, showcase: [], createdAt: now,
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

  ['GET', /^\/state$/, () => state()],
  ['POST', /^\/packs\/open$/, ({ body }) => {
    const u = me();
    syncPacks(u);
    const admin = u.role === 'admin';
    const n = Math.floor(Number(body.count) || 1);
    if (n < 1 || n > (admin ? 50 : 1)) fail(400, 'invalid_count');
    if (!admin) {
      if (u.packs + u.bonusPacks < 1) fail(409, 'no_packs');
      if (u.packs > 0) {
        if (u.packs >= MAX_STOCK) u.packsAt = Date.now();
        u.packs -= 1;
      } else u.bonusPacks -= 1;
    }
    const packs = Array.from({ length: n }, () => rollPack(rand));
    return { packs: packs.map((p) => p.length), ...addCards(u, packs.flat()), state: state() };
  }],
  ['POST', /^\/shop\/buy-pack$/, () => {
    const u = me();
    if (u.royalties < ECONOMY.packPrice) fail(409, 'not_enough_royalties');
    u.royalties -= ECONOMY.packPrice;
    u.bonusPacks += 1;
    return { spent: ECONOMY.packPrice, state: state() };
  }],
  ['POST', /^\/collection\/recycle$/, () => {
    const u = me();
    let royalties = 0;
    let recycled = 0;
    for (const [k, v] of Object.entries(cardsOf(u.id))) {
      if (v.count > 1) {
        const [t, variant] = k.split('|');
        royalties += recycleValue(t, variant) * (v.count - 1);
        recycled += v.count - 1;
        v.count = 1;
      }
    }
    u.royalties += royalties;
    return { royalties, recycled, state: state() };
  }],
  ['POST', /^\/collection\/press$/, ({ body }) => {
    const u = me();
    const track = TRACK_BY_ID[body.trackId];
    if (!track) fail(404, 'unknown_track');
    const cost = pressCost(track.id);
    if (cost == null) fail(400, 'not_pressable');
    if (ownedSet(u.id).has(track.id)) fail(409, 'already_owned');
    if (u.royalties < cost) fail(409, 'not_enough_royalties');
    u.royalties -= cost;
    return { spent: cost, ...addCards(u, [{ trackId: track.id, variant: 'std' }]), state: state() };
  }],
  ['POST', /^\/profile\/avatar$/, ({ body }) => {
    const u = me();
    if (body.color !== undefined && !AVATAR_COLORS.includes(body.color)) fail(400, 'invalid_color');
    if (body.avatar !== undefined && body.avatar !== 'initials') {
      const m = /^album:(.+)$/.exec(String(body.avatar));
      if (!m || !ALBUM_BY_ID[m[1]]) fail(400, 'invalid_avatar');
      if (!achOf(u.id)[`album:${m[1]}`]) fail(403, 'avatar_locked');
    }
    u.avatar = body.avatar ?? u.avatar;
    u.avatarColor = body.color ?? u.avatarColor;
    return { state: state() };
  }],
  ['POST', /^\/profile\/showcase$/, ({ body }) => {
    const u = me();
    if (!Array.isArray(body.slots) || body.slots.length > SHOWCASE_SLOTS) fail(400, 'invalid_showcase');
    const owned = ownedSet(u.id);
    const clean = body.slots.map((id) => (id && owned.has(id) ? id : null));
    while (clean.length < SHOWCASE_SLOTS) clean.push(null);
    u.showcase = clean;
    return { state: state() };
  }],
  ['POST', /^\/profile\/lang$/, ({ body }) => {
    me().lang = body.lang === 'en' ? 'en' : 'fr';
    return { ok: true };
  }],
  ['GET', /^\/users\/([^/]+)$/, ({ params }) => {
    const viewer = me();
    const target = userByName(decodeURIComponent(params[0]));
    if (!target || !target.verified) fail(404, 'user_not_found');
    const owned = ownedSet(target.id);
    const holo = new Set(Object.keys(cardsOf(target.id)).filter((k) => k.endsWith('|holo')).map((k) => k.split('|')[0]));
    const stats = collectionStats(owned);
    const ach = Object.keys(achOf(target.id));
    let friendship = 'none';
    let requestId = null;
    if (target.id === viewer.id) friendship = 'self';
    else {
      const f = between(viewer.id, target.id);
      if (f) {
        requestId = f.id;
        friendship = f.status === 'accepted' ? 'friends' : f.requester === viewer.id ? 'outgoing' : 'incoming';
      }
    }
    return {
      id: target.id, username: target.username, avatar: target.avatar, avatarColor: target.avatarColor, level: levelFromXp(target.xp),
      createdAt: target.createdAt, role: target.role,
      stats: { unique: stats.total.owned, total: stats.total.total, albumsCompleted: stats.albumsCompleted, artistsMastered: stats.artistsMastered, promos: stats.promos.owned, promosTotal: stats.promos.total },
      showcase: Array.from({ length: SHOWCASE_SLOTS }, (_, i) => {
        const id = target.showcase[i];
        return id && owned.has(id) ? { trackId: id, variant: holo.has(id) ? 'holo' : 'std' } : null;
      }),
      completedAlbums: ach.filter((k) => k.startsWith('album:')).map((k) => k.slice(6)),
      masteredArtists: ach.filter((k) => k.startsWith('artist:')).map((k) => k.slice(7)),
      albumProgress: stats.albums, friendship, requestId,
    };
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
    if (f) {
      if (f.status === 'accepted') fail(409, 'already_friends');
      if (f.requester === u.id) fail(409, 'already_requested');
      f.status = 'accepted';
      f.respondedAt = Date.now();
      return { status: 'accepted', username: target.username };
    }
    db.friendships.push({ id: db.nextId++, requester: u.id, addressee: target.id, status: 'pending', createdAt: Date.now() });
    return { status: 'pending', username: target.username };
  }],
  ['POST', /^\/friends\/(\d+)\/(accept|decline)$/, ({ params }) => {
    const u = me();
    const f = db.friendships.find((x) => x.id === Number(params[0]));
    if (!f || f.status !== 'pending') fail(404, 'request_not_found');
    if (params[1] === 'accept') {
      if (f.addressee !== u.id) fail(403, 'forbidden');
      f.status = 'accepted';
      f.respondedAt = Date.now();
    } else {
      if (f.addressee !== u.id && f.requester !== u.id) fail(403, 'forbidden');
      db.friendships = db.friendships.filter((x) => x !== f);
    }
    return friendsOf(u.id);
  }],
  ['DELETE', /^\/friends\/(\d+)$/, ({ params }) => {
    const u = me();
    const f = between(u.id, Number(params[0]));
    if (!f || f.status !== 'accepted') fail(404, 'not_friends');
    db.friendships = db.friendships.filter((x) => x !== f);
    return friendsOf(u.id);
  }],

  ['GET', /^\/blindtest$/, () => {
    const u = me();
    return {
      genres: ['all', ...GENRES].map((id) => ({ id, count: blindtestPool(id).length })),
      rewardedToday: rewardedToday(u.id), rewardedLimit: u.role === 'admin' ? null : BLINDTEST.rewardedGamesPerDay,
      rounds: BLINDTEST.rounds, roundSeconds: BLINDTEST.roundSeconds, rewards: BLINDTEST.rewards, audio: false,
    };
  }],
  ['POST', /^\/blindtest\/start$/, ({ body }) => {
    const u = me();
    const genre = body.genre;
    if (genre !== 'all' && !GENRES.includes(genre)) fail(400, 'invalid_genre');
    const rewarded = u.role === 'admin' || rewardedToday(u.id) < BLINDTEST.rewardedGamesPerDay;
    const questions = buildBlindtest(genre, rand);
    questions[0].startedAt = Date.now();
    const id = token();
    db.games[id] = { id, userId: u.id, questions, current: 0, score: 0, correct: 0, rewarded, createdAt: Date.now() };
    return { gameId: id, rewarded, round: roundPayload(questions, 0) };
  }],
  ['POST', /^\/blindtest\/([^/]+)\/answer$/, ({ params, body }) => {
    const u = me();
    const g = db.games[params[0]];
    if (!g || g.userId !== u.id) fail(404, 'game_not_found');
    if (g.finishedAt) fail(409, 'game_finished');
    const q = g.questions[g.current];
    if (q.picked !== undefined) fail(409, 'round_not_active');
    const elapsed = Date.now() - q.startedAt;
    const correct = elapsed <= (BLINDTEST.roundSeconds + 2) * 1000 && body.choice === q.answer;
    const points = blindtestPoints(correct, elapsed);
    q.picked = body.choice ?? null;
    g.score += points;
    if (correct) g.correct += 1;
    let final = null;
    if (g.current === g.questions.length - 1) {
      const rewardPacks = g.rewarded ? blindtestReward(g.correct) : 0;
      u.bonusPacks += rewardPacks;
      u.xp += g.correct * 10;
      g.finishedAt = Date.now();
      final = { score: g.score, correct: g.correct, rounds: g.questions.length, rewardPacks, rewarded: g.rewarded, xp: g.correct * 10 };
    }
    const result = { correct, answer: q.answer, picked: q.picked, points, score: g.score };
    return final ? { result, final, state: state() } : { result, final };
  }],
  ['POST', /^\/blindtest\/([^/]+)\/next$/, ({ params }) => {
    const u = me();
    const g = db.games[params[0]];
    if (!g || g.userId !== u.id) fail(404, 'game_not_found');
    if (g.finishedAt) fail(409, 'game_finished');
    g.current += 1;
    g.questions[g.current].startedAt = Date.now();
    return { round: roundPayload(g.questions, g.current) };
  }],

  ['GET', /^\/admin\/overview$/, () => {
    requireAdmin();
    const users = db.users.map((u) => ({
      id: u.id, username: u.username, email: u.email, role: u.role, verified: !!u.verified, unique: ownedSet(u.id).size,
      openings: 0, royalties: u.royalties, packs: u.packs + u.bonusPacks, level: levelFromXp(u.xp).level, createdAt: u.createdAt, lastSeenAt: null,
    }));
    return {
      users,
      totals: { users: users.length, verified: users.filter((u) => u.verified).length, openings: 0, cards: Object.values(db.cards).reduce((s, c) => s + Object.values(c).reduce((a, v) => a + v.count, 0), 0) },
      odds: packOdds(), slots: PACK_SLOTS, config: { packRegenMinutes: 30, packMaxStock: MAX_STOCK, blindtestAudio: 'off (démo)' },
    };
  }],
  ['POST', /^\/admin\/users\/(\d+)\/grant$/, ({ params, body }) => {
    requireAdmin();
    const t = userById(Number(params[0]));
    if (!t) fail(404, 'user_not_found');
    t.bonusPacks += Math.max(0, Math.floor(Number(body.packs) || 0));
    t.royalties += Math.max(0, Math.floor(Number(body.royalties) || 0));
    return { ok: true };
  }],
  ['POST', /^\/admin\/users\/(\d+)\/role$/, ({ params, body }) => {
    const admin = requireAdmin();
    const t = userById(Number(params[0]));
    if (!t) fail(404, 'user_not_found');
    if (t.id === admin.id && body.role !== 'admin') fail(400, 'cannot_demote_self');
    t.role = body.role === 'admin' ? 'admin' : 'player';
    return { ok: true };
  }],
  ['POST', /^\/admin\/me\/reset$/, () => {
    const u = requireAdmin();
    db.cards[u.id] = {};
    db.achievements[u.id] = {};
    u.xp = 0;
    u.avatar = 'initials';
    u.showcase = [];
    return { state: state() };
  }],
  ['POST', /^\/admin\/me\/complete$/, () => {
    const u = requireAdmin();
    const mine = cardsOf(u.id);
    const now = Date.now();
    for (const t of TRACKS) if (!mine[`${t.id}|std`] && !mine[`${t.id}|holo`]) mine[`${t.id}|std`] = { count: 1, at: now };
    const ach = achOf(u.id);
    for (const a of Object.keys(ALBUM_BY_ID)) ach[`album:${a}`] ||= now;
    for (const a of Object.keys(ARTIST_BY_ID)) ach[`artist:${a}`] ||= now;
    return { state: state() };
  }],
  ['POST', /^\/admin\/me\/almost$/, ({ body }) => {
    const u = requireAdmin();
    const list = TRACKS_BY_ALBUM[body.albumId];
    if (!list) fail(404, 'unknown_album');
    const missing = list[Math.floor(rand() * list.length)];
    const mine = cardsOf(u.id);
    for (const t of list) if (t.id !== missing.id && !mine[`${t.id}|std`] && !mine[`${t.id}|holo`]) mine[`${t.id}|std`] = { count: 1, at: Date.now() };
    delete mine[`${missing.id}|std`];
    delete mine[`${missing.id}|holo`];
    delete achOf(u.id)[`album:${body.albumId}`];
    delete achOf(u.id)[`artist:${missing.artistId}`];
    return { missing: missing.id, state: state() };
  }],
];

export async function handle(method, path, body = {}) {
  load();
  await new Promise((r) => setTimeout(r, 90 + Math.random() * 110));
  const [pathname, qs] = path.split('?');
  for (const [m, re, fn] of routes) {
    if (m !== method) continue;
    const match = re.exec(pathname);
    if (!match) continue;
    const result = fn({ params: match.slice(1), body: body || {}, query: new URLSearchParams(qs || '') });
    save();
    return JSON.parse(JSON.stringify(result));
  }
  throw new ApiError(404, 'not_found');
}
