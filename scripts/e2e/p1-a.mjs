// Parcours P1-A (PLAN.md 9.4, 8.2 P1.1) : fil, posts, commentaires, J'aime, permaliens de critiques, notifications,
// ordinateur 1440 × 900 et téléphone 390 × 844.
//   - Accueil : le héros Boosters et la rangée Boutique / Doublons / Blind test restent en tête, inchangés ; le fil vient
//     dessous (onglets Tes amis · Pour toi · Communauté, Tes amis par défaut quand un ami est actif), la colonne
//     « Presque complets » à côté (ordinateur) ou rangée après la première page (téléphone), puis « Derniers morceaux ».
//   - Post avec une carte d'album (recherche « Citer », carte cliquable vers l'album), J'aime, commentaire, réponse (un
//     seul niveau), page /post/:id ; critique d'un ami : J'aime et « Répondre » sous la critique (page album), permalien
//     /review/:id avec réponses, « Partager » → « Publier dans le fil » (post qui cite la critique) ; notifications
//     groupées (« amie et 1 autre ont aimé ton post ») ; Discussions d'album (amis d'abord) quand la page album les monte
//     (P1-B).
//   - Démo autonome (dist-demo/albummania-demo.html) : les joueurs fictifs publient, aiment et répondent.
//   Zéro erreur de console (hors images Deezer bloquées par le bac à sable), pas de défilement horizontal.
//   BASE=http://localhost:5111 OUT=/tmp/am-p1-a/shots DATABASE_FILE=/tmp/am-p1-a/am.db node scripts/e2e/p1-a.mjs
//   (sans BASE : démarre sa propre copie sur 3111 / 5111 avec une copie neuve de $FIXTURE dans /tmp/am-p1-a/am.db)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, run, shot, fail, errors, finish, setBase, startStack, checkNoHorizontalScroll,
  launch, routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p1-a', apiPort: 3111, webPort: 5111, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);
const ALBUM = 'discovery';
const ALBUM_URL = `/album/${ALBUM}`;
const enc = encodeURIComponent;

// Joueurs créés directement dans la base du site visé, avec une session (pas de limite d'inscription par adresse IP,
// pas de parcours d'accueil) : le joueur suivi dans le navigateur, son amie, un inconnu.
const DB_FILE = process.env.DATABASE_FILE || '/tmp/am-p1-a/am.db';
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA busy_timeout = 5000');
const { config } = await import('../../server/config.js');

/** Joueur vérifié (CGU acceptées, accueil fait, quelques boosters) avec une session ; { id, username, token, cookie }. */
function seedUser(username) {
  const now = Date.now();
  const { id } = db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at,
      terms_accepted_at, terms_version, onboarded_at, bonus_packs) VALUES (?, ?, 'x', ?, ?, ?, ?, ?, ?, 5) RETURNING id`)
    .get(`${username}@example.com`, username, now, now, now, now, config.termsVersion, now);
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(crypto.createHash('sha256').update(token).digest('hex'), id, now, now + 86_400_000);
  return { id, username, token, cookie: `albummania_sid=${token}` };
}

/** Appel de l'API (par le site visé) avec la session d'un joueur. */
async function callAs(user, method, apiPath, data) {
  const res = await fetch(`${BASE}/api${apiPath}`, {
    method,
    headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json', Cookie: user.cookie },
    ...(data !== undefined && { body: JSON.stringify(data) }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const must = async (label, promise, status = [200, 201]) => {
  const r = await promise;
  if (!status.includes(r.status)) fail(`[setup] ${label} : ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

/** Ouvre le navigateur avec la session de `user`. */
async function signIn(page, ctx, user) {
  await ctx.addCookies([{ name: 'albummania_sid', value: user.token, url: BASE }]);
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.hero');
}

const pathOf = (page) => new URL(page.url()).pathname;
const before = (page, a, b) => page.evaluate(([x, y]) => {
  const ea = document.querySelector(x);
  const eb = document.querySelector(y);
  return !!ea && !!eb && !!(ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING);
}, [a, b]);

// ---------- préparation ----------

const player = seedUser(`p1a_${stamp}`);
const friend = seedUser(`amie_${stamp}`);
const stranger = seedUser(`autre_${stamp}`);
const phonePlayer = seedUser(`p1am_${stamp}`);

// Amitiés : le joueur (et le joueur du téléphone) avec l'amie.
for (const who of [player, phonePlayer]) {
  await must('demande d’ami', callAs(who, 'POST', '/friends/request', { username: friend.username }));
  const inbox = await callAs(friend, 'GET', '/friends');
  const req = inbox.body?.incoming?.find((x) => x.user.username === who.username);
  if (!req) throw new Error('demande d’ami non reçue');
  await must('acceptation', callAs(friend, 'POST', `/friends/${req.requestId}/accept`));
}
// Un booster pour avoir des albums commencés (colonne « Presque complets »).
for (const who of [player, phonePlayer]) {
  for (let i = 0; i < 3; i++) await must('booster', callAs(who, 'POST', '/packs/open', { count: 1 }));
}

// L'amie : une critique de Discovery (J'aime, réponses), un post qui cite l'album ; l'inconnu : un post public.
await must('critique de l’amie', callAs(friend, 'PUT', `/ratings/album/${ALBUM}`, { score: 9, review: 'Le disque des trajets de nuit, du début à la fin.' }));
const friendPost = (await must('post de l’amie', callAs(friend, 'POST', '/posts', {
  body: `Réécouté ${'Discovery'} d’une traite ce soir. Digital Love vieillit tellement bien.`, item: { type: 'album', id: ALBUM }, visibility: 'public',
}))).post;
await must('post de l’inconnu', callAs(stranger, 'POST', '/posts', { body: 'Premier post de la communauté, bonjour à tous !', visibility: 'public' }));
await must('critique de l’inconnu', callAs(stranger, 'PUT', `/ratings/album/${ALBUM}`, { score: 7, review: 'Un classique, même si la fin traîne un peu.' }));
const reviewId = (await callAs(friend, 'GET', `/ratings/album/${ALBUM}`)).body?.mine?.id;
if (!reviewId) fail('[setup] identifiant de la critique de l’amie absent');

// ---------- ordinateur ----------

/** Relève les réponses HTTP en erreur (hors 404 attendus) avec leur adresse, pour le diagnostic. */
function watchHttp(page, label, expected = []) {
  page.on('response', (r) => {
    const url = r.url();
    if (r.status() >= 400 && url.includes('/api/') && !expected.some((x) => url.includes(x))) console.log(`[${label}] HTTP ${r.status()} ${url}`);
  });
}

await run('desktop', VIEWPORTS.desktop, async (page, ctx) => {
  watchHttp(page, 'desktop');
  await signIn(page, ctx, player);

  // 1. Accueil : héros et rangée en tête, puis le fil (Tes amis par défaut), la colonne, « Derniers morceaux ».
  await page.waitForSelector('[data-feed-item]');
  if (!(await before(page, '.hero', '.home-panels')) || !(await before(page, '.home-panels', '.so-home'))) fail('[desktop] le fil doit venir sous le héros et la rangée');
  if (!(await before(page, '.so-home', '[data-home="recent"]'))) fail('[desktop] « Derniers morceaux obtenus » doit suivre le fil');
  const active = await page.getAttribute('.so-tabs .seg__btn.is-on', 'data-tab');
  if (active !== 'friends') fail(`[desktop] onglet par défaut : ${active}, attendu friends`);
  if (!(await page.locator('.so-aside [data-home="almost"]').count())) fail('[desktop] colonne « Presque complets » absente');
  await shot(page, 'd-10-home');
  await page.locator('.so-home').scrollIntoViewIfNeeded();
  await shot(page, 'd-11-home-feed');

  // 2. Le post de l'amie : carte de mention de l'album, cliquable vers sa page.
  const fpost = page.locator(`[data-post="${friendPost.id}"]`);
  await fpost.waitFor();
  const mention = fpost.locator('a.mention[data-mention="album"]');
  if ((await mention.getAttribute('href')) !== ALBUM_URL) fail(`[desktop] lien de la carte de mention : ${await mention.getAttribute('href')}`);

  // 3. J'aime sur le post de l'amie, puis un commentaire et une réponse.
  const like = fpost.locator('.post__actions .act-btn--like');
  await like.click();
  await page.waitForFunction((id) => document.querySelector(`[data-post="${id}"] .act-btn--like`)?.getAttribute('aria-pressed') === 'true', friendPost.id);
  await fpost.locator('.post__actions .act-btn').nth(1).click();
  const box = fpost.locator('.composer--root input');
  await box.waitFor();
  await box.fill('Pareil, la face B est parfaite.');
  await fpost.locator('.composer--root button[type=submit]').click();
  await fpost.locator('.comment__text', { hasText: 'la face B est parfaite' }).waitFor();
  // L'amie répond ; le joueur répond à sa réponse (rattachée au commentaire de tête, « à @amie »).
  const comments = await callAs(friend, 'GET', `/comments?target=post:${friendPost.id}`);
  const top = comments.body?.items?.[0];
  await must('réponse de l’amie', callAs(friend, 'POST', '/comments', { targetType: 'post', targetId: friendPost.id, parentId: top?.id, body: 'Oui, Voyager surtout !' }));
  await page.goto(`${BASE}/post/${friendPost.id}`);
  await page.waitForSelector('[data-page="post"] .comment');
  const reply = page.locator('.comment', { hasText: 'Voyager surtout' });
  await reply.locator('.comment__actions .act-btn', { hasText: 'Répondre' }).click();
  await page.locator('.thread:not(.thread--root) .composer input').fill('Et Veridis Quo.');
  await page.locator('.thread:not(.thread--root) .composer button[type=submit]').click();
  await page.locator('.comment', { hasText: 'Et Veridis Quo' }).waitFor();
  const replyTo = await page.locator('.comment', { hasText: 'Et Veridis Quo' }).locator('.comment__to').textContent().catch(() => '');
  if (!replyTo.includes(friend.username)) fail(`[desktop] réponse à une réponse : « ${replyTo} », attendu « à @${friend.username} »`);
  await shot(page, 'd-20-post-page');
  await checkNoHorizontalScroll(page, 'desktop post');
  const notifs = await callAs(friend, 'GET', '/notifications');
  const kinds = new Set((notifs.body?.items || []).map((n) => n.kind));
  // Commentaires et réponses d'un même fil sont groupés (comment:post:<id>) : la ligne porte le dernier type.
  if (!kinds.has('like_post')) fail(`[desktop] notification like_post absente chez l'amie (${[...kinds]})`);
  if (!kinds.has('comment_post') && !kinds.has('reply_comment')) fail(`[desktop] notification de commentaire absente chez l'amie (${[...kinds]})`);

  // 4. Publier un post qui cite un album (recherche « Citer »), il arrive en tête du fil.
  await page.goto(`${BASE}/`);
  await page.waitForSelector('[data-composer="home"]');
  const composer = page.locator('[data-composer="home"]');
  await composer.locator('textarea').fill('Mon album du moment, à écouter en entier.');
  await composer.locator('.so-composer__tools .act-btn').first().click();
  await composer.locator('.so-composer__picker input').fill('Abbey Road');
  const option = composer.locator('[role="option"]', { hasText: 'Abbey Road' }).first();
  await option.waitFor({ timeout: 15_000 });
  await option.click();
  await composer.locator('.so-composer__mention .mention').waitFor();
  await shot(page, 'd-30-composer');
  await composer.locator('button[type=submit]').click();
  const mine = page.locator('[data-feed-item="post"] .post', { hasText: 'Mon album du moment' }).first();
  await mine.waitFor();
  if ((await mine.locator('a.mention').getAttribute('href')) !== '/album/abbey-road') fail('[desktop] le post publié ne cite pas Abbey Road');
  const myPostId = Number(await mine.getAttribute('data-post'));
  await shot(page, 'd-31-posted');

  // 5. Notifications groupées : l'amie et l'inconnu aiment le post → une seule ligne « amie et 1 autre ».
  await must('J’aime de l’amie', callAs(friend, 'PUT', `/likes/post/${myPostId}`));
  await must('J’aime de l’inconnu', callAs(stranger, 'PUT', `/likes/post/${myPostId}`));
  const mineNotifs = await callAs(player, 'GET', '/notifications');
  const likeGroups = (mineNotifs.body?.items || []).filter((n) => n.kind === 'like_post' && n.target?.id === String(myPostId));
  if (likeGroups.length !== 1 || likeGroups[0].actorCount !== 2) fail(`[desktop] notification groupée : ${JSON.stringify(likeGroups.map((n) => [n.actorCount, n.actors?.length]))}`);
  await page.goto(`${BASE}/notifications`);
  await page.waitForSelector('.notif');
  await shot(page, 'd-40-notifications');
  const notifLink = page.locator(`a[href="/post/${myPostId}"]`).first();
  if (!(await notifLink.count())) fail('[desktop] la notification ne mène pas au post');

  // 6. Critique de l'amie sur la page album : J'aime, « Répondre » vers le permalien.
  await page.goto(`${BASE}${ALBUM_URL}`);
  const review = page.locator(`#review-${reviewId}`);
  await review.waitFor({ timeout: 15_000 });
  await review.scrollIntoViewIfNeeded();
  const rlike = review.locator('.review__foot .act-btn--like');
  await rlike.click();
  await page.waitForFunction((id) => document.querySelector(`#review-${id} .act-btn--like`)?.getAttribute('aria-pressed') === 'true', reviewId);
  await shot(page, 'd-50-album-reviews');
  // Tri « Populaires » des critiques de la communauté (au moins deux critiques).
  const popular = page.locator('.so-sort .seg__btn', { hasText: 'Populaires' });
  if (await popular.count()) {
    await popular.click();
    await page.waitForSelector('.trk-group--community .review');
  }
  // Discussions de l'album (emplacement monté par la page album de P1-B) : le post de l'amie dans « Vos amis ».
  if (await page.locator('[data-discussions]').count()) {
    const disc = page.locator('[data-discussions]');
    await disc.locator(`[data-post="${friendPost.id}"]`).waitFor();
    if (!(await disc.textContent()).includes('Vos amis')) fail('[desktop] Discussions : « Vos amis » absent');
  } else {
    console.log('Discussions pas encore montées sur la page album (P1-B) : vérification sautée.');
  }
  await review.locator('[data-replies]').click();
  await page.waitForURL(`**/review/${reviewId}`);
  await page.waitForSelector('[data-page="review"] .mention');
  const tbox = page.locator('[data-page="review"] .composer--root input');
  await tbox.fill('Complètement d’accord pour les trajets de nuit.');
  await page.locator('[data-page="review"] .composer--root button[type=submit]').click();
  await page.locator('[data-page="review"] .comment__text', { hasText: 'trajets de nuit' }).waitFor();
  if ((await page.getAttribute('[data-page="review"] .mention', 'href')) !== ALBUM_URL) fail('[desktop] permalien : carte de l’album absente');
  await shot(page, 'd-60-review-page');

  // 6 bis. « Partager » la critique → « Publier dans le fil » : un post qui la cite (carte de la critique), notifié à l'amie.
  await page.locator('[data-page="review"] .so-review--page [data-share="review"]').click();
  await page.locator('[data-share-action="feed"]').click();
  const dialog = page.locator('.so-share-modal');
  await dialog.locator('[data-share-preview="review"] .so-review--embed').waitFor();
  await dialog.locator('textarea').fill('À lire absolument.');
  await page.waitForTimeout(400); // fin de l'animation d'ouverture
  await shot(page, 'd-61-share-review');
  await dialog.locator('button[type=submit]').click();
  await dialog.waitFor({ state: 'detached' });
  const mineNow = await callAs(player, 'GET', `/users/${player.username}/posts`);
  const shared = (mineNow.body?.items || []).find((p) => p.item?.type === 'review' && Number(p.item.id) === reviewId);
  if (!shared?.review) fail('[desktop] le post qui partage la critique est absent (ou sans sa critique)');

  const fn = await callAs(friend, 'GET', '/notifications');
  const fk = new Set((fn.body?.items || []).map((n) => n.kind));
  for (const k of ['like_review', 'comment_review', 'mention_review']) if (!fk.has(k)) fail(`[desktop] notification ${k} absente chez l'amie`);

  // 7. Le post qui partage la critique est dans le fil (carte de la critique) ; onglets Pour toi et Communauté.
  await page.goto(`${BASE}/`);
  if (shared) {
    const sharedCard = page.locator(`[data-post="${shared.id}"] .so-review--embed`);
    await sharedCard.waitFor();
    await sharedCard.scrollIntoViewIfNeeded();
    await shot(page, 'd-62-shared-review-in-feed');
  }
  await page.locator('.so-tabs [data-tab="community"]').click();
  await page.locator('[data-feed-tab="community"] [data-feed-item]').first().waitFor();
  await page.locator('.so-tabs [data-tab="foryou"]').click();
  await page.waitForSelector('[data-feed-tab="foryou"]');
  await page.waitForFunction(() => !document.querySelector('.so-feed[aria-busy="true"]'));
  await shot(page, 'd-65-foryou');
});

// Post introuvable : « Ce post n'est plus là » (le 404 de l'API est la réponse attendue, que le navigateur écrit dans
// la console : il est retiré du bilan, et seulement lui).
await run('gone', VIEWPORTS.desktop, async (page, ctx) => {
  await signIn(page, ctx, player);
  await page.goto(`${BASE}/post/99999999`);
  await page.waitForSelector('[data-page="post"] .empty-state');
  await shot(page, 'd-70-post-gone');
  await page.goto(`${BASE}/review/99999999`);
  await page.waitForSelector('[data-page="review"] .empty-state');
});
for (let i = errors.length - 1; i >= 0; i--) if (/^\[gone\] console: Failed to load resource: .*404/.test(errors[i])) errors.splice(i, 1);

// ---------- téléphone ----------

await run('phone', VIEWPORTS.phone, async (page, ctx) => {
  await signIn(page, ctx, phonePlayer);
  await page.waitForSelector('[data-feed-item]');
  await shot(page, 'm-10-home');
  await checkNoHorizontalScroll(page, 'phone home');
  // La colonne se range dans le fil (après sa première page), pas à côté.
  if (await page.locator('aside.so-aside').count()) fail('[phone] colonne affichée à côté du fil');
  if (!(await page.locator('.so-insert [data-home="almost"]').count())) fail('[phone] « Presque complets » absent du fil');
  await page.locator('.so-home').scrollIntoViewIfNeeded();
  await shot(page, 'm-11-feed');
  await page.locator('.so-insert').scrollIntoViewIfNeeded();
  await shot(page, 'm-12-aside');
  await shot(page, 'm-13-home-full', { fullPage: true });

  // J'aime et commentaire depuis le téléphone.
  const fpost = page.locator(`[data-post="${friendPost.id}"]`);
  await fpost.scrollIntoViewIfNeeded();
  await fpost.locator('.post__actions .act-btn--like').click();
  await page.waitForFunction((id) => document.querySelector(`[data-post="${id}"] .act-btn--like`)?.getAttribute('aria-pressed') === 'true', friendPost.id);
  await fpost.locator('.post__actions .act-btn').nth(1).click();
  await fpost.locator('.composer--root input').fill('Vu sur mon téléphone !');
  await fpost.locator('.composer--root button[type=submit]').click();
  await fpost.locator('.comment__text', { hasText: 'Vu sur mon téléphone' }).waitFor();
  await shot(page, 'm-20-thread');
  await checkNoHorizontalScroll(page, 'phone thread');

  // Composer avec une citation sur téléphone.
  const composer = page.locator('[data-composer="home"]');
  await composer.scrollIntoViewIfNeeded();
  // Champ encore vide : le focus déplie le compositeur, « Citer » ne bouge pas sous le doigt.
  await composer.locator('textarea').click();
  await composer.locator('.so-composer__tools .act-btn').first().click();
  await composer.locator('.so-composer__picker input').fill('Thriller');
  await composer.locator('[role="option"]', { hasText: 'Thriller' }).first().click();
  await composer.locator('.so-composer__mention .mention').waitFor();
  await composer.locator('textarea').fill('Depuis le métro.');
  await shot(page, 'm-30-composer');
  await checkNoHorizontalScroll(page, 'phone composer');
  await composer.locator('button[type=submit]').click();
  await page.locator('.post', { hasText: 'Depuis le métro' }).first().waitFor();

  // Permalien et page post sur téléphone.
  await page.goto(`${BASE}/review/${reviewId}`);
  await page.waitForSelector('[data-page="review"] .comment');
  await shot(page, 'm-40-review-page');
  await checkNoHorizontalScroll(page, 'phone review');
  await page.goto(`${BASE}/post/${friendPost.id}`);
  await page.waitForSelector('[data-page="post"] .comment');
  await shot(page, 'm-50-post-page', { fullPage: true });
  await checkNoHorizontalScroll(page, 'phone post');
  await page.goto(`${BASE}${ALBUM_URL}`);
  await page.locator(`#review-${reviewId}`).waitFor({ timeout: 15_000 });
  await page.locator(`#review-${reviewId}`).scrollIntoViewIfNeeded();
  await shot(page, 'm-60-album-reviews');
  await checkNoHorizontalScroll(page, 'phone album');
  // Menu « Partager » d'une critique sur téléphone : il tient dans l'écran ; la fenêtre de partage aussi.
  await page.locator(`#review-${reviewId} [data-share="review"]`).click();
  await page.locator('[data-share-action="feed"]').waitFor();
  await checkNoHorizontalScroll(page, 'phone share menu');
  const pop = await page.locator('.so-share__pop').boundingBox();
  if (!pop || pop.x < 0 || pop.x + pop.width > 390) fail(`[phone] menu Partager hors de l'écran : ${JSON.stringify(pop)}`);
  await page.waitForTimeout(400); // fin de l'animation d'ouverture
  await shot(page, 'm-61-share-menu');
  await page.locator('[data-share-action="feed"]').click();
  await page.locator('.so-share-modal [data-share-preview="review"]').waitFor();
  await page.waitForTimeout(400); // fin de l'animation d'ouverture
  await shot(page, 'm-62-share-dialog');
  await page.keyboard.press('Escape');
  await page.locator('.so-share-modal').waitFor({ state: 'detached' });
});

// ---------- démo autonome ----------

const demoFile = path.join(ROOT, 'dist-demo/albummania-demo.html');
if (fs.existsSync(demoFile)) {
  const b = await launch();
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const ctx = await b.newContext({ viewport, locale: 'fr-FR' });
    await routeFonts(ctx);
    const page = await ctx.newPage();
    const label = `demo-${name}`;
    const p = name === 'desktop' ? 'd' : 'm';
    page.on('pageerror', (e) => fail(`[${label}] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${label}] console: ${m.text()}`));
    try {
      await page.goto(`file://${demoFile}`);
      await page.waitForSelector('.auth__form', { timeout: 20_000 });
      await page.getByText(/Créer un compte/).first().click();
      await page.waitForSelector('#su-email');
      await page.fill('#su-email', `demo_a_${name}@example.com`);
      await page.fill('#su-user', `demoa_${name}`);
      await page.fill('#su-pw', 'motdepasse123');
      if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', 'motdepasse123');
      for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
      await page.waitForSelector('.field__ok');
      await page.click('button[type=submit]');
      await page.click('.demo-mail .btn');
      // Parcours d'accueil (P1-E) : passé s'il s'affiche.
      await page.waitForSelector('.hero, [data-onboarding]', { timeout: 20_000 });
      if (!(await page.locator('.hero').count())) {
        await page.goto(`file://${demoFile}`);
        await page.waitForSelector('.hero');
      }
      // Les joueurs fictifs ont publié : le fil (Communauté pour un compte sans ami) n'est pas vide.
      await page.waitForSelector('[data-feed-item="post"]', { timeout: 15_000 });
      await page.locator('.so-home').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${p}-80-demo-feed.png` });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} home`);
      // Un post de bot avec ses commentaires : J'aime, ouverture du fil.
      const post = page.locator('[data-feed-item="post"] .post').first();
      await post.locator('.post__actions .act-btn--like').click();
      await page.waitForFunction(() => document.querySelector('[data-feed-item="post"] .act-btn--like')?.getAttribute('aria-pressed') === 'true');
      await post.locator('.post__actions .act-btn').nth(1).click();
      await post.locator('.composer--root').waitFor();
      // Publier : un joueur fictif aime et répond peu après (notifications vivantes).
      const composer = page.locator('[data-composer="home"]');
      await composer.locator('textarea').fill('Bonjour la démo !');
      await composer.locator('button[type=submit]').click();
      await page.locator('.post', { hasText: 'Bonjour la démo' }).first().waitFor();
      // Les réactions arrivent quelques secondes plus tard ; la lecture suivante du fil les écrit (notifications).
      await page.waitForTimeout(4500);
      await page.locator('.so-tabs [data-tab="foryou"]').click();
      await page.locator('[data-feed-tab="foryou"] [data-feed-item]').first().waitFor();
      await page.locator('.bell').first().click();
      if (name === 'desktop') {
        await page.waitForSelector('.notif-panel .notif', { timeout: 15_000 });
        await page.locator('.notif-panel__foot a').click();
      }
      await page.waitForSelector('main .notif', { timeout: 15_000 });
      await page.screenshot({ path: `${OUT}/${p}-81-demo-notifications.png` });
      const text = await page.textContent('main');
      if (!/aimé ton post|commenté ton post/.test(text)) fail(`[${label}] aucune réaction des joueurs fictifs dans les notifications : ${text.slice(0, 200)}`);
    } catch (err) {
      await page.screenshot({ path: `${OUT}/zz-error-${label}.png` }).catch(() => {});
      fail(`[${label}] ${err.message}`);
    } finally {
      await ctx.close();
    }
  }
} else {
  console.log('Démo absente (npm run build:demo) : partie démo sautée.');
}

db.close();
await finish('Parcours P1-A sans erreur.');
if (stack) await stack.stop();
