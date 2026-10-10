// Logique métier du jeu côté serveur (comptes, boosters, collection, amis, blind test, admin).
// Le catalogue (jusqu'à 20 000 albums et plus) vient de server/catalog.js : rien ici ne parcourt tout le catalogue
// ni toute la collection d'un joueur pour répondre à une question sur quelques cartes. Les compteurs dénormalisés
// (user_album_progress, users.unique_cards, achievements.rank) sont tenus à jour dans la même transaction que les
// cartes ; les événements du domaine (cards.added, album.completed…) partent sur le bus APRÈS la validation.
import { config } from './config.js';
import { tx } from './db.js';
import { clampInt } from './catalog.js';
import { newId, secureRandom } from './security.js';
import { createLru } from './lru.js';
import { decodeCursor, keysetPage } from './paging.js';
import { dayStart as parisDayStart } from '../shared/periods.js';
import {
  rollPack, rollAlbumPack, newAchievements, xpForCard, newCardRoyalties, recycleValue, pressCost, levelFromXp,
  ECONOMY, BLINDTEST, AVATAR_COLORS, RARITIES, packOdds, PACK_SLOTS,
  buildBlindtest, blindtestClues, blindtestPoints, blindtestReward,
  ADVANCED_ALBUMS, isHit, levelRewards, showcaseSlots, wishlistMax, parseBoosterTheme, themeFilterOf, THEME_GENRES,
} from '../shared/rules.js';
import { cleanSelection, cosmeticsBetween, cosmeticsForLevel } from '../shared/cosmetics.js';

export class HttpError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const INTERVAL = () => config.packRegenMinutes * 60_000;
// Répartition des notes de 0 à 10 en JSON (rating_stats.dist), comme l'étape v2 de db.js.
const RATING_DIST = Array.from({ length: 11 }, (_, i) => `SUM(score = ${i})`).join(', ');

/** Identifiant reçu d'une requête : une chaîne courte, sinon rien (node:sqlite refuse les tableaux et booléens). */
const idOf = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);

/** Plateformes d'écoute proposées en premier (réglage « Plateforme d'écoute préférée »). */
export const LISTEN_PLATFORMS = ['deezer', 'spotify', 'apple'];
/** Durée pendant laquelle un joueur dont la demande d'ami a été refusée ne peut pas la renvoyer. */
export const FRIEND_COOLDOWN_MS = 7 * 86_400_000;
const MINUTE = 60_000;

/** JSON d'une colonne TEXT : objet lu, ou `fallback` si la valeur est absente ou illisible (PLAN.md 3.1). */
export function parseJson(text, fallback) {
  if (typeof text !== 'string' || !text) return fallback;
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * `bus` : bus d'événements du domaine (server/bus.js) ; `deps` est branché par app.js une fois les modules
 * initialisés (`services.bind(deps)`) : règles d'accès (deps.access), notifications (deps.notifications).
 */
export function createServices(db, catalog, { bus = null } = {}) {
  const q = (sql) => db.prepare(sql);
  const json = (list) => JSON.stringify(list);
  let deps = null;
  const access = () => deps?.access || null;

  // Événements à diffuser après la transaction en cours (atomic) : un abonné ne voit jamais un état non validé.
  let queue = null;
  const later = (event, payload) => (queue ? queue.push([event, payload]) : bus?.emit(event, payload));
  /** `fn` dans une transaction, puis diffusion des événements qu'elle a annoncés (rien si elle échoue). */
  function atomic(fn) {
    const outer = queue;
    const mine = [];
    queue = mine;
    let result;
    try {
      result = tx(db, fn);
    } finally {
      queue = outer;
    }
    for (const [event, payload] of mine) later(event, payload);
    return result;
  }

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
  /** Parmi ces clés de succès (« album:x », « artist:y »), celles que le joueur a déjà. */
  const achievedAmong = (userId, keys) => (keys.length
    ? new Set(q('SELECT key FROM achievements WHERE user_id = ? AND key IN (SELECT value FROM json_each(?))').all(userId, json(keys)).map((r) => r.key))
    : new Set());

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
  // Profil public d'un joueur (sans la relation avec celui qui regarde) : 30 s, oublié dès que sa collection change.
  const profileCache = createLru({ max: 2000, ttlMs: 30_000 });
  const dropStats = (userId) => {
    statsCache.delete(userId);
    profileCache.delete(userId);
  };

  /**
   * Albums complétés et artistes maîtrisés : d'après les succès (jamais retirés) encore présents au catalogue,
   * comme les vinyles et les badges du profil. Parcours de la clé primaire du joueur, sans GROUP BY.
   */
  function doneCounts(userId) {
    return q(`SELECT
        (SELECT COUNT(*) FROM achievements a JOIN cat_albums al ON al.id = substr(a.key, 7)
          WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;') AS albums,
        (SELECT COUNT(*) FROM achievements a JOIN cat_artists ar ON ar.id = substr(a.key, 8)
          WHERE a.user_id = ? AND a.key >= 'artist:' AND a.key < 'artist;') AS artists`).get(userId, userId);
  }

  /**
   * Résumé des statistiques pour un état partiel (PLAN.md 4.1.1) : tout ce qui ne demande pas de GROUP BY sur les
   * cartes. Les cartes par rareté et la progression par album et par artiste se déduisent des deltas de la réponse.
   */
  function statsSummary(user) {
    const t = catalog.totals();
    const done = doneCounts(user.id);
    const owned = user.unique_cards;
    return {
      total: { owned, total: t.tracks, pct: t.tracks ? owned / t.tracks : 0 },
      albumsCompleted: done.albums,
      artistsMastered: done.artists,
      catalog: { albums: t.albums, artists: t.artists, tracks: t.tracks },
    };
  }

  /**
   * Recalcule les boosters régénérés depuis la dernière visite. Écrit en base seulement quand un booster est
   * régénéré, ou au plus une fois par minute quand le stock est plein (avant : à chaque lecture de l'état).
   */
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
    const changed = packs !== user.packs || (at !== user.packs_at && (user.packs < max || now - user.packs_at >= MINUTE));
    if (changed) {
      q('UPDATE users SET packs = ?, packs_at = ? WHERE id = ?').run(packs, at, user.id);
      user.packs_at = at;
    }
    user.packs = packs;
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

  /** Préférences du joueur (users.prefs) avec leurs valeurs par défaut. */
  function prefsOf(user) {
    const p = parseJson(user.prefs, {});
    return {
      listen: LISTEN_PLATFORMS.includes(p.listen) ? p.listen : 'deezer',
      emailDigest: p.emailDigest === true,
    };
  }

  /** CGU en vigueur acceptées (version courante). */
  const termsOk = (user) => !!user.terms_accepted_at && user.terms_version === config.termsVersion;

  /** Cosmétiques débloqués (identifiants complets) : ceux du niveau, plus ceux de user_cosmetics (badges, P2). */
  function unlockedCosmeticIds(user) {
    const ids = cosmeticsForLevel(levelFromXp(user.xp).level).map((c) => c.id);
    for (const r of q('SELECT cosmetic_id FROM user_cosmetics WHERE user_id = ?').all(user.id)) ids.push(r.cosmetic_id);
    return ids;
  }

  function selfPayload(user) {
    const level = levelFromXp(user.xp);
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
      level,
      showcase: parseJson(user.showcase, []),
      // Jeu de collection (PLAN.md 6.4 à 6.6) : places selon le niveau, compteur de pitié, cosmétiques choisis.
      slots: { wishlist: wishlistMax(level.level), showcase: showcaseSlots(level.level) },
      pity: user.pity ?? 0,
      cosmetics: cleanSelection(parseJson(user.cosmetics, {}), unlockedCosmeticIds(user)),
      createdAt: user.created_at,
      prefs: prefsOf(user),
      onboarded: user.onboarded_at != null,
      termsOk: termsOk(user),
      termsVersion: user.terms_version || null,
    };
  }

  /** Album de la photo de profil (« album:<id> »), pour l'afficher sans autre requête. */
  const avatarAlbum = (avatar) => (typeof avatar === 'string' && avatar.startsWith('album:') ? avatar.slice(6) : null);

  /** Pastilles du joueur : demandes d'ami reçues en attente, notifications non lues (P0-F). */
  function countsFor(userId) {
    const pendingFriends = q("SELECT COUNT(*) AS n FROM friendships WHERE addressee_id = ? AND status = 'pending'").get(userId).n;
    let unread = 0;
    try {
      unread = Number(deps?.notifications?.unreadCount?.(userId)) || 0;
    } catch (err) {
      console.error('[state] notifications.unreadCount en erreur :', err);
    }
    return { pendingFriends, unread };
  }

  /** Dernière visite : écrite au plus une fois par minute (avant : à chaque lecture de l'état). */
  function touchSeen(user, now = Date.now()) {
    if (user.last_seen_at && now - user.last_seen_at < MINUTE) return;
    q('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, user.id);
    user.last_seen_at = now;
  }

  /**
   * État du joueur connecté. Complet (GET /api/state, connexion) : collection, succès, notes, statistiques.
   * Partiel (`{ partial: true }`, réponses des actions, PLAN.md 4.1.1) : { partial, user, packs, counts,
   * stats: { summary }, serverTime } ; le reste se déduit des deltas de la réponse (client/src/state/mergeState.js).
   */
  function state(userId, { partial = false } = {}) {
    const row = getUser(userId);
    if (!row) throw new HttpError(401, 'unauthenticated');
    const user = syncPacks(row);
    touchSeen(user);
    const self = selfPayload(user);
    const counts = countsFor(userId);
    if (partial) {
      return { partial: true, user: self, packs: packInfo(user), counts, stats: { summary: statsSummary(user) }, serverTime: Date.now() };
    }
    // r : rareté, pour que le site compte doublons et raretés sans charger chaque carte.
    const cards = q('SELECT c.track_id, c.variant, c.count, c.first_at, t.rarity FROM cards c JOIN cat_tracks t ON t.id = c.track_id WHERE c.user_id = ?').all(userId)
      .map((r) => ({ t: r.track_id, v: r.variant, c: r.count, at: r.first_at, r: r.rarity }));
    const achievements = q('SELECT key, created_at, rank FROM achievements WHERE user_id = ?').all(userId)
      .map((r) => ({ key: r.key, at: r.created_at, rank: r.rank ?? null }));
    const ratings = q('SELECT item_type, item_id, score FROM ratings WHERE user_id = ?').all(userId)
      .map((r) => ({ t: r.item_type, i: r.item_id, s: r.score }));
    return {
      user: self,
      packs: packInfo(user),
      cards,
      achievements,
      ratings,
      counts,
      // Ancien nom de counts.pendingFriends, gardé pendant P0.
      pendingFriends: counts.pendingFriends,
      stats: statsFor(userId),
      catalog: refs({ trackIds: self.showcase.filter(Boolean), albumIds: [avatarAlbum(self.avatar)].filter(Boolean) }),
      serverTime: Date.now(),
      partial: false,
    };
  }

  // ----- cartes ---------------------------------------------------------------

  /** Progression enregistrée du joueur sur ces albums : Map albumId → { owned, holo, total }. */
  function progressOf(userId, albumIds) {
    if (!albumIds.length) return new Map();
    return new Map(q(`SELECT album_id, owned, holo, total FROM user_album_progress
      WHERE user_id = ? AND album_id IN (SELECT value FROM json_each(?))`).all(userId, json(albumIds)).map((r) => [r.album_id, r]));
  }

  /**
   * Recalcule user_album_progress pour ces albums depuis les cartes (même calcul que l'étape v3 de db.js), en
   * parcourant seulement les morceaux de ces albums. À appeler dans la transaction qui a modifié les cartes.
   * CROSS JOIN impose l'ordre des boucles (morceaux des albums, puis cartes du joueur par clé primaire) : sans
   * statistiques, le planificateur parcourrait sinon toutes les cartes du joueur (60 000 pour un gros collectionneur).
   */
  function refreshProgress(userId, albumIds) {
    if (!albumIds.length) return;
    const list = json(albumIds);
    q('DELETE FROM user_album_progress WHERE user_id = ? AND album_id IN (SELECT value FROM json_each(?))').run(userId, list);
    q(`INSERT INTO user_album_progress (user_id, album_id, owned, holo, total, first_at, updated_at)
      SELECT c.user_id, t.album_id, COUNT(DISTINCT c.track_id), COUNT(DISTINCT CASE WHEN c.variant = 'holo' THEN c.track_id END),
             al.track_count, MIN(c.first_at), MAX(c.first_at)
      FROM cat_tracks t CROSS JOIN cards c CROSS JOIN cat_albums al
      WHERE t.album_id IN (SELECT value FROM json_each(?)) AND c.user_id = ? AND c.track_id = t.id AND al.id = t.album_id
      GROUP BY t.album_id`).run(list, userId);
  }

  /** Recompte complet des compteurs d'un joueur (outils admin qui touchent beaucoup de cartes d'un coup). */
  function recountCollection(userId, albumIds = null) {
    if (albumIds) refreshProgress(userId, albumIds);
    q('UPDATE users SET unique_cards = (SELECT COUNT(DISTINCT track_id) FROM cards WHERE user_id = ?) WHERE id = ?').run(userId, userId);
  }

  /** Numéro de pressage du succès : rang du joueur parmi ceux qui ont complété l'album (« Pressage n° 37 »). */
  const insertAchievement = (userId, key, now) => q(`INSERT OR IGNORE INTO achievements (user_id, key, created_at, rank)
    VALUES (?, ?, ?, CASE WHEN ? LIKE 'album:%' THEN (SELECT COUNT(*) + 1 FROM achievements WHERE key = ?) END)`).run(userId, key, now, key, key);

  // ----- niveaux, boosters spéciaux -------------------------------------------------

  /** Ajoute un booster spécial à l'inventaire (user_boosters) ; à appeler dans une transaction. Renvoie son id. */
  function insertBooster(userId, kind, theme, source, now = Date.now()) {
    return Number(q('INSERT INTO user_boosters (user_id, kind, theme, source, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, kind, String(theme).slice(0, 100), String(source).slice(0, 80), now).lastInsertRowid);
  }

  /**
   * Ajoute de l'XP dans la transaction en cours et applique les récompenses de niveau (PLAN.md 6.6) : un booster
   * bonus par niveau gagné, un booster spécial « À ton goût » tous les 10 niveaux ; les cosmétiques du palier se
   * déduisent du niveau. `user` (ligne de users) est mis à jour en mémoire. Renvoie
   * `{ from, to, boosters, themed, cosmetics, wishlist, showcase }` quand un niveau est gagné, sinon null ;
   * l'événement level.up part après la validation.
   */
  function gainXp(user, xp, source = 'game') {
    const amount = Math.floor(Number(xp) || 0);
    if (amount <= 0) return null;
    const from = levelFromXp(user.xp).level;
    q('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, user.id);
    user.xp += amount;
    const to = levelFromXp(user.xp).level;
    if (to <= from) return null;
    const rewards = levelRewards(from, to);
    q('UPDATE users SET bonus_packs = bonus_packs + ? WHERE id = ?').run(rewards.boosters, user.id);
    user.bonus_packs += rewards.boosters;
    for (const l of rewards.themed) insertBooster(user.id, 'theme', 'taste', `level:${l}`);
    later('level.up', { userId: user.id, from, to, source });
    return {
      from, to, boosters: rewards.boosters, themed: rewards.themed.length, cosmetics: cosmeticsBetween(from, to),
      wishlist: rewards.wishlist, showcase: rewards.showcase,
    };
  }

  /** XP d'une autre source (quêtes, battles, badges : deps.collection.addXp) dans sa propre transaction. */
  function addXp(userId, xp, source) {
    return atomic(() => {
      const user = getUser(userId);
      if (!user) throw new HttpError(404, 'user_not_found');
      return gainXp(user, xp, source);
    });
  }

  /**
   * Ajoute des cartes à la collection, attribue XP, succès et récompenses, et tient à jour dans la même transaction
   * user_album_progress, users.unique_cards et achievements.rank. `cards` : [{ trackId, variant }]. À appeler à
   * l'intérieur de atomic() : les événements cards.added, album.completed, artist.mastered et level.up partent après
   * la validation. Renvoie les deltas de la réponse (cards, albumDeltas, artistDeltas, achievements, xp, royalties)
   * et `levelUp` (null sans niveau gagné). Chaque album complété porte `rank` (Pressage n°), `at` et `firstCardAt`
   * (première carte de l'album) pour le moment de complétion (PLAN.md 6.2). `cards.pulled_rarity` garde la rareté
   * au moment du tirage (PLAN.md 6.5).
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
    const progressBefore = progressOf(user.id, albumIds);
    const levelBefore = levelFromXp(user.xp).level;

    const owned = new Set(ownedBefore);
    const seenVariants = new Set(variantsBefore);
    const upsert = q(`INSERT INTO cards (user_id, track_id, variant, count, first_at, pulled_rarity) VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT (user_id, track_id, variant) DO UPDATE SET count = count + 1`);
    let xp = 0;
    // Royalties des nouvelles cartes (pas pour une carte pressée : on vient de la payer).
    let cardRoyalties = 0;
    const newByArtist = new Map();
    const results = list.map(({ trackId, variant }) => {
      const view = views.get(trackId);
      const rarity = view.rarity;
      const newTrack = !owned.has(trackId);
      const newVariant = !seenVariants.has(`${trackId}|${variant}`);
      upsert.run(user.id, trackId, variant, now, rarity);
      owned.add(trackId);
      seenVariants.add(`${trackId}|${variant}`);
      xp += xpForCard(rarity, newTrack);
      if (newTrack) {
        newByArtist.set(view.artistId, (newByArtist.get(view.artistId) || 0) + 1);
        if (source !== 'press') cardRoyalties += newCardRoyalties(rarity);
      }
      return { trackId, variant, rarity, newTrack, newVariant };
    });
    const newTracks = results.filter((r) => r.newTrack).length;

    // Succès : seules les cartes des albums et artistes touchés comptent (morceaux de ces albums et artistes,
    // cherchés dans la clé primaire des cartes du joueur, jamais toute sa collection).
    const albumTracks = new Map(albumIds.map((id) => [id, catalog.albumTrackIds(id)]));
    const artistTracks = new Map(artistIds.map((id) => [id, catalog.artistTrackIds(id)]));
    const scoped = ownedAmong(user.id, [...new Set([...[...albumTracks.values()].flat(), ...[...artistTracks.values()].flat()])]);
    const already = achievedAmong(user.id, [...albumIds.map((id) => `album:${id}`), ...artistIds.map((id) => `artist:${id}`)]);
    const achievements = newAchievements({ owned: scoped, already, touched: [...views.values()], catalog });
    let royalties = cardRoyalties;
    for (const a of achievements) {
      insertAchievement(user.id, a.key, now);
      royalties += a.royalties;
      xp += a.xp;
    }
    const ranks = achievements.length
      ? new Map(q('SELECT key, rank FROM achievements WHERE user_id = ? AND key IN (SELECT value FROM json_each(?))').all(user.id, json(achievements.map((a) => a.key))).map((r) => [r.key, r.rank]))
      : new Map();

    q('UPDATE users SET royalties = royalties + ?, unique_cards = unique_cards + ? WHERE id = ?').run(royalties, newTracks, user.id);
    user.royalties += royalties;
    q('INSERT INTO pack_openings (user_id, source, cards, created_at) VALUES (?, ?, ?, ?)').run(
      user.id, source, JSON.stringify(list.map(({ trackId, variant }) => ({ trackId, variant }))), now,
    );
    refreshProgress(user.id, albumIds);
    dropStats(user.id);

    const progressAfter = progressOf(user.id, albumIds);
    for (const a of achievements) {
      if (a.type !== 'album') continue;
      a.rank = ranks.get(a.key) ?? null;
      a.at = now;
      // Première carte de l'album (« 6 jours après ta première carte »).
      a.firstCardAt = progressAfter.get(a.id)?.first_at ?? now;
    }
    const albumDeltas = albumIds.map((albumId) => {
      const after = progressAfter.get(albumId);
      return { albumId, before: progressBefore.get(albumId)?.owned || 0, after: after?.owned || 0, total: after?.total ?? views.get(ids.find((id) => views.get(id).albumId === albumId)).total };
    }).filter((d) => d.after > d.before);
    const artistDeltas = artistIds.map((artistId) => {
      const trackIds = artistTracks.get(artistId);
      const after = trackIds.filter((id) => scoped.has(id)).length;
      return { artistId, before: after - (newByArtist.get(artistId) || 0), after, total: catalog.artist(artistId)?.trackCount ?? trackIds.length };
    }).filter((d) => d.after > d.before);

    const levelUp = gainXp(user, xp, source);
    const levelAfter = levelFromXp(user.xp).level;
    later('cards.added', { userId: user.id, source, cards: results, albumDeltas, artistDeltas, achievements, levelBefore, levelAfter });
    for (const a of achievements) {
      if (a.type === 'album') later('album.completed', { userId: user.id, albumId: a.id, rank: a.rank, at: now });
      else if (a.type === 'artist') later('artist.mastered', { userId: user.id, artistId: a.id, at: now });
    }

    return {
      cards: results,
      // Date des nouvelles cartes et des succès (cards.first_at, achievements.created_at), pour la fusion du site.
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

  // ----- ciblage des boosters (PLAN.md 6.4) -------------------------------------------------

  /** Albums de la liste d'envies (« Albums recherchés »), dans l'ordre d'ajout. */
  function wishlistAlbumIds(userId) {
    return q(`SELECT li.item_id FROM lists l JOIN list_items li ON li.list_id = l.id
      WHERE l.user_id = ? AND l.kind = 'wishlist' AND li.item_type = 'album' ORDER BY li.position`).all(userId).map((r) => r.item_id);
  }

  /**
   * Albums commencés les plus avancés (ceux à 50 % ou plus d'abord), vers lesquels une partie des boosters est
   * orientée : les 200 albums commencés les plus récemment enrichis (index uap_user_recent, sans GROUP BY sur les
   * cartes), puis les ADVANCED_ALBUMS plus avancés d'entre eux.
   */
  function focusAlbums(userId) {
    return q(`SELECT album_id, owned, total FROM user_album_progress WHERE user_id = ? AND owned < total
      ORDER BY updated_at DESC, album_id LIMIT 200`).all(userId)
      .sort((a, b) => b.owned / b.total - a.owned / a.total || b.owned - a.owned)
      .slice(0, ADVANCED_ALBUMS)
      .map((r) => r.album_id);
  }

  /**
   * Liste d'envies pour le tirage : albums recherchés pas encore complets, et cartes déjà possédées parmi les leurs
   * (le ciblage ne vise que les cartes manquantes). Au plus 24 albums : quelques centaines de cartes.
   */
  function wishlistFocus(userId) {
    const wanted = wishlistAlbumIds(userId);
    if (!wanted.length) return { albumIds: [], owned: new Set() };
    const progress = progressOf(userId, wanted);
    const albumIds = wanted.filter((id) => {
      const p = progress.get(id);
      return !p || p.owned < p.total;
    });
    const owned = ownedAmong(userId, albumIds.flatMap((id) => catalog.albumTrackIds(id)));
    return { albumIds, owned };
  }

  // Artistes du joueur qui ont des promos (cartes possédées ou albums recherchés) : calculés seulement quand
  // l'emplacement promo d'un booster sort, gardés 10 minutes.
  const promoArtistCache = createLru({ max: 5000, ttlMs: 10 * MINUTE });
  function promoArtistsOf(userId, wishlistIds = []) {
    return promoArtistCache.wrap(userId, () => {
      const withPromos = new Set(catalog.promoArtists());
      const mine = new Set();
      for (const r of q(`SELECT DISTINCT al.artist_id FROM user_album_progress p JOIN cat_albums al ON al.id = p.album_id
        WHERE p.user_id = ?`).all(userId)) if (withPromos.has(r.artist_id)) mine.add(r.artist_id);
      for (const r of q(`SELECT DISTINCT t.artist_id FROM cards c JOIN cat_tracks t ON t.id = c.track_id
        WHERE c.user_id = ? AND c.track_id >= 'promo:' AND c.track_id < 'promo;'`).all(userId)) if (withPromos.has(r.artist_id)) mine.add(r.artist_id);
      for (const id of wishlistIds) {
        const artistId = catalog.album(id)?.artistId;
        if (withPromos.has(artistId)) mine.add(artistId);
      }
      return [...mine];
    });
  }

  /** Ciblage complet d'un booster gratuit du joueur (rollPack). */
  function packFocus(userId) {
    const wishlist = wishlistFocus(userId);
    return {
      wishlist,
      focusAlbumIds: focusAlbums(userId),
      promoArtistIds: () => promoArtistsOf(userId, wishlist.albumIds),
    };
  }

  /** Compteur de pitié après une série de boosters standard (`packs` : listes de cartes, dans l'ordre d'ouverture). */
  function nextPity(pity, packs) {
    let n = pity;
    for (const pack of packs) n = pack.some((c) => isHit(c.rarity)) ? 0 : n + 1;
    return n;
  }

  /** Boosters standard tirés l'un après l'autre : la pitié de chacun dépend des précédents. */
  function rollSeries(count, pity, options) {
    const packs = [];
    let n = pity;
    for (let i = 0; i < count; i++) {
      const pack = rollPack(secureRandom, catalog, { ...options, pity: n });
      packs.push(pack);
      n = nextPity(n, [pack]);
    }
    return { packs, pity: n };
  }

  function openPacks(userId, count = 1) {
    return atomic(() => {
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
      const { packs, pity } = rollSeries(n, user.pity ?? 0, packFocus(userId));
      q('UPDATE users SET pity = ? WHERE id = ?').run(pity, user.id);
      user.pity = pity;
      const source = admin ? 'admin-pack' : 'pack';
      const result = addCards(user, packs.flat(), source);
      later('pack.opened', { userId, source, count: n });
      return { packs: packs.map((p) => p.length), ...result, pity };
    });
  }

  /** Une carte ultra ou mieux d'un booster d'album remet aussi la pitié à zéro (sans compter le booster). */
  function resetPityOnHit(user, cards) {
    if (!cards.some((c) => isHit(c.rarity)) || !user.pity) return user.pity ?? 0;
    q('UPDATE users SET pity = 0 WHERE id = ?').run(user.id);
    user.pity = 0;
    return 0;
  }

  /** Booster d'album : 5 cartes de l'album choisi, payé en royalties (gratuit pour l'admin). */
  function openAlbumPack(userId, albumId) {
    const id = idOf(albumId);
    const album = id && catalog.album(id);
    if (!album) throw new HttpError(404, 'unknown_album');
    return atomic(() => {
      const user = getUser(userId);
      const cost = isAdmin(user) ? 0 : ECONOMY.albumPackPrice;
      if (user.royalties < cost) throw new HttpError(409, 'not_enough_royalties');
      q('UPDATE users SET royalties = royalties - ? WHERE id = ?').run(cost, userId);
      user.royalties -= cost;
      const owned = ownedAmong(userId, catalog.albumTrackIds(id));
      const cards = rollAlbumPack(secureRandom, catalog, id, owned);
      const pity = resetPityOnHit(user, cards);
      const result = addCards(user, cards, 'album-pack');
      later('pack.opened', { userId, source: 'album-pack', count: 1 });
      return { spent: cost, albumId: id, packs: [cards.length], ...result, pity };
    });
  }

  /**
   * Genres d'un booster « À ton goût » : les genres favoris du joueur (user_favorites, onboarding), complétés par
   * ceux où il a le plus de cartes. Au plus 3.
   */
  function tasteGenres(userId) {
    const out = q("SELECT item_id FROM user_favorites WHERE user_id = ? AND kind = 'genre' ORDER BY position, created_at LIMIT 3")
      .all(userId).map((r) => r.item_id).filter((g) => THEME_GENRES.includes(g));
    if (out.length < 3) {
      for (const r of q(`SELECT al.genre AS g, SUM(p.owned) AS n FROM user_album_progress p JOIN cat_albums al ON al.id = p.album_id
        WHERE p.user_id = ? GROUP BY al.genre ORDER BY n DESC LIMIT 3`).all(userId)) {
        if (out.length < 3 && r.g && !out.includes(r.g)) out.push(r.g);
      }
    }
    return out;
  }

  /**
   * Ouvre un booster spécial de l'inventaire (PLAN.md 6.10) : thématique (chances du booster standard, pitié
   * comprise, réservoir filtré par le thème) ou d'album (5 cartes de l'album, manquantes d'abord ; `albumId` choisi
   * à l'ouverture pour « album:choice »). Un booster ne s'ouvre qu'une fois, même si deux requêtes se croisent.
   */
  function openSpecialPack(userId, boosterId, { albumId } = {}) {
    const id = Number(boosterId);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'booster_not_found');
    return atomic(() => {
      const row = q('SELECT * FROM user_boosters WHERE id = ? AND user_id = ?').get(id, userId);
      if (!row) throw new HttpError(404, 'booster_not_found');
      if (row.opened_at) throw new HttpError(409, 'booster_opened');
      const user = getUser(userId);
      const parsed = parseBoosterTheme(row.theme);
      let cards;
      let target = null;
      let pity = user.pity ?? 0;
      if (parsed?.kind === 'album' || parsed?.kind === 'choice') {
        target = parsed.kind === 'album' ? parsed.value : idOf(albumId);
        if (!target) throw new HttpError(400, 'album_required');
        if (!catalog.album(target)) throw new HttpError(404, 'unknown_album');
        cards = rollAlbumPack(secureRandom, catalog, target, ownedAmong(userId, catalog.albumTrackIds(target)));
        pity = resetPityOnHit(user, cards);
      } else {
        // Thème inconnu (événement retiré…) : booster standard, sans ciblage.
        const theme = themeFilterOf(parsed, { tasteGenres: parsed?.kind === 'taste' ? tasteGenres(userId) : [] });
        const series = rollSeries(1, pity, { theme });
        cards = series.packs[0];
        pity = series.pity;
        q('UPDATE users SET pity = ? WHERE id = ?').run(pity, user.id);
        user.pity = pity;
      }
      const now = Date.now();
      const done = q('UPDATE user_boosters SET opened_at = ? WHERE id = ? AND opened_at IS NULL').run(now, id);
      if (!done.changes) throw new HttpError(409, 'booster_opened');
      const result = addCards(user, cards, 'special');
      later('pack.opened', { userId, source: 'special', count: 1, theme: row.theme });
      return { booster: { id, kind: row.kind, theme: row.theme }, albumId: target, packs: [cards.length], ...result, pity };
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

  /**
   * Promos pressables (PLAN.md 6.4) : le joueur a complété au moins un album de cet artiste. Parcourt les albums de
   * l'artiste (index cat_albums par artiste) et cherche chaque succès par la clé primaire du joueur.
   */
  const promoUnlocked = (userId, artistId) => !!q(`SELECT 1 FROM cat_albums al WHERE al.artist_id = ?
    AND EXISTS (SELECT 1 FROM achievements a WHERE a.user_id = ? AND a.key = 'album:' || al.id) LIMIT 1`).get(artistId, userId);

  /**
   * Ce que coûte le pressage d'une carte pour ce joueur (GET /api/me/press/:trackId) : `cost` (null si impossible),
   * `reason` : null | 'owned' | 'promo_locked' (promo d'un artiste dont aucun album n'est complété).
   */
  function pressInfo(userId, trackId) {
    const id = idOf(trackId);
    const track = id && catalog.track(id);
    if (!track) throw new HttpError(404, 'unknown_track');
    const user = getUser(userId);
    const unlocked = track.rarity === 'promo' ? promoUnlocked(userId, track.artistId) : false;
    const base = pressCost(track.rarity, { promoUnlocked: unlocked });
    const owned = ownsTrack(userId, id);
    return {
      trackId: id,
      cost: isAdmin(user) ? 0 : base,
      pressable: !owned && (base != null || isAdmin(user)),
      reason: owned ? 'owned' : base == null ? 'promo_locked' : null,
      artistId: track.artistId,
    };
  }

  /** « Presser » une carte manquante en échange de royalties (promo : un album de l'artiste complété, 1 200). */
  function pressCard(userId, trackId) {
    const id = idOf(trackId);
    const track = id && catalog.track(id);
    if (!track) throw new HttpError(404, 'unknown_track');
    return atomic(() => {
      const user = getUser(userId);
      const admin = isAdmin(user);
      const base = pressCost(track.rarity, { promoUnlocked: track.rarity === 'promo' && promoUnlocked(userId, track.artistId) });
      // L'admin presse gratuitement, promos comprises, pour tester.
      if (base == null && !admin) throw new HttpError(409, 'promo_locked', { artistId: track.artistId });
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
    // « auto » : couleur déterminée par le joueur (calculée par le site à partir de son identifiant).
    if (color !== undefined && color !== 'auto' && !AVATAR_COLORS.includes(color)) throw new HttpError(400, 'invalid_color');
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
    profileCache.delete(userId);
  }

  /** Vitrine : 6 cartes, +1 aux niveaux 10 et 30 (PLAN.md 6.6). */
  function setShowcase(userId, slots) {
    const max = showcaseSlots(levelFromXp(getUser(userId)?.xp || 0).level);
    if (!Array.isArray(slots) || slots.length > max) throw new HttpError(400, 'invalid_showcase');
    const ids = slots.map(idOf);
    const owned = ownedAmong(userId, ids.filter(Boolean));
    const clean = ids.map((id) => (id && owned.has(id) ? id : null));
    while (clean.length < max) clean.push(null);
    q('UPDATE users SET showcase = ? WHERE id = ?').run(JSON.stringify(clean), userId);
    profileCache.delete(userId);
    return clean;
  }

  function setLang(userId, lang) {
    if (!['fr', 'en'].includes(lang)) throw new HttpError(400, 'invalid_lang');
    q('UPDATE users SET lang = ? WHERE id = ?').run(lang, userId);
  }

  /** Préférences (users.prefs) : `listen` (plateforme d'écoute préférée), `emailDigest` ; champs inconnus ignorés. */
  function setPrefs(userId, prefs) {
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) throw new HttpError(400, 'invalid_input', { field: 'prefs' });
    const current = parseJson(getUser(userId).prefs, {});
    const next = { ...current };
    if (prefs.listen !== undefined) {
      if (!LISTEN_PLATFORMS.includes(prefs.listen)) throw new HttpError(400, 'invalid_input', { field: 'prefs.listen' });
      next.listen = prefs.listen;
    }
    if (prefs.emailDigest !== undefined) {
      if (typeof prefs.emailDigest !== 'boolean') throw new HttpError(400, 'invalid_input', { field: 'prefs.emailDigest' });
      next.emailDigest = prefs.emailDigest;
    }
    q('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(next), userId);
  }

  function friendshipBetween(a, b) {
    return q(`SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`)
      .get(a, b, b, a);
  }

  /**
   * Résumés de joueurs (UserSummary, PLAN.md 4.0) en exactement deux requêtes : les joueurs (json_each), puis les
   * amitiés du joueur qui regarde parmi eux. Map id → { id, username, avatar, avatarColor, level, uniqueCards, frame,
   * title, relation }, `relation` = 'self' | 'friend' | 'incoming' | 'outgoing' | null. Les joueurs bloqués dans un
   * sens ou dans l'autre (deps.access.hiddenIds, ou `hidden` fourni) et les comptes non vérifiés sont absents.
   */
  function userSummaries(ids, viewerId = null, { hidden } = {}) {
    const out = new Map();
    const skip = hidden ?? (viewerId ? access()?.hiddenIds?.(viewerId) : null) ?? new Set();
    const wanted = [...new Set([...ids].map(Number))].filter((id) => Number.isInteger(id) && id > 0 && !skip.has(id));
    if (!wanted.length) return out;
    const list = json(wanted);
    const rows = q(`SELECT id, username, avatar, avatar_color, xp, unique_cards, cosmetics FROM users
      WHERE id IN (SELECT value FROM json_each(?)) AND email_verified_at IS NOT NULL`).all(list);
    const relation = new Map();
    if (viewerId) {
      for (const f of q(`SELECT requester_id, addressee_id, status FROM friendships
        WHERE (requester_id = ? AND addressee_id IN (SELECT value FROM json_each(?)))
           OR (addressee_id = ? AND requester_id IN (SELECT value FROM json_each(?)))`).all(viewerId, list, viewerId, list)) {
        const other = f.requester_id === viewerId ? f.addressee_id : f.requester_id;
        if (f.status === 'accepted') relation.set(other, 'friend');
        else if (f.status === 'pending') relation.set(other, f.requester_id === viewerId ? 'outgoing' : 'incoming');
      }
    }
    for (const u of rows) {
      const cosmetics = parseJson(u.cosmetics, {});
      out.set(u.id, {
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        avatarColor: u.avatar_color,
        level: levelFromXp(u.xp).level,
        uniqueCards: u.unique_cards,
        frame: typeof cosmetics.frame === 'string' ? cosmetics.frame : null,
        title: typeof cosmetics.title === 'string' ? cosmetics.title : null,
        relation: u.id === viewerId ? 'self' : relation.get(u.id) || null,
      });
    }
    return out;
  }

  /** Albums des photos de profil de ces résumés (à passer à refs() pour afficher leur visuel). */
  const summaryAlbums = (summaries) => [...summaries].map((u) => avatarAlbum(u?.avatar)).filter(Boolean);

  /**
   * Partie du profil qui ne dépend que du joueur affiché (gardée 30 s) : aucune requête ne parcourt toute sa
   * collection. Vinyles : les 120 succès d'album les plus récents d'abord (LIMIT avant tout le reste), édition holo
   * lue dans user_album_progress ; prochains vinyles : les albums commencés les plus avancés.
   */
  function profileOf(target) {
    const totals = catalog.totals();
    const done = doneCounts(target.id);
    const promos = q(`SELECT COUNT(*) AS n FROM cat_tracks t WHERE t.kind = 'promo'
      AND EXISTS (SELECT 1 FROM cards c WHERE c.user_id = ? AND c.track_id = t.id)`).get(target.id).n;
    const slotIds = parseJson(target.showcase, []).map(idOf);
    const slotList = slotIds.filter(Boolean);
    const holoSlots = new Set(slotList.length
      ? q("SELECT track_id FROM cards WHERE user_id = ? AND variant = 'holo' AND track_id IN (SELECT value FROM json_each(?))").all(target.id, json(slotList)).map((r) => r.track_id)
      : []);
    const ownedSlots = ownedAmong(target.id, slotList);
    const vinylRows = q(`WITH v AS (
        SELECT a.key, a.created_at, a.rank FROM achievements a
        WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;' AND EXISTS (SELECT 1 FROM cat_albums al WHERE al.id = substr(a.key, 7))
        ORDER BY a.created_at DESC, a.key LIMIT 120)
      SELECT substr(v.key, 7) AS album_id, v.created_at, v.rank, p.holo, p.total
      FROM v LEFT JOIN user_album_progress p ON p.user_id = ? AND p.album_id = substr(v.key, 7)
      ORDER BY v.created_at DESC, v.key`).all(target.id, target.id).reverse();
    const vinyls = vinylRows.map((r) => ({
      albumId: r.album_id, at: r.created_at, rank: r.rank ?? null, edition: r.total && r.holo >= r.total ? 'holo' : 'black',
    }));
    const mastered = q(`SELECT substr(key, 8) AS id FROM achievements WHERE user_id = ? AND key >= 'artist:' AND key < 'artist;'
      ORDER BY created_at DESC LIMIT 100`).all(target.id).map((r) => r.id);
    const upcoming = q(`SELECT p.album_id, p.owned, p.total FROM user_album_progress p
      WHERE p.user_id = ? AND p.total > 0 AND p.owned < p.total AND EXISTS (SELECT 1 FROM cat_albums al WHERE al.id = p.album_id)
      ORDER BY CAST(p.owned AS REAL) / p.total DESC, p.owned DESC, p.album_id LIMIT 3`).all(target.id)
      .map((r) => ({ albumId: r.album_id, progress: { owned: r.owned, total: r.total, pct: r.owned / r.total } }));
    return {
      id: target.id,
      username: target.username,
      avatar: target.avatar,
      avatarColor: target.avatar_color,
      level: levelFromXp(target.xp),
      createdAt: target.created_at,
      stats: {
        unique: target.unique_cards,
        total: totals.tracks,
        albumsCompleted: done.albums,
        albumsTotal: totals.albums,
        artistsMastered: done.artists,
        artistsTotal: totals.artists,
        promos,
        promosTotal: totals.promos,
      },
      showcase: slotIds.map((id) => (id && ownedSlots.has(id) ? { trackId: id, variant: holoSlots.has(id) ? 'holo' : 'std' } : null)),
      completedAlbums: vinyls.map((v) => v.albumId),
      vinyls,
      masteredArtists: mastered,
      upcoming,
      catalog: refs({
        trackIds: slotList,
        albumIds: [...vinyls.map((v) => v.albumId), ...upcoming.map((u) => u.albumId), avatarAlbum(target.avatar)].filter(Boolean),
        artistIds: mastered,
      }),
    };
  }

  /** Profil public (GET /api/users/:username) : même forme qu'avant, sans `role` ; la relation est calculée à part. */
  function publicProfile(viewerId, username) {
    const target = q('SELECT * FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(String(username || ''));
    if (!target || (target.id !== viewerId && access()?.isBlocked?.(viewerId, target.id))) throw new HttpError(404, 'user_not_found');
    const profile = profileCache.wrap(target.id, () => profileOf(target));
    let friendship = 'none';
    let requestId = null;
    if (target.id === viewerId) friendship = 'self';
    else {
      const f = friendshipBetween(viewerId, target.id);
      if (f && f.status !== 'declined') {
        requestId = f.id;
        friendship = f.status === 'accepted' ? 'friends' : f.requester_id === viewerId ? 'outgoing' : 'incoming';
      }
    }
    return { ...profile, friendship, requestId };
  }

  // ----- amis -----------------------------------------------------------------

  /** Amis et demandes (en attente) : une requête pour les liens, une pour les joueurs (userSummaries). */
  function listFriends(userId) {
    const rows = q(`SELECT id, requester_id, addressee_id, status, created_at, responded_at FROM friendships
      WHERE (requester_id = ? OR addressee_id = ?) AND status IN ('accepted', 'pending') ORDER BY created_at DESC, id DESC`).all(userId, userId);
    const other = (r) => (r.requester_id === userId ? r.addressee_id : r.requester_id);
    const users = userSummaries(rows.map(other), userId);
    const total = catalog.totals().tracks;
    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const r of rows) {
      const u = users.get(other(r));
      if (!u) continue;
      // `unique` et `total` : noms d'avant UserSummary, gardés pour les pages existantes.
      const entry = { requestId: r.id, since: r.responded_at || r.created_at, user: { ...u, unique: u.uniqueCards, total } };
      if (r.status === 'accepted') friends.push(entry);
      else if (r.addressee_id === userId) incoming.push(entry);
      else outgoing.push(entry);
    }
    return { friends, incoming, outgoing, catalog: refs({ albumIds: summaryAlbums(users.values()) }) };
  }

  /**
   * Demande d'ami par nom d'utilisateur (écriture « active » : P0-F peut la refuser à un compte suspendu ou qui n'a
   * pas accepté les CGU en vigueur). Quota quotidien ; après un refus, 7 jours d'attente (409 request_cooldown) ;
   * un joueur bloqué dans un sens ou dans l'autre répond comme un pseudo inconnu (404, pas de fuite).
   */
  function requestFriend(userId, username) {
    const me = getUser(userId);
    access()?.assertActive?.(me);
    const target = q('SELECT * FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(String(username || '').trim());
    if (!target) throw new HttpError(404, 'user_not_found');
    if (target.id === userId) throw new HttpError(400, 'cannot_add_self');
    if (access()?.isBlocked?.(userId, target.id)) throw new HttpError(404, 'user_not_found');
    const now = Date.now();
    const existing = friendshipBetween(userId, target.id);
    if (existing?.status === 'accepted') throw new HttpError(409, 'already_friends');
    if (existing?.status === 'pending') {
      if (existing.requester_id === userId) throw new HttpError(409, 'already_requested');
      // L'autre joueur nous avait déjà invité : on accepte directement.
      q("UPDATE friendships SET status = 'accepted', responded_at = ? WHERE id = ?").run(now, existing.id);
      later('friend.accepted', { userId, friendId: target.id });
      return { status: 'accepted', username: target.username };
    }
    if (existing?.status === 'declined' && existing.requester_id === userId) {
      const until = (existing.responded_at || existing.created_at) + FRIEND_COOLDOWN_MS;
      if (now < until) throw new HttpError(409, 'request_cooldown', { until });
    }
    deps?.quota?.(userId, 'friend_requests');
    let requestId;
    if (existing) {
      // Ancien refus (le délai est passé, ou c'est nous qui avions refusé) : la ligne repart en demande.
      q("UPDATE friendships SET requester_id = ?, addressee_id = ?, status = 'pending', created_at = ?, responded_at = NULL WHERE id = ?")
        .run(userId, target.id, now, existing.id);
      requestId = existing.id;
    } else {
      requestId = Number(q("INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(userId, target.id, now).lastInsertRowid);
    }
    later('friend.requested', { fromId: userId, toId: target.id, requestId });
    return { status: 'pending', username: target.username };
  }

  /** Accepter (destinataire) ; refuser (destinataire : la ligne reste 7 jours en « declined ») ou annuler (expéditeur). */
  function respondFriend(userId, requestId, accept) {
    const f = q('SELECT * FROM friendships WHERE id = ?').get(Number(requestId) || 0);
    if (!f || f.status !== 'pending') throw new HttpError(404, 'request_not_found');
    if (accept) {
      if (f.addressee_id !== userId) throw new HttpError(403, 'forbidden');
      q("UPDATE friendships SET status = 'accepted', responded_at = ? WHERE id = ?").run(Date.now(), f.id);
      later('friend.accepted', { userId, friendId: f.requester_id });
    } else if (f.addressee_id === userId) {
      q("UPDATE friendships SET status = 'declined', responded_at = ? WHERE id = ?").run(Date.now(), f.id);
    } else if (f.requester_id === userId) {
      q('DELETE FROM friendships WHERE id = ?').run(f.id);
    } else {
      throw new HttpError(403, 'forbidden');
    }
  }

  function removeFriend(userId, otherId) {
    const f = friendshipBetween(userId, Number(otherId) || 0);
    if (!f || f.status !== 'accepted') throw new HttpError(404, 'not_friends');
    q('DELETE FROM friendships WHERE id = ?').run(f.id);
  }

  // ----- blind test -----------------------------------------------------------

  // Parties récompensées du jour : jour civil à Paris (shared/periods.js), comme les quêtes et les quotas.
  function rewardedToday(userId) {
    return q('SELECT COUNT(*) AS n FROM blindtest_games WHERE user_id = ? AND rewarded = 1 AND created_at >= ?').get(userId, parisDayStart()).n;
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
      // Mode indices uniquement : aucun extrait audio n'est diffusé (PLAN.md 7.1).
      audio: false,
    };
  }

  function roundPayload(questions, index, admin) {
    const qn = questions[index];
    const views = new Map(catalog.tracks(qn.choices).map((t) => [t.id, t]));
    const answer = views.get(qn.answer);
    return {
      // L'admin reçoit la bonne réponse pour pouvoir tester le jeu rapidement.
      answer: admin ? qn.answer : undefined,
      index,
      rounds: questions.length,
      choices: qn.choices.filter((id) => views.has(id)).map((id) => ({ id, title: views.get(id).title, artist: views.get(id).artist })),
      audio: null,
      clues: answer ? blindtestClues(answer) : null,
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
    const round = roundPayload(questions, 0, isAdmin(user));
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
    return atomic(() => {
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
      let levelUp = null;
      if (last) {
        const rewardPacks = game.rewarded ? blindtestReward(correctCount) : 0;
        const xp = correctCount * 10;
        q('UPDATE users SET bonus_packs = bonus_packs + ? WHERE id = ?').run(rewardPacks, userId);
        // L'XP passe par les paliers de niveau (booster bonus, PLAN.md 6.6), comme toute autre source.
        levelUp = gainXp(getUser(userId), xp, 'blindtest');
        q('UPDATE blindtest_games SET finished_at = ?, reward_packs = ? WHERE id = ?').run(Date.now(), rewardPacks, game.id);
        final = { score, correct: correctCount, rounds: questions.length, rewardPacks, rewarded: !!game.rewarded, xp };
        later('blindtest.finished', { userId, gameId: game.id, correct: correctCount, score, rewarded: !!game.rewarded });
      }
      q('UPDATE blindtest_games SET questions = ?, score = ?, correct = ? WHERE id = ?').run(JSON.stringify(questions), score, correctCount, game.id);
      return { result: { correct, answer: qn.answer, picked: qn.picked, points, score }, final, levelUp, catalog: refs({ trackIds: [qn.answer] }) };
    });
  }

  async function nextBlindtestRound(userId, gameId) {
    const { game, questions } = loadGame(userId, gameId);
    const current = questions[game.current];
    if (current.picked === undefined) throw new HttpError(409, 'round_not_answered');
    const index = game.current + 1;
    if (index >= questions.length) throw new HttpError(409, 'game_finished');
    const round = roundPayload(questions, index, isAdmin(getUser(userId)));
    questions[index].startedAt = Date.now();
    q('UPDATE blindtest_games SET questions = ?, current = ? WHERE id = ?').run(JSON.stringify(questions), index, game.id);
    return { round };
  }

  // ----- notes ----------------------------------------------------------------------
  // Les routes des notes et critiques sont celles du module ratings (server/ratings.js) ; il reste ici ce que les
  // modules partagent : les amis d'un joueur, le recalcul de rating_stats et l'échelle de notation.

  function friendIds(userId) {
    return new Set(q(`SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id
      FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`).all(userId, userId, userId).map((r) => r.id));
  }

  /**
   * Recalcule rating_stats d'un élément depuis ses notes (même calcul que l'étape v2 de db.js ; 2 ms pour l'album
   * le plus noté). À appeler dans la transaction qui a modifié ses notes ; la ligne disparaît sans aucune note.
   */
  function refreshRatingStats(type, id) {
    q('DELETE FROM rating_stats WHERE item_type = ? AND item_id = ?').run(type, id);
    q(`INSERT INTO rating_stats (item_type, item_id, count, sum, review_count, dist, last_rated_at)
      SELECT item_type, item_id, COUNT(*), SUM(score), SUM(review IS NOT NULL), json_array(${RATING_DIST}), MAX(updated_at)
      FROM ratings WHERE item_type = ? AND item_id = ? GROUP BY item_type, item_id`).run(type, id);
  }

  function setRatingScale(userId, scale) {
    if (!['stars', 'points'].includes(scale)) throw new HttpError(400, 'invalid_scale');
    q('UPDATE users SET rating_scale = ? WHERE id = ?').run(scale, userId);
  }

  // ----- admin ----------------------------------------------------------------

  /**
   * Journal des actions admin (admin_audit, PLAN.md 7.2) : `action` court (« grant », « me.reset »…), `target`
   * (« user:12 », « album:discovery »), `payload` sérialisé et tronqué. Appelé par chaque route admin qui modifie.
   */
  function audit(adminId, action, target = null, payload = null) {
    let data = payload == null ? null : JSON.stringify(payload);
    if (data && data.length > 4000) data = `${data.slice(0, 4000)}…`;
    q('INSERT INTO admin_audit (admin_id, action, target, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(adminId ?? null, String(action).slice(0, 80), target == null ? null : String(target).slice(0, 200), data, Date.now());
  }

  const adminTotals = createLru({ max: 1, ttlMs: 30_000 });

  /**
   * Vue d'ensemble admin : joueurs par pages de 50 (curseur sur created_at, id ; `nextCursor` null à la fin), totaux
   * réels lus dans les compteurs (users.unique_cards) et des COUNT(*) indexés, sans sous-requête par joueur sur les cartes.
   */
  function adminOverview({ cursor, limit } = {}) {
    const n = clampInt(limit, 1, 100, 50);
    const after = decodeCursor(cursor, { length: 2 });
    const rows = q(`SELECT u.*, (SELECT COUNT(*) FROM pack_openings p WHERE p.user_id = u.id) AS openings
      FROM users u ${after ? 'WHERE (u.created_at, u.id) < (?, ?)' : ''} ORDER BY u.created_at DESC, u.id DESC LIMIT ?`)
      .all(...(after ? [after[0], after[1]] : []), n + 1);
    const page = keysetPage(rows, n, (u) => [u.created_at, u.id]);
    // Totaux : parcourent les tables entières (centaines de milliers d'ouvertures et de notes), gardés 30 s.
    const totals = adminTotals.wrap('all', () => ({
      ...q(`SELECT COUNT(*) AS users, COUNT(email_verified_at) AS verified, COALESCE(SUM(unique_cards), 0) AS cards FROM users`).get(),
      openings: q('SELECT COUNT(*) AS n FROM pack_openings').get().n,
      ratings: q('SELECT COUNT(*) AS n FROM ratings').get().n,
    }));
    return {
      users: page.items.map((u) => ({
        id: u.id, username: u.username, email: u.email, role: roleOf(u), verified: !!u.email_verified_at,
        unique: u.unique_cards, openings: u.openings, royalties: u.royalties, packs: u.packs + u.bonus_packs,
        level: levelFromXp(u.xp).level, createdAt: u.created_at, lastSeenAt: u.last_seen_at,
      })),
      nextCursor: page.nextCursor,
      totals: {
        users: totals.users,
        verified: totals.verified,
        openings: totals.openings,
        // Cartes distinctes de tous les joueurs (somme des compteurs users.unique_cards).
        cards: totals.cards,
        ratings: totals.ratings,
      },
      catalog: catalog.totals(),
      adminCount: config.adminEmails.length,
      odds: packOdds(),
      slots: PACK_SLOTS,
      rarities: RARITIES,
      // Le blind test se joue toujours en mode indices (l'interrupteur iTunes a été retiré).
      config: { packRegenMinutes: config.packRegenMinutes, packMaxStock: config.packMaxStock, blindtestAudio: 'off' },
    };
  }

  function adminGrant(targetId, { packs = 0, royalties = 0 } = {}) {
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
      q('DELETE FROM user_album_progress WHERE user_id = ?').run(userId);
      q("UPDATE users SET xp = 0, avatar = 'initials', showcase = '[]', unique_cards = 0, pity = 0 WHERE id = ?").run(userId);
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
      q(`INSERT OR IGNORE INTO cards (user_id, track_id, variant, count, first_at, pulled_rarity) SELECT ?, id, 'std', 1, ?, rarity FROM cat_tracks WHERE ${where}`).run(userId, now, ...args);
      const albums = id ? [id] : q("SELECT id FROM cat_albums WHERE source = 'seed'").all().map((r) => r.id);
      for (const a of albums) insertAchievement(userId, `album:${a}`, now);
      // Artistes dont toutes les cartes sont maintenant possédées.
      const artists = q(`SELECT DISTINCT artist_id FROM cat_tracks WHERE ${where}`).all(...args).map((r) => r.artist_id);
      for (const artistId of artists) {
        const ids = catalog.artistTrackIds(artistId);
        if (ids.length && ownedAmong(userId, ids).size === ids.length) insertAchievement(userId, `artist:${artistId}`, now);
      }
      // Promos de la graine : elles n'ont pas d'album, seuls les compteurs du joueur changent.
      recountCollection(userId, albums);
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
      const ins = q("INSERT OR IGNORE INTO cards (user_id, track_id, variant, count, first_at, pulled_rarity) VALUES (?, ?, 'std', 1, ?, ?)");
      for (const t of list) if (t.id !== missing.id) ins.run(userId, t.id, now, t.rarity);
      q('DELETE FROM cards WHERE user_id = ? AND track_id = ?').run(userId, missing.id);
      q('DELETE FROM achievements WHERE user_id = ? AND key IN (?, ?)').run(userId, `album:${id}`, `artist:${missing.artistId}`);
      recountCollection(userId, [id]);
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
      // Progression lue dans user_album_progress (tenue à jour par addCards), sans GROUP BY sur les cartes.
      const progress = progressOf(userId, items.map((a) => a.id));
      return { total: items.length, items: items.map((a) => ({ ...a, owned: progress.get(a.id)?.owned || 0 })) };
    }
    const text = typeof query.q === 'string' ? query.q.slice(0, 100) : '';
    const genre = typeof query.genre === 'string' && query.genre.length <= 30 ? query.genre : null;
    const decade = /^\d{4}$/.test(String(query.decade ?? '')) ? Number(query.decade) : null;
    const artistId = idOf(query.artist);
    const sort = SORTS.has(query.sort) ? query.sort : 'popular';
    const offset = clampInt(query.offset, 0, 10_000, 0);
    const limit = clampInt(query.limit, 1, 60, 36);
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

  // Pagination : des entiers bornés (« offset=1.5 » ou « limit=abc » ne doivent pas atteindre SQLite tels quels).
  function browsePromos(query) {
    return catalog.promos({ offset: clampInt(query.offset, 0, 100_000, 0), limit: clampInt(query.limit, 1, 120, 60) });
  }

  function myCards(userId, query) {
    const rarity = RARITIES.includes(query.rarity) ? query.rarity : null;
    return catalog.ownedTracks(userId, {
      q: typeof query.q === 'string' ? query.q.slice(0, 80) : '',
      rarity,
      offset: clampInt(query.offset, 0, 100_000, 0),
      limit: clampInt(query.limit, 1, 120, 60),
    });
  }

  function groups(userId, by) {
    if (!GROUP_BY.has(by)) throw new HttpError(400, 'invalid_group');
    return { by, groups: catalog.groupStats(userId, by) };
  }

  /** Branche les dépendances des modules (deps.access, deps.notifications, deps.quota), une fois initialisés. */
  function bind(d) {
    deps = d;
  }

  return {
    // forget(userId) : oublie les statistiques et le profil gardés en cache d'un joueur (après un changement fait ailleurs).
    forget: dropStats,
    bind, atomic, getUser, isAdmin, refs, syncPacks, state, openPacks, openAlbumPack, openSpecialPack, buyPack, recycleDuplicates,
    pressCard, pressInfo, promoUnlocked, addCards, refreshProgress, focusAlbums, wishlistAlbumIds, packFocus,
    gainXp, addXp, insertBooster, unlockedCosmeticIds, parseJson,
    setAvatar, setShowcase, setLang, setPrefs, publicProfile, userSummaries, summaryAlbums,
    listFriends, requestFriend, respondFriend, removeFriend, friendIds,
    blindtestInfo, startBlindtest, answerBlindtest, nextBlindtestRound,
    refreshRatingStats, setRatingScale,
    audit, adminOverview, adminGrant, adminResetCollection, adminCompleteCollection, adminAlmostAlbum,
    browseAlbums, albumDetail, artistDetail, tracksByIds, artistsByIds, browsePromos, myCards, groups,
    welcome: { packs: ECONOMY.welcomePacks, royalties: ECONOMY.welcomeRoyalties },
  };
}
