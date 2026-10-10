// Jumeau de démo du module « search » (server/search.js, P0-E, PLAN.md 4.1.4, 5.1) : mêmes routes, mêmes formes,
// même classement (règles de shared/search.js : début de mot, score de texte, popularité, bonus de collection, fautes
// de frappe par trigrammes), sur les 20 albums du catalogue de base, les joueurs de la démo (bots compris) et les
// listes publiques s'il y en a (db.lists, P1-C). Contrat : voir client/src/demo/mock/index.js.
import {
  SEARCH_KINDS, QUOTAS, SCOPE_QUOTA, COUNT_CAP, RESULTS_CAP, TYPO_MIN_LENGTH, TYPO_MIN_SIM, SUGGEST_MIN_SIM,
  normalize, prepareQuery, trigrams, similarity, textScore, typoScore, finalScore, byScore, betterTop,
  trackWeight, userWeight, listWeight, cleanQuery,
} from '@shared/search.js';

export const name = 'search';

/** Comme le serveur : correspondances par préfixe lues au plus, fautes de frappe seulement si presque rien trouvé. */
const CAP = 600;
const TYPO_HITS = 8;
const VERSION = '2';

const words = (s) => normalize(s).split(' ').filter(Boolean);

// Catalogue de base : documents construits une fois (il ne change pas pendant la démo).
let catalogDocs = null;
function catalogIndex(ctx) {
  if (catalogDocs) return catalogDocs;
  const avg = (list) => (list.length ? list.reduce((s, x) => s + (x.pop || 0), 0) / list.length : 0);
  const tracks = [...ctx.TRACK.values()];
  const docs = [];
  for (const a of ctx.ALBUM.values()) {
    docs.push({ kind: 'album', ref: a.id, folded: normalize(a.title), words: [...words(a.title), ...words(`${a.artist} ${a.year || ''}`)],
      weight: Math.min(1, avg(tracks.filter((t) => t.albumId === a.id)) / 100) });
  }
  for (const t of tracks) {
    docs.push({ kind: 'track', ref: t.id, folded: normalize(t.title), words: [...words(`${t.title} ${t.feat || ''}`), ...words(`${t.artist} ${t.album || ''}`)],
      weight: trackWeight(t.pop), albumId: t.albumId, artistId: t.artistId });
  }
  for (const ar of ctx.ARTIST.values()) {
    docs.push({ kind: 'artist', ref: ar.id, folded: normalize(ar.name), words: [...words(ar.name), ...words(ar.genre || '')],
      weight: Math.min(1, avg(tracks.filter((t) => t.artistId === ar.id)) / 100) });
  }
  catalogDocs = docs;
  return docs;
}

const blocked = (db, viewerId) => new Set((db.blocks || []).flatMap((b) => (b.blocker === viewerId ? [b.blocked] : b.blocked === viewerId ? [b.blocker] : [])));

/** Membres confirmés et listes publiques (relus à chaque requête : la démo en a peu). */
function socialIndex(ctx, viewerId) {
  const { db } = ctx;
  const hidden = blocked(db, viewerId);
  const users = db.users.filter((u) => u.verified && !hidden.has(u.id));
  const summaries = ctx.summaries(users.map((u) => u.id));
  const docs = users.map((u) => ({ kind: 'user', ref: String(u.id), folded: normalize(u.username), words: words(u.username), weight: userWeight(summaries.get(u.id)?.uniqueCards || 0), user: summaries.get(u.id) }));
  for (const l of Array.isArray(db.lists) ? db.lists : []) {
    const owner = summaries.get(l.userId);
    if (!owner || l.visibility !== 'public' || l.hiddenAt || !['list', 'grid9'].includes(l.kind || 'list')) continue;
    docs.push({ kind: 'list', ref: String(l.id), folded: normalize(l.title), words: [...words(l.title), ...words(owner.username)], weight: listWeight(l.likeCount || 0), list: l, owner });
  }
  return docs;
}

/** Albums et artistes dont le joueur a des cartes (bonus de 0,05), progression par album. */
function collectionOf(ctx, viewerId) {
  const owned = new Set(Object.keys(ctx.db.cards?.[viewerId] || {}).map((k) => k.split('|')[0]));
  const albums = new Map();
  const artists = new Set();
  for (const id of owned) {
    const t = ctx.TRACK.get(id);
    if (!t) continue;
    if (t.albumId) albums.set(t.albumId, (albums.get(t.albumId) || 0) + 1);
    artists.add(t.artistId);
  }
  return { albums, artists };
}

function kindsOf(ctx, scope) {
  if (scope == null || scope === '' || scope === 'all') return SEARCH_KINDS;
  const list = String(scope).split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length || list.some((k) => !SEARCH_KINDS.includes(k))) ctx.fail(400, 'invalid_input', { field: 'scope' });
  return SEARCH_KINDS.filter((k) => list.includes(k));
}

/** Candidats classés par type (mêmes étapes que server/search.js) : { lists, matched, ftsHits, typo }. */
function candidates(ctx, viewerId, prepared, kinds, quotaOf) {
  const { fq, tokens, compact } = prepared;
  const docs = [...catalogIndex(ctx), ...socialIndex(ctx, viewerId)].filter((d) => kinds.includes(d.kind));
  const lists = Object.fromEntries(kinds.map((k) => [k, []]));
  const matched = Object.fromEntries(kinds.map((k) => [k, 0]));
  let ftsHits = 0;
  const seen = new Set();
  for (const d of docs) {
    if (!tokens.every((t) => d.words.some((w) => w.startsWith(t)))) continue;
    matched[d.kind] += 1;
    if (lists[d.kind].length >= CAP) continue;
    ftsHits += 1;
    seen.add(d);
    lists[d.kind].push({ ...d, typo: false, text: textScore(d.folded, fq, tokens) });
  }
  const typo = [];
  if (compact.length >= TYPO_MIN_LENGTH && ftsHits < TYPO_HITS && kinds.some((k) => lists[k].length < quotaOf(k))) {
    const queryTri = trigrams(fq);
    for (const d of docs) {
      if (seen.has(d)) continue;
      const sim = similarity(queryTri, d.folded, TYPO_MIN_SIM);
      if (sim < TYPO_MIN_SIM) continue;
      const row = { ...d, typo: true, sim, text: typoScore(sim) };
      lists[d.kind].push(row);
      typo.push(row);
    }
  }
  const mine = collectionOf(ctx, viewerId);
  const ownedOf = (r) => (r.kind === 'album' ? mine.albums.has(r.ref) : r.kind === 'track' ? mine.albums.has(r.albumId) : r.kind === 'artist' ? mine.artists.has(r.ref) : false);
  for (const k of kinds) {
    lists[k] = lists[k].map((r) => ({ ...r, score: finalScore(r.text, r.weight, ownedOf(r)) })).sort(byScore);
  }
  return { lists, matched, ftsHits, typo, mine };
}

const progressOf = (ctx, mine, albumIds) => Object.fromEntries(albumIds.filter((id) => mine.albums.has(id))
  .map((id) => [id, { owned: mine.albums.get(id), total: ctx.ALBUM.get(id)?.trackCount || 0 }]));

const listView = (r) => ({
  id: r.list.id, title: r.list.title, kind: r.list.kind || 'list', itemCount: (r.list.items || []).length || r.list.itemCount || 0,
  likeCount: r.list.likeCount || 0, user: r.owner,
  coverAlbumIds: (r.list.items || []).slice(0, 3).map((i) => (i.type === 'album' ? i.id : i.albumId)).filter(Boolean),
});

function displayName(ctx, r) {
  if (r.kind === 'album') return ctx.ALBUM.get(r.ref)?.title ?? null;
  if (r.kind === 'track') return ctx.TRACK.get(r.ref)?.title ?? null;
  if (r.kind === 'artist') return ctx.ARTIST.get(r.ref)?.name ?? null;
  if (r.kind === 'user') return r.user?.username ?? null;
  return r.list?.title ?? null;
}

function suggest(ctx, rawQ, scope) {
  const me = ctx.me();
  const kinds = kindsOf(ctx, scope);
  const q = cleanQuery(rawQ);
  const prepared = prepareQuery(q);
  const empty = (v) => Object.fromEntries(kinds.map((k) => [k, v()]));
  if (!prepared) return { q, suggestion: null, top: null, groups: empty(() => []), counts: empty(() => 0), progress: {}, catalog: ctx.refs({}) };
  const quotaOf = (k) => (kinds.length === 1 ? SCOPE_QUOTA : QUOTAS[k]);
  const { lists, matched, ftsHits, typo, mine } = candidates(ctx, me.id, prepared, kinds, quotaOf);
  const groups = {};
  const counts = {};
  const firsts = [];
  for (const k of kinds) {
    const kept = lists[k].slice(0, quotaOf(k));
    counts[k] = Math.min(COUNT_CAP, matched[k] + lists[k].filter((r) => r.typo).length);
    if (k === 'user') groups[k] = kept.map((r) => ({ ...r.user, typo: r.typo }));
    else if (k === 'list') groups[k] = kept.map((r) => ({ ...listView(r), typo: r.typo }));
    else groups[k] = kept.map((r) => ({ id: r.ref, typo: r.typo }));
    if (kept[0]) firsts.push({ ...kept[0], kind: k, id: k === 'user' ? kept[0].user.id : k === 'list' ? kept[0].list.id : kept[0].ref, username: kept[0].user?.username });
  }
  let best = null;
  for (const f of firsts) if (betterTop(f, best)) best = f;
  let suggestion = null;
  if (!ftsHits && typo.length) {
    const top = typo.reduce((a, b) => (b.sim > a.sim || (b.sim === a.sim && b.weight > a.weight) ? b : a));
    if (top.sim >= SUGGEST_MIN_SIM) suggestion = displayName(ctx, top);
  }
  const albumIds = (groups.album || []).map((a) => a.id);
  const listCovers = (groups.list || []).flatMap((l) => l.coverAlbumIds);
  return {
    q,
    suggestion,
    top: best ? { kind: best.kind, id: best.id, ...(best.kind === 'user' && { username: best.username }) } : null,
    groups,
    counts,
    progress: progressOf(ctx, mine, albumIds),
    catalog: ctx.refs({ albumIds: [...albumIds, ...listCovers], trackIds: (groups.track || []).map((t) => t.id), artistIds: (groups.artist || []).map((a) => a.id) }),
  };
}

const encodeCursor = (offset) => btoa(JSON.stringify([offset])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decodeCursor(ctx, raw) {
  if (!raw) return 0;
  try {
    const [offset] = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/')));
    if (Number.isInteger(offset) && offset >= 0) return Math.min(offset, RESULTS_CAP);
  } catch {
    // curseur illisible : même réponse que le serveur
  }
  return ctx.fail(400, 'invalid_input', { field: 'cursor' });
}

function page(ctx, query) {
  const me = ctx.me();
  const type = query.get('type') || 'album';
  if (!SEARCH_KINDS.includes(type)) ctx.fail(400, 'invalid_input', { field: 'type' });
  const q = cleanQuery(query.get('q') || '');
  const prepared = prepareQuery(q);
  const offset = decodeCursor(ctx, query.get('cursor'));
  const limit = Math.min(48, Math.max(1, Math.floor(Number(query.get('limit')) || 24)));
  if (!prepared) return { q, type, items: [], nextCursor: null, total: 0, progress: {}, catalog: ctx.refs({}) };
  const { lists, mine } = candidates(ctx, me.id, prepared, [type], () => SCOPE_QUOTA);
  const ranked = lists[type].slice(0, RESULTS_CAP);
  const slice = ranked.slice(offset, offset + limit);
  let items;
  if (type === 'user') items = slice.map((r) => ({ ...r.user, typo: r.typo }));
  else if (type === 'list') items = slice.map((r) => ({ ...listView(r), typo: r.typo }));
  else items = slice.map((r) => ({ id: r.ref, typo: r.typo }));
  const ids = items.map((i) => i.id);
  const next = offset + slice.length;
  return {
    q,
    type,
    items,
    nextCursor: next < ranked.length ? encodeCursor(next) : null,
    total: ranked.length,
    progress: type === 'album' ? progressOf(ctx, mine, ids) : {},
    catalog: ctx.refs({
      albumIds: type === 'album' ? ids : type === 'list' ? items.flatMap((l) => l.coverAlbumIds) : [],
      trackIds: type === 'track' ? ids : [],
      artistIds: type === 'artist' ? ids : [],
    }),
  };
}

function status(ctx) {
  const me = ctx.me();
  if (me.role !== 'admin') ctx.fail(403, 'forbidden');
  const docs = Object.fromEntries(SEARCH_KINDS.map((k) => [k, 0]));
  for (const d of [...catalogIndex(ctx), ...socialIndex(ctx, me.id)]) docs[d.kind] += 1;
  return { version: VERSION, indexedVersion: VERSION, docs, lastRefresh: Date.now(), lastBuild: { at: Date.now(), ms: 1, docs: Object.values(docs).reduce((a, b) => a + b, 0) } };
}

export const routes = [
  ['GET', /^\/search\/suggest$/, ({ query, ctx }) => suggest(ctx, query.get('q'), query.get('scope'))],
  ['GET', /^\/search$/, ({ query, ctx }) => page(ctx, query)],
  ['GET', /^\/admin\/search$/, ({ ctx }) => status(ctx)],
  ['POST', /^\/admin\/search\/rebuild$/, ({ ctx }) => {
    catalogDocs = null;
    return status(ctx);
  }],
];

export function seed() {}

export function migrate() {}
