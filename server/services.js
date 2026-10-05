// Logique métier du jeu côté serveur (comptes, boosters, collection, amis, blind test, admin).
// Le catalogue (jusqu'à 20 000 albums et plus) vient de server/catalog.js : rien ici ne parcourt tout le catalogue
// ni toute la collection d'un joueur pour répondre à une question sur quelques cartes.
import { config } from './config.js';
import { tx } from './db.js';
import { newId, secureRandom } from './security.js';
import {
  rollPack, rollAlbumPack, newAchievements, xpForCard, newCardRoyalties, recycleValue, pressCost, levelFromXp,
  ECONOMY, BLINDTEST, SHOWCASE_SLOTS, AVATAR_COLORS, RARITIES, packOdds, PACK_SLOTS,
  buildBlindtest, blindtestClues, blindtestPoints, blindtestReward,
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

/** Identifiant reçu d'une requête : une chaîne courte, sinon rien (node:sqlite refuse les tableaux et booléens). */
const idOf = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);

export function createServices(db, catalog) {
  const q = (sql) => db.prepare(sql);
  const json = (list) => JSON.stringify(list);

  // ----- utilisateurs -------------------------------------------------------

  const getUser = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
  /** Seules les adresses de ADMIN_EMAILS (vérifiées) sont admin. La colonne `role` n'est plus utilisée. */
  const isAdmin = (u) => !!u?.email_verified_at && config.adminEmails.includes(String(u.email).toLowerCase());
  const roleOf = (u) => (isAdmin(u) ? 'admin' : 'player');

  const ownsTrack = (userId, trackId) => !!q('SELECT 1 FROM cards WHERE user_id = ? AND track_id = ? LIMIT 1').get(userId, trackId);
  /** Parmi ces cartes, celles que le joueur possède (toutes variantes). */
  const ownedAmong = (userId, ids) => (ids.length
    ? new Set(q('SELECT DISTINCT track_id FROM cards WHERE user_id = ? AND track_id IN (SELECT value FROM json_each(?))').all(userId, json(ids)).map((r) => r.track_id))
    : new Set());
  const uniqueCount = (userId) => q('SELECT COUNT(DISTINCT track_id) AS n FROM cards WHERE user_id = ?').get(userId).n;
  function achievementSet(userId) {
    return new Set(q('SELECT key FROM achievements WHERE user_id = ?').all(userId).map((r) => r.key));
  }

  /** Données des cartes et albums cités dans une réponse, pour que le site les affiche sans autre requête. */
  function refs({ trackIds = [], albumIds = [], artistIds = [] } = {}) {
    return {
      tracks: catalog.tracks([...new Set(trackIds.filter(idOf))].slice(0, 500)),
      albums: [...new Set(albumIds.filter(idOf))].slice(0, 300).map((id) => catalog.album(id)).filter(Boolean),
      artists: [...new Set(artistIds.filter(idOf))].slice(0, 300).map((id) => catalog.artist(id)).filter(Boolean),
    };
  }

  // Statistiques de collection : calculées en base, gardées une minute ou jusqu'à la prochaine carte obtenue.
  const statsCache = new Map();
  function statsFor(userId) {
    const hit = statsCache.get(userId);
    if (hit && Date.now() - hit.at < 60_000) return hit.stats;
    const stats = catalog.stats(userId);
    statsCache.set(userId, { stats, at: Date.now() });
    if (statsCache.size > 5000) statsCache.delete(statsCache.keys().next().value);
    return stats;
  }
  const dropStats = (userId) => statsCache.delete(userId);

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

  /** Album de la photo de profil (« album:<id> »), pour l'afficher sans autre requête. */
  const avatarAlbum = (avatar) => (typeof avatar === 'string' && avatar.startsWith('album:') ? avatar.slice(6) : null);

  /** État complet du joueur connecté, utilisé pour hydrater le client. */
  function state(userId) {
    const user = syncPacks(getUser(userId));
    q('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Date.now(), userId);
    // r : rareté, pour que le site compte doublons et raretés sans charger chaque carte.
    const cards = q('SELECT c.track_id, c.variant, c.count, c.first_at, t.rarity FROM cards c JOIN cat_tracks t ON t.id = c.track_id WHERE c.user_id = ?').all(userId)
      .map((r) => ({ t: r.track_id, v: r.variant, c: r.count, at: r.first_at, r: r.rarity }));
    const achievements = q('SELECT key, created_at FROM achievements WHERE user_id = ?').all(userId)
      .map((r) => ({ key: r.key, at: r.created_at }));
    const pendingFriends = q("SELECT COUNT(*) AS n FROM friendships WHERE addressee_id = ? AND status = 'pending'").get(userId).n;
    const ratings = q('SELECT item_type, item_id, score FROM ratings WHERE user_id = ?').all(userId)
      .map((r) => ({ t: r.item_type, i: r.item_id, s: r.score }));
    const self = selfPayload(user);
    return {
      user: self,
      packs: packInfo(user),
      cards,
      achievements,
      ratings,
      pendingFriends,
      stats: statsFor(userId),
      catalog: refs({ trackIds: self.showcase.filter(Boolean), albumIds: [avatarAlbum(self.avatar)].filter(Boolean) }),
      serverTime: Date.now(),
    };
  }

  // ----- cartes ---------------------------------------------------------------

  /** Progression du joueur sur ces albums : { albumId: cartes possédées }. */
  function albumCounts(userId, albumIds) {
    if (!albumIds.length) return new Map();
    return new Map(q(`SELECT t.album_id, COUNT(DISTINCT c.track_id) AS n FROM cards c JOIN cat_tracks t ON t.id = c.track_id
      WHERE c.user_id = ? AND t.album_id IN (SELECT value FROM json_each(?)) GROUP BY t.album_id`).all(userId, json(albumIds)).map((r) => [r.album_id, r.n]));
  }

  /**
   * Ajoute des cartes à la collection, attribue XP, succès et récompenses.
   * `cards` : [{ trackId, variant }]. À appeler à l'intérieur d'une transaction.
   */
  function addCards(user, cards, source) {
    const now = Date.now();
    const views = new Map(catalog.tracks(cards.map((c) => c.trackId)).map((t) => [t.id, t]));
    const list = cards.filter((c) => views.has(c.trackId));
    const ids = [...new Set(list.map((c) => c.trackId))];
    const albumIds = [...new Set(ids.map((id) => views.get(id).albumId).filter(Boolean))];
    const artistIds = [...new Set(ids.map((id) => views.get(id).artistId))];
    const ownedBefore = ownedAmong(user.id, ids);
    const variantsBefore = new Set(ids.length
      ? q("SELECT track_id || '|' || variant AS k FROM cards WHERE user_id = ? AND track_id IN (SELECT value FROM json_each(?))").all(user.id, json(ids)).map((r) => r.k)
      : []);
    const beforeCounts = albumCounts(user.id, albumIds);

    const owned = new Set(ownedBefore);
    const seenVariants = new Set(variantsBefore);
    const upsert = q(`INSERT INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT (user_id, track_id, variant) DO UPDATE SET count = count + 1`);
    let xp = 0;
    // Droits d'auteur des nouvelles cartes (pas pour une carte pressée : on vient de la payer).
    let cardRoyalties = 0;
    const results = list.map(({ trackId, variant }) => {
      const rarity = views.get(trackId).rarity;
      const newTrack = !owned.has(trackId);
      const newVariant = !seenVariants.has(`${trackId}|${variant}`);
      upsert.run(user.id, trackId, variant, now);
      owned.add(trackId);
      seenVariants.add(`${trackId}|${variant}`);
      xp += xpForCard(rarity, newTrack);
      if (newTrack && source !== 'press') cardRoyalties += newCardRoyalties(rarity);
      return { trackId, variant, rarity, newTrack, newVariant };
    });

    // Succès : seules les cartes des albums et artistes touchés comptent.
    const scoped = new Set(q(`SELECT DISTINCT c.track_id FROM cards c JOIN cat_tracks t ON t.id = c.track_id WHERE c.user_id = ?
      AND (t.album_id IN (SELECT value FROM json_each(?)) OR t.artist_id IN (SELECT value FROM json_each(?)))`)
      .all(user.id, json(albumIds), json(artistIds)).map((r) => r.track_id));
    const achievements = newAchievements({ owned: scoped, already: achievementSet(user.id), touched: [...views.values()], catalog });
    let royalties = cardRoyalties;
    const insertAch = q('INSERT OR IGNORE INTO achievements (user_id, key, created_at) VALUES (?, ?, ?)');
    for (const a of achievements) {
      insertAch.run(user.id, a.key, now);
      royalties += a.royalties;
      xp += a.xp;
    }
    q('UPDATE users SET xp = xp + ?, royalties = royalties + ? WHERE id = ?').run(xp, royalties, user.id);
    q('INSERT INTO pack_openings (user_id, source, cards, created_at) VALUES (?, ?, ?, ?)').run(
      user.id, source, JSON.stringify(list.map(({ trackId, variant }) => ({ trackId, variant }))), now,
    );
    dropStats(user.id);

    const afterCounts = albumCounts(user.id, albumIds);
    const albumDeltas = albumIds.map((albumId) => ({
      albumId,
      before: beforeCounts.get(albumId) || 0,
      after: afterCounts.get(albumId) || 0,
      total: views.get(ids.find((id) => views.get(id).albumId === albumId)).total,
    })).filter((d) => d.after > d.before);

    return {
      cards: results,
      xp,
      royalties,
      cardRoyalties,
      achievements,
      albumDeltas,
      catalog: refs({ trackIds: ids, albumIds, artistIds: achievements.filter((a) => a.type === 'artist').map((a) => a.id) }),
    };
  }

  /** Albums commencés mais pas finis, vers lesquels une partie des boosters gratuits est orientée. */
  function focusAlbums(userId) {
    return q(`SELECT t.album_id FROM cards c JOIN cat_tracks t ON t.id = c.track_id JOIN cat_albums al ON al.id = t.album_id
      WHERE c.user_id = ? GROUP BY t.album_id HAVING COUNT(DISTINCT c.track_id) < MAX(al.track_count)
      ORDER BY MAX(c.first_at) DESC LIMIT 200`).all(userId).map((r) => r.album_id);
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
      const focus = focusAlbums(userId);
      const packs = Array.from({ length: n }, () => rollPack(secureRandom, catalog, { focusAlbumIds: focus }));
      const result = addCards(user, packs.flat(), admin ? 'admin-pack' : 'pack');
      return { packs: packs.map((p) => p.length), ...result };
    });
  }

  /** Booster d'album : 5 cartes de l'album choisi, payé en royalties (gratuit pour l'admin). */
  function openAlbumPack(userId, albumId) {
    const id = idOf(albumId);
    const album = id && catalog.album(id);
    if (!album) throw new HttpError(404, 'unknown_album');
    return tx(db, () => {
      const user = getUser(userId);
      const cost = isAdmin(user) ? 0 : ECONOMY.albumPackPrice;
      if (user.royalties < cost) throw new HttpError(409, 'not_enough_royalties');
      q('UPDATE users SET royalties = royalties - ? WHERE id = ?').run(cost, userId);
      const owned = ownedAmong(userId, catalog.albumTrackIds(id));
      const cards = rollAlbumPack(secureRandom, catalog, id, owned);
      return { spent: cost, albumId: id, packs: [cards.length], ...addCards(user, cards, 'album-pack') };
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
      const rows = q(`SELECT t.rarity, c.variant, SUM(c.count - 1) AS n FROM cards c JOIN cat_tracks t ON t.id = c.track_id
        WHERE c.user_id = ? AND c.count > 1 GROUP BY t.rarity, c.variant`).all(userId);
      let royalties = 0;
      let recycled = 0;
      for (const r of rows) {
        royalties += recycleValue(r.rarity, r.variant) * r.n;
        recycled += r.n;
      }
      q('UPDATE cards SET count = 1 WHERE user_id = ? AND count > 1').run(userId);
      q('UPDATE users SET royalties = royalties + ? WHERE id = ?').run(royalties, userId);
      return { royalties, recycled };
    });
  }

  /** « Presser » une carte manquante en échange de royalties. */
  function pressCard(userId, trackId) {
    const id = idOf(trackId);
    const track = id && catalog.track(id);
    if (!track) throw new HttpError(404, 'unknown_track');
    return tx(db, () => {
      const user = getUser(userId);
      const admin = isAdmin(user);
      const base = pressCost(track.rarity);
      // L'admin presse gratuitement, promos comprises, pour tester.
      if (base == null && !admin) throw new HttpError(400, 'not_pressable');
      const cost = admin ? 0 : base;
      if (ownsTrack(userId, id)) throw new HttpError(409, 'already_owned');
      if (user.royalties < cost) throw new HttpError(409, 'not_enough_royalties');
      q('UPDATE users SET royalties = royalties - ? WHERE id = ?').run(cost, userId);
      return { spent: cost, ...addCards(user, [{ trackId: id, variant: 'std' }], 'press') };
    });
  }

  // ----- profil ---------------------------------------------------------------

  function setAvatar(userId, avatar, color) {
    const user = getUser(userId);
    if (color !== undefined && !AVATAR_COLORS.includes(color)) throw new HttpError(400, 'invalid_color');
    if (avatar !== undefined) {
      if (avatar !== 'initials') {
        const m = /^album:(.+)$/.exec(String(avatar));
        if (!m || !catalog.album(m[1])) throw new HttpError(400, 'invalid_avatar');
        if (!isAdmin(user) && !q('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?').get(userId, `album:${m[1]}`)) {
          throw new HttpError(403, 'avatar_locked');
        }
      }
    }
    q('UPDATE users SET avatar = ?, avatar_color = ? WHERE id = ?').run(avatar ?? user.avatar, color ?? user.avatar_color, userId);
  }

  function setShowcase(userId, slots) {
    if (!Array.isArray(slots) || slots.length > SHOWCASE_SLOTS) throw new HttpError(400, 'invalid_showcase');
    const ids = slots.map(idOf);
    const owned = ownedAmong(userId, ids.filter(Boolean));
    const clean = ids.map((id) => (id && owned.has(id) ? id : null));
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
    return {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      avatarColor: user.avatar_color,
      level: levelFromXp(user.xp).level,
      unique: uniqueCount(user.id),
      total: catalog.totals().tracks,
    };
  }

  function publicProfile(viewerId, username) {
    const target = q('SELECT * FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(String(username || ''));
    if (!target) throw new HttpError(404, 'user_not_found');
    const stats = statsFor(target.id);
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
    const slotIds = JSON.parse(target.showcase).map(idOf);
    const holoSlots = new Set(slotIds.some(Boolean)
      ? q("SELECT track_id FROM cards WHERE user_id = ? AND variant = 'holo' AND track_id IN (SELECT value FROM json_each(?))").all(target.id, json(slotIds.filter(Boolean))).map((r) => r.track_id)
      : []);
    const ownedSlots = ownedAmong(target.id, slotIds.filter(Boolean));
    // Vinyles : albums complétés (les 120 plus récents), édition holo si toutes les cartes de l'album sont holo.
    const vinylRows = q(`SELECT substr(a.key, 7) AS album_id, a.created_at, al.track_count,
        (SELECT COUNT(DISTINCT c.track_id) FROM cards c JOIN cat_tracks t ON t.id = c.track_id
          WHERE c.user_id = a.user_id AND c.variant = 'holo' AND t.album_id = al.id) AS holo
      FROM achievements a JOIN cat_albums al ON al.id = substr(a.key, 7)
      WHERE a.user_id = ? AND a.key LIKE 'album:%' ORDER BY a.created_at DESC, a.key LIMIT 120`).all(target.id).reverse();
    const vinyls = vinylRows.map((r) => ({ albumId: r.album_id, at: r.created_at, edition: r.holo >= r.track_count ? 'holo' : 'black' }));
    const mastered = q("SELECT substr(key, 8) AS id FROM achievements WHERE user_id = ? AND key LIKE 'artist:%' ORDER BY created_at DESC LIMIT 100")
      .all(target.id).map((r) => r.id);
    // Prochains vinyles : les albums commencés les plus avancés.
    const upcoming = Object.entries(stats.albums).filter(([, p]) => p.pct < 1)
      .sort((a, b) => b[1].pct - a[1].pct || b[1].owned - a[1].owned).slice(0, 3)
      .map(([albumId, progress]) => ({ albumId, progress }));
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
        albumsTotal: stats.catalog.albums,
        artistsMastered: stats.artistsMastered,
        artistsTotal: stats.catalog.artists,
        promos: stats.promos.owned,
        promosTotal: stats.promos.total,
      },
      showcase: slotIds.map((id) => (id && ownedSlots.has(id) ? { trackId: id, variant: holoSlots.has(id) ? 'holo' : 'std' } : null)),
      completedAlbums: vinyls.map((v) => v.albumId),
      vinyls,
      masteredArtists: mastered,
      upcoming,
      friendship,
      requestId,
      catalog: refs({
        trackIds: slotIds.filter(Boolean),
        albumIds: [...vinyls.map((v) => v.albumId), ...upcoming.map((u) => u.albumId), avatarAlbum(target.avatar)].filter(Boolean),
        artistIds: mastered,
      }),
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
    const albumIds = [...friends, ...incoming, ...outgoing].map((e) => avatarAlbum(e.user.avatar)).filter(Boolean);
    return { friends, incoming, outgoing, catalog: refs({ albumIds }) };
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
    const f = q('SELECT * FROM friendships WHERE id = ?').get(Number(requestId) || 0);
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
    const f = friendshipBetween(userId, Number(otherId) || 0);
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
      genres: [{ id: 'all', count: catalog.totals().tracks }, ...catalog.genres().map((g) => ({ id: g.id, count: g.tracks }))],
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
  async function previewFor(track) {
    if (config.blindtestAudio !== 'itunes' || !track) return null;
    const trackId = track.id;
    if (previewCache.has(trackId)) return previewCache.get(trackId);
    const cached = q('SELECT url, fetched_at FROM previews WHERE track_id = ?').get(trackId);
    const week = 7 * 86_400_000;
    if (cached && Date.now() - cached.fetched_at < (cached.url ? week : week / 7)) {
      previewCache.set(trackId, cached.url);
      return cached.url;
    }
    const artist = track.artist.split(' & ')[0];
    const title = track.title.replace(/\*+/g, '');
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
    if (previewCache.size > 2000) previewCache.delete(previewCache.keys().next().value);
    return url;
  }

  async function roundPayload(questions, index, admin) {
    const qn = questions[index];
    const views = new Map(catalog.tracks(qn.choices).map((t) => [t.id, t]));
    const answer = views.get(qn.answer);
    const audio = await previewFor(answer);
    return {
      // L'admin reçoit la bonne réponse pour pouvoir tester le jeu rapidement.
      answer: admin ? qn.answer : undefined,
      index,
      rounds: questions.length,
      choices: qn.choices.filter((id) => views.has(id)).map((id) => ({ id, title: views.get(id).title, artist: views.get(id).artist })),
      audio,
      clues: audio || !answer ? null : blindtestClues(answer),
      seconds: BLINDTEST.roundSeconds,
    };
  }

  async function startBlindtest(userId, genre) {
    if (typeof genre !== 'string' || (genre !== 'all' && !catalog.genres().some((g) => g.id === genre))) throw new HttpError(400, 'invalid_genre');
    const user = getUser(userId);
    const rewarded = isAdmin(user) || rewardedToday(userId) < BLINDTEST.rewardedGamesPerDay;
    const questions = buildBlindtest(genre, secureRandom, catalog);
    if (questions.length < BLINDTEST.rounds || questions.some((qq) => qq.choices.length < 2)) throw new HttpError(409, 'not_enough_tracks');
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
    const game = q('SELECT * FROM blindtest_games WHERE id = ? AND user_id = ?').get(String(gameId || ''), userId);
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
      qn.picked = idOf(choice);
      qn.points = points;
      const score = game.score + points;
      const correctCount = game.correct + (correct ? 1 : 0);
      const last = game.current === questions.length - 1;
      let final = null;
      if (last) {
        const rewardPacks = game.rewarded ? blindtestReward(correctCount) : 0;
        const xp = correctCount * 10;
        q('UPDATE users SET bonus_packs = bonus_packs + ?, xp = xp + ? WHERE id = ?').run(rewardPacks, xp, userId);
        q('UPDATE blindtest_games SET finished_at = ?, reward_packs = ? WHERE id = ?').run(Date.now(), rewardPacks, game.id);
        final = { score, correct: correctCount, rounds: questions.length, rewardPacks, rewarded: !!game.rewarded, xp };
      }
      q('UPDATE blindtest_games SET questions = ?, score = ?, correct = ? WHERE id = ?').run(JSON.stringify(questions), score, correctCount, game.id);
      return { result: { correct, answer: qn.answer, picked: qn.picked, points, score }, final, catalog: refs({ trackIds: [qn.answer] }) };
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
    q('UPDATE blindtest_games SET questions = ?, current = ? WHERE id = ?').run(JSON.stringify(questions), index, game.id);
    return { round };
  }

  // ----- notes & critiques ----------------------------------------------------

  const REVIEW_MAX = 2000;

  function checkItem(type, id) {
    const ok = idOf(id) && (type === 'album' ? !!catalog.album(id) : type === 'track' ? !!catalog.track(id) : false);
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

  /** Références des éléments notés (titres, visuels) et des photos de profil des auteurs. */
  function ratingRefs(items, authors = []) {
    return refs({
      albumIds: [...items.filter((x) => x.type === 'album').map((x) => x.id), ...authors.map((a) => avatarAlbum(a.avatar)).filter(Boolean)],
      trackIds: items.filter((x) => x.type === 'track').map((x) => x.id),
    });
  }

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
      catalog: ratingRefs([], [...reviews, ...friendScores].map((r) => r.user)),
    };
    if (type === 'album') {
      const trackIds = json(catalog.albumTrackIds(id));
      const tracks = {};
      for (const r of q("SELECT item_id, COUNT(*) AS n, AVG(score) AS a FROM ratings WHERE item_type = 'track' AND item_id IN (SELECT value FROM json_each(?)) GROUP BY item_id").all(trackIds)) {
        tracks[r.item_id] = { count: r.n, average: r.a };
      }
      for (const r of q("SELECT item_id, score FROM ratings WHERE user_id = ? AND item_type = 'track' AND item_id IN (SELECT value FROM json_each(?))").all(viewerId, trackIds)) {
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
    const target = q('SELECT * FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(String(username || ''));
    if (!target) throw new HttpError(404, 'user_not_found');
    // Seuls les éléments encore au catalogue comptent (jointure plutôt qu'une recherche par ligne).
    const rows = q(`SELECT r.item_type, r.item_id, r.score, r.review, r.updated_at FROM ratings r
      WHERE r.user_id = ? AND ((r.item_type = 'album' AND EXISTS (SELECT 1 FROM cat_albums al WHERE al.id = r.item_id))
        OR (r.item_type = 'track' AND EXISTS (SELECT 1 FROM cat_tracks t WHERE t.id = r.item_id)))
      ORDER BY r.updated_at DESC`).all(target.id);
    const entry = (r) => ({ type: r.item_type, id: r.item_id, score: r.score, review: r.review, updatedAt: r.updated_at });
    const albums = rows.filter((r) => r.item_type === 'album');
    const result = {
      stats: { ...summarize(rows.map((r) => r.score)), albums: albums.length, tracks: rows.length - albums.length, reviews: rows.filter((r) => r.review).length },
      topAlbums: [...albums].sort((a, b) => b.score - a.score || b.updated_at - a.updated_at).slice(0, 4).map(entry),
      topTracks: rows.filter((r) => r.item_type === 'track').sort((a, b) => b.score - a.score || b.updated_at - a.updated_at).slice(0, 5).map(entry),
      recent: rows.slice(0, 12).map(entry),
      reviews: rows.filter((r) => r.review).slice(0, 10).map(entry),
    };
    result.catalog = ratingRefs([...result.topAlbums, ...result.topTracks, ...result.recent, ...result.reviews]);
    return result;
  }

  /** Dernières notes des amis. */
  function friendsFeed(userId) {
    const ids = [...friendIds(userId)];
    if (!ids.length) return { items: [], catalog: refs() };
    const items = q(`${WITH_AUTHOR} WHERE r.user_id IN (${ids.map(() => '?').join(',')}) ORDER BY r.updated_at DESC LIMIT 20`).all(...ids)
      .map((r) => ({ user: author(r), type: r.item_type, id: r.item_id, score: r.score, review: r.review, updatedAt: r.updated_at }));
    const catalogRefs = ratingRefs(items, items.map((i) => i.user));
    const known = new Set([...catalogRefs.albums.map((a) => `album:${a.id}`), ...catalogRefs.tracks.map((t) => `track:${t.id}`)]);
    return { items: items.filter((i) => known.has(`${i.type}:${i.id}`)), catalog: catalogRefs };
  }

  function setRatingScale(userId, scale) {
    if (!['stars', 'points'].includes(scale)) throw new HttpError(400, 'invalid_scale');
    q('UPDATE users SET rating_scale = ? WHERE id = ?').run(scale, userId);
  }

  function adminReviews() {
    const items = q(`${WITH_AUTHOR} WHERE r.review IS NOT NULL ORDER BY r.updated_at DESC LIMIT 60`).all()
      .map((r) => ({ user: author(r), type: r.item_type, id: r.item_id, score: r.score, review: r.review, updatedAt: r.updated_at }));
    return { items, catalog: ratingRefs(items, items.map((i) => i.user)) };
  }

  /** Supprime le texte d'une critique ; la note du joueur est conservée. */
  function adminDeleteReview(userId, type, id) {
    const res = q('UPDATE ratings SET review = NULL WHERE user_id = ? AND item_type = ? AND item_id = ? AND review IS NOT NULL').run(Number(userId) || 0, String(type), String(id));
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
      catalog: catalog.totals(),
      adminCount: config.adminEmails.length,
      odds: packOdds(),
      slots: PACK_SLOTS,
      rarities: RARITIES,
      config: { packRegenMinutes: config.packRegenMinutes, packMaxStock: config.packMaxStock, blindtestAudio: config.blindtestAudio },
    };
  }

  function adminGrant(targetId, { packs = 0, royalties = 0 }) {
    const p = Math.max(0, Math.min(1000, Math.floor(Number(packs) || 0)));
    const r = Math.max(0, Math.min(1_000_000, Math.floor(Number(royalties) || 0)));
    const res = q('UPDATE users SET bonus_packs = bonus_packs + ?, royalties = royalties + ? WHERE id = ?').run(p, r, Number(targetId) || 0);
    if (!res.changes) throw new HttpError(404, 'user_not_found');
    return { packs: p, royalties: r };
  }

  function adminResetCollection(userId) {
    tx(db, () => {
      q('DELETE FROM cards WHERE user_id = ?').run(userId);
      q('DELETE FROM achievements WHERE user_id = ?').run(userId);
      q("UPDATE users SET xp = 0, avatar = 'initials', showcase = '[]' WHERE id = ?").run(userId);
    });
    dropStats(userId);
  }

  /**
   * Complète les 20 albums de base (graine), ou un album donné. Le catalogue complet (250 000 cartes) n'est jamais
   * donné d'un coup : la collection de l'admin resterait impossible à afficher.
   */
  function adminCompleteCollection(userId, albumId) {
    const id = idOf(albumId);
    if (albumId != null && !(id && catalog.album(id))) throw new HttpError(404, 'unknown_album');
    tx(db, () => {
      const now = Date.now();
      const where = id ? 'album_id = ?' : "source = 'seed'";
      const args = id ? [id] : [];
      q(`INSERT OR IGNORE INTO cards (user_id, track_id, variant, count, first_at) SELECT ?, id, 'std', 1, ? FROM cat_tracks WHERE ${where}`).run(userId, now, ...args);
      const albums = id ? [id] : q("SELECT id FROM cat_albums WHERE source = 'seed'").all().map((r) => r.id);
      const ach = q('INSERT OR IGNORE INTO achievements (user_id, key, created_at) VALUES (?, ?, ?)');
      for (const a of albums) ach.run(userId, `album:${a}`, now);
      // Artistes dont toutes les cartes sont maintenant possédées.
      const artists = q(`SELECT DISTINCT artist_id FROM cat_tracks WHERE ${where}`).all(...args).map((r) => r.artist_id);
      for (const artistId of artists) {
        const ids = catalog.artistTrackIds(artistId);
        if (ids.length && ownedAmong(userId, ids).size === ids.length) ach.run(userId, `artist:${artistId}`, now);
      }
    });
    dropStats(userId);
  }

  /** Prépare un album complet à une carte près, pour tester la célébration de fin d'album. */
  function adminAlmostAlbum(userId, albumId) {
    const id = idOf(albumId);
    const list = id ? catalog.albumTracks(id) : [];
    if (!list.length) throw new HttpError(404, 'unknown_album');
    const missing = list[Math.floor(secureRandom() * list.length)];
    tx(db, () => {
      const now = Date.now();
      const ins = q("INSERT OR IGNORE INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, 'std', 1, ?)");
      for (const t of list) if (t.id !== missing.id) ins.run(userId, t.id, now);
      q('DELETE FROM cards WHERE user_id = ? AND track_id = ?').run(userId, missing.id);
      q('DELETE FROM achievements WHERE user_id = ? AND key IN (?, ?)').run(userId, `album:${id}`, `artist:${missing.artistId}`);
    });
    dropStats(userId);
    return { missing: missing.id, catalog: refs({ trackIds: [missing.id], albumIds: [id] }) };
  }

  // ----- catalogue (navigation) -------------------------------------------------

  const GROUP_BY = new Set(['genre', 'decade']);
  const SORTS = new Set(['popular', 'progress', 'title', 'year', 'recent']);

  const idList = (raw, max) => String(raw || '').split(',').map((x) => x.trim()).filter((x) => x && x.length <= 80).slice(0, max);

  function browseAlbums(userId, query) {
    // ?ids=a,b,c : ces albums précis (vignettes de l'accueil, du profil...), avec la progression du joueur.
    if (query.ids != null) {
      const items = idList(query.ids, 100).map((id) => catalog.album(id)).filter(Boolean);
      const counts = albumCounts(userId, items.map((a) => a.id));
      return { total: items.length, items: items.map((a) => ({ ...a, owned: counts.get(a.id) || 0 })) };
    }
    const text = typeof query.q === 'string' ? query.q.slice(0, 100) : '';
    const genre = typeof query.genre === 'string' && query.genre.length <= 30 ? query.genre : null;
    const decade = /^\d{4}$/.test(String(query.decade ?? '')) ? Number(query.decade) : null;
    const artistId = idOf(query.artist);
    const sort = SORTS.has(query.sort) ? query.sort : 'popular';
    const offset = Math.min(10_000, Math.max(0, Math.floor(Number(query.offset) || 0)));
    const limit = Math.min(60, Math.max(1, Math.floor(Number(query.limit) || 36)));
    return catalog.searchAlbums({ q: text, genre, decade, artistId, sort, mine: query.mine === '1' || query.mine === 'true', offset, limit, userId });
  }

  function albumDetail(id) {
    const album = idOf(id) && catalog.album(id);
    if (!album) throw new HttpError(404, 'unknown_album');
    return { album, tracks: catalog.albumTracks(id), artist: catalog.artist(album.artistId) };
  }

  function artistDetail(id) {
    const artist = idOf(id) && catalog.artist(id);
    if (!artist) throw new HttpError(404, 'unknown_artist');
    return { artist, albums: catalog.artistAlbums(id), promos: catalog.artistTracks(id).filter((t) => t.kind === 'promo') };
  }

  function tracksByIds(raw) {
    return { tracks: catalog.tracks(idList(raw, 200)) };
  }

  function artistsByIds(raw) {
    return { artists: idList(raw, 100).map((id) => catalog.artist(id)).filter(Boolean) };
  }

  function browsePromos(query) {
    return catalog.promos({ offset: Math.min(100_000, Math.max(0, Number(query.offset) || 0)), limit: Math.min(120, Math.max(1, Number(query.limit) || 60)) });
  }

  function myCards(userId, query) {
    const rarity = RARITIES.includes(query.rarity) ? query.rarity : null;
    return catalog.ownedTracks(userId, {
      q: typeof query.q === 'string' ? query.q.slice(0, 80) : '',
      rarity,
      offset: Math.min(100_000, Math.max(0, Number(query.offset) || 0)),
      limit: Math.min(120, Math.max(1, Number(query.limit) || 60)),
    });
  }

  function groups(userId, by) {
    if (!GROUP_BY.has(by)) throw new HttpError(400, 'invalid_group');
    return { by, groups: catalog.groupStats(userId, by) };
  }

  return {
    getUser, isAdmin, syncPacks, state, openPacks, openAlbumPack, buyPack, recycleDuplicates, pressCard,
    setAvatar, setShowcase, setLang, publicProfile,
    listFriends, requestFriend, respondFriend, removeFriend,
    blindtestInfo, startBlindtest, answerBlindtest, nextBlindtestRound,
    itemRatings, rate, unrate, userRatings, friendsFeed, setRatingScale,
    adminOverview, adminGrant, adminResetCollection, adminCompleteCollection, adminAlmostAlbum, adminReviews, adminDeleteReview,
    browseAlbums, albumDetail, artistDetail, tracksByIds, artistsByIds, browsePromos, myCards, groups,
    welcome: { packs: ECONOMY.welcomePacks, royalties: ECONOMY.welcomeRoyalties },
  };
}
