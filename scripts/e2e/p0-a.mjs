// Parcours P0-A (PLAN.md 9.3) : état partiel et gros collectionneur, ordinateur 1440 × 900 et téléphone 390 × 844.
//   - Nouveau joueur : ouvrir un booster ne recharge pas l'état complet (aucun GET /api/state après l'action), la réponse
//     pèse moins de 10 Ko, le héros affiche un booster de moins, une demande d'ami reçue apparaît avec l'action suivante.
//   - Gros collectionneur (base peuplée PERF_DB : 60 000 cartes, 3 000 vinyles) : booster < 10 Ko, profil servi vite,
//     vinylthèque affichée ; poids de l'état complet relevé (il n'est plus envoyé qu'au chargement).
//   Zéro erreur de console (hors images Deezer bloquées par le bac à sable), pas de défilement horizontal sur téléphone.
//   PERF_DB=<copie de old.db> FIXTURE=<fixture20k.db> OUT=/tmp/am-p0-a/shots node scripts/e2e/p0-a.mjs
//   (sans BASE : démarre sa propre copie sur 3101 / 5101 ; la base est recopiée à chaque lancement dans /tmp/am-p0-a/am.db,
//   PERF_DB et FIXTURE ne sont jamais modifiées. Avec BASE : seul le parcours du nouveau joueur, sauf HEAVY_USER=pseudo.)
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ROOT, BASE as INITIAL_BASE, VIEWPORTS, PASSWORD, run, shot, signup, login, fail, finish, setBase, startStack,
  checkNoHorizontalScroll, signupViaApi, apiCall,
} from './lib.mjs';
import { hashPassword } from '../../server/security.js';

const DIR = '/tmp/am-p0-a';
const SOURCE = process.env.PERF_DB || process.env.FIXTURE;
let heavyUser = process.env.HEAVY_USER || null;
let stack = null;

if (!process.env.BASE) {
  if (!SOURCE) throw new Error('PERF_DB ou FIXTURE requis pour démarrer la copie du site (ou BASE pour viser un site déjà lancé).');
  fs.mkdirSync(DIR, { recursive: true });
  const file = `${DIR}/am.db`;
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
  fs.copyFileSync(SOURCE, file);
  if (process.env.PERF_DB) {
    // Le plus gros collectionneur de la base peuplée devient connectable (mot de passe connu, CGU acceptées).
    const db = new DatabaseSync(file);
    const whale = db.prepare('SELECT id, username FROM users ORDER BY unique_cards DESC, id LIMIT 1').get();
    const { config } = await import('../../server/config.js');
    db.prepare(`UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), bonus_packs = 30,
      terms_accepted_at = ?, terms_version = ?, onboarded_at = COALESCE(onboarded_at, created_at) WHERE id = ?`)
      .run(await hashPassword(PASSWORD), Date.now(), Date.now(), config.termsVersion, whale.id);
    db.close();
    heavyUser = whale.username;
  }
  stack = await startStack({ id: 'p0-a', apiPort: 3101, webPort: 5101 });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);
const player = { email: `p0a_${stamp}@example.com`, username: `p0a_${stamp}` };
const KB = 1024;
const report = [];

/** Écoute les appels à l'API d'une page : GET /api/state comptés, réponses gardées par chemin. */
function watchApi(page) {
  const seen = { state: 0, responses: [] };
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/')) return;
    if (url.pathname === '/api/state' && res.request().method() === 'GET') seen.state += 1;
    seen.responses.push({ path: url.pathname, method: res.request().method(), status: res.status(), res });
  });
  return seen;
}

const heroCount = async (page) => Number((await page.textContent('.hero__title')).match(/\d+/)?.[0] ?? NaN);

/**
 * Ouvre un booster depuis le héros et va jusqu'au résumé ; renvoie la réponse de POST /api/packs/open (taille, état).
 * Le bouton « tout révéler » de la barre passe l'animation (elle reste celle de PackOpening, inchangée).
 */
async function openBooster(page, label, file) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/packs/open') && r.request().method() === 'POST', { timeout: 20_000 }),
    (async () => {
      await page.click('.hero__actions .btn--primary');
      await page.waitForSelector('.opening');
      await page.click('.opening__pack-btn');
    })(),
  ]);
  const body = await res.body();
  const json = JSON.parse(body.toString('utf8'));
  if (res.status() !== 200) fail(`[${label}] POST /api/packs/open : ${res.status()}`);
  if (body.length >= 10 * KB) fail(`[${label}] réponse du booster : ${body.length} octets (≥ 10 Ko)`);
  if (json.state?.partial !== true) fail(`[${label}] la réponse du booster n'est pas un état partiel`);
  await page.waitForSelector('.reveal-card', { timeout: 10_000 });
  await page.waitForTimeout(500);
  if (file) await shot(page, `${file}-reveal`);
  await page.click('.opening__bar .btn');
  await page.waitForSelector('.summary', { timeout: 10_000 });
  await page.waitForTimeout(900);
  if (file) await shot(page, `${file}-summary`);
  await page.click('.summary__actions .btn--ghost');
  await page.waitForSelector('.hero');
  return { bytes: body.length, json };
}

async function newPlayerFlow(page, label, prefix, { create }) {
  const api = watchApi(page);
  if (create) await signup(page, player.email, player.username);
  else await login(page, player.username);
  await page.waitForTimeout(600);
  const loads = api.state;
  const before = await heroCount(page);
  await shot(page, `${prefix}-10-home`);
  const { bytes } = await openBooster(page, label, `${prefix}-11-pack`);
  await page.waitForTimeout(300);
  const after = await heroCount(page);
  if (after !== before - 1) fail(`[${label}] héros : ${before} puis ${after} boosters (un de moins attendu)`);
  if (api.state !== loads) fail(`[${label}] ${api.state - loads} GET /api/state après l'ouverture (l'état partiel aurait dû suffire)`);
  report.push(`${label} : booster ${bytes} o, héros ${before} → ${after}`);

  // Une demande d'ami reçue arrive avec la réponse de l'action suivante (pastilles de l'état partiel), sans recharger.
  if (create) {
    const ctx = await page.context().browser().newContext();
    const other = await ctx.newPage();
    const name = `p0b_${stamp}`;
    await signupViaApi(other, `${name}@example.com`, name);
    const r = await apiCall(other, 'POST', '/friends/request', { username: player.username });
    if (r.status !== 200) fail(`[${label}] demande d'ami : ${r.status} ${JSON.stringify(r.body)}`);
    await ctx.close();
    const badge = '.count-badge, .dot-badge, .tabbar__count';
    const visibleBadge = async () => page.locator(badge).evaluateAll((els) => els.some((e) => e.offsetParent !== null));
    if (await visibleBadge()) fail(`[${label}] pastille d'ami déjà visible avant l'action`);
    await openBooster(page, label, null);
    await page.waitForTimeout(300);
    if (!(await visibleBadge())) fail(`[${label}] pastille de la demande d'ami absente après l'action suivante`);
    if (api.state !== loads) fail(`[${label}] GET /api/state après la seconde action`);
    await shot(page, `${prefix}-12-friend-badge`);
  }
  // Navigation dans le site après les actions : la collection s'affiche sans recharger l'état.
  await page.locator('a[href="/collection"]:visible').first().click();
  await page.waitForSelector('.album-grid');
  await page.waitForTimeout(400);
  await shot(page, `${prefix}-13-collection`);
  if (label.startsWith('phone')) await checkNoHorizontalScroll(page, `${label} /collection`);
  if (api.state !== loads) fail(`[${label}] GET /api/state en naviguant`);
  // Profil public du gros collectionneur vu par ce joueur (23 s avant la refonte, PLAN.md 7.3).
  if (heavyUser) await visitProfile(page, label, heavyUser, `${prefix}-14-heavy-profile`, { minVinyls: 100 });
  const errors = api.responses.filter((r) => r.status >= 500);
  if (errors.length) fail(`[${label}] réponses 5xx : ${errors.map((r) => `${r.method} ${r.path} ${r.status}`).join(', ')}`);
}

/**
 * Profil public de <username> : GET /api/users/<username> mesuré seul d'abord (calcul à froid, avant que le cache de
 * 30 s ne le garde ; une page rechargée enverrait en même temps l'état complet, ce qui fausserait la mesure), puis la
 * page /u/<username> affichée (pas de `role`, vinylthèque).
 */
async function visitProfile(page, label, username, file, { minVinyls = 0 } = {}) {
  const wanted = `/users/${encodeURIComponent(username)}`;
  const started = Date.now();
  const r = await apiCall(page, 'GET', wanted);
  const ms = Date.now() - started;
  const profile = r.body || {};
  if (r.status !== 200) fail(`[${label}] GET /api${wanted} : ${r.status}`);
  if (profile.role !== undefined) fail(`[${label}] le profil de ${username} expose encore role`);
  if ((profile.vinyls?.length ?? 0) < minVinyls) fail(`[${label}] vinylthèque de ${username} : ${profile.vinyls?.length} vinyles`);
  if (ms > 300) fail(`[${label}] profil de ${username} en ${ms} ms`);
  await page.goto(`${BASE}/u/${encodeURIComponent(username)}`);
  await page.waitForSelector('.profile-head', { timeout: 30_000 });
  await page.waitForTimeout(800);
  await shot(page, file);
  if (label.startsWith('phone')) await checkNoHorizontalScroll(page, `${label} /u/${username}`);
  report.push(`${label} : profil de ${username} ${JSON.stringify(profile).length} o en ${ms} ms (${profile.vinyls?.length ?? 0} vinyles)`);
}

async function heavyFlow(page, label, prefix) {
  const api = watchApi(page);
  const started = Date.now();
  await login(page, heavyUser);
  const loadMs = Date.now() - started;
  await page.waitForTimeout(500);
  // État complet : renvoyé par la connexion (puis seulement par GET /api/state au chargement d'une page).
  const stateRes = api.responses.find((r) => r.path === '/api/auth/login' && r.status === 200);
  const stateBytes = stateRes ? (await stateRes.res.body().catch(() => Buffer.alloc(0))).length : 0;
  await shot(page, `${prefix}-20-heavy-home`);
  const loads = api.state;
  const t0 = Date.now();
  const { bytes } = await openBooster(page, label, `${prefix}-21-heavy-pack`);
  const packMs = Date.now() - t0;
  if (api.state !== loads) fail(`[${label}] GET /api/state après l'ouverture du gros collectionneur`);
  report.push(`${label} : connexion ${loadMs} ms (état complet ${(stateBytes / KB / KB).toFixed(1)} Mo, seulement au chargement),`
    + ` booster ${bytes} o (animation comprise ${packMs} ms)`);

  // Son Studio (construit depuis l'état local, sans autre requête) : vinylthèque de 3 000 vinyles.
  const link = page.locator('a[href="/studio"]:visible, a[href="/profile"]:visible').first();
  const inApp = (await link.count()) > 0;
  if (inApp) await link.click();
  else await page.goto(`${BASE}/studio`);
  await page.waitForSelector('.profile-head', { timeout: 20_000 });
  await page.waitForTimeout(800);
  if (inApp && api.state !== loads) fail(`[${label}] GET /api/state en ouvrant le Studio`);
  await shot(page, `${prefix}-22-heavy-studio`);
  const shelf = page.locator('.pf-shelf-foot').first();
  if (await shelf.count()) await shelf.scrollIntoViewIfNeeded();
  await shot(page, `${prefix}-23-heavy-studio-shelf`);
  if (label.startsWith('phone')) await checkNoHorizontalScroll(page, `${label} /studio`);
  // Profil d'un joueur ordinaire vu par le gros collectionneur.
  const typical = await apiCall(page, 'GET', '/friends');
  const someone = typical.body?.friends?.[0]?.user?.username;
  if (someone) await visitProfile(page, label, someone, `${prefix}-24-friend-profile`);
  const errors = api.responses.filter((r) => r.status >= 500);
  if (errors.length) fail(`[${label}] réponses 5xx : ${errors.map((r) => `${r.method} ${r.path} ${r.status}`).join(', ')}`);
}

await run('desktop', VIEWPORTS.desktop, (page) => newPlayerFlow(page, 'desktop', 'd', { create: true }));
await run('phone', VIEWPORTS.phone, (page) => newPlayerFlow(page, 'phone', 'm', { create: false }));
if (heavyUser) {
  await run('desktop-heavy', VIEWPORTS.desktop, (page) => heavyFlow(page, 'desktop-heavy', 'd'));
  await run('phone-heavy', VIEWPORTS.phone, (page) => heavyFlow(page, 'phone-heavy', 'm'));
} else {
  console.log('Pas de gros collectionneur (PERF_DB ou HEAVY_USER) : parcours lourd sauté.');
}

// Démo autonome (faux serveur du navigateur, client/src/demo/mockServer.js) : une sauvegarde d'avant P0 est complétée
// (préférences, CGU, accueil), les actions renvoient un état partiel que le site fusionne (héros à jour sans recharger).
const demoFile = path.join(ROOT, 'dist-demo/albummania-demo.html');
if (fs.existsSync(demoFile)) {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    await run(`demo-${name}`, viewport, async (page, ctx) => {
      const now = Date.now();
      const save = {
        nextId: 2, cards: {}, achievements: {}, friendships: [], tokens: [], games: {}, ratings: [], session: 1,
        users: [{ id: 1, email: 'ancien@demo.albummania', username: 'ancien_joueur', password: 'x', verified: now - 86_400_000,
          role: 'player', lang: 'fr', avatar: 'initials', avatarColor: '#ff4f7e', royalties: 1000, xp: 0, packs: 0, packsAt: now,
          bonusPacks: 4, showcase: [], createdAt: now - 86_400_000, openings: 0 }],
      };
      // Sauvegarde posée une seule fois par contexte (les rechargements gardent l'état de la démo).
      await ctx.addInitScript((data) => {
        if (!localStorage.getItem('albummania.demo.v1')) localStorage.setItem('albummania.demo.v1', data);
      }, JSON.stringify(save));
      await page.goto(`file://${demoFile}`);
      await page.waitForSelector('.hero', { timeout: 20_000 });
      await page.waitForTimeout(500);
      const before = await heroCount(page);
      await page.click('.hero__actions .btn--primary');
      await page.click('.opening__pack-btn');
      await page.waitForSelector('.reveal-card', { timeout: 10_000 });
      await page.click('.opening__bar .btn');
      await page.waitForSelector('.summary', { timeout: 10_000 });
      await page.waitForTimeout(700);
      await shot(page, `${name === 'desktop' ? 'd' : 'm'}-30-demo-summary`);
      await page.click('.summary__actions .btn--ghost');
      await page.waitForSelector('.hero');
      const after = await heroCount(page);
      if (after !== before - 1) fail(`[demo-${name}] héros : ${before} puis ${after}`);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('albummania.demo.v1')));
      const u = stored.users.find((x) => x.id === 1);
      if (u.termsVersion == null || !u.prefs || u.onboardedAt == null) fail(`[demo-${name}] sauvegarde d'avant P0 non complétée`);
      if (Object.keys(stored.cards['1'] || {}).length === 0) fail(`[demo-${name}] cartes du booster absentes de la sauvegarde`);
      await page.locator('a[href="/collection"]:visible').first().click();
      await page.waitForSelector('.album-grid');
      await page.waitForTimeout(300);
      await shot(page, `${name === 'desktop' ? 'd' : 'm'}-31-demo-collection`);
      if (name === 'phone') await checkNoHorizontalScroll(page, `demo-${name} /collection`);
      report.push(`démo ${name} : héros ${before} → ${after}, sauvegarde complétée`);
      // Inscription par le formulaire (démo neuve) : le faux serveur exige la case CGU / 15 ans, ajoutée par P0-D.
      await page.evaluate(() => localStorage.setItem('albummania.demo.v1', 'null'));
      await page.goto(`file://${demoFile}`);
      await page.waitForSelector('.auth__form', { timeout: 20_000 });
      await page.getByText(/Créer un compte/).first().click();
      await page.waitForSelector('#su-email');
      if (!(await page.locator('.auth__form input[type=checkbox]').count())) {
        report.push(`démo ${name} : inscription sautée (case CGU / 15 ans pas encore dans le formulaire, P0-D)`);
        return;
      }
      await page.fill('#su-email', `demo_${name}@example.com`);
      await page.fill('#su-user', `demo_${name}`);
      await page.fill('#su-pw', PASSWORD);
      if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', PASSWORD);
      for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
      await page.waitForSelector('.field__ok');
      await page.click('button[type=submit]');
      await page.click('.demo-mail .btn');
      await page.waitForSelector('.hero');
      report.push(`démo ${name} : inscription avec la case CGU / 15 ans`);
    });
  }
} else {
  console.log('Démo absente (npm run build:demo) : partie démo sautée.');
}

for (const line of report) console.log(`  ${line}`);
await finish('Parcours P0-A sans erreur.');
if (stack) await stack.stop();
