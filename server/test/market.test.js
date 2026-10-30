// Enchères et échanges de cartes (server/market.js) : séquestre de la carte et des royalties, offres et surenchères,
// clôture (vendue, invendue), retrait ; échanges entre amis à rareté égale seulement, refus, annulation, échec quand une
// carte a disparu ; aucune XP ni royalties pour une carte reçue ainsi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';
import { staticCatalog } from '../../shared/staticCatalog.js';

const app = await startApp();
test.after(() => app.close());
const { db, deps, services } = app;

const cardOf = (userId, trackId, variant = 'std') => db.prepare('SELECT count FROM cards WHERE user_id = ? AND track_id = ? AND variant = ?').get(userId, trackId, variant)?.count ?? 0;
const royaltiesOf = (userId) => db.prepare('SELECT royalties FROM users WHERE id = ?').get(userId).royalties;
const xpOf = (userId) => db.prepare('SELECT xp FROM users WHERE id = ?').get(userId).xp;
const setRoyalties = (userId, n) => db.prepare('UPDATE users SET royalties = ? WHERE id = ?').run(n, userId);
const give = (userId, trackId, variant = 'std') => services.atomic(() => services.addCards(services.getUser(userId), [{ trackId, variant }], 'test'));
const byRarity = (rarity) => staticCatalog.searchAlbums({ limit: 100 }).items.flatMap((a) => staticCatalog.albumTracks(a.id)).filter((t) => t.rarity === rarity);

async function friends(a, b) {
  await api(app.base, a.cookie, 'POST', '/friends/request', { username: b.user.username });
  const pending = (await api(app.base, b.cookie, 'GET', '/friends')).body;
  const req = (pending.incoming || pending.requests || []).find((r) => (r.user?.id ?? r.id) === a.user.id) || (pending.incoming || pending.requests || [])[0];
  const id = req?.requestId ?? req?.id;
  await api(app.base, b.cookie, 'POST', `/friends/${id}/accept`);
}

test('enchères : mise en vente (séquestre), offres, surenchère remboursée, vente close au meilleur offrant', async () => {
  const sam = await signupVerified(app, { username: 'enc_sam' });
  const lea = await signupVerified(app, { username: 'enc_lea' });
  const max = await signupVerified(app, { username: 'enc_max' });
  const track = byRarity('legendary')[0] || byRarity('ultra')[0];
  give(sam.user.id, track.id);
  const res = await api(app.base, sam.cookie, 'POST', '/auctions', { trackId: track.id, startPrice: 100, hours: 1 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const id = res.body.auction.id;
  assert.equal(cardOf(sam.user.id, track.id), 0, 'la carte quitte la collection pendant la vente');
  assert.equal(res.body.auction.nextBid, 100);
  // Pas deux fois la même carte, pas sa propre vente, pas sous la mise à prix, pas sans royalties.
  assert.equal((await api(app.base, sam.cookie, 'POST', '/auctions', { trackId: track.id, startPrice: 100, hours: 1 })).body.error, 'not_owned');
  assert.equal((await api(app.base, sam.cookie, 'POST', `/auctions/${id}/bid`, { amount: 500 })).body.error, 'own_auction');
  setRoyalties(lea.user.id, 1000);
  setRoyalties(max.user.id, 50);
  assert.equal((await api(app.base, lea.cookie, 'POST', `/auctions/${id}/bid`, { amount: 99 })).body.error, 'bid_too_low');
  assert.equal((await api(app.base, max.cookie, 'POST', `/auctions/${id}/bid`, { amount: 100 })).body.error, 'not_enough_royalties');
  // Léa offre 100 (retenues), Max surenchérit à 120 : Léa est remboursée.
  assert.equal((await api(app.base, lea.cookie, 'POST', `/auctions/${id}/bid`, { amount: 100 })).status, 200);
  assert.equal(royaltiesOf(lea.user.id), 900);
  setRoyalties(max.user.id, 500);
  const outbid = await api(app.base, max.cookie, 'POST', `/auctions/${id}/bid`, { amount: 104 });
  assert.equal(outbid.body.error, 'bid_too_low', 'au moins + 5 royalties');
  assert.equal((await api(app.base, max.cookie, 'POST', `/auctions/${id}/bid`, { amount: 120 })).status, 200);
  assert.equal(royaltiesOf(lea.user.id), 1000, 'offre dépassée rendue');
  assert.equal(royaltiesOf(max.user.id), 380);
  assert.equal((await api(app.base, sam.cookie, 'POST', `/auctions/${id}/cancel`)).body.error, 'auction_has_bids');
  // Listes : les ventes des autres, mes ventes, mes offres.
  const open = (await api(app.base, lea.cookie, 'GET', '/auctions')).body;
  assert.ok(open.items.some((a) => a.id === id && a.bid === 120 && a.seller.username === 'enc_sam'));
  assert.ok(open.catalog.tracks.some((t) => t.id === track.id));
  assert.ok((await api(app.base, sam.cookie, 'GET', '/auctions?tab=mine')).body.items.some((a) => a.id === id && a.mine));
  assert.ok((await api(app.base, max.cookie, 'GET', '/auctions?tab=bids')).body.items.some((a) => a.id === id && a.leading));
  // Clôture : la carte va à Max (sans XP ni royalties de nouvelle carte), les 120 royalties à Sam.
  const samBefore = royaltiesOf(sam.user.id);
  const maxXp = xpOf(max.user.id);
  db.prepare('UPDATE auctions SET ends_at = ? WHERE id = ?').run(Date.now() - 1, id);
  assert.equal(deps.market.settle(), 1);
  assert.equal(cardOf(max.user.id, track.id), 1);
  assert.equal(royaltiesOf(sam.user.id), samBefore + 120);
  assert.equal(royaltiesOf(max.user.id), 380, 'pas de royalties de nouvelle carte');
  assert.equal(xpOf(max.user.id), maxXp, 'pas d’XP pour une carte achetée');
  assert.equal(db.prepare('SELECT status FROM auctions WHERE id = ?').get(id).status, 'sold');
  assert.equal(deps.market.settle(), 0, 'rien à refaire');
});

test('enchères : invendue (la carte revient), retrait sans offre, durées et prix contrôlés', async () => {
  const zoe = await signupVerified(app, { username: 'enc_zoe' });
  const [a, b] = byRarity('rare');
  give(zoe.user.id, a.id);
  give(zoe.user.id, b.id);
  assert.equal((await api(app.base, zoe.cookie, 'POST', '/auctions', { trackId: a.id, startPrice: 5, hours: 1 })).body.error, 'invalid_price');
  assert.equal((await api(app.base, zoe.cookie, 'POST', '/auctions', { trackId: a.id, startPrice: 50, hours: 5 })).body.error, 'invalid_input');
  const first = (await api(app.base, zoe.cookie, 'POST', '/auctions', { trackId: a.id, startPrice: 50, hours: 6 })).body.auction;
  db.prepare('UPDATE auctions SET ends_at = ? WHERE id = ?').run(Date.now() - 1, first.id);
  deps.market.settle();
  assert.equal(cardOf(zoe.user.id, a.id), 1, 'invendue : la carte revient');
  const second = (await api(app.base, zoe.cookie, 'POST', '/auctions', { trackId: b.id, startPrice: 50, hours: 24 })).body.auction;
  const cancelled = await api(app.base, zoe.cookie, 'POST', `/auctions/${second.id}/cancel`);
  assert.equal(cancelled.status, 200);
  assert.equal(cardOf(zoe.user.id, b.id), 1, 'retirée : la carte revient');
});

test('échanges : entre amis seulement, même rareté, acceptation qui échange les deux cartes sans XP', async () => {
  const ana = await signupVerified(app, { username: 'ech_ana' });
  const ben = await signupVerified(app, { username: 'ech_ben' });
  const stranger = await signupVerified(app, { username: 'ech_tom' });
  const [l1, l2] = byRarity('rare');
  const common = byRarity('common')[0] || byRarity('uncommon')[0];
  give(ana.user.id, l1.id);
  give(ben.user.id, l2.id);
  give(ben.user.id, common.id);
  const offer = { to: 'ech_ben', give: { trackId: l1.id }, want: { trackId: l2.id } };
  assert.equal((await api(app.base, ana.cookie, 'POST', '/trades', offer)).body.error, 'friend_not_found', 'pas encore amis');
  await friends(ana, ben);
  assert.equal((await api(app.base, ana.cookie, 'POST', '/trades', { ...offer, want: { trackId: common.id } })).body.error, 'rarity_mismatch');
  assert.equal((await api(app.base, ana.cookie, 'POST', '/trades', { ...offer, to: 'ech_tom' })).body.error, 'friend_not_found');
  // Cartes de l'ami pour composer l'échange : filtre par rareté.
  const cards = (await api(app.base, ana.cookie, 'GET', `/trades/cards?user=ech_ben&rarity=${l2.rarity}`)).body;
  assert.ok(cards.items.some((c) => c.trackId === l2.id) && cards.items.every((c) => c.rarity === l2.rarity));
  assert.equal((await api(app.base, stranger.cookie, 'GET', '/trades/cards?user=ech_ben')).body.error, 'friend_not_found');
  const sent = await api(app.base, ana.cookie, 'POST', '/trades', offer);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const id = sent.body.trade.id;
  const inbox = (await api(app.base, ben.cookie, 'GET', '/trades')).body;
  assert.ok(inbox.incoming.some((t) => t.id === id && t.from.username === 'ech_ana'));
  assert.equal((await api(app.base, ana.cookie, 'POST', `/trades/${id}/accept`)).body.error, 'unknown_trade', 'seul le destinataire accepte');
  const xpA = xpOf(ana.user.id);
  const xpB = xpOf(ben.user.id);
  const done = await api(app.base, ben.cookie, 'POST', `/trades/${id}/accept`);
  assert.equal(done.status, 200);
  assert.equal(done.body.trade.status, 'accepted');
  assert.equal(cardOf(ana.user.id, l1.id), 0);
  assert.equal(cardOf(ana.user.id, l2.id), 1);
  assert.equal(cardOf(ben.user.id, l1.id), 1);
  assert.equal(cardOf(ben.user.id, l2.id), 0);
  assert.equal(xpOf(ana.user.id), xpA, 'pas d’XP par échange');
  assert.equal(xpOf(ben.user.id), xpB);
  assert.equal((await api(app.base, ben.cookie, 'POST', `/trades/${id}/accept`)).body.error, 'trade_closed');
});

test('échanges : refus, annulation, échec si une carte a disparu entre-temps', async () => {
  const eva = await signupVerified(app, { username: 'ech_eva' });
  const lou = await signupVerified(app, { username: 'ech_lou' });
  await friends(eva, lou);
  const [x, y] = byRarity('super').length >= 2 ? byRarity('super') : byRarity('rare').slice(2);
  give(eva.user.id, x.id);
  give(lou.user.id, y.id);
  const offer = { to: 'ech_lou', give: { trackId: x.id }, want: { trackId: y.id } };
  const t1 = (await api(app.base, eva.cookie, 'POST', '/trades', offer)).body.trade;
  assert.equal((await api(app.base, lou.cookie, 'POST', `/trades/${t1.id}/decline`)).body.trade.status, 'declined');
  const t2 = (await api(app.base, eva.cookie, 'POST', '/trades', offer)).body.trade;
  assert.equal((await api(app.base, eva.cookie, 'POST', `/trades/${t2.id}/cancel`)).body.trade.status, 'cancelled');
  const t3 = (await api(app.base, eva.cookie, 'POST', '/trades', offer)).body.trade;
  db.prepare('DELETE FROM cards WHERE user_id = ? AND track_id = ?').run(lou.user.id, y.id);
  const failed = await api(app.base, lou.cookie, 'POST', `/trades/${t3.id}/accept`);
  assert.equal(failed.body.failed, true);
  assert.equal(failed.body.trade.status, 'failed');
  assert.equal(cardOf(eva.user.id, x.id), 1, 'rien n’a bougé');
});
