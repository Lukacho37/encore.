// Module « market » : enchères et échanges de cartes (demande du propriétaire avant la mise en ligne).
//
// Enchères, en royalties (la monnaie du jeu, jamais d'argent réel) :
//   GET  /api/auctions?tab=open|mine|bids&rarity=&offset=   ventes en cours, mes ventes, celles où j'ai fait une offre
//   POST /api/auctions { trackId, variant, startPrice, hours } mise en vente : l'exemplaire quitte la collection (séquestre)
//   POST /api/auctions/:id/bid { amount }  offre : les royalties sont retenues, l'offre dépassée est rendue à son auteur
//   POST /api/auctions/:id/cancel          retrait par le vendeur, tant que personne n'a fait d'offre
//   Clôture (tâche de fond et à chaque lecture) : la carte va au meilleur offrant, les royalties au vendeur ; sans offre,
//   la carte revient au vendeur.
// Échanges entre amis, une carte contre une carte de même rareté (une Légendaire contre une Légendaire) :
//   GET  /api/trades                          reçus et envoyés en attente, derniers échanges terminés
//   GET  /api/trades/cards?user=&rarity=&q=   cartes d'un ami (ou les miennes, sans `user`) pour composer un échange
//   POST /api/trades { to, give: { trackId, variant }, want: { trackId, variant } }
//   POST /api/trades/:id/accept | decline | cancel
// Une carte reçue par échange ou aux enchères ne rapporte ni XP ni royalties (services.addCards, sources « trade » et
// « auction ») : sinon deux amis pourraient s'échanger la même paire en boucle. Les succès d'album et d'artiste comptent.
import { config } from './config.js';

export const name = 'market';

export const AUCTION_HOURS = [1, 6, 24, 72];
export const MIN_PRICE = 10;
export const MAX_PRICE = 1_000_000;
export const MAX_OPEN_AUCTIONS = 10;
export const MAX_PENDING_TRADES = 20;
/** Offre minimale : la mise à prix, puis l'offre en cours + 5 % (au moins 5 royalties). */
export const nextBid = (a) => (a.bid == null ? a.start_price : a.bid + Math.max(5, Math.ceil(a.bid * 0.05)));
const PAGE = 24;
const HOUR = 3_600_000;
const VARIANTS = ['std', 'holo'];

export function init(deps) {
  const { db, catalog, services, validate, HttpError } = deps;
  const q = (sql) => db.prepare(sql);
  const atomic = (fn) => (db.isTransaction ? fn() : services.atomic(fn));
  const notify = (...args) => deps.notifications?.notify?.(...args);
  const later = (fn) => setImmediate(() => {
    try {
      fn();
    } catch {
      // une notification ratée ne défait pas une vente
    }
  });

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
  const variantOf = (raw) => (raw == null ? 'std' : validate.oneOf(raw, VARIANTS, { field: 'variant' }));
  const intOf = (raw, field) => {
    const n = Number(raw);
    if (!Number.isInteger(n)) throw new HttpError(400, 'invalid_input', { field });
    return n;
  };

  // ----- cartes et royalties ---------------------------------------------------------------------------------

  const copies = (userId, trackId, variant) => q('SELECT count FROM cards WHERE user_id = ? AND track_id = ? AND variant = ?')
    .get(userId, trackId, variant)?.count ?? 0;
  /** Retire un exemplaire (le dernier : la ligne disparaît) ; faux si le joueur ne l'a plus. */
  function takeCard(userId, trackId, variant) {
    if (!q('UPDATE cards SET count = count - 1 WHERE user_id = ? AND track_id = ? AND variant = ? AND count >= 1').run(userId, trackId, variant).changes) return false;
    q('DELETE FROM cards WHERE user_id = ? AND track_id = ? AND variant = ? AND count <= 0').run(userId, trackId, variant);
    services.forget?.(userId);
    return true;
  }
  function giveCard(userId, trackId, variant, source) {
    services.addCards(user(userId), [{ trackId, variant }], source);
    services.forget?.(userId);
  }
  const credit = (userId, n) => q('UPDATE users SET royalties = royalties + ? WHERE id = ?').run(n, userId);

  // ----- enchères ---------------------------------------------------------------------------------------------

  const auctionRow = (id) => q('SELECT * FROM auctions WHERE id = ?').get(id);
  const auctionView = (a, viewerId) => ({
    id: a.id,
    trackId: a.track_id,
    variant: a.variant,
    rarity: a.rarity,
    startPrice: a.start_price,
    bid: a.bid,
    bids: a.bids,
    nextBid: nextBid(a),
    endsAt: a.ends_at,
    status: a.status,
    sellerId: a.seller_id,
    mine: a.seller_id === viewerId,
    leading: a.bidder_id === viewerId,
  });

  /** Clôt les ventes arrivées à leur terme (toutes, ou `ids` seulement). Renvoie le nombre de ventes closes. */
  function settle(now = Date.now()) {
    const due = q("SELECT * FROM auctions WHERE status = 'open' AND ends_at <= ? ORDER BY ends_at LIMIT 200").all(now);
    for (const a of due) {
      atomic(() => {
        const fresh = auctionRow(a.id);
        if (fresh.status !== 'open') return;
        if (fresh.bidder_id) {
          giveCard(fresh.bidder_id, fresh.track_id, fresh.variant, 'auction');
          credit(fresh.seller_id, fresh.bid);
          q("UPDATE auctions SET status = 'sold', settled_at = ? WHERE id = ?").run(now, a.id);
          const data = { itemType: 'track', itemId: fresh.track_id, auctionId: a.id, price: fresh.bid };
          later(() => {
            notify(fresh.bidder_id, 'auction_won', { targetType: 'track', targetId: fresh.track_id, data });
            notify(fresh.seller_id, 'auction_sold', { targetType: 'track', targetId: fresh.track_id, data });
          });
        } else {
          giveCard(fresh.seller_id, fresh.track_id, fresh.variant, 'auction');
          q("UPDATE auctions SET status = 'unsold', settled_at = ? WHERE id = ?").run(now, a.id);
          later(() => notify(fresh.seller_id, 'auction_unsold', { targetType: 'track', targetId: fresh.track_id, data: { itemType: 'track', itemId: fresh.track_id, auctionId: a.id } }));
        }
      });
    }
    return due.length;
  }

  function listAuctions(viewerId, { tab = 'open', rarity = null, offset = 0 } = {}) {
    settle();
    const off = Math.max(0, Math.min(10_000, Number(offset) || 0));
    const where = [];
    const args = [];
    if (tab === 'mine') {
      where.push('seller_id = ?');
      args.push(viewerId);
    } else if (tab === 'bids') {
      where.push("status = 'open' AND id IN (SELECT auction_id FROM auction_bids WHERE user_id = ?)");
      args.push(viewerId);
    } else {
      // Ventes des autres joueurs, sans ceux que le joueur a bloqués (ou qui l'ont bloqué).
      where.push("status = 'open' AND seller_id <> ?");
      args.push(viewerId);
      const hidden = [...(deps.access?.hiddenIds?.(viewerId) || [])];
      if (hidden.length) {
        where.push('seller_id NOT IN (SELECT value FROM json_each(?))');
        args.push(JSON.stringify(hidden));
      }
    }
    if (rarity) {
      where.push('rarity = ?');
      args.push(String(rarity));
    }
    const order = tab === 'mine' ? "CASE status WHEN 'open' THEN 0 ELSE 1 END, ends_at DESC" : 'ends_at';
    const rows = q(`SELECT * FROM auctions WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, PAGE + 1, off);
    const items = rows.slice(0, PAGE).map((a) => auctionView(a, viewerId));
    const sellers = services.userSummaries(items.map((a) => a.sellerId), viewerId);
    return {
      items: items.map((a) => ({ ...a, seller: sellers.get(a.sellerId) || null })),
      nextOffset: rows.length > PAGE ? off + PAGE : null,
      catalog: deps.refs({ trackIds: items.map((a) => a.trackId) }),
    };
  }

  function createAuction(userId, body = {}) {
    const track = trackOf(body.trackId);
    const variant = variantOf(body.variant);
    const price = intOf(body.startPrice, 'startPrice');
    if (price < MIN_PRICE || price > MAX_PRICE) throw new HttpError(400, 'invalid_price', { min: MIN_PRICE, max: MAX_PRICE });
    const hours = intOf(body.hours ?? 24, 'hours');
    if (!AUCTION_HOURS.includes(hours)) throw new HttpError(400, 'invalid_input', { field: 'hours' });
    return atomic(() => {
      user(userId);
      if (q("SELECT COUNT(*) AS n FROM auctions WHERE seller_id = ? AND status = 'open'").get(userId).n >= MAX_OPEN_AUCTIONS) {
        throw new HttpError(409, 'too_many_auctions', { max: MAX_OPEN_AUCTIONS });
      }
      if (!takeCard(userId, track.id, variant)) throw new HttpError(409, 'not_owned');
      const now = Date.now();
      const { lastInsertRowid } = q(`INSERT INTO auctions (seller_id, track_id, variant, rarity, start_price, ends_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, track.id, variant, track.rarity, price, now + hours * HOUR, now);
      return { auction: auctionView(auctionRow(Number(lastInsertRowid)), userId), cardCounts: services.cardCounts(userId, [track.id]) };
    });
  }

  function bid(userId, rawId, rawAmount) {
    const id = intOf(rawId, 'id');
    const amount = intOf(rawAmount, 'amount');
    settle();
    return atomic(() => {
      const me = user(userId);
      const a = auctionRow(id);
      if (!a || (a.seller_id !== userId && deps.access?.isBlocked?.(userId, a.seller_id))) throw new HttpError(404, 'unknown_auction');
      if (a.status !== 'open' || a.ends_at <= Date.now()) throw new HttpError(409, 'auction_closed');
      if (a.seller_id === userId) throw new HttpError(409, 'own_auction');
      if (a.bidder_id === userId) throw new HttpError(409, 'already_leading');
      const min = nextBid(a);
      if (amount < min || amount > MAX_PRICE) throw new HttpError(409, 'bid_too_low', { min });
      if (me.royalties < amount) throw new HttpError(409, 'not_enough_royalties', { cost: amount });
      q('UPDATE users SET royalties = royalties - ? WHERE id = ?').run(amount, userId);
      if (a.bidder_id) credit(a.bidder_id, a.bid);
      // Une offre dans les deux dernières minutes prolonge la vente de deux minutes (pas d'enchère « à la seconde »).
      const endsAt = Math.max(a.ends_at, Date.now() + 2 * 60_000);
      q('UPDATE auctions SET bid = ?, bidder_id = ?, bids = bids + 1, ends_at = ? WHERE id = ?').run(amount, userId, endsAt, id);
      q('INSERT INTO auction_bids (auction_id, user_id, amount, created_at) VALUES (?, ?, ?, ?)').run(id, userId, amount, Date.now());
      if (a.bidder_id) {
        later(() => notify(a.bidder_id, 'auction_outbid', { actorId: userId, targetType: 'track', targetId: a.track_id, data: { itemType: 'track', itemId: a.track_id, auctionId: id } }));
      }
      return { auction: auctionView(auctionRow(id), userId) };
    });
  }

  function cancelAuction(userId, rawId) {
    const id = intOf(rawId, 'id');
    return atomic(() => {
      const a = auctionRow(id);
      if (!a || a.seller_id !== userId) throw new HttpError(404, 'unknown_auction');
      if (a.status !== 'open') throw new HttpError(409, 'auction_closed');
      if (a.bids > 0) throw new HttpError(409, 'auction_has_bids');
      q("UPDATE auctions SET status = 'cancelled', settled_at = ? WHERE id = ?").run(Date.now(), id);
      giveCard(userId, a.track_id, a.variant, 'auction');
      return { auction: auctionView(auctionRow(id), userId), cardCounts: services.cardCounts(userId, [a.track_id]) };
    });
  }

  // ----- échanges ---------------------------------------------------------------------------------------------

  const tradeRow = (id) => q('SELECT * FROM trades WHERE id = ?').get(id);
  const tradeView = (t) => ({
    id: t.id,
    fromId: t.from_id,
    toId: t.to_id,
    give: { trackId: t.give_track, variant: t.give_variant },
    want: { trackId: t.want_track, variant: t.want_variant },
    rarity: t.rarity,
    status: t.status,
    createdAt: t.created_at,
    decidedAt: t.decided_at,
  });
  const isFriend = (a, b) => !!services.friendIds?.(a)?.has(Number(b));
  const byName = (raw) => {
    const name = String(raw || '').trim().slice(0, 40);
    return name ? q('SELECT id, username FROM users WHERE username = ? AND email_verified_at IS NOT NULL').get(name) : null;
  };
  /** Ami par son pseudo (404 si inconnu, bloqué ou pas ami). */
  const friendOf = (userId, raw) => {
    const other = byName(raw);
    if (!other || other.id === userId || deps.access?.isBlocked?.(userId, other.id) || !isFriend(userId, other.id)) throw new HttpError(404, 'friend_not_found');
    return other;
  };

  function listTrades(userId) {
    const pending = q("SELECT * FROM trades WHERE status = 'pending' AND (to_id = ? OR from_id = ?) ORDER BY created_at DESC LIMIT 100").all(userId, userId);
    const done = q("SELECT * FROM trades WHERE status <> 'pending' AND (to_id = ? OR from_id = ?) ORDER BY decided_at DESC LIMIT 20").all(userId, userId);
    const all = [...pending, ...done].map(tradeView);
    const users = services.userSummaries(all.flatMap((t) => [t.fromId, t.toId]), userId);
    const withUsers = (t) => ({ ...t, from: users.get(t.fromId) || null, to: users.get(t.toId) || null });
    return {
      incoming: all.filter((t) => t.status === 'pending' && t.toId === userId).map(withUsers),
      outgoing: all.filter((t) => t.status === 'pending' && t.fromId === userId).map(withUsers),
      history: all.filter((t) => t.status !== 'pending').map(withUsers),
      catalog: deps.refs({ trackIds: all.flatMap((t) => [t.give.trackId, t.want.trackId]) }),
    };
  }

  /** Cartes d'un ami (ou les miennes) pour composer un échange, filtrées par rareté et par texte. */
  function tradeCards(userId, { user: raw, rarity, q: text, offset } = {}) {
    const owner = raw ? friendOf(userId, raw) : { id: userId };
    const page = catalog.ownedTracks(owner.id, { q: text, rarity: rarity || undefined, offset, limit: 48 });
    const ids = page.items.map((t) => t.id);
    const variants = ids.length
      ? q("SELECT track_id, variant, count FROM cards WHERE user_id = ? AND track_id IN (SELECT value FROM json_each(?))").all(owner.id, JSON.stringify(ids))
      : [];
    const byTrack = new Map();
    for (const v of variants) byTrack.set(v.track_id, [...(byTrack.get(v.track_id) || []), { variant: v.variant, count: v.count }]);
    return {
      total: page.total,
      items: page.items.filter((t) => t.rarity !== 'promo').map((t) => ({ trackId: t.id, rarity: t.rarity, variants: byTrack.get(t.id) || [] })),
      catalog: deps.refs({ trackIds: ids }),
    };
  }

  function proposeTrade(userId, body = {}) {
    const other = friendOf(userId, body.to);
    const give = trackOf(body.give?.trackId);
    const want = trackOf(body.want?.trackId);
    const giveVariant = variantOf(body.give?.variant);
    const wantVariant = variantOf(body.want?.variant);
    if (give.rarity === 'promo' || want.rarity === 'promo') throw new HttpError(400, 'promo_not_tradable');
    if (give.rarity !== want.rarity) throw new HttpError(409, 'rarity_mismatch', { give: give.rarity, want: want.rarity });
    if (give.id === want.id && giveVariant === wantVariant) throw new HttpError(409, 'same_card');
    return atomic(() => {
      if (!copies(userId, give.id, giveVariant)) throw new HttpError(409, 'not_owned');
      if (!copies(other.id, want.id, wantVariant)) throw new HttpError(409, 'friend_not_owner');
      if (q("SELECT COUNT(*) AS n FROM trades WHERE from_id = ? AND status = 'pending'").get(userId).n >= MAX_PENDING_TRADES) {
        throw new HttpError(409, 'too_many_trades', { max: MAX_PENDING_TRADES });
      }
      const now = Date.now();
      const { lastInsertRowid } = q(`INSERT INTO trades (from_id, to_id, give_track, give_variant, want_track, want_variant, rarity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, other.id, give.id, giveVariant, want.id, wantVariant, give.rarity, now);
      const id = Number(lastInsertRowid);
      later(() => notify(other.id, 'trade_offer', { actorId: userId, targetType: 'track', targetId: want.id, data: { itemType: 'track', itemId: want.id, tradeId: id } }));
      return { trade: tradeView(tradeRow(id)) };
    });
  }

  function decide(userId, rawId, action) {
    const id = intOf(rawId, 'id');
    return atomic(() => {
      const t = tradeRow(id);
      const mineToAnswer = t && t.to_id === userId;
      const mineToCancel = t && t.from_id === userId;
      if (!t || (action === 'cancel' ? !mineToCancel : !mineToAnswer)) throw new HttpError(404, 'unknown_trade');
      if (t.status !== 'pending') throw new HttpError(409, 'trade_closed');
      const now = Date.now();
      if (action !== 'accept') {
        q('UPDATE trades SET status = ?, decided_at = ? WHERE id = ?').run(action === 'cancel' ? 'cancelled' : 'declined', now, id);
        if (action === 'decline') later(() => notify(t.from_id, 'trade_declined', { actorId: userId, targetType: 'track', targetId: t.give_track, data: { itemType: 'track', itemId: t.give_track, tradeId: id } }));
        return { trade: tradeView(tradeRow(id)) };
      }
      if (!isFriend(t.from_id, t.to_id)) throw new HttpError(409, 'not_friends');
      // Les deux cartes doivent encore être là ; sinon l'échange échoue sans rien toucher.
      if (!copies(t.from_id, t.give_track, t.give_variant) || !copies(t.to_id, t.want_track, t.want_variant)) {
        q("UPDATE trades SET status = 'failed', decided_at = ? WHERE id = ?").run(now, id);
        return { trade: tradeView(tradeRow(id)), failed: true };
      }
      takeCard(t.from_id, t.give_track, t.give_variant);
      takeCard(t.to_id, t.want_track, t.want_variant);
      giveCard(t.to_id, t.give_track, t.give_variant, 'trade');
      giveCard(t.from_id, t.want_track, t.want_variant, 'trade');
      q("UPDATE trades SET status = 'accepted', decided_at = ? WHERE id = ?").run(now, id);
      later(() => notify(t.from_id, 'trade_accepted', { actorId: userId, targetType: 'track', targetId: t.want_track, data: { itemType: 'track', itemId: t.want_track, tradeId: id } }));
      return { trade: tradeView(tradeRow(id)), cardCounts: services.cardCounts(userId, [t.give_track, t.want_track]) };
    });
  }

  // Clôture des ventes chaque minute (et à chaque lecture des enchères), même si personne ne regarde.
  if (!config.isTest) {
    setInterval(() => {
      try {
        settle();
      } catch {
        // base occupée : la minute suivante reprendra
      }
    }, 60_000).unref?.();
  }

  return { listAuctions, createAuction, bid, cancelAuction, settle, listTrades, tradeCards, proposeTrade, decide };
}

export function routes(r, deps) {
  const { limits, services } = deps;
  const api = () => deps.market;
  const partial = (req) => services.state(req.user.id, { partial: true });

  r.get('/auctions', limits.read, (req, res) => res.json(api().listAuctions(req.user.id, req.query)));
  r.post('/auctions', limits.write, (req, res) => res.json({ ...api().createAuction(req.user.id, req.body), state: partial(req) }));
  r.post('/auctions/:id/bid', limits.write, (req, res) => res.json({ ...api().bid(req.user.id, req.params.id, req.body.amount), state: partial(req) }));
  r.post('/auctions/:id/cancel', limits.write, (req, res) => res.json({ ...api().cancelAuction(req.user.id, req.params.id), state: partial(req) }));
  r.get('/trades', limits.read, (req, res) => res.json(api().listTrades(req.user.id)));
  r.get('/trades/cards', limits.read, (req, res) => res.json(api().tradeCards(req.user.id, req.query)));
  r.post('/trades', limits.write, (req, res) => res.json(api().proposeTrade(req.user.id, req.body)));
  for (const action of ['accept', 'decline', 'cancel']) {
    r.post(`/trades/:id/${action}`, limits.write, (req, res) => res.json({ ...api().decide(req.user.id, req.params.id, action), state: partial(req) }));
  }
}

export const jobs = [
  // Filet de nuit : ventes arrivées à leur terme (la clôture tourne aussi chaque minute et à chaque lecture).
  { name: 'auctions-settle', run: (deps) => deps.market.settle() },
];
