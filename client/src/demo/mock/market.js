// Jumeau de démo du module « market » (server/market.js) : enchères et échanges, mêmes routes et mêmes formes.
// Les joueurs fictifs animent la démo : ils mettent des cartes en vente, enchérissent sur celles du joueur, acceptent ses
// propositions d'échange (quelques secondes plus tard) et lui en font une s'il a des amis fictifs.
import { notify } from './notifications.js';

export const name = 'market';

const HOURS = [1, 6, 24, 72];
const PAGE = 24;
const HOUR = 3_600_000;
const BOT_AUCTIONS = 8;
const nextBid = (a) => (a.bid == null ? a.startPrice : a.bid + Math.max(5, Math.ceil(a.bid * 0.05)));

const idOf = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);
const bots = (ctx) => ctx.db.users.filter((u) => u.bot);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function copies(ctx, uid, trackId, variant) {
  return ctx.collection.cardsOf(uid)[`${trackId}|${variant}`]?.count || 0;
}
function takeCard(ctx, uid, trackId, variant) {
  const mine = ctx.collection.cardsOf(uid);
  const key = `${trackId}|${variant}`;
  if (!mine[key]?.count) return false;
  mine[key].count -= 1;
  if (mine[key].count <= 0) delete mine[key];
  return true;
}
const giveCard = (ctx, uid, trackId, variant, source) => ctx.collection.addCards(uid, [{ trackId, variant }], source);
const isFriend = (ctx, a, b) => ctx.db.friendships.some((f) => f.status === 'accepted' && ((f.requester === a && f.addressee === b) || (f.requester === b && f.addressee === a)));

// ----- enchères ---------------------------------------------------------------------------------------------

function view(a, me) {
  return {
    id: a.id, trackId: a.trackId, variant: a.variant, rarity: a.rarity, startPrice: a.startPrice, bid: a.bid, bids: a.bids,
    nextBid: nextBid(a), endsAt: a.endsAt, status: a.status, sellerId: a.sellerId, mine: a.sellerId === me, leading: a.bidderId === me,
  };
}

/** Ventes des joueurs fictifs : de quoi remplir l'onglet « En cours ». */
function stockBots(ctx) {
  const db = ctx.db;
  const open = db.auctions.filter((a) => a.status === 'open' && ctx.userById(a.sellerId)?.bot).length;
  for (let i = open; i < BOT_AUCTIONS; i++) {
    const bot = pick(bots(ctx));
    if (!bot) return;
    const keys = Object.keys(ctx.collection.cardsOf(bot.id));
    if (!keys.length) continue;
    const [trackId, variant] = pick(keys).split('|');
    const track = ctx.TRACK.get(trackId);
    if (!track || !takeCard(ctx, bot.id, trackId, variant)) continue;
    const base = { common: 20, uncommon: 40, rare: 90, super: 180, ultra: 400, legendary: 900, promo: 300 }[track.rarity] || 50;
    db.auctions.push({
      id: db.auctionSeq++, sellerId: bot.id, trackId, variant, rarity: track.rarity, startPrice: base, bid: null, bidderId: null, bids: 0,
      endsAt: Date.now() + pick(HOURS) * HOUR * (0.3 + Math.random() * 0.7), status: 'open', createdAt: Date.now(), bidders: [],
    });
  }
}

/** Les joueurs fictifs enchérissent de temps en temps sur les ventes du joueur. */
function botBids(ctx, me) {
  for (const a of ctx.db.auctions) {
    if (a.status !== 'open' || a.sellerId !== me || a.endsAt <= Date.now()) continue;
    if (Date.now() - (a.lastBidAt || a.createdAt) < 6000 || Math.random() > 0.5) continue;
    const bot = pick(bots(ctx).filter((b) => b.id !== a.bidderId));
    if (!bot) continue;
    a.bid = nextBid(a);
    a.bidderId = bot.id;
    a.bids += 1;
    a.lastBidAt = Date.now();
  }
}

function settle(ctx) {
  const db = ctx.db;
  for (const a of db.auctions) {
    if (a.status !== 'open' || a.endsAt > Date.now()) continue;
    const data = { itemType: 'track', itemId: a.trackId, auctionId: a.id, price: a.bid };
    if (a.bidderId) {
      giveCard(ctx, a.bidderId, a.trackId, a.variant, 'auction');
      const seller = ctx.userById(a.sellerId);
      if (seller) seller.royalties += a.bid;
      a.status = 'sold';
      notify(db, a.bidderId, 'auction_won', { targetType: 'track', targetId: a.trackId, data });
      notify(db, a.sellerId, 'auction_sold', { targetType: 'track', targetId: a.trackId, data });
    } else {
      giveCard(ctx, a.sellerId, a.trackId, a.variant, 'auction');
      a.status = 'unsold';
      notify(db, a.sellerId, 'auction_unsold', { targetType: 'track', targetId: a.trackId, data });
    }
    a.settledAt = Date.now();
  }
}

function list(ctx, query) {
  const u = ctx.me();
  settle(ctx);
  stockBots(ctx);
  botBids(ctx, u.id);
  const tab = query.get('tab') || 'open';
  const rarity = query.get('rarity');
  const off = Math.max(0, Number(query.get('offset')) || 0);
  let rows = ctx.db.auctions;
  if (tab === 'mine') rows = rows.filter((a) => a.sellerId === u.id).sort((x, y) => (x.status === 'open' ? 0 : 1) - (y.status === 'open' ? 0 : 1) || y.endsAt - x.endsAt);
  else if (tab === 'bids') rows = rows.filter((a) => a.status === 'open' && a.bidders.includes(u.id)).sort((x, y) => x.endsAt - y.endsAt);
  else rows = rows.filter((a) => a.status === 'open' && a.sellerId !== u.id).sort((x, y) => x.endsAt - y.endsAt);
  if (rarity) rows = rows.filter((a) => a.rarity === rarity);
  const items = rows.slice(off, off + PAGE).map((a) => view(a, u.id));
  const sellers = ctx.summaries(items.map((a) => a.sellerId));
  return {
    items: items.map((a) => ({ ...a, seller: sellers.get(a.sellerId) || null })),
    nextOffset: rows.length > off + PAGE ? off + PAGE : null,
    catalog: ctx.refs({ trackIds: items.map((a) => a.trackId) }),
  };
}

function create(ctx, body) {
  const u = ctx.me();
  const track = ctx.TRACK.get(idOf(body.trackId));
  if (!track) ctx.fail(404, 'unknown_track');
  const variant = body.variant === 'holo' ? 'holo' : 'std';
  const price = Number(body.startPrice);
  if (!Number.isInteger(price) || price < 10 || price > 1_000_000) ctx.fail(400, 'invalid_price', { min: 10, max: 1_000_000 });
  const hours = Number(body.hours ?? 24);
  if (!HOURS.includes(hours)) ctx.fail(400, 'invalid_input', { field: 'hours' });
  if (ctx.db.auctions.filter((a) => a.sellerId === u.id && a.status === 'open').length >= 10) ctx.fail(409, 'too_many_auctions', { max: 10 });
  if (!takeCard(ctx, u.id, track.id, variant)) ctx.fail(409, 'not_owned');
  const a = {
    id: ctx.db.auctionSeq++, sellerId: u.id, trackId: track.id, variant, rarity: track.rarity, startPrice: price, bid: null, bidderId: null, bids: 0,
    endsAt: Date.now() + hours * HOUR, status: 'open', createdAt: Date.now(), bidders: [],
  };
  ctx.db.auctions.push(a);
  return { auction: view(a, u.id), state: ctx.partialState() };
}

function bid(ctx, rawId, body) {
  const u = ctx.me();
  settle(ctx);
  const a = ctx.db.auctions.find((x) => x.id === Number(rawId));
  if (!a) ctx.fail(404, 'unknown_auction');
  if (a.status !== 'open' || a.endsAt <= Date.now()) ctx.fail(409, 'auction_closed');
  if (a.sellerId === u.id) ctx.fail(409, 'own_auction');
  if (a.bidderId === u.id) ctx.fail(409, 'already_leading');
  const amount = Number(body.amount);
  const min = nextBid(a);
  if (!Number.isInteger(amount) || amount < min) ctx.fail(409, 'bid_too_low', { min });
  if (u.royalties < amount) ctx.fail(409, 'not_enough_royalties', { cost: amount });
  u.royalties -= amount;
  const previous = a.bidderId ? ctx.userById(a.bidderId) : null;
  if (previous) previous.royalties += a.bid;
  a.bid = amount;
  a.bidderId = u.id;
  a.bids += 1;
  a.lastBidAt = Date.now();
  a.endsAt = Math.max(a.endsAt, Date.now() + 2 * 60_000);
  if (!a.bidders.includes(u.id)) a.bidders.push(u.id);
  return { auction: view(a, u.id), state: ctx.partialState() };
}

function cancel(ctx, rawId) {
  const u = ctx.me();
  const a = ctx.db.auctions.find((x) => x.id === Number(rawId) && x.sellerId === u.id);
  if (!a) ctx.fail(404, 'unknown_auction');
  if (a.status !== 'open') ctx.fail(409, 'auction_closed');
  if (a.bids > 0) ctx.fail(409, 'auction_has_bids');
  a.status = 'cancelled';
  a.settledAt = Date.now();
  giveCard(ctx, u.id, a.trackId, a.variant, 'auction');
  return { auction: view(a, u.id), state: ctx.partialState() };
}

// ----- échanges ---------------------------------------------------------------------------------------------

const tradeView = (t) => ({
  id: t.id, fromId: t.fromId, toId: t.toId, give: t.give, want: t.want, rarity: t.rarity, status: t.status, createdAt: t.createdAt, decidedAt: t.decidedAt || null,
});

function swap(ctx, t) {
  if (!copies(ctx, t.fromId, t.give.trackId, t.give.variant) || !copies(ctx, t.toId, t.want.trackId, t.want.variant)) {
    t.status = 'failed';
    t.decidedAt = Date.now();
    return false;
  }
  takeCard(ctx, t.fromId, t.give.trackId, t.give.variant);
  takeCard(ctx, t.toId, t.want.trackId, t.want.variant);
  giveCard(ctx, t.toId, t.give.trackId, t.give.variant, 'trade');
  giveCard(ctx, t.fromId, t.want.trackId, t.want.variant, 'trade');
  t.status = 'accepted';
  t.decidedAt = Date.now();
  return true;
}

/** Joueurs fictifs : ils acceptent les propositions du joueur et lui en font une, une fois, s'il en a pour amis. */
function botTrades(ctx, me) {
  const db = ctx.db;
  for (const t of db.trades) {
    if (t.status === 'pending' && t.fromId === me && ctx.userById(t.toId)?.bot && Date.now() - t.createdAt > 3000) {
      if (swap(ctx, t)) notify(db, me, 'trade_accepted', { actorId: t.toId, targetType: 'track', targetId: t.want.trackId, data: { itemType: 'track', itemId: t.want.trackId, tradeId: t.id } });
    }
  }
  const u = ctx.userById(me);
  if (!u || u.botTradeOffered) return;
  const friend = bots(ctx).find((b) => isFriend(ctx, me, b.id));
  if (!friend) return;
  const mine = Object.keys(ctx.collection.cardsOf(me)).map((k) => k.split('|')).map(([trackId, variant]) => ({ trackId, variant, track: ctx.TRACK.get(trackId) }))
    .filter((c) => c.track && c.track.rarity !== 'promo');
  const theirs = Object.keys(ctx.collection.cardsOf(friend.id)).map((k) => k.split('|')).map(([trackId, variant]) => ({ trackId, variant, track: ctx.TRACK.get(trackId) }))
    .filter((c) => c.track && c.track.rarity !== 'promo');
  for (const w of mine) {
    const g = theirs.find((c) => c.track.rarity === w.track.rarity && !copies(ctx, me, c.trackId, c.variant));
    if (!g) continue;
    const t = {
      id: db.tradeSeq++, fromId: friend.id, toId: me, give: { trackId: g.trackId, variant: g.variant }, want: { trackId: w.trackId, variant: w.variant },
      rarity: g.track.rarity, status: 'pending', createdAt: Date.now(),
    };
    db.trades.push(t);
    u.botTradeOffered = true;
    notify(db, me, 'trade_offer', { actorId: friend.id, targetType: 'track', targetId: w.trackId, data: { itemType: 'track', itemId: w.trackId, tradeId: t.id } });
    return;
  }
}

function trades(ctx) {
  const u = ctx.me();
  botTrades(ctx, u.id);
  const all = ctx.db.trades.filter((t) => t.fromId === u.id || t.toId === u.id).sort((a, b) => (b.decidedAt || b.createdAt) - (a.decidedAt || a.createdAt)).map(tradeView);
  const users = ctx.summaries(all.flatMap((t) => [t.fromId, t.toId]));
  const withUsers = (t) => ({ ...t, from: users.get(t.fromId) || null, to: users.get(t.toId) || null });
  return {
    incoming: all.filter((t) => t.status === 'pending' && t.toId === u.id).map(withUsers),
    outgoing: all.filter((t) => t.status === 'pending' && t.fromId === u.id).map(withUsers),
    history: all.filter((t) => t.status !== 'pending').slice(0, 20).map(withUsers),
    catalog: ctx.refs({ trackIds: all.flatMap((t) => [t.give.trackId, t.want.trackId]) }),
  };
}

function friendByName(ctx, me, raw) {
  const other = ctx.userByName(raw);
  if (!other || other.id === me || !isFriend(ctx, me, other.id)) ctx.fail(404, 'friend_not_found');
  return other;
}

function tradeCards(ctx, query) {
  const u = ctx.me();
  const owner = query.get('user') ? friendByName(ctx, u.id, query.get('user')) : u;
  const rarity = query.get('rarity');
  const text = String(query.get('q') || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const byTrack = new Map();
  for (const [key, c] of Object.entries(ctx.collection.cardsOf(owner.id))) {
    const [trackId, variant] = key.split('|');
    const track = ctx.TRACK.get(trackId);
    if (!track || track.rarity === 'promo' || (rarity && track.rarity !== rarity)) continue;
    if (text && !`${track.title} ${track.artist} ${track.album || ''}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(text)) continue;
    if (!byTrack.has(trackId)) byTrack.set(trackId, { trackId, rarity: track.rarity, variants: [] });
    byTrack.get(trackId).variants.push({ variant, count: c.count });
  }
  const items = [...byTrack.values()].slice(0, 48);
  return { total: byTrack.size, items, catalog: ctx.refs({ trackIds: items.map((c) => c.trackId) }) };
}

function propose(ctx, body) {
  const u = ctx.me();
  const other = friendByName(ctx, u.id, body.to);
  const give = ctx.TRACK.get(idOf(body.give?.trackId));
  const want = ctx.TRACK.get(idOf(body.want?.trackId));
  if (!give || !want) ctx.fail(404, 'unknown_track');
  const gv = body.give?.variant === 'holo' ? 'holo' : 'std';
  const wv = body.want?.variant === 'holo' ? 'holo' : 'std';
  if (give.rarity === 'promo' || want.rarity === 'promo') ctx.fail(400, 'promo_not_tradable');
  if (give.rarity !== want.rarity) ctx.fail(409, 'rarity_mismatch', { give: give.rarity, want: want.rarity });
  if (!copies(ctx, u.id, give.id, gv)) ctx.fail(409, 'not_owned');
  if (!copies(ctx, other.id, want.id, wv)) ctx.fail(409, 'friend_not_owner');
  const t = { id: ctx.db.tradeSeq++, fromId: u.id, toId: other.id, give: { trackId: give.id, variant: gv }, want: { trackId: want.id, variant: wv }, rarity: give.rarity, status: 'pending', createdAt: Date.now() };
  ctx.db.trades.push(t);
  return { trade: tradeView(t) };
}

function decide(ctx, rawId, action) {
  const u = ctx.me();
  const t = ctx.db.trades.find((x) => x.id === Number(rawId));
  if (!t || (action === 'cancel' ? t.fromId !== u.id : t.toId !== u.id)) ctx.fail(404, 'unknown_trade');
  if (t.status !== 'pending') ctx.fail(409, 'trade_closed');
  if (action !== 'accept') {
    t.status = action === 'cancel' ? 'cancelled' : 'declined';
    t.decidedAt = Date.now();
    return { trade: tradeView(t), state: ctx.partialState() };
  }
  const ok = swap(ctx, t);
  return { trade: tradeView(t), ...(ok ? {} : { failed: true }), state: ctx.partialState() };
}

export const routes = [
  ['GET', /^\/auctions$/, ({ query, ctx }) => list(ctx, query)],
  ['POST', /^\/auctions$/, ({ body, ctx }) => create(ctx, body)],
  ['POST', /^\/auctions\/(\d+)\/bid$/, ({ params, body, ctx }) => bid(ctx, params[0], body)],
  ['POST', /^\/auctions\/(\d+)\/cancel$/, ({ params, ctx }) => cancel(ctx, params[0])],
  ['GET', /^\/trades$/, ({ ctx }) => trades(ctx)],
  ['GET', /^\/trades\/cards$/, ({ query, ctx }) => tradeCards(ctx, query)],
  ['POST', /^\/trades$/, ({ body, ctx }) => propose(ctx, body)],
  ['POST', /^\/trades\/(\d+)\/(accept|decline|cancel)$/, ({ params, ctx }) => decide(ctx, params[0], params[1])],
];

export function migrate(db) {
  if (!Array.isArray(db.auctions)) db.auctions = [];
  if (!Array.isArray(db.trades)) db.trades = [];
  db.auctionSeq ||= 1;
  db.tradeSeq ||= 1;
}

export function seed(db) {
  migrate(db);
}
