// Parcours K0 (PLAN.md 9.1) : la table des routes et le chargement des pages à la demande ne cassent rien.
// Ordinateur 1440 × 900 et téléphone 390 × 844 : redirections (visiteur, /profile → /studio, /login connecté),
// toutes les pages existantes, page introuvable, routes des pages pas encore livrées, espace admin, défilement
// horizontal, zéro erreur de console ; puis la démo autonome (dist-demo/albummania-demo.html) si elle est construite.
//   BASE=http://localhost:5100 OUT=/tmp/am-k0/shots node scripts/e2e/k0.mjs
//   (sans BASE : démarre sa propre copie sur 3100 / 5100 avec une copie de $FIXTURE dans /tmp/am-k0/am.db)
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, run, shot, signup, login, loginAdmin, fail, finish, setBase, startStack,
  checkNoHorizontalScroll, routeFonts, launch, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'k0', apiPort: 3100, webPort: 5100 });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);
const player = { email: `k0_${stamp}@example.com`, username: `k0_${stamp}` };

const NOT_FOUND = '.catalog-missing__title';
const expectPath = async (page, wanted, label) => {
  const p = new URL(page.url()).pathname;
  if (p !== wanted) fail(`[${label}] adresse ${p}, attendu ${wanted}`);
};
/** Va sur `route` et attend `selector` ; capture `file`. */
async function visit(page, route, selector, file, label) {
  await page.goto(`${BASE}${route}`);
  await page.waitForSelector(selector, { timeout: 15_000 });
  await page.waitForTimeout(300);
  if (file) await shot(page, file);
  if (label.startsWith('phone')) await checkNoHorizontalScroll(page, `${label} ${route}`);
}

await run('desktop-guest', VIEWPORTS.desktop, async (page) => {
  // Une page de joueur demandée sans compte mène à la connexion.
  await page.goto(`${BASE}/collection/cards`);
  await page.waitForSelector('.auth__form');
  await expectPath(page, '/login', 'desktop-guest');
  await shot(page, 'd-01-login');
  // Les pages ouvertes à tous (pages légales, signalement) ne renvoient pas vers la connexion.
  for (const route of ['/legal/terms', '/report']) {
    await page.goto(`${BASE}${route}`);
    await page.waitForTimeout(600);
    await expectPath(page, route, 'desktop-guest');
  }
  await shot(page, 'd-02-guest-report');
});

await run('desktop', VIEWPORTS.desktop, async (page) => {
  await signup(page, player.email, player.username);
  await page.waitForTimeout(500);
  await shot(page, 'd-10-home');
  // Connecté : les pages d'invité renvoient à l'accueil.
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('.hero');
  await expectPath(page, '/', 'desktop /login connecté');

  await visit(page, '/collection', '.album-grid', 'd-11-collection', 'desktop');
  await visit(page, '/collection/cards', '.collection', 'd-12-collection-cards', 'desktop');
  await visit(page, '/album/discovery', '.album-head', 'd-13-album', 'desktop');
  await visit(page, '/artist/daft-punk', '.artist-page', 'd-14-artist', 'desktop');
  await visit(page, '/studio', '.profile-head', 'd-15-studio', 'desktop');
  await visit(page, '/profile', '.profile-head', null, 'desktop');
  await expectPath(page, '/studio', 'desktop /profile');
  await visit(page, `/u/${player.username}`, '.profile-head', null, 'desktop');
  await visit(page, '/friends', '.add-friend', 'd-16-friends', 'desktop');
  await visit(page, '/blindtest', '.genre-grid', 'd-17-blindtest', 'desktop');
  await visit(page, '/cette-page-n-existe-pas', NOT_FOUND, 'd-18-not-found', 'desktop');
  const title = await page.textContent(NOT_FOUND);
  if (!/face/i.test(title)) fail(`[desktop] titre de la page introuvable : ${title}`);
  // Pages des chantiers suivants : leur route existe déjà (page introuvable tant que le fichier manque).
  for (const route of ['/discover', '/track/discovery%3A01', '/search?q=daft', '/settings', '/notifications', '/lists', '/quests']) {
    await page.goto(`${BASE}${route}`);
    await page.waitForFunction(() => document.querySelector('main.page')?.children.length > 0, null, { timeout: 15_000 });
  }
  await shot(page, 'd-19-future-route');
  // Navigation par les liens (pages chargées à la demande, sans rechargement).
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.hero');
  await page.locator('a[href="/collection"]:visible').first().click();
  await page.waitForSelector('.album-grid');
  // Blind test : lien de la barre ou de la rangée Boutique / Doublons / Blind test de l'accueil (selon la navigation).
  await page.locator('a[href="/"]:visible').first().click();
  await page.waitForSelector('.hero');
  await page.locator('a[href="/blindtest"]:visible').first().click();
  await page.waitForSelector('.genre-grid');
  await page.locator('a[href="/"]:visible').first().click();
  await page.waitForSelector('.hero');
});

await run('desktop-admin', VIEWPORTS.desktop, async (page) => {
  await loginAdmin(page);
  await visit(page, '/admin', '.admin', 'd-20-admin', 'desktop');
  await visit(page, '/admin/overview', '.admin', null, 'desktop');
});

await run('phone', VIEWPORTS.phone, async (page) => {
  await login(page, player.username);
  await page.waitForTimeout(500);
  await shot(page, 'm-10-home');
  await checkNoHorizontalScroll(page, 'phone /');
  await visit(page, '/collection', '.album-grid', 'm-11-collection', 'phone');
  await visit(page, '/album/discovery', '.album-head', 'm-13-album', 'phone');
  await visit(page, '/studio', '.profile-head', 'm-15-studio', 'phone');
  await visit(page, '/friends', '.add-friend', null, 'phone');
  await visit(page, '/blindtest', '.genre-grid', null, 'phone');
  await visit(page, '/nulle-part', NOT_FOUND, 'm-18-not-found', 'phone');
  await page.locator('a[href="/collection"]:visible').first().click();
  await page.waitForSelector('.album-grid');
  await page.locator('a[href="/"]:visible').first().click();
  await page.waitForSelector('.hero');
});

// Démo autonome : un seul fichier HTML, faux serveur dans le navigateur, pages chargées sans import().
const demoFile = path.join(ROOT, 'dist-demo/albummania-demo.html');
if (fs.existsSync(demoFile)) {
  const b = await launch();
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const ctx = await b.newContext({ viewport, locale: 'fr-FR' });
    await routeFonts(ctx);
    const page = await ctx.newPage();
    const label = `demo-${name}`;
    page.on('pageerror', (e) => fail(`[${label}] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${label}] console: ${m.text()}`));
    try {
      await page.goto(`file://${demoFile}`);
      await page.waitForSelector('.auth__form', { timeout: 20_000 });
      await page.getByText(/Créer un compte/).first().click();
      await page.waitForSelector('#su-email');
      if (await page.locator('.auth__form input[type=checkbox]').count()) {
        await page.fill('#su-email', `demo_${name}@example.com`);
        await page.fill('#su-user', `demo_${name}`);
        await page.fill('#su-pw', 'motdepasse123');
        if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', 'motdepasse123');
        for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
        await page.waitForSelector('.field__ok');
        await page.click('button[type=submit]');
        await page.click('.demo-mail .btn');
      } else {
        // Le faux serveur exige la case « CGU et 15 ans ou plus » (PLAN.md 4.1.5), que P0-D ajoute au formulaire :
        // en attendant, on reprend une session enregistrée (sauvegarde d'un joueur déjà inscrit).
        console.log(`[${label}] case CGU absente du formulaire : session de démo enregistrée à la place de l'inscription.`);
        await page.evaluate((who) => {
          const now = Date.now();
          localStorage.setItem('albummania.demo.v1', JSON.stringify({
            nextId: 2, cards: {}, achievements: {}, friendships: [], tokens: [], games: {}, ratings: [], session: 1,
            users: [{ id: 1, email: `${who}@example.com`, username: who, password: 'x', verified: now, role: 'player', lang: 'fr',
              avatar: 'initials', avatarColor: 'auto', royalties: 200, xp: 0, packs: 0, packsAt: now, bonusPacks: 5, showcase: [],
              createdAt: now, openings: 0 }],
          }));
        }, `demo_${name}`);
        await page.goto(`file://${demoFile}`);
      }
      await page.waitForSelector('.hero');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${name === 'desktop' ? 'd' : 'm'}-30-demo-home.png` });
      await page.locator('a[href="/collection"]:visible').first().click();
      await page.waitForSelector('.album-grid');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${name === 'desktop' ? 'd' : 'm'}-31-demo-collection.png` });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} collection`);
      await page.locator('a[href="/"]:visible').first().click();
      await page.waitForSelector('.hero');
      const ready = await page.evaluate(() => window.__albummaniaReady === true);
      if (!ready) fail(`[${label}] window.__albummaniaReady absent`);
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

await finish('Parcours K0 sans erreur.');
if (stack) await stack.stop();
