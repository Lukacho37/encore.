// Posts, commentaires, mentions « J'aime », permaliens de critiques (PLAN.md 4.2.1, 7.2, chantier P1-A) : matrice de
// visibilité, blocages dans les deux sens, quotas, post en double, politique des liens, un seul niveau de réponse,
// suppression douce avec réponses, compteurs, notifications groupées, purgeTarget à la suppression, discussions d'un album.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api } from './helpers.js';

const app = await startApp();
test.after(() => app.close());
const { db, deps } = app;

const enc = encodeURIComponent;
let n = 0;
/** Joueur inscrit par l'API (CGU acceptées, adresse confirmée). */
const player = (name) => signupVerified(app, { username: name || `so_${++n}` });
const call = (who, method, path, body) => api(app.base, who?.cookie || '', method, path, body);
function befriend(a, b) {
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', ?, ?)")
    .run(a.user.id, b.user.id, Date.now(), Date.now());
}
const notifs = (who) => db.prepare('SELECT kind, actor_id, target_type, target_id, group_key, data FROM notifications WHERE user_id = ? ORDER BY id').all(who.user.id);
/** Compte assez ancien et de niveau suffisant pour publier des liens (politique des liens, PLAN.md 7.1). */
const ageAccount = (who) => db.prepare('UPDATE users SET created_at = ?, xp = 5000 WHERE id = ?').run(Date.now() - 3 * 86_400_000, who.user.id);

test('POST /posts : texte, élément cité, validation, réponse { post, catalog }', async () => {
  const me = await player();
  const r = await call(me, 'POST', '/posts', { body: '  Réécouté Discovery ce soir.  ', item: { type: 'album', id: 'discovery' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const { post, catalog } = r.body;
  assert.equal(post.body, 'Réécouté Discovery ce soir.');
  assert.deepEqual(post.item, { type: 'album', id: 'discovery' });
  assert.equal(post.visibility, 'public');
  assert.equal(post.mine, true);
  assert.equal(post.liked, false);
  assert.equal(post.likeCount, 0);
  assert.equal(post.user.username, me.username);
  assert.ok(catalog.albums.some((a) => a.id === 'discovery'), 'la carte de mention a son album dans `catalog`');

  // Élément seul (sans texte) : permis ; ni texte ni élément : post_empty.
  assert.equal((await call(me, 'POST', '/posts', { item: { type: 'track', id: 'discovery:01' } })).status, 201);
  assert.equal((await call(me, 'POST', '/posts', { body: '   ' })).body.error, 'post_empty');
  assert.equal((await call(me, 'POST', '/posts', {})).body.error, 'post_empty');
  assert.equal((await call(me, 'POST', '/posts', { body: 'x', item: { type: 'album', id: 'nope' } })).body.error, 'unknown_item');
  assert.equal((await call(me, 'POST', '/posts', { body: 'x', item: { type: 'planet', id: 'x' } })).status, 400);
  assert.equal((await call(me, 'POST', '/posts', { body: 'x'.repeat(1001) })).status, 400);
  assert.equal((await call(me, 'POST', '/posts', { body: 42 })).status, 400);
  assert.equal((await call(me, 'POST', '/posts', { body: 'ok', visibility: 'secret' })).status, 400);
  assert.equal((await call(null, 'POST', '/posts', { body: 'anonyme' })).status, 401);
  // Artiste cité.
  const art = await call(me, 'POST', '/posts', { body: 'Quel groupe.', item: { type: 'artist', id: 'daft-punk' } });
  assert.equal(art.status, 201, JSON.stringify(art.body));
  assert.ok(art.body.catalog.artists.some((a) => a.id === 'daft-punk'));
});

test('post en double refusé 24 h (409), quota quotidien (429), politique des liens (400 / liens retirés)', async () => {
  const me = await player();
  assert.equal((await call(me, 'POST', '/posts', { body: 'Même texte' })).status, 201);
  assert.equal((await call(me, 'POST', '/posts', { body: 'Même texte' })).body.error, 'duplicate_post');
  // Un post d'hier ne bloque plus.
  db.prepare("UPDATE posts SET created_at = created_at - 90000000 WHERE user_id = ? AND body = 'Même texte'").run(me.user.id);
  assert.equal((await call(me, 'POST', '/posts', { body: 'Même texte' })).status, 201);

  // Liens : compte de moins de 24 h → refusé ; compte ancien → lien hors liste retiré, lien autorisé gardé.
  assert.equal((await call(me, 'POST', '/posts', { body: 'Écoute https://deezer.com/album/1' })).body.error, 'links_not_allowed');
  ageAccount(me);
  const kept = await call(me, 'POST', '/posts', { body: 'Écoute https://www.deezer.com/album/1 et https://pirate.example/x' });
  assert.equal(kept.status, 201, JSON.stringify(kept.body));
  assert.match(kept.body.post.body, /deezer\.com\/album\/1/);
  assert.doesNotMatch(kept.body.post.body, /pirate/);

  // Quota : 20 posts aujourd'hui → le 21e est refusé.
  const other = await player();
  const ins = db.prepare('INSERT INTO posts (user_id, body, visibility, created_at) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < 20; i++) ins.run(other.user.id, `post ${i}`, 'public', Date.now());
  const r = await call(other, 'POST', '/posts', { body: 'un de trop' });
  assert.equal(r.status, 429);
  assert.equal(r.body.error, 'quota_exceeded');
  assert.equal(r.body.kind, 'posts');
});

test('matrice de visibilité : public, amis seulement, masqué par la modération, blocages dans les deux sens', async () => {
  const author = await player();
  const friend = await player();
  const stranger = await player();
  const blocked = await player();
  befriend(author, friend);
  const pub = (await call(author, 'POST', '/posts', { body: 'Pour tout le monde' })).body.post;
  const fr = (await call(author, 'POST', '/posts', { body: 'Pour mes amis', visibility: 'friends' })).body.post;
  assert.equal(fr.visibility, 'friends');
  assert.equal((await call(blocked, 'PUT', `/blocks/${author.user.id}`)).status, 200);

  const status = async (who, id) => (await call(who, 'GET', `/posts/${id}`)).status;
  assert.equal(await status(author, fr.id), 200);
  assert.equal(await status(friend, fr.id), 200);
  assert.equal(await status(stranger, fr.id), 404, 'post « amis » : 404 pour un inconnu (rien ne fuit)');
  assert.equal(await status(stranger, pub.id), 200);
  assert.equal(await status(blocked, pub.id), 404, 'qui a bloqué l’auteur ne voit plus ses posts');
  assert.equal((await call(author, 'GET', `/posts/${(await call(blocked, 'POST', '/posts', { body: 'Je bloque' })).body.post.id}`)).status, 404,
    'l’auteur bloqué ne voit pas non plus les posts de celui qui l’a bloqué');
  assert.equal(await status(stranger, 999999), 404);
  assert.equal(await status(stranger, 'abc'), 404);

  // Masqué par la modération : seul l'auteur le voit (moderated: true).
  db.prepare('UPDATE posts SET hidden_at = ? WHERE id = ?').run(Date.now(), pub.id);
  assert.equal(await status(stranger, pub.id), 404);
  const own = await call(author, 'GET', `/posts/${pub.id}`);
  assert.equal(own.status, 200);
  assert.equal(own.body.post.moderated, true);
  // Pas de commentaire ni de « J'aime » sur un contenu masqué.
  assert.equal((await call(author, 'POST', '/comments', { targetType: 'post', targetId: pub.id, body: 'hm' })).body.error, 'thread_locked');
  assert.equal((await call(friend, 'PUT', `/likes/post/${pub.id}`)).status, 404);

  // Interactions refusées à travers un blocage.
  const pub2 = (await call(author, 'POST', '/posts', { body: 'Encore un' })).body.post;
  assert.equal((await call(blocked, 'PUT', `/likes/post/${pub2.id}`)).status, 404);
  assert.equal((await call(blocked, 'POST', '/comments', { targetType: 'post', targetId: pub2.id, body: 'salut' })).status, 404);

  // Onglet Posts du Studio : posts « amis » pour les amis seulement.
  const seen = async (who) => (await call(who, 'GET', `/users/${author.username}/posts`)).body.items.map((p) => p.id);
  assert.ok((await seen(friend)).includes(fr.id));
  assert.ok(!(await seen(stranger)).includes(fr.id));
  assert.ok((await seen(stranger)).includes(pub2.id));
  assert.ok(!(await seen(stranger)).includes(pub.id), 'post masqué absent pour les autres');
  assert.ok((await seen(author)).includes(pub.id), 'post masqué visible de son auteur');
  assert.equal((await call(blocked, 'GET', `/users/${author.username}/posts`)).status, 404);
  // Studio privé : rien pour les autres.
  db.prepare("UPDATE users SET profile_visibility = 'private' WHERE id = ?").run(author.user.id);
  const priv = (await call(friend, 'GET', `/users/${author.username}/posts`)).body;
  assert.equal(priv.restricted, true);
  assert.deepEqual(priv.items, []);
  db.prepare("UPDATE users SET profile_visibility = 'public' WHERE id = ?").run(author.user.id);
});

test('modifier et supprimer un post : auteur seulement (404 sinon), edited_at, purgeTarget et content.removed', async () => {
  const me = await player();
  const other = await player();
  const p = (await call(me, 'POST', '/posts', { body: 'Premier jet' })).body.post;
  assert.equal((await call(other, 'PATCH', `/posts/${p.id}`, { body: 'piraté' })).status, 404);
  const edited = await call(me, 'PATCH', `/posts/${p.id}`, { body: 'Version finale' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.post.body, 'Version finale');
  assert.ok(edited.body.post.editedAt > 0);

  // Commentaire, réponse, « J'aime » et notifications accrochés au post : tout part avec lui.
  const c = (await call(other, 'POST', '/comments', { targetType: 'post', targetId: p.id, body: 'Bien vu' })).body.comment;
  await call(me, 'POST', '/comments', { targetType: 'post', targetId: p.id, parentId: c.id, body: 'Merci' });
  await call(other, 'PUT', `/likes/post/${p.id}`);
  await call(me, 'PUT', `/likes/comment/${c.id}`);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE object_type = 'post' AND object_id = ?").get(String(p.id)).n >= 1, 'le post est dans le fil');
  const removed = [];
  const off = deps.bus.on('content.removed', (e) => removed.push(e));
  assert.equal((await call(other, 'DELETE', `/posts/${p.id}`)).status, 404);
  assert.equal((await call(me, 'DELETE', `/posts/${p.id}`)).status, 200);
  off?.();
  assert.deepEqual(removed.find((e) => e.targetType === 'post'), { targetType: 'post', targetId: p.id, by: 'author' });
  const left = (sql, ...args) => db.prepare(sql).get(...args).n;
  assert.equal(left('SELECT COUNT(*) AS n FROM posts WHERE id = ?', p.id), 0);
  assert.equal(left("SELECT COUNT(*) AS n FROM comments WHERE target_type = 'post' AND target_id = ?", p.id), 0);
  assert.equal(left("SELECT COUNT(*) AS n FROM likes WHERE (target_type = 'post' AND target_id = ?) OR (target_type = 'comment' AND target_id = ?)", p.id, c.id), 0);
  assert.equal(left("SELECT COUNT(*) AS n FROM notifications WHERE target_type = 'post' AND target_id = ?", String(p.id)), 0);
  assert.equal(left("SELECT COUNT(*) AS n FROM activity WHERE object_type = 'post' AND object_id = ?", String(p.id)), 0);
});

test('commentaires : un seul niveau de réponse, @nom, compteurs, pages, suppression douce avec réponses', async () => {
  const owner = await player();
  const a = await player();
  const b = await player();
  const p = (await call(owner, 'POST', '/posts', { body: 'Votre album de l’été ?' })).body.post;
  const top = (await call(a, 'POST', '/comments', { targetType: 'post', targetId: p.id, body: 'Moon Safari' })).body.comment;
  assert.equal(top.parentId, null);
  assert.equal(top.replyCount, 0);
  const r1 = (await call(b, 'POST', '/comments', { targetType: 'post', targetId: p.id, parentId: top.id, body: 'Pas mal' })).body.comment;
  assert.equal(r1.parentId, top.id);
  // Réponse à une réponse : rattachée au commentaire de tête, avec l'auteur visé.
  const r2 = await call(a, 'POST', '/comments', { targetType: 'post', targetId: p.id, parentId: r1.id, body: 'Merci !' });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(r2.body.comment.parentId, top.id, 'une seule profondeur');
  assert.equal(r2.body.comment.replyToUser.username, b.username);
  const r3 = (await call(owner, 'POST', '/comments', { targetType: 'post', targetId: p.id, parentId: top.id, body: 'Classique' })).body.comment;

  // Validation.
  assert.equal((await call(a, 'POST', '/comments', { targetType: 'post', targetId: p.id, body: '  ' })).body.error, 'comment_empty');
  assert.equal((await call(a, 'POST', '/comments', { targetType: 'post', targetId: p.id, body: 'x'.repeat(1001) })).status, 400);
  assert.equal((await call(a, 'POST', '/comments', { targetType: 'artist', targetId: 1, body: 'x' })).status, 400);
  assert.equal((await call(a, 'POST', '/comments', { targetType: 'post', targetId: 999999, body: 'x' })).status, 404);
  const p2 = (await call(owner, 'POST', '/posts', { body: 'Autre fil' })).body.post;
  assert.equal((await call(a, 'POST', '/comments', { targetType: 'post', targetId: p2.id, parentId: top.id, body: 'mauvais fil' })).status, 404);

  // Compteurs tenus à jour.
  assert.equal(db.prepare('SELECT comment_count AS n FROM posts WHERE id = ?').get(p.id).n, 4);
  assert.equal(db.prepare('SELECT reply_count AS n FROM comments WHERE id = ?').get(top.id).n, 3);

  // Lecture : commentaires de tête avec leurs 2 premières réponses ; la suite par /replies.
  const list = (await call(b, 'GET', `/comments?target=post:${p.id}`)).body;
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].replyCount, 3);
  assert.deepEqual(list.items[0].replies.map((c) => c.id), [r1.id, r2.body.comment.id]);
  const replies = (await call(b, 'GET', `/comments/${top.id}/replies?limit=2`)).body;
  assert.deepEqual(replies.items.map((c) => c.id), [r1.id, r2.body.comment.id]);
  assert.ok(replies.nextCursor);
  const more = (await call(b, 'GET', `/comments/${top.id}/replies?limit=2&cursor=${replies.nextCursor}`)).body;
  assert.deepEqual(more.items.map((c) => c.id), [r3.id]);
  assert.equal(more.nextCursor, null);
  assert.equal((await call(b, 'GET', '/comments?target=nope:1')).status, 400);

  // Modifier : auteur seulement.
  assert.equal((await call(b, 'PATCH', `/comments/${top.id}`, { body: 'piraté' })).status, 404);
  const ed = await call(a, 'PATCH', `/comments/${top.id}`, { body: 'Moon Safari, évidemment' });
  assert.equal(ed.body.comment.body, 'Moon Safari, évidemment');
  assert.ok(ed.body.comment.editedAt);

  // Supprimer le commentaire de tête qui a des réponses : il reste, vidé.
  assert.equal((await call(b, 'DELETE', `/comments/${top.id}`)).status, 404, 'ni auteur ni propriétaire du fil');
  assert.equal((await call(a, 'DELETE', `/comments/${top.id}`)).status, 200);
  const after = (await call(b, 'GET', `/comments?target=post:${p.id}`)).body.items[0];
  assert.equal(after.deleted, true);
  assert.equal(after.body, null);
  assert.equal(after.user, null);
  assert.equal(after.replies.length, 2);
  assert.equal((await call(a, 'POST', '/comments', { targetType: 'post', targetId: p.id, parentId: top.id, body: 'encore' })).status, 201,
    'on répond encore sous un commentaire supprimé');
  // Le propriétaire du fil peut supprimer une réponse ; une réponse sans enfants disparaît.
  assert.equal((await call(owner, 'DELETE', `/comments/${r1.id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments WHERE id = ?').get(r1.id).n, 0);
  assert.equal(db.prepare('SELECT reply_count AS n FROM comments WHERE id = ?').get(top.id).n, 3);
  // 4 commentaires + « encore » − le commentaire de tête vidé (il ne compte plus) − r1 supprimée.
  assert.equal(db.prepare('SELECT comment_count AS n FROM posts WHERE id = ?').get(p.id).n, 3);
});

test('« J’aime » : idempotent, compteurs, `liked`, qui a aimé (amis d’abord), notifications groupées puis retirées', async () => {
  const owner = await player();
  const fans = [await player(), await player(), await player()];
  befriend(owner, fans[2]);
  const p = (await call(owner, 'POST', '/posts', { body: 'Aimez-moi' })).body.post;
  for (const f of fans) {
    const r = await call(f, 'PUT', `/likes/post/${p.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.liked, true);
  }
  const again = await call(fans[0], 'PUT', `/likes/post/${p.id}`);
  assert.deepEqual(again.body, { liked: true, likeCount: 3 }, 'idempotent');
  assert.equal((await call(fans[0], 'GET', `/posts/${p.id}`)).body.post.liked, true);
  assert.equal((await call(owner, 'GET', `/posts/${p.id}`)).body.post.liked, false);

  // Une notification par « J'aime », un seul groupe → une seule ligne dans la cloche.
  const rows = notifs(owner).filter((x) => x.kind === 'like_post');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((x) => x.group_key === `like:post:${p.id}` && x.target_type === 'post' && x.target_id === String(p.id)));
  const bell = (await call(owner, 'GET', '/notifications')).body;
  const group = bell.items.filter((x) => x.kind === 'like_post');
  assert.equal(group.length, 1, 'notifications groupées');
  assert.equal(group[0].actorCount, 3);
  assert.deepEqual(group[0].target, { type: 'post', id: String(p.id) });

  // Qui a aimé : l'ami d'abord.
  const likers = (await call(owner, 'GET', `/likes/post/${p.id}`)).body;
  assert.equal(likers.items[0].username, fans[2].username);
  assert.equal(likers.items.length, 3);
  const page1 = (await call(owner, 'GET', `/likes/post/${p.id}?limit=2`)).body;
  const page2 = (await call(owner, 'GET', `/likes/post/${p.id}?limit=2&cursor=${page1.nextCursor}`)).body;
  assert.equal(new Set([...page1.items, ...page2.items].map((u) => u.id)).size, 3);
  assert.equal(page2.nextCursor, null);

  // Retirer son « J'aime » : compteur et notification non lue retirés ; deux fois : sans effet.
  const off = await call(fans[0], 'DELETE', `/likes/post/${p.id}`);
  assert.deepEqual(off.body, { liked: false, likeCount: 2 });
  assert.deepEqual((await call(fans[0], 'DELETE', `/likes/post/${p.id}`)).body, { liked: false, likeCount: 2 });
  assert.equal(notifs(owner).filter((x) => x.kind === 'like_post').length, 2);
  // Pas de notification pour soi-même.
  await call(owner, 'PUT', `/likes/post/${p.id}`);
  assert.equal(notifs(owner).filter((x) => x.kind === 'like_post' && x.actor_id === owner.user.id).length, 0);
  assert.equal((await call(owner, 'PUT', `/likes/planet/${p.id}`)).status, 404);
  assert.equal((await call(owner, 'PUT', '/likes/post/999999')).status, 404);
});

test('critiques : permalien /reviews/:id, réponses, « J’aime » (liked), notifications comment_review / reply_comment / like_review', async () => {
  const author = await player();
  const reader = await player();
  const third = await player();
  await call(author, 'PUT', '/ratings/album/moon-safari', { score: 9, review: 'Le disque des trajets de nuit.' });
  const reviewId = db.prepare("SELECT id FROM ratings WHERE user_id = ? AND item_id = 'moon-safari'").get(author.user.id).id;

  const page = await call(reader, 'GET', `/reviews/${reviewId}`);
  assert.equal(page.status, 200, JSON.stringify(page.body));
  assert.deepEqual(page.body.item, { type: 'album', id: 'moon-safari' });
  assert.equal(page.body.review.review, 'Le disque des trajets de nuit.');
  assert.equal(page.body.review.liked, false);
  assert.ok(page.body.catalog.albums.some((a) => a.id === 'moon-safari'));
  assert.deepEqual(page.body.comments.items, []);
  assert.equal((await call(reader, 'GET', '/reviews/999999')).status, 404);

  const c = (await call(reader, 'POST', '/comments', { targetType: 'review', targetId: reviewId, body: 'Tellement vrai.' })).body.comment;
  await call(third, 'POST', '/comments', { targetType: 'review', targetId: reviewId, parentId: c.id, body: 'Pareil' });
  await call(reader, 'PUT', `/likes/review/${reviewId}`);
  await call(author, 'PUT', `/likes/comment/${c.id}`);

  const view = (await call(reader, 'GET', `/reviews/${reviewId}`)).body;
  assert.equal(view.review.liked, true);
  assert.equal(view.review.likeCount, 1);
  assert.equal(view.review.commentCount, 2);
  assert.equal(view.comments.items[0].replies.length, 1);
  assert.equal(view.comments.items[0].liked, false);
  // Notes de l'album : `liked` réel, compteurs.
  const ratings = (await call(reader, 'GET', '/ratings/album/moon-safari')).body;
  const rv = ratings.community.reviews.find((r) => r.id === reviewId);
  assert.equal(rv.liked, true);
  assert.equal(rv.commentCount, 2);
  assert.ok(!('reviews' in ratings) && !('friendScores' in ratings), 'anciennes clés retirées (P1-A)');

  const authorKinds = notifs(author).map((x) => x.kind);
  assert.ok(authorKinds.includes('comment_review'));
  assert.ok(authorKinds.includes('like_review'));
  const commentNotif = notifs(author).find((x) => x.kind === 'comment_review');
  assert.equal(commentNotif.target_type, 'review');
  assert.equal(commentNotif.group_key, `comment:review:${reviewId}`);
  assert.equal(JSON.parse(commentNotif.data).itemId, 'moon-safari', 'titre de l’album dans la notification');
  const readerKinds = notifs(reader).map((x) => x.kind);
  assert.ok(readerKinds.includes('reply_comment'));
  assert.ok(readerKinds.includes('like_comment'));
  const likeComment = notifs(reader).find((x) => x.kind === 'like_comment');
  assert.equal(likeComment.target_type, 'review', 'un commentaire se lit dans son fil');
  assert.equal(JSON.parse(likeComment.data).commentId, c.id);

  // Critique effacée par son auteur : réponses, « J'aime » et notifications partent avec elle.
  await call(author, 'PUT', '/ratings/album/moon-safari', { score: 9, review: '' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM comments WHERE target_type = 'review' AND target_id = ?").get(reviewId).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM likes WHERE target_type = 'review' AND target_id = ?").get(reviewId).n, 0);
  assert.equal((await call(reader, 'GET', `/reviews/${reviewId}`)).status, 404);
});

test('partager une critique ou citer quelqu’un : mention_review et mention_post, jamais à travers un blocage', async () => {
  const author = await player('so_autrice');
  const sharer = await player();
  const cited = await player('so_cite');
  const blocker = await player('so_bloqueur');
  await call(author, 'PUT', '/ratings/album/thriller', { score: 8, review: 'Un classique absolu.' });
  const reviewId = db.prepare("SELECT id FROM ratings WHERE user_id = ? AND item_id = 'thriller'").get(author.user.id).id;
  const r = await call(sharer, 'POST', '/posts', { body: 'Lisez ça @so_cite et @so_bloqueur', item: { type: 'review', id: String(reviewId) } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.post.review.id, reviewId, 'la critique citée est jointe au post');
  assert.ok(r.body.catalog.albums.some((a) => a.id === 'thriller'));
  assert.ok(notifs(author).some((x) => x.kind === 'mention_review' && x.target_type === 'post'));
  assert.ok(notifs(cited).some((x) => x.kind === 'mention_post'));

  await call(blocker, 'PUT', `/blocks/${sharer.user.id}`);
  const before = notifs(blocker).length;
  await call(sharer, 'POST', '/posts', { body: 'Coucou @so_bloqueur' });
  assert.equal(notifs(blocker).length, before, 'aucune notification à travers un blocage');
  // Critique d'un joueur qui m'a bloqué : impossible à citer.
  await call(blocker, 'PUT', '/ratings/album/thriller', { score: 3, review: 'Pas pour moi.' });
  const blockedReview = db.prepare("SELECT id FROM ratings WHERE user_id = ? AND item_id = 'thriller'").get(blocker.user.id).id;
  assert.equal((await call(sharer, 'POST', '/posts', { body: 'x', item: { type: 'review', id: String(blockedReview) } })).body.error, 'unknown_item');
});

test('discussions d’un album : posts des amis d’abord, puis tout le monde, curseur stable, ni « amis » d’inconnus ni bloqués', async () => {
  const me = await player();
  const friend = await player();
  const others = [await player(), await player()];
  const blocked = await player();
  befriend(me, friend);
  await call(me, 'PUT', `/blocks/${blocked.user.id}`);
  const say = async (who, body, visibility = 'public', id = 'abbey-road') => (await call(who, 'POST', '/posts', { body, item: { type: 'album', id }, visibility })).body.post;
  const o1 = await say(others[0], 'Inconnu 1');
  const fp = await say(friend, 'Ami');
  const o2 = await say(others[1], 'Inconnu 2');
  const hiddenFriendsOnly = await say(others[0], 'Amis seulement', 'friends');
  await say(blocked, 'Bloqué');
  await say(others[1], 'Autre album', 'public', 'thriller');
  // Dates distinctes pour un ordre déterministe.
  let t = Date.now() - 10_000;
  for (const p of [o1, fp, o2, hiddenFriendsOnly]) db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run(t += 1000, p.id);

  const first = (await call(me, 'GET', '/items/album/abbey-road/posts?limit=2')).body;
  assert.equal(first.items[0].id, fp.id, 'l’ami en tête');
  const ids = first.items.map((p) => p.id);
  let cursor = first.nextCursor;
  while (cursor) {
    const next = (await call(me, 'GET', `/items/album/abbey-road/posts?limit=2&cursor=${cursor}`)).body;
    ids.push(...next.items.map((p) => p.id));
    cursor = next.nextCursor;
  }
  assert.deepEqual(ids, [fp.id, o2.id, o1.id], 'sans doublon, le plus récent d’abord');
  assert.equal((await call(me, 'GET', '/items/album/nope/posts')).body.error, 'unknown_item');
  assert.equal((await call(me, 'GET', '/items/planet/x/posts')).body.error, 'unknown_item');
});

test('suspendu ou CGU à accepter : aucune écriture (post, commentaire, « J’aime »)', async () => {
  const me = await player();
  const other = await player();
  const p = (await call(other, 'POST', '/posts', { body: 'Bonjour' })).body.post;
  db.prepare('UPDATE users SET suspended_until = ? WHERE id = ?').run(Date.now() + 86_400_000, me.user.id);
  assert.equal((await call(me, 'POST', '/posts', { body: 'Je suis là' })).body.error, 'suspended');
  assert.equal((await call(me, 'POST', '/comments', { targetType: 'post', targetId: p.id, body: 'salut' })).body.error, 'suspended');
  assert.equal((await call(me, 'PUT', `/likes/post/${p.id}`)).body.error, 'suspended');
  assert.equal((await call(me, 'GET', `/posts/${p.id}`)).status, 200, 'la lecture reste possible');
});

test('événements post.created, comment.created, like.created avec ownerId', async () => {
  const me = await player();
  const other = await player();
  const seen = [];
  const offs = ['post.created', 'comment.created', 'like.created'].map((e) => deps.bus.on(e, (payload) => seen.push([e, payload])));
  const p = (await call(me, 'POST', '/posts', { body: 'Événements' })).body.post;
  await call(other, 'POST', '/comments', { targetType: 'post', targetId: p.id, body: 'ok' });
  await call(other, 'PUT', `/likes/post/${p.id}`);
  for (const off of offs) off?.();
  const by = (e) => seen.find(([name]) => name === e)?.[1];
  assert.equal(by('post.created').id, p.id);
  assert.equal(by('comment.created').ownerId, me.user.id);
  assert.equal(by('like.created').ownerId, me.user.id);
  assert.equal(by('like.created').targetType, 'post');
});

test('index : posts, commentaires et « J’aime » lus sans parcours complet de table', () => {
  const plan = (sql, ...args) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(' | ');
  const checks = [
    plan("SELECT id FROM posts WHERE item_type = 'album' AND item_id = 'x' AND hidden_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 10"),
    plan('SELECT id FROM posts WHERE user_id = 1 ORDER BY created_at DESC, id DESC LIMIT 10'),
    plan("SELECT id FROM comments WHERE target_type = 'post' AND target_id = 1 AND parent_id IS NULL ORDER BY created_at, id LIMIT 10"),
    plan("SELECT user_id FROM likes WHERE target_type = 'post' AND target_id = 1 ORDER BY created_at DESC LIMIT 10"),
  ];
  for (const p of checks) assert.doesNotMatch(p, /SCAN (posts|comments|likes)\b(?! USING)/, p);
});

test('performance : une page de discussions et un fil de 50 commentaires en quelques millisecondes', async () => {
  const me = await player();
  const author = await player();
  const ins = db.prepare("INSERT INTO posts (user_id, body, item_type, item_id, visibility, created_at) VALUES (?, ?, 'album', 'kind-of-blue', 'public', ?)");
  for (let i = 0; i < 400; i++) ins.run(author.user.id, `post ${i}`, Date.now() - i * 1000);
  const p = db.prepare("INSERT INTO posts (user_id, body, visibility, created_at) VALUES (?, 'Long fil', 'public', ?) RETURNING id").get(author.user.id, Date.now());
  const insC = db.prepare("INSERT INTO comments (target_type, target_id, user_id, body, created_at) VALUES ('post', ?, ?, ?, ?)");
  for (let i = 0; i < 300; i++) insC.run(p.id, author.user.id, `c ${i}`, Date.now() - 1e6 + i);
  const time = (fn) => {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      fn();
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };
  assert.ok(time(() => deps.social.itemPosts(me.user.id, 'album', 'kind-of-blue', { limit: '20' })) < 25);
  assert.ok(time(() => deps.social.listComments(me.user.id, { target: `post:${p.id}`, limit: '50' })) < 25);
});
