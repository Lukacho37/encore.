// Logique métier du jeu côté serveur (comptes, boosters, collection, amis, blind test, admin).
import { config } from './config.js';
import { tx } from './db.js';
import { newId, secureRandom } from './security.js';
import {
  TRACK_BY_ID, TRACKS, TRACKS_BY_ALBUM, ALBUM_BY_ID, ARTIST_BY_ID, GENRES,
} from '../shared/catalog.js';
import {
  rollPack, newAchievements, xpForCard, recycleValue, pressCost, levelFromXp, collectionStats,
  ECONOMY, BLINDTEST, SHOWCASE_SLOTS, AVATAR_COLORS, packOdds, PACK_SLOTS,
  buildBlindtest, blindtestClues, blindtestPoints, blindtestReward, blindtestPool,
} from '../shared/rules.js';

export class HttpError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const INTERVAL = () => config.packRegenMinutes * 60_000;

export function createServices(db) {
  const q = (sql) => db.prepare(sql);

  // ----- utilisateurs -------------------------------------------------------

  const getUser = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
  /** Seules les adresses de ADMIN_EMAILS (vérifiées) sont admin. La colonne `role` n'est plus utilisée. */
  const isAdmin = (u) => !!u?.email_verified_at && config.adminEmails.includes(String(u.email).toLowerCase());
  const roleOf = (u) => (isAdmin(u) ? 'admin' : 'player');

  function ownedSet(userId) {
    return new Set(q('SELECT DISTINCT track_id FROM cards WHERE user_id = ?').all(userId).map((r) => r.track_id));
  }
  function achievementSet(userId) {
    return new Set(q('SELECT key FROM achievements WHERE user_id = ?').all(userId).map((r) => r.key));
  }

  /** Recalcule les boosters régénérés depuis la dernière visite. */
  function syncPacks(user, now = Date.now()) {
    const max = config.packMaxStock;
    let { packs, packs_at: at } = user;
    if (packs >= max) {
      at = now;
    } else {
      const gained = Math.floor((now - at) / INTERVAL());
      if (gained > 0) {
        packs = Math.min(max, packs + gained);
        at = packs >= max ? now : at + gained * INTERVAL();
      }
    }
    if (packs !== user.packs || at !== user.packs_at) {
      q('UPDATE users SET packs = ?, packs_at = ? WHERE id = ?').run(packs, at, user.id);
      user.packs = packs;
      user.packs_at = at;
    }
    return user;
  }

  function packInfo(user) {
    const max = config.packMaxStock;
    return {
      regen: user.packs,
      bonus: user.bonus_packs,
      available: user.packs + user.bonus_packs,
      max,
      intervalMs: INTERVAL(),
      nextAt: user.packs < max ? user.packs_at + INTERVAL() : null,
      unlimited: isAdmin(user),
    };
  }

  function selfPayload(user) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: roleOf(user),
      lang: user.lang,
      ratingScale: user.rating_scale || 'stars',
      avatar: user.avatar,
      avatarColor: user.avatar_color,
      royalties: user.royalties,
      level: levelFromXp(user.xp),
      showcase: JSON.parse(user.showcase),
      createdAt: user.created_at,
    };
  }

  /** État complet du joueur connecté, utilisé pour hydrater le client. */
  function state(userId) {
    const user = syncPacks(getUser(userId));
    q('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Date.now(), userId);
    const cards = q('SELECT track_id, variant, count, first_at FROM cards WHERE user_id = ?').all(userId)
      .map((r) => ({ t: r.track_id, v: r.variant, c: r.count, at: r.first_at }));
    const achievements = q('SELECT key, created_at FROM achievements WHERE user_id = ?').all(userId)
      .map((r) => ({ key: r.key, at: r.created_at }));
    const pendingFriends = q("SELECT COUNT(*) AS n FROM friendships WHERE addressee_id = ? AND status = 'pending'").get(userId).n;
    const ratings = q('SELECT item_type, item_id, score FROM ratings WHERE user_id = ?').all(userId)
      .map((r) => ({ t: r.item_type, i: r.item_id, s: r.score }));
    return { user: selfPayload(user), packs: packInfo(user), cards, achievements, ratings, pendingFriends, serverTime: Date.now() };
  }

  // ----- cartes ---------------------------------------------------------------

  /**
   * Ajoute des cartes à la collection, attribue XP, succès et récompenses.
   * À appeler à l'intérieur d'une transaction.
   */
  function addCards(user, cards, source) {
    const now = Date.now();
    const before = ownedSet(user.id);
    const variantsBefore = new Set(
      q('SELECT track_id || \'|\' || variant AS k FROM cards WHERE user_id = ?').all(user.id).map((r) => r.k),
    );
    const owned = new Set(before);
    const seenVariants = new Set(variantsBefore);
    const upsert = q(`INSERT INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT (user_id, track_id, variant) DO UPDATE SET count = count + 1`);
    let xp = 0;
    const results = cards.map(({ trackId, variant }) => {
      const newTrack = !owned.has(trackId);
      const newVariant = !seenVariants.has(`${trackId}|${variant}`);
      upsert.run(user.id, trackId, variant, now);
      owned.add(trackId);
      seenVariants.add(`${trackId}|${variant}`);
      xp += xpForCard(trackId, newTrack);
      return { trackId, variant, newTrack, newVariant };
    });

    const achievements = newAchievements(owned, achievementSet(user.id), cards.map((c) => c.trackId));
    let royalties = 0;
    const insertAch = q('INSERT OR IGNORE INTO achievements (user_id, key, created_at) VALUES (?, ?, ?)');
    for (const a of achievements) {
      insertAch.run(user.id, a.key, now);
      royalties += a.royalties;
      xp += a.xp;
    }
    q('UPDATE users SET xp = xp + ?, royalties = royalties + ? WHERE id = ?').run(xp, royalties, user.id);
    q('INSERT INTO pack_openings (user_id, source, cards, created_at) VALUES (?, ?, ?, ?)').run(
      user.id, source, JSON.stringify(cards), now,
    );

    const albumIds = [...new Set(cards.map((c) => TRACK_BY_ID[c.trackId].albumId).filter(Boolean))];
    const albumDeltas = albumIds.map((albumId) => {
      const list = TRACKS_BY_ALBUM[albumId];
      return {
        albumId,
        before: list.filter((t) => before.has(t.id)).length,
        after: list.filter((t) => owned.has(t.id)).length,
        total: list.length,
      };
    }).filter((d) => d.after > d.before);

    return { cards: results, xp, royalties, achievements, albumDeltas };
  }

  function openPacks(userId, count = 1) {
    return tx(db, () => {
      const user = syncPacks(getUser(userId));
      const admin = isAdmin(user);
      const n = Math.floor(Number(count) || 1);
      if (n < 1 || n > (admin ? 50 : 1)) throw new HttpError(400, 'invalid_count');
      if (!admin) {
        if (user.packs + user.bonus_packs < 1) throw new HttpError(409, 'no_packs');
        if (user.packs > 0) {
          // Si le stock était plein, le minuteur redémarre maintenant.
          const at = user.packs >= config.packMaxStock ? Date.now() : user.packs_at;
          q('UPDATE users SET packs = packs - 1, packs_at = ? WHERE id = ?').run(at, user.id);
        } else {
          q('UPDATE users SET bonus_packs = bonus_packs - 1 WHERE id = ?').run(user.id);
        }
      }
      const packs = Array.from({ length: n }, () => rollPack(secureRandom));
      const result = addCards(user, packs.flat(), admin ? 'admin-pack' : 'pack');
      return { packs: packs.map((p) => p.length), ...result };
    });
  }

  function buyPack(userId) {
    return tx(db, () => {
      const user = getUser(userId);
      if (user.royalties < ECONOMY.packPrice) throw new HttpError(409, 'not_enough_royalties');
      q('UPDATE users SET royalties = royalties - ?, bonus_packs = bonus_packs + 1 WHERE id = ?').run(ECONOMY.packPrice, userId);
      return { spent: ECONOMY.packPrice };
    });
  }

  /** Recycle tous les doublons (on garde un exemplaire de chaque variante). */
  function recycleDuplicates(userId) {
    return tx(db, () => {
      const rows = q('SELECT track_id, variant, count FROM cards WHERE user_id = ? AND count > 1').all(userId);
      let royalties = 0;
      let recycled = 0;
      for (const r of rows) {
        royalties += recycleValue(r.track_id, r.variant) * (r.count - 1);
        recycled += r.count - 1;
      }
      q('UPDATE cards SET count = 1 WHERE user_id = ? AND count > 1').run(userId);
      q('UPDATE users SET royalties = royalties + ? WHERE id = ?').run(royalties, userId);
      return { royalties, recycled };
    });
  }

  /** « Presser » une carte manquante en échange de royalties. */
  function pressCard(userId, trackId) {
    return tx(db, () => {
      const track = TRACK_BY_ID[trackId];
      if (!track) throw new HttpError(404, 'unknown_track');
      const user = getUser(userId);
      const admin = isAdmin(user);
      const base = pressCost(trackId);
      // L'admin presse gratuitement, promos comprises, pour tester.
      if (base == null && !admin) throw new HttpError(400, 'not_pressable');
      const cost = admin ? 0 : base;
      if (ownedSet(userId).has(trackId)) throw new HttpError(409, 'already_owned');
      if (user.royalties < cost) throw new HttpError(409, 'not_enough_royalties');
      q('UPDATE users SET royalties = royalties - ? WHERE id = ?').run(cost, userId);
      return { spent: cost, ...addCards(user, [{ trackId, variant: 'std' }], 'press') };
    });
  }

  // ----- profil ---------------------------------------------------------------

  function setAvatar(userId, avatar, color) {
    const user = getUser(userId);
    if (color !== undefined && !AVATAR_COLORS.includes(color)) throw new HttpError(400, 'invalid_color');
    if (avatar !== undefined) {
      if (avatar !== 'initials') {
        const m = /^album:(.+)$/.exec(String(avatar));
        if (!m || !ALBUM_BY_ID[m[1]]) throw new HttpError(400, 'invalid_avatar');
        if (!isAdmin(user) && !achievementSet(userId).has(`album:${m[1]}`)) throw new HttpError(403, 'avatar_locked');
      }
    }
    q('UPDATE users SET avatar = ?, avatar_color = ? WHERE id = ?').run(avatar ?? user.avatar, color ?? user.avatar_color, userId);
  }

  function setShowcase(userId, slots) {
    if (!Array.isArray(slots) || slots.length > SHOWCASE_SLOTS) throw new HttpError(400, 'invalid_showcase');
    const owned = ownedSet(userId);
    const clean = slots.map((id) => (id && TRACK_BY_ID[id] && owned.has(id) ? id : null));
    while (clean.length < SHOWCASE_SLOTS) clean.push(null);
    q('UPDATE users SET showcase = ? WHERE id = ?').run(JSON.stringify(clean), userId);
    return clean;
  }

  function setLang(userId, lang) {
    if (!['fr', 'en'].includes(lang)) throw new HttpError(400, 'invalid_lang');
    q('UPDATE users SET lang = ? WHERE id = ?').run(lang, userId);
  }

  function friendshipBetween(a, b) {
    return q(`SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`)
      .get(a, b, b, a);
  }

  function summary(user) {
    const owned = ownedSet(user.id);
    return {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      avatarColor: user.avatar_color,
      level: levelFromXp(user.xp).level,
      unique: owned.size,
      total: TRACKS.length,
    };
  }

  function publicProfile(viewerId, username) {
    const target = q('SELECT * FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(username);
    if (!target) throw new HttpError(404, 'user_not_found');
    const owned = ownedSet(target.id);
    const holo = new Set(q("SELECT track_id FROM cards WHERE user_id = ? AND variant = 'holo'").all(target.id).map((r) => r.track_id));
    const stats = collectionStats(owned);
    const ach = [...achievementSet(target.id)];
    let friendship = 'none';
    let requestId = null;
    if (target.id === viewerId) friendship = 'self';
    else {
      const f = friendshipBetween(viewerId, target.id);
      if (f) {
        requestId = f.id;
        friendship = f.status === 'accepted' ? 'friends' : f.requester_id === viewerId ? 'outgoing' : 'incoming';
      }
    }
    return {
      id: target.id,
      username: target.username,
      avatar: target.avatar,
      avatarColor: target.avatar_color,
      level: levelFromXp(target.xp),
      createdAt: target.created_at,
      role: roleOf(target),
      stats: {
        unique: stats.total.owned,
        total: stats.total.total,
        albumsCompleted: stats.albumsCompleted,
        artistsMastered: stats.artistsMastered,
        promos: stats.promos.owned,
        promosTotal: stats.promos.total,
      },
      showcase: JSON.parse(target.showcase).map((id) => (id && owned.has(id) ? { trackId: id, variant: holo.has(id) ? 'holo' : 'std' } : null)),
      completedAlbums: ach.filter((k) => k.startsWith('album:')).map((k) => k.slice(6)),
      // Vinyles : albums complétés, dans l'ordre d'obtention ; édition holo si toutes les cartes sont holo.
      vinyls: q("SELECT key, created_at FROM achievements WHERE user_id = ? AND key LIKE 'album:%' ORDER BY created_at, key").all(target.id)
        .map((r) => ({ albumId: r.key.slice(6), at: r.created_at }))
        .filter((v) => ALBUM_BY_ID[v.albumId])
        .map((v) => ({ ...v, edition: TRACKS_BY_ALBUM[v.albumId].every((t) => holo.has(t.id)) ? 'holo' : 'black' })),
      masteredArtists: ach.filter((k) => k.startsWith('artist:')).map((k) => k.slice(7)),
      albumProgress: stats.albums,
      friendship,
      requestId,
    };
  }

  // ----- amis -----------------------------------------------------------------

  function listFriends(userId) {
    const rows = q(`SELECT f.*, u.id AS uid FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
      WHERE f.requester_id = ? OR f.addressee_id = ? ORDER BY f.created_at DESC`).all(userId, userId, userId);
    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const r of rows) {
      const entry = { requestId: r.id, since: r.responded_at || r.created_at, user: summary(getUser(r.uid)) };
      if (r.status === 'accepted') friends.push(entry);
      else if (r.addressee_id === userId) incoming.push(entry);
      else outgoing.push(entry);
    }
    return { friends, incoming, outgoing };
  }

  function requestFriend(userId, username) {
    const target = q('SELECT * FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(String(username || '').trim());
    if (!target) throw new HttpError(404, 'user_not_found');
    if (target.id === userId) throw new HttpError(400, 'cannot_add_self');
    const existing = friendshipBetween(userId, target.id);
    if (existing) {
      if (existing.status === 'accepted') throw new HttpError(409, 'already_friends');
      if (existing.requester_id === userId) throw new HttpError(409, 'already_requested');
      // L'autre joueur nous avait déjà invité : on accepte directement.
      q("UPDATE friendships SET status = 'accepted', responded_at = ? WHERE id = ?").run(Date.now(), existing.id);
      return { status: 'accepted', username: target.username };
    }
    q("INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(userId, target.id, Date.now());
    return { status: 'pending', username: target.username };
  }

  function respondFriend(userId, requestId, accept) {
    const f = q('SELECT * FROM friendships WHERE id = ?').get(Number(requestId));
    if (!f || f.status !== 'pending') throw new HttpError(404, 'request_not_found');
    if (accept) {
      if (f.addressee_id !== userId) throw new HttpError(403, 'forbidden');
      q("UPDATE friendships SET status = 'accepted', responded_at = ? WHERE id = ?").run(Date.now(), f.id);
    } else {
      // Refuser (destinataire) ou annuler (expéditeur).
      if (f.addressee_id !== userId && f.requester_id !== userId) throw new HttpError(403, 'forbidden');
      q('DELETE FROM friendships WHERE id = ?').run(f.id);
    }
  }

  function removeFriend(userId, otherId) {
    const f = friendshipBetween(userId, Number(otherId));
    if (!f || f.status !== 'accepted') throw new HttpError(404, 'not_friends');
    q('DELETE FROM friendships WHERE id = ?').run(f.id);
  }

  // ----- blind test -----------------------------------------------------------

  const dayStart = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  function rewardedToday(userId) {
    return q('SELECT COUNT(*) AS n FROM blindtest_games WHERE user_id = ? AND rewarded = 1 AND created_at >= ?').get(userId, dayStart()).n;
  }

  function blindtestInfo(userId) {
    const user = getUser(userId);
    return {
      genres: ['all', ...GENRES].map((id) => ({ id, count: blindtestPool(id).length })),
      rewardedToday: rewardedToday(userId),
      rewardedLimit: isAdmin(user) ? null : BLINDTEST.rewardedGamesPerDay,
      rounds: BLINDTEST.rounds,
      roundSeconds: BLINDTEST.roundSeconds,
      rewards: BLINDTEST.rewards,
      audio: config.blindtestAudio !== 'off',
    };
  }

  const previewCache = new Map();
  const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  /** Cherche un extrait de 30 s via l'API iTunes Search (mis en cache). */
  async function previewFor(trackId) {
    if (config.blindtestAudio !== 'itunes') return null;
    if (previewCache.has(trackId)) return previewCache.get(trackId);
    const cached = q('SELECT url, fetched_at FROM previews WHERE track_id = ?').get(trackId);
    const week = 7 * 86_400_000;
    if (cached && Date.now() - cached.fetched_at < (cached.url ? week : week / 7)) {
      previewCache.set(trackId, cached.url);
      return cached.url;
    }
    const t = TRACK_BY_ID[trackId];
    const artist = ARTIST_BY_ID[t.artistId].name.split(' & ')[0];
    const title = t.title.replace(/\*+/g, '');
    let url = null;
    try {
      const term = encodeURIComponent(`${artist} ${title}`);
      const res = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=15&country=${config.previewCountry}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const data = await res.json();
        const wantArtist = normalize(artist);
        const wantTitle = normalize(title);
        const results = (data.results || []).filter((r) => r.previewUrl && normalize(r.artistName || '').includes(wantArtist));
        const best = results.find((r) => normalize(r.trackName || '') === wantTitle)
          || results.find((r) => normalize(r.trackName || '').startsWith(wantTitle))
          || results.find((r) => normalize(r.trackName || '').includes(wantTitle));
        url = best?.previewUrl || null;
      }
    } catch {
      url = null;
    }
    q('INSERT INTO previews (track_id, url, fetched_at) VALUES (?, ?, ?) ON CONFLICT(track_id) DO UPDATE SET url = excluded.url, fetched_at = excluded.fetched_at')
      .run(trackId, url, Date.now());
    previewCache.set(trackId, url);
    return url;
  }

  async function roundPayload(questions, index, admin) {
    const qn = questions[index];
    const audio = await previewFor(qn.answer);
    return {
      // L'admin reçoit la bonne réponse pour pouvoir tester le jeu rapidement.
      answer: admin ? qn.answer : undefined,
      index,
      rounds: questions.length,
      choices: qn.choices.map((id) => ({ id, title: TRACK_BY_ID[id].title, artist: ARTIST_BY_ID[TRACK_BY_ID[id].artistId].name })),
      audio,
      clues: audio ? null : blindtestClues(qn.answer),
      seconds: BLINDTEST.roundSeconds,
    };
  }

  async function startBlindtest(userId, genre) {
    if (genre !== 'all' && !GENRES.includes(genre)) throw new HttpError(400, 'invalid_genre');
    const user = getUser(userId);
    const rewarded = isAdmin(user) || rewardedToday(userId) < BLINDTEST.rewardedGamesPerDay;
    const questions = buildBlindtest(genre, secureRandom);
    const id = newId();
    q('INSERT INTO blindtest_games (id, user_id, genre, questions, rewarded, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, userId, genre, JSON.stringify(questions), rewarded ? 1 : 0, Date.now(),
    );
    const round = await roundPayload(questions, 0, isAdmin(user));
    questions[0].startedAt = Date.now();
    q('UPDATE blindtest_games SET questions = ? WHERE id = ?').run(JSON.stringify(questions), id);
    return { gameId: id, rewarded, round };
  }

  function loadGame(userId, gameId) {
    const game = q('SELECT * FROM blindtest_games WHERE id = ? AND user_id = ?').get(gameId, userId);
    if (!game) throw new HttpError(404, 'game_not_found');
    if (game.finished_at) throw new HttpError(409, 'game_finished');
    return { game, questions: JSON.parse(game.questions) };
  }

  function answerBlindtest(userId, gameId, choice) {
    return tx(db, () => {
      const { game, questions } = loadGame(userId, gameId);
      const qn = questions[game.current];
      if (!qn.startedAt || qn.picked !== undefined) throw new HttpError(409, 'round_not_active');
      const elapsed = Date.now() - qn.startedAt;
      const inTime = elapsed <= (BLINDTEST.roundSeconds + 2) * 1000;
      const correct = inTime && choice === qn.answer;
      const points = blindtestPoints(correct, elapsed);
      qn.picked = choice ?? null;
      qn.points = points;
      const score = game.score + points;
      const correctCount = game.correct + (correct ? 1 : 0);
      const last = game.current === questions.length - 1;
      let final = null;
      if (last) {
        const rewardPacks = game.rewarded ? blindtestReward(correctCount) : 0;
        const xp = correctCount * 10;
        q('UPDATE users SET bonus_packs = bonus_packs + ?, xp = xp + ? WHERE id = ?').run(rewardPacks, xp, userId);
        q('UPDATE blindtest_games SET finished_at = ?, reward_packs = ? WHERE id = ?').run(Date.now(), rewardPacks, gameId);
        final = { score, correct: correctCount, rounds: questions.length, rewardPacks, rewarded: !!game.rewarded, xp };
      }
      q('UPDATE blindtest_games SET questions = ?, score = ?, correct = ? WHERE id = ?').run(JSON.stringify(questions), score, correctCount, gameId);
      return { result: { correct, answer: qn.answer, picked: qn.picked, points, score }, final };
    });
  }

  async function nextBlindtestRound(userId, gameId) {
    const { game, questions } = loadGame(userId, gameId);
    const current = questions[game.current];
    if (current.picked === undefined) throw new HttpError(409, 'round_not_answered');
    const index = game.current + 1;
    if (index >= questions.length) throw new HttpError(409, 'game_finished');
    const round = await roundPayload(questions, index, isAdmin(getUser(userId)));
    questions[index].startedAt = Date.now();
    q('UPDATE blindtest_games SET questions = ?, current = ? WHERE id = ?').run(JSON.stringify(questions), index, gameId);
    return { round };
  }

  // ----- notes & critiques ----------------------------------------------------

  const REVIEW_MAX = 2000;

  function checkItem(type, id) {
    const ok = type === 'album' ? !!ALBUM_BY_ID[id] : type === 'track' ? !!TRACK_BY_ID[id] : false;
    if (!ok) throw new HttpError(404, 'unknown_item');
  }

  function friendIds(userId) {
    return new Set(q(`SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id
      FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`).all(userId, userId, userId).map((r) => r.id));
  }

  function author(row) {
    return { id: row.user_id, username: row.username, avatar: row.avatar, avatarColor: row.avatar_color, level: levelFromXp(row.xp).level };
  }

  function summarize(scores) {
    const distribution = Array(11).fill(0);
    let sum = 0;
    for (const s of scores) {
      distribution[s] += 1;
      sum += s;
    }
    return { count: scores.length, average: scores.length ? sum / scores.length : null, distribution };
  }

  const WITH_AUTHOR = `SELECT r.*, u.username, u.avatar, u.avatar_color, u.xp FROM ratings r JOIN users u ON u.id = r.user_id`;

  /** Notes d'un album ou d'un morceau : moyenne, répartition, ta note, critiques (amis d'abord). */
  function itemRatings(viewerId, type, id) {
    checkItem(type, id);
    const all = q('SELECT user_id, score FROM ratings WHERE item_type = ? AND item_id = ?').all(type, id);
    const mine = q('SELECT score, review, updated_at FROM ratings WHERE user_id = ? AND item_type = ? AND item_id = ?').get(viewerId, type, id);
    const friends = friendIds(viewerId);
    const ids = [...friends];
    const inFriends = `r.user_id IN (${ids.map(() => '?').join(',')})`;
    // Critiques écrites : celles des amis d'abord, puis les plus récentes.
    const friendsFirst = ids.length ? `CASE WHEN ${inFriends} THEN 1 ELSE 0 END DESC, ` : '';
    const reviews = q(`${WITH_AUTHOR} WHERE r.item_type = ? AND r.item_id = ? AND r.user_id != ? AND r.review IS NOT NULL
      ORDER BY ${friendsFirst}r.updated_at DESC LIMIT 30`).all(type, id, viewerId, ...ids)
      .map((r) => ({ user: author(r), score: r.score, review: r.review, updatedAt: r.updated_at, friend: friends.has(r.user_id) }));
    const friendScores = ids.length
      ? q(`${WITH_AUTHOR} WHERE r.item_type = ? AND r.item_id = ? AND ${inFriends} ORDER BY r.updated_at DESC LIMIT 12`).all(type, id, ...ids)
        .map((r) => ({ user: author(r), score: r.score }))
      : [];
    const result = {
      summary: summarize(all.map((r) => r.score)),
      mine: mine ? { score: mine.score, review: mine.review, updatedAt: mine.updated_at } : null,
      reviews,
      friendScores,
    };
    if (type === 'album') {
      const prefix = `${id}:%`;
      const tracks = {};
      for (const r of q("SELECT item_id, COUNT(*) AS n, AVG(score) AS a FROM ratings WHERE item_type = 'track' AND item_id LIKE ? GROUP BY item_id").all(prefix)) {
        tracks[r.item_id] = { count: r.n, average: r.a };
      }
      for (const r of q("SELECT item_id, score FROM ratings WHERE user_id = ? AND item_type = 'track' AND item_id LIKE ?").all(viewerId, prefix)) {
        tracks[r.item_id] = { ...(tracks[r.item_id] || { count: 0, average: null }), mine: r.score };
      }
      result.tracks = tracks;
    }
    return result;
  }

  function rate(userId, type, id, score, review) {
    checkItem(type, id);
    if (!Number.isInteger(score) || score < 0 || score > 10) throw new HttpError(400, 'invalid_score');
    // Sans champ `review`, on garde la critique déjà écrite (changement de note depuis la tracklist).
    if (review === undefined) {
      review = q('SELECT review FROM ratings WHERE user_id = ? AND item_type = ? AND item_id = ?').get(userId, type, id)?.review ?? '';
    }
    let text = typeof review === 'string' ? review.trim() : '';
    if (text.length > REVIEW_MAX) throw new HttpError(400, 'review_too_long');
    if (!text) text = null;
    const now = Date.now();
    q(`INSERT INTO ratings (user_id, item_type, item_id, score, review, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET score = excluded.score, review = excluded.review, updated_at = excluded.updated_at`)
      .run(userId, type, id, score, text, now, now);
  }

  function unrate(userId, type, id) {
    checkItem(type, id);
    q('DELETE FROM ratings WHERE user_id = ? AND item_type = ? AND item_id = ?').run(userId, type, id);
  }

  /** Journal de notes d'un joueur, affiché sur son profil. */
  function userRatings(username) {
    const target = q('SELECT * FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(username);
    if (!target) throw new HttpError(404, 'user_not_found');
    const rows = q('SELECT item_type, item_id, score, review, updated_at FROM ratings WHERE user_id = ? ORDER BY updated_at DESC').all(target.id)
      .filter((r) => (r.item_type === 'album' ? ALBUM_BY_ID[r.item_id] : TRACK_BY_ID[r.item_id]));
    const entry = (r) => ({ type: r.item_type, id: r.item_id, score: r.score, review: r.review, updatedAt: r.updated_at });
    const albums = rows.filter((r) => r.item_type === 'album');
    return {
      stats: { ...summarize(rows.map((r) => r.score)), albums: albums.length, tracks: rows.length - albums.length, reviews: rows.filter((r) => r.review).length },
      topAlbums: [...albums].sort((a, b) => b.score - a.score || b.updated_at - a.updated_at).slice(0, 4).map(entry),
      topTracks: rows.filter((r) => r.item_type === 'track').sort((a, b) => b.score - a.score || b.updated_at - a.updated_at).slice(0, 5).map(entry),
      recent: rows.slice(0, 12).map(entry),
      reviews: rows.filter((r) => r.review).slice(0, 10).map(entry),
    };
  }

  /** Dernières notes des amis. */
  function friendsFeed(userId) {
    const ids = [...friendIds(userId)];
    if (!ids.length) return [];
    return q(`${WITH_AUTHOR} WHERE r.user_id IN (${ids.map(() => '?').join(',')}) ORDER BY r.updated_at DESC LIMIT 20`).all(...ids)
      .map((r) => ({ user: author(r), type: r.item_type, id: r.item_id, score: r.score, review: r.review, updatedAt: r.updated_at }));
  }

  function setRatingScale(userId, scale) {
    if (!['stars', 'points'].includes(scale)) throw new HttpError(400, 'invalid_scale');
    q('UPDATE users SET rating_scale = ? WHERE id = ?').run(scale, userId);
  }

  function adminReviews() {
    return q(`${WITH_AUTHOR} WHERE r.review IS NOT NULL ORDER BY r.updated_at DESC LIMIT 60`).all()
      .map((r) => ({ user: author(r), type: r.item_type, id: r.item_id, score: r.score, review: r.review, updatedAt: r.updated_at }));
  }

  /** Supprime le texte d'une critique ; la note du joueur est conservée. */
  function adminDeleteReview(userId, type, id) {
    const res = q('UPDATE ratings SET review = NULL WHERE user_id = ? AND item_type = ? AND item_id = ? AND review IS NOT NULL').run(Number(userId), type, id);
    if (!res.changes) throw new HttpError(404, 'review_not_found');
  }

  // ----- admin ----------------------------------------------------------------

  function adminOverview() {
    const users = q(`SELECT u.*, (SELECT COUNT(DISTINCT track_id) FROM cards c WHERE c.user_id = u.id) AS uniq,
      (SELECT COUNT(*) FROM pack_openings p WHERE p.user_id = u.id) AS openings
      FROM users u ORDER BY u.created_at DESC LIMIT 500`).all();
    return {
      users: users.map((u) => ({
        id: u.id, username: u.username, email: u.email, role: roleOf(u), verified: !!u.email_verified_at,
        unique: u.uniq, openings: u.openings, royalties: u.royalties, packs: u.packs + u.bonus_packs,
        level: levelFromXp(u.xp).level, createdAt: u.created_at, lastSeenAt: u.last_seen_at,
      })),
      totals: {
        users: users.length,
        verified: users.filter((u) => u.email_verified_at).length,
        openings: q('SELECT COUNT(*) AS n FROM pack_openings').get().n,
        cards: q('SELECT COALESCE(SUM(count), 0) AS n FROM cards').get().n,
        ratings: q('SELECT COUNT(*) AS n FROM ratings').get().n,
      },
      adminCount: config.adminEmails.length,
      odds: packOdds(),
      slots: PACK_SLOTS,
      config: { packRegenMinutes: config.packRegenMinutes, packMaxStock: config.packMaxStock, blindtestAudio: config.blindtestAudio },
    };
  }

  function adminGrant(targetId, { packs = 0, royalties = 0 }) {
    const p = Math.max(0, Math.min(1000, Math.floor(Number(packs) || 0)));
    const r = Math.max(0, Math.min(1_000_000, Math.floor(Number(royalties) || 0)));
    const res = q('UPDATE users SET bonus_packs = bonus_packs + ?, royalties = royalties + ? WHERE id = ?').run(p, r, Number(targetId));
    if (!res.changes) throw new HttpError(404, 'user_not_found');
    return { packs: p, royalties: r };
  }

  function adminResetCollection(userId) {
    tx(db, () => {
      q('DELETE FROM cards WHERE user_id = ?').run(userId);
      q('DELETE FROM achievements WHERE user_id = ?').run(userId);
      q("UPDATE users SET xp = 0, avatar = 'initials', showcase = '[]' WHERE id = ?").run(userId);
    });
  }

  function adminCompleteCollection(userId) {
    tx(db, () => {
      const now = Date.now();
      const ins = q("INSERT OR IGNORE INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, 'std', 1, ?)");
      for (const t of TRACKS) ins.run(userId, t.id, now);
      const ach = q('INSERT OR IGNORE INTO achievements (user_id, key, created_at) VALUES (?, ?, ?)');
      for (const a of Object.keys(ALBUM_BY_ID)) ach.run(userId, `album:${a}`, now);
      for (const a of Object.keys(ARTIST_BY_ID)) ach.run(userId, `artist:${a}`, now);
    });
  }

  /** Prépare un album complet à une carte près, pour tester la célébration de fin d'album. */
  function adminAlmostAlbum(userId, albumId) {
    const list = TRACKS_BY_ALBUM[albumId];
    if (!list) throw new HttpError(404, 'unknown_album');
    const missing = list[Math.floor(secureRandom() * list.length)];
    tx(db, () => {
      const now = Date.now();
      const ins = q("INSERT OR IGNORE INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, 'std', 1, ?)");
      for (const t of list) if (t.id !== missing.id) ins.run(userId, t.id, now);
      q('DELETE FROM cards WHERE user_id = ? AND track_id = ?').run(userId, missing.id);
      q('DELETE FROM achievements WHERE user_id = ? AND key IN (?, ?)').run(userId, `album:${albumId}`, `artist:${missing.artistId}`);
    });
    return { missing: missing.id };
  }

  return {
    getUser, isAdmin, syncPacks, state, openPacks, buyPack, recycleDuplicates, pressCard,
    setAvatar, setShowcase, setLang, publicProfile,
    listFriends, requestFriend, respondFriend, removeFriend,
    blindtestInfo, startBlindtest, answerBlindtest, nextBlindtestRound,
    itemRatings, rate, unrate, userRatings, friendsFeed, setRatingScale,
    adminOverview, adminGrant, adminResetCollection, adminCompleteCollection, adminAlmostAlbum, adminReviews, adminDeleteReview,
    welcome: { packs: ECONOMY.welcomePacks, royalties: ECONOMY.welcomeRoyalties },
  };
}
