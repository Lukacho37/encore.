// Outils communs des parcours dans un vrai navigateur (PLAN.md 9.0) : lancement de Chromium, `run(nom, viewport, fn)`
// avec capture des erreurs de console, inscription / connexion, aides admin, captures d'écran, et démarrage d'une
// copie du site (API + Vite) sur les ports d'un chantier. Extrait de scripts/e2e.mjs (qui l'utilise aussi).
//   BASE=http://localhost:5101 OUT=/tmp/am-p0-a/shots node scripts/e2e/p0-a.mjs
// Variables : BASE (site), OUT (captures), CHROMIUM (navigateur, défaut /opt/pw-browsers/chromium s'il existe),
// ROUTE_FONTS_VIA_CURL=1 (polices Google téléchargées par curl derrière un proxy qui intercepte le TLS).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export let BASE = process.env.BASE || 'http://localhost:3000';
/** Change l'adresse du site visé (après startStack). */
export function setBase(url) {
  BASE = url;
}
export const OUT = process.env.OUT || 'shots';
export const PASSWORD = 'motdepasse123';
export const ADMIN = { email: 'luka@example.com', username: 'luka' };
export const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };

const DEFAULT_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath = process.env.CHROMIUM || (fs.existsSync(DEFAULT_CHROMIUM) ? DEFAULT_CHROMIUM : undefined);

/** Erreurs relevées pendant tous les parcours (affichées par finish()). */
export const errors = [];
export const fail = (message) => errors.push(message);

let browser = null;
export async function launch() {
  browser ||= await chromium.launch({ executablePath });
  return browser;
}

/** Les polices Google passent par curl (magasin de certificats du système) quand ROUTE_FONTS_VIA_CURL est posé. */
export async function routeFonts(ctx) {
  if (!process.env.ROUTE_FONTS_VIA_CURL) return;
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => {
    try {
      const body = execFileSync('curl', ['-sS', '-A', 'Mozilla/5.0 Chrome/140', route.request().url()]);
      const type = route.request().url().includes('googleapis') ? 'text/css' : 'font/woff2';
      return route.fulfill({ status: 200, body, headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
    } catch {
      return route.abort();
    }
  });
}

/**
 * Erreur de console à ignorer : le 401 de /api/state avant connexion, et les ressources bloquées par le réseau
 * (« net::ERR_… » : pochettes Deezer dans un bac à sable sans Internet, le site affiche alors le visuel généré).
 * Les vraies erreurs HTTP du site restent comptées.
 */
export const ignoredConsole = (text) => text.includes('401') || /Failed to load resource: net::ERR_/.test(text);

/**
 * Lance `fn(page, ctx)` dans un contexte neuf (fenêtre `viewport`, français par défaut) ; toute erreur de page ou
 * de console (hors ignoredConsole) est relevée sous `[name]`. En cas d'échec, capture `zz-error-<name>.png`.
 */
export async function run(name, viewport, fn, { locale = 'fr-FR' } = {}) {
  const b = await launch();
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, locale });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`[${name}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${name}] console: ${m.text()}`));
  fs.mkdirSync(OUT, { recursive: true });
  try {
    await fn(page, ctx);
  } catch (err) {
    await page.screenshot({ path: `${OUT}/zz-error-${name}.png` }).catch(() => {});
    fail(`[${name}] ${err.stack || err.message}`);
  } finally {
    await ctx.close();
  }
}

/** Capture de la fenêtre (ou de toute la page avec { fullPage: true }) dans OUT/<file>.png. */
export const shot = (page, file, { fullPage = false } = {}) => page.screenshot({ path: `${OUT}/${file}.png`, fullPage });

/** Remplit le formulaire d'inscription et coche ses cases (CGU, âge) quand elles existent, sans l'envoyer. */
export async function fillSignup(page, { email, username, password = PASSWORD }) {
  await page.goto(`${BASE}/signup`);
  await page.fill('#su-email', email);
  await page.fill('#su-user', username);
  await page.fill('#su-pw', password);
  if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', password);
  for (const box of await page.locator('.auth__form input[type=checkbox]').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.waitForSelector('.field__ok');
}

/** Lien du dernier e-mail reçu par `email` dans la boîte de test (DEV_MAILBOX=1). */
export async function lastMailToken(page, email) {
  const mails = await (await page.request.get(`${BASE}/api/dev/emails`)).json();
  const mail = mails.find((m) => m.to === email);
  if (!mail) throw new Error(`pas d'e-mail pour ${email}`);
  return /token=([\w-]+)/.exec(mail.text)[1];
}

/** Inscription complète par le site (formulaire, boîte de test, lien de confirmation) ; finit sur l'accueil. */
export async function signup(page, email, username, { password = PASSWORD } = {}) {
  await fillSignup(page, { email, username, password });
  await page.click('button[type=submit]');
  await page.waitForURL('**/check-email');
  const token = await lastMailToken(page, email);
  await page.goto(`${BASE}/verify?token=${token}`);
  await page.waitForSelector('.hero');
}

/**
 * Inscription par l'API (plus rapide, pour préparer des comptes secondaires) : CGU acceptées, 15 ans ou plus,
 * adresse confirmée ; la session est gardée par le contexte de `page` (cookies partagés avec le navigateur).
 */
export async function signupViaApi(page, email, username, { password = PASSWORD } = {}) {
  const headers = { 'X-AlbumMania': '1', 'Content-Type': 'application/json' };
  const res = await page.request.post(`${BASE}/api/auth/signup`, { headers, data: { email, username, password, acceptTerms: true, age15: true } });
  if (res.status() !== 201) throw new Error(`inscription de ${username} : ${res.status()} ${await res.text()}`);
  const token = await lastMailToken(page, email);
  const verify = await page.request.post(`${BASE}/api/auth/verify`, { headers, data: { token } });
  if (verify.status() !== 200) throw new Error(`confirmation de ${username} : ${verify.status()}`);
  return (await verify.json()).user;
}

/** Connexion par le formulaire ; finit sur l'accueil (ou la page demandée avant la connexion). */
export async function login(page, identifier, { password = PASSWORD, expect = '.hero' } = {}) {
  await page.goto(`${BASE}/login`);
  await page.fill('#login-id', identifier);
  await page.fill('#login-pw', password);
  await page.click('button[type=submit]');
  if (expect) await page.waitForSelector(expect);
}

/** Connexion du compte admin (ADMIN_EMAILS=luka@example.com), créé à la première utilisation. */
export async function loginAdmin(page) {
  const res = await page.request.post(`${BASE}/api/auth/login`, {
    headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json' },
    data: { identifier: ADMIN.username, password: PASSWORD },
  });
  if (res.status() === 200) {
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.hero');
    return;
  }
  await signup(page, ADMIN.email, ADMIN.username);
}

/** Appel direct de l'API avec la session de la page (en-tête anti-CSRF compris). */
export async function apiCall(page, method, apiPath, data) {
  const res = await page.request.fetch(`${BASE}/api${apiPath}`, {
    method,
    headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json' },
    ...(data !== undefined && { data }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status(), body };
}

/** Admin : donne des royalties / boosters à un joueur (POST /api/admin/users/:id/grant). */
export const adminGrant = (page, userId, data) => apiCall(page, 'POST', `/admin/users/${userId}/grant`, data);

/** Relève un défilement horizontal de la page (interdit sur téléphone). */
export async function checkNoHorizontalScroll(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) fail(`[${label}] défilement horizontal de ${overflow} px`);
}

/** Ferme le navigateur, affiche le bilan et pose le code de sortie. */
export async function finish(okMessage = 'Parcours complet sans erreur.') {
  if (browser) await browser.close();
  browser = null;
  if (errors.length) {
    console.log('ERREURS :\n' + errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(okMessage);
  }
}

// ---------- copie du site sur les ports d'un chantier ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // pas encore prêt
    }
    await sleep(250);
  }
  throw new Error(`${url} ne répond pas après ${timeoutMs} ms`);
}

/**
 * Démarre l'API et Vite d'un chantier (PLAN.md 9.0) : base copiée de `fixture` dans /tmp/am-<id>/am.db (une seule
 * fois, sauf `freshDb`), PID écrits dans /tmp/am-<id>/{api,web}.pid, journaux dans /tmp/am-<id>/{api,web}.log.
 * Renvoie `{ base, apiBase, dir, stop() }` ; stop() arrête les deux processus par leur PID.
 */
export async function startStack({ id, apiPort, webPort, fixture = process.env.FIXTURE, freshDb = false, env = {} }) {
  const dir = `/tmp/am-${id}`;
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'am.db');
  if (freshDb) for (const ext of ['', '-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
  if (!fs.existsSync(dbFile) && fixture) fs.copyFileSync(fixture, dbFile);
  const common = { ...process.env, NODE_ENV: 'development' };
  const procs = [];
  const start = (name, args, extraEnv) => {
    const log = fs.openSync(path.join(dir, `${name}.log`), 'a');
    const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...common, ...extraEnv }, stdio: ['ignore', log, log], detached: false });
    fs.writeFileSync(path.join(dir, `${name}.pid`), String(child.pid));
    procs.push(child);
    return child;
  };
  start('api', ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    DATABASE_FILE: dbFile, ADMIN_EMAILS: ADMIN.email, DEV_MAILBOX: '1', APP_URL: `http://localhost:${webPort}`,
    PORT: String(apiPort), CATALOG_IMPORT: 'off', ...env,
  });
  start('web', [path.join(ROOT, 'node_modules/vite/bin/vite.js')], { WEB_PORT: String(webPort), API_URL: `http://localhost:${apiPort}` });
  const stop = async () => {
    for (const child of procs) if (child.exitCode === null) child.kill('SIGTERM');
    await sleep(300);
    for (const child of procs) if (child.exitCode === null) child.kill('SIGKILL');
  };
  try {
    await waitFor(`http://localhost:${apiPort}/api/health`, 60_000);
    await waitFor(`http://localhost:${webPort}/`, 30_000);
  } catch (err) {
    await stop();
    throw err;
  }
  return { base: `http://localhost:${webPort}`, apiBase: `http://localhost:${apiPort}`, dir, stop };
}
