// Module « workshop » : l'atelier du collectionneur (PLAN.md 4.3, 6.3, 6.10, 6.11). Chantier : P2-D.
//
// Édition deluxe : album complété + album noté + chaque morceau noté → succès `deluxe:<albumId>` (il ne se retire
//   jamais), +DELUXE_XP (services.gainXp : paliers de niveau compris), notification `deluxe_earned`, événement
//   deluxe.earned { userId, albumId, at, silent }. Évaluée sur rating.saved (morceau ou album) et album.completed ;
//   rattrapage silencieux, une fois par joueur, des albums déjà remplis avant P2 (drapeau `deluxe:v1` dans
//   user_stats_cache), au premier affichage de son propre Studio. À la DELUXE_TITLE_AT-ième édition : le titre
//   « Oreille deluxe » (shared/cosmetics.js).
// Vernir : une carte standard possédée devient holo (un exemplaire standard en moins, un holo en plus), payée
//   VERNIR_MULTIPLIER × sa valeur de recyclage en royalties ou VERNIR_DUPLICATES doublons de la même rareté.
// Comptoir : COMPTOIR_DUPLICATES doublons d'une rareté → une carte manquante de cette rareté, choisie dans un album
//   recherché ; échange fixe avec le jeu (jamais entre joueurs) ; la carte arrive par services.addCards (album
//   complété, Pressage n°, XP et royalties d'une nouvelle carte, comme un booster).
// Booster thématique : THEMED_BOOSTER_PRICE royalties (un genre, une décennie ou « À ton goût »), ajouté à l'inventaire
//   des boosters spéciaux (user_boosters, source `shop`) ; jamais d'argent réel.
// Règles et chiffres : shared/rules.js (les mêmes pour la démo et le guide des raretés).
//
// Routes (joueur connecté) :
//   GET  /api/collection/vernir/:trackId  → { trackId, rarity, std, holo, cost, royalties, duplicates, can, reason }
//   POST /api/collection/vernir { trackId, pay: 'royalties' | 'duplicates' } → { trackId, rarity, albumId, pay, spent,
//        holoEdition, at, catalog, state } (état complet : le nombre d'exemplaires de plusieurs cartes change, comme
//        au recyclage)
//   GET  /api/collection/comptoir?cursor=&limit= → { needed, duplicates, items: [{ albumId, owned, total, missing:
//        [{ trackId, rarity }] }], nextCursor, wishlist, complete, catalog } (albums recherchés qui ont encore des
//        cartes manquantes, dans l'ordre d'ajout)
//   POST /api/collection/comptoir { trackId } → { trackId, rarity, albumId, spent, …deltas d'addCards, state } (complet)
//   POST /api/me/boosters/buy { theme } → { booster, spent, state } (état partiel)
//   GET  /api/albums/:id/deluxe → { albumId, completed, albumRated, tracksRated, tracksTotal, missing, ready, done, at,
//        xp, catalog } ; une fois l'édition obtenue, aussi `achievements: [{ key }]` et l'état partiel, pour que le
//        site l'ajoute à l'état du joueur (le succès est donné par un abonné du bus, après la réponse de la note).
// Erreurs : 404 unknown_track / unknown_album, 400 invalid_input (pay) / invalid_theme, 409 not_owned, already_holo,
//   not_enough_royalties { cost }, not_enough_duplicates { needed, have }, not_exchangeable, not_wishlisted,
//   already_owned.
// API interne (deps.workshop) : deluxeProgressOf(userId, albumId), evaluateDeluxe(userId, albumId, { silent }),
//   backfillDeluxe(userId), deluxeAmong(userId, albumIds) → Set, sparesByRarity(userId), vernirInfo, vernir,
//   comptoirPage, comptoir, buyThemed. Contrat de module : voir server/modules.js.
import {
  COMPTOIR_DUPLICATES, DELUXE_XP, RARITIES, THEMED_BOOSTER_PRICE, buyableTheme, deluxeKey, deluxeProgress, pickDuplicates, vernirCost,
} from '../shared/rules.js';
import { DELUXE_TITLE, DELUXE_TITLE_AT } from '../shared/cosmetics.js';

export const name = 'workshop';

const BACKFILL_KEY = 'deluxe:v1';
const BACKFILL_MAX = 3000; // albums complétés et notés relus au rattrapage (au-delà : à la note suivante)
const COMPTOIR_PAGE = 6; // albums recherchés par page du Comptoir
const COMPTOIR_MAX = 24; // places maximales des albums recherchés (12 + 3 × 4)
const MISSING_SHOWN = 60; // morceaux à noter renvoyés par GET /albums/:id/deluxe
const PAY = ['royalties', 'duplicates'];

export function init(deps) {
  const { db, catalog, services, validate, paging, HttpError } = deps;
  const statements = new Map();
  /** Requête préparée une fois par texte SQL. */
  const q = (sql) => {
    let st = statements.get(sql);
    if (!st) {
      st = db.prepare(sql);
      statements.set(sql, st);
    }
    return st;
  };
  const json = (v) => JSON.stringify(v);
  /** Dans la transaction en cours s'il y en a une (abonné appelé pendant une écriture), sinon dans la sienne. */
  const atomic = (fn) => (db.isTransaction ? fn() : services.atomic(fn));
  const user = (userId) => {
    const row = services.getUser(userId);
    if (!row) throw new HttpError(401, 'unauthenticated');
    return row;
  };
  const trackOf = (raw) => {
    const id = validate.id(raw);
    const track = id && catalog.track(id);
    if (!track) throw new HttpError(404, 'unknown_track');
    return track;
  };

  // ----- édition deluxe --------------------------------------------------------------------------------------

  /** Morceaux notés par le joueur parmi ceux-ci (index unique des notes : user_id, item_type, item_id). */
  function ratedAmong(userId, trackIds) {
    if (!trackIds.length) return new Set();
    return new Set(q(`SELECT item_id FROM ratings WHERE user_id = ? AND item_type = 'track'
      AND item_id IN (SELECT value FROM json_each(?))`).all(userId, json(trackIds)).map((r) => r.item_id));
  }

  /** Où en est l'édition deluxe d'un album pour ce joueur (shared/rules.js deluxeProgress), et si elle est obtenue. */
  function deluxeProgressOf(userId, albumId) {
    const trackIds = catalog.albumTrackIds(albumId);
    const completed = !!q('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?').get(userId, `album:${albumId}`);
    const albumRated = !!q("SELECT 1 FROM ratings WHERE user_id = ? AND item_type = 'album' AND item_id = ?").get(userId, albumId);
    const done = q('SELECT created_at FROM achievements WHERE user_id = ? AND key = ?').get(userId, deluxeKey(albumId));
    return {
      albumId,
      ...deluxeProgress({ completed, albumRated, trackIds, ratedTrackIds: ratedAmong(userId, trackIds) }),
      done: !!done,
      at: done?.created_at ?? null,
    };
  }

  /**
   * Donne l'édition deluxe quand ses trois conditions sont remplies (idempotent) ; renvoie true quand elle vient
   * d'être donnée. `silent` : sans notification (rattrapage). XP et titre dans la même transaction, événement après.
   */
  function evaluateDeluxe(userId, albumId, { silent = false } = {}) {
    if (!albumId || !catalog.album(albumId)) return false;
    const key = deluxeKey(albumId);
    if (q('SELECT 1 FROM achievements WHERE user_id = ? AND key = ?').get(userId, key)) return false;
    if (!deluxeProgressOf(userId, albumId).ready) return false;
    const now = Date.now();
    const granted = atomic(() => {
      if (!q('INSERT OR IGNORE INTO achievements (user_id, key, created_at) VALUES (?, ?, ?)').run(userId, key, now).changes) return false;
      const row = services.getUser(userId);
      if (row) services.gainXp(row, DELUXE_XP, 'deluxe');
      const count = q(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM achievements WHERE user_id = ? AND key >= 'deluxe:' AND key < 'deluxe;'
        LIMIT ?)`).get(userId, DELUXE_TITLE_AT).n;
      if (count >= DELUXE_TITLE_AT) deps.collection?.grantCosmetic?.(userId, DELUXE_TITLE, `deluxe:${DELUXE_TITLE_AT}`);
      return true;
    });
    if (!granted) return false;
    services.forget?.(userId);
    if (!silent) {
      deps.notify?.(userId, 'deluxe_earned', { targetType: 'album', targetId: albumId, data: { itemType: 'album', itemId: albumId, xp: DELUXE_XP } });
    }
    deps.bus.emit('deluxe.earned', { userId, albumId, at: now, silent });
    return true;
  }

  /**
   * Rattrapage, une fois par joueur : ses albums complétés et notés dont chaque morceau est noté reçoivent leur
   * édition deluxe, sans notification. Lit d'abord les albums complétés ET notés (clé primaire des succès, index
   * unique des notes), puis leurs morceaux. Renvoie le nombre d'éditions données.
   */
  function backfillDeluxe(userId) {
    if (q('SELECT 1 FROM user_stats_cache WHERE user_id = ? AND key = ?').get(userId, BACKFILL_KEY)) return 0;
    const candidates = q(`SELECT substr(a.key, 7) AS album_id FROM achievements a
      WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;'
        AND EXISTS (SELECT 1 FROM ratings r WHERE r.user_id = a.user_id AND r.item_type = 'album' AND r.item_id = substr(a.key, 7))
        AND NOT EXISTS (SELECT 1 FROM achievements d WHERE d.user_id = a.user_id AND d.key = 'deluxe:' || substr(a.key, 7))
      LIMIT ?`).all(userId, BACKFILL_MAX);
    let n = 0;
    for (const { album_id: albumId } of candidates) if (evaluateDeluxe(userId, albumId, { silent: true })) n += 1;
    q('INSERT OR REPLACE INTO user_stats_cache (user_id, key, data, computed_at) VALUES (?, ?, ?, ?)')
      .run(userId, BACKFILL_KEY, json({ granted: n }), Date.now());
    return n;
  }

  /** Parmi ces albums, ceux dont le joueur a l'édition deluxe (clé primaire des succès). */
  function deluxeAmong(userId, albumIds) {
    const ids = [...new Set((albumIds || []).filter(Boolean))];
    if (!ids.length) return new Set();
    return new Set(q(`SELECT substr(key, 8) AS id FROM achievements WHERE user_id = ?
      AND key IN (SELECT 'deluxe:' || value FROM json_each(?))`).all(userId, json(ids)).map((r) => r.id));
  }

  /** GET /api/albums/:id/deluxe (voir l'en-tête). */
  function deluxeStatus(userId, rawId) {
    const albumId = validate.id(rawId);
    if (!albumId || !catalog.album(albumId)) throw new HttpError(404, 'unknown_album');
    evaluateDeluxe(userId, albumId);
    const p = deluxeProgressOf(userId, albumId);
    const missing = p.missing.slice(0, MISSING_SHOWN);
    const out = { ...p, missing, xp: DELUXE_XP, catalog: deps.refs({ trackIds: missing, albumIds: [albumId] }) };
    if (p.done) Object.assign(out, { achievements: [{ key: deluxeKey(albumId), rank: null }], state: services.state(userId, { partial: true }) });
    return out;
  }

  deps.bus.on('rating.saved', ({ userId, itemType, itemId }) => {
    const albumId = itemType === 'album' ? itemId : itemType === 'track' ? catalog.track(itemId)?.albumId : null;
    if (albumId) evaluateDeluxe(userId, albumId);
  });
  deps.bus.on('album.completed', ({ userId, albumId }) => evaluateDeluxe(userId, albumId));

  // ----- doublons -------------------------------------------------------------------------------------------

  /**
   * Exemplaires en double d'une rareté : [{ trackId, variant, count }]. Parcourt les cartes du joueur par la clé
   * primaire (CROSS JOIN : ses cartes d'abord, jamais tous les morceaux d'une rareté).
   */
  const spareRows = (userId, rarity) => q(`SELECT c.track_id AS trackId, c.variant, c.count FROM cards c CROSS JOIN cat_tracks t
    WHERE c.user_id = ? AND c.count > 1 AND t.id = c.track_id AND t.rarity = ?`).all(userId, rarity);

  /** Doublons disponibles par rareté : { common: 4, … }. */
  function sparesByRarity(userId) {
    const out = Object.fromEntries(RARITIES.map((r) => [r, 0]));
    for (const r of q(`SELECT t.rarity, SUM(c.count - 1) AS n FROM cards c CROSS JOIN cat_tracks t
      WHERE c.user_id = ? AND c.count > 1 AND t.id = c.track_id GROUP BY t.rarity`).all(userId)) {
      if (out[r.rarity] !== undefined) out[r.rarity] = r.n;
    }
    return out;
  }

  /** Doublons utilisables parmi ces exemplaires (sans celui qu'on vernit, `reserve`). */
  function spareCount(rows, reserve = null) {
    let n = 0;
    for (const r of rows) n += Math.max(0, r.count - (reserve && r.trackId === reserve.trackId && r.variant === reserve.variant ? 2 : 1));
    return n;
  }

  /** Retire les doublons choisis par pickDuplicates (jamais le dernier exemplaire d'une version). */
  function spend(userId, picks) {
    const st = q('UPDATE cards SET count = count - ? WHERE user_id = ? AND track_id = ? AND variant = ? AND count > ?');
    for (const p of picks) {
      if (!st.run(p.n, userId, p.trackId, p.variant, p.n).changes) throw new HttpError(409, 'not_enough_duplicates');
    }
  }

  const cardRow = (userId, trackId, variant) => q('SELECT count, first_at, pulled_rarity FROM cards WHERE user_id = ? AND track_id = ? AND variant = ?')
    .get(userId, trackId, variant);

  // ----- Vernir ---------------------------------------------------------------------------------------------

  /** Ce que coûte le vernis d'une carte pour ce joueur (fenêtre « Vernir »). */
  function vernirInfo(userId, rawId) {
    const track = trackOf(rawId);
    const me = user(userId);
    const std = cardRow(userId, track.id, 'std');
    const holo = cardRow(userId, track.id, 'holo');
    const cost = vernirCost(track.rarity);
    const spares = std ? spareCount(spareRows(userId, track.rarity), { trackId: track.id, variant: 'std' }) : 0;
    const reason = holo ? 'already_holo' : !std ? 'not_owned' : null;
    return {
      trackId: track.id,
      rarity: track.rarity,
      std: std?.count ?? 0,
      holo: holo?.count ?? 0,
      cost,
      royalties: me.royalties,
      duplicates: spares,
      can: { royalties: !reason && me.royalties >= cost.royalties, duplicates: !reason && spares >= cost.duplicates },
      reason,
    };
  }

  function vernir(userId, rawId, rawPay) {
    const track = trackOf(rawId);
    const pay = validate.oneOf(rawPay, PAY, { field: 'pay' });
    const cost = vernirCost(track.rarity);
    const result = atomic(() => {
      const me = user(userId);
      if (cardRow(userId, track.id, 'holo')) throw new HttpError(409, 'already_holo');
      const std = cardRow(userId, track.id, 'std');
      if (!std) throw new HttpError(409, 'not_owned');
      let spent;
      if (pay === 'royalties') {
        if (me.royalties < cost.royalties) throw new HttpError(409, 'not_enough_royalties', { cost: cost.royalties });
        q('UPDATE users SET royalties = royalties - ? WHERE id = ?').run(cost.royalties, userId);
        spent = { royalties: cost.royalties };
      } else {
        const rows = spareRows(userId, track.rarity);
        const reserve = { trackId: track.id, variant: 'std' };
        const picks = pickDuplicates(rows, cost.duplicates, { reserve });
        if (!picks) throw new HttpError(409, 'not_enough_duplicates', { needed: cost.duplicates, have: spareCount(rows, reserve) });
        spend(userId, picks);
        spent = { duplicates: picks };
      }
      // L'exemplaire standard devient holo : le dernier disparaît, la carte reste possédée (en holo).
      const now = Date.now();
      if (cardRow(userId, track.id, 'std').count > 1) q("UPDATE cards SET count = count - 1 WHERE user_id = ? AND track_id = ? AND variant = 'std'").run(userId, track.id);
      else q("DELETE FROM cards WHERE user_id = ? AND track_id = ? AND variant = 'std'").run(userId, track.id);
      q("INSERT INTO cards (user_id, track_id, variant, count, first_at, pulled_rarity) VALUES (?, ?, 'holo', 1, ?, ?)")
        .run(userId, track.id, now, std.pulled_rarity ?? track.rarity);
      let holoEdition = false;
      if (track.albumId) {
        services.refreshProgress(userId, [track.albumId]);
        const p = q('SELECT holo, total FROM user_album_progress WHERE user_id = ? AND album_id = ?').get(userId, track.albumId);
        holoEdition = !!p && p.total > 0 && p.holo >= p.total;
      }
      return { trackId: track.id, rarity: track.rarity, albumId: track.albumId || null, pay, spent, holoEdition, at: now };
    });
    services.forget?.(userId);
    return { ...result, catalog: deps.refs({ trackIds: [track.id, ...(result.spent.duplicates || []).map((p) => p.trackId)] }) };
  }

  // ----- Comptoir -------------------------------------------------------------------------------------------

  /** Cartes possédées parmi ces morceaux (toutes versions). */
  function ownedAmong(userId, ids) {
    if (!ids.length) return new Set();
    return new Set(q('SELECT DISTINCT track_id FROM cards WHERE user_id = ? AND track_id IN (SELECT value FROM json_each(?))')
      .all(userId, json(ids)).map((r) => r.track_id));
  }

  /**
   * GET /api/collection/comptoir : doublons par rareté et albums recherchés qui ont encore des cartes manquantes
   * (dans l'ordre d'ajout), page par page (curseur de décalage ; 24 albums recherchés au plus).
   */
  function comptoirPage(userId, query = {}) {
    const limit = paging.limitOf(query.limit, { def: COMPTOIR_PAGE, max: COMPTOIR_MAX });
    const offset = paging.offsetOf(query.cursor, { cap: COMPTOIR_MAX });
    const wishlist = services.wishlistAlbumIds(userId).filter((id) => catalog.album(id)).slice(0, COMPTOIR_MAX);
    const albums = [];
    for (const albumId of wishlist) {
      const ids = catalog.albumTrackIds(albumId);
      const owned = ownedAmong(userId, ids);
      const missing = ids.filter((id) => !owned.has(id));
      if (missing.length) albums.push({ albumId, owned: ids.length - missing.length, total: ids.length, missing });
    }
    const page = paging.offsetPage(albums.slice(offset, offset + limit + 1), offset, limit, { cap: COMPTOIR_MAX });
    const views = new Map(catalog.tracks(page.items.flatMap((a) => a.missing)).map((t) => [t.id, t]));
    const items = page.items.map((a) => ({
      ...a,
      missing: a.missing.filter((id) => views.has(id)).map((id) => ({ trackId: id, rarity: views.get(id).rarity })),
    }));
    return {
      needed: COMPTOIR_DUPLICATES,
      duplicates: sparesByRarity(userId),
      items,
      nextCursor: page.nextCursor,
      wishlist: wishlist.length,
      incomplete: albums.length,
      catalog: deps.refs({ trackIds: [...views.keys()], albumIds: items.map((a) => a.albumId) }),
    };
  }

  function comptoir(userId, rawId) {
    const track = trackOf(rawId);
    if (!track.albumId || track.rarity === 'promo') throw new HttpError(409, 'not_exchangeable');
    if (!services.wishlistAlbumIds(userId).includes(track.albumId)) throw new HttpError(409, 'not_wishlisted', { albumId: track.albumId });
    const result = atomic(() => {
      const me = user(userId);
      if (ownedAmong(userId, [track.id]).size) throw new HttpError(409, 'already_owned');
      const rows = spareRows(userId, track.rarity);
      const picks = pickDuplicates(rows, COMPTOIR_DUPLICATES);
      if (!picks) throw new HttpError(409, 'not_enough_duplicates', { needed: COMPTOIR_DUPLICATES, have: spareCount(rows) });
      spend(userId, picks);
      const added = services.addCards(me, [{ trackId: track.id, variant: 'std' }], 'comptoir');
      return { trackId: track.id, rarity: track.rarity, albumId: track.albumId, spent: { duplicates: picks }, ...added };
    });
    services.forget?.(userId);
    return result;
  }

  // ----- booster thématique ---------------------------------------------------------------------------------

  function buyThemed(userId, theme) {
    if (typeof theme !== 'string' || !buyableTheme(theme)) throw new HttpError(400, 'invalid_theme');
    const booster = atomic(() => {
      const me = user(userId);
      if (me.royalties < THEMED_BOOSTER_PRICE) throw new HttpError(409, 'not_enough_royalties', { cost: THEMED_BOOSTER_PRICE });
      q('UPDATE users SET royalties = royalties - ? WHERE id = ?').run(THEMED_BOOSTER_PRICE, userId);
      const now = Date.now();
      const id = services.insertBooster(userId, 'theme', theme, 'shop', now);
      return { id, kind: 'theme', theme, source: 'shop', createdAt: now };
    });
    return { booster, spent: THEMED_BOOSTER_PRICE };
  }

  return {
    deluxeProgressOf, evaluateDeluxe, backfillDeluxe, deluxeAmong, deluxeStatus, sparesByRarity,
    vernirInfo, vernir, comptoirPage, comptoir, buyThemed,
  };
}

export function routes(r, deps) {
  const { limits, services } = deps;
  const api = () => deps.workshop;
  const full = (req) => services.state(req.user.id);
  const partial = (req) => services.state(req.user.id, { partial: true });

  r.get('/collection/vernir/:trackId', limits.read, (req, res) => res.json(api().vernirInfo(req.user.id, req.params.trackId)));
  // Vernir et le Comptoir changent le nombre d'exemplaires de plusieurs cartes : état complet, comme le recyclage.
  r.post('/collection/vernir', limits.write, (req, res) => res.json({ ...api().vernir(req.user.id, req.body.trackId, req.body.pay), state: full(req) }));
  r.get('/collection/comptoir', limits.read, (req, res) => res.json(api().comptoirPage(req.user.id, req.query)));
  r.post('/collection/comptoir', limits.write, (req, res) => res.json({ ...api().comptoir(req.user.id, req.body.trackId), state: full(req) }));
  r.post('/me/boosters/buy', limits.write, (req, res) => res.json({ ...api().buyThemed(req.user.id, req.body.theme), state: partial(req) }));
  r.get('/albums/:id/deluxe', limits.read, (req, res) => res.json(api().deluxeStatus(req.user.id, req.params.id)));
}
