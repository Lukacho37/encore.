// Module « lists » : listes et « Mes 9 albums » (PLAN.md 4.2.4, 7.2). Chantier : P1-C.
//
// ListSummary = { id, kind, title, user, itemCount, likeCount, commentCount, liked, visibility, ranked, itemType,
//                 coverAlbumIds ≤ 4, updatedAt, moderated? }
// Une liste (kind 'list') est classée ou non, d'albums, de morceaux ou des deux (itemType), publique, réservée aux amis ou
// privée, et compte au plus 250 éléments, chacun avec une note de 280 caractères au plus. « Mes 9 albums » est la liste
// unique kind 'grid9' du joueur : positions 0 à 8, une case vide = pas de ligne (lists_singleton, créée à la première
// sauvegarde). La liste d'envies (kind 'wishlist') appartient à collection.js : les routes génériques la refusent
// (403 use_wishlist_route pour son propriétaire, 404 pour les autres).
//
// Règles (appliquées ici, jamais par le site) :
// - lire : le propriétaire, ou un joueur non bloqué (dans un sens ou dans l'autre) qui a le droit de la voir (publique :
//   tout le monde ; amis : les amis) ; une liste masquée par la modération n'est lue que par son propriétaire
//   (`moderated: true`) ; sinon 404 not_found (jamais 403, rien ne fuit) ;
// - écrire : propriétaire seulement (404 sinon), compte actif (deps.access.assertActive), quota quotidien `lists` et
//   200 listes au plus à la création, politique des liens (deps.access.linkPolicy) sur le titre, la description et les
//   notes ; les éléments existent au catalogue (404 unknown_item) et ne se répètent pas (409 already_in_list) ;
// - le Studio « amis » ou « privé » d'un joueur cache ses listes et sa grille aux autres dans son Studio
//   (`restricted: true`) ; une liste publique reste lisible par son adresse, comme une critique.
// Toutes les listes sont paginées par curseur (deps.paging), sans parcours du catalogue.
// Événements : list.saved { listId, userId, kind, visibility, itemCount } après chaque écriture (search.js indexe ou
// retire la liste, feed.js l'ajoute au fil) ; content.removed à la suppression (purgeTarget avant). Une liste masquée par
// la modération est relue par la recherche (moderation.action), qui la retire.
// API interne (deps.lists) : setGrid9(userId, slots, { title }), grid9Of(userId), summaries(viewer, ids, refs).
export const name = 'lists';

/** Éléments d'une liste, listes par joueur, longueurs des textes, cases de « Mes 9 albums ». */
export const LIST_MAX_ITEMS = 250;
export const LISTS_PER_USER = 200;
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 1000;
export const NOTE_MAX = 280;
export const GRID_SLOTS = 9;
/** Listes des amis montrées en tête de « Listes qui le contiennent » (première page). */
const ALBUM_FRIENDS = 5;
const PAGE = 20;

export const VISIBILITIES = ['public', 'friends', 'private'];
export const ITEM_TYPES = ['album', 'track', 'mixed'];
/** Titre de « Mes 9 albums » tant que le joueur ne l'a pas changé (langue de son compte). */
export const GRID_TITLES = { fr: 'Mes 9 albums', en: 'My 9 albums' };

/** Identifiant entier positif reçu d'une requête, sinon null. */
const toId = (raw) => {
  const n = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

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
  const access = () => deps.access || {};
  /** Transaction, sauf si l'appelant en a déjà ouvert une. */
  const atomic = (fn) => (db.isTransaction ? fn() : deps.tx(fn));
  const notFound = () => new HttpError(404, 'not_found');

  const LIST_COLS = 'id, user_id, kind, title, description, ranked, item_type, visibility, item_count, like_count, comment_count, created_at, updated_at, hidden_at';

  // ----- celui qui regarde ------------------------------------------------------------------------

  /** Joueurs masqués (blocages) et amis (lus à la première demande) de celui qui regarde. */
  function viewerOf(viewerId) {
    if (viewerId && typeof viewerId === 'object') return viewerId;
    const id = Number(viewerId);
    const hidden = access().hiddenIds?.(id) ?? new Set();
    let friends = null;
    return {
      id,
      hidden,
      get friends() {
        friends ||= new Set([...services.friendIds(id)].filter((f) => !hidden.has(f)));
        return friends;
      },
    };
  }

  /** Contenu de `ownerId` à la visibilité `visibility` lisible par `viewer` (blocages compris). */
  function canRead(viewer, ownerId, visibility) {
    if (ownerId === viewer.id) return true;
    if (viewer.hidden.has(ownerId)) return false;
    if (visibility === 'public') return true;
    if (visibility === 'friends') return viewer.friends.has(ownerId);
    return false;
  }

  /** Studio d'un joueur visible par `viewer` (confidentialité du Studio, PLAN.md 2.5). */
  function studioOpen(viewer, target) {
    if (target.id === viewer.id) return true;
    const privacy = target.profile_visibility || 'public';
    if (privacy === 'public') return true;
    return privacy === 'friends' && viewer.friends.has(target.id);
  }

  /** Joueur affiché (vérifié, pas bloqué), sinon 404 user_not_found. */
  function targetUser(viewer, username) {
    const target = q('SELECT id, username, lang, profile_visibility FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(String(username || ''));
    if (!target || (target.id !== viewer.id && viewer.hidden.has(target.id))) throw new HttpError(404, 'user_not_found');
    return target;
  }

  // ----- références du catalogue d'une réponse ----------------------------------------------------

  /** Collecteur des albums, morceaux et joueurs cités ; build() → `catalog` (deps.refs, une fois). */
  function collector() {
    const albumIds = [];
    const trackIds = [];
    return {
      item(type, id) {
        if (!id) return;
        if (type === 'album') albumIds.push(id);
        else if (type === 'track') trackIds.push(id);
      },
      albums(ids) {
        albumIds.push(...ids);
      },
      // Même forme que le collecteur de social.js (commentaires) : pochette d'album des avatars.
      users(summaries) {
        albumIds.push(...services.summaryAlbums(summaries));
      },
      build: () => deps.refs({ albumIds, trackIds }),
    };
  }

  // ----- résumés (ListSummary) ------------------------------------------------------------------

  /** Pochettes d'une liste : les 4 premiers albums distincts (album d'un morceau compris), par liste. */
  function coversOf(listIds) {
    const out = new Map();
    if (!listIds.length) return out;
    const rows = q(`SELECT list_id, CASE WHEN item_type = 'album' THEN item_id ELSE (SELECT album_id FROM cat_tracks WHERE id = item_id) END AS album
      FROM (SELECT list_id, item_type, item_id, ROW_NUMBER() OVER (PARTITION BY list_id ORDER BY position) AS rn
            FROM list_items WHERE list_id IN (SELECT value FROM json_each(?))) WHERE rn <= 8 ORDER BY list_id, rn`).all(json(listIds));
    for (const r of rows) {
      if (!r.album) continue;
      if (!out.has(r.list_id)) out.set(r.list_id, []);
      const list = out.get(r.list_id);
      if (list.length < 4 && !list.includes(r.album)) list.push(r.album);
    }
    return out;
  }

  /** Mentions « J'aime » de `viewerId` parmi ces listes (une requête). */
  function likedAmong(viewerId, ids) {
    if (!ids.length) return new Set();
    return new Set(q("SELECT target_id FROM likes WHERE user_id = ? AND target_type = 'list' AND target_id IN (SELECT value FROM json_each(?))")
      .all(viewerId, json(ids)).map((r) => r.target_id));
  }

  /**
   * Lignes de listes → ListSummary, pour `viewer` : propriétaires, pochettes, « J'aime » en trois requêtes groupées.
   * Les listes illisibles (visibilité, blocages, masquées) sont retirées. `refs` : collecteur (facultatif).
   */
  function summarize(viewerArg, rows, refs = null) {
    const viewer = viewerOf(viewerArg);
    const kept = rows.filter((r) => r && r.kind !== 'wishlist' && canRead(viewer, r.user_id, r.visibility) && (!r.hidden_at || r.user_id === viewer.id));
    if (!kept.length) return [];
    const users = services.userSummaries(kept.map((r) => r.user_id), viewer.id, { hidden: viewer.hidden });
    const covers = coversOf(kept.map((r) => r.id));
    const liked = likedAmong(viewer.id, kept.map((r) => r.id));
    refs?.users(users.values());
    const out = [];
    for (const r of kept) {
      const user = users.get(r.user_id);
      if (!user) continue;
      const coverAlbumIds = covers.get(r.id) || [];
      refs?.albums(coverAlbumIds);
      out.push({
        id: r.id,
        kind: r.kind,
        title: r.title,
        user,
        itemCount: r.item_count,
        likeCount: r.like_count,
        commentCount: r.comment_count,
        liked: liked.has(r.id),
        visibility: r.visibility,
        ranked: !!r.ranked,
        itemType: r.item_type,
        coverAlbumIds,
        updatedAt: r.updated_at,
        ...(r.hidden_at ? { moderated: true } : {}),
      });
    }
    return out;
  }

  /** Résumés de listes par identifiants : Map id → ListSummary (API interne, même forme que les routes). */
  function summaries(viewerArg, ids, refs = null) {
    const wanted = [...new Set((ids || []).map(Number))].filter((x) => Number.isInteger(x) && x > 0);
    if (!wanted.length) return new Map();
    const rows = q(`SELECT ${LIST_COLS} FROM lists WHERE id IN (SELECT value FROM json_each(?))`).all(json(wanted));
    return new Map(summarize(viewerArg, rows, refs).map((s) => [s.id, s]));
  }

  // ----- lecture et droits ----------------------------------------------------------------------

  /** Liste lisible par `viewer`, sinon 404 ; la liste d'envies : 403 use_wishlist_route (propriétaire) ou 404. */
  function readList(viewer, rawId) {
    const id = toId(rawId);
    const row = id && q(`SELECT ${LIST_COLS} FROM lists WHERE id = ?`).get(id);
    if (!row) throw notFound();
    if (row.kind === 'wishlist') {
      if (row.user_id === viewer.id) throw new HttpError(403, 'use_wishlist_route');
      throw notFound();
    }
    if (!canRead(viewer, row.user_id, row.visibility)) throw notFound();
    if (row.hidden_at && row.user_id !== viewer.id) throw notFound();
    return row;
  }

  /** Liste du joueur `user` (404 sinon) ; `grid` : la grille « Mes 9 albums » est-elle permise ici. */
  function ownList(user, rawId, { grid = false } = {}) {
    const id = toId(rawId);
    const row = id && q(`SELECT ${LIST_COLS} FROM lists WHERE id = ?`).get(id);
    if (!row || row.user_id !== user.id) throw notFound();
    if (row.kind === 'wishlist') throw new HttpError(403, 'use_wishlist_route');
    if (row.kind === 'grid9' && !grid) throw new HttpError(403, 'use_grid9_route');
    return row;
  }

  // ----- validation -----------------------------------------------------------------------------

  /** Texte reçu : retours à la ligne normalisés, espaces autour retirés, au plus `max` caractères ('' si absent). */
  function cleanText(raw, { max, field, multiline = false }) {
    if (raw === undefined || raw === null) return '';
    if (typeof raw !== 'string') throw new HttpError(400, 'invalid_input', { field });
    let text = raw.replace(/\r\n?/g, '\n').normalize('NFC');
    text = multiline ? text.trim().replace(/\n{3,}/g, '\n\n') : text.replace(/\s+/g, ' ').trim();
    if ([...text].length > max) throw new HttpError(400, 'invalid_input', { field, max });
    return text;
  }

  /** Politique des liens d'un texte publié (liens hors liste blanche retirés, comptes récents refusés). */
  function policed(text, user) {
    if (!text) return text;
    const out = access().linkPolicy?.(text, user);
    return typeof out === 'string' ? out.trim() : text;
  }

  /** Titre d'une liste : 1 à 100 caractères (400 title_required s'il manque ou ne garde que des liens retirés). */
  function titleOf(raw, user) {
    const title = policed(cleanText(raw, { max: TITLE_MAX, field: 'title' }), user);
    if (!title) throw new HttpError(400, 'title_required');
    return title;
  }

  const descriptionOf = (raw, user) => policed(cleanText(raw, { max: DESCRIPTION_MAX, field: 'description', multiline: true }), user) || null;

  /** Élément du catalogue (album ou morceau) qui existe, sinon 404 unknown_item. */
  function checkItem(type, rawId, index = null) {
    const id = validate.id(rawId);
    const found = id && (type === 'album' ? catalog.album(id) : catalog.track(id));
    if (!found) {
      throw new HttpError(404, 'unknown_item', { item: { type, id: typeof rawId === 'string' ? rawId.slice(0, 80) : null }, ...(index != null ? { index } : {}) });
    }
    return id;
  }

  /** Type d'élément accepté par une liste d'albums, de morceaux ou mixte ; 400 wrong_item_type sinon. */
  function typeOf(raw, itemType) {
    const type = validate.oneOf(raw, ['album', 'track'], { field: 'type' });
    if (itemType !== 'mixed' && type !== itemType) throw new HttpError(400, 'wrong_item_type', { itemType });
    return type;
  }

  /** Éléments reçus → [{ type, id, note }] : au plus 250 (409 list_full), sans doublon (409 already_in_list). */
  function checkItems(raw, itemType, user) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new HttpError(400, 'invalid_input', { field: 'items' });
    if (raw.length > LIST_MAX_ITEMS) throw new HttpError(409, 'list_full', { max: LIST_MAX_ITEMS });
    const seen = new Set();
    return raw.map((it, index) => {
      if (!it || typeof it !== 'object') throw new HttpError(400, 'invalid_input', { field: 'items', index });
      const type = typeOf(it.type, itemType);
      const id = checkItem(type, it.id, index);
      const key = `${type}:${id}`;
      if (seen.has(key)) throw new HttpError(409, 'already_in_list', { item: { type, id } });
      seen.add(key);
      return { type, id, note: policed(cleanText(it.note, { max: NOTE_MAX, field: 'note', multiline: true }), user) || null };
    });
  }

  // ----- écriture -----------------------------------------------------------------------------

  /**
   * Remplace tous les éléments d'une liste (dans la transaction de l'appelant) : positions 0 à n-1 (ou celles données
   * par `position`), date d'ajout gardée pour un élément déjà présent. Met à jour item_count et updated_at.
   */
  function writeItems(listId, items, now) {
    const before = new Map(q('SELECT item_type, item_id, added_at FROM list_items WHERE list_id = ?').all(listId)
      .map((r) => [`${r.item_type}:${r.item_id}`, r.added_at]));
    q('DELETE FROM list_items WHERE list_id = ?').run(listId);
    const ins = q('INSERT INTO list_items (list_id, position, item_type, item_id, note, added_at) VALUES (?, ?, ?, ?, ?, ?)');
    items.forEach((it, i) => {
      ins.run(listId, it.position ?? i, it.type, it.id, it.note ?? null, before.get(`${it.type}:${it.id}`) ?? now);
    });
    q('UPDATE lists SET item_count = ?, updated_at = ? WHERE id = ?').run(items.length, now, listId);
  }

  /** Événement list.saved d'une liste relue après écriture. */
  function emitSaved(listId) {
    const row = q('SELECT id, user_id, kind, visibility, item_count FROM lists WHERE id = ?').get(listId);
    if (!row) return;
    deps.bus.emit('list.saved', { listId: row.id, userId: row.user_id, kind: row.kind, visibility: row.visibility, itemCount: row.item_count });
  }

  // ----- pages ----------------------------------------------------------------------------------

  /** Éléments d'une liste, dans l'ordre (250 au plus) : [{ position, type, id, note }]. */
  function itemsOf(listId) {
    return q('SELECT position, item_type, item_id, note FROM list_items WHERE list_id = ? ORDER BY position LIMIT ?')
      .all(listId, LIST_MAX_ITEMS)
      .map((r) => ({ position: r.position, type: r.item_type, id: r.item_id, note: r.note }));
  }

  /** Page d'une liste : { list, description, items, comments, catalog } (commentaires par social.js quand il est là). */
  function pageOf(viewer, row, query = {}, { comments = true } = {}) {
    const refs = collector();
    const [list] = summarize(viewer, [row], refs);
    if (!list) throw notFound();
    list.mine = row.user_id === viewer.id;
    list.createdAt = row.created_at;
    const items = itemsOf(row.id);
    for (const it of items) refs.item(it.type, it.id);
    let thread = { items: [], nextCursor: null };
    if (comments) thread = deps.social?.commentsPage?.(viewer, { type: 'list', id: row.id }, query, refs) ?? thread;
    return { list, description: row.description, items, comments: thread, catalog: refs.build() };
  }

  /** Page de listes lue avec LIMIT + 1 : résumés et curseur suivant. */
  function listPage(viewer, rows, limit, keyOf) {
    const page = paging.keysetPage(rows, limit, keyOf);
    const refs = collector();
    return { items: summarize(viewer, page.items, refs), nextCursor: page.nextCursor, catalog: refs.build() };
  }

  /** Curseur [valeur de tri, id] : deux nombres, sinon 400 invalid_input. */
  const keyset = (raw) => {
    const after = paging.decodeCursor(raw, { length: 2 });
    if (after && !(Number.isFinite(after[0]) && Number.isInteger(after[1]))) throw new HttpError(400, 'invalid_input', { field: 'cursor' });
    return after;
  };

  /**
   * GET /api/lists?owner=me|friends|popular|<pseudo> : mes listes (toutes, les plus récemment modifiées d'abord), celles
   * de mes amis, les plus aimées (index lists_popular) ou celles d'un joueur (son Studio fermé : `restricted: true`).
   * Les grilles « Mes 9 albums » ont leur propre route ; les listes vides ne sont montrées qu'à leur propriétaire.
   */
  function browse(viewerId, query = {}) {
    const viewer = viewerOf(viewerId);
    const owner = typeof query.owner === 'string' && query.owner ? query.owner : 'me';
    const { limit } = paging.pageOf(query, { def: PAGE });
    const after = keyset(query.cursor);
    const byDate = (base, args) => (after
      ? q(`${base} AND (updated_at, id) < (?, ?) ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...args, after[0], after[1], limit + 1)
      : q(`${base} ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...args, limit + 1));
    const dateKey = (r) => [r.updated_at, r.id];

    if (owner === 'me') {
      return listPage(viewer, byDate(`SELECT ${LIST_COLS} FROM lists WHERE user_id = ? AND kind = 'list'`, [viewer.id]), limit, dateKey);
    }
    if (owner === 'friends') {
      const friends = [...viewer.friends];
      if (!friends.length) return { items: [], nextCursor: null, catalog: deps.refs() };
      const rows = byDate(`SELECT ${LIST_COLS} FROM lists WHERE user_id IN (SELECT value FROM json_each(?)) AND kind = 'list'
        AND visibility IN ('public', 'friends') AND hidden_at IS NULL AND item_count > 0`, [json(friends)]);
      return listPage(viewer, rows, limit, dateKey);
    }
    if (owner === 'popular') {
      // Mêmes termes que l'index partiel lists_popular (visibility, hidden_at, kind), parcouru dans l'ordre.
      const base = `SELECT ${LIST_COLS} FROM lists WHERE visibility = 'public' AND hidden_at IS NULL AND kind = 'list'
        AND item_count > 0 AND user_id NOT IN (SELECT value FROM json_each(?))`;
      const hidden = json([...viewer.hidden]);
      const rows = after
        ? q(`${base} AND (like_count, id) < (?, ?) ORDER BY like_count DESC, id DESC LIMIT ?`).all(hidden, after[0], after[1], limit + 1)
        : q(`${base} ORDER BY like_count DESC, id DESC LIMIT ?`).all(hidden, limit + 1);
      return listPage(viewer, rows, limit, (r) => [r.like_count, r.id]);
    }
    const target = targetUser(viewer, owner);
    if (!studioOpen(viewer, target)) return { items: [], nextCursor: null, restricted: true, catalog: deps.refs() };
    const self = target.id === viewer.id;
    const friend = !self && viewer.friends.has(target.id);
    const filter = self ? '' : friend
      ? " AND visibility IN ('public', 'friends') AND hidden_at IS NULL AND item_count > 0"
      : " AND visibility = 'public' AND hidden_at IS NULL AND item_count > 0";
    return listPage(viewer, byDate(`SELECT ${LIST_COLS} FROM lists WHERE user_id = ? AND kind = 'list'${filter}`, [target.id]), limit, dateKey);
  }

  /** GET /api/lists/:id */
  function getList(viewerId, rawId, query = {}) {
    const viewer = viewerOf(viewerId);
    return pageOf(viewer, readList(viewer, rawId), query);
  }

  /** POST /api/lists : nouvelle liste (avec ses éléments, facultatifs). Renvoie la page de la liste. */
  function createList(user, body = {}) {
    access().assertActive?.(user);
    const title = titleOf(body.title, user);
    const description = descriptionOf(body.description, user);
    const ranked = validate.bool(body.ranked) ? 1 : 0;
    const itemType = validate.oneOf(body.itemType, ITEM_TYPES, { optional: true, fallback: 'album', field: 'itemType' });
    const visibility = validate.oneOf(body.visibility, VISIBILITIES, { optional: true, fallback: 'public', field: 'visibility' });
    const items = checkItems(body.items, itemType, user);
    deps.quota(user.id, 'lists');
    const now = Date.now();
    const id = atomic(() => {
      const count = q("SELECT COUNT(*) AS n FROM (SELECT 1 FROM lists WHERE user_id = ? AND kind = 'list' LIMIT ?)").get(user.id, LISTS_PER_USER).n;
      if (count >= LISTS_PER_USER) throw new HttpError(409, 'too_many_lists', { max: LISTS_PER_USER });
      const row = q(`INSERT INTO lists (user_id, kind, title, description, ranked, item_type, visibility, created_at, updated_at)
        VALUES (?, 'list', ?, ?, ?, ?, ?, ?, ?) RETURNING id`).get(user.id, title, description, ranked, itemType, visibility, now, now);
      if (items.length) writeItems(row.id, items, now);
      return row.id;
    });
    emitSaved(id);
    const viewer = viewerOf(user.id);
    return pageOf(viewer, readList(viewer, id), {}, { comments: false });
  }

  /** PATCH /api/lists/:id : titre, description, classement, visibilité (la grille : titre et visibilité seulement). */
  function patchList(user, rawId, body = {}) {
    const row = ownList(user, rawId, { grid: true });
    access().assertActive?.(user);
    const sets = [];
    const args = [];
    if (body.title !== undefined) {
      sets.push('title = ?');
      args.push(titleOf(body.title, user));
    }
    if (body.visibility !== undefined) {
      sets.push('visibility = ?');
      args.push(validate.oneOf(body.visibility, VISIBILITIES, { field: 'visibility' }));
    }
    if (row.kind === 'list') {
      if (body.description !== undefined) {
        sets.push('description = ?');
        args.push(descriptionOf(body.description, user));
      }
      if (body.ranked !== undefined) {
        sets.push('ranked = ?');
        args.push(validate.bool(body.ranked) ? 1 : 0);
      }
    }
    if (sets.length) {
      q(`UPDATE lists SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...args, Date.now(), row.id);
      emitSaved(row.id);
    }
    const viewer = viewerOf(user.id);
    return pageOf(viewer, readList(viewer, row.id), {}, { comments: false });
  }

  /** PUT /api/lists/:id/items : remplace tous les éléments (ordre et notes) en une transaction. */
  function replaceItems(user, rawId, body = {}) {
    const row = ownList(user, rawId);
    access().assertActive?.(user);
    if (!Array.isArray(body.items)) throw new HttpError(400, 'invalid_input', { field: 'items' });
    const items = checkItems(body.items, row.item_type, user);
    atomic(() => writeItems(row.id, items, Date.now()));
    emitSaved(row.id);
    const viewer = viewerOf(user.id);
    return pageOf(viewer, readList(viewer, row.id), {}, { comments: false });
  }

  /** POST /api/lists/:id/items : ajoute un élément à la fin (« Ajouter à une liste »). */
  function addItem(user, rawId, body = {}) {
    const row = ownList(user, rawId);
    access().assertActive?.(user);
    const type = typeOf(body.type, row.item_type);
    const id = checkItem(type, body.id);
    const note = policed(cleanText(body.note, { max: NOTE_MAX, field: 'note', multiline: true }), user) || null;
    const now = Date.now();
    atomic(() => {
      if (q('SELECT 1 FROM list_items WHERE list_id = ? AND item_type = ? AND item_id = ?').get(row.id, type, id)) {
        throw new HttpError(409, 'already_in_list', { item: { type, id } });
      }
      const count = q('SELECT COUNT(*) AS n FROM list_items WHERE list_id = ?').get(row.id).n;
      if (count >= LIST_MAX_ITEMS) throw new HttpError(409, 'list_full', { max: LIST_MAX_ITEMS });
      const position = (q('SELECT MAX(position) AS p FROM list_items WHERE list_id = ?').get(row.id).p ?? -1) + 1;
      q('INSERT INTO list_items (list_id, position, item_type, item_id, note, added_at) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, position, type, id, note, now);
      q('UPDATE lists SET item_count = ?, updated_at = ? WHERE id = ?').run(count + 1, now, row.id);
    });
    emitSaved(row.id);
    const refs = collector();
    refs.item(type, id);
    const [list] = summarize(viewerOf(user.id), [q(`SELECT ${LIST_COLS} FROM lists WHERE id = ?`).get(row.id)], refs);
    return { list, item: { type, id, note }, catalog: refs.build() };
  }

  /** DELETE /api/lists/:id/items/:type/:itemId : retire un élément ; les positions suivantes se resserrent. */
  function removeItem(user, rawId, rawType, rawItemId) {
    const row = ownList(user, rawId);
    const type = validate.oneOf(rawType, ['album', 'track'], { field: 'type' });
    const itemId = validate.id(rawItemId);
    const removed = atomic(() => {
      const it = itemId && q('SELECT position FROM list_items WHERE list_id = ? AND item_type = ? AND item_id = ?').get(row.id, type, itemId);
      if (!it) return false;
      const rest = q('SELECT item_type AS type, item_id AS id, note FROM list_items WHERE list_id = ? AND NOT (item_type = ? AND item_id = ?) ORDER BY position')
        .all(row.id, type, itemId);
      writeItems(row.id, rest, Date.now());
      return true;
    });
    if (!removed) throw notFound();
    emitSaved(row.id);
    const refs = collector();
    const [list] = summarize(viewerOf(user.id), [q(`SELECT ${LIST_COLS} FROM lists WHERE id = ?`).get(row.id)], refs);
    return { list, catalog: refs.build() };
  }

  /** DELETE /api/lists/:id : la liste, ses éléments, ses commentaires, « J'aime », notifications et activité. */
  function deleteList(user, rawId) {
    const row = ownList(user, rawId, { grid: true });
    atomic(() => {
      deps.moderation?.purgeTarget?.('list', row.id);
      q('DELETE FROM lists WHERE id = ?').run(row.id);
    });
    deps.bus.emit('content.removed', { targetType: 'list', targetId: row.id, by: 'author' });
    return { ok: true };
  }

  /**
   * GET /api/items/album/:id/lists : listes (et grilles « Mes 9 albums ») lisibles qui contiennent l'album. Première page :
   * celles des amis d'abord (5 au plus), puis toutes, des plus récentes aux plus anciennes (index list_items_item,
   * curseur [list_id]). Une grille n'y figure que si le Studio de son joueur est public (ou si c'est la mienne).
   */
  function albumLists(viewerId, rawAlbumId, query = {}) {
    const albumId = validate.id(rawAlbumId);
    if (!albumId || !catalog.album(albumId)) throw new HttpError(404, 'unknown_item');
    const viewer = viewerOf(viewerId);
    const limit = paging.limitOf(query.limit, { def: 10 });
    const cursor = paging.decodeCursor(query.cursor, { length: 1 });
    if (cursor && !Number.isInteger(cursor[0])) throw new HttpError(400, 'invalid_input', { field: 'cursor' });
    const friends = json([...viewer.friends]);
    const cols = LIST_COLS.split(', ').map((c) => `l.${c}`).join(', ');
    const visible = `l.hidden_at IS NULL AND l.kind IN ('list', 'grid9')
      AND (l.kind = 'list' OR u.profile_visibility = 'public' OR l.user_id = :me)`;
    // Les listes des amis en tête (recalculées à chaque page, pour ne jamais revenir plus loin dans le fil).
    const top = viewer.friends.size
      ? q(`SELECT ${cols} FROM list_items li JOIN lists l ON l.id = li.list_id JOIN users u ON u.id = l.user_id
          WHERE li.item_type = 'album' AND li.item_id = :album AND ${visible}
          AND l.visibility IN ('public', 'friends') AND l.user_id IN (SELECT value FROM json_each(:friends))
          ORDER BY li.list_id DESC LIMIT :n`).all({ album: albumId, me: viewer.id, friends, n: ALBUM_FRIENDS })
      : [];
    const rows = q(`SELECT ${cols} FROM list_items li JOIN lists l ON l.id = li.list_id JOIN users u ON u.id = l.user_id
      WHERE li.item_type = 'album' AND li.item_id = :album AND li.list_id < :after AND ${visible}
      AND (l.visibility = 'public' OR l.user_id = :me OR (l.visibility = 'friends' AND l.user_id IN (SELECT value FROM json_each(:friends))))
      AND l.user_id NOT IN (SELECT value FROM json_each(:hidden)) AND l.id NOT IN (SELECT value FROM json_each(:top))
      ORDER BY li.list_id DESC LIMIT :n`).all({
      album: albumId, after: cursor ? cursor[0] : Number.MAX_SAFE_INTEGER, me: viewer.id, friends, hidden: json([...viewer.hidden]),
      top: json(top.map((r) => r.id)), n: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const refs = collector();
    return {
      items: summarize(viewer, cursor ? page : [...top, ...page], refs),
      nextCursor: rows.length > limit && last ? paging.encodeCursor([last.id]) : null,
      catalog: refs.build(),
    };
  }

  // ----- « Mes 9 albums » -----------------------------------------------------------------------

  /** Grille d'un joueur : { row, slots: [albumId | null] × 9 } (row null tant qu'elle n'a jamais été sauvegardée). */
  function grid9Of(userId) {
    const row = q(`SELECT ${LIST_COLS} FROM lists WHERE user_id = ? AND kind = 'grid9'`).get(userId) || null;
    const slots = Array(GRID_SLOTS).fill(null);
    if (row) {
      for (const r of q("SELECT position, item_id FROM list_items WHERE list_id = ? AND item_type = 'album' AND position < ?").all(row.id, GRID_SLOTS)) {
        slots[r.position] = r.item_id;
      }
    }
    return { row, slots };
  }

  /** Réponse d'une grille : { list, title, slots, catalog }. */
  function gridView(viewer, owner, { row, slots }, refs = collector()) {
    refs.albums(slots.filter(Boolean));
    const [list] = row ? summarize(viewer, [row], refs) : [];
    return { list: list || null, title: row?.title || GRID_TITLES[owner.lang] || GRID_TITLES.fr, slots, catalog: refs.build() };
  }

  /**
   * Écrit la grille d'un joueur (ligne créée à la première fois). `slots` : 9 cases (album ou null), déjà validées ;
   * `title` / `visibility` : facultatifs. Renvoie l'identifiant de la liste.
   */
  function writeGrid(userId, slots, { title = null, visibility = null } = {}) {
    const now = Date.now();
    const id = atomic(() => {
      let row = q("SELECT id FROM lists WHERE user_id = ? AND kind = 'grid9'").get(userId);
      if (!row) {
        const lang = q('SELECT lang FROM users WHERE id = ?').get(userId)?.lang;
        q(`INSERT OR IGNORE INTO lists (user_id, kind, title, ranked, item_type, visibility, created_at, updated_at)
          VALUES (?, 'grid9', ?, 1, 'album', ?, ?, ?)`).run(userId, title || GRID_TITLES[lang] || GRID_TITLES.fr, visibility || 'public', now, now);
        row = q("SELECT id FROM lists WHERE user_id = ? AND kind = 'grid9'").get(userId);
      } else {
        if (title) q('UPDATE lists SET title = ? WHERE id = ?').run(title, row.id);
        if (visibility) q('UPDATE lists SET visibility = ? WHERE id = ?').run(visibility, row.id);
      }
      const items = [];
      slots.forEach((albumId, position) => {
        if (albumId) items.push({ type: 'album', id: albumId, position });
      });
      writeItems(row.id, items, now);
      return row.id;
    });
    emitSaved(id);
    return id;
  }

  /** Cases reçues → 9 cases (album existant ou null) ; `strict` : 400 / 404 unknown_item / 409 already_in_list. */
  function checkSlots(raw, { strict = true } = {}) {
    let list = raw;
    if (!Array.isArray(list) || list.length > GRID_SLOTS) {
      if (strict) throw new HttpError(400, 'invalid_input', { field: 'slots' });
      list = Array.isArray(list) ? list.slice(0, GRID_SLOTS) : [];
    }
    const slots = Array(GRID_SLOTS).fill(null);
    const seen = new Set();
    list.forEach((value, i) => {
      if (value === null || value === undefined || value === '') return;
      const id = validate.id(value);
      if (!id || !catalog.album(id)) {
        if (strict) throw new HttpError(404, 'unknown_item', { item: { type: 'album', id: typeof value === 'string' ? value.slice(0, 80) : null }, slot: i });
        return;
      }
      if (seen.has(id)) {
        if (strict) throw new HttpError(409, 'already_in_list', { item: { type: 'album', id }, slot: i });
        return;
      }
      seen.add(id);
      slots[i] = id;
    });
    return slots;
  }

  /** GET /api/me/grid9 */
  function myGrid(user) {
    const owner = q('SELECT id, lang FROM users WHERE id = ?').get(user.id) || { lang: 'fr' };
    return gridView(viewerOf(user.id), owner, grid9Of(user.id));
  }

  /** PUT /api/me/grid9 : { title?, slots, visibility? } (sauvegarde automatique de l'éditeur). */
  function saveGrid(user, body = {}) {
    access().assertActive?.(user);
    const slots = checkSlots(body.slots);
    const blank = body.title === undefined || body.title === null || (typeof body.title === 'string' && !body.title.trim());
    const title = blank ? null : titleOf(body.title, user);
    const visibility = validate.oneOf(body.visibility, VISIBILITIES, { optional: true, field: 'visibility' });
    writeGrid(user.id, slots, { title, visibility });
    return myGrid(user);
  }

  /** GET /api/users/:username/grid9 : lecture (Studio fermé : `restricted: true` ; grille illisible : list null). */
  function userGrid(viewerId, username) {
    const viewer = viewerOf(viewerId);
    const target = targetUser(viewer, username);
    const user = services.userSummaries([target.id], viewer.id, { hidden: viewer.hidden }).get(target.id) || null;
    const refs = collector();
    if (user) refs.users([user]);
    const empty = { list: null, title: GRID_TITLES[target.lang] || GRID_TITLES.fr, slots: Array(GRID_SLOTS).fill(null) };
    if (!studioOpen(viewer, target)) return { ...empty, user, restricted: true, catalog: refs.build() };
    const grid = grid9Of(target.id);
    const readable = grid.row && canRead(viewer, target.id, grid.row.visibility) && (!grid.row.hidden_at || target.id === viewer.id);
    if (!readable) return { ...empty, user, catalog: refs.build() };
    return { ...gridView(viewer, target, grid, refs), user };
  }

  /**
   * API interne (onboarding, P1-E) : remplace la grille d'un joueur par ces albums (9 au plus ; inconnus et doublons
   * ignorés). Renvoie { list, title, slots, catalog } comme GET /api/me/grid9 ; joueur inconnu (compte supprimé
   * entre-temps) : rien n'est écrit, undefined (comme le squelette de K0).
   */
  function setGrid9(userId, albumIds, { title = null } = {}) {
    const uid = toId(userId);
    if (!uid || !q('SELECT 1 FROM users WHERE id = ?').get(uid)) return undefined;
    const slots = checkSlots(Array.isArray(albumIds) ? albumIds.slice(0, GRID_SLOTS) : [], { strict: false });
    writeGrid(uid, slots, { title });
    return myGrid({ id: uid });
  }

  // Liste masquée par la modération (ou auteur suspendu) : la recherche la relit, et la retire.
  deps.bus.on('moderation.action', ({ targetType, targetId, action }) => {
    if (targetType === 'list' && (action === 'hide' || action === 'suspend')) deps.search?.upsert?.('list', String(targetId));
  });

  return {
    summaries, grid9Of, setGrid9,
    browse, getList, createList, patchList, replaceItems, addItem, removeItem, deleteList, albumLists,
    myGrid, saveGrid, userGrid,
  };
}

export function routes(r, deps) {
  const { limits } = deps;
  const api = () => deps.lists;

  r.get('/lists', limits.read, (req, res) => res.json(api().browse(req.user.id, req.query)));
  r.post('/lists', limits.write, (req, res) => res.status(201).json(api().createList(req.user, req.body)));
  r.get('/lists/:id', limits.read, (req, res) => res.json(api().getList(req.user.id, req.params.id, req.query)));
  r.patch('/lists/:id', limits.write, (req, res) => res.json(api().patchList(req.user, req.params.id, req.body)));
  r.delete('/lists/:id', limits.write, (req, res) => res.json(api().deleteList(req.user, req.params.id)));
  r.put('/lists/:id/items', limits.write, (req, res) => res.json(api().replaceItems(req.user, req.params.id, req.body)));
  r.post('/lists/:id/items', limits.write, (req, res) => res.status(201).json(api().addItem(req.user, req.params.id, req.body)));
  r.delete('/lists/:id/items/:type/:itemId', limits.write, (req, res) => res.json(api().removeItem(req.user, req.params.id, req.params.type, req.params.itemId)));
  r.get('/items/album/:id/lists', limits.read, (req, res) => res.json(api().albumLists(req.user.id, req.params.id, req.query)));

  r.get('/me/grid9', limits.read, (req, res) => res.json(api().myGrid(req.user)));
  r.put('/me/grid9', limits.write, (req, res) => res.json(api().saveGrid(req.user, req.body)));
  r.get('/users/:username/grid9', limits.read, (req, res) => res.json(api().userGrid(req.user.id, req.params.username)));
}
