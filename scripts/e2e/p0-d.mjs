// Parcours P0-D (PLAN.md 9.3, P0.5, P0.7, P0.8) : coquille, navigation, connexion, pages légales — ordinateur
// 1440 × 900 et téléphone 390 × 844, zéro erreur de console (hors images Deezer bloquées par le bac à sable).
//   - Visiteur : pages légales sans compte (5 onglets, mentions, page inconnue), lien « Signaler », formulaire
//     d'inscription (case « J'accepte les CGU et j'ai 15 ans ou plus » obligatoire), retour après la connexion sur la
//     page demandée (/collection/cards) et refus d'une destination externe.
//   - Ordinateur : barre du haut Boosters · Découvrir · Collection · Amis · Studio (chaque entrée ouvre sa page),
//     pastilles des boosters (vers l'accueil) et des royalties, FR/EN et son dans la barre à 1440 et 1280 px (pas à
//     1200), cloche, menu du compte (Mon Studio, Amis, Paramètres, Langue, Notation, Effets sonores, Se déconnecter),
//     Paramètres (langue, plateforme d'écoute gardée), bandeau des nouvelles CGU, page introuvable avec recherche,
//     pied de page sur une ligne.
//   - Téléphone : barre d'onglets à 5 entrées (nombre de boosters sur l'onglet Boosters), barre du haut sans
//     navigation ni FR/EN, chaque onglet ouvre sa page, aucun défilement horizontal, menu du compte.
//   - Démo autonome (dist-demo/albummania-demo.html), si elle est construite : inscription avec la case des CGU,
//     Découvrir, Paramètres, une page légale depuis le pied de page.
//   BASE=http://localhost:5104 OUT=/tmp/am-p0-d/shots DATABASE_FILE=/tmp/am-p0-d/am.db node scripts/e2e/p0-d.mjs
//   (sans BASE : démarre sa propre copie sur 3104 / 5104 avec une copie neuve de $FIXTURE dans /tmp/am-p0-d/am.db)
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, PASSWORD, run, shot, fillSignup, lastMailToken, signupViaApi, fail, finish,
  setBase, startStack, checkNoHorizontalScroll, launch, routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p0-d', apiPort: 3104, webPort: 5104, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);
const player = { email: `p0d_${stamp}@example.com`, username: `p0d_${stamp}` };
const other = { email: `p0d2_${stamp}@example.com`, username: `p0d2_${stamp}` };

const DB_FILE = process.env.DATABASE_FILE || '/tmp/am-p0-d/am.db';
const db = fs.existsSync(DB_FILE) ? new DatabaseSync(DB_FILE) : null;
db?.exec('PRAGMA busy_timeout = 5000');
const { config } = await import('../../server/config.js');

const NAV = [
  { href: '/', fr: 'Boosters', check: '.hero' },
  { href: '/discover', fr: 'Découvrir', check: '.sh-hub' },
  { href: '/collection', fr: 'Collection', check: '.page-head' },
  { href: '/friends', fr: 'Amis', check: '.friends' },
  { href: '/studio', fr: 'Studio', check: '.profile-head' },
];
const LEGAL = ['mentions', 'terms', 'privacy', 'rules', 'cookies'];
const expect = (cond, message) => !cond && fail(message);

/** Connexion par le formulaire, depuis la page de connexion déjà ouverte. */
async function submitLogin(page, identifier) {
  await page.fill('#login-id', identifier);
  await page.fill('#login-pw', PASSWORD);
  await page.click('button[type=submit]');
}

/** Le pied de page tient-il sur une ligne ? (hauteur de la ligne de texte ≤ 1,5 interligne) */
async function footerLines(page) {
  return page.$eval('.sh-footer__line', (el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    return Math.round(el.getBoundingClientRect().height / lh);
  });
}

// ---------- visiteur ----------

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  const p = name === 'desktop' ? 'd' : 'm';
  await run(`guest-${name}`, viewport, async (page) => {
    // Pages légales, lisibles sans compte, dans le cadre simple (logo, langue, connexion) avec le pied de page.
    await page.goto(`${BASE}/legal/terms`);
    await page.waitForSelector('.sh-guest .sh-legal');
    expect((await page.textContent('.sh-legal h1')).includes('Conditions générales'), `[guest-${name}] titre des CGU`);
    expect(await page.locator('.sh-legal__tabs .tabs__tab').count() === 5, `[guest-${name}] 5 onglets légaux`);
    for (const legal of LEGAL) {
      await page.click(`.sh-legal__tabs a[href="/legal/${legal}"]`);
      await page.waitForURL(`**/legal/${legal}`);
      await page.waitForSelector(`.sh-legal__tabs a[href="/legal/${legal}"].active`);
      await checkNoHorizontalScroll(page, `guest-${name} /legal/${legal}`);
    }
    await page.goto(`${BASE}/legal/mentions`);
    await page.waitForSelector('.sh-legal__facts dt');
    expect(await page.locator('.sh-legal__facts dt').count() === 8, `[guest-${name}] 8 coordonnées dans les mentions`);
    expect(await page.locator('.sh-footer a[href="/legal/terms"]').count() === 1, `[guest-${name}] lien CGU du pied de page`);
    if (fs.existsSync(path.join(ROOT, 'client/src/pages/Report.jsx'))) {
      expect(await page.locator('.sh-footer a[href="/report"]').count() === 1, `[guest-${name}] lien « Signaler » du pied de page`);
    }
    await shot(page, `${p}-05-guest-legal`, { fullPage: name === 'phone' });
    await page.goto(`${BASE}/legal/inconnue`);
    await page.waitForSelector('.sh-404');
    expect((await page.textContent('.sh-404 h1')).includes('Cette face n’existe pas'), `[guest-${name}] page légale inconnue`);

    // Inscription : la case des CGU est obligatoire (bouton désactivé tant qu'elle n'est pas cochée).
    await page.goto(`${BASE}/signup`);
    await page.fill('#su-email', `x_${name}_${stamp}@example.com`);
    await page.fill('#su-user', `x_${name}_${stamp}`);
    await page.fill('#su-pw', PASSWORD);
    await page.fill('#su-confirm', PASSWORD);
    await page.waitForSelector('.field__ok');
    expect(await page.isDisabled('.auth__form button[type=submit]'), `[guest-${name}] inscription possible sans la case des CGU`);
    expect(await page.locator('.sh-terms a[href="/legal/terms"]').count() === 1, `[guest-${name}] lien vers les CGU dans la case`);
    await page.check('#su-terms');
    expect(!(await page.isDisabled('.auth__form button[type=submit]')), `[guest-${name}] inscription bloquée malgré la case`);
    expect(await page.locator('.sh-auth-legal a').count() >= 3, `[guest-${name}] liens légaux de l'écran de connexion`);
    // Capture après la transition du bouton (fond ivoire une fois activé).
    await page.waitForTimeout(300);
    await shot(page, `${p}-06-signup`);
    await checkNoHorizontalScroll(page, `guest-${name} signup`);
  });
}

// Comptes du parcours : le joueur principal s'inscrit par le formulaire (case des CGU), le second par l'API.
await run('signup', VIEWPORTS.desktop, async (page) => {
  await fillSignup(page, player);
  await page.click('button[type=submit]');
  await page.waitForURL('**/check-email');
  const token = await lastMailToken(page, player.email);
  await page.goto(`${BASE}/verify?token=${token}`);
  await page.waitForSelector('.hero');
});
await run('signup-api', VIEWPORTS.desktop, async (page) => {
  await signupViaApi(page, other.email, other.username);
});

// Retour après la connexion : la page demandée est rouverte ; une destination externe est refusée.
await run('login-redirect', VIEWPORTS.desktop, async (page) => {
  await page.goto(`${BASE}/collection/cards?tri=1`);
  await page.waitForURL('**/login');
  await submitLogin(page, other.username);
  await page.waitForURL('**/collection/cards?tri=1');
  await page.waitForSelector('.page-head');
  await page.request.post(`${BASE}/api/auth/logout`, { headers: { 'X-AlbumMania': '1' } });
  // État d'historique forgé (« //exemple.com ») : la connexion mène à l'accueil.
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('#login-id');
  await page.evaluate(() => window.history.replaceState({ usr: { from: '//exemple.com/piege' }, key: 'piege', idx: 0 }, '', '/login'));
  await page.reload();
  await page.waitForSelector('#login-id');
  await submitLogin(page, other.username);
  await page.waitForSelector('.hero');
  expect(new URL(page.url()).origin === new URL(BASE).origin && new URL(page.url()).pathname === '/', `[login-redirect] destination externe suivie : ${page.url()}`);
});

// ---------- ordinateur ----------

await run('desktop', VIEWPORTS.desktop, async (page) => {
  await page.goto(`${BASE}/login`);
  await submitLogin(page, player.username);
  await page.waitForSelector('.hero');
  await page.evaluate(() => document.fonts.ready);
  const links = await page.$$eval('.topnav .topnav__link', (as) => as.map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })));
  expect(JSON.stringify(links.map((l) => l.href)) === JSON.stringify(NAV.map((n) => n.href)), `[desktop] entrées de la barre du haut : ${JSON.stringify(links)}`);
  for (const [i, n] of NAV.entries()) expect(links[i]?.text.startsWith(n.fr), `[desktop] libellé « ${n.fr} » (${links[i]?.text})`);
  for (const sel of ['.pill--packs', '.pill--royalties', '.topbar .seg.sh-wide', '.topbar .icon-btn.sh-wide', '.topbar .bell', '.account__btn']) {
    expect(await page.locator(sel).first().isVisible(), `[desktop] ${sel} visible à 1440 px`);
  }
  expect(!(await page.locator('.tabbar').isVisible()), '[desktop] barre d’onglets visible sur ordinateur');
  expect(await page.getAttribute('.pill--packs', 'href') === '/', '[desktop] la pastille des boosters mène à l’accueil');
  expect(await footerLines(page) === 1, `[desktop] pied de page sur ${await footerLines(page)} lignes à 1440 px`);
  await shot(page, 'd-10-home');

  // Chaque entrée de la navigation ouvre sa page.
  for (const n of NAV) {
    await page.click(`.topnav a[href="${n.href}"]`);
    await page.waitForSelector(n.check);
    await page.waitForSelector(`.topnav a[href="${n.href}"].active`);
    await checkNoHorizontalScroll(page, `desktop ${n.href}`);
  }
  await page.click('.topnav a[href="/discover"]');
  await page.waitForSelector('.sh-hub .album-tile');
  expect(await page.locator('.sh-hub a[href^="/collection/albums?genre="]').count() > 0, '[desktop] chips Par genre');
  expect(await page.locator('.sh-hub a[href="/blindtest"]').count() === 1, '[desktop] tuile Blind test dans Découvrir');
  await shot(page, 'd-20-discover', { fullPage: true });
  await page.click('.pill--packs');
  await page.waitForSelector('.hero');

  // FR/EN et son : dans la barre à partir de 1280 px, dans le menu en dessous.
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await page.locator('.topbar .seg.sh-wide').isVisible(), '[desktop] FR/EN visible à 1280 px');
  await checkNoHorizontalScroll(page, 'desktop 1280');
  await page.setViewportSize({ width: 1200, height: 900 });
  expect(!(await page.locator('.topbar .seg.sh-wide').isVisible()), '[desktop] FR/EN encore dans la barre à 1200 px');
  await checkNoHorizontalScroll(page, 'desktop 1200');
  // Tablette : la barre complète (cinq entrées, pastilles, cloche, avatar) tient sans défilement jusqu'à 861 px.
  for (const width of [1079, 980, 979, 900, 861]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.locator('.topnav').isVisible(), `[desktop] navigation du haut absente à ${width} px`);
    await checkNoHorizontalScroll(page, `desktop ${width}`);
    const over = await page.$eval('.topbar__inner', (el) => el.scrollWidth - el.clientWidth);
    expect(over <= 0, `[desktop] barre du haut trop large de ${over} px à ${width} px`);
  }
  await page.setViewportSize(VIEWPORTS.desktop);

  // Menu du compte.
  await page.click('.account__btn');
  await page.waitForSelector('.menu');
  await page.waitForTimeout(250); // fin de l'animation d'ouverture (pop) avant la capture
  const items = await page.$$eval('.menu a, .menu button, .menu .menu__row', (els) => els.map((e) => e.textContent.trim()));
  for (const label of ['Mon Studio', 'Amis', 'Paramètres', 'Langue', 'Notation', 'Effets sonores', 'Se déconnecter']) {
    expect(items.some((x) => x.includes(label)), `[desktop] menu du compte sans « ${label} »`);
  }
  expect(!items.some((x) => x.includes('Mon profil & Studio')), '[desktop] doublon « Mon profil & Studio » dans le menu');
  await shot(page, 'd-30-menu');
  await page.click('.menu a[href="/settings"]');
  await page.waitForSelector('.sh-settings');

  // Paramètres : langue (le titre passe en anglais), plateforme d'écoute gardée après rechargement.
  await page.click('.sh-settings .seg__btn:has-text("EN")');
  await page.waitForSelector('.sh-settings h1:has-text("Settings")');
  await page.click('.sh-settings .seg__btn:has-text("FR")');
  await page.waitForSelector('.sh-settings h1:has-text("Paramètres")');
  await page.click('.sh-settings .seg__btn:has-text("Spotify")');
  await page.waitForSelector('.toast');
  await page.reload();
  await page.waitForSelector('.sh-settings .seg__btn.is-on:has-text("Spotify")');
  expect(await page.locator('.sh-set__links a[href^="/legal/"]').count() === 5, '[desktop] liens légaux dans les Paramètres');
  await shot(page, 'd-40-settings', { fullPage: true });

  // Pages légales dans la coquille.
  await page.click('.sh-footer a[href="/legal/privacy"]');
  await page.waitForSelector('.sh-legal .sh-legal__table');
  expect(!(await page.locator('.sh-guest').count()), '[desktop] page légale hors de la coquille pour un joueur');
  await shot(page, 'd-50-legal');

  // Bandeau des nouvelles CGU (compte d'avant le changement de version).
  if (db) {
    db.prepare("UPDATE users SET terms_version = '2000-01-01' WHERE username = ?").run(player.username);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.sh-banner');
    await shot(page, 'd-60-terms-banner');
    await page.click('.sh-banner .btn');
    await page.waitForSelector('.sh-banner', { state: 'detached' });
    const row = db.prepare('SELECT terms_version FROM users WHERE username = ?').get(player.username);
    expect(row.terms_version === config.termsVersion, `[desktop] CGU non acceptées après le bandeau (${row.terms_version})`);
  } else {
    console.log(`Base ${DB_FILE} introuvable : bandeau des CGU non vérifié (DATABASE_FILE=…).`);
  }

  // Page introuvable : recherche.
  await page.goto(`${BASE}/cette-face-nexiste-pas`);
  await page.waitForSelector('.sh-404');
  await shot(page, 'd-70-not-found');
  const field = page.locator('.sh-404 input').first();
  await field.fill('daft');
  await field.press('Enter');
  await page.waitForURL(/\/(search|collection\/albums)\?q=daft/);
});

// ---------- téléphone ----------

await run('phone', VIEWPORTS.phone, async (page) => {
  await page.goto(`${BASE}/login`);
  await submitLogin(page, player.username);
  await page.waitForSelector('.hero');
  expect(!(await page.locator('.topnav').isVisible()), '[phone] navigation du haut visible sur téléphone');
  expect(!(await page.locator('.topbar .seg').first().isVisible()), '[phone] FR/EN dans la barre du haut sur téléphone');
  expect(!(await page.locator('.pill--packs').isVisible()), '[phone] pastille des boosters visible à 390 px');
  const tabs = await page.$$eval('.tabbar .tabbar__link', (as) => as.map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })));
  expect(JSON.stringify(tabs.map((t) => t.href)) === JSON.stringify(NAV.map((n) => n.href)), `[phone] onglets : ${JSON.stringify(tabs)}`);
  for (const [i, n] of NAV.entries()) expect(tabs[i]?.text.includes(n.fr), `[phone] onglet « ${n.fr} »`);
  expect(await page.locator('.tabbar .sh-tab--boosters .tabbar__count').isVisible(), '[phone] nombre de boosters sur l’onglet Boosters');
  const bg = await page.$eval('.tabbar', (el) => getComputedStyle(el).backgroundColor);
  expect(!/rgba\(.*,\s*0(\.\d+)?\)$/.test(bg), `[phone] barre d'onglets transparente (${bg})`);
  await checkNoHorizontalScroll(page, 'phone /');
  await shot(page, 'm-10-home');
  for (const n of [...NAV.slice(1), NAV[0]]) {
    await page.click(`.tabbar a[href="${n.href}"]`);
    await page.waitForSelector(n.check);
    await page.waitForSelector(`.tabbar a[href="${n.href}"].active`);
    await page.waitForTimeout(300);
    await checkNoHorizontalScroll(page, `phone ${n.href}`);
    if (n.href === '/discover') await shot(page, 'm-20-discover');
  }
  await page.click('.account__btn');
  await page.waitForSelector('.menu');
  await page.waitForTimeout(250); // fin de l'animation d'ouverture (pop) avant la capture
  expect(await page.locator('.menu .menu__row .seg').count() >= 1, '[phone] FR/EN dans le menu du compte');
  await shot(page, 'm-30-menu');
  await page.click('.menu a[href="/settings"]');
  await page.waitForSelector('.sh-settings');
  await checkNoHorizontalScroll(page, 'phone /settings');
  await shot(page, 'm-40-settings', { fullPage: true });
  for (const p of ['/legal/terms', '/legal/cookies', '/cette-face-nexiste-pas']) {
    await page.goto(`${BASE}${p}`);
    await page.waitForSelector(p.startsWith('/legal') ? '.sh-legal' : '.sh-404');
    await checkNoHorizontalScroll(page, `phone ${p}`);
  }
  await page.goto(`${BASE}/legal/terms`);
  await page.waitForSelector('.sh-legal');
  await shot(page, 'm-50-legal');
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
      await page.fill('#su-confirm', PASSWORD);
      await page.waitForSelector('.field__ok');
      expect(await page.isDisabled('.auth__form button[type=submit]'), `[${label}] inscription possible sans la case des CGU`);
      await page.check('#su-terms');
      await page.click('button[type=submit]');
      await page.click('.demo-mail .btn');
      await page.waitForSelector('.hero');
      const nav = name === 'desktop' ? '.topnav' : '.tabbar';
      await page.click(`${nav} a[href="/discover"]`);
      await page.waitForSelector('.sh-hub .album-tile');
      await page.click('.account__btn');
      await page.click('.menu a[href="/settings"]');
      await page.waitForSelector('.sh-settings');
      await page.click('.sh-set__links a[href="/legal/mentions"]');
      await page.waitForSelector('.sh-legal__facts');
      await checkNoHorizontalScroll(page, label);
      await page.screenshot({ path: `${OUT}/${name === 'desktop' ? 'd' : 'm'}-80-demo-legal.png` });
    } catch (err) {
      await page.screenshot({ path: `${OUT}/zz-error-${label}.png` }).catch(() => {});
      fail(`[${label}] ${err.stack || err.message}`);
    } finally {
      await ctx.close();
    }
  }
} else {
  console.log('Démo absente (npm run build:demo) : partie démo sautée.');
}

db?.close();
await finish('Parcours P0-D complet sans erreur.');
if (stack) await stack.stop();
