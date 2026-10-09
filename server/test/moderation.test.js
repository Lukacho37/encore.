// Sécurité (PLAN.md 4.1.6, chantier P0-F) : signalement → décision motivée → auteur prévenu → contestation → annulation ;
// blocages (critiques masquées dans les deux sens, demandes d'ami refusées) ; suspension (écritures refusées, export
// permis) ; espace admin réservé à ADMIN_EMAILS même avec role = 'admin' en base ; politique des liens ; formulaire
// public ; retrait de pochette ; journal ; récidive ; nettoyage de ce qui pointe vers un contenu supprimé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';

process.env.ADMIN_EMAILS = 'modo@example.com';

const app = await startApp();
test.after(() => app.close());
const { db, deps } = app;

const admin = await signupVerified(app, { username: 'patronne', email: 'modo@example.com' });
const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
const enc = encodeURIComponent;
let counter = 0;
const player = (prefix = 'j') => signupVerified(app, { username: `${prefix}${++counter}_mod` });
/** Critique de `who` sur un album ; renvoie l'identifiant de la note (= de la critique). */
async function review(who, albumId, text, score = 7) {
  const r = await call(who, 'PUT', `/ratings/album/${albumId}`, { score, review: text });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.mine.id;
}
const reviewsSeenBy = async (who, albumId) => {
  const r = await call(who, 'GET', `/ratings/album/${albumId}`);
  return [...r.body.friends.reviews, ...r.body.community.reviews].map((x) => x.id);
};
const notifs = async (who) => (await call(who, 'GET', '/notifications')).body.items;

test('signalement → décision (masquer) → auteur prévenu avec l’exposé des motifs → contestation → annulation', async () => {
  const alice = await player('alice');
  const bob = await player('bob');
  const rid = await review(alice, 'discovery', 'Une critique un peu vive sur Discovery');

  // Erreurs du signalement.
  assert.equal((await call(bob, 'POST', '/reports', { targetType: 'review', targetId: 999999, reason: 'spam' })).body.error, 'not_found');
  assert.equal((await call(bob, 'POST', '/reports', { targetType: 'review', targetId: rid, reason: 'nope' })).body.error, 'invalid_input');
  assert.equal((await call(alice, 'POST', '/reports', { targetType: 'review', targetId: rid, reason: 'spam' })).body.error, 'cannot_report_self');
  const sent = await call(bob, 'POST', '/reports', { targetType: 'review', targetId: rid, reason: 'harassment', details: 'Insultant.' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal((await call(bob, 'POST', '/reports', { targetType: 'review', targetId: rid, reason: 'spam' })).body.error, 'already_reported');

  // La file de l'admin : copie du contenu, auteur, auteur du signalement, compteurs.
  const queue = await call(admin, 'GET', '/admin/reports?status=open');
  assert.equal(queue.status, 200);
  const item = queue.body.items.find((i) => i.report.id === sent.body.id);
  assert.ok(item, 'signalement dans la file');
  assert.equal(item.snapshot.text, 'Une critique un peu vive sur Discovery');
  assert.equal(item.snapshot.itemId, 'discovery');
  assert.equal(item.author.username, alice.username);
  assert.equal(item.reporter.username, bob.username);
  assert.equal(item.report.reason, 'harassment');
  assert.equal(item.report.sameTarget, 1);
  assert.ok(queue.body.counts.open >= 1);
  assert.ok(queue.body.catalog.albums.some((a) => a.id === 'discovery'), 'album de la critique dans les références');

  // Décision : motif et exposé des motifs obligatoires.
  assert.equal((await call(admin, 'POST', `/admin/reports/${sent.body.id}/decision`, { action: 'hide', ground: 'rules:harassment' })).body.error, 'statement_required');
  assert.equal((await call(admin, 'POST', `/admin/reports/${sent.body.id}/decision`, { action: 'hide', ground: 'n’importe quoi', statement: 'x' })).body.error, 'invalid_ground');
  const statement = 'Ta critique contient des propos insultants envers d’autres membres (règle 2 : respect).';
  const decided = await call(admin, 'POST', `/admin/reports/${sent.body.id}/decision`, { action: 'hide', ground: 'rules:harassment', statement });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));
  assert.equal(decided.body.report.status, 'actioned');
  assert.equal(decided.body.action.action, 'hide');
  assert.equal((await call(admin, 'POST', `/admin/reports/${sent.body.id}/decision`, { action: 'dismiss' })).body.error, 'already_decided');

  // La critique est masquée pour les autres, visible de son auteur avec « moderated ».
  assert.ok(!(await reviewsSeenBy(bob, 'discovery')).includes(rid));
  const own = await call(alice, 'GET', '/ratings/album/discovery');
  assert.equal(own.body.mine.moderated, true);

  // L'auteur est prévenu (exposé des motifs, motif, « Contester ») ; le signaleur apprend le résultat.
  const forAlice = (await notifs(alice)).find((n) => n.kind === 'moderation_action');
  assert.ok(forAlice, 'notification de décision');
  assert.equal(forAlice.data.statement, statement);
  assert.equal(forAlice.data.ground, 'rules:harassment');
  assert.equal(forAlice.data.itemId, 'discovery');
  assert.equal(forAlice.read, false);
  const state = await call(alice, 'GET', '/state');
  assert.ok(state.body.counts.unread >= 1, 'pastille de la cloche');
  const forBob = (await notifs(bob)).find((n) => n.kind === 'report_resolved');
  assert.equal(forBob.data.outcome, 'actioned');

  // Contestation, une seule fois.
  const mine = await call(alice, 'GET', '/moderation/mine');
  const decision = mine.body.items.find((d) => d.id === decided.body.action.id);
  assert.equal(decision.appealable, true);
  assert.equal(decision.statement, statement);
  assert.equal(decision.item.itemId, 'discovery');
  assert.equal((await call(bob, 'POST', `/moderation/${decision.id}/appeal`, { text: 'Pas moi' })).body.error, 'not_found');
  assert.equal((await call(alice, 'POST', `/moderation/${decision.id}/appeal`, { text: '' })).body.error, 'appeal_required');
  assert.equal((await call(alice, 'POST', `/moderation/${decision.id}/appeal`, { text: 'C’était de l’humour, je reformule si besoin.' })).status, 200);
  assert.equal((await call(alice, 'POST', `/moderation/${decision.id}/appeal`, { text: 'Encore' })).body.error, 'already_appealed');

  // L'admin voit la contestation et annule la décision : la critique revient, l'auteur est prévenu.
  const appeals = await call(admin, 'GET', '/admin/appeals');
  const pending = appeals.body.items.find((a) => a.action.id === decision.id);
  assert.equal(pending.action.appeal.text, 'C’était de l’humour, je reformule si besoin.');
  assert.ok(appeals.body.counts.appeals >= 1);
  const reversed = await call(admin, 'POST', `/admin/moderation/${decision.id}/appeal-decision`, { decision: 'reversed', note: 'Ton humour, pas une insulte.' });
  assert.equal(reversed.status, 200, JSON.stringify(reversed.body));
  assert.equal(reversed.body.action.appeal.decision, 'reversed');
  assert.equal((await call(admin, 'POST', `/admin/moderation/${decision.id}/appeal-decision`, { decision: 'upheld' })).body.error, 'already_decided');
  assert.ok((await reviewsSeenBy(bob, 'discovery')).includes(rid), 'critique rétablie');
  const back = (await notifs(alice)).find((n) => n.kind === 'appeal_decided');
  assert.equal(back.data.decision, 'reversed');
  assert.equal(back.data.restored, true);
  assert.equal(back.data.note, 'Ton humour, pas une insulte.');
});

test('décision « supprimer » : texte retiré, note gardée, mentions et notifications qui pointaient dessus nettoyées', async () => {
  const author = await player('aut');
  const other = await player('oth');
  const rid = await review(author, 'thriller', 'Texte qui sera supprimé', 6);
  const now = Date.now();
  // Ce qui pointe vers la critique (rempli par P1 en vrai) : une mention, un commentaire et sa mention, une notification.
  db.prepare("INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, 'review', ?, ?)").run(other.user.id, rid, now);
  const cid = db.prepare("INSERT INTO comments (target_type, target_id, user_id, body, created_at) VALUES ('review', ?, ?, 'Réponse', ?) RETURNING id").get(rid, other.user.id, now).id;
  db.prepare("INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, 'comment', ?, ?)").run(author.user.id, cid, now);
  db.prepare("INSERT INTO notifications (user_id, kind, actor_id, target_type, target_id, created_at) VALUES (?, 'like_review', ?, 'review', ?, ?)").run(author.user.id, other.user.id, String(rid), now);
  const rep = await call(other, 'POST', '/reports', { targetType: 'review', targetId: rid, reason: 'spam' });
  const r = await call(admin, 'POST', `/admin/reports/${rep.body.id}/decision`, { action: 'delete', ground: 'rules:spam', statement: 'Publicité répétée.' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = db.prepare('SELECT score, review, hidden_at FROM ratings WHERE id = ?').get(rid);
  assert.equal(row.score, 6);
  assert.equal(row.review, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM likes WHERE (target_type = 'review' AND target_id = ?) OR (target_type = 'comment' AND target_id = ?)").get(rid, cid).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM comments WHERE target_type = 'review' AND target_id = ?").get(rid).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE target_type = 'review' AND target_id = ? AND kind = 'like_review'").get(String(rid)).n, 0);
  // rating_stats suit : plus de texte compté.
  const stats = db.prepare("SELECT review_count FROM rating_stats WHERE item_type = 'album' AND item_id = 'thriller'").get();
  const truth = db.prepare("SELECT COUNT(*) AS n FROM ratings WHERE item_type = 'album' AND item_id = 'thriller' AND review IS NOT NULL").get().n;
  assert.equal(stats.review_count, truth);
  // La copie figée reste dans la décision (preuve).
  const action = db.prepare('SELECT snapshot FROM moderation_actions WHERE id = ?').get(r.body.action.id);
  assert.equal(JSON.parse(action.snapshot).text, 'Texte qui sera supprimé');
  // L'ancienne route admin de suppression passe aussi par une décision (journal + notification).
  const rid2 = await review(author, 'abbey-road', 'Deuxième texte à retirer');
  const legacy = await call(admin, 'DELETE', `/admin/reviews/${author.user.id}/album/abbey-road`);
  assert.equal(legacy.status, 200);
  assert.ok(Array.isArray(legacy.body.items));
  assert.equal(db.prepare('SELECT review FROM ratings WHERE id = ?').get(rid2).review, null);
  assert.ok(db.prepare("SELECT 1 FROM moderation_actions WHERE target_type = 'review' AND target_id = ? AND action = 'delete'").get(String(rid2)));
  const list = await call(admin, 'GET', '/admin/reviews');
  assert.ok(list.body.items.every((i) => Number.isInteger(i.ratingId) && typeof i.hidden === 'boolean'));
});

test('blocages : critiques masquées dans les deux sens, amitié retirée, demandes d’ami et profil refusés', async () => {
  const carol = await player('carol');
  const dave = await player('dave');
  // Amis d'abord : le blocage retire l'amitié.
  await call(carol, 'POST', '/friends/request', { username: dave.username });
  const incoming = (await call(dave, 'GET', '/friends')).body.incoming[0];
  await call(dave, 'POST', `/friends/${incoming.requestId}/accept`);
  const rc = await review(carol, 'back-to-black', 'Avis de Carol');
  const rd = await review(dave, 'back-to-black', 'Avis de Dave');
  assert.ok((await reviewsSeenBy(carol, 'back-to-black')).includes(rd));

  assert.equal((await call(carol, 'PUT', `/blocks/${carol.user.id}`)).body.error, 'cannot_block_self');
  assert.equal((await call(carol, 'PUT', '/blocks/987654')).body.error, 'user_not_found');
  const b = await call(carol, 'PUT', `/blocks/${dave.user.id}`);
  assert.equal(b.status, 200);
  assert.equal(b.body.blocked, true);
  assert.ok(!(await reviewsSeenBy(carol, 'back-to-black')).includes(rd), 'Carol ne voit plus Dave');
  assert.ok(!(await reviewsSeenBy(dave, 'back-to-black')).includes(rc), 'Dave ne voit plus Carol');
  assert.equal((await call(carol, 'GET', '/friends')).body.friends.length, 0, 'amitié retirée');
  assert.equal((await call(dave, 'POST', '/friends/request', { username: carol.username })).body.error, 'user_not_found');
  assert.equal((await call(carol, 'POST', '/friends/request', { username: dave.username })).body.error, 'user_not_found');
  assert.equal((await call(dave, 'GET', `/users/${carol.username}`)).status, 404);
  // Signaler un contenu d'un joueur bloqué : invisible, donc introuvable.
  assert.equal((await call(dave, 'POST', '/reports', { targetType: 'review', targetId: rc, reason: 'spam' })).body.error, 'not_found');
  assert.equal(deps.access.isBlocked(dave.user.id, carol.user.id), true);
  assert.equal(deps.access.canSee(dave.user.id, carol.user.id, 'public'), false);

  const list = await call(carol, 'GET', '/blocks');
  assert.deepEqual(list.body.items.map((i) => i.user.username), [dave.username]);
  assert.ok(list.body.items[0].blockedAt > 0);
  const u = await call(carol, 'DELETE', `/blocks/${dave.user.id}`);
  assert.equal(u.body.blocked, false);
  assert.ok((await reviewsSeenBy(carol, 'back-to-black')).includes(rd), 'débloqué : de nouveau visible');
  assert.equal((await call(carol, 'GET', '/blocks')).body.items.length, 0);
});

test('suspension : écritures publiées refusées (403 suspended), lecture, note sans texte et export permis ; levée', async () => {
  const eve = await player('eve');
  const friend = await player('evefriend');
  const s = await call(admin, 'POST', `/admin/users/${eve.user.id}/suspend`, { days: 7, ground: 'rules:spam', statement: 'Spam répété dans les critiques.' });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal((await call(admin, 'POST', `/admin/users/${eve.user.id}/suspend`, { days: 3, ground: 'rules:spam', statement: 'x' })).body.error, 'invalid_duration');
  const write = await call(eve, 'PUT', '/ratings/album/21', { score: 8, review: 'Texte pendant la suspension' });
  assert.equal(write.status, 403);
  assert.equal(write.body.error, 'suspended');
  assert.ok(write.body.until > Date.now());
  assert.equal((await call(eve, 'PUT', '/ratings/album/21', { score: 8 })).status, 200, 'une note sans texte reste possible');
  assert.equal((await call(eve, 'POST', '/friends/request', { username: friend.username })).body.error, 'suspended');
  assert.equal((await call(eve, 'GET', '/ratings/album/21')).status, 200);
  const exp = await call(eve, 'GET', '/account/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.body.profile.username, eve.username);
  const mine = await call(eve, 'GET', '/moderation/mine');
  assert.ok(mine.body.suspendedUntil > Date.now());
  assert.equal(mine.body.suspensionReason, 'Spam répété dans les critiques.');
  const n = (await notifs(eve)).find((x) => x.kind === 'moderation_action');
  assert.equal(n.data.action, 'suspend');
  assert.ok(n.data.until > Date.now());
  // Liste des suspensions, puis levée.
  assert.ok((await call(admin, 'GET', '/admin/suspensions')).body.items.some((i) => i.user.id === eve.user.id));
  assert.equal((await call(admin, 'POST', `/admin/users/${admin.user.id}/suspend`, { days: 1, ground: 'rules:spam', statement: 'x' })).body.error, 'cannot_moderate_admin');
  assert.equal((await call(admin, 'POST', `/admin/users/${eve.user.id}/unsuspend`, {})).status, 200);
  assert.equal((await call(eve, 'PUT', '/ratings/album/21', { score: 8, review: 'De retour' })).status, 200);
  assert.ok(!(await call(admin, 'GET', '/admin/suspensions')).body.items.some((i) => i.user.id === eve.user.id));
});

test('CGU : un consentement à une ancienne version bloque les écritures (403 terms_required)', async () => {
  const old = await player('oldterms');
  db.prepare("UPDATE users SET terms_accepted_at = 1, terms_version = '2000-01-01' WHERE id = ?").run(old.user.id);
  const r = await call(old, 'PUT', '/ratings/album/21', { score: 5, review: 'Texte' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'terms_required');
  db.prepare('UPDATE users SET terms_version = ? WHERE id = ?').run(app.deps.config.termsVersion, old.user.id);
  assert.equal((await call(old, 'PUT', '/ratings/album/21', { score: 5, review: 'Texte' })).status, 200);
});

test('espace admin : refusé à un joueur, même avec role = \'admin\' en base', async () => {
  const frank = await player('frank');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(frank.user.id);
  for (const [method, path, body] of [
    ['GET', '/admin/reports'], ['GET', '/admin/appeals'], ['GET', '/admin/audit'], ['GET', '/admin/suspensions'],
    ['POST', '/admin/reports/1/decision', { action: 'dismiss' }], ['POST', `/admin/users/${admin.user.id}/suspend`, { days: 1 }],
    ['POST', '/admin/albums/discovery/cover', { blocked: true }], ['POST', '/admin/moderation/act', {}], ['GET', '/admin/reviews'],
  ]) {
    const r = await call(frank, method, path, body);
    assert.equal(r.status, 403, `${method} ${path}`);
  }
  assert.equal((await call(null, 'GET', '/admin/reports')).status, 401);
});

test('politique des liens : liste blanche, liens retirés, comptes récents ou de bas niveau refusés, admin exempté', async () => {
  const lp = deps.access.linkPolicy;
  const veteran = { id: 1, created_at: Date.now() - 10 * 86_400_000, xp: 1_000_000, email: 'v@example.com', email_verified_at: 1 };
  const young = { ...veteran, created_at: Date.now() - 3600_000 };
  const lowLevel = { ...veteran, xp: 0 };
  assert.equal(lp('Aucun lien ici.', young), 'Aucun lien ici.');
  assert.equal(lp('Écoute https://www.deezer.com/album/302127 et https://evil.example/x', veteran), 'Écoute https://www.deezer.com/album/302127 et');
  assert.equal(lp('Voir (https://fr.wikipedia.org/wiki/Discovery).', veteran), 'Voir (https://fr.wikipedia.org/wiki/Discovery).');
  assert.equal(lp('Va sur www.spam.example maintenant', veteran), 'Va sur maintenant');
  assert.equal(lp('Clip : https://youtu.be/abc et https://m.youtube.com/watch?v=x', veteran), 'Clip : https://youtu.be/abc et https://m.youtube.com/watch?v=x');
  assert.equal(lp('Faux : https://deezer.com.evil.example/x', veteran), 'Faux :');
  assert.throws(() => lp('https://www.deezer.com/album/1', young), (e) => e.code === 'links_not_allowed');
  assert.throws(() => lp('https://www.deezer.com/album/1', lowLevel), (e) => e.code === 'links_not_allowed');
  const boss = deps.services.getUser(admin.user.id);
  assert.equal(lp('https://open.spotify.com/album/x', boss), 'https://open.spotify.com/album/x');
  // Par l'API : un compte tout neuf ne peut pas poster de lien dans une critique.
  const fresh = await player('fresh');
  const r = await call(fresh, 'PUT', '/ratings/album/21', { score: 6, review: 'Mon avis : https://www.deezer.com/album/1' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'links_not_allowed');
});

test('formulaire public (sans compte) : champs obligatoires, adresse résolue en contenu, accusé de réception, résultat par e-mail', async () => {
  const author = await player('pubauthor');
  const rid = await review(author, 'kind-of-blue', 'Critique signalée par le public');
  const base = { name: 'Camille Martin', email: 'camille@example.org', reason: 'copyright', details: 'Ce texte recopie des paroles entières.', goodFaith: true };
  const miss = await call(null, 'POST', '/public/report', { ...base, goodFaith: false, url: '/album/kind-of-blue' });
  assert.equal(miss.status, 400);
  assert.deepEqual([miss.body.error, miss.body.field], ['notice_incomplete', 'goodFaith']);
  assert.equal((await call(null, 'POST', '/public/report', { ...base, email: 'pas-un-email', url: '/x' })).body.field, 'email');
  assert.equal((await call(null, 'POST', '/public/report', { ...base, details: 'court', url: '/x' })).body.field, 'details');
  assert.equal((await call(null, 'POST', '/public/report', { ...base, url: 'https://autre-site.example/review/1' })).body.field, 'url');

  const ok = await call(null, 'POST', '/public/report', { ...base, url: `${deps.config.appUrl}/album/kind-of-blue#review-${rid}` });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(ok.body.id);
  assert.deepEqual([row.target_type, row.target_id, row.target_user_id, row.good_faith, row.reporter_id], ['review', String(rid), author.user.id, 1, null]);
  assert.equal(row.reporter_email, 'camille@example.org');
  assert.ok(db.prepare("SELECT 1 FROM dev_emails WHERE to_addr = 'camille@example.org' AND subject LIKE '%reçu%'").get(), 'accusé de réception');

  // Adresse qui ne correspond à aucun contenu : signalement de l'adresse, que l'admin classe.
  const url = await call(null, 'POST', '/public/report', { ...base, url: '/collection/albums?genre=jazz' });
  assert.equal(url.status, 201);
  const urlRow = db.prepare('SELECT target_type, target_id FROM reports WHERE id = ?').get(url.body.id);
  assert.deepEqual([urlRow.target_type, urlRow.target_id], ['url', '/collection/albums?genre=jazz']);
  assert.equal((await call(admin, 'POST', `/admin/reports/${url.body.id}/decision`, { action: 'hide', ground: 'rules:spam', statement: 'x' })).body.error, 'invalid_action');
  const dismissed = await call(admin, 'POST', `/admin/reports/${url.body.id}/decision`, { action: 'dismiss' });
  assert.equal(dismissed.status, 200);
  assert.ok(db.prepare("SELECT 1 FROM dev_emails WHERE to_addr = 'camille@example.org' AND subject LIKE '%examiné%'").get(), 'résultat envoyé');
  // La file montre l'adresse et la personne du formulaire public.
  const queue = await call(admin, 'GET', '/admin/reports?status=open&type=review');
  const item = queue.body.items.find((i) => i.report.id === ok.body.id);
  assert.equal(item.report.public, true);
  assert.deepEqual(item.reporter, { name: 'Camille Martin', email: 'camille@example.org' });
});

test('récidive : la troisième décision en 90 jours propose une suspension ; suspendre masque le contenu', async () => {
  const troll = await player('troll');
  const reporter = await player('rep');
  const ids = [];
  for (const album of ['graduation', 'exodus', '21']) ids.push(await review(troll, album, `Texte pénible sur ${album}`));
  for (const [i, rid] of ids.slice(0, 2).entries()) {
    const rep = await call(reporter, 'POST', '/reports', { targetType: 'review', targetId: rid, reason: 'spam' });
    await call(admin, 'POST', `/admin/reports/${rep.body.id}/decision`, { action: i ? 'warn' : 'hide', ground: 'rules:spam', statement: 'Spam.' });
  }
  const third = await call(reporter, 'POST', '/reports', { targetType: 'review', targetId: ids[2], reason: 'spam' });
  const item = (await call(admin, 'GET', '/admin/reports?status=open')).body.items.find((i) => i.report.id === third.body.id);
  assert.equal(item.priorActions.count, 2);
  assert.equal(item.priorActions.suggestSuspend, true);
  const s = await call(admin, 'POST', `/admin/reports/${third.body.id}/decision`, { action: 'suspend', ground: 'rules:spam', statement: 'Récidive.', suspendDays: 7 });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.ok(db.prepare('SELECT suspended_until FROM users WHERE id = ?').get(troll.user.id).suspended_until > Date.now());
  assert.ok(db.prepare('SELECT hidden_at FROM ratings WHERE id = ?').get(ids[2]).hidden_at, 'suspendre pour un contenu le masque aussi');
  // Les décisions traitées se relisent (filtre « traités »).
  const done = await call(admin, 'GET', '/admin/reports?status=actioned');
  assert.ok(done.body.items.some((i) => i.report.id === third.body.id && i.action?.action === 'suspend'));
});

test('retrait de pochette, journal d’administration, décision sans signalement', async () => {
  assert.equal((await call(admin, 'POST', '/admin/albums/nope/cover', { blocked: true })).body.error, 'unknown_album');
  const r = await call(admin, 'POST', '/admin/albums/discovery/cover', { blocked: true, note: 'Demande de l’ayant droit' });
  assert.equal(r.status, 200);
  assert.equal(db.prepare("SELECT cover_blocked FROM cat_albums WHERE id = 'discovery'").get().cover_blocked, 1);
  assert.deepEqual((await call(admin, 'GET', '/admin/albums/blocked-covers')).body.items.map((i) => i.albumId), ['discovery']);
  await call(admin, 'POST', '/admin/albums/discovery/cover', { blocked: false });
  assert.equal(db.prepare("SELECT cover_blocked FROM cat_albums WHERE id = 'discovery'").get().cover_blocked, 0);

  const author = await player('direct');
  const rid = await review(author, 'exodus', 'Texte modéré sans signalement');
  const a = await call(admin, 'POST', '/admin/moderation/act', { targetType: 'review', targetId: rid, action: 'warn', ground: 'rules:respect', statement: 'Reste courtois.' });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal((await call(admin, 'POST', '/admin/moderation/act', { targetType: 'review', targetId: rid, action: 'dismiss' })).body.error, 'invalid_action');

  const audit = await call(admin, 'GET', '/admin/audit?limit=100');
  const actions = audit.body.items.map((i) => i.action);
  for (const want of ['cover.block', 'cover.unblock', 'moderation.warn', 'moderation.hide', 'appeal.reversed']) assert.ok(actions.includes(want), want);
  assert.ok(audit.body.items[0].admin?.username === admin.username);
  const page = await call(admin, 'GET', '/admin/audit?limit=2');
  assert.equal(page.body.items.length, 2);
  assert.ok(page.body.nextCursor);
  const next = await call(admin, 'GET', `/admin/audit?limit=2&cursor=${enc(page.body.nextCursor)}`);
  assert.ok(next.body.items[0].id < page.body.items[1].id);
});

test('tâche purge-reports-ip : adresses IP effacées après un an', async () => {
  const reporter = await player('ip');
  const target = await player('ipt');
  const rid = await review(target, 'kind-of-blue', 'Pour le test des adresses IP');
  const r = await call(reporter, 'POST', '/reports', { targetType: 'review', targetId: rid, reason: 'other' });
  db.prepare("UPDATE reports SET created_ip = '203.0.113.9', created_at = ? WHERE id = ?").run(Date.now() - 400 * 86_400_000, r.body.id);
  const result = await app.jobs.runJob('purge-reports-ip');
  assert.ok(result.reports >= 1);
  assert.equal(db.prepare('SELECT created_ip FROM reports WHERE id = ?').get(r.body.id).created_ip, null);
});
