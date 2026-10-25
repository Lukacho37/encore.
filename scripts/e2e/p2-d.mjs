// Parcours P2-D (PLAN.md 9.5, 8.3 P2.5) : l'atelier — édition deluxe, Vernir, Comptoir, booster thématique à acheter,
// cosmétiques des coffrets et des événements. Ordinateur 1440 × 900 et téléphone 390 × 844.
//   - Accueil : le héros Boosters et la rangée Boutique / Doublons / Blind test restent en tête, inchangés ; la rangée
//     Doublons renvoie au Comptoir ; l'offre « Booster thématique · 180 » vient SOUS la rangée (panneau Boosters
//     spéciaux). Achat d'un booster « Rock » (royalties), ouverture avec l'écran d'ouverture inchangé.
//   - Page morceau : « Vernir » une carte standard (fenêtre : prix en royalties ou en doublons), la carte devient holo.
//   - Compte admin (outils « compléter un album » et boosters d'album gratuits) : des doublons, un album recherché, le
//     Comptoir (fiche d'une carte en double → « Échanger au Comptoir »), l'échange ; puis l'édition deluxe : la platine
//     dit ce qui manque, la dernière note se donne sur la page du morceau, le site annonce l'édition deluxe et
//     l'étagère du Studio montre le vinyle doré.
//   - Guide des raretés : chaque règle publiée ; démo autonome (dist-demo/albummania-demo.html) : vinyles deluxe des
//     joueurs fictifs, booster thématique, Comptoir.
//   Zéro erreur de console (hors images Deezer bloquées par le bac à sable), pas de défilement horizontal sur téléphone.
//   BASE=http://localhost:5124 OUT=/tmp/am-p2-d/shots node scripts/e2e/p2-d.mjs
//   (sans BASE : démarre sa propre copie sur 3124 / 5124 avec une copie neuve de $FIXTURE dans /tmp/am-p2-d/am.db)
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, ADMIN, PASSWORD, run, fail, finish, setBase, startStack, signup, signupViaApi, loginAdmin,
  checkNoHorizontalScroll, apiCall, launch, routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p2-d', apiPort: 3124, webPort: 5124, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);
const prefix = (v) => (v === 'desktop' ? 'd' : 'm');
const enc = encodeURIComponent;
const THEMED_PRICE = 180;

/** Ordre dans la page : `a` avant `b`. */
async function before(page, a, b) {
  return page.evaluate(([x, y]) => {
    const ea = document.querySelector(x);
    const eb = document.querySelector(y);
    return !!ea && !!eb && !!(ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, [a, b]);
}

/** Accueil d'un compte connecté (P1 : passage unique par /welcome, on revient à l'accueil). */
async function home(page) {
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.hero, [data-onboarding]');
  await page.waitForTimeout(300);
  if (!(await page.locator('.hero').count())) await page.goto(`${BASE}/`);
  await page.waitForSelector('.hero');
}

/** L'écran d'ouverture inchangé : on déchire le paquet, on révèle tout, on ferme le résumé. */
async function playOpening(page) {
  await page.waitForSelector('.opening__pack-btn', { timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.click('.opening__pack-btn');
  await page.waitForSelector('.reveal-card', { timeout: 10_000 });
  await page.click('.opening__bar .btn');
  await page.waitForSelector('.summary', { timeout: 10_000 });
  await page.click('.summary__actions .btn--ghost');
  await page.waitForSelector('.opening', { state: 'detached', timeout: 8000 });
}

// ---------- compte admin (accorde des royalties aux joueurs du parcours) ----------

const browser = await launch();
const adminCtx = await browser.newContext({ viewport: VIEWPORTS.desktop, locale: 'fr-FR' });
await routeFonts(adminCtx);
const adminPage = await adminCtx.newPage();
await loginAdmin(adminPage);
const grant = async (userId, data) => {
  const r = await apiCall(adminPage, 'POST', `/admin/users/${userId}/grant`, data);
  if (r.status !== 200) fail(`grant ${userId} : ${r.status} ${JSON.stringify(r.body)}`);
};

// ---------- parcours d'un joueur : accueil, booster thématique, Vernir ----------

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  const p = prefix(name);
  await run(`p2-d-${name}`, viewport, async (page) => {
    const label = `p2-d-${name}`;
    const email = `pd_${p}_${stamp}@example.com`;
    const username = `pd_${p}_${stamp}`;
    if (name === 'desktop') await signup(page, email, username);
    else await signupViaApi(page, email, username);
    const me = (await apiCall(page, 'GET', '/state')).body.user;
    await grant(me.id, { royalties: 1500, packs: 2 });
    await home(page);

    // Accueil : héros et rangée en tête, inchangés ; l'offre du booster thématique dessous.
    await page.waitForSelector('#boosters-speciaux [data-themed-offer]', { timeout: 15_000 });
    if (!(await before(page, '.hero', '.home-panels'))) fail(`[${label}] la rangée Boutique / Doublons / Blind test n'est plus sous le héros`);
    if (!(await before(page, '.home-panels', '#boosters-speciaux'))) fail(`[${label}] le panneau des boosters spéciaux n'est pas sous la rangée`);
    if (await page.locator('.hero [data-themed-offer], .home-panels [data-themed-offer]').count()) fail(`[${label}] offre thématique dans le héros ou la rangée`);
    const hero = await page.locator('.hero .hero__title').innerText();
    if (!/boosters? disponibles?|illimités/i.test(hero)) fail(`[${label}] titre du héros changé : ${hero}`);
    const dup = await page.locator('.home-panels .panel').nth(1).innerText();
    if (!/Comptoir/.test(dup)) fail(`[${label}] la rangée Doublons ne renvoie pas au Comptoir : ${dup}`);
    await page.screenshot({ path: `${OUT}/${p}-10-home-fold.png` });
    await page.locator('#boosters-speciaux').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${p}-11-home-themed-offer.png` });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} accueil`);

    // Un booster du héros (écran d'ouverture inchangé) : des cartes à vernir.
    await page.click('.hero__actions .btn--primary');
    await playOpening(page);

    // Achat d'un booster thématique « Rock » : fenêtre de choix, chances, prix ; il rejoint l'inventaire.
    const royaltiesBefore = (await apiCall(page, 'GET', '/state')).body.user.royalties;
    await page.click('[data-open-themed]');
    await page.waitForSelector('[data-sheet="themed"]');
    await page.click('[data-theme-pick="genre:rock"]');
    await page.click('[data-sheet="themed"] .link-btn');
    await page.waitForSelector('.ws-themed__odds table');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${p}-20-themed-sheet.png` });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} booster thématique`);
    const [bought] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/me/boosters/buy') && r.request().method() === 'POST'),
      page.click('[data-buy-themed]'),
    ]);
    if (bought.status() !== 200) fail(`[${label}] achat : ${bought.status()}`);
    await page.waitForSelector('.toast');
    await page.waitForSelector('#boosters-speciaux .gm-special__item');
    const after = (await apiCall(page, 'GET', '/state')).body.user.royalties;
    if (royaltiesBefore - after !== THEMED_PRICE) fail(`[${label}] achat : ${royaltiesBefore} → ${after} royalties (180 attendues)`);
    const items = await page.locator('#boosters-speciaux .gm-special__name').allInnerTexts();
    if (!items.some((x) => /Rock/.test(x))) fail(`[${label}] booster Rock absent de l'inventaire : ${items.join(', ')}`);
    await page.locator('#boosters-speciaux').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${p}-21-themed-bought.png` });
    // Il s'ouvre avec l'écran d'ouverture inchangé.
    const rock = page.locator('#boosters-speciaux .gm-special__item').filter({ hasText: 'Rock' }).first();
    await rock.locator('.gm-special__actions .btn--primary').click();
    await playOpening(page);

    // Vernir : une carte standard possédée, sur la page de son morceau.
    const state = (await apiCall(page, 'GET', '/state')).body;
    const holo = new Set(state.cards.filter((c) => c.v === 'holo').map((c) => c.t));
    const order = ['common', 'uncommon', 'rare', 'super', 'ultra', 'legendary', 'promo'];
    const target = state.cards.filter((c) => c.v === 'std' && !holo.has(c.t)).sort((a, b) => order.indexOf(a.r) - order.indexOf(b.r))[0];
    if (!target) throw new Error('aucune carte standard à vernir');
    await page.goto(`${BASE}/track/${enc(target.t)}`);
    await page.waitForSelector(`[data-vernir="${target.t}"]`);
    await page.click(`[data-vernir="${target.t}"]`);
    await page.waitForSelector('[data-sheet="vernir"] [data-pay="royalties"]');
    await page.click('[data-sheet="vernir"] [data-pay="royalties"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${p}-30-vernir-sheet.png` });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} vernir`);
    const [varnished] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/collection/vernir') && r.request().method() === 'POST'),
      page.click('.ws-vernir .ws-sheet__foot .btn--primary'),
    ]);
    const vbody = await varnished.json();
    if (varnished.status() !== 200 || vbody.state?.partial !== false) fail(`[${label}] vernir : ${varnished.status()} ${JSON.stringify(vbody).slice(0, 200)}`);
    // La carte du morceau passe en holo (en tête de page sur ordinateur, dans « Ma carte » sur téléphone).
    await page.waitForFunction(() => [...document.querySelectorAll('.card--holo')].some((c) => c.getClientRects().length > 0), null, { timeout: 10_000 });
    if (await page.locator(`[data-vernir="${target.t}"]`).count()) fail(`[${label}] le bouton Vernir reste sur une carte holo`);
    await page.screenshot({ path: `${OUT}/${p}-31-vernir-done.png` });

    // Le guide des raretés publie les règles de l'atelier (prix du booster thématique, Vernir, Comptoir, deluxe).
    await home(page);
    await page.click('.hero__help');
    await page.waitForSelector('.rarity-guide');
    const guide = await page.locator('.rarity-guide').innerText();
    for (const word of ['vernit', 'Comptoir', 'deluxe', '180 royalties', '4 fois', '3 doublons']) {
      if (!guide.includes(word)) fail(`[${label}] guide des raretés sans « ${word} »`);
    }
  });
}

// ---------- compte admin : Comptoir, puis édition deluxe ----------

/** Doublons et album recherché du compte admin : renvoie { wanted, card } (carte manquante échangeable). */
async function prepareComptoir(page, label) {
  const albums = (await apiCall(page, 'GET', '/catalog/albums?sort=popular&limit=40')).body.items.map((a) => a.id);
  const state = (await apiCall(page, 'GET', '/state')).body;
  const done = new Set(state.achievements.filter((a) => a.key.startsWith('album:')).map((a) => a.key.slice(6)));
  const source = albums.find((id) => !done.has(id)) || albums[0];
  await apiCall(page, 'POST', '/admin/me/complete', { albumId: source });
  // Boosters d'album gratuits (admin) sur un album complet : rien que des doublons.
  for (let i = 0; i < 4; i++) await apiCall(page, 'POST', '/packs/album', { albumId: source });
  const wished = (await apiCall(page, 'GET', '/me/wishlist')).body.items || [];
  for (const id of albums.filter((x) => x !== source && !done.has(x)).slice(0, 12)) {
    if (wished.length >= 12) break;
    if (wished.includes(id)) continue;
    const r = await apiCall(page, 'PUT', `/me/wishlist/${enc(id)}`);
    if (r.status === 200) wished.push(id);
  }
  for (let round = 0; round < 6; round++) {
    const page1 = (await apiCall(page, 'GET', '/collection/comptoir?limit=24')).body;
    for (const a of page1.items) {
      const m = a.missing.find((x) => (page1.duplicates[x.rarity] || 0) >= page1.needed);
      if (m) return { wanted: a.albumId, card: m, source };
    }
    await apiCall(page, 'POST', '/packs/album', { albumId: source });
  }
  fail(`[${label}] aucune carte échangeable au Comptoir`);
  return null;
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  const p = prefix(name);
  await run(`p2-d-admin-${name}`, viewport, async (page) => {
    const label = `p2-d-admin-${name}`;
    await loginAdmin(page);
    const setup = await prepareComptoir(page, label);
    if (!setup) return;

    // Comptoir : par la fiche d'une carte en double (« Derniers morceaux obtenus » de l'accueil).
    await home(page);
    await page.locator('[data-home="recent"] .card').first().scrollIntoViewIfNeeded();
    await page.locator('[data-home="recent"] .card').first().click();
    await page.waitForSelector('.modal--card [data-open-comptoir]', { timeout: 10_000 });
    await page.click('.modal--card [data-open-comptoir]');
    await page.waitForSelector('[data-sheet="comptoir"] .ws-album');
    await page.waitForSelector(`[data-sheet="comptoir"] [data-exchange="${setup.card.trackId}"]`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${p}-40-comptoir.png` });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} comptoir`);
    await page.locator(`[data-exchange="${setup.card.trackId}"]`).scrollIntoViewIfNeeded();
    await page.click(`[data-exchange="${setup.card.trackId}"]`);
    const [traded] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/collection/comptoir') && r.request().method() === 'POST'),
      page.click(`[data-confirm-exchange="${setup.card.trackId}"]`),
    ]);
    if (traded.status() !== 200) fail(`[${label}] échange : ${traded.status()} ${await traded.text()}`);
    await page.waitForSelector('.toast');
    await page.waitForFunction((id) => !document.querySelector(`[data-sheet="comptoir"] [data-missing="${id}"]`), setup.card.trackId, { timeout: 10_000 });
    const owned = (await apiCall(page, 'GET', '/state')).body.cards.some((c) => c.t === setup.card.trackId);
    if (!owned) fail(`[${label}] la carte échangée n'est pas dans la collection`);
    await page.screenshot({ path: `${OUT}/${p}-41-comptoir-done.png` });
    await page.keyboard.press('Escape');

    // Fiche d'une carte manquante de l'album recherché : l'échange proposé au Comptoir.
    await page.goto(`${BASE}/album/${enc(setup.wanted)}`);
    await page.locator('.seg .seg__btn', { hasText: /^Cartes$/ }).first().click();
    await page.locator('.card--ghost').first().waitFor({ timeout: 10_000 });
    await page.locator('.card--ghost').first().click();
    await page.waitForSelector('.modal--card [data-comptoir-offer]', { timeout: 10_000 });
    await page.locator('.modal--card [data-comptoir-offer]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${p}-42-card-comptoir-offer.png` });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} fiche de carte`);
    await page.keyboard.press('Escape');

    // Édition deluxe : un album complété, sa note et celles de tous ses morceaux sauf un (par l'API).
    const pick = (await apiCall(page, 'GET', '/catalog/albums?sort=popular&limit=60')).body.items
      .map((a) => a.id).filter((id) => id !== setup.source && id !== setup.wanted);
    const state = (await apiCall(page, 'GET', '/state')).body;
    const deluxeDone = new Set(state.achievements.filter((a) => a.key.startsWith('deluxe:')).map((a) => a.key.slice(7)));
    const albumId = pick.find((id) => !deluxeDone.has(id));
    await apiCall(page, 'POST', '/admin/me/complete', { albumId });
    const detail = (await apiCall(page, 'GET', `/catalog/albums/${enc(albumId)}`)).body;
    const tracks = detail.tracks.map((t) => t.id);
    await apiCall(page, 'PUT', `/ratings/album/${enc(albumId)}`, { score: 8 });
    for (const id of tracks.slice(0, -1)) await apiCall(page, 'PUT', `/ratings/track/${enc(id)}`, { score: 7 });

    // La platine de la page d'album dit ce qui manque.
    await page.goto(`${BASE}/album/${enc(albumId)}`);
    await page.waitForSelector('.album-head .vinyl, .album-head button.vinyl', { timeout: 15_000 });
    await page.locator('.album-head .vinyl').first().click();
    await page.waitForSelector('.modal--turntable [data-deluxe-nudge]', { timeout: 10_000 });
    const nudge = await page.locator('.modal--turntable [data-deluxe-nudge]').innerText();
    if (!/dernier morceau/.test(nudge)) fail(`[${label}] platine : « ${nudge} »`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${p}-50-turntable-nudge.png` });
    await page.keyboard.press('Escape');

    // La dernière note, sur la page du morceau : le site annonce l'édition deluxe.
    await page.goto(`${BASE}/track/${enc(tracks.at(-1))}`);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('#ma-note .star-input__stars');
    // Vite peut recharger la page au premier passage (dépendances optimisées) : on réessaie le défilement.
    for (let i = 0; i < 3; i++) {
      if (await page.locator('#ma-note').scrollIntoViewIfNeeded().then(() => true, () => false)) break;
      await page.waitForSelector('#ma-note .star-input__stars');
    }
    const stars = await page.locator('#ma-note .star-input__stars').boundingBox();
    await page.mouse.click(stars.x + stars.width * 0.85, stars.y + stars.height / 2);
    await page.click('#ma-note .review-editor__actions .btn--primary');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((x) => /deluxe/i.test(x.textContent)), null, { timeout: 15_000 });
    await page.screenshot({ path: `${OUT}/${p}-51-deluxe-toast.png` });
    const after = (await apiCall(page, 'GET', `/albums/${enc(albumId)}/deluxe`)).body;
    if (!after.done) fail(`[${label}] édition deluxe pas donnée : ${JSON.stringify(after).slice(0, 200)}`);

    // Studio : le vinyle doré sur l'étagère, et sur la platine.
    await page.goto(`${BASE}/studio`);
    await page.waitForSelector('.vinyl-shelf .ws-disc--deluxe', { timeout: 15_000 });
    await page.locator('.vinyl-shelf .ws-disc--deluxe').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${p}-60-studio-deluxe.png` });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} studio`);
    const shelfItem = page.locator('.vinyl-shelf .vinyl-item').filter({ has: page.locator('.ws-disc--deluxe') }).first();
    await shelfItem.locator('.vinyl').click();
    await page.waitForSelector('.modal--turntable .ws-edition--deluxe');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${p}-61-turntable-deluxe.png` });
    await page.keyboard.press('Escape');
  });
}

await adminCtx.close();

// ---------- démo autonome ----------

const demoFile = path.join(ROOT, 'dist-demo/albummania-demo.html');
if (fs.existsSync(demoFile)) {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport, locale: 'fr-FR' });
    await routeFonts(ctx);
    const page = await ctx.newPage();
    const label = `demo-${name}`;
    const p = prefix(name);
    page.on('pageerror', (e) => fail(`[${label}] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${label}] console: ${m.text()}`));
    try {
      await page.goto(`file://${demoFile}`);
      await page.waitForSelector('.auth__form', { timeout: 20_000 });
      await page.getByText(/Créer un compte/).first().click();
      await page.waitForSelector('#su-email');
      await page.fill('#su-email', `demo_d_${name}@example.com`);
      await page.fill('#su-user', `demod_${name}`);
      await page.fill('#su-pw', PASSWORD);
      if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', PASSWORD);
      for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
      await page.waitForSelector('.field__ok');
      await page.click('button[type=submit]');
      await page.click('.demo-mail .btn');
      await page.waitForSelector('.hero, [data-onboarding]', { timeout: 20_000 });
      if (!(await page.locator('.hero').count())) {
        await page.goto(`file://${demoFile}`);
        await page.waitForSelector('.hero');
      }
      // Boosters spéciaux de la démo + offre du booster thématique, sous la rangée.
      await page.waitForSelector('#boosters-speciaux [data-themed-offer]', { timeout: 15_000 });
      if (!(await before(page, '.home-panels', '#boosters-speciaux'))) fail(`[${label}] boosters spéciaux au-dessus de la rangée`);
      await page.click('[data-open-themed]');
      await page.waitForSelector('[data-sheet="themed"]');
      await page.click('[data-theme-pick="decade:1990"]');
      await page.click('[data-buy-themed]');
      await page.waitForSelector('.toast');
      await page.locator('#boosters-speciaux').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${p}-80-demo-themed.png` });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} accueil`);
      // Studio d'un joueur fictif (lien du fil de l'accueil) : ses vinyles deluxe.
      await page.waitForSelector('main a[href^="/u/"]', { timeout: 15_000 });
      const hrefs = [...new Set(await page.locator('main a[href^="/u/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href'))))]
        .filter((h) => !h.includes('demod_'));
      let seen = false;
      for (const href of hrefs.slice(0, 4)) {
        await page.locator(`main a[href="${href}"]`).first().click();
        await page.waitForSelector('.profile-head', { timeout: 10_000 });
        if (await page.locator('.vinyl-shelf .ws-disc--deluxe').first().waitFor({ timeout: 4000 }).then(() => true, () => false)) {
          seen = true;
          break;
        }
        await page.locator('a[href="/"]').first().click();
        await page.waitForSelector('main a[href^="/u/"]', { timeout: 10_000 });
      }
      if (!seen) fail(`[${label}] aucun vinyle deluxe chez les joueurs fictifs (${hrefs.join(', ')})`);
      else {
        await page.locator('.vinyl-shelf .ws-disc--deluxe').first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${OUT}/${p}-81-demo-bot-deluxe.png` });
      }
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

await finish('Parcours P2-D complet sans erreur.');
if (stack) await stack.stop();
