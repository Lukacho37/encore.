// Jumeau de démo du module « enrich » (server/enrich.js, P2-C, PLAN.md 4.3) : mêmes routes, mêmes formes.
//   GET  /catalog/listen/:type/:id          liens officiels ou recherches, lecteurs intégrés, élément archivé ;
//   GET  /admin/enrich                      état de l'enrichissement (passe simulée sur les artistes de la graine) ;
//   POST /admin/enrich/start | pause        lancer / mettre en pause (la passe avance d'un artiste toutes les 1,5 s) ;
//   POST /admin/enrich/similar              albums proches recalculés d'après les notes de la démo ;
//   POST /admin/providers/:source/detach    simulation seulement (la démo n'a aucun album importé de Deezer).
// La démo est coupée d'Internet : aucun appel à MusicBrainz ni à Wikidata. Les identifiants Spotify ci-dessous sont
// ceux des albums de la graine tels que Wikidata les référence : le panneau d'écoute montre donc le lecteur Spotify
// (chargé seulement après le clic, comme sur le site). Le reste (Deezer, Apple Music, YouTube) ouvre une recherche.
import { LISTEN_PROVIDERS, embedFor, searchUrl, sourceUrl } from '@shared/ids.js';

export const name = 'enrich';

/** Albums de la graine → identifiant d'album Spotify (instantané de l'enrichissement). */
const SPOTIFY_ALBUMS = {
  discovery: '2noRn2Aes5aoNVsU6iWThc',
  'random-access-memories': '4m2880jivSbbyEGAKfITCa',
  'the-dark-side-of-the-moon': '4LH4d3cOWNNsVw41Gqt2kv',
  graduation: '4SZko61aMnmgvNhfhgTuD3',
  'the-college-dropout': '4Uv86qWpGTxf7fU7lG5X6F',
  'the-marshall-mathers-lp': '6t7956yu5zYf5A829XRiHC',
  'the-eminem-show': '2cWBwpqMsDJC1ZUwz813lo',
  'when-we-all-fall-asleep': '0S0KGZnfBGSIssfF54WSJh',
};

const ARTIST_STEP_MS = 1500;
const USER_AGENT = 'AlbumMania/0.1.0 ( démo hors ligne )';

function enrichState(db) {
  db.enrich ||= {
    phase: 'done', paused: false, pass: 1, cursor: null, startedAt: null, runningSince: null, resumeFrom: 0,
    passFinishedAt: Date.now() - 3 * 86_400_000, requests: { musicbrainz: 0, wikidata: 0 }, similar: null,
  };
  return db.enrich;
}

function requireAdmin(ctx) {
  const u = ctx.me();
  if (u.role !== 'admin') ctx.fail(403, 'forbidden');
  return u;
}

const seedArtists = (ctx) => [...ctx.ARTIST.values()];

/** La passe simulée avance avec le temps : un artiste toutes les ARTIST_STEP_MS, deux requêtes par artiste. */
function advance(ctx) {
  const s = enrichState(ctx.db);
  if (s.phase !== 'running') return s;
  const total = seedArtists(ctx).length;
  const done = Math.min(total, Math.floor((Date.now() - s.runningSince) / ARTIST_STEP_MS) + (s.resumeFrom || 0));
  s.requests = { musicbrainz: done * 2, wikidata: Math.floor(done / 2) };
  s.cursor = done;
  if (done >= total) Object.assign(s, { phase: 'done', passFinishedAt: Date.now(), runningSince: null, resumeFrom: 0 });
  return s;
}

function status(ctx) {
  const s = advance(ctx);
  const artists = seedArtists(ctx);
  const total = artists.length;
  const withCountry = artists.filter((a) => a.country).length;
  const done = s.phase === 'running' || s.phase === 'paused' ? (s.cursor || 0) : total;
  const spotify = Object.keys(SPOTIFY_ALBUMS).length;
  return {
    demo: true,
    mode: 'musicbrainz',
    blocked: null,
    userAgent: USER_AGENT,
    running: s.phase === 'running',
    phase: s.phase,
    paused: !!s.paused,
    pass: s.pass,
    progress: { done, total },
    requests: s.requests,
    startedAt: s.startedAt,
    finishedAt: s.passFinishedAt,
    passFinishedAt: s.passFinishedAt,
    retryAt: null,
    lastError: null,
    counts: {
      artists: total,
      artistsWithCountry: withCountry,
      countriesBy: { seed: withCountry },
      albums: ctx.ALBUM.size,
      withdrawn: { albums: 0, tracks: 0 },
      musicbrainz: { artist: 0, album: 0, track: 0 },
      spotify: { artist: 0, album: spotify, track: 0 },
      apple: { artist: 0, album: 0, track: 0 },
      wikidata: spotify,
      upc: 0,
      isrc: 0,
    },
    similar: s.similar,
    providers: { deezer: { detached: false } },
  };
}

function listen(ctx, type, rawId) {
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    // identifiant illisible : introuvable plus bas
  }
  let item = null;
  if (type === 'album' && ctx.ALBUM.has(id)) item = { title: ctx.ALBUM.get(id).title, artist: ctx.ALBUM.get(id).artist };
  if (type === 'track' && ctx.TRACK.has(id)) item = { title: ctx.TRACK.get(id).title, artist: ctx.TRACK.get(id).artist };
  if (type === 'artist' && ctx.ARTIST.has(id)) item = { title: ctx.ARTIST.get(id).name, artist: '' };
  if (!item) return ctx.fail(404, `unknown_${type}`);
  const spotify = type === 'album' ? SPOTIFY_ALBUMS[id] : null;
  const text = `${item.artist} ${item.title}`.trim();
  const links = LISTEN_PROVIDERS.map((provider) => (provider === 'spotify' && spotify
    ? { provider, url: sourceUrl('spotify', 'album', spotify), direct: true }
    : { provider, url: searchUrl(provider, text), direct: false }));
  return {
    type,
    id,
    links,
    embeds: spotify ? [embedFor('spotify', 'album', spotify)] : [],
    archived: false,
    sources: spotify ? [{ source: 'wikidata', url: 'https://www.wikidata.org/' }] : [],
    detached: [],
  };
}

/** Albums proches de la démo : albums notés 8+ ensemble par au moins deux joueurs (petite base, petit seuil). */
function similar(ctx) {
  const fans = new Map();
  for (const r of ctx.db.ratings || []) {
    if (r.type !== 'album' || r.score < 8) continue;
    if (!fans.has(r.id)) fans.set(r.id, new Set());
    fans.get(r.id).add(r.userId);
  }
  let rows = 0;
  for (const [a, users] of fans) {
    for (const [b, others] of fans) if (a !== b && [...users].filter((u) => others.has(u)).length >= 2) rows += 1;
  }
  const result = { albums: fans.size, rows, done: true };
  enrichState(ctx.db).similar = { ...result, at: Date.now() };
  return result;
}

export const routes = [
  ['GET', /^\/catalog\/listen\/(album|track|artist)\/([^/]+)$/, ({ params, ctx }) => {
    ctx.me();
    return listen(ctx, params[0], params[1]);
  }],
  ['GET', /^\/admin\/enrich$/, ({ ctx }) => {
    requireAdmin(ctx);
    return status(ctx);
  }],
  ['POST', /^\/admin\/enrich\/start$/, ({ ctx }) => {
    requireAdmin(ctx);
    const s = advance(ctx);
    if (s.phase !== 'running') {
      // Passe terminée : une nouvelle passe ne revoit que ce qui manque (ici, tout est déjà vu : elle va vite).
      const resumeFrom = s.phase === 'paused' ? s.cursor || 0 : 0;
      if (s.phase !== 'paused') s.pass += 1;
      Object.assign(s, { phase: 'running', paused: false, runningSince: Date.now(), resumeFrom, startedAt: s.startedAt || Date.now() });
    }
    return status(ctx);
  }],
  ['POST', /^\/admin\/enrich\/pause$/, ({ ctx }) => {
    requireAdmin(ctx);
    const s = advance(ctx);
    if (s.phase === 'running') Object.assign(s, { phase: 'paused', paused: true, runningSince: null, resumeFrom: s.cursor || 0 });
    return status(ctx);
  }],
  ['POST', /^\/admin\/enrich\/similar$/, ({ ctx }) => {
    requireAdmin(ctx);
    const result = similar(ctx);
    return { ...status(ctx), result };
  }],
  ['POST', /^\/admin\/providers\/([^/]+)\/detach$/, ({ params, body, ctx }) => {
    requireAdmin(ctx);
    if (params[0] !== 'deezer') ctx.fail(404, 'unknown_provider');
    // La démo ne peut que simuler : elle n'a importé aucun album de Deezer.
    if (body?.dryRun === false) ctx.fail(400, 'confirm_required');
    const zero = { total: 0, withdrawn: 0, kept: 0 };
    const report = {
      source: 'deezer', albums: zero, tracks: zero, promos: zero, artists: zero,
      players: { withCards: 0, cards: 0, ratings: 0, listItems: 0 }, covers: 0, facts: { externalIds: 0, queue: 0 },
      dryRun: true, purgeFacts: !!body?.purgeFacts,
    };
    return { report, status: status(ctx) };
  }],
];

export function seed(db) {
  enrichState(db);
}

export function migrate(db) {
  enrichState(db);
}
