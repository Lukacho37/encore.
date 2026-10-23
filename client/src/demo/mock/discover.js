// Jumeau de démo du module « discover » (server/discover.js, P1-E, PLAN.md 4.2.7, 5.5) : mêmes routes, mêmes formes.
//   GET /discover → { sections: [{ id, kind, titleKey, titleVars, reason: { key, vars }, users?, items, moreCursor }],
//   tiles, progress, catalog } · GET /discover/:sectionId?cursor= → { items, nextCursor, progress, catalog }
//   GET /albums/:id/similar → { items: [{ id, reason }], catalog }
// Mêmes sections et mêmes règles que le serveur, à l'échelle du catalogue de la démo (20 albums) : une section
// s'affiche dès 3 albums (4 sur le serveur), « Albums cultes » dès 2 notes (20), la décennie à découvrir parmi celles
// qui ont 2 albums ou plus (200). Les notes, amis, cartes, envies et favoris viennent des autres jumeaux (joueurs
// fictifs compris) : la page n'est jamais vide.
import { bayes } from '@shared/match.js';
import { summaryOf, viewerOf } from './ratings.js';
import { profileOf } from './match.js';

export const name = 'discover';

const PAGE = 12;
const SECTION_CAP = 24;
const SECTION_MIN = 3;
const PER_ARTIST = 2;
const CULT_MIN = 2;
const DECADE_MIN = 2;
const DAY = 86_400_000;

const encodeCursor = (values) => btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function offsetOf(raw) {
  if (!raw) return 0;
  try {
    const [n] = JSON.parse(atob(String(raw).replace(/-/g, '+').replace(/_/g, '/')));
    return Number.isInteger(n) && n >= 0 ? Math.min(n, SECTION_CAP) : 0;
  } catch {
    return 0;
  }
}
const decadeOf = (year) => (Number.isInteger(year) && year > 0 ? Math.floor(year / 10) * 10 : null);
const avatarAlbum = (avatar) => (typeof avatar === 'string' && avatar.startsWith('album:') ? avatar.slice(6) : null);

/** Moyenne bayésienne de la communauté d'un album. */
function bayesOf(ctx, id) {
  const s = summaryOf(ctx.db, 'album', id);
  return { b: bayes((s?.average || 0) * (s?.count || 0), s?.count || 0), count: s?.count || 0 };
}

/** Popularité d'un album : moyenne de ses morceaux (le catalogue de la démo n'a pas de nombre de fans). */
const popOf = (ctx, id) => {
  const tracks = ctx.staticCatalog.albumTracks(id);
  return tracks.length ? tracks.reduce((s, t) => s + (t.pop || 0), 0) / tracks.length : 0;
};
const byPop = (ctx, list) => [...list].sort((a, b) => popOf(ctx, b.id) - popOf(ctx, a.id) || a.id.localeCompare(b.id));

/** Albums proches : co-notes 8+, même artiste, même genre et même époque (comme le serveur). */
function similarOf(ctx, albumId) {
  const base = ctx.ALBUM.get(albumId);
  if (!base) return [];
  const out = [];
  const perArtist = new Map();
  const push = (a, reason, cap = PER_ARTIST) => {
    if (!a || a.id === albumId || out.some((x) => x.id === a.id) || out.length >= 12) return;
    const n = perArtist.get(a.artistId) || 0;
    if (n >= cap) return;
    perArtist.set(a.artistId, n + 1);
    out.push({ id: a.id, artistId: a.artistId, reason });
  };
  const fans = new Set(ctx.db.ratings.filter((r) => r.type === 'album' && r.id === albumId && r.score >= 8).map((r) => r.userId));
  if (fans.size >= 2) {
    const counts = new Map();
    for (const r of ctx.db.ratings) if (fans.has(r.userId) && r.type === 'album' && r.score >= 8 && r.id !== albumId) counts.set(r.id, (counts.get(r.id) || 0) + 1);
    [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).forEach(([id]) => push(ctx.ALBUM.get(id), 'corated'));
  }
  for (const a of byPop(ctx, [...ctx.ALBUM.values()].filter((x) => x.artistId === base.artistId))) push(a, 'artist', 3);
  for (const a of byPop(ctx, [...ctx.ALBUM.values()].filter((x) => x.genre === base.genre && decadeOf(x.year) === decadeOf(base.year)))) push(a, 'genre_decade');
  // Peu d'albums du genre à cette époque : le même genre, l'époque la plus proche d'abord (comme le serveur).
  if (out.length < 6) {
    const dist = (y) => (base.year && y ? Math.abs(y - base.year) : 100);
    const near = byPop(ctx, [...ctx.ALBUM.values()].filter((x) => x.genre === base.genre)).slice(0, 60).sort((a, b) => dist(a.year) - dist(b.year));
    for (const a of near) push(a, 'genre');
  }
  return out;
}

/** Garde les albums d'une liste candidate : exclusions, 2 par artiste, pas déjà montrés plus haut. */
function pick(list, { exclude, seen, perArtist = PER_ARTIST }) {
  const out = [];
  const counts = new Map();
  for (const a of list) {
    if (!a || exclude(a.id) || out.includes(a.id)) continue;
    const n = counts.get(a.artistId) || 0;
    if (n >= perArtist) continue;
    counts.set(a.artistId, n + 1);
    out.push(a.id);
    if (out.length >= SECTION_CAP) break;
  }
  const fresh = out.filter((id) => !seen.has(id));
  return fresh.length >= SECTION_MIN ? fresh : out;
}

/** Progression du joueur sur ces albums : { albumId: { owned, total } }. */
function progressOf(ctx, uid, ids) {
  const owned = new Map();
  for (const key of Object.keys(ctx.db.cards?.[uid] || {})) {
    const t = ctx.TRACK.get(key.split('|')[0]);
    if (!t?.albumId || !ids.includes(t.albumId)) continue;
    const set = owned.get(t.albumId) || new Set();
    set.add(t.id);
    owned.set(t.albumId, set);
  }
  const out = {};
  for (const [id, set] of owned) out[id] = { owned: set.size, total: ctx.ALBUM.get(id)?.trackCount || set.size };
  return out;
}

function build(ctx, uid) {
  const { db, ALBUM } = ctx;
  const all = [...ALBUM.values()];
  const me = profileOf(ctx, uid);
  const viewer = viewerOf(ctx, uid);
  const rated = new Set(db.ratings.filter((r) => r.userId === uid && r.type === 'album').map((r) => r.id));
  const notMine = (id) => rated.has(id) || me.completed.has(id);
  const seen = new Set();
  const sections = [];
  const lists = {};
  const add = (id, kind, list, { titleKey, titleVars = {}, reason, users, perArtist, exclude = notMine }) => {
    if (sections.length >= 8) return;
    const ids = pick(list, { exclude, seen, perArtist });
    if (ids.length < SECTION_MIN) return;
    for (const x of ids.slice(0, PAGE)) seen.add(x);
    lists[id] = ids;
    sections.push({ id, kind, titleKey, titleVars, reason, ...(users ? { users } : {}) });
  };
  const genreList = (g) => all.filter((a) => a.genre === g)
    .sort((a, b) => bayesOf(ctx, b.id).b - bayesOf(ctx, a.id).b || popOf(ctx, b.id) - popOf(ctx, a.id));

  // 1. Parce que tu as aimé… (ou tes artistes favoris).
  const seedRating = db.ratings.filter((r) => r.userId === uid && r.type === 'album' && r.score >= 8 && ALBUM.has(r.id)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const grid = (db.lists || []).find((l) => l.userId === uid && l.kind === 'grid9');
  const seed = seedRating?.id || grid?.items?.find((it) => ALBUM.has(it.id))?.id;
  if (seed) {
    add('because', 'similar', [...similarOf(ctx, seed).map((x) => ALBUM.get(x.id)), ...genreList(ALBUM.get(seed).genre), ...byPop(ctx, all)], {
      titleKey: 'discover.sections.because', titleVars: { albumId: seed }, reason: { key: 'discover.reasons.because', vars: { albumId: seed } },
      exclude: (id) => id === seed || notMine(id),
    });
  } else if (me.favorites.artist.length) {
    const artistId = me.favorites.artist[0];
    const artist = ctx.ARTIST.get(artistId);
    if (artist) {
      add('because', 'artist', [
        ...byPop(ctx, all.filter((a) => a.artistId === artistId)),
        ...me.favorites.artist.slice(1).flatMap((id) => byPop(ctx, all.filter((a) => a.artistId === id))),
        ...genreList(artist.genre),
      ], {
        titleKey: 'discover.sections.becauseArtist', titleVars: { artistId },
        reason: { key: 'discover.reasons.becauseArtist', vars: { artistId } }, perArtist: 3,
      });
    }
  }

  // 2. Très apprécié par tes amis (un ami au Studio privé garde ses notes pour lui).
  if (viewer.friends.size) {
    const byAlbum = new Map();
    const open = new Set([...viewer.friends].filter((id) => ctx.userById(id)?.profileVisibility !== 'private'));
    for (const r of db.ratings) {
      if (r.type !== 'album' || r.score < 8 || !open.has(r.userId) || !ALBUM.has(r.id)) continue;
      const e = byAlbum.get(r.id) || { n: 0, sum: 0, users: [] };
      e.n += 1;
      e.sum += r.score;
      e.users.push(r.userId);
      byAlbum.set(r.id, e);
    }
    const ordered = [...byAlbum].sort((a, b) => b[1].n - a[1].n || b[1].sum / b[1].n - a[1].sum / a[1].n || a[0].localeCompare(b[0]));
    const list = ordered.map(([id]) => ALBUM.get(id));
    const ids = pick(list, { exclude: notMine, seen });
    const who = [...new Set(ids.slice(0, PAGE).flatMap((id) => byAlbum.get(id)?.users || []))];
    add('friends', 'friends', list, {
      titleKey: 'discover.sections.friends', reason: { key: 'discover.reasons.friends', vars: { n: who.length } },
      users: [...ctx.summaries(who.slice(0, 3)).values()],
    });
  }

  // 3. Albums cultes jamais notés.
  const cult = all.map((a) => ({ a, ...bayesOf(ctx, a.id) })).filter((x) => x.count >= CULT_MIN).sort((x, y) => y.b - x.b).map((x) => x.a);
  add('cult', 'cult', cult, { titleKey: 'discover.sections.cult', reason: { key: 'discover.reasons.cult', vars: { n: CULT_MIN } } });

  // 4. À compléter : albums recherchés, puis ceux à 50 % ou plus.
  const wanted = (ctx.collection.wishlist?.(uid) || []).filter((id) => !me.completed.has(id));
  const prog = progressOf(ctx, uid, all.map((a) => a.id));
  const half = Object.entries(prog).filter(([, p]) => p.owned < p.total && p.owned * 2 >= p.total).sort((a, b) => b[1].owned / b[1].total - a[1].owned / a[1].total).map(([id]) => id);
  add('complete', 'complete', [...new Set([...wanted, ...half])].map((id) => ALBUM.get(id)), {
    titleKey: 'discover.sections.complete', reason: { key: wanted.length ? 'discover.reasons.completeWanted' : 'discover.reasons.complete', vars: {} },
    exclude: (id) => me.completed.has(id), perArtist: 3,
  });

  // 5. Découvre une décennie.
  const decCounts = new Map();
  for (const a of all) if (decadeOf(a.year)) decCounts.set(decadeOf(a.year), (decCounts.get(decadeOf(a.year)) || 0) + 1);
  const eligible = [...decCounts].filter(([, n]) => n >= DECADE_MIN);
  if (eligible.length) {
    let total = 0;
    for (const [, n] of me.decades) total += n;
    let decade;
    let cold = false;
    if (!total) {
      decade = eligible[Math.floor(ctx.now() / DAY) % eligible.length][0];
      cold = true;
    } else {
      const sum = eligible.reduce((s, [, n]) => s + n, 0);
      decade = eligible.map(([d, n]) => [d, ((me.decades.get(d) || 0) / total) / (n / sum)]).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0];
    }
    add('decade', 'decade', byPop(ctx, all.filter((a) => decadeOf(a.year) === decade)), {
      titleKey: 'discover.sections.decade', titleVars: { decade }, reason: { key: cold ? 'discover.reasons.decadeCold' : 'discover.reasons.decade', vars: { decade } },
    });
  }

  // 6. Ton genre.
  let best = null;
  for (const [g, n] of me.genres) if (g && (!best || n > best[1])) best = [g, n];
  const fav = me.favorites.genre[0] || null;
  const genre = best && (!fav || best[1] > 10) ? { g: best[0], cold: false } : fav ? { g: fav, cold: true } : null;
  if (genre) {
    add('genre', 'genre', genreList(genre.g), {
      titleKey: 'discover.sections.genre', titleVars: { genre: genre.g },
      reason: { key: genre.cold ? 'discover.reasons.genreCold' : 'discover.reasons.genre', vars: { genre: genre.g } },
    });
  }

  // 7. Tendances : les plus notés des 7 derniers jours.
  const recent = new Map();
  for (const r of db.ratings) if (r.type === 'album' && ALBUM.has(r.id) && r.createdAt >= ctx.now() - 7 * DAY) recent.set(r.id, (recent.get(r.id) || 0) + 1);
  add('trending', 'trending', [...recent].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => ALBUM.get(id)), {
    titleKey: 'discover.sections.trending', reason: { key: 'discover.reasons.trending', vars: { days: 7 } },
  });

  // Compte tout neuf : les albums les plus populaires.
  if (sections.length < 3) add('popular', 'popular', byPop(ctx, all), { titleKey: 'discover.sections.popular', reason: { key: 'discover.reasons.popular', vars: {} } });
  return { sections, lists };
}

function page(ctx) {
  const u = ctx.me();
  const { sections, lists } = build(ctx, u.id);
  const shown = [];
  const out = sections.map((s) => {
    const first = lists[s.id].slice(0, PAGE);
    shown.push(...first);
    return { ...s, items: first.map((id) => ({ type: 'album', id })), moreCursor: lists[s.id].length > PAGE ? encodeCursor([PAGE]) : null };
  });
  const grid = (ctx.db.lists || []).find((l) => l.userId === u.id && l.kind === 'grid9');
  const tiles = [
    { id: 'battles', to: '/battles' },
    { id: 'rankings', to: '/rankings' },
    { id: 'lists', to: '/lists' },
    { id: 'nine', to: '/nine', count: grid?.items?.length || 0 },
    { id: 'blindtest', to: '/blindtest' },
  ];
  const seeds = out.map((s) => s.titleVars?.albumId).filter(Boolean);
  const artistIds = out.map((s) => s.titleVars?.artistId).filter(Boolean);
  const avatars = out.flatMap((s) => (s.users || []).map((x) => avatarAlbum(x.avatar))).filter(Boolean);
  return {
    sections: out,
    tiles,
    progress: progressOf(ctx, u.id, [...new Set(shown)]),
    catalog: ctx.refs({ albumIds: [...shown, ...seeds, ...avatars], artistIds }),
  };
}

export const routes = [
  ['GET', /^\/discover$/, ({ ctx }) => page(ctx)],
  ['GET', /^\/discover\/([a-z]+)$/, ({ params, query, ctx }) => {
    const u = ctx.me();
    const list = build(ctx, u.id).lists[params[0]];
    if (!list) ctx.fail(404, 'section_not_found');
    const offset = offsetOf(query.get('cursor'));
    const ids = list.slice(offset, offset + PAGE);
    const next = offset + PAGE < Math.min(list.length, SECTION_CAP) ? encodeCursor([offset + PAGE]) : null;
    return { items: ids.map((id) => ({ type: 'album', id })), nextCursor: next, progress: progressOf(ctx, u.id, ids), catalog: ctx.refs({ albumIds: ids }) };
  }],
  ['GET', /^\/albums\/([^/]+)\/similar$/, ({ params, ctx }) => {
    ctx.me();
    const id = decodeURIComponent(params[0]);
    if (!ctx.ALBUM.has(id)) ctx.fail(404, 'unknown_album');
    const items = similarOf(ctx, id).map(({ id: a, reason }) => ({ id: a, reason }));
    return { items, catalog: ctx.refs({ albumIds: items.map((x) => x.id) }) };
  }],
];

export function seed() {}

export function migrate() {}
