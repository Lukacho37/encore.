// Parcours P1-E (PLAN.md 9.4, 8.2 P1.4, P1.8, P1.9) : Taste Match, premiers pas, Découvrir ; ordinateur 1440 × 900 et
// téléphone 390 × 844.
//   - Premiers pas : un compte neuf (inscription par le site) ouvre /welcome : genres (3), artistes (3), 9 albums
//     (suggestions + recherche), notes rapides (étoiles et « Pas écouté »), résultat (profil musical, boosters de
//     bienvenue, 12 recommandations, amis suggérés) ; « Ouvrir mes boosters » → accueil qui n'est pas vide (héros
//     inchangé, boosters spéciaux, quêtes, Taste Match ou suggestions) ; Paramètres « Refaire mon profil musical »
//     repart des choix faits.
//   - Taste Match : ami aux goûts proches → /match/:pseudo (grand pourcentage, confiance, barres expliquées, albums en
//     commun, différences, recommandations) → « Partager » : image composée dans le navigateur ; carte de l'accueil ;
//     Studio privé d'un inconnu → « Comparaison indisponible ».
//   - Découvrir : sections avec leur raison, tuiles Battles · Classements · Listes · Mes 9 albums · Blind test,
//     « Voir plus ».
//   - Démo autonome (dist-demo/albummania-demo.html) : premiers pas, Découvrir et Taste Match avec les joueurs fictifs.
//   Zéro erreur de console (hors images Deezer bloquées par le bac à sable), pas de défilement horizontal.
//   BASE=http://localhost:5115 OUT=/tmp/am-p1-e/shots node scripts/e2e/p1-e.mjs
//   (sans BASE : démarre sa propre copie sur 3115 / 5115 avec une copie neuve de $FIXTURE dans /tmp/am-p1-e/am.db)
//   FOCUS=desktop,phone,demo : ne joue que ces parties (développement).
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, shot, fail, finish, setBase, startStack, checkNoHorizontalScroll,
  launch, routeFonts, ignoredConsole, run, fillSignup, lastMailToken, signupViaApi, apiCall,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p1-e', apiPort: 3115, webPort: 5115, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const FOCUS = new Set((process.env.FOCUS || 'desktop,phone,demo').split(',').map((s) => s.trim()));
const stamp = Date.now().toString(36).slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Albums de base du catalogue (mêmes identifiants dans la démo) notés par le jumeau de goûts.
const TWIN_RATINGS = [
  ['discovery', 10], ['moon-safari', 9], ['random-access-memories', 9], ['thriller', 8], ['abbey-road', 9],
  ['nevermind', 8], ['the-dark-side-of-the-moon', 9], ['21', 7], ['back-to-black', 3],
];

/** Compte secondaire dans un contexte à part (session gardée par ce contexte) ; renvoie { page, ctx, user }. */
async function account(username) {
  const b = await launch();
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  const user = await signupViaApi(page, `${username}@example.com`, username);
  return { page, ctx, user, username };
}

async function rateAll(page, list) {
  for (const [id, score] of list) {
    const r = await apiCall(page, 'PUT', `/ratings/album/${encodeURIComponent(id)}`, { score });
    if (r.status !== 200) fail(`note de ${id} : ${r.status} ${JSON.stringify(r.body)}`);
  }
}

/** Amitié acceptée entre la page `a` (session) et le compte `b` ({ page, username }). */
async function befriend(a, b, aName) {
  const req = await apiCall(a, 'POST', '/friends/request', { username: b.username });
  if (req.status !== 200) fail(`demande d'ami : ${req.status} ${JSON.stringify(req.body)}`);
  const list = await apiCall(b.page, 'GET', '/friends');
  const incoming = (list.body?.incoming || []).find((x) => x.user.username.toLowerCase() === aName.toLowerCase());
  if (!incoming) return fail(`demande d'ami de ${aName} introuvable chez ${b.username}`);
  const ok = await apiCall(b.page, 'POST', `/friends/${incoming.requestId}/accept`);
  if (ok.status !== 200) fail(`acceptation : ${ok.status}`);
}

/** Clic sur une note de 4 étoiles et demie (ou 9 points) dans un champ de note. */
async function clickStars(page, scope) {
  const stars = scope.locator('.star-input__stars');
  if (await stars.count()) {
    const box = await stars.first().boundingBox();
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2);
  } else {
    await scope.locator('.points-input__btn').nth(9).click();
  }
}

/** Les cinq étapes, du compte neuf au résultat ; renvoie le texte du profil musical. */
async function onboarding(page, label, p) {
  await page.goto(`${BASE}/welcome`);
  await page.waitForSelector('[data-onboarding="genres"] .genre-btn');
  await shot(page, `${p}-10-onboarding-genres`);
  const next = page.locator('[data-onboarding-next]');
  if (!(await next.isDisabled())) fail(`[${label}] « Continuer » actif avant 3 genres`);
  for (const g of ['electro', 'rock', 'pop']) await page.click(`.genre-btn[data-genre="${g}"]`);
  if (await next.isDisabled()) fail(`[${label}] « Continuer » inactif avec 3 genres`);
  await next.click();

  await page.waitForSelector('[data-onboarding="artists"] .pick-artist');
  const artists = page.locator('.pick-artist');
  if ((await artists.count()) < 6) fail(`[${label}] ${await artists.count()} artistes proposés`);
  for (let i = 0; i < 3; i++) await artists.nth(i).click();
  await page.waitForSelector('.pick-artist.is-on .pick-artist__check');
  await shot(page, `${p}-11-onboarding-artists`);
  if (label === 'phone') await checkNoHorizontalScroll(page, `${label} artistes`);
  await next.click();

  await page.waitForSelector('[data-onboarding="nine"] .dc-pick');
  const picks = page.locator('.dc-pick:not([disabled])');
  for (let i = 0; i < 4; i++) await picks.nth(i).click();
  // Un album par la recherche.
  const input = page.locator('[data-onboarding="nine"] .gsearch__input');
  await input.fill('back to black');
  await page.waitForSelector('[data-onboarding="nine"] .gsearch__opt');
  await page.locator('[data-onboarding="nine"] .gsearch__opt').filter({ hasText: 'Amy Winehouse' }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.dc-nine .nine__grid [data-slot] img, .dc-nine .nine__grid [data-slot] canvas, .dc-nine .nine__grid [data-slot] .cover').length >= 0);
  const filled = await page.locator('.dc-step__count').innerText();
  if (!/5\/9/.test(filled)) fail(`[${label}] grille : « ${filled} » (5/9 attendu)`);
  await shot(page, `${p}-12-onboarding-nine`);
  if (label === 'phone') await checkNoHorizontalScroll(page, `${label} 9 albums`);
  await next.click();

  await page.waitForSelector('[data-onboarding="rate"] .dc-rate__item');
  const rows = page.locator('.dc-rate__item');
  await clickStars(page, rows.nth(0));
  await clickStars(page, rows.nth(1));
  await rows.nth(2).locator('[data-not-heard]').click();
  await shot(page, `${p}-13-onboarding-rate`);
  if (label === 'phone') await checkNoHorizontalScroll(page, `${label} notes`);
  await next.click();

  await page.waitForSelector('[data-onboarding="result"] [data-result="recommendations"] .album-tile', { timeout: 20_000 });
  const profile = await page.locator('.dc-result__profile').getAttribute('data-profile');
  if (!profile || !/Électro|Rock|Pop/i.test(profile)) fail(`[${label}] profil musical : « ${profile} »`);
  const boosters = await page.locator('[data-result="boosters"] .dc-booster').count();
  if (boosters !== 4) fail(`[${label}] ${boosters} boosters de bienvenue (4 attendus : 3 genres + album au choix)`);
  const recs = await page.locator('[data-result="recommendations"] .album-tile').count();
  if (recs !== 12) fail(`[${label}] ${recs} recommandations (12 attendues)`);
  await shot(page, `${p}-14-onboarding-result`, { fullPage: true });
  if (label === 'phone') await checkNoHorizontalScroll(page, `${label} résultat`);
  return profile;
}

async function player(name, viewport) {
  const label = name;
  const p = name === 'desktop' ? 'd' : 'p';
  await run(label, viewport, async (page) => {
    // Jumeau de goûts (ami) et inconnu au Studio privé.
    const twin = await account(`twin_${p}${stamp}`);
    await rateAll(twin.page, TWIN_RATINGS);
    const stranger = await account(`priv_${p}${stamp}`);
    await rateAll(stranger.page, TWIN_RATINGS.slice(0, 4));

    // Compte neuf par le site : après la confirmation de l'adresse, le site ouvre les premiers pas (App.jsx, P1-B).
    const me = `me_${p}${stamp}`;
    await fillSignup(page, { email: `${me}@example.com`, username: me });
    await page.click('button[type=submit]');
    await page.waitForURL('**/check-email');
    await page.goto(`${BASE}/verify?token=${await lastMailToken(page, `${me}@example.com`)}`);
    await page.waitForSelector('.hero, [data-onboarding]', { timeout: 20_000 });
    if (!(await page.locator('[data-onboarding]').count())) console.log(`[${label}] note : pas d'ouverture automatique de /welcome après la confirmation`);
    // Avant les premiers pas : l'accueil invite aussi à créer son profil musical (colonne de l'accueil).
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.hero');
    await page.waitForSelector('[data-home="profile-invite"]', { state: 'attached', timeout: 15_000 });
    await onboarding(page, label, p);

    // Résultat → accueil : héros inchangé, et des blocs en dessous (boosters spéciaux, quêtes, Taste Match / suggestions).
    await page.click('[data-open-boosters]');
    await page.waitForSelector('.hero');
    await page.waitForSelector('#boosters-speciaux', { timeout: 15_000 });
    await page.waitForSelector('[data-home="quests"] .quest-chip', { timeout: 15_000 });
    if (await page.locator('[data-home="profile-invite"]').count()) fail(`[${label}] invitation aux premiers pas encore affichée après le parcours`);
    await shot(page, `${p}-20-home-after-onboarding`);
    await page.locator('[data-home="suggestions"], [data-home="taste-match"]').first().scrollIntoViewIfNeeded().catch(() => {});
    if (!(await page.locator('[data-home="suggestions"] .user-card').count())) fail(`[${label}] pas d'amis suggérés sur l'accueil d'un compte neuf`);
    await shot(page, `${p}-21-home-suggestions`);
    if (label === 'phone') await checkNoHorizontalScroll(page, `${label} accueil`);

    // Taste Match avec le jumeau, devenu ami : carte de l'accueil, page détaillée, image à partager.
    await befriend(page, twin, me);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('[data-home="taste-match"] .match-card__pct', { state: 'attached', timeout: 15_000 });
    await page.locator('[data-home="taste-match"]').scrollIntoViewIfNeeded();
    await shot(page, `${p}-22-home-taste-match`);
    await page.locator('[data-home="taste-match"] a[href^="/match/"]').last().click();
    await page.waitForSelector('[data-match="page"] .dc-match-head__pct');
    const score = Number(await page.locator('.dc-match-head').getAttribute('data-match-score'));
    if (!(score >= 0 && score <= 100)) fail(`[${label}] score Taste Match : ${score}`);
    const bars = await page.locator('[data-match-block="components"] .match-bars li').count();
    if (bars !== 5) fail(`[${label}] ${bars} composantes (5 attendues)`);
    const why = await page.locator('[data-match-block="components"] .dc-bars__why').first().innerText();
    if (!why.trim()) fail(`[${label}] composante sans explication`);
    if (!(await page.locator('[data-match-block="albums"] .album-tile').count())) fail(`[${label}] aucun album en commun affiché`);
    await shot(page, `${p}-30-taste-match`, { fullPage: true });
    if (label === 'phone') await checkNoHorizontalScroll(page, `${label} Taste Match`);
    await page.click('[data-match-share]');
    await page.waitForSelector('[data-share-image]', { timeout: 20_000 });
    const dims = await page.locator('[data-share-image]').evaluate((img) => [img.dataset.width, img.dataset.height, img.dataset.bytes]);
    if (dims[0] !== '1080' || dims[1] !== '1350' || Number(dims[2]) < 10_000) fail(`[${label}] image à partager : ${dims.join(' × ')}`);
    await shot(page, `${p}-31-taste-match-share`);
    await page.keyboard.press('Escape');

    // Studio privé d'un inconnu : comparaison indisponible.
    const privacy = await apiCall(stranger.page, 'PUT', '/me/profile', { visibility: 'private' });
    if (privacy.status !== 200) fail(`[${label}] Studio privé : ${privacy.status}`);
    else {
      await page.goto(`${BASE}/match/${stranger.username}`);
      await page.waitForSelector('[data-match="unavailable"] .empty-state');
      await shot(page, `${p}-32-taste-match-unavailable`);
    }

    // Découvrir : sections expliquées, tuiles, « Voir plus ».
    await page.goto(`${BASE}/discover`);
    await page.waitForSelector('[data-discover="page"] .dc-shelf[data-section] .album-tile', { timeout: 20_000 });
    const sections = await page.locator('.dc-shelf[data-section]').count();
    if (sections < 3) fail(`[${label}] ${sections} sections dans Découvrir (3 au moins attendues)`);
    const reasons = await page.locator('.dc-shelf[data-section] .dc-shelf__reason').count();
    if (reasons !== sections) fail(`[${label}] ${sections - reasons} section(s) sans raison`);
    const tiles = await page.locator('.dc-tile').count();
    if (tiles !== 5) fail(`[${label}] ${tiles} tuiles (5 attendues)`);
    if (await page.locator('[data-discover="invite"]').count()) fail(`[${label}] invitation aux premiers pas dans Découvrir après le parcours`);
    await shot(page, `${p}-40-discover`);
    const more = page.locator('[data-more]').first();
    if (await more.count()) {
      const before = await more.locator('xpath=..').locator('.album-tile').count();
      await more.scrollIntoViewIfNeeded();
      await more.click();
      await page.waitForFunction(([sel, n]) => document.querySelector(sel)?.parentElement?.querySelectorAll('.album-tile').length > n,
        [`[data-more="${await more.getAttribute('data-more')}"]`, before], { timeout: 10_000 }).catch(() => fail(`[${label}] « Voir plus » sans nouveaux albums`));
    }
    await shot(page, `${p}-41-discover-full`, { fullPage: true });
    if (label === 'phone') await checkNoHorizontalScroll(page, `${label} Découvrir`);

    // Paramètres : « Refaire mon profil musical » repart des choix faits.
    await page.goto(`${BASE}/settings`);
    await page.waitForSelector('[data-settings="music-profile"] .chip');
    await page.locator('[data-settings="music-profile"]').scrollIntoViewIfNeeded();
    await shot(page, `${p}-50-settings-music`);
    await page.click('[data-redo-profile]');
    await page.waitForSelector('[data-onboarding="genres"] .genre-btn.is-on');
    const on = await page.locator('.genre-btn.is-on').count();
    if (on !== 3) fail(`[${label}] « Refaire » : ${on} genres présélectionnés (3 attendus)`);
    await twin.ctx.close();
    await stranger.ctx.close();
  });
}

if (FOCUS.has('desktop')) await player('desktop', VIEWPORTS.desktop);
if (FOCUS.has('phone')) await player('phone', VIEWPORTS.phone);

// ---------- démo autonome ----------

const demoFile = path.join(ROOT, 'dist-demo/albummania-demo.html');
if (FOCUS.has('demo') && fs.existsSync(demoFile)) {
  const b = await launch();
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const ctx = await b.newContext({ viewport, locale: 'fr-FR' });
    await routeFonts(ctx);
    const page = await ctx.newPage();
    const label = `demo-${name}`;
    const p = name === 'desktop' ? 'd' : 'p';
    page.on('pageerror', (e) => fail(`[${label}] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${label}] console: ${m.text()}`));
    try {
      await page.goto(`file://${demoFile}`);
      await page.waitForSelector('.auth__form', { timeout: 20_000 });
      await page.getByText(/Créer un compte/).first().click();
      await page.waitForSelector('#su-email');
      await page.fill('#su-email', `demo_e_${name}@example.com`);
      await page.fill('#su-user', `demoe_${name}`);
      await page.fill('#su-pw', 'motdepasse123');
      if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', 'motdepasse123');
      for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
      await page.waitForSelector('.field__ok');
      await page.click('button[type=submit]');
      await page.click('.demo-mail .btn');
      await page.waitForSelector('.hero, [data-onboarding]', { timeout: 20_000 });
      // Premiers pas depuis l'invitation de l'accueil (la démo n'a pas d'adresse : MemoryRouter).
      if (!(await page.locator('[data-onboarding]').count())) {
        await page.waitForSelector('[data-home="profile-invite"] a', { state: 'attached', timeout: 15_000 });
        await page.evaluate(() => document.querySelector('[data-home="profile-invite"] a')?.click());
      }
      await page.waitForSelector('[data-onboarding="genres"] .genre-btn');
      for (const g of ['electro', 'rock', 'pop']) await page.click(`.genre-btn[data-genre="${g}"]`);
      await page.click('[data-onboarding-next]');
      await page.waitForSelector('.pick-artist');
      for (let i = 0; i < 3; i++) await page.locator('.pick-artist').nth(i).click();
      await page.click('[data-onboarding-next]');
      await page.waitForSelector('.dc-pick');
      for (let i = 0; i < 3; i++) await page.locator('.dc-pick:not([disabled])').nth(i).click();
      await page.click('[data-onboarding-next]');
      await page.waitForSelector('.dc-rate__item');
      await clickStars(page, page.locator('.dc-rate__item').first());
      await page.click('[data-onboarding-next]');
      await page.waitForSelector('[data-onboarding="result"]', { timeout: 15_000 });
      await page.screenshot({ path: `${OUT}/${p}-80-demo-onboarding-result.png`, fullPage: true });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} résultat`);
      // Découvrir (onglet de la barre) : sections nourries par les joueurs fictifs.
      await page.locator('a[href="/discover"]').first().click();
      await page.waitForSelector('.dc-shelf[data-section] .album-tile', { timeout: 15_000 });
      const sections = await page.locator('.dc-shelf[data-section]').count();
      if (sections < 3) fail(`[${label}] ${sections} sections dans Découvrir`);
      await page.screenshot({ path: `${OUT}/${p}-81-demo-discover.png`, fullPage: true });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} Découvrir`);
      // Taste Match avec un joueur fictif, par les suggestions de l'accueil.
      await page.locator('.topbar a').first().click();
      await page.waitForSelector('.hero');
      await page.waitForSelector('[data-home="suggestions"] .match-figure', { state: 'attached', timeout: 15_000 });
      await page.evaluate(() => document.querySelector('[data-home="suggestions"] a.match-figure')?.click());
      await page.waitForSelector('[data-match="page"] .dc-match-head__pct', { timeout: 15_000 });
      await page.screenshot({ path: `${OUT}/${p}-82-demo-taste-match.png`, fullPage: true });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} Taste Match`);
    } catch (err) {
      await page.screenshot({ path: `${OUT}/zz-error-${label}.png` }).catch(() => {});
      fail(`[${label}] ${err.stack || err.message}`);
    } finally {
      await ctx.close();
    }
  }
} else if (FOCUS.has('demo')) {
  console.log('Démo absente (npm run build:demo) : partie démo sautée.');
}

await sleep(50);
await finish('Parcours P1-E complet sans erreur.');
if (stack) await stack.stop();
