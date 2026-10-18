// Phrase du propriétaire en fin de niveau P1 (PLAN.md 9.8, point 6) : « Je veux créer mon compte, noter mes albums et
// commencer ma collection. » Sur un compte neuf, de bout en bout dans le navigateur, sur ordinateur (1440 × 900) puis
// sur téléphone (390 × 844), sans erreur de console :
//   1. inscription par le formulaire (CGU + 15 ans ou plus), lien de confirmation → premiers pas (/welcome) ;
//      ordinateur : genres, artistes, 4 albums, une note, résultat ; téléphone : « Plus tard » (tout passer) ;
//   2. noter un album avec une demi-étoile (3,5 étoiles) et une critique (relue par l'API) ;
//   3. ouvrir un booster depuis le héros de l'accueil (animation d'ouverture inchangée : paquet, cartes, résumé) ;
//   4. voir la collection (cartes obtenues) ;
//   5. publier un post qui cite un album (compositeur de l'accueil) ;
//   6. « Mes 9 albums » rempli à 9 par la recherche, puis « Générer l'image » (PNG 1080 × 1350 relu dans l'aperçu) ;
//   7. un ami (accepté) publie : son activité arrive en tête de l'onglet « Tes amis », l'onglet par défaut.
//   FIXTURE=<fixture20k.db> ROUTE_FONTS_VIA_CURL=1 OUT=/tmp/am-int/shots node scripts/e2e/p1.mjs
// Sans BASE : copie neuve du catalogue sur les ports de l'intégration (3118 / 5118), arrêtée à la fin.
import * as lib from './lib.mjs';

const {
  BASE: INITIAL_BASE, VIEWPORTS, run, shot, fail, finish, setBase, startStack, fillSignup, lastMailToken, signupViaApi,
  apiCall, checkNoHorizontalScroll, launch, routeFonts,
} = lib;

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'int-owner', apiPort: 3118, webPort: 5118, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);

// Albums de base pour compléter « Mes 9 albums » : [id, recherche, texte de l'option].
const NINE = [
  ['abbey-road', 'abbey road', 'The Beatles'],
  ['thriller', 'thriller', 'Michael Jackson'],
  ['back-to-black', 'back to black', 'Amy Winehouse'],
  ['nevermind', 'nevermind', 'Nirvana'],
  ['kind-of-blue', 'kind of blue', 'Miles Davis'],
  ['moon-safari', 'moon safari', 'Air'],
  ['exodus', 'exodus', 'Bob Marley'],
  ['racine-carree', 'racine carr', 'Stromae'],
  ['the-dark-side-of-the-moon', 'dark side of the moon', 'Pink Floyd'],
  ['a-night-at-the-opera', 'night at the opera', 'Queen'],
  ['histoire-de-melody-nelson', 'melody nelson', 'Gainsbourg'],
  ['graduation', 'graduation', 'Kanye West'],
];

/** Un ami créé par l'API dans son propre contexte (cookies séparés). */
async function friendAccount(username) {
  const b = await launch();
  const ctx = await b.newContext({ viewport: VIEWPORTS.desktop, locale: 'fr-FR' });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/legal/terms`);
  const user = await signupViaApi(page, `${username}@example.com`, username);
  return { page, ctx, user, username };
}

async function must(label, promise) {
  const res = await promise;
  if (res.status >= 300) fail(`${label} : ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return res.body;
}

/** Clic dans un champ d'étoiles à la fraction `at` de sa largeur (0,65 → 7/10 = 3,5 étoiles). */
async function clickStars(page, scope, at) {
  const box = await scope.locator('.star-input__stars').first().boundingBox();
  await page.mouse.click(box.x + box.width * at, box.y + box.height / 2);
}

/** Premiers pas complets (ordinateur) : 3 genres, 3 artistes, 4 albums proposés, une note, résultat. */
async function onboardingFull(page, label) {
  await page.waitForSelector('[data-onboarding="genres"] .genre-btn');
  await shot(page, `${label}-02-welcome`);
  const next = page.locator('[data-onboarding-next]');
  const genres = page.locator('.genre-btn');
  for (let i = 0; i < 3; i++) await genres.nth(i).click();
  await next.click();
  await page.waitForSelector('[data-onboarding="artists"] .pick-artist');
  const artists = page.locator('.pick-artist');
  for (let i = 0; i < 3; i++) await artists.nth(i).click();
  await next.click();
  await page.waitForSelector('[data-onboarding="nine"] .dc-pick');
  const picks = page.locator('.dc-pick:not([disabled])');
  for (let i = 0; i < 4; i++) await picks.nth(i).click();
  await next.click();
  await page.waitForSelector('[data-onboarding="rate"] .dc-rate__item');
  await clickStars(page, page.locator('.dc-rate__item').first(), 0.85);
  await next.click();
  await page.waitForSelector('[data-onboarding="result"] [data-result="recommendations"] .album-tile', { timeout: 20_000 });
  await shot(page, `${label}-03-welcome-result`, { fullPage: true });
}

/** Remplit les cases vides de « Mes 9 albums » par la recherche (albums pas encore dans la grille). */
async function fillNine(page, label) {
  const present = () => page.$$eval('.ls-nine .ls-nine__cell', (cells) => cells.map((c) => c.querySelector('[data-album]')?.dataset.album || null));
  let guard = 0;
  for (;;) {
    const slots = await present();
    const empty = slots.indexOf(null);
    if (empty < 0) break;
    if (guard++ > 12) return fail(`[${label}] « Mes 9 albums » : cases encore vides après 12 essais (${slots})`);
    const candidate = NINE.find(([id]) => !slots.includes(id));
    if (!candidate) return fail(`[${label}] plus d'album de base à proposer`);
    const [, query, hint] = candidate;
    await page.locator(`.ls-nine [data-slot="${empty}"]`).first().click();
    const dialog = page.locator('[data-nine-picker]');
    await dialog.waitFor();
    await page.waitForFunction(() => document.activeElement?.classList.contains('gsearch__input'), null, { timeout: 3000 }).catch(() => {});
    await dialog.locator('.gsearch__input').fill(query);
    const option = dialog.locator('[role="option"]', { hasText: hint }).first();
    await option.waitFor({ timeout: 15_000 });
    await option.click();
    await dialog.waitFor({ state: 'detached' });
    await page.locator(`.ls-nine [data-slot="${empty}"] .ls-nine__hit`).waitFor();
  }
}

async function ownerSentence(label, viewport) {
  const p = label === 'desktop' ? 'd' : 'p';
  const me = `owner_${p}${stamp}`;
  const friend = await friendAccount(`ami_${p}${stamp}`);
  await run(label, viewport, async (page) => {
    // 1. Inscription : formulaire (CGU et 15 ans cochés), boîte de test, lien de confirmation → premiers pas.
    await fillSignup(page, { email: `${me}@example.com`, username: me });
    // Une case : « J'accepte les CGU et j'ai 15 ans ou plus » (P0-D), requise.
    if (!(await page.locator('#su-terms').isChecked())) fail(`[${label}] inscription : case CGU / 15 ans non cochée`);
    if (!/15/.test(await page.locator('label:has(#su-terms), #su-terms + span').first().innerText())) fail(`[${label}] inscription : la case ne mentionne pas les 15 ans`);
    await shot(page, `${p}-01-signup`);
    await page.click('button[type=submit]');
    await page.waitForURL('**/check-email');
    await page.goto(`${BASE}/verify?token=${await lastMailToken(page, `${me}@example.com`)}`);
    await page.waitForSelector('[data-onboarding]', { timeout: 20_000 });
    if (label === 'desktop') {
      await onboardingFull(page, p);
      await page.click('[data-open-boosters]');
    } else {
      await shot(page, `${p}-02-welcome`);
      await page.click('[data-onboarding-later]');
    }
    await page.waitForSelector('.hero');
    // L'accueil d'après les premiers pas : le héros et la rangée en tête, inchangés, les blocs P1 en dessous.
    await shot(page, `${p}-04-home`);
    const order = await page.evaluate(() => {
      const top = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? null;
      return { hero: top('.hero'), row: top('#boutique'), feed: top('.so-home') };
    });
    if (!(order.hero < order.row && order.row < order.feed)) fail(`[${label}] ordre de l'accueil : ${JSON.stringify(order)}`);
    if (label === 'phone') await checkNoHorizontalScroll(page, `${label} accueil`);

    // 2. Noter un album : 3,5 étoiles (7/10, une demi-étoile) et une critique.
    await page.goto(`${BASE}/album/discovery`);
    await page.waitForSelector('.album-head');
    const editor = page.locator('.review-editor').first();
    await editor.scrollIntoViewIfNeeded();
    await clickStars(page, editor, 0.65);
    // Sur la page d'album, le champ de la critique est déjà ouvert ; ailleurs, « Ajouter une critique » l'ouvre.
    if (!(await editor.locator('textarea').count())) await editor.locator('.link-btn').first().click();
    const review = `Discovery, de bout en bout : Digital Love reste mon morceau préféré (${p}${stamp}).`;
    await editor.locator('textarea').fill(review);
    await editor.locator('.review-editor__actions .btn--primary').click();
    await page.waitForFunction(() => !document.querySelector('.review-editor .review-editor__actions .btn--primary:not([disabled])'), null, { timeout: 10_000 }).catch(() => {});
    const rated = await apiCall(page, 'GET', '/ratings/album/discovery');
    if (rated.body?.mine?.score !== 7) fail(`[${label}] note enregistrée : ${rated.body?.mine?.score} (7/10 attendu, 3,5 étoiles)`);
    if (rated.body?.mine?.review !== review) fail(`[${label}] critique enregistrée : « ${rated.body?.mine?.review} »`);
    await shot(page, `${p}-05-album-rated`);

    // 3. Ouvrir un booster depuis le héros : paquet, cartes retournées une à une, résumé (PackOpening inchangé).
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.hero');
    const cardsBefore = (await apiCall(page, 'GET', '/state')).body?.cards?.length ?? 0;
    await page.click('.hero__actions .btn--primary');
    await page.waitForSelector('.opening');
    await shot(page, `${p}-06-pack`);
    await page.click('.opening__pack-btn');
    await page.waitForSelector('.reveal-card', { timeout: 8000 });
    for (let i = 0; i < 5 && !(await page.locator('.summary').count()); i++) {
      await page.click('.opening__stage');
      await page.waitForTimeout(700);
      if (i === 0) await shot(page, `${p}-07-reveal`);
      await page.click('.opening__stage');
      await page.waitForTimeout(350);
    }
    await page.waitForSelector('.summary', { timeout: 10_000 });
    await shot(page, `${p}-08-summary`);
    await page.click('.summary__actions .btn--ghost');
    const cardsAfter = (await apiCall(page, 'GET', '/state')).body?.cards?.length ?? 0;
    if (!(cardsAfter > cardsBefore)) fail(`[${label}] booster : ${cardsBefore} → ${cardsAfter} cartes`);

    // 4. La collection : les cartes obtenues.
    await page.goto(`${BASE}/collection/cards`);
    await page.waitForSelector('.collection .card');
    await shot(page, `${p}-09-collection`);
    if (label === 'phone') await checkNoHorizontalScroll(page, `${label} collection`);

    // 5. Publier un post qui cite un album, depuis le compositeur de l'accueil.
    await page.goto(`${BASE}/`);
    const composer = page.locator('[data-composer="home"]');
    await composer.waitFor();
    await composer.scrollIntoViewIfNeeded();
    await composer.locator('textarea').click();
    await composer.locator('textarea').fill(`Premier booster, premier album noté : Discovery (${p}${stamp}).`);
    await composer.locator('.so-composer__tools .act-btn').first().click();
    await composer.locator('.so-composer__picker input').fill('Discovery');
    const option = composer.locator('[role="option"]', { hasText: 'Daft Punk' }).first();
    await option.waitFor({ timeout: 15_000 });
    await option.click();
    await composer.locator('.so-composer__mention .mention').waitFor();
    await composer.locator('button[type=submit]').click();
    const mine = page.locator('[data-feed-item="post"] .post', { hasText: `(${p}${stamp})` }).first();
    await mine.waitFor({ timeout: 10_000 });
    if ((await mine.locator('a.mention').getAttribute('href')) !== '/album/discovery') fail(`[${label}] le post publié ne cite pas Discovery`);
    await mine.scrollIntoViewIfNeeded();
    await shot(page, `${p}-10-posted`);

    // 6. « Mes 9 albums » : 9 cases remplies par la recherche, puis l'image (aperçu PNG 4:5, 1080 × 1350).
    await page.goto(`${BASE}/nine`);
    await page.waitForSelector('[data-nine-editor] .ls-nine');
    await fillNine(page, label);
    await page.waitForSelector('[data-save-status="saved"]', { timeout: 10_000 }).catch(() => {});
    await shot(page, `${p}-11-nine`);
    if (label === 'phone') await checkNoHorizontalScroll(page, `${label} Mes 9 albums`);
    const grid = await apiCall(page, 'GET', '/me/grid9');
    const filled = (grid.body?.slots || []).filter(Boolean).length;
    if (filled !== 9) fail(`[${label}] Mes 9 albums enregistré avec ${filled} albums`);
    await page.click('[data-generate]');
    const img = page.locator('img[data-share-image]:not(.is-stale)');
    await img.waitFor({ timeout: 30_000 });
    const width = Number(await img.getAttribute('data-width'));
    const height = Number(await img.getAttribute('data-height'));
    const bytes = Number(await img.getAttribute('data-bytes'));
    if (width !== 1080 || height !== 1350) fail(`[${label}] image de « Mes 9 albums » : ${width} × ${height} (1080 × 1350 attendu)`);
    if (!(bytes > 20_000)) fail(`[${label}] image trop petite : ${bytes} octets`);
    await shot(page, `${p}-12-nine-image`);
    await page.keyboard.press('Escape');

    // 7. Un ami : demande acceptée, puis il publie une critique ; elle arrive en tête de « Tes amis » (onglet par défaut).
    await must('demande d’ami', apiCall(friend.page, 'POST', '/friends/request', { username: me }));
    const list = await apiCall(page, 'GET', '/friends');
    const incoming = (list.body?.incoming || []).find((x) => x.user.username === friend.username);
    if (!incoming) throw new Error(`demande de ${friend.username} introuvable`);
    await must('acceptation', apiCall(page, 'POST', `/friends/${incoming.requestId}/accept`));
    const friendReview = `Abbey Road, face B d'une traite : la plus belle fin de disque (${p}${stamp}).`;
    await must('critique de l’ami', apiCall(friend.page, 'PUT', '/ratings/album/abbey-road', { score: 9, review: friendReview }));
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.so-home');
    const tab = page.locator('.so-tabs .seg__btn.is-on');
    await tab.waitFor();
    if ((await tab.getAttribute('data-tab')) !== 'friends') fail(`[${label}] onglet du fil par défaut : ${await tab.getAttribute('data-tab')}`);
    const first = page.locator('.so-main [data-feed-item]').first();
    await first.waitFor({ timeout: 15_000 });
    await first.scrollIntoViewIfNeeded();
    const firstText = await first.innerText();
    if (!firstText.includes(friend.username)) fail(`[${label}] tête du fil « Tes amis » : « ${firstText.slice(0, 120)} » (l'activité de ${friend.username} attendue)`);
    await shot(page, `${p}-13-friend-first`);
    if (label === 'phone') await checkNoHorizontalScroll(page, `${label} fil des amis`);
  });
  await friend.ctx.close();
}

try {
  await ownerSentence('desktop', VIEWPORTS.desktop);
  await ownerSentence('phone', VIEWPORTS.phone);
} finally {
  await finish('Phrase du propriétaire : parcours complet sans erreur.');
  if (stack) await stack.stop();
}
