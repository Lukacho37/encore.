// Module « sets » : coffrets (PLAN.md 4.3, 6.8). Chantier : P2-B.
//
// Un coffret réunit 6 à 12 albums (shared/sets.js) ; sa progression est le nombre d'albums complétés du joueur
// (achievements `album:<id>`), avec en plus ses cartes sur ces albums (user_album_progress). Trois sortes :
// éditoriaux et d'événements (définis dans le code, créés au démarrage dès que le catalogue en réunit assez), générés
// (genre × décennie, les 8 albums les plus populaires, tâche `sets-generate`). La liste d'albums d'un coffret est figée
// à sa création : la progression d'un joueur ne recule jamais, et les coffrets restent ouverts pour toujours.
// Récompenses, données une seule fois (dans une transaction) dès que le seuil est atteint : badge
// `badge:set:<id>:bronze` aux 3/4 des albums (50 XP, comme un badge bronze), cadre `frame:set-<id>` au complet
// (user_cosmetics, source `set:<id>`). Vérifiées à chaque album complété (bus `album.completed`, seulement les
// coffrets de cet album) et à la lecture (un coffret créé après coup récompense ce qui est déjà fait).
// Coûts : la liste des coffrets (≈ 110 lignes, albums compris) est gardée en mémoire 10 min ; la progression d'un
// joueur sur tous les coffrets est une lecture de set_albums avec deux sondes de clé primaire par album (≈ 1 000
// sondes, indépendant de la taille de sa collection).
// API interne (deps.sets) : list, detail, summaryFor(userId, setId), refresh() (définitions + générés),
// checkRewards(userId, setIds). Événements : set.reward { userId, setId, reward: 'badge' | 'frame' }, et badge.earned
// (famille « set », variante = le coffret) pour le badge, médaille de la page Badges.
import {
  CODE_SETS, GENERATED_DECADES, GENERATED_GENRES, GENERATED_SIZE, MAX_SET_ALBUMS, MIN_SET_ALBUMS, SET_BADGE_TIER, SET_KINDS,
  generatedId, generatedRule, generatedTitles, isSetId, kindRank, setBadgeKey, setRewards,
} from '../shared/sets.js';
import { TIER_REWARDS } from '../shared/badges.js';
import { daysUntil, resolveCalendar } from '../shared/events.js';

export const name = 'sets';

/** Tâche de nuit (PLAN.md 3.8) : coffrets du code devenus possibles, coffrets générés manquants (figés une fois créés). */
export const jobs = [{ name: 'sets-generate', run: (deps) => deps.sets.refresh() }];

const LIST_KINDS = ['all', 'started', ...SET_KINDS];
const PAGE_CAP = 500;
const COVERS = 4;
const FRIENDS_SHOWN = 8;
const FRIENDS_MAX = 500;
const CACHE_MS = 10 * 60_000;

export function init(deps) {
  const { db, services, HttpError, paging } = deps;
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
  const parse = (text, fallback) => {
    try {
      return text ? JSON.parse(text) : fallback;
    } catch {
      return fallback;
    }
  };
  /** Dans la transaction en cours s'il y en a une (abonné appelé pendant une écriture), sinon dans la sienne. */
  const atomic = (fn) => (db.isTransaction ? fn() : services.atomic(fn));

  // ----- création des coffrets ------------------------------------------------------------------------------

  /** Album d'une sélection : identifiant de la graine, sinon artiste + titre exacts, sinon une réédition « Titre (…) ». */
  function resolveEntry(entry) {
    if (entry.id && q("SELECT 1 FROM cat_albums WHERE id = ? AND status = 'active'").get(entry.id)) return entry.id;
    if (!entry.title || !entry.artist) return null;
    const exact = q(`SELECT al.id FROM cat_albums al JOIN cat_artists ar ON ar.id = al.artist_id
      WHERE al.title = ? COLLATE NOCASE AND ar.name = ? COLLATE NOCASE AND al.status = 'active' ORDER BY al.fans DESC, al.id LIMIT 1`)
      .get(entry.title, entry.artist);
    if (exact) return exact.id;
    const reissue = q(`SELECT al.id FROM cat_albums al JOIN cat_artists ar ON ar.id = al.artist_id
      WHERE al.title >= ? COLLATE NOCASE AND al.title < ? COLLATE NOCASE AND ar.name = ? COLLATE NOCASE AND al.status = 'active'
      ORDER BY al.fans DESC, al.id LIMIT 1`).get(`${entry.title} (`, `${entry.title} )`, entry.artist);
    return reissue?.id ?? null;
  }

  /**
   * Albums les plus populaires d'une règle de remplissage ({ genre, decade, year, from, to, country }) : le pays de
   * l'artiste passe d'abord quand il est connu, puis les albums de la graine, puis les fans. Au plus `limit`.
   */
  function fillAlbums(fill, exclude, limit) {
    if (limit <= 0) return [];
    const where = ["al.status = 'active'"];
    const args = [];
    if (fill.genre) {
      where.push('al.genre = ?');
      args.push(fill.genre);
    }
    if (fill.decade) {
      where.push('al.year >= ? AND al.year < ?');
      args.push(fill.decade, fill.decade + 10);
    }
    if (fill.year) {
      where.push('al.year = ?');
      args.push(fill.year);
    }
    if (fill.from) {
      where.push('al.year >= ?');
      args.push(fill.from);
    }
    if (fill.to) {
      where.push('al.year <= ?');
      args.push(fill.to);
    }
    const country = fill.country ? 'CASE WHEN ar.country = ? THEN 0 ELSE 1 END, ' : '';
    const found = q(`SELECT al.id FROM cat_albums al JOIN cat_artists ar ON ar.id = al.artist_id WHERE ${where.join(' AND ')}
      ORDER BY ${country}CASE al.source WHEN 'seed' THEN 0 ELSE 1 END, al.fans DESC, al.id LIMIT ?`)
      .all(...args, ...(fill.country ? [fill.country] : []), limit + exclude.size);
    return found.map((r) => r.id).filter((id) => !exclude.has(id)).slice(0, limit);
  }

  function createSet({ id, kind, titles, rule = null, eventSlug = null }, albumIds) {
    const rewards = setRewards(id, albumIds.length);
    deps.tx(() => {
      const done = q(`INSERT OR IGNORE INTO sets (id, kind, title_fr, title_en, rule, event_slug, reward, album_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, kind, titles.fr, titles.en, rule ? json(rule) : null, eventSlug,
        json({ badgeAt: rewards.badgeAt, badge: rewards.badge, frame: rewards.frame }), albumIds.length, Date.now());
      if (!done.changes) return;
      const ins = q('INSERT OR IGNORE INTO set_albums (set_id, album_id, position) VALUES (?, ?, ?)');
      albumIds.forEach((albumId, i) => ins.run(id, albumId, i));
    });
    forgetRows();
  }

  /**
   * Coffrets du code (éditoriaux, événements) : créés dès que le catalogue en réunit assez (sélection retrouvée, puis
   * remplissage), titres tenus à jour ensuite ; la liste d'albums d'un coffret créé ne bouge plus. Renvoie les créés.
   */
  function syncDefinitions() {
    const created = [];
    for (const def of CODE_SETS) {
      const row = q('SELECT id, title_fr, title_en, event_slug FROM sets WHERE id = ?').get(def.id);
      if (row) {
        if (row.title_fr !== def.title.fr || row.title_en !== def.title.en || (row.event_slug || null) !== (def.event || null)) {
          q('UPDATE sets SET title_fr = ?, title_en = ?, event_slug = ? WHERE id = ?').run(def.title.fr, def.title.en, def.event || null, def.id);
          forgetRows();
        }
        continue;
      }
      const size = Math.min(MAX_SET_ALBUMS, def.size || GENERATED_SIZE);
      const ids = [];
      for (const entry of def.albums || []) {
        if (ids.length >= size) break;
        const id = resolveEntry(entry);
        if (id && !ids.includes(id)) ids.push(id);
      }
      if (ids.length < size && def.fill) ids.push(...fillAlbums(def.fill, new Set(ids), size - ids.length));
      if (ids.length < MIN_SET_ALBUMS) continue;
      createSet({ id: def.id, kind: def.kind, titles: def.title, rule: def.fill || null, eventSlug: def.event || null }, ids);
      created.push(def.id);
    }
    return created;
  }

  /**
   * Coffrets générés manquants : pour chaque décennie, les 8 albums les plus populaires de chaque genre (la graine
   * d'abord, puis les fans), une requête par décennie sur l'index des années. Un genre × décennie de moins de 8 albums
   * attend le prochain import. Renvoie les créés.
   */
  function generate() {
    const existing = new Set(q("SELECT id FROM sets WHERE kind = 'generated'").all().map((r) => r.id));
    const created = [];
    for (const decade of GENERATED_DECADES) {
      const missing = GENERATED_GENRES.filter((g) => !existing.has(generatedId(g, decade)));
      if (!missing.length) continue;
      const byGenre = new Map(missing.map((g) => [g, []]));
      for (const r of q(`SELECT id, genre FROM cat_albums WHERE year >= ? AND year < ? AND status = 'active' AND genre IS NOT NULL
        ORDER BY CASE source WHEN 'seed' THEN 0 ELSE 1 END, fans DESC, id`).all(decade, decade + 10)) {
        const ids = byGenre.get(r.genre);
        if (ids && ids.length < GENERATED_SIZE) ids.push(r.id);
      }
      for (const [genre, ids] of byGenre) {
        if (ids.length < GENERATED_SIZE) continue;
        const id = generatedId(genre, decade);
        createSet({ id, kind: 'generated', titles: generatedTitles(genre, decade), rule: { genre, decade } }, ids);
        created.push(id);
      }
    }
    return created;
  }

  /** Tâche sets-generate (et démarrage) : coffrets du code puis générés. */
  function refresh() {
    const code = syncDefinitions();
    const generated = generate();
    return { code, generated };
  }

  // ----- liste des coffrets en mémoire ------------------------------------------------------------------------

  let rowsCache = null;
  function forgetRows() {
    rowsCache = null;
  }

  /** Tous les coffrets ouverts, avec leurs albums dans l'ordre : { list, byId } (gardé 10 min). */
  function rows() {
    if (rowsCache && Date.now() - rowsCache.at < CACHE_MS) return rowsCache;
    const albums = new Map();
    for (const r of q(`SELECT sa.set_id, sa.album_id, al.track_count FROM set_albums sa JOIN cat_albums al ON al.id = sa.album_id
      ORDER BY sa.set_id, sa.position`).all()) {
      if (!albums.has(r.set_id)) albums.set(r.set_id, []);
      albums.get(r.set_id).push({ id: r.album_id, tracks: r.track_count });
    }
    const list = q('SELECT * FROM sets WHERE retired_at IS NULL').all().map((r) => {
      const items = albums.get(r.id) || [];
      return {
        id: r.id,
        kind: r.kind,
        titles: { fr: r.title_fr, en: r.title_en },
        rule: r.kind === 'generated' ? generatedRule(r.id) : parse(r.rule, null),
        eventSlug: r.event_slug || null,
        albumCount: items.length || r.album_count,
        albumIds: items.map((x) => x.id),
        totalCards: items.reduce((s, x) => s + (x.tracks || 0), 0),
        createdAt: r.created_at,
      };
    });
    rowsCache = { list, byId: new Map(list.map((s) => [s.id, s])), at: Date.now() };
    return rowsCache;
  }

  // ----- progression et récompenses --------------------------------------------------------------------------

  /** Progression du joueur : Map setId → { completed, owned } (tous les coffrets, ou ceux de `setIds`). */
  function progressOf(userId, setIds = null) {
    const where = setIds ? 'WHERE sa.set_id IN (SELECT value FROM json_each(?))' : '';
    const found = q(`SELECT sa.set_id AS id, COUNT(a.key) AS completed, COALESCE(SUM(p.owned), 0) AS owned
      FROM set_albums sa
      LEFT JOIN achievements a ON a.user_id = ? AND a.key = 'album:' || sa.album_id
      LEFT JOIN user_album_progress p ON p.user_id = ? AND p.album_id = sa.album_id
      ${where} GROUP BY sa.set_id`).all(userId, userId, ...(setIds ? [json(setIds)] : []));
    return new Map(found.map((r) => [r.id, { completed: r.completed, owned: r.owned }]));
  }

  /** Récompenses de coffrets déjà gagnées : { badges: Map setId → date, frames: Map setId → date }. */
  function earnedOf(userId) {
    const badges = new Map();
    const suffix = `:${SET_BADGE_TIER}`;
    for (const r of q("SELECT key, created_at FROM achievements WHERE user_id = ? AND key >= 'badge:set:' AND key < 'badge:set;'").all(userId)) {
      if (r.key.endsWith(suffix)) badges.set(r.key.slice('badge:set:'.length, -suffix.length), r.created_at);
    }
    const frames = new Map();
    for (const r of q("SELECT cosmetic_id, created_at FROM user_cosmetics WHERE user_id = ? AND cosmetic_id >= 'frame:set-' AND cosmetic_id < 'frame:set.'")
      .all(userId)) frames.set(r.cosmetic_id.slice('frame:set-'.length), r.created_at);
    return { badges, frames };
  }

  /**
   * Donne les récompenses atteintes et pas encore données (une transaction pour toutes), puis notifie. `list` :
   * [{ set, completed }]. Renvoie [{ setId, reward: 'badge' | 'frame' }].
   */
  function grantReached(userId, list, earned = earnedOf(userId)) {
    const due = [];
    for (const { set, completed } of list) {
      const r = setRewards(set.id, set.albumCount);
      if (completed >= r.badgeAt && !earned.badges.has(set.id)) due.push({ set, reward: 'badge', key: r.badge });
      if (completed >= r.frameAt && !earned.frames.has(set.id)) due.push({ set, reward: 'frame', key: r.frame });
    }
    if (!due.length) return [];
    const now = Date.now();
    const won = atomic(() => {
      const user = services.getUser(userId);
      if (!user) return [];
      const out = [];
      for (const d of due) {
        if (d.reward === 'badge') {
          const ins = q('INSERT OR IGNORE INTO achievements (user_id, key, created_at, data) VALUES (?, ?, ?, ?)')
            .run(userId, d.key, now, json({ value: d.set.albumCount, at: now, set: d.set.id }));
          if (!ins.changes) continue;
          const reward = TIER_REWARDS[SET_BADGE_TIER] || { xp: 0 };
          if (reward.royalties || reward.boosters) {
            q('UPDATE users SET royalties = royalties + ?, bonus_packs = bonus_packs + ? WHERE id = ?').run(reward.royalties || 0, reward.boosters || 0, userId);
          }
          services.gainXp(user, reward.xp || 0, 'set');
          earned.badges.set(d.set.id, now);
        } else {
          deps.collection?.grantCosmetic?.(userId, d.key, `set:${d.set.id}`);
          earned.frames.set(d.set.id, now);
        }
        out.push({ setId: d.set.id, reward: d.reward });
      }
      return out;
    });
    if (!won.length) return won;
    services.forget?.(userId);
    // Une notification par récompense, regroupées par jour (un coffret créé après coup peut en donner plusieurs d'un coup).
    const day = new Date(now).toISOString().slice(0, 10);
    for (const w of won) {
      deps.notify?.(userId, 'set_reward', { groupKey: `set:${day}`, data: { setId: w.setId, reward: w.reward } });
      deps.bus.emit('set.reward', { userId, setId: w.setId, reward: w.reward });
      // Le badge est aussi une médaille de la page Badges (famille externe « set », shared/badges.js) : le fil le
      // publie comme les autres (première médaille seulement, le bronze n'y passe pas sinon).
      if (w.reward === 'badge') {
        deps.bus.emit('badge.earned', { userId, key: setBadgeKey(w.setId), family: 'set', variant: w.setId, tier: SET_BADGE_TIER });
      }
    }
    return won;
  }

  /** Vérifie les récompenses des coffrets `setIds` pour un joueur (après un album complété). */
  function checkRewards(userId, setIds) {
    const uid = Number(userId);
    if (!Number.isInteger(uid) || uid <= 0 || !setIds?.length) return [];
    const { byId } = rows();
    const progress = progressOf(uid, setIds);
    const due = setIds.map((id) => byId.get(id)).filter(Boolean).map((set) => ({ set, completed: progress.get(set.id)?.completed || 0 }));
    return grantReached(uid, due);
  }

  // Un album complété : seulement les coffrets qui le contiennent (index set_albums_album).
  deps.bus.on('album.completed', ({ userId, albumId }) => {
    const setIds = q('SELECT set_id FROM set_albums WHERE album_id = ?').all(albumId).map((r) => r.set_id);
    if (setIds.length) checkRewards(userId, setIds);
  });

  // ----- vues --------------------------------------------------------------------------------------------------

  /** Résumé d'un coffret pour un joueur (SetSummary). */
  function summaryOf(set, progress, earned) {
    const r = setRewards(set.id, set.albumCount);
    return {
      id: set.id,
      kind: set.kind,
      titles: set.titles,
      rule: set.rule,
      eventSlug: set.eventSlug,
      albumCount: set.albumCount,
      covers: set.albumIds.slice(0, COVERS),
      progress: { completed: progress?.completed || 0, owned: progress?.owned || 0, total: set.totalCards },
      rewards: {
        badgeAt: r.badgeAt,
        frameAt: r.frameAt,
        badge: r.badge,
        frame: r.frame,
        badgeEarnedAt: earned.badges.get(set.id) ?? null,
        frameEarnedAt: earned.frames.get(set.id) ?? null,
      },
      createdAt: set.createdAt,
    };
  }

  const started = (s) => s.progress.owned > 0;
  const score = (s) => s.progress.completed / Math.max(1, s.albumCount) + s.progress.owned / Math.max(1, s.progress.total) / 1000;
  /** Ordre des coffrets : commencés d'abord (les plus avancés), puis éditoriaux, événements, générés (genre, décennie). */
  function compare(x, y) {
    const sx = started(x);
    const sy = started(y);
    if (sx !== sy) return sx ? -1 : 1;
    if (sx && score(x) !== score(y)) return score(y) - score(x);
    if (x.kind !== y.kind) return kindRank(x.kind) - kindRank(y.kind);
    if (x.kind === 'generated' && x.rule && y.rule) {
      const g = GENERATED_GENRES.indexOf(x.rule.genre) - GENERATED_GENRES.indexOf(y.rule.genre);
      return g || x.rule.decade - y.rule.decade;
    }
    return x.createdAt - y.createdAt || (x.id < y.id ? -1 : 1);
  }

  /**
   * GET /api/sets?kind=&cursor=&limit= → { items: [SetSummary], nextCursor, counts, rewards, catalog }. `kind` : all
   * (défaut), started, editorial, event, generated. Pages par décalage (liste classée), 24 par défaut.
   */
  function list(userId, query = {}) {
    const kind = LIST_KINDS.includes(query.kind) ? query.kind : 'all';
    const offset = paging.offsetOf(query.cursor, { cap: PAGE_CAP });
    const limit = paging.limitOf(query.limit, { def: 24, max: 48 });
    const all = rows().list;
    const progress = progressOf(userId);
    const earned = earnedOf(userId);
    const rewards = grantReached(userId, all.map((set) => ({ set, completed: progress.get(set.id)?.completed || 0 })), earned);
    const items = all.map((set) => summaryOf(set, progress.get(set.id), earned));
    const counts = { all: items.length, started: items.filter(started).length };
    for (const k of SET_KINDS) counts[k] = items.filter((s) => s.kind === k).length;
    const shown = items.filter((s) => (kind === 'all' ? true : kind === 'started' ? started(s) : s.kind === kind)).sort(compare);
    const page = paging.offsetPage(shown.slice(offset, offset + limit + 1), offset, limit, { cap: PAGE_CAP });
    return {
      ...page,
      counts,
      rewards,
      catalog: deps.refs({ albumIds: page.items.flatMap((s) => s.covers) }),
      ...(rewards.length ? { state: services.state(userId, { partial: true }) } : {}),
    };
  }

  /** Résumé d'un coffret pour un joueur (page d'un événement), ou null s'il n'existe pas (encore). */
  function summaryFor(userId, setId) {
    const set = rows().byId.get(setId);
    if (!set) return null;
    const progress = progressOf(userId, [setId]);
    const earned = earnedOf(userId);
    grantReached(userId, [{ set, completed: progress.get(setId)?.completed || 0 }], earned);
    return summaryOf(set, progress.get(setId), earned);
  }

  /**
   * GET /api/sets/:id → { set, albums: [{ id, position, completed, completedAt, owned, total }], friends: [{ user,
   * completed }], holders, event, rewards, catalog }. Amis : ceux qui ont complété au moins un album du coffret, les
   * plus avancés d'abord (8 au plus), sans les membres bloqués ni les Studios privés.
   */
  function detail(userId, setId) {
    const id = String(setId || '');
    const set = isSetId(id) ? rows().byId.get(id) : null;
    if (!set) throw new HttpError(404, 'set_not_found');
    const albumRows = q(`SELECT sa.album_id, sa.position, a.created_at AS done_at, COALESCE(p.owned, 0) AS owned, al.track_count AS total
      FROM set_albums sa JOIN cat_albums al ON al.id = sa.album_id
      LEFT JOIN achievements a ON a.user_id = ? AND a.key = 'album:' || sa.album_id
      LEFT JOIN user_album_progress p ON p.user_id = ? AND p.album_id = sa.album_id
      WHERE sa.set_id = ? ORDER BY sa.position`).all(userId, userId, id);
    const albums = albumRows.map((r) => ({
      id: r.album_id, position: r.position, completed: r.done_at != null, completedAt: r.done_at ?? null, owned: r.owned, total: r.total,
    }));
    const progress = { completed: albums.filter((x) => x.completed).length, owned: albums.reduce((s, x) => s + x.owned, 0) };
    const earned = earnedOf(userId);
    const rewards = grantReached(userId, [{ set, completed: progress.completed }], earned);

    const hidden = deps.access?.hiddenIds?.(userId) ?? new Set();
    const friendIds = [...services.friendIds(userId)].filter((f) => !hidden.has(f)).slice(0, FRIENDS_MAX);
    const keys = set.albumIds.map((x) => `album:${x}`);
    const friendRows = friendIds.length ? q(`SELECT a.user_id, COUNT(*) AS n FROM achievements a JOIN users u ON u.id = a.user_id
      WHERE a.user_id IN (SELECT value FROM json_each(?)) AND a.key IN (SELECT value FROM json_each(?)) AND u.profile_visibility <> 'private'
      GROUP BY a.user_id ORDER BY n DESC, a.user_id LIMIT ?`).all(json(friendIds), json(keys), FRIENDS_SHOWN) : [];
    const summaries = services.userSummaries(friendRows.map((r) => r.user_id), userId, { hidden });
    const friends = friendRows.map((r) => ({ user: summaries.get(r.user_id), completed: r.n })).filter((f) => f.user);
    const holders = q('SELECT COUNT(*) AS n FROM achievements WHERE key = ?').get(setRewards(set.id, set.albumCount).badge).n;

    let event = null;
    if (set.eventSlug) {
      const ev = (deps.events?.calendar?.() || resolveCalendar()).find((e) => e.slug === set.eventSlug);
      if (ev) {
        event = {
          slug: ev.slug, titles: ev.title, status: ev.status, start: ev.start, end: ev.end,
          daysLeft: ev.status === 'current' ? daysUntil(ev.end) : null, startsIn: ev.status === 'upcoming' ? daysUntil(ev.start) : null,
        };
      }
    }
    return {
      set: summaryOf(set, progress, earned),
      albums,
      friends,
      holders,
      event,
      rewards,
      catalog: deps.refs({ albumIds: [...set.albumIds, ...services.summaryAlbums(friends.map((f) => f.user))] }),
      ...(rewards.length ? { state: services.state(userId, { partial: true }) } : {}),
    };
  }

  // Démarrage : coffrets du code (quelques requêtes), et les générés s'il n'y en a encore aucun (≈ 20 ms sur un
  // catalogue de 20 000 albums) ; ensuite, la tâche de nuit ajoute ceux qu'un import rend possibles.
  syncDefinitions();
  if (!q("SELECT 1 FROM sets WHERE kind = 'generated' LIMIT 1").get()) generate();

  return { list, detail, summaryFor, refresh, syncDefinitions, generate, checkRewards, progressOf };
}

export function routes(r, deps) {
  const { limits } = deps;
  const api = () => deps.sets;
  r.get('/sets', limits.read, (req, res) => res.json(api().list(req.user.id, req.query)));
  r.get('/sets/:id', limits.read, (req, res) => res.json(api().detail(req.user.id, req.params.id)));
}
