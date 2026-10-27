// Module « battles » : duels et classements (PLAN.md 4.2.6, 5.4). Chantier : P1-F.
//
// Un duel oppose deux albums (ou deux morceaux d'un même album, d'un même artiste) d'une catégorie (shared/battles.js).
// GET /battles/next tire les paires : catégorie demandée ou mélange (50 % tes goûts, 30 % global, 20 % un artiste dont
// tu connais deux albums, la catégorie du jour d'abord) ; réservoir = albums que tu connais (cartes, notes, « Mes 9
// albums », artistes favoris) et les 200 plus populaires de la catégorie ; 70 % de côtés connus, écart d'Elo ≤ 150 quand
// c'est possible, 30 % de duels d'exploration (un élément à moins de 20 votes) ; jamais une paire déjà votée ou passée.
// Chaque duel porte un jeton signé (HMAC du secret kv['secret'] : joueur · éléments · catégorie · expiration 30 min) :
// le serveur ne croit jamais un identifiant ou un score envoyé par le site.
// POST /battles/vote : un vote par paire (UNIQUE de battle_votes), quota quotidien, Elo de chaque catégorie qui contient
// les deux éléments (anti-brigade : K × 0,25 au-delà de 10 votes du joueur sur un élément dans la journée, × 0,5 pour un
// compte de moins de 24 h), 5 XP par vote pour les 20 premiers du jour. « Je ne connais pas » enregistre la paire (elle
// ne revient plus) sans rien changer d'autre.
// Classements : note décroissante dans une catégorie, « provisoire » sous 50 votes, pages par décalage (500 au plus),
// gardés 60 s ; hub des catégories listées (20 éléments classés, ou tous ceux de la catégorie quand elle en a moins) ;
// « Autour de l'album » : jusqu'à 5 catégories avec le rang de l'élément. Les albums retirés n'apparaissent nulle part.
// Les classements par pays n'existent qu'à partir de 30 albums dont l'artiste a un pays.
// API interne (deps.battles) : next, vote, hub, ranking, itemRankings. Événement : battle.voted { userId, voteId,
// itemType, counted }.
import crypto from 'node:crypto';
import {
  EXPLORE_SHARE, EXPLORE_VOTES, HUB_GROUPS, KNOWN_SHARE, MIX, PAIR_GAP, RANKING_CAP, TOKEN_TTL_MS, XP_PER_VOTE,
  XP_VOTES_PER_DAY, albumCategories, brigadeFactor, decadeOf, eloUpdate, inCategory, isListed, isProvisional, orderPair,
  parseCategory, seedRating, sharedCategories, trackCategories,
} from '../shared/battles.js';
import { THEME_GENRES } from '../shared/rules.js';

export const name = 'battles';

const POPULAR = 200;
const KNOWN_RECENT = 300;
const HUB_PER_GROUP = 12;
const DUELS_MAX = 5;
const ATTEMPTS = 40;
const FEATURED_DECADES = [1960, 1970, 1980, 1990, 2000, 2010];
const COUNTRY_MIN_ALBUMS = 30;
const ITEM_PREF = ['artist', 'album_tracks', 'genre_decade', 'decade', 'genre', 'year', 'artist_tracks', 'country', 'global'];

export function init(deps) {
  const { db, catalog, services, periods, HttpError } = deps;
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
  const rnd = () => crypto.randomInt(0, 2 ** 31) / 2 ** 31;
  const pick = (list) => list[Math.floor(rnd() * list.length)];

  // Secret des jetons : 32 octets créés au premier démarrage, jamais envoyés au site (PLAN.md 7.2).
  q("INSERT OR IGNORE INTO kv (key, value) VALUES ('secret', ?)").run(crypto.randomBytes(32).toString('hex'));
  const secret = q("SELECT value FROM kv WHERE key = 'secret'").get().value;

  const pools = deps.lru({ max: 2000, ttlMs: 10 * 60_000 });
  const rankingCache = deps.lru({ max: 2000, ttlMs: 60_000 });

  // ----- jetons signés -------------------------------------------------------------------------------------

  const mac = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
  function sign(payload) {
    const data = Buffer.from(json(payload)).toString('base64url');
    return `${data}.${mac(data)}`;
  }
  /** Contenu d'un jeton authentique, sinon null (signature fausse, forme inattendue). */
  function verify(token) {
    if (typeof token !== 'string' || token.length > 800) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const given = Buffer.from(parts[1]);
    const expected = Buffer.from(mac(parts[0]));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    try {
      const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
    } catch {
      return null;
    }
  }

  // ----- faits du catalogue ----------------------------------------------------------------------------------

  /**
   * Les pays n'entrent dans les catégories qu'à partir de 30 albums dont l'artiste a un pays (PLAN.md 5.4 : avant,
   * un classement « France » de trois albums n'aurait pas de sens). Comptage borné, gardé 10 min.
   */
  const countriesOn = () => pools.wrap('countries', () => q(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM cat_albums al
    JOIN cat_artists ar ON ar.id = al.artist_id WHERE ar.country IS NOT NULL AND al.status = 'active' LIMIT ${COUNTRY_MIN_ALBUMS})`)
    .get().n >= COUNTRY_MIN_ALBUMS);

  /** Faits des albums (artiste, année, genre, pays, retiré ?) : Map id → faits. */
  function albumFacts(ids) {
    if (!ids.length) return new Map();
    const countries = countriesOn();
    return new Map(q(`SELECT al.id, al.artist_id, al.year, al.genre, al.status, ar.country FROM cat_albums al
      JOIN cat_artists ar ON ar.id = al.artist_id WHERE al.id IN (SELECT value FROM json_each(?))`).all(json(ids))
      .map((r) => [r.id, {
        id: r.id, artistId: r.artist_id, year: r.year, genre: r.genre, country: countries ? r.country || null : null, active: r.status === 'active',
      }]));
  }
  function trackFacts(ids) {
    if (!ids.length) return new Map();
    return new Map(q(`SELECT id, album_id, artist_id, status FROM cat_tracks WHERE id IN (SELECT value FROM json_each(?))`).all(json(ids))
      .map((r) => [r.id, { id: r.id, albumId: r.album_id, artistId: r.artist_id, active: r.status === 'active' }]));
  }
  const factsOf = (itemType, ids) => (itemType === 'track' ? trackFacts(ids) : albumFacts(ids));

  /** Filtre SQL d'une catégorie d'albums sur cat_albums al (et cat_artists ar pour le pays). */
  function albumFilter(cat) {
    switch (cat.kind) {
      case 'global': return { sql: '1 = 1', args: [] };
      case 'artist': return { sql: 'al.artist_id = ?', args: [cat.value] };
      case 'decade': return { sql: 'al.year >= ? AND al.year < ?', args: [cat.value, cat.value + 10] };
      case 'year': return { sql: 'al.year = ?', args: [cat.value] };
      case 'genre': return { sql: 'al.genre = ?', args: [cat.value] };
      case 'genre_decade': return { sql: 'al.genre = ? AND al.year >= ? AND al.year < ?', args: [cat.value, cat.value2, cat.value2 + 10] };
      case 'country': return { sql: 'al.artist_id IN (SELECT id FROM cat_artists WHERE country = ?)', args: [cat.value] };
      default: return null;
    }
  }

  /** Les éléments les plus populaires d'une catégorie (gardés 10 min). */
  function popularPool(cat) {
    return pools.wrap(`pop:${cat.key}`, () => {
      if (cat.kind === 'album_tracks') {
        return q("SELECT id FROM cat_tracks WHERE album_id = ? AND status = 'active' ORDER BY n LIMIT ?").all(cat.value, POPULAR).map((r) => r.id);
      }
      if (cat.kind === 'artist_tracks') {
        return q("SELECT id FROM cat_tracks WHERE artist_id = ? AND status = 'active' ORDER BY pop DESC, id LIMIT ?").all(cat.value, POPULAR).map((r) => r.id);
      }
      const f = albumFilter(cat);
      if (!f) return [];
      return q(`SELECT al.id FROM cat_albums al WHERE ${f.sql} AND al.status = 'active' ORDER BY al.fans DESC, al.id LIMIT ?`)
        .all(...f.args, POPULAR).map((r) => r.id);
    });
  }

  /** Albums que le joueur connaît : cartes (300 derniers albums enrichis), notes (300 dernières), Mes 9 albums, artistes favoris. */
  function knownAlbums(userId) {
    return q(`SELECT DISTINCT id FROM (
        SELECT album_id AS id FROM (SELECT album_id FROM user_album_progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT ${KNOWN_RECENT})
        UNION SELECT item_id FROM (SELECT item_id FROM ratings WHERE user_id = ? AND item_type = 'album' ORDER BY updated_at DESC LIMIT ${KNOWN_RECENT})
        UNION SELECT li.item_id FROM lists l JOIN list_items li ON li.list_id = l.id WHERE l.user_id = ? AND l.kind = 'grid9' AND li.item_type = 'album'
        UNION SELECT al.id FROM user_favorites f JOIN cat_albums al ON al.artist_id = f.item_id WHERE f.user_id = ? AND f.kind = 'artist'
      ) LIMIT 1000`).all(userId, userId, userId, userId).map((r) => r.id);
  }

  /** Éléments connus du joueur dans une catégorie. */
  function knownPool(userId, cat, pool) {
    if (cat.itemType === 'track') {
      if (!pool.length) return [];
      return q(`SELECT DISTINCT track_id AS id FROM cards WHERE user_id = ? AND track_id IN (SELECT value FROM json_each(?))
        UNION SELECT item_id FROM ratings WHERE user_id = ? AND item_type = 'track' AND item_id IN (SELECT value FROM json_each(?))`)
        .all(userId, json(pool), userId, json(pool)).map((r) => r.id);
    }
    const known = knownAlbums(userId);
    if (!known.length) return [];
    const facts = albumFacts(known);
    return known.filter((id) => facts.get(id)?.active && inCategory(cat, facts.get(id)));
  }

  /** Notes Elo de ces éléments dans la catégorie ; celles qui manquent partent de la moyenne de la communauté. */
  function ratingsOf(cat, ids) {
    const out = new Map();
    if (!ids.length) return out;
    for (const r of q(`SELECT item_id, rating, votes, wins FROM battle_ratings WHERE category = ? AND item_type = ?
      AND item_id IN (SELECT value FROM json_each(?))`).all(cat.key, cat.itemType, json(ids))) {
      out.set(r.item_id, { rating: r.rating, votes: r.votes, wins: r.wins, stored: true });
    }
    const missing = ids.filter((id) => !out.has(id));
    if (missing.length) {
      const stats = new Map(q(`SELECT item_id, count, sum FROM rating_stats WHERE item_type = ? AND item_id IN (SELECT value FROM json_each(?))`)
        .all(cat.itemType, json(missing)).map((r) => [r.item_id, r]));
      for (const id of missing) out.set(id, { rating: seedRating(stats.get(id)), votes: 0, wins: 0, stored: false });
    }
    return out;
  }

  // ----- tirage des duels ------------------------------------------------------------------------------------

  const dayStart = () => periods.dayStart(Date.now());
  const votesToday = (userId) => q('SELECT COUNT(*) AS n FROM battle_votes WHERE user_id = ? AND created_at >= ?').get(userId, dayStart()).n;
  const countedToday = (userId) => q('SELECT COUNT(*) AS n FROM battle_votes WHERE user_id = ? AND created_at >= ? AND counted = 1').get(userId, dayStart()).n;

  /** Catégorie du jour (kv battle:featured:<jour>) : un genre ou une décennie, la même pour tous ce jour-là. */
  function featured() {
    const day = periods.dayKey(Date.now()).slice(2);
    const key = `battle:featured:${day}`;
    const hit = q('SELECT value FROM kv WHERE key = ?').get(key)?.value;
    if (hit && parseCategory(hit)) return hit;
    let h = 0;
    for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const options = [...THEME_GENRES.slice(0, 8).map((g) => `genre:${g}`), ...FEATURED_DECADES.map((d) => `decade:${d}`)];
    const value = options[h % options.length];
    q('INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)').run(key, value);
    return q('SELECT value FROM kv WHERE key = ?').get(key).value;
  }

  /** Goûts du joueur pour le mélange : genres et décennies de ses 200 albums les plus récemment enrichis. */
  function tasteOf(userId) {
    const rows = q(`SELECT al.genre AS g, (al.year / 10) * 10 AS d, al.artist_id AS a FROM (SELECT album_id FROM user_album_progress
      WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200) p JOIN cat_albums al ON al.id = p.album_id`).all(userId);
    const top = (key) => {
      const m = new Map();
      for (const r of rows) if (r[key] != null) m.set(r[key], (m.get(r[key]) || 0) + 1);
      return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([k, c]) => ({ k, c }));
    };
    const fav = q("SELECT item_id FROM user_favorites WHERE user_id = ? AND kind = 'genre' ORDER BY position LIMIT 3").all(userId).map((r) => r.item_id);
    return {
      genres: [...new Set([...fav, ...top('g').map((x) => x.k)])].slice(0, 3),
      decades: top('d').map((x) => x.k).filter((d) => d >= 1950).slice(0, 3),
      artists: top('a').filter((x) => x.c >= 2).map((x) => x.k).slice(0, 10),
    };
  }

  /** Catégorie du mélange : 50 % tes goûts (genre ou décennie de ton top 3), 30 % global, 20 % un artiste connu. */
  function mixCategory(userId) {
    const taste = tasteOf(userId);
    const roll = rnd();
    if (roll < MIX.taste) {
      const options = [...taste.genres.map((g) => `genre:${g}`), ...taste.decades.map((d) => `decade:${d}`)];
      if (options.length) return pick(options);
    } else if (roll >= MIX.taste + MIX.global && taste.artists.length) {
      return `artist:${pick(taste.artists)}`;
    }
    return 'global:album';
  }

  /** Paires déjà votées ou passées parmi ces paires (ordonnées a < b). */
  function votedAmong(userId, itemType, pairs) {
    if (!pairs.length) return new Set();
    const st = q('SELECT 1 FROM battle_votes WHERE user_id = ? AND item_type = ? AND a_id = ? AND b_id = ?');
    return new Set(pairs.filter(([a, b]) => st.get(userId, itemType, a, b)).map(([a, b]) => `${a}|${b}`));
  }

  /**
   * Une paire de la catégorie pour ce joueur, ou null : côtés connus à 70 %, écart ≤ 150 si possible, 30 %
   * d'exploration, jamais une paire déjà votée (ni une paire déjà prise dans ce lot, `taken`).
   */
  function pairIn(userId, cat, taken) {
    let pool = popularPool(cat);
    // Le réservoir est gardé 10 min : un album retiré entre-temps en sort ici. S'il n'en reste presque rien (fournisseur
    // détaché depuis, P2-C : ses albums sont archivés d'un coup), le réservoir est relu tout de suite.
    let facts = factsOf(cat.itemType, [...new Set(pool)]);
    if (pool.filter((id) => facts.get(id)?.active).length < 2) {
      pools.delete(`pop:${cat.key}`);
      pool = popularPool(cat);
      facts = factsOf(cat.itemType, [...new Set(pool)]);
    }
    const known = knownPool(userId, cat, pool).filter((id) => cat.itemType === 'album' || facts.get(id)?.active);
    const all = [...new Set([...known, ...pool.filter((id) => facts.get(id)?.active)])];
    if (all.length < 2) return null;
    const ratings = ratingsOf(cat, all);
    const side = () => (known.length && rnd() < KNOWN_SHARE ? pick(known) : pick(all));
    const tried = [];
    for (let i = 0; i < ATTEMPTS; i++) {
      const first = side();
      const explore = rnd() < EXPLORE_SHARE;
      let others = (known.length > 1 && rnd() < KNOWN_SHARE ? known : all).filter((id) => id !== first);
      if (!others.length) others = all.filter((id) => id !== first);
      if (explore) {
        const fresh = others.filter((id) => (ratings.get(id)?.votes ?? 0) < EXPLORE_VOTES);
        if (fresh.length) others = fresh;
      }
      const r1 = ratings.get(first).rating;
      const close = others.filter((id) => Math.abs(ratings.get(id).rating - r1) <= PAIR_GAP);
      const second = pick(close.length ? close : others);
      const { a, b } = orderPair(first, second);
      if (taken.has(`${a}|${b}`)) continue;
      tried.push([a, b]);
      // Vérifie par paquets de 8 pour ne pas interroger la base à chaque tirage.
      if (tried.length >= 8 || i === ATTEMPTS - 1) {
        const voted = votedAmong(userId, cat.itemType, tried);
        const ok = tried.find(([x, y]) => !voted.has(`${x}|${y}`));
        if (ok) return ok;
        for (const [x, y] of tried) taken.add(`${x}|${y}`);
        tried.length = 0;
      }
    }
    if (tried.length) {
      const voted = votedAmong(userId, cat.itemType, tried);
      return tried.find(([x, y]) => !voted.has(`${x}|${y}`)) || null;
    }
    return null;
  }

  const duelOf = (userId, cat, [a, b]) => ({
    token: sign({ u: userId, t: cat.itemType, a, b, c: cat.key, e: Date.now() + TOKEN_TTL_MS }),
    category: cat.key, itemType: cat.itemType, a, b,
  });

  /** Catégorie demandée (validée : elle doit exister au catalogue) ; 404 unknown_category sinon. */
  function requested(raw) {
    if (raw == null || raw === '' || raw === 'mix') return null;
    const cat = parseCategory(raw);
    if (!cat || cat.kind === 'event') throw new HttpError(404, 'unknown_category');
    return cat;
  }

  /** GET /api/battles/next?category=&n= → { duels, featured, today, catalog } ; 404 no_duel s'il n'y a plus de paire. */
  function next(userId, { category, n } = {}) {
    const wanted = requested(category);
    const count = Math.min(DUELS_MAX, Math.max(1, Math.floor(Number(n)) || 3));
    const feat = featured();
    const today = votesToday(userId);
    const taken = new Set();
    const duels = [];
    const tried = new Set();
    for (let i = 0; duels.length < count && i < count * 3; i++) {
      let key;
      if (wanted) key = wanted.key;
      else if (i === 0 && today < 5) key = feat;
      else key = mixCategory(userId);
      const cat = parseCategory(key);
      const pair = pairIn(userId, cat, taken);
      if (!pair) {
        tried.add(key);
        if (wanted) break;
        continue;
      }
      taken.add(`${pair[0]}|${pair[1]}`);
      duels.push(duelOf(userId, cat, pair));
    }
    // Mélange épuisé (rare) : le classement global en dernier recours.
    if (!duels.length && !wanted && !tried.has('global:album')) {
      const cat = parseCategory('global:album');
      const pair = pairIn(userId, cat, taken);
      if (pair) duels.push(duelOf(userId, cat, pair));
    }
    if (!duels.length) throw new HttpError(404, 'no_duel');
    const ids = duels.flatMap((d) => [d.a, d.b]);
    const counted = countedToday(userId);
    return {
      duels,
      featured: feat,
      today: { votes: counted, xp: Math.min(counted, XP_VOTES_PER_DAY) * XP_PER_VOTE, xpLeft: Math.max(0, XP_VOTES_PER_DAY - counted) * XP_PER_VOTE },
      catalog: duels[0].itemType === 'track' ? deps.refs({ trackIds: ids }) : deps.refs({ albumIds: ids }),
    };
  }

  // ----- vote ------------------------------------------------------------------------------------------------

  /** Votes du joueur aujourd'hui qui impliquent cet élément (anti-brigade). */
  const votesOnItemToday = (userId, itemType, id) => q(`SELECT COUNT(*) AS n FROM battle_votes WHERE user_id = ? AND created_at >= ?
    AND item_type = ? AND counted = 1 AND (a_id = ? OR b_id = ?)`).get(userId, dayStart(), itemType, id, id).n;

  const upsertRating = () => q(`INSERT INTO battle_ratings (category, item_type, item_id, rating, votes, wins, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (category, item_type, item_id) DO UPDATE SET rating = excluded.rating, votes = excluded.votes, wins = excluded.wins,
      updated_at = excluded.updated_at`);

  /**
   * POST /api/battles/vote { token, winner: 'a' | 'b' | null } → { ratingA, ratingB, deltaA, deltaB, xp, todayCount,
   * levelUp, skipped? }. `a` / `b` sont ceux du jeton (a < b).
   */
  function vote(userId, { token, winner } = {}) {
    if (winner !== 'a' && winner !== 'b' && winner !== null) throw new HttpError(400, 'invalid_input', { field: 'winner' });
    const p = verify(token);
    if (!p || p.u !== userId || !['album', 'track'].includes(p.t) || typeof p.a !== 'string' || typeof p.b !== 'string' || !(p.a < p.b)) {
      throw new HttpError(400, 'bad_token');
    }
    if (!Number.isFinite(p.e) || p.e < Date.now()) throw new HttpError(400, 'bad_token', { expired: true });
    const cat = parseCategory(p.c);
    if (!cat || cat.itemType !== p.t) throw new HttpError(400, 'bad_token');
    const facts = factsOf(p.t, [p.a, p.b]);
    const fa = facts.get(p.a);
    const fb = facts.get(p.b);
    if (!fa?.active || !fb?.active) throw new HttpError(400, 'bad_token', { withdrawn: true });
    const categories = sharedCategories(p.t, fa, fb);
    if (!categories.includes(cat.key)) throw new HttpError(400, 'bad_token');
    deps.quota(userId, 'battle_votes');
    if (q('SELECT 1 FROM battle_votes WHERE user_id = ? AND item_type = ? AND a_id = ? AND b_id = ?').get(userId, p.t, p.a, p.b)) {
      throw new HttpError(409, 'already_voted');
    }
    const counted = winner !== null;
    const now = Date.now();
    const user = services.getUser(userId);
    const ageMs = now - (user?.created_at ?? now);
    const result = services.atomic(() => {
      let voteId;
      try {
        voteId = Number(q(`INSERT INTO battle_votes (user_id, item_type, a_id, b_id, winner_id, context, categories, counted, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, p.t, p.a, p.b, counted ? p[winner] : null, cat.key, json(categories), counted ? 1 : 0, now)
          .lastInsertRowid);
      } catch (err) {
        if (/UNIQUE/.test(String(err.message))) throw new HttpError(409, 'already_voted');
        throw err;
      }
      if (!counted) return { voteId, shown: null, xp: 0, levelUp: null };
      const factorA = brigadeFactor({ votesOnItemToday: votesOnItemToday(userId, p.t, p.a) - 1, accountAgeMs: ageMs });
      const factorB = brigadeFactor({ votesOnItemToday: votesOnItemToday(userId, p.t, p.b) - 1, accountAgeMs: ageMs });
      const up = upsertRating();
      let shown = null;
      for (const key of categories) {
        const c = parseCategory(key);
        const r = ratingsOf(c, [p.a, p.b]);
        const ra = r.get(p.a);
        const rb = r.get(p.b);
        const res = eloUpdate(ra, rb, winner, { factorA, factorB });
        up.run(key, p.t, p.a, res.ratingA, ra.votes + 1, ra.wins + (winner === 'a' ? 1 : 0), now);
        up.run(key, p.t, p.b, res.ratingB, rb.votes + 1, rb.wins + (winner === 'b' ? 1 : 0), now);
        if (key === cat.key) shown = { ...res, votesA: ra.votes + 1, votesB: rb.votes + 1 };
      }
      // XP : 5 par vote, pour les 20 premiers votes comptés du jour (celui-ci compris).
      const counter = q('SELECT COUNT(*) AS n FROM battle_votes WHERE user_id = ? AND created_at >= ? AND counted = 1').get(userId, dayStart()).n;
      const xp = counter <= XP_VOTES_PER_DAY ? XP_PER_VOTE : 0;
      const levelUp = xp ? services.gainXp(services.getUser(userId), xp, 'battle') : null;
      return { voteId, shown, xp, levelUp };
    });
    for (const key of categories) rankingCache.deletePrefix(`rk:${key}|`);
    deps.bus.emit('battle.voted', { userId, voteId: result.voteId, itemType: p.t, counted });
    const todayCount = countedToday(userId);
    const base = { category: cat.key, itemType: p.t, a: p.a, b: p.b, winner, todayCount, xp: result.xp, levelUp: result.levelUp };
    if (!counted) return { ...base, skipped: true };
    const s = result.shown;
    return {
      ...base,
      ratingA: Math.round(s.ratingA), ratingB: Math.round(s.ratingB),
      deltaA: Math.round(s.deltaA * 10) / 10, deltaB: Math.round(s.deltaB * 10) / 10,
      votesA: s.votesA, votesB: s.votesB,
      categories: categories.length,
    };
  }

  // ----- classements -----------------------------------------------------------------------------------------

  const activeFilter = (itemType) => (itemType === 'track'
    ? "NOT EXISTS (SELECT 1 FROM cat_tracks x WHERE x.id = br.item_id AND x.status <> 'active')"
    : "NOT EXISTS (SELECT 1 FROM cat_albums x WHERE x.id = br.item_id AND x.status <> 'active')");

  /** Nombre d'éléments du catalogue dans une catégorie (pour lister une petite catégorie complète). */
  function sizeOf(cat) {
    return pools.wrap(`size:${cat.key}`, () => {
      if (cat.kind === 'album_tracks') return q("SELECT COUNT(*) AS n FROM cat_tracks WHERE album_id = ? AND status = 'active'").get(cat.value).n;
      if (cat.kind === 'artist_tracks') return q("SELECT COUNT(*) AS n FROM cat_tracks WHERE artist_id = ? AND status = 'active'").get(cat.value).n;
      if (cat.kind === 'global') return catalog.totals().albums;
      const f = albumFilter(cat);
      return f ? q(`SELECT COUNT(*) AS n FROM cat_albums al WHERE ${f.sql} AND al.status = 'active'`).get(...f.args).n : 0;
    });
  }

  /** Une page d'un classement : { category, itemType, items, nextCursor, total, listed, catalog } (gardée 60 s). */
  function ranking(categoryKey, { cursor, limit } = {}) {
    const cat = parseCategory(categoryKey);
    if (!cat || cat.kind === 'event') throw new HttpError(404, 'unknown_category');
    const size = deps.paging.limitOf(limit, { def: 20, max: 50 });
    const offset = deps.paging.offsetOf(cursor, { cap: RANKING_CAP });
    return rankingCache.wrap(`rk:${cat.key}|${offset}|${size}`, () => {
      const rows = q(`SELECT br.item_id, br.rating, br.votes, br.wins FROM battle_ratings br WHERE br.category = ? AND br.item_type = ?
        AND ${activeFilter(cat.itemType)} ORDER BY br.rating DESC, br.item_id LIMIT ? OFFSET ?`).all(cat.key, cat.itemType, size + 1, offset);
      const page = deps.paging.offsetPage(rows, offset, size, { cap: RANKING_CAP });
      const total = q('SELECT COUNT(*) AS n FROM battle_ratings WHERE category = ? AND item_type = ?').get(cat.key, cat.itemType).n;
      const items = page.items.map((r, i) => ({
        rank: offset + i + 1, id: r.item_id, rating: Math.round(r.rating), votes: r.votes, wins: r.wins, provisional: isProvisional(r.votes),
      }));
      const ids = items.map((x) => x.id);
      const extra = cat.kind === 'artist' || cat.kind === 'artist_tracks' ? [cat.value] : [];
      return {
        category: cat.key, kind: cat.kind, itemType: cat.itemType, items, nextCursor: page.nextCursor, total,
        listed: isListed(total, sizeOf(cat)),
        catalog: cat.itemType === 'track'
          ? deps.refs({ trackIds: ids, albumIds: cat.kind === 'album_tracks' ? [cat.value] : [], artistIds: extra })
          : deps.refs({ albumIds: ids, artistIds: extra }),
      };
    });
  }

  /**
   * Hub des classements : catégories listées par rubrique, avec leur podium. Il parcourt battle_ratings une fois
   * (≈ 60 ms pour 22 000 lignes sur la base de performance) : gardé 5 min, la liste des catégories bouge lentement.
   */
  function hub() {
    return rankingCache.wrap('hub', () => {
      // Le parcours de battle_ratings suit sa clé primaire (catégorie, type, élément) : une ligne par catégorie.
      const rows = q(`SELECT category, item_type, COUNT(*) AS items, SUM(votes) AS votes FROM battle_ratings
        GROUP BY category, item_type`).all();
      const byKind = new Map(HUB_GROUPS.map((k) => [k, []]));
      // Candidats examinés par rubrique (les plus votés d'abord) : borne le nombre de comptages de taille.
      const seen = new Map(HUB_GROUPS.map((k) => [k, 0]));
      for (const r of rows.sort((a, b) => b.votes - a.votes || (a.category < b.category ? -1 : 1))) {
        const cat = parseCategory(r.category);
        if (!cat || cat.itemType !== r.item_type || !byKind.has(cat.kind)) continue;
        const list = byKind.get(cat.kind);
        if (list.length >= HUB_PER_GROUP || seen.get(cat.kind) >= HUB_PER_GROUP * 5) continue;
        seen.set(cat.kind, seen.get(cat.kind) + 1);
        if (!isListed(r.items, r.items >= 20 ? Infinity : sizeOf(cat))) continue;
        const top = q(`SELECT br.item_id FROM battle_ratings br WHERE br.category = ? AND br.item_type = ? AND ${activeFilter(cat.itemType)}
          ORDER BY br.rating DESC, br.item_id LIMIT 3`).all(cat.key, cat.itemType).map((x) => x.item_id);
        list.push({ key: cat.key, kind: cat.kind, itemType: cat.itemType, items: r.items, votes: Math.round(r.votes / 2), top });
      }
      const categories = HUB_GROUPS.flatMap((k) => byKind.get(k));
      const albumIds = categories.flatMap((c) => c.top);
      const artistIds = categories.filter((c) => c.kind === 'artist').map((c) => parseCategory(c.key).value);
      return { categories, featured: featured(), catalog: deps.refs({ albumIds, artistIds }) };
    }, 5 * 60_000);
  }

  /**
   * « Autour de l'album » : jusqu'à 5 catégories où l'élément est classé, avec son rang ; `vote` : la catégorie où
   * l'envoyer voter (son artiste quand il a au moins deux albums, sinon son genre et sa décennie).
   */
  function itemRankings(itemType, id) {
    if (itemType !== 'album' && itemType !== 'track') throw new HttpError(404, 'not_found');
    const facts = factsOf(itemType, [String(id || '').slice(0, 80)]).get(String(id || ''));
    if (!facts) throw new HttpError(404, 'not_found');
    // Élément archivé (fournisseur détaché, P2-C) : plus classé, mais sa page s'ouvre toujours.
    if (!facts.active) {
      return { itemType, id: facts.id, items: [], vote: null, archived: true,
        catalog: deps.refs(itemType === 'track' ? { trackIds: [facts.id] } : { albumIds: [facts.id] }) };
    }
    const keys = itemType === 'track' ? trackCategories(facts) : albumCategories(facts);
    const mine = q('SELECT rating, votes FROM battle_ratings WHERE category = ? AND item_type = ? AND item_id = ?');
    const above = q('SELECT COUNT(*) AS n FROM battle_ratings WHERE category = ? AND item_type = ? AND rating > ?');
    const count = q('SELECT COUNT(*) AS n FROM battle_ratings WHERE category = ? AND item_type = ?');
    const items = [];
    for (const key of keys) {
      const r = mine.get(key, itemType, facts.id);
      if (!r) continue;
      const cat = parseCategory(key);
      const total = count.get(key, itemType).n;
      if (total < 2) continue;
      items.push({
        category: key, kind: cat.kind, rank: above.get(key, itemType, r.rating).n + 1, total, rating: Math.round(r.rating), votes: r.votes,
        provisional: isProvisional(r.votes), listed: isListed(total, sizeOf(cat)),
      });
    }
    items.sort((a, b) => a.rank / a.total - b.rank / b.total || ITEM_PREF.indexOf(a.kind) - ITEM_PREF.indexOf(b.kind));
    let voteKey;
    if (itemType === 'track') voteKey = `album_tracks:${facts.albumId}`;
    else {
      const albums = q("SELECT COUNT(*) AS n FROM cat_albums WHERE artist_id = ? AND status = 'active'").get(facts.artistId).n;
      const decade = decadeOf(facts.year);
      voteKey = albums >= 2 ? `artist:${facts.artistId}` : facts.genre && decade != null ? `genre_decade:${facts.genre}:${decade}` : 'global:album';
    }
    return {
      itemType, id: facts.id, items: items.slice(0, 5), vote: voteKey,
      catalog: deps.refs(itemType === 'track' ? { trackIds: [facts.id] } : { albumIds: [facts.id], artistIds: [facts.artistId] }),
    };
  }

  return { next, vote, hub, ranking, itemRankings, featured, verify };
}

export function routes(r, deps) {
  const { limits, services } = deps;
  const api = () => deps.battles;
  const partial = (req) => services.state(req.user.id, { partial: true });

  r.get('/battles/next', limits.read, (req, res) => res.json(api().next(req.user.id, { category: req.query.category, n: req.query.n })));
  r.post('/battles/vote', limits.write, (req, res) => {
    const since = Date.now();
    const result = api().vote(req.user.id, { token: req.body.token, winner: req.body.winner });
    // Le duel suivant de la même file (catégorie demandée ou mélange), pour l'enchaîner sans attendre.
    let next = null;
    try {
      next = api().next(req.user.id, { category: req.body.category, n: 1 });
    } catch (err) {
      if (!(err instanceof deps.HttpError)) throw err;
    }
    const badgesEarned = deps.badges?.earnedSince?.(req.user.id, since) ?? [];
    res.json({ ...result, next, badgesEarned, ...(result.xp || badgesEarned.length ? { state: partial(req) } : {}) });
  });
  r.get('/rankings', limits.read, (_req, res) => res.json(api().hub()));
  r.get('/rankings/:category', limits.read, (req, res) => res.json(api().ranking(req.params.category, req.query)));
  r.get('/items/:type/:id/rankings', limits.read, (req, res) => res.json(api().itemRankings(req.params.type, req.params.id)));
}
