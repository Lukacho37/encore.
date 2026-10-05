// Vraies pochettes et liens d'écoute, fournis par une plateforme de streaming.
//
// - Spotify (Web API, identifiants SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET) en priorité, Deezer (API publique,
//   sans clé) sinon ou en secours.
// - Les images ne sont jamais téléchargées ni copiées : on garde seulement leur adresse sur le serveur de la
//   plateforme (affichage direct) et le lien vers l'album ou le morceau, rafraîchis régulièrement.
// - COVERS=off coupe tout : le site revient aux visuels générés (par exemple sur demande d'un ayant droit).
import { config } from './config.js';
import { ALBUMS, ARTIST_BY_ID, TRACKS, TRACKS_BY_ALBUM } from '../shared/catalog.js';

const DAY = 86_400_000;
const FOUND_TTL = 30 * DAY;
const MISSING_TTL = DAY;
const PAUSE_MS = 220;
const RETRY_MS = 15 * 60_000;

// Morceaux crédités autrement sur les plateformes.
const SEARCH_ARTIST = {
  'promo:we-are-the-world': 'U.S.A. for Africa',
  // Le duo de 2007 est publié sous le nom de Mark Ronson ; « Amy Winehouse » seul tomberait sur ses versions solo.
  'promo:valerie': 'Mark Ronson',
}

export class RateLimited extends Error {}

/** Minuscules, sans accents, sans « (Remastered) », « - Remastered 2009 » ni ponctuation. */
export function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\*+/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Sans les points : « U.S.A. for Africa » et « USA for Africa » sont le même artiste.
const normArtist = (s) => normTitle(String(s || '').replace(/\./g, ''));

function artistMatches(names, wanted) {
  const want = normArtist(wanted);
  const first = normArtist(String(wanted).split(' & ')[0]);
  return names.some((name) => {
    const n = normArtist(name);
    if (!n) return false;
    return n === want || n === first || (n.length >= 3 && (want.includes(n) || n.includes(want)));
  });
}

function titleScore(candidate, wanted) {
  const c = normTitle(candidate);
  const w = normTitle(wanted);
  if (!c || !w) return 0;
  if (c === w) return 3;
  if (c.startsWith(`${w} `)) return 2;
  if (w.length >= 4 && c.includes(w)) return 1;
  return 0;
}

/** Meilleur résultat : artiste obligatoire, titre exact avant une variante, puis l'ordre de pertinence. */
function pickBest(results, title, artist, { names, name, bonus = () => 0 }) {
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    if (!artistMatches(names(r), artist)) continue;
    const s = titleScore(name(r), title);
    if (!s) continue;
    const score = s * 10 + bonus(r);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

const https = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

/** Comme normTitle, mais en gardant le contenu des parenthèses (« School Spirit (Skit 1) » ≠ « School Spirit »). */
function normFull(s) {
  return normTitle(String(s || '').replace(/[()[\]]/g, ' '));
}

/**
 * Associe les morceaux du catalogue aux pistes de la plateforme. Chaque piste ne sert qu'une fois :
 * titre complet d'abord, titre sans parenthèses ensuite (la position départage les homonymes),
 * puis la position seule quand les deux listes ont la même longueur.
 */
export function mapTracks(ours, theirs) {
  const result = {};
  const used = new Set();
  const assign = (entry, j) => {
    const url = https(theirs[j]?.url);
    if (!url) return false;
    used.add(j);
    result[entry.track.id] = url;
    return true;
  };
  const passes = [
    (entry) => {
      const want = normFull(entry.track.title);
      return theirs.findIndex((p, j) => !used.has(j) && normFull(p.title) === want);
    },
    (entry) => {
      const want = normTitle(entry.track.title);
      const candidates = theirs.map((p, j) => j).filter((j) => !used.has(j) && normTitle(theirs[j].title) === want);
      return candidates.find((j) => j === entry.i) ?? candidates[0] ?? -1;
    },
    (entry) => (ours.length === theirs.length && !used.has(entry.i) ? entry.i : -1),
  ];
  let pending = ours.map((track, i) => ({ track, i }));
  for (const pass of passes) {
    pending = pending.filter((entry) => {
      const j = pass(entry);
      return !(j >= 0 && assign(entry, j));
    });
  }
  return result;
}

/** Ce que l'on cherche : chaque album, et chaque single hors album (carte promo). */
export function coverItems() {
  const albums = ALBUMS.map((a) => ({
    key: a.id,
    type: 'album',
    title: a.title,
    artist: ARTIST_BY_ID[a.artist].name,
    tracks: TRACKS_BY_ALBUM[a.id],
  }));
  const promos = TRACKS.filter((t) => t.kind === 'promo').map((t) => ({
    key: t.id,
    type: 'track',
    title: t.title,
    artist: SEARCH_ARTIST[t.id] || ARTIST_BY_ID[t.artistId].name,
  }));
  return [...albums, ...promos];
}

// ---------- fournisseurs ----------------------------------------------------------

function spotifyProvider(cfg, fetchImpl, pause) {
  let token = null;
  let tokenUntil = 0;

  async function call(url, init) {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(8000) });
    if (res.status === 429) throw new RateLimited('spotify');
    if (res.status === 401) token = null;
    // 403 : Spotify refuse les applications dont le propriétaire n'a pas d'abonnement Premium actif.
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function auth() {
    if (token && Date.now() < tokenUntil) return token;
    const basic = Buffer.from(`${cfg.spotify.clientId}:${cfg.spotify.clientSecret}`).toString('base64');
    const data = await call(`${cfg.spotifyAccountsUrl}/api/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    token = data.access_token;
    tokenUntil = Date.now() + Math.max(60, (data.expires_in || 3600) - 60) * 1000;
    return token;
  }

  async function get(path) {
    const t = await auth();
    return call(`${cfg.spotifyApiUrl}${path}`, { headers: { Authorization: `Bearer ${t}` } });
  }

  const images = (list = []) => {
    const sorted = [...list].filter((i) => https(i.url)).sort((a, b) => (b.width || 0) - (a.width || 0));
    if (!sorted.length) return null;
    const cover = sorted[0];
    const thumb = sorted.find((i) => (i.width || 0) <= 320) || cover;
    return { cover: cover.url, coverW: cover.width || 640, thumb: thumb.url, thumbW: thumb.width || 300 };
  };

  const market = encodeURIComponent(cfg.coversMarket);

  return {
    id: 'spotify',
    async album(item) {
      const q = encodeURIComponent(`album:${item.title.replace(/\*+/g, '')} artist:${item.artist}`);
      const data = await get(`/v1/search?type=album&limit=10&market=${market}&q=${q}`);
      const best = pickBest(data.albums?.items || [], item.title, item.artist, {
        names: (r) => (r.artists || []).map((a) => a.name),
        name: (r) => r.name,
        bonus: (r) => (r.album_type === 'album' ? 1 : 0),
      });
      const img = best && images(best.images);
      if (!img || !https(best.external_urls?.spotify)) return null;
      await pause();
      const list = await get(`/v1/albums/${encodeURIComponent(best.id)}/tracks?limit=50&market=${market}`);
      const theirs = (list.items || []).map((p) => ({ title: p.name, disc: p.disc_number || 1, position: p.track_number, url: p.external_urls?.spotify }));
      return { ...img, url: best.external_urls.spotify, tracks: mapTracks(item.tracks, theirs) };
    },
    async track(item) {
      const q = encodeURIComponent(`track:${item.title.replace(/\*+/g, '')} artist:${item.artist}`);
      const data = await get(`/v1/search?type=track&limit=10&market=${market}&q=${q}`);
      const best = pickBest(data.tracks?.items || [], item.title, item.artist, {
        names: (r) => (r.artists || []).map((a) => a.name),
        name: (r) => r.name,
      });
      const img = best && images(best.album?.images);
      const url = best && https(best.external_urls?.spotify);
      return img && url ? { ...img, url, tracks: { [item.key]: url } } : null;
    },
  };
}

function deezerProvider(cfg, fetchImpl, pause) {
  async function get(path) {
    const res = await fetchImpl(`${cfg.deezerApiUrl}${path}`, { signal: AbortSignal.timeout(8000) });
    if (res.status === 429) throw new RateLimited('deezer');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Deezer répond 200 avec un objet « error » ; le code 4 signale le dépassement de quota.
    if (data?.error) {
      if (data.error.code === 4) throw new RateLimited('deezer');
      throw new Error(`code ${data.error.code || data.error.type}`);
    }
    return data;
  }

  const images = (r) => {
    const cover = https(r?.cover_xl) || https(r?.cover_big);
    if (!cover) return null;
    const thumb = https(r.cover_big) || cover;
    return { cover, coverW: r.cover_xl ? 1000 : 500, thumb, thumbW: thumb === cover && r.cover_xl ? 1000 : 500 };
  };

  async function search(kind, item, field) {
    const strict = encodeURIComponent(`artist:"${item.artist}" ${field}:"${item.title.replace(/\*+/g, '')}"`);
    const data = await get(`/search/${kind}?q=${strict}&limit=10`);
    if (data.data?.length) return data.data;
    await pause();
    const loose = encodeURIComponent(`${item.artist} ${item.title.replace(/\*+/g, '')}`);
    return (await get(`/search/${kind}?q=${loose}&limit=10`)).data || [];
  }

  return {
    id: 'deezer',
    async album(item) {
      const results = await search('album', item, 'album');
      const best = pickBest(results, item.title, item.artist, {
        names: (r) => [r.artist?.name],
        name: (r) => r.title,
        bonus: (r) => (r.record_type === 'album' ? 1 : 0),
      });
      const img = best && images(best);
      if (!img || !https(best.link)) return null;
      await pause();
      const list = await get(`/album/${encodeURIComponent(best.id)}/tracks?limit=100`);
      const theirs = (list.data || []).map((p, i) => ({ title: p.title, disc: p.disk_number || 1, position: p.track_position || i + 1, url: p.link }));
      return { ...img, url: best.link, tracks: mapTracks(item.tracks, theirs) };
    },
    async track(item) {
      const results = await search('track', item, 'track');
      const best = pickBest(results, item.title, item.artist, {
        names: (r) => [r.artist?.name],
        name: (r) => r.title,
      });
      const img = best && images(best.album);
      const url = best && https(best.link);
      return img && url ? { ...img, url, tracks: { [item.key]: url } } : null;
    },
  };
}

// ---------- service --------------------------------------------------------------

export function createCovers(db, { cfg = config, fetchImpl = (...a) => fetch(...a), pauseMs = PAUSE_MS } = {}) {
  // Petite pause entre deux appels pour rester sous les quotas des API.
  const pause = () => new Promise((r) => setTimeout(r, pauseMs));
  const mode = cfg.covers;
  const order = mode === 'off' ? []
    : mode === 'spotify' ? (cfg.spotify ? ['spotify'] : [])
      : mode === 'deezer' ? ['deezer']
        : cfg.spotify ? ['spotify', 'deezer'] : ['deezer'];
  const providers = {
    spotify: cfg.spotify ? spotifyProvider(cfg, fetchImpl, pause) : null,
    deezer: deezerProvider(cfg, fetchImpl, pause),
  };

  const items = coverItems();
  const byKey = new Map(items.map((i) => [i.key, i]));
  const selectAll = db.prepare('SELECT * FROM covers');
  const selectOne = db.prepare('SELECT * FROM covers WHERE item_key = ?');
  const upsert = db.prepare(`INSERT INTO covers (item_key, provider, cover, cover_w, thumb, thumb_w, url, tracks, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_key) DO UPDATE SET provider = excluded.provider, cover = excluded.cover, cover_w = excluded.cover_w,
      thumb = excluded.thumb, thumb_w = excluded.thumb_w, url = excluded.url, tracks = excluded.tracks, fetched_at = excluded.fetched_at`);

  let cache = null;
  let running = null;
  let timer = null;
  let lastRun = null;
  // Dernière erreur de chaque fournisseur pendant la tournée en cours (une erreur Spotify reste visible si Deezer échoue aussi).
  let lastErrors = {};
  // Un 403 Spotify pendant la tournée (abonnement Premium manquant), même si une autre erreur Spotify suit.
  let spotify403 = false;

  function isStale(row, now = Date.now()) {
    if (!row) return true;
    const age = now - row.fetched_at;
    if (!row.cover) return age > MISSING_TTL;
    if (!order.includes(row.provider)) return true;
    if (row.provider !== order[0] && age > MISSING_TTL) return true;
    return age > FOUND_TTL;
  }

  /** Cherche une pochette chez chaque fournisseur, dans l'ordre. Un quota dépassé interrompt la tournée. */
  async function resolve(item) {
    let reachedAll = true;
    for (const id of order) {
      try {
        const found = await providers[id][item.type](item);
        if (found) return { provider: id, ...found };
      } catch (err) {
        if (err instanceof RateLimited) throw err;
        reachedAll = false;
        lastErrors[id] = err.message;
        if (id === 'spotify' && err.message === 'HTTP 403') spotify403 = true;
      }
      await pause();
    }
    // Un fournisseur injoignable ne prouve pas que la pochette n'existe pas : on réessaiera plus tard.
    return reachedAll ? { provider: null } : undefined;
  }

  function save(key, found) {
    upsert.run(
      key,
      found.provider,
      found.cover || null,
      found.coverW || null,
      found.thumb || null,
      found.thumbW || null,
      found.url || null,
      found.tracks ? JSON.stringify(found.tracks) : null,
      Date.now(),
    );
    cache = null;
  }

  async function run({ force = false } = {}) {
    if (!order.length) return;
    lastErrors = {};
    spotify403 = false;
    const rows = new Map(selectAll.all().map((r) => [r.item_key, r]));
    for (const item of items) {
      const row = rows.get(item.key);
      if (!force && !isStale(row)) continue;
      const found = await resolve(item);
      // On garde une ancienne pochette plutôt que de l'effacer sur un échec passager,
      // sauf si elle vient d'un fournisseur qui n'est plus utilisé (elle n'est de toute façon plus affichée).
      if (found && (found.cover || !row?.cover || !order.includes(row.provider))) save(item.key, found);
      await pause();
    }
  }

  function warm(opts) {
    if (running) return running;
    running = run(opts)
      .then(() => {
        lastRun = Date.now();
      })
      .catch((err) => {
        if (err instanceof RateLimited) lastErrors[err.message] = 'quota';
        else lastErrors.internal = err.message;
        if (err instanceof RateLimited) setTimeout(() => warm(), RETRY_MS).unref?.();
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  function snapshot() {
    if (cache) return cache;
    const out = { providers: order, items: {}, tracks: {} };
    if (order.length) {
      for (const row of selectAll.all()) {
        if (!row.cover || !byKey.has(row.item_key) || !order.includes(row.provider)) continue;
        out.items[row.item_key] = { cover: row.cover, coverW: row.cover_w, thumb: row.thumb, thumbW: row.thumb_w, url: row.url, provider: row.provider };
        let tracks = {};
        try {
          tracks = JSON.parse(row.tracks || '{}');
        } catch {
          tracks = {};
        }
        for (const [trackId, url] of Object.entries(tracks)) out.tracks[trackId] = { url, provider: row.provider };
      }
    }
    cache = out;
    return out;
  }

  function status() {
    const snap = snapshot();
    const rows = new Map(selectAll.all().map((r) => [r.item_key, r]));
    const served = {};
    for (const it of Object.values(snap.items)) served[it.provider] = (served[it.provider] || 0) + 1;
    const describe = (i) => ({ key: i.key, type: i.type, title: i.title, artist: i.artist });
    return {
      mode,
      providers: order,
      spotifyKeys: !!cfg.spotify,
      total: items.length,
      found: Object.keys(snap.items).length,
      served,
      // Cherchés sans résultat, et pas encore cherchés (ou fournisseur injoignable) : deux cas à ne pas confondre.
      missing: items.filter((i) => !snap.items[i.key] && rows.has(i.key) && !rows.get(i.key).cover).map(describe),
      pending: items.filter((i) => !snap.items[i.key] && !(rows.has(i.key) && !rows.get(i.key).cover)).length,
      running: !!running,
      lastRun,
      lastError: Object.entries(lastErrors).map(([p, e]) => `${p}: ${e}`).join(' · ') || null,
      // Spotify répond 403 quand le propriétaire de l'application n'a pas d'abonnement Premium actif.
      spotifyPremium: spotify403,
      // Valeur de COVERS non reconnue : les pochettes sont coupées, l'admin doit le savoir.
      modeInvalid: cfg.coversInvalid ? cfg.coversRaw : null,
    };
  }

  return {
    order,
    snapshot,
    status,
    warm,
    refresh: () => warm({ force: true }),
    entry: (key) => selectOne.get(key),
    /** Première tournée peu après le démarrage, puis une par jour. */
    start() {
      if (!order.length || timer) return;
      setTimeout(() => warm(), 3000).unref?.();
      timer = setInterval(() => warm(), DAY);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}
