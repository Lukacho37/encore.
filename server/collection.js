// Module « collection » : jeu de collection (PLAN.md 4.2.5, 6) — chantier P1-D.
//   Albums recherchés (liste d'envies, lists.kind = 'wishlist') : 12 places, +4 aux niveaux 10, 25 et 50 ; ils
//     orientent 25 % des emplacements des boosters (services.packFocus).
//   Boosters spéciaux (user_boosters) : inventaire, ouverture (services.openSpecialPack), chances publiées.
//   Cosmétiques : ceux du niveau (shared/cosmetics.js, jamais stockés) et ceux de user_cosmetics (badges, P2) ;
//     la sélection est dans users.cosmetics.
//   Moment de complétion : « Complété par 214 joueurs · 3 amis », Pressage n°, première carte.
// API interne (deps.collection) : addXp (la seule façon d'ajouter de l'XP pour un module : paliers de niveau et
// événement level.up), grantBooster, unlockedCosmetics, grantCosmetic, setCosmetics, wishlist, addToWishlist,
// completion. Contrat de module : voir server/modules.js.
import { boosterOdds, levelFromXp, parseBoosterTheme, wishlistMax } from '../shared/rules.js';
import { COSMETIC_KINDS, LEVEL_COSMETICS, cleanSelection, cosmeticId, cosmeticsForLevel, parseCosmetic } from '../shared/cosmetics.js';

export const name = 'collection';

const DAY = 86_400_000;
const BOOSTERS_MAX = 100; // boosters spéciaux renvoyés par GET /api/me/boosters (au-delà : ouverts au fur et à mesure)
const idOf = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);

export function init(deps) {
  const { db, catalog, services, HttpError } = deps;
  const q = (sql) => db.prepare(sql);
  const json = (v) => JSON.stringify(v);
  const user = (userId) => {
    const row = services.getUser(userId);
    if (!row) throw new HttpError(404, 'user_not_found');
    return row;
  };
  const levelOf = (row) => levelFromXp(row.xp).level;

  // ----- albums recherchés --------------------------------------------------------------------

  /** Ligne de la liste d'envies du joueur, créée à la première utilisation (une seule par joueur : lists_singleton). */
  function wishlistRow(userId, create = false) {
    const row = q("SELECT id, item_count FROM lists WHERE user_id = ? AND kind = 'wishlist'").get(userId);
    if (row || !create) return row || null;
    const now = Date.now();
    q(`INSERT OR IGNORE INTO lists (user_id, kind, title, item_type, visibility, created_at, updated_at)
      VALUES (?, 'wishlist', 'Albums recherchés', 'album', 'public', ?, ?)`).run(userId, now, now);
    return q("SELECT id, item_count FROM lists WHERE user_id = ? AND kind = 'wishlist'").get(userId);
  }

  const wishlistIds = (userId) => services.wishlistAlbumIds(userId);

  function wishlistState(userId, wanted) {
    const row = user(userId);
    const count = q(`SELECT COUNT(*) AS n FROM lists l JOIN list_items li ON li.list_id = l.id
      WHERE l.user_id = ? AND l.kind = 'wishlist'`).get(userId).n;
    return { ...(wanted === undefined ? {} : { wanted }), count, max: wishlistMax(levelOf(row)) };
  }

  /** Progression du joueur sur ces albums : { albumId: { owned, total } } (user_album_progress). */
  function progressOf(userId, albumIds) {
    if (!albumIds.length) return {};
    const out = {};
    for (const r of q(`SELECT album_id, owned, total FROM user_album_progress
      WHERE user_id = ? AND album_id IN (SELECT value FROM json_each(?))`).all(userId, json(albumIds))) out[r.album_id] = { owned: r.owned, total: r.total };
    return out;
  }

  /** Ajoute un album (idempotent) ; 409 wishlist_full au-delà des places du niveau (sauf `strict: false` → false). */
  function addOne(userId, albumId, { strict = true } = {}) {
    const id = idOf(albumId);
    if (!id || !catalog.album(id)) throw new HttpError(404, 'unknown_album');
    return deps.tx(() => {
      const list = wishlistRow(userId, true);
      if (q("SELECT 1 FROM list_items WHERE list_id = ? AND item_type = 'album' AND item_id = ?").get(list.id, id)) return true;
      const max = wishlistMax(levelOf(user(userId)));
      const count = q('SELECT COUNT(*) AS n FROM list_items WHERE list_id = ?').get(list.id).n;
      if (count >= max) {
        if (strict) throw new HttpError(409, 'wishlist_full', { max });
        return false;
      }
      const now = Date.now();
      const position = (q('SELECT MAX(position) AS p FROM list_items WHERE list_id = ?').get(list.id).p ?? -1) + 1;
      q("INSERT INTO list_items (list_id, position, item_type, item_id, added_at) VALUES (?, ?, 'album', ?, ?)").run(list.id, position, id, now);
      q('UPDATE lists SET item_count = ?, updated_at = ? WHERE id = ?').run(count + 1, now, list.id);
      return true;
    });
  }

  function removeOne(userId, albumId) {
    const id = idOf(albumId);
    if (!id) throw new HttpError(404, 'unknown_album');
    deps.tx(() => {
      const list = wishlistRow(userId);
      if (!list) return;
      const res = q("DELETE FROM list_items WHERE list_id = ? AND item_type = 'album' AND item_id = ?").run(list.id, id);
      if (res.changes) q('UPDATE lists SET item_count = MAX(0, item_count - 1), updated_at = ? WHERE id = ?').run(Date.now(), list.id);
    });
  }

  /**
   * Ajoute plusieurs albums tant qu'il reste de la place (onboarding : les 9 albums choisis). Les albums inconnus
   * sont ignorés. Renvoie la liste d'envies.
   */
  function addToWishlist(userId, albumIds = []) {
    for (const id of [...new Set(albumIds)].slice(0, 50)) {
      if (!idOf(id) || !catalog.album(id)) continue;
      if (!addOne(userId, id, { strict: false })) break;
    }
    return wishlistIds(userId);
  }

  /** Liste d'envies d'un joueur vue par `viewerId` : visibilité du Studio et blocages respectés. */
  function userWishlist(viewerId, username) {
    const target = q('SELECT id, profile_visibility FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(String(username || ''));
    if (!target || (target.id !== viewerId && deps.access?.isBlocked?.(viewerId, target.id))) throw new HttpError(404, 'user_not_found');
    if (target.id !== viewerId && deps.access?.canSee && !deps.access.canSee(viewerId, target.id, target.profile_visibility || 'public')) {
      throw new HttpError(403, 'profile_private');
    }
    const items = wishlistIds(target.id);
    return { items, progress: progressOf(target.id, items), max: wishlistMax(levelOf(user(target.id))), catalog: deps.refs({ albumIds: items }) };
  }

  // ----- boosters spéciaux -----------------------------------------------------------------------

  const boosterView = (r) => ({ id: r.id, kind: r.kind, theme: r.theme, source: r.source, createdAt: r.created_at });

  function listBoosters(userId) {
    const rows = q(`SELECT id, kind, theme, source, created_at FROM user_boosters WHERE user_id = ? AND opened_at IS NULL
      ORDER BY created_at DESC, id DESC LIMIT ?`).all(userId, BOOSTERS_MAX + 1);
    const items = rows.slice(0, BOOSTERS_MAX).map(boosterView);
    const albumIds = items.map((b) => parseBoosterTheme(b.theme)).filter((p) => p?.kind === 'album').map((p) => p.value);
    return { items, more: rows.length > BOOSTERS_MAX, catalog: deps.refs({ albumIds }) };
  }

  /**
   * Ajoute un booster spécial à l'inventaire. `kind` : 'theme' | 'album' ; `theme` : « genre:electro »,
   * « decade:1990 », « taste », « event:<slug> », « album:<id> », « album:choice ». Le type se déduit du thème quand
   * `kind` est omis (grantBooster(userId, 'genre:rock', null, 'quest:w')). Renvoie l'identifiant du booster.
   */
  function grantBooster(userId, kind, theme, source = 'game') {
    let k = kind;
    let t = theme;
    if (k !== 'theme' && k !== 'album') {
      t = k;
      k = null;
    }
    const parsed = parseBoosterTheme(t);
    if (!parsed) throw new HttpError(400, 'invalid_theme');
    if (parsed.kind === 'album' && !catalog.album(parsed.value)) throw new HttpError(404, 'unknown_album');
    const realKind = parsed.kind === 'album' || parsed.kind === 'choice' ? 'album' : 'theme';
    if (k && k !== realKind) throw new HttpError(400, 'invalid_theme');
    return services.insertBooster(userId, realKind, t, source || 'game');
  }

  /** Booster d'album au choix : l'album est fixé avant l'ouverture (« album:choice » → « album:<id> »). */
  function chooseAlbum(userId, boosterId, albumId) {
    const id = Number(boosterId);
    const album = idOf(albumId);
    if (!album || !catalog.album(album)) throw new HttpError(404, 'unknown_album');
    const row = Number.isInteger(id) && id > 0 ? q('SELECT * FROM user_boosters WHERE id = ? AND user_id = ?').get(id, userId) : null;
    if (!row) throw new HttpError(404, 'booster_not_found');
    if (row.opened_at) throw new HttpError(409, 'booster_opened');
    if (row.theme !== 'album:choice') throw new HttpError(409, 'not_choice_booster');
    q("UPDATE user_boosters SET theme = ? WHERE id = ? AND opened_at IS NULL AND theme = 'album:choice'").run(`album:${album}`, id);
    return { booster: boosterView({ ...row, theme: `album:${album}` }), catalog: deps.refs({ albumIds: [album] }) };
  }

  // ----- cosmétiques -----------------------------------------------------------------------------

  /** Cosmétiques débloqués : [{ id, source }] (niveau d'abord, puis badges, coffrets, événements). */
  function unlockedCosmetics(userId) {
    const row = services.getUser(userId);
    if (!row) return [];
    const out = cosmeticsForLevel(levelOf(row));
    const seen = new Set(out.map((c) => c.id));
    for (const r of q('SELECT cosmetic_id, source FROM user_cosmetics WHERE user_id = ? ORDER BY created_at').all(userId)) {
      if (!seen.has(r.cosmetic_id)) out.push({ id: r.cosmetic_id, source: r.source });
    }
    return out;
  }

  function grantCosmetic(userId, id, source = 'game') {
    if (!parseCosmetic(id)) throw new HttpError(400, 'invalid_cosmetic');
    q('INSERT OR IGNORE INTO user_cosmetics (user_id, cosmetic_id, source, created_at) VALUES (?, ?, ?, ?)')
      .run(userId, id, String(source).slice(0, 80), Date.now());
  }

  function cosmeticsOf(userId) {
    const row = user(userId);
    return cleanSelection(services.parseJson(row.cosmetics, {}), unlockedCosmetics(userId).map((c) => c.id));
  }

  /**
   * Choisit les cosmétiques affichés (PUT /api/me/cosmetics, module studio) : `{ frame, vinyl, theme, title }`, chaque
   * valeur la clé courte (« ivoire ») ou l'identifiant complet (« frame:ivoire »), null pour aucun ; un type absent
   * garde sa valeur. 409 cosmetic_locked si un cosmétique n'est pas débloqué. Renvoie la sélection.
   */
  function setCosmetics(userId, selection) {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new HttpError(400, 'invalid_input', { field: 'cosmetics' });
    const unlocked = new Set(unlockedCosmetics(userId).map((c) => c.id));
    const next = { ...cosmeticsOf(userId) };
    for (const kind of COSMETIC_KINDS) {
      if (!(kind in selection)) continue;
      const value = selection[kind];
      if (value === null || value === '') {
        next[kind] = null;
        continue;
      }
      if (typeof value !== 'string') throw new HttpError(400, 'invalid_input', { field: kind });
      const key = value.startsWith(`${kind}:`) ? value.slice(kind.length + 1) : value;
      if (!unlocked.has(cosmeticId(kind, key))) throw new HttpError(409, 'cosmetic_locked', { id: cosmeticId(kind, key) });
      next[kind] = key;
    }
    q('UPDATE users SET cosmetics = ? WHERE id = ?').run(json(next), userId);
    services.forget(userId);
    return next;
  }

  function cosmeticsPayload(userId) {
    const level = levelOf(user(userId));
    return {
      unlocked: unlockedCosmetics(userId),
      selected: cosmeticsOf(userId),
      level,
      // Paliers encore à venir (l'éditeur du Studio les montre verrouillés, avec leur niveau).
      locked: LEVEL_COSMETICS.filter((c) => c.level > level).map((c) => ({ id: c.id, level: c.level })),
    };
  }

  // ----- moment de complétion ----------------------------------------------------------------------

  /**
   * « Complété par 214 joueurs · 3 amis » et le Pressage n° du joueur (page d'album, moment de complétion).
   * Compte par l'index ach_key ; les amis bloqués dans un sens ou dans l'autre sont écartés.
   */
  function completion(viewerId, albumId) {
    const id = idOf(albumId);
    if (!id || !catalog.album(id)) throw new HttpError(404, 'unknown_album');
    const key = `album:${id}`;
    const completedBy = q('SELECT COUNT(*) AS n FROM achievements WHERE key = ?').get(key).n;
    const hidden = deps.access?.hiddenIds?.(viewerId) ?? new Set();
    const friendIds = [...services.friendIds(viewerId)].filter((f) => !hidden.has(f));
    const rows = friendIds.length
      ? q(`SELECT user_id FROM achievements WHERE key = ? AND user_id IN (SELECT value FROM json_each(?))
          ORDER BY created_at LIMIT 200`).all(key, json(friendIds))
      : [];
    const summaries = services.userSummaries(rows.slice(0, 8).map((r) => r.user_id), viewerId, { hidden });
    const friends = rows.slice(0, 8).map((r) => summaries.get(r.user_id)).filter(Boolean);
    const mineRow = q('SELECT created_at, rank FROM achievements WHERE user_id = ? AND key = ?').get(viewerId, key);
    let mine = null;
    if (mineRow) {
      const first = q('SELECT first_at FROM user_album_progress WHERE user_id = ? AND album_id = ?').get(viewerId, id)?.first_at ?? mineRow.created_at;
      mine = { at: mineRow.created_at, rank: mineRow.rank ?? null, firstCardAt: first, days: Math.max(0, Math.floor((mineRow.created_at - first) / DAY)) };
    }
    return {
      albumId: id, completedBy, friendsCount: rows.length, friends, mine,
      catalog: deps.refs({ albumIds: [id, ...services.summaryAlbums(friends)] }),
    };
  }

  return {
    addXp: (userId, xp, source) => services.addXp(userId, xp, source),
    grantBooster,
    chooseAlbum,
    listBoosters,
    unlockedCosmetics,
    grantCosmetic,
    cosmeticsOf,
    setCosmetics,
    cosmeticsPayload,
    wishlist: wishlistIds,
    wishlistState,
    addWishlist: (userId, albumId) => addOne(userId, albumId),
    removeWishlist: removeOne,
    addToWishlist,
    userWishlist,
    progressOf,
    completion,
  };
}

export function routes(r, deps) {
  const { limits, services } = deps;
  const api = () => deps.collection;
  const partial = (req) => services.state(req.user.id, { partial: true });

  // Albums recherchés.
  r.get('/me/wishlist', limits.read, (req, res) => {
    const items = api().wishlist(req.user.id);
    res.json({ items, ...api().wishlistState(req.user.id), progress: api().progressOf(req.user.id, items), catalog: deps.refs({ albumIds: items }) });
  });
  r.put('/me/wishlist/:albumId', limits.write, (req, res) => {
    api().addWishlist(req.user.id, req.params.albumId);
    res.json(api().wishlistState(req.user.id, true));
  });
  r.delete('/me/wishlist/:albumId', limits.write, (req, res) => {
    api().removeWishlist(req.user.id, req.params.albumId);
    res.json(api().wishlistState(req.user.id, false));
  });
  r.get('/users/:username/wishlist', limits.read, (req, res) => res.json(api().userWishlist(req.user.id, req.params.username)));

  // Boosters spéciaux : inventaire, ouverture (même résultat que /packs/open, avec l'état partiel), chances.
  r.get('/me/boosters', limits.read, (req, res) => res.json(api().listBoosters(req.user.id)));
  r.post('/me/boosters/:id/choose', limits.write, (req, res) => res.json(api().chooseAlbum(req.user.id, req.params.id, req.body.albumId)));
  r.post('/me/boosters/:id/open', limits.write, (req, res) => {
    const result = services.openSpecialPack(req.user.id, req.params.id, { albumId: req.body.albumId });
    res.json({ ...result, state: partial(req) });
  });
  r.get('/boosters/odds', limits.read, (req, res) => {
    const theme = typeof req.query.theme === 'string' && req.query.theme ? req.query.theme : null;
    if (theme && !parseBoosterTheme(theme)) throw new deps.HttpError(400, 'invalid_theme');
    res.json(boosterOdds(theme));
  });

  // Cosmétiques et moment de complétion.
  r.get('/me/cosmetics', limits.read, (req, res) => res.json(api().cosmeticsPayload(req.user.id)));
  r.get('/albums/:id/completion', limits.read, (req, res) => res.json(api().completion(req.user.id, req.params.id)));
  // Pressage d'une carte : coût pour ce joueur (promos : un album de l'artiste complété).
  r.get('/me/press/:trackId', limits.read, (req, res) => res.json(services.pressInfo(req.user.id, req.params.trackId)));
}
