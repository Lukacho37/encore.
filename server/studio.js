// Module « studio » : le Studio d'un joueur (profil) — blocs, confidentialité, favoris, cosmétiques (PLAN.md 2.5,
// 4.2.3, 7.2). Chantier : P1-B.
//
// GET /api/users/:username remplace la route du profil public de P0 en la prolongeant : tous les champs d'avant
// restent (stats, showcase, vinyls, completedAlbums, masteredArtists, upcoming, cosmetics, friendship, requestId…),
// et le Studio ajoute :
//   user           UserSummary + { bio, createdAt, friendsCount, visibility }
//   relation       'self' | 'friend' | 'incoming' | 'outgoing' | null (vue de celui qui regarde)
//   access         'full' | 'header' : un Studio « amis » vu par un non-ami, ou « privé » vu par un autre, ne montre
//                  que l'en-tête (avatar, pseudo, titre, bio, niveau, chiffres, nombre d'amis) ; le reste arrive vide
//   blocks         [{ id, on }] : les 12 blocs de la vue d'ensemble, dans l'ordre choisi (ceux qui manquent à la fin)
//   vinyls         les 24 vinyles les plus récents (du plus ancien au plus récent, comme l'étagère) ; vinylCount : le
//                  total ; la suite par GET /api/users/:username/vinyls?cursor=
//   featuredVinyl  vinyle mis en avant { albumId, at, rank, edition, color } ou null (le site prend alors le plus récent)
//   favorites      { artists, tracks, genres } (5 au plus chacun) ; featuredLists : ListSummary épinglés (3 au plus) ;
//   recent         derniers morceaux obtenus [{ trackId, variant, at }] (12 au plus)
// Les références du catalogue sont reconstruites une fois (refs) pour ce qui est renvoyé : la réponse reste bornée,
// même pour le plus gros collectionneur (ni 120 vinyles ni 100 artistes de trop).
//
// Règles (appliquées ici, jamais par le site) : un joueur bloqué dans un sens ou dans l'autre n'existe pas (404
// user_not_found) ; la bio est un contenu de joueur : compte actif (deps.access.assertActive), politique des liens
// (deps.access.linkPolicy), 280 caractères au plus, cachée aux autres pendant une suspension ; les cosmétiques sont
// vérifiés par deps.collection.setCosmetics (409 cosmetic_locked) ; un vinyle mis en avant doit être pressé (400
// vinyl_not_owned), une liste épinglée être une liste à soi (404 not_found).
// Événements : favorites.saved { userId, kind } (goûts d'un joueur : Taste Match, Découvrir peuvent s'y abonner).
// GET /api/me/profile : les réglages seuls (bio, confidentialité, blocs, favoris), pour l'éditeur et les Paramètres.
// API interne (deps.studio) : accessOf(viewerId, target), blocksOf(raw), favoritesOf(userId), BLOCK_IDS.
import { THEME_GENRES } from '../shared/rules.js';

export const name = 'studio';

/**
 * Blocs de la vue d'ensemble, dans l'ordre par défaut (PLAN.md 2.5). Même liste que le site
 * (client/src/components/studio/blocks.js, vérifié par server/test/studio.test.js).
 */
export const BLOCK_IDS = ['nine', 'showcase', 'vinyls', 'trophies', 'wishlist', 'artists', 'tracks', 'reviews', 'lists', 'recent', 'activity', 'stats'];
export const VISIBILITIES = ['public', 'friends', 'private'];
/** Types de favoris (route) → clé de la réponse. Les albums favoris sont « Mes 9 albums » (lists.js). */
export const FAVORITE_KINDS = { artist: 'artists', track: 'tracks', genre: 'genres' };
export const BIO_MAX = 280;
export const FAVORITES_MAX = 5;
export const FEATURED_LISTS_MAX = 3;
/** Vinyles envoyés avec le Studio (la suite par pages), derniers morceaux obtenus. */
export const VINYLS_SHOWN = 24;
const VINYLS_PAGE = 24;
const RECENT_MAX = 12;

/** Identifiant entier positif reçu d'une requête, sinon null. */
const toId = (raw) => {
  const n = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * Configuration des blocs lue dans users.studio (ou reçue) → [{ id, on }] complète : ids connus seulement, sans
 * doublon, dans l'ordre donné, puis les blocs absents à la fin (affichés). Ne lève jamais.
 */
export function blocksOf(raw) {
  const out = [];
  const seen = new Set();
  for (const b of Array.isArray(raw) ? raw : []) {
    const id = typeof b === 'string' ? b : b?.id;
    if (!BLOCK_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, on: typeof b === 'object' && b ? b.on !== false : true });
  }
  for (const id of BLOCK_IDS) if (!seen.has(id)) out.push({ id, on: true });
  return out;
}

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
  const parse = (text, fallback) => {
    try {
      const v = JSON.parse(text);
      return v && typeof v === 'object' ? v : fallback;
    } catch {
      return fallback;
    }
  };

  const USER_COLS = 'id, username, avatar, avatar_color, xp, created_at, bio, profile_visibility, studio, suspended_until';

  /** Joueur affiché (vérifié, pas bloqué dans un sens ou dans l'autre), sinon 404 user_not_found. */
  function targetUser(viewerId, username) {
    const target = q(`SELECT ${USER_COLS} FROM users WHERE username = ? AND email_verified_at IS NOT NULL`).get(String(username || ''));
    if (!target || (target.id !== viewerId && access().isBlocked?.(viewerId, target.id))) throw new HttpError(404, 'user_not_found');
    return target;
  }

  const visibilityOf = (row) => (VISIBILITIES.includes(row?.profile_visibility) ? row.profile_visibility : 'public');

  /** 'full' ou 'header' : ce que `viewerId` voit du Studio de `target` (blocages vérifiés avant). */
  function accessOf(viewerId, target) {
    if (Number(viewerId) === target.id) return 'full';
    const vis = visibilityOf(target);
    if (vis === 'public') return 'full';
    if (vis === 'friends' && services.friendIds(Number(viewerId)).has(target.id)) return 'full';
    return 'header';
  }

  /** users.studio nettoyé : { blocks, featuredVinyl, featuredLists }. */
  function studioOf(row) {
    const raw = parse(row?.studio, {});
    return {
      blocks: blocksOf(raw.blocks),
      featuredVinyl: validate.id(raw.featuredVinyl),
      featuredLists: (Array.isArray(raw.featuredLists) ? raw.featuredLists : []).map(toId).filter(Boolean).slice(0, FEATURED_LISTS_MAX),
    };
  }

  const friendsCount = (userId) => q(`SELECT COUNT(*) AS n FROM friendships
    WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'`).get(userId, userId).n;

  /** Favoris d'un joueur : { artists, tracks, genres }, dans l'ordre choisi, 5 au plus chacun. */
  function favoritesOf(userId) {
    const out = { artists: [], tracks: [], genres: [] };
    for (const r of q('SELECT kind, item_id FROM user_favorites WHERE user_id = ? ORDER BY kind, position, created_at').all(userId)) {
      const list = out[FAVORITE_KINDS[r.kind]];
      if (list && list.length < FAVORITES_MAX) list.push(r.item_id);
    }
    return out;
  }

  /** Vinyle d'un album pressé par ce joueur : { albumId, at, rank, edition, color } ou null. */
  function vinylOf(userId, albumId, vinylColor) {
    if (!albumId) return null;
    const r = q(`SELECT a.created_at, a.rank, p.holo, p.total FROM achievements a
      LEFT JOIN user_album_progress p ON p.user_id = a.user_id AND p.album_id = ?
      WHERE a.user_id = ? AND a.key = ?`).get(albumId, userId, `album:${albumId}`);
    if (!r || !catalog.album(albumId)) return null;
    const edition = r.total && r.holo >= r.total ? 'holo' : 'black';
    return { albumId, at: r.created_at, rank: r.rank ?? null, edition, color: edition === 'black' ? vinylColor || null : null };
  }

  /** Derniers morceaux obtenus (index cards_user_first) : un par morceau, la version holo si elle existe. */
  function recentOf(userId) {
    const rows = q('SELECT track_id, variant, first_at FROM cards WHERE user_id = ? ORDER BY first_at DESC LIMIT ?').all(userId, RECENT_MAX * 2);
    const byTrack = new Map();
    for (const r of rows) {
      const prev = byTrack.get(r.track_id);
      if (!prev) byTrack.set(r.track_id, { trackId: r.track_id, variant: r.variant, at: r.first_at });
      else if (r.variant === 'holo') prev.variant = 'holo';
    }
    return [...byTrack.values()].slice(0, RECENT_MAX);
  }

  /** Bio montrée à `viewerId` : celle du joueur, sauf pendant une suspension (modération) pour les autres. */
  const bioFor = (viewerId, target) => {
    if (!target.bio) return null;
    if (target.id !== Number(viewerId) && target.suspended_until && target.suspended_until > Date.now()) return null;
    return target.bio;
  };

  /** GET /api/users/:username : le Studio (voir l'en-tête du fichier). */
  function studio(viewerId, username) {
    const target = targetUser(viewerId, username);
    // Partie de P0 (statistiques, vitrine, vinyles, maîtrises, prochains vinyles, relation), gardée 30 s par services.
    const base = services.publicProfile(viewerId, target.username);
    const summary = services.userSummaries([target.id], viewerId, { hidden: new Set() }).get(target.id);
    const mode = accessOf(viewerId, target);
    const full = mode === 'full';
    const config = studioOf(target);
    const cosmetics = base.cosmetics || {};
    const user = {
      ...summary,
      bio: bioFor(viewerId, target),
      createdAt: target.created_at,
      friendsCount: friendsCount(target.id),
      visibility: visibilityOf(target),
    };
    const allVinyls = full ? base.vinyls || [] : [];
    const vinyls = allVinyls.slice(-VINYLS_SHOWN);
    const vinylCount = full ? Math.max(allVinyls.length, base.stats?.albumsCompleted ?? 0) : 0;
    const featured = full ? vinylOf(target.id, config.featuredVinyl, cosmetics.vinyl) : null;
    const favorites = full ? favoritesOf(target.id) : { artists: [], tracks: [], genres: [] };
    const recent = full ? recentOf(target.id) : [];
    const masters = full ? base.masteredArtists || [] : [];
    const upcoming = full ? base.upcoming || [] : [];
    const showcase = full ? base.showcase || [] : [];
    const lists = full && config.featuredLists.length && deps.lists?.summaries
      ? [...deps.lists.summaries(viewerId, config.featuredLists).values()].filter((l) => l.kind === 'list' && l.user?.id === target.id)
      : [];
    // Ordre choisi des listes épinglées (summaries suit l'ordre de la base).
    lists.sort((a, b) => config.featuredLists.indexOf(a.id) - config.featuredLists.indexOf(b.id));
    const catalogRefs = deps.refs({
      trackIds: [...showcase.filter(Boolean).map((s) => s.trackId), ...recent.map((r) => r.trackId), ...favorites.tracks],
      albumIds: [
        ...vinyls.map((v) => v.albumId), ...upcoming.map((u) => u.albumId), featured?.albumId,
        ...lists.flatMap((l) => l.coverAlbumIds || []), ...services.summaryAlbums([summary]),
      ].filter(Boolean),
      artistIds: [...masters, ...favorites.artists],
    });
    const knownTracks = new Set(catalogRefs.tracks.map((t) => t.id));
    return {
      // Champs du profil de P0 (même forme, pour les écrans et les tests d'avant).
      id: target.id,
      username: target.username,
      avatar: target.avatar,
      avatarColor: target.avatar_color,
      level: base.level,
      createdAt: target.created_at,
      stats: base.stats,
      showcase,
      cosmetics,
      completedAlbums: vinyls.map((v) => v.albumId),
      vinyls,
      vinylCount,
      masteredArtists: masters,
      upcoming,
      friendship: base.friendship,
      requestId: base.requestId,
      // Studio (P1).
      user,
      relation: summary?.relation ?? null,
      access: mode,
      blocks: config.blocks,
      featuredVinyl: featured,
      favorites,
      featuredLists: lists,
      recent: recent.filter((r) => knownTracks.has(r.trackId)),
      catalog: catalogRefs,
    };
  }

  /** GET /api/users/:username/vinyls?cursor= : l'étagère complète, page par page (curseur [created_at, key]). */
  function vinylPage(viewerId, username, query = {}) {
    const target = targetUser(viewerId, username);
    if (accessOf(viewerId, target) !== 'full') return { items: [], nextCursor: null, restricted: true, catalog: deps.refs() };
    const { cursor, limit } = paging.pageOf(query, { def: VINYLS_PAGE, max: 48 });
    if (cursor && (!Number.isFinite(cursor[0]) || typeof cursor[1] !== 'string')) throw new HttpError(400, 'invalid_input', { field: 'cursor' });
    const color = deps.collection?.cosmeticsOf ? deps.collection.cosmeticsOf(target.id)?.vinyl : null;
    const after = cursor ? ' AND (a.created_at, a.key) < (?, ?)' : '';
    const rows = q(`SELECT a.key, a.created_at, a.rank, p.holo, p.total FROM achievements a
      LEFT JOIN user_album_progress p ON p.user_id = a.user_id AND p.album_id = substr(a.key, 7)
      WHERE a.user_id = ? AND a.key >= 'album:' AND a.key < 'album;'${after}
        AND EXISTS (SELECT 1 FROM cat_albums al WHERE al.id = substr(a.key, 7))
      ORDER BY a.created_at DESC, a.key DESC LIMIT ?`).all(target.id, ...(cursor || []), limit + 1);
    const page = paging.keysetPage(rows, limit, (r) => [r.created_at, r.key]);
    const items = page.items.map((r) => {
      const edition = r.total && r.holo >= r.total ? 'holo' : 'black';
      return { albumId: r.key.slice(6), at: r.created_at, rank: r.rank ?? null, edition, color: edition === 'black' ? color || null : null };
    });
    return { items, nextCursor: page.nextCursor, catalog: deps.refs({ albumIds: items.map((v) => v.albumId) }) };
  }

  /**
   * GET /api/me/profile : réglages du Studio du joueur connecté, sans le reste du Studio (éditeur, Paramètres) →
   * { bio, visibility, blocks, featuredVinyl, featuredLists, favorites, catalog }.
   */
  function myProfile(userId) {
    const row = q(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(userId);
    if (!row) throw new HttpError(401, 'unauthenticated');
    const config = studioOf(row);
    const favorites = favoritesOf(userId);
    return {
      bio: row.bio ?? null,
      visibility: visibilityOf(row),
      ...config,
      favorites,
      catalog: deps.refs({ trackIds: favorites.tracks, artistIds: favorites.artists, albumIds: [config.featuredVinyl].filter(Boolean) }),
    };
  }

  // ----- écriture ---------------------------------------------------------------------------------

  /** Texte de la bio : retours à la ligne normalisés (une ligne vide au plus entre deux), 280 caractères au plus. */
  function cleanBio(raw, user) {
    if (raw === null || raw === '') return null;
    if (typeof raw !== 'string') throw new HttpError(400, 'invalid_input', { field: 'bio' });
    let text = raw.replace(/\r\n?/g, '\n').normalize('NFC').trim().replace(/\n{3,}/g, '\n\n');
    if ([...text].length > BIO_MAX) throw new HttpError(400, 'invalid_input', { field: 'bio', max: BIO_MAX });
    text = access().linkPolicy ? access().linkPolicy(text, user) : text;
    return text || null;
  }

  /** PUT /api/me/profile { bio?, visibility? } → { profile: { bio, visibility } }. */
  function setProfile(user, body = {}) {
    const row = q(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(user.id);
    if (!row) throw new HttpError(401, 'unauthenticated');
    const visibility = body.visibility === undefined ? visibilityOf(row) : validate.oneOf(body.visibility, VISIBILITIES, { field: 'visibility' });
    let bio = row.bio ?? null;
    if (body.bio !== undefined) {
      const next = cleanBio(body.bio, user);
      // Écrire une bio est une écriture de contenu : compte actif (suspension, CGU) ; l'effacer reste permis.
      if (next && next !== bio) access().assertActive?.(user);
      bio = next;
    }
    q('UPDATE users SET bio = ?, profile_visibility = ? WHERE id = ?').run(bio, visibility, user.id);
    services.forget?.(user.id);
    return { profile: { bio, visibility } };
  }

  /** PUT /api/me/studio { blocks?, featuredVinyl?, featuredLists? } → { studio: { blocks, featuredVinyl, featuredLists } }. */
  function setStudio(user, body = {}) {
    const next = studioOf(q('SELECT studio FROM users WHERE id = ?').get(user.id));
    if (body.blocks !== undefined) {
      if (!Array.isArray(body.blocks) || body.blocks.length > BLOCK_IDS.length) throw new HttpError(400, 'invalid_input', { field: 'blocks' });
      const seen = new Set();
      for (const b of body.blocks) {
        if (!b || typeof b !== 'object' || !BLOCK_IDS.includes(b.id) || seen.has(b.id) || (b.on !== undefined && typeof b.on !== 'boolean')) {
          throw new HttpError(400, 'invalid_input', { field: 'blocks' });
        }
        seen.add(b.id);
      }
      next.blocks = blocksOf(body.blocks);
    }
    if (body.featuredVinyl !== undefined) {
      if (body.featuredVinyl === null || body.featuredVinyl === '') next.featuredVinyl = null;
      else {
        const albumId = validate.id(body.featuredVinyl);
        if (!albumId || !vinylOf(user.id, albumId, null)) throw new HttpError(400, 'vinyl_not_owned', { field: 'featuredVinyl' });
        next.featuredVinyl = albumId;
      }
    }
    if (body.featuredLists !== undefined) {
      if (!Array.isArray(body.featuredLists) || body.featuredLists.length > FEATURED_LISTS_MAX) {
        throw new HttpError(400, 'invalid_input', { field: 'featuredLists', max: FEATURED_LISTS_MAX });
      }
      const ids = [...new Set(body.featuredLists.map(toId))];
      if (ids.some((x) => !x)) throw new HttpError(400, 'invalid_input', { field: 'featuredLists' });
      const owned = ids.length
        ? new Set(q("SELECT id FROM lists WHERE id IN (SELECT value FROM json_each(?)) AND user_id = ? AND kind = 'list'").all(json(ids), user.id).map((r) => r.id))
        : new Set();
      if (ids.some((x) => !owned.has(x))) throw new HttpError(404, 'not_found', { field: 'featuredLists' });
      next.featuredLists = ids;
    }
    q('UPDATE users SET studio = ? WHERE id = ?').run(json(next), user.id);
    return { studio: next };
  }

  /** PUT /api/me/favorites/:kind { ids ≤ 5 } → { favorites, catalog } (remplace la liste de ce type, dans l'ordre). */
  function setFavorites(user, rawKind, body = {}) {
    const kind = validate.oneOf(rawKind, Object.keys(FAVORITE_KINDS), { field: 'kind' });
    if (!Array.isArray(body.ids) || body.ids.length > FAVORITES_MAX) throw new HttpError(400, 'invalid_input', { field: 'ids', max: FAVORITES_MAX });
    const ids = validate.ids(body.ids, FAVORITES_MAX);
    if (ids.length !== body.ids.length) throw new HttpError(400, 'invalid_input', { field: 'ids' });
    const exists = kind === 'artist' ? (id) => !!catalog.artist(id)
      : kind === 'track' ? (id) => !!catalog.track(id)
        : (id) => THEME_GENRES.includes(id);
    const unknown = ids.find((id) => !exists(id));
    if (unknown) throw new HttpError(404, 'unknown_item', { id: unknown });
    const now = Date.now();
    deps.tx(() => {
      q('DELETE FROM user_favorites WHERE user_id = ? AND kind = ?').run(user.id, kind);
      ids.forEach((id, position) => {
        q('INSERT INTO user_favorites (user_id, kind, item_id, position, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, kind, id, position, now);
      });
    });
    deps.bus.emit('favorites.saved', { userId: user.id, kind });
    const favorites = favoritesOf(user.id);
    return { favorites, catalog: deps.refs({ trackIds: favorites.tracks, artistIds: favorites.artists }) };
  }

  /** PUT /api/me/cosmetics { frame?, vinyl?, theme?, title? } → { cosmetics, state } (409 cosmetic_locked). */
  function setCosmetics(user, body = {}) {
    if (!deps.collection?.setCosmetics) throw new HttpError(501, 'not_ready');
    const cosmetics = deps.collection.setCosmetics(user.id, body);
    services.forget?.(user.id);
    return { cosmetics, state: services.state(user.id, { partial: true }) };
  }

  // Un joueur suspendu (modération) : sa bio disparaît pour les autres ; le profil gardé en cache est oublié.
  deps.bus.on('moderation.action', ({ targetType, targetId, authorId }) => {
    if (targetType === 'user') services.forget?.(Number(authorId ?? targetId));
  });

  return { accessOf, blocksOf, BLOCK_IDS, studio, vinylPage, myProfile, favoritesOf, setProfile, setStudio, setFavorites, setCosmetics };
}

export function routes(r, deps) {
  const { limits } = deps;
  const api = () => deps.studio;

  r.get('/users/:username', limits.read, (req, res) => res.json(api().studio(req.user.id, req.params.username)));
  r.get('/users/:username/vinyls', limits.read, (req, res) => res.json(api().vinylPage(req.user.id, req.params.username, req.query)));
  r.get('/me/profile', limits.read, (req, res) => res.json(api().myProfile(req.user.id)));
  r.put('/me/profile', limits.write, (req, res) => res.json(api().setProfile(req.user, req.body)));
  r.put('/me/studio', limits.write, (req, res) => res.json(api().setStudio(req.user, req.body)));
  r.put('/me/favorites/:kind', limits.write, (req, res) => res.json(api().setFavorites(req.user, req.params.kind, req.body)));
  r.put('/me/cosmetics', limits.write, (req, res) => res.json(api().setCosmetics(req.user, req.body)));
}
