// Second passage complet du brief (PLAN.md 9.5, critère P2.7) — chantier P2-E.
// Sur le site compilé (npm run build), servi par le serveur avec ses en-têtes de production (CSP) : pas de double
// rendu du mode strict de React comme en développement, donc une requête envoyée deux fois se voit vraiment.
//  1. Exploration, en ordinateur 1440 × 900 et en téléphone 390 × 844, pour un joueur et pour l'admin : depuis
//     l'accueil (menu du compte ouvert), chaque lien interne de chaque page est suivi, une ou deux adresses par forme
//     (/album/:id, /u/:username…), tous les onglets. Sur chaque page : erreur de page ou de console (hors images
//     Deezer bloquées par le bac à sable), réponse de l'API en erreur, lien mort (page introuvable), défilement
//     horizontal, image cassée (hors pochettes Deezer), requête GET de l'API envoyée deux fois au chargement.
//  2. Droits : visiteur (pages réservées → connexion, pages publiques ouvertes, API 401), joueur (pas d'espace admin,
//     API admin 403), admin (espace admin et ses onglets, par l'exploration).
//  3. P2-E : polices servies par le site (aucune requête Google Fonts, faces Archivo / Figtree / Martian Mono
//     chargées), filtre texte de la Collection (index de la recherche, fautes de frappe), pages suivantes sans
//     doublon, en-tête CSP sans Google Fonts (signalé tant que server/app.js le cite), démo autonome hors ligne avec
//     ses polices embarquées.
//   BASE=http://localhost:3125 OUT=/tmp/am-full/shots node scripts/e2e/full.mjs   (BASE : un site compilé déjà servi)
//   (sans BASE : compile le site, démarre sa copie sur 3125 / 5125 avec une copie neuve de $FIXTURE et explore le site
//    compilé servi par l'API, http://localhost:3125)
// Variables : FULL_MAX_PAGES (pages par exploration, 90 par défaut), FULL_PER_SHAPE (adresses par forme, 2).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, fail, finish, setBase, startStack, signupViaApi, loginAdmin, apiCall, launch,
  routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
let BASE = INITIAL_BASE;
if (!process.env.BASE) {
  const build = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) throw new Error('compilation du site (vite build) en échec');
  stack = await startStack({ id: 'full', apiPort: 3125, webPort: 5125, freshDb: true });
  BASE = stack.apiBase;
  setBase(BASE);
}
const MAX_PAGES = Number(process.env.FULL_MAX_PAGES) || 90;
const PER_SHAPE = Number(process.env.FULL_PER_SHAPE) || 2;
const stamp = Date.now().toString(36).slice(-5);
const report = [];
// Problèmes connus relevés (hors des fichiers de ce chantier, correctif demandé) : affichés au bilan.
const known = new Set();
fs.mkdirSync(OUT, { recursive: true });

// ---------- formes d'adresses : un ou deux exemples par forme, chaque onglet compte pour lui-même ----------

const SHAPES = [
  [/^\/album\/[^/]+$/, '/album/:id'], [/^\/track\/[^/]+$/, '/track/:id'], [/^\/artist\/[^/]+$/, '/artist/:id'],
  [/^\/u\/[^/]+\/nine$/, '/u/:u/nine'], [/^\/u\/[^/]+\/passport$/, '/u/:u/passport'], [/^\/u\/[^/]+\/([^/]+)$/, '/u/:u/$1'],
  [/^\/u\/[^/]+$/, '/u/:u'], [/^\/list\/[^/]+\/edit$/, '/list/:id/edit'], [/^\/list\/[^/]+$/, '/list/:id'], [/^\/post\/[^/]+$/, '/post/:id'],
  [/^\/review\/[^/]+$/, '/review/:id'], [/^\/match\/[^/]+$/, '/match/:u'], [/^\/sets\/[^/]+$/, '/sets/:id'], [/^\/events\/[^/]+$/, '/events/:slug'],
  [/^\/rankings\/[^/]+$/, '/rankings/:category'], [/^\/retro\/[^/]+$/, '/retro/:year'],
];
function shapeOf(pathname) {
  for (const [re, shape] of SHAPES) if (re.test(pathname)) return pathname.replace(re, shape);
  return pathname;
}
// Liens qu'on ne suit pas : sortie de compte, boîte e-mail de test, téléchargements.
const SKIP = [/^\/logout/, /^\/dev\//, /^\/api\//, /\.(png|json|pdf|zip)$/];

// ---------- exceptions connues (relevées et signalées, hors des fichiers de ce chantier) ----------

// Requêtes GET répétées au chargement d'une page qui ne sont pas des doublons : le site les redemande exprès.
const REPEAT_OK = [
  /^\/api\/notifications\/unread/, // pastille de la cloche : relue par le shell et par la page des notifications
];
// Doublons connus dans des fichiers d'autres chantiers, corrigés par le correctif joint au compte rendu P2-E
// (FULL_STRICT=1 les compte comme des erreurs, pour vérifier le site une fois le correctif appliqué).
const KNOWN_DUPES = process.env.FULL_STRICT ? [] : [
  // StudioTabs.jsx (RatingsSummary) : son propre Studio rechargeait ses notes dès le montage.
  /^\/api\/users\/[^/]+\/ratings$/,
];
// Réponses en erreur attendues : la session vérifiée avant connexion.
const API_ERROR_OK = [/^GET \/api\/state 401$/];

// ---------- instrumentation d'une page ----------

function instrument(page, label) {
  const watch = { path: '(début)', gets: new Map(), google: 0, apiErrors: [] };
  const where = () => `[${label} ${watch.path}]`;
  page.on('pageerror', (e) => fail(`${where()} ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`${where()} console: ${m.text()} (${m.location()?.url || '?'})`));
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) watch.google += 1;
    if (req.method() === 'GET' && url.origin === new URL(BASE).origin && url.pathname.startsWith('/api/')) {
      const key = `${url.pathname}${url.search}`;
      watch.gets.set(key, (watch.gets.get(key) || 0) + 1);
    }
  });
  page.on('response', (res) => {
    const url = new URL(res.url());
    if (url.origin !== new URL(BASE).origin || !url.pathname.startsWith('/api/') || res.status() < 400) return;
    const line = `${res.request().method()} ${url.pathname} ${res.status()}`;
    if (!API_ERROR_OK.some((re) => re.test(line))) watch.apiErrors.push(`${line}${url.search}`);
  });
  return watch;
}

/** Laisse la page finir ses requêtes (réseau calme), sans attendre plus de quelques secondes. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(250);
}

/** Contrôles d'une page affichée : lien mort, défilement horizontal, images cassées, doublons, erreurs de l'API. */
async function inspect(page, watch, label, from) {
  const tag = `[${label} ${watch.path}]`;
  if (await page.locator('.sh-404').count()) fail(`${tag} lien mort (page introuvable)${from ? ` depuis ${from}` : ''}`);
  else if (await page.locator('.catalog-missing').count()) fail(`${tag} lien vers un élément introuvable${from ? ` depuis ${from}` : ''}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) fail(`${tag} défilement horizontal de ${overflow} px`);
  const broken = await page.evaluate(() => [...document.images]
    .filter((img) => img.complete && img.naturalWidth === 0 && img.currentSrc && !/dzcdn\.net|deezer/.test(img.currentSrc))
    .map((img) => img.currentSrc.slice(0, 120)));
  if (broken.length) fail(`${tag} images cassées : ${[...new Set(broken)].join(', ')}`);
  const dupes = [...watch.gets].filter(([key, n]) => n > 1 && !REPEAT_OK.some((re) => re.test(key)));
  for (const [key] of dupes.filter(([key]) => KNOWN_DUPES.some((re) => re.test(key)))) known.add(`requête en double ${key} (${watch.path})`);
  dupes.splice(0, dupes.length, ...dupes.filter(([key]) => !KNOWN_DUPES.some((re) => re.test(key))));
  if (dupes.length) fail(`${tag} requêtes en double : ${dupes.map(([k, n]) => `${k} ×${n}`).join(', ')}`);
  if (watch.apiErrors.length) fail(`${tag} réponses de l'API en erreur : ${[...new Set(watch.apiErrors)].join(', ')}`);
}

/** Liens internes de la page (ancres et liens du routeur), sans requête ni ancre. */
async function linksOf(page) {
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
  const out = [];
  for (const href of hrefs) {
    if (!href || !href.startsWith('/') || href.startsWith('//')) continue;
    const url = new URL(href, BASE);
    if (SKIP.some((re) => re.test(url.pathname))) continue;
    out.push(`${url.pathname}${url.search}`);
  }
  return out;
}

/** Ouvre une page dans l'onglet (navigation complète) et la contrôle. */
async function visit(page, watch, label, target, from) {
  watch.gets = new Map();
  watch.apiErrors = [];
  watch.path = target;
  await page.goto(`${BASE}${target}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await inspect(page, watch, label, from);
}

/**
 * Exploration d'un compte connecté : file des liens trouvés (formes nouvelles d'abord), une ou deux adresses par forme,
 * MAX_PAGES au plus. Une capture par forme (première visite). Renvoie les formes visitées.
 */
// Pages ouvertes par un formulaire ou un bouton plutôt que par un lien (recherche, cloche, filtres).
const DIRECT = ['/search?q=daft', '/notifications', '/collection/albums?q=dicovery', '/collection/cards?q=one'];

async function crawl(page, watch, label, prefix) {
  const queue = [['/', null], ...DIRECT.map((target) => [target, '(adresse ouverte par un formulaire)'])];
  const seenPaths = new Set();
  const perShape = new Map();
  const shapes = [];
  let pages = 0;
  while (queue.length && pages < MAX_PAGES) {
    // Les formes encore jamais vues d'abord (onglets, nouvelles pages), puis les seconds exemples.
    let next = queue.findIndex(([t]) => !perShape.has(shapeOf(t.split('?')[0])) && !seenPaths.has(t.split('?')[0]));
    if (next < 0) next = 0;
    const [target, from] = queue.splice(next, 1)[0];
    const pathname = target.split('?')[0];
    if (seenPaths.has(pathname)) continue;
    seenPaths.add(pathname);
    const shape = shapeOf(pathname);
    const count = perShape.get(shape) || 0;
    if (count >= PER_SHAPE) continue;
    perShape.set(shape, count + 1);
    pages += 1;
    await visit(page, watch, label, target, from);
    // Accueil d'un compte qui n'a pas fait ses premiers pas : passage unique par /welcome, on revient à l'accueil.
    if (pathname === '/' && !(await page.locator('.hero').count())) await visit(page, watch, label, '/', null);
    if (!count) {
      shapes.push(shape);
      const file = `${prefix}-${String(shapes.length).padStart(2, '0')}-${shape.replace(/[/:?=&]+/g, '_').replace(/^_|_$/g, '') || 'home'}`;
      await page.screenshot({ path: `${OUT}/${file}.png` }).catch(() => {});
    }
    const found = await linksOf(page);
    // Menu du compte (liens qu'il ne montre qu'une fois ouvert), sur la première page.
    if (pages === 1 && (await page.locator('.account__btn').count())) {
      await page.locator('.account__btn').first().click();
      await page.waitForTimeout(200);
      found.push(...(await linksOf(page)));
      await page.keyboard.press('Escape');
    }
    for (const link of found) if (!seenPaths.has(link.split('?')[0])) queue.push([link, pathname]);
  }
  report.push(`${label} : ${pages} pages, ${shapes.length} formes`);
  return shapes;
}

/** Contexte neuf (fenêtre, polices) et sa page instrumentée. */
async function contextFor(viewport, label) {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'fr-FR' });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  return { ctx, page, watch: instrument(page, label) };
}

async function guarded(label, fn) {
  try {
    await fn();
  } catch (err) {
    fail(`[${label}] ${err.stack || err.message}`);
  }
}

// ---------- comptes : un joueur avec du contenu (cartes, note, liste, ami, post), l'admin ----------

const browser = await launch();
const adminCtx = await browser.newContext({ viewport: VIEWPORTS.desktop, locale: 'fr-FR' });
await routeFonts(adminCtx);
const adminPage = await adminCtx.newPage();
await loginAdmin(adminPage);

const playerName = `full_${stamp}`;
const friendName = `ami_${stamp}`;
const seed = await browser.newContext({ locale: 'fr-FR' });
const seedPage = await seed.newPage();
const friendCtx = await browser.newContext({ locale: 'fr-FR' });
const friendPage = await friendCtx.newPage();
await signupViaApi(friendPage, `${friendName}@example.com`, friendName);
const player = await signupViaApi(seedPage, `${playerName}@example.com`, playerName);
async function must(p, method, route, body, ok = [200, 201]) {
  const r = await apiCall(p, method, route, body);
  if (!ok.includes(r.status)) fail(`[préparation] ${method} ${route} : ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}
await must(adminPage, 'POST', `/admin/users/${player.id}/grant`, { packs: 6, royalties: 5000 });
for (let i = 0; i < 3; i++) await must(seedPage, 'POST', '/packs/open', {});
await must(seedPage, 'POST', '/packs/album', { albumId: 'discovery' });
await must(seedPage, 'PUT', '/ratings/album/discovery', { score: 9, review: `Un disque qui ne vieillit pas : la French Touch à son sommet (${stamp}).` });
await must(seedPage, 'POST', '/lists', { title: `Mes classiques ${stamp}`, items: [{ type: 'album', id: 'discovery' }, { type: 'album', id: 'thriller' }] });
await must(seedPage, 'POST', '/posts', { body: `Premier passage complet du site (${stamp}).`, item: { type: 'album', id: 'discovery' } });
await must(friendPage, 'POST', '/friends/request', { username: playerName });
const inbox = await must(seedPage, 'GET', '/friends');
const request = inbox.incoming?.[0]?.requestId;
if (request) await must(seedPage, 'POST', `/friends/${request}/accept`);
await seed.close();
await friendCtx.close();

// ---------- 1. exploration : joueur et admin, ordinateur et téléphone ----------

const allShapes = new Set();
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  const p = name === 'desktop' ? 'd' : 'm';
  await guarded(`full-${name}-joueur`, async () => {
    const { ctx, page, watch } = await contextFor(viewport, `${name} joueur`);
    const res = await page.request.post(`${BASE}/api/auth/login`, { headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json' }, data: { identifier: playerName, password: 'motdepasse123' } });
    if (res.status() !== 200) throw new Error(`connexion du joueur : ${res.status()}`);
    for (const shape of await crawl(page, watch, `${name} joueur`, `${p}-joueur`)) allShapes.add(shape);
    if (watch.google) fail(`[${name} joueur] ${watch.google} requêtes vers Google Fonts`);
    await ctx.close();
  });
  await guarded(`full-${name}-admin`, async () => {
    const { ctx, page, watch } = await contextFor(viewport, `${name} admin`);
    await page.request.post(`${BASE}/api/auth/login`, { headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json' }, data: { identifier: 'luka', password: 'motdepasse123' } });
    const shapes = await crawl(page, watch, `${name} admin`, `${p}-admin`);
    for (const shape of shapes) allShapes.add(shape);
    if (!shapes.some((s) => s.startsWith('/admin'))) fail(`[${name} admin] espace admin jamais atteint depuis l'interface`);
    await ctx.close();
  });
}
report.push(`formes d'adresses visitées : ${allShapes.size}`);

// ---------- 2. droits : visiteur, joueur ----------

const PROTECTED = ['/', '/collection', '/collection/albums', '/studio', '/settings', '/friends', '/admin', '/album/discovery', '/notifications', '/passport'];
const PUBLIC = ['/login', '/signup', '/forgot', '/report', '/legal/mentions', '/legal/terms', '/legal/privacy', '/legal/rules', '/legal/cookies'];
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  await guarded(`full-${name}-visiteur`, async () => {
    const { ctx, page, watch } = await contextFor(viewport, `${name} visiteur`);
    for (const target of PROTECTED) {
      await visit(page, watch, `${name} visiteur`, target, null);
      if (!new URL(page.url()).pathname.startsWith('/login')) fail(`[${name} visiteur] ${target} ouvert sans compte (${page.url()})`);
    }
    for (const target of PUBLIC) {
      await visit(page, watch, `${name} visiteur`, target, null);
      if (new URL(page.url()).pathname !== target) fail(`[${name} visiteur] ${target} redirigé vers ${page.url()}`);
    }
    await page.screenshot({ path: `${OUT}/${name === 'desktop' ? 'd' : 'm'}-visiteur-legal.png` });
    for (const route of ['/state', '/admin/overview', '/catalog/albums', '/search/suggest?q=daft']) {
      const r = await apiCall(page, 'GET', route);
      if (r.status !== 401) fail(`[${name} visiteur] GET /api${route} : ${r.status} (401 attendu)`);
    }
    await ctx.close();
  });
}
await guarded('full-droits-joueur', async () => {
  const { ctx, page, watch } = await contextFor(VIEWPORTS.desktop, 'droits joueur');
  await page.request.post(`${BASE}/api/auth/login`, { headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json' }, data: { identifier: playerName, password: 'motdepasse123' } });
  for (const target of ['/admin', '/admin/moderation', '/admin/catalog']) {
    await visit(page, watch, 'droits joueur', target, null);
    if (new URL(page.url()).pathname.startsWith('/admin')) fail(`[droits joueur] ${target} ouvert à un joueur`);
  }
  if (await page.locator('a[href="/admin"]').count()) fail('[droits joueur] lien vers l’espace admin visible');
  for (const [method, route] of [['GET', '/admin/overview'], ['GET', '/admin/search'], ['POST', '/admin/search/rebuild'], ['GET', '/admin/enrich'], ['POST', `/admin/users/${player.id}/grant`]]) {
    const r = await apiCall(page, method, route, method === 'POST' ? { packs: 1 } : undefined);
    if (r.status !== 403) fail(`[droits joueur] ${method} /api${route} : ${r.status} (403 attendu)`);
  }
  await ctx.close();
});

// ---------- 3. P2-E : polices, filtre texte de la Collection, pages suivantes, CSP ----------

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  await guarded(`full-${name}-p2e`, async () => {
    const p = name === 'desktop' ? 'd' : 'm';
    const { ctx, page, watch } = await contextFor(viewport, `${name} P2-E`);
    await page.request.post(`${BASE}/api/auth/login`, { headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json' }, data: { identifier: playerName, password: 'motdepasse123' } });
    const fontFiles = new Set();
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (/\.woff2$/.test(u.pathname)) {
        if (u.origin !== new URL(BASE).origin) fail(`[${name} P2-E] police chargée ailleurs que sur le site : ${u.href}`);
        else if (r.status() !== 200) fail(`[${name} P2-E] police ${u.pathname} : ${r.status()}`);
        fontFiles.add(u.pathname.replace(/^.*\//, '').replace(/-[\w-]{8}\.woff2$/, ''));
      }
    });
    await visit(page, watch, `${name} P2-E`, '/', null);
    await page.evaluate(() => document.fonts.ready);
    const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')));
    for (const family of ['Archivo', 'Figtree', 'Martian Mono']) {
      if (!faces.includes(family)) fail(`[${name} P2-E] police ${family} non chargée (${[...new Set(faces)].join(', ')})`);
    }
    const heading = await page.evaluate(() => getComputedStyle(document.querySelector('.hero h1, h1')).fontFamily);
    if (!/Archivo/.test(heading)) fail(`[${name} P2-E] titre en ${heading}`);
    // Les sous-ensembles inutiles (cyrillique, vietnamien) ne sont pas téléchargés.
    if ([...fontFiles].some((f) => /cyrillic|vietnamese/.test(f))) fail(`[${name} P2-E] sous-ensembles téléchargés sans besoin : ${[...fontFiles].join(', ')}`);
    report.push(`${name} : polices du site ${[...fontFiles].sort().join(', ')}`);

    // Collection, onglet Albums : faute de frappe → l'album approché ; puis la grille par titre, page suivante sans doublon.
    await visit(page, watch, `${name} P2-E`, '/collection/albums?q=dicovery', null);
    await page.waitForSelector('.album-tile', { timeout: 15_000 });
    const first = await page.locator('.album-tile').first().innerText();
    if (!/Discovery/.test(first)) fail(`[${name} P2-E] filtre « dicovery » : premier album « ${first.split('\n')[0]} »`);
    await page.screenshot({ path: `${OUT}/${p}-p2e-collection-typo.png` });
    await visit(page, watch, `${name} P2-E`, '/collection/albums?sort=title', null);
    await page.waitForSelector('.album-tile', { timeout: 15_000 });
    const before = await page.locator('.album-tile').count();
    const more = page.locator('.load-more button, button.load-more, .coll-more button').first();
    for (let i = 0; i < 2; i++) {
      if (await more.count()) await more.click().catch(() => {});
      else await page.mouse.wheel(0, 20_000);
      await page.waitForTimeout(800);
    }
    await settle(page);
    const titles = await page.locator('.album-tile__title, .album-tile h3').allInnerTexts();
    const hrefs = await page.locator('.album-tile a[href^="/album/"], a.album-tile[href^="/album/"]').evaluateAll((list) => list.map((a) => a.getAttribute('href')));
    if (titles.length <= before) fail(`[${name} P2-E] la grille ne charge pas la page suivante (${before} → ${titles.length})`);
    if (new Set(hrefs).size !== hrefs.length) fail(`[${name} P2-E] albums en double dans la grille`);
    await inspect(page, watch, `${name} P2-E`, null);
    await page.screenshot({ path: `${OUT}/${p}-p2e-collection-title.png` });
    report.push(`${name} : grille par titre ${before} → ${titles.length} albums`);
    if (watch.google) fail(`[${name} P2-E] ${watch.google} requêtes vers Google Fonts`);
    await ctx.close();
  });
}
// Démo autonome (npm run build:demo), hors ligne : toute requête réseau est coupée ; les polices viennent du fichier.
const demoFile = path.join(ROOT, 'dist-demo/albummania-demo.html');
if (fs.existsSync(demoFile)) {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    await guarded(`full-${name}-demo`, async () => {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'fr-FR' });
      const outside = [];
      await ctx.route(/^https?:/, (route) => {
        outside.push(route.request().url());
        return route.abort();
      });
      const page = await ctx.newPage();
      const label = `${name} démo`;
      page.on('pageerror', (e) => fail(`[${label}] ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${label}] console: ${m.text()}`));
      await page.goto(`file://${demoFile}`);
      await page.waitForSelector('.auth__form', { timeout: 20_000 });
      await page.getByText(/Créer un compte/).first().click();
      await page.fill('#su-email', `demo_full_${name}@example.com`);
      await page.fill('#su-user', `demofull${name}`);
      await page.fill('#su-pw', 'motdepasse123');
      if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', 'motdepasse123');
      for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
      await page.waitForSelector('.field__ok');
      await page.click('button[type=submit]');
      await page.click('.demo-mail .btn');
      await page.waitForSelector('.hero, [data-onboarding]', { timeout: 20_000 });
      if (!(await page.locator('.hero').count())) {
        await page.goto(`file://${demoFile}`);
        await page.waitForSelector('.hero', { timeout: 20_000 });
      }
      await page.evaluate(() => document.fonts.ready);
      const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '')));
      for (const family of ['Archivo', 'Figtree', 'Martian Mono']) {
        if (!faces.includes(family)) fail(`[${label}] police ${family} non chargée hors ligne (${[...new Set(faces)].join(', ')})`);
      }
      const fontRequests = outside.filter((u) => /fonts\.(googleapis|gstatic)\.com|\.woff2/.test(u));
      if (fontRequests.length) fail(`[${label}] polices demandées au réseau : ${fontRequests.join(', ')}`);
      await page.screenshot({ path: `${OUT}/${name === 'desktop' ? 'd' : 'm'}-demo-home.png` });
      report.push(`${label} : polices chargées hors ligne (${[...new Set(faces)].join(', ')}), ${outside.length} requêtes réseau coupées`);
      await ctx.close();
    });
  }
} else {
  report.push('Démo absente (npm run build:demo) : partie démo sautée.');
}

// En-tête CSP des pages : plus de Google Fonts une fois server/app.js corrigé (hors de ce chantier : signalé).
const csp = (await (await fetch(`${BASE}/`)).headers.get('content-security-policy')) || '';
if (/fonts\.(googleapis|gstatic)\.com/.test(csp)) report.push('À SIGNALER : la CSP de server/app.js cite encore Google Fonts (correctif demandé dans le compte rendu P2-E)');
else if (!/font-src 'self'/.test(csp)) fail(`[CSP] font-src inattendu : ${csp}`);

await adminCtx.close();
if (known.size) report.push(`connus, correctif demandé (FULL_STRICT=1 pour les compter) : ${[...known].join(' ; ')}`);
console.log(report.map((line) => `  ${line}`).join('\n'));
await finish('Second passage complet sans erreur.');
if (stack) await stack.stop();
