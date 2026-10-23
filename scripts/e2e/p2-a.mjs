// Parcours P2-A (PLAN.md 9.5, 8.3 P2.1, P2.2) : passeport musical et AlbumMania Rétro ; ordinateur 1440 × 900 et
// téléphone 390 × 844.
//   - Passeport : un joueur qui a fait ses premiers pas, ouvert des boosters et noté des albums → /passport (chiffres,
//     genres, raretés, favoris, répartitions en SVG, 12 derniers mois avec le choix de la série, évolution des goûts) ;
//     « Partager » : image 1080 × 1350 composée dans le navigateur ; bloc « Statistiques » du Studio (mini passeport)
//     et son lien ; passeport d'un autre joueur public ; passeport réservé aux amis → « Passeport privé ».
//   - Rétro : ses données datées de l'an dernier → /retro/<an dernier> : cinq images (boutons, flèches du clavier,
//     liste), « Partager cette image » : story 1080 × 1920 par défaut, carré 1080 × 1080 au choix ; l'année en cours
//     avant décembre : compte à rebours ; une année d'avant l'inscription : « Pas de Rétro ».
//   - Démo autonome (dist-demo/albummania-demo.html) : passeport d'un joueur fictif depuis son Studio, passeport et
//     Rétro (avant-première) d'un compte neuf.
//   Zéro erreur de console (hors images Deezer bloquées et réponses 403 / 404 attendues), pas de défilement horizontal.
//   BASE=http://localhost:5121 OUT=/tmp/am-p2-a/shots node scripts/e2e/p2-a.mjs
//   (sans BASE : démarre sa propre copie sur 3121 / 5121 avec une copie neuve de $FIXTURE dans /tmp/am-p2-a/am.db)
//   FOCUS=desktop,phone,demo : ne joue que ces parties (développement).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, fail, finish, setBase, startStack, checkNoHorizontalScroll,
  launch, routeFonts, ignoredConsole, signupViaApi, apiCall,
} from './lib.mjs';
import { parisDate, parisMidnight } from '../../shared/periods.js';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p2-a', apiPort: 3121, webPort: 5121, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const DB_FILE = process.env.DB_FILE || (stack ? path.join(stack.dir, 'am.db') : null);
const FOCUS = new Set((process.env.FOCUS || 'desktop,phone,demo').split(',').map((s) => s.trim()));
const stamp = Date.now().toString(36).slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THIS_YEAR = parisDate().y;
const LAST_YEAR = THIS_YEAR - 1;
const GENRES = ['electro', 'rock', 'pop'];
const RATINGS = [['discovery', 10], ['random-access-memories', 9], ['thriller', 8], ['abbey-road', 9], ['nevermind', 7], ['back-to-black', 9], ['21', 6]];

/** Base de la copie du site (écritures de préparation : dater des données, donner des boosters). */
function withDb(fn) {
  if (!DB_FILE) throw new Error('DB_FILE inconnu : lancer sans BASE, ou donner DB_FILE');
  const db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA busy_timeout = 5000');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Comme lib.run, mais les réponses attendues ne sont pas comptées comme erreurs de console : le 403 du passeport d'un
 * Studio réservé aux amis, le 404 du Rétro d'une année sans Rétro.
 */
async function runP(name, viewport, fn) {
  const b = await launch();
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, locale: 'fr-FR' });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  const expected = (m) => /status of (403|404)/.test(m.text()) && /\/api\/(users\/priv_[^/]+\/passport|retro\/2019)/.test(m.location()?.url || '');
  page.on('pageerror', (e) => fail(`[${name}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && !expected(m) && fail(`[${name}] console: ${m.text()}`));
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

/** Premiers pas par l'API (genres, trois artistes, quatre albums proposés), comme les fait le site. */
async function onboard(page, label) {
  const first = await apiCall(page, 'GET', `/onboarding?genres=${GENRES.join(',')}`);
  const artists = (first.body?.artists || []).slice(0, 3);
  const second = await apiCall(page, 'GET', `/onboarding?genres=${GENRES.join(',')}&artists=${artists.map(encodeURIComponent).join(',')}`);
  const picks = (second.body?.albums || [])[0]?.items?.slice(0, 4) || [];
  const res = await apiCall(page, 'POST', '/onboarding', { genres: GENRES, artists, grid9: picks, ratings: [] });
  if (res.status !== 200) fail(`[${label}] premiers pas : ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
}

/** Ouvre tous les boosters du joueur (boosters du jour, bonus, boosters spéciaux de bienvenue). */
async function openAll(page, label) {
  for (let i = 0; i < 60; i++) {
    const r = await apiCall(page, 'POST', '/packs/open', { count: 1 });
    if (r.status !== 200) break;
  }
  const inv = await apiCall(page, 'GET', '/me/boosters');
  for (const b of inv.body?.items || inv.body?.boosters || []) {
    const r = await apiCall(page, 'POST', `/me/boosters/${b.id}/open`, {});
    if (r.status !== 200 && r.status !== 400) fail(`[${label}] booster spécial ${b.id} : ${r.status}`);
  }
}

async function rateAll(page, label) {
  for (const [id, score] of RATINGS) {
    const r = await apiCall(page, 'PUT', `/ratings/album/${encodeURIComponent(id)}`, { score });
    if (r.status !== 200) fail(`[${label}] note de ${id} : ${r.status}`);
  }
}

/** Joueur prêt : premiers pas, 25 boosters bonus ouverts, 7 albums notés. */
async function player(page, username, label) {
  const user = await signupViaApi(page, `${username}@example.com`, username);
  await onboard(page, label);
  withDb((db) => db.prepare('UPDATE users SET bonus_packs = bonus_packs + 25 WHERE id = ?').run(user.id));
  await openAll(page, label);
  await rateAll(page, label);
  return user;
}

/** Date toutes les données du joueur dans l'année `year` (dans l'ordre), avec un vinyle n° 12 en juin. */
function backdate(userId, year) {
  withDb((db) => {
    const start = parisMidnight(year, 1, 3);
    const span = parisMidnight(year, 12, 20) - start;
    db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(parisMidnight(year, 1, 2), userId);
    const cards = db.prepare('SELECT rowid AS r FROM cards WHERE user_id = ? ORDER BY first_at, rowid').all(userId);
    const setCard = db.prepare('UPDATE cards SET first_at = ? WHERE rowid = ?');
    // Plus de cartes en mars et en juillet, pour un « mois le plus actif » lisible.
    cards.forEach((c, i) => {
      const x = i / Math.max(1, cards.length);
      const bent = x < 0.4 ? 0.15 + x * 0.25 : x < 0.7 ? 0.5 + (x - 0.4) * 0.3 : 0.6 + (x - 0.7) * 1.3;
      setCard.run(Math.round(start + Math.min(0.99, bent) * span), c.r);
    });
    const ratings = db.prepare('SELECT id FROM ratings WHERE user_id = ? ORDER BY id').all(userId);
    ratings.forEach((r, i) => {
      const at = Math.round(start + ((i + 1) / (ratings.length + 1)) * span);
      db.prepare('UPDATE ratings SET created_at = ?, updated_at = ?, review_at = CASE WHEN review IS NULL THEN NULL ELSE ? END WHERE id = ?').run(at, at, at, r.id);
    });
    db.prepare('UPDATE achievements SET created_at = ? WHERE user_id = ?').run(parisMidnight(year, 6, 14), userId);
    const album = db.prepare(`SELECT t.album_id AS id FROM cards c JOIN cat_tracks t ON t.id = c.track_id
      WHERE c.user_id = ? AND t.album_id IS NOT NULL GROUP BY t.album_id ORDER BY COUNT(*) DESC LIMIT 1`).get(userId);
    if (album) db.prepare('INSERT OR IGNORE INTO achievements (user_id, key, created_at, rank) VALUES (?, ?, ?, 12)').run(userId, `album:${album.id}`, parisMidnight(year, 6, 14));
    db.prepare('UPDATE pack_openings SET created_at = ? WHERE user_id = ?').run(parisMidnight(year, 3, 9), userId);
    db.prepare("DELETE FROM user_stats_cache WHERE user_id = ? AND (key = 'passport' OR key LIKE 'retro:%')").run(userId);
  });
}

const attr = async (page, sel, name) => page.locator(sel).first().getAttribute(name);

async function shareCheck(page, label, { width, height, square = false, p }) {
  await page.waitForSelector('img[data-share-image]', { timeout: 30_000 });
  const w = Number(await attr(page, 'img[data-share-image]', 'data-width'));
  const h = Number(await attr(page, 'img[data-share-image]', 'data-height'));
  if (w !== width || h !== height) fail(`[${label}] image ${w} × ${h} (attendu ${width} × ${height})`);
  await page.screenshot({ path: `${OUT}/${p}.png` });
  if (square) {
    await page.getByRole('button', { name: /Carré/ }).click();
    await page.waitForFunction(() => document.querySelector('img[data-share-image]')?.dataset.height === '1080', null, { timeout: 30_000 });
    await page.screenshot({ path: `${OUT}/${p}-square.png` });
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('img[data-share-image]', { state: 'detached' });
}

async function journey(name, viewport) {
  const p = name === 'desktop' ? 'd' : 'p';
  const label = `p2a-${name}`;
  await runP(label, viewport, async (page) => {
    // Comptes secondaires : un joueur public avec des données, un Studio réservé aux amis.
    const b = await launch();
    const side = await b.newContext();
    const sp = await side.newPage();
    const pubName = `pub_${p}${stamp}`;
    await player(sp, pubName, `${label} public`);
    await side.clearCookies();
    const privName = `priv_${p}${stamp}`;
    await signupViaApi(sp, `${privName}@example.com`, privName);
    await apiCall(sp, 'PUT', '/me/profile', { visibility: 'friends' });
    await side.close();

    // Le joueur principal.
    const me = `pp_${p}${stamp}`;
    const user = await player(page, me, label);

    // Passeport.
    await page.goto(`${BASE}/passport`);
    await page.waitForSelector('[data-passport="self"] [data-pp="totals"] .stat-grid', { timeout: 30_000 });
    await page.waitForSelector('[data-pp="distributions"] .pp-hbars__row');
    const cards = Number((await page.locator('[data-total="cards"] dd').first().innerText()).replace(/\D/g, '').slice(0, 6) || 0);
    if (!(cards > 30)) fail(`[${label}] morceaux collectionnés : ${cards}`);
    for (const block of ['favorites', 'distributions', 'timeline', 'evolution']) {
      if (!(await page.locator(`[data-pp="${block}"]`).count())) fail(`[${label}] bloc ${block} absent`);
    }
    if (!(await page.locator('[data-dist="decades"] svg path').count())) fail(`[${label}] colonnes des décennies vides`);
    if (!(await page.locator('[data-pp="timeline"] svg path').count())) fail(`[${label}] chronologie vide`);
    if (!(await page.locator('.pp-tiles .pp-album img, .pp-tiles .pp-album svg').count())) fail(`[${label}] pochettes des favoris absentes`);
    await page.screenshot({ path: `${OUT}/${p}-10-passport.png` });
    await page.screenshot({ path: `${OUT}/${p}-11-passport-full.png`, fullPage: true });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} passeport`);
    // Série des notes, infobulle au clavier.
    await page.click('[data-series="ratings"]');
    await page.locator('[data-pp="timeline"] .pp-cols__plot').focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForSelector('[data-pp="timeline"] .pp-tip');
    await page.locator('[data-pp="timeline"]').screenshot({ path: `${OUT}/${p}-12-passport-timeline-ratings.png` });
    // Partage : portrait 1080 × 1350.
    await page.click('[data-passport-share]');
    await shareCheck(page, `${label} partage du passeport`, { width: 1080, height: 1350, p: `${p}-13-passport-share` });

    // Studio : le bloc « Statistiques » montre le mini passeport et mène au passeport.
    await page.goto(`${BASE}/studio`);
    await page.waitForSelector('[data-studio-stats]', { timeout: 30_000 });
    await page.locator('[data-studio-stats]').scrollIntoViewIfNeeded();
    await page.locator('#st-block-stats').locator('xpath=ancestor::section[1]').screenshot({ path: `${OUT}/${p}-14-studio-stats.png` });
    await page.click('[data-passport-link]');
    await page.waitForSelector('[data-passport="self"]');

    // Passeport d'un autre : public, puis réservé aux amis.
    await page.goto(`${BASE}/u/${pubName}/passport`);
    await page.waitForSelector('[data-passport="other"] [data-pp="favorites"]', { timeout: 30_000 });
    const title = await page.locator('h1').first().innerText();
    if (!title.includes(pubName)) fail(`[${label}] titre du passeport d'un autre : ${title}`);
    await page.screenshot({ path: `${OUT}/${p}-15-passport-other.png` });
    await page.goto(`${BASE}/u/${privName}/passport`);
    await page.waitForSelector('[data-passport="private"]');
    await page.screenshot({ path: `${OUT}/${p}-16-passport-private.png` });

    // Rétro : l'année en cours (verrouillée avant décembre), puis l'an dernier avec des données datées.
    await page.goto(`${BASE}/retro/${THIS_YEAR}`);
    await page.waitForSelector('[data-retro="locked"], [data-retro="open"]', { timeout: 30_000 });
    await page.screenshot({ path: `${OUT}/${p}-20-retro-current.png` });
    backdate(user.id, LAST_YEAR);
    await page.goto(`${BASE}/retro/${LAST_YEAR}`);
    await page.waitForSelector('[data-retro="open"] [data-slide="intro"]', { timeout: 30_000 });
    if ((await page.locator('[data-retro-thumb]').count()) !== 5) fail(`[${label}] le Rétro n'a pas 5 images`);
    const big = Number(await attr(page, '[data-retro-cards]', 'data-retro-cards'));
    if (!(big > 30)) fail(`[${label}] Rétro : ${big} cartes`);
    await page.screenshot({ path: `${OUT}/${p}-21-retro-1.png` });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} Rétro`);
    const ids = ['artist', 'albums', 'moments', 'genres'];
    for (const [i, id] of ids.entries()) {
      if (i === 1) {
        // Une fois au clavier.
        await page.locator('.pp-retro__viewer').focus();
        await page.keyboard.press('ArrowRight');
      } else await page.click('[data-retro-next]');
      await page.waitForSelector(`[data-slide="${id}"]`);
      await sleep(300);
      await page.locator('.pp-slide').screenshot({ path: `${OUT}/${p}-2${i + 2}-retro-${id}.png` });
      if (!(await page.locator(`[data-retro-share="${id}"]:not([disabled])`).count())) fail(`[${label}] image « ${id} » sans partage`);
    }
    if (!(await page.locator('[data-moment="firstVinyl"]').count()) && !(await page.locator('[data-slide="genres"]').count())) fail(`[${label}] moments`);
    // Partage de la première image : story par défaut, carré au choix.
    await page.click('[data-retro-thumb="intro"]');
    await page.waitForSelector('[data-slide="intro"]');
    await page.click('[data-retro-share="intro"]');
    await shareCheck(page, `${label} partage du Rétro`, { width: 1080, height: 1920, square: true, p: `${p}-27-retro-share` });
    // Une année sans Rétro.
    await page.goto(`${BASE}/retro/2019`);
    await page.waitForSelector('[data-retro="missing"]');
    await page.screenshot({ path: `${OUT}/${p}-28-retro-missing.png` });
  });
}

if (FOCUS.has('desktop')) await journey('desktop', VIEWPORTS.desktop);
if (FOCUS.has('phone')) await journey('phone', VIEWPORTS.phone);

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
    const clickVisible = async (sel) => {
      await page.waitForSelector(sel, { state: 'attached', timeout: 15_000 });
      await page.evaluate((s) => [...document.querySelectorAll(s)].find((el) => el.offsetParent !== null)?.click() ?? document.querySelector(s)?.click(), sel);
    };
    try {
      await page.goto(`file://${demoFile}`);
      await page.waitForSelector('.auth__form', { timeout: 20_000 });
      await page.getByText(/Créer un compte/).first().click();
      await page.waitForSelector('#su-email');
      await page.fill('#su-email', `demo_pp_${name}@example.com`);
      await page.fill('#su-user', `demopp_${name}`);
      await page.fill('#su-pw', 'motdepasse123');
      if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', 'motdepasse123');
      for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
      await page.waitForSelector('.field__ok');
      await page.click('button[type=submit]');
      await page.click('.demo-mail .btn');
      await page.waitForSelector('.hero, [data-onboarding]', { timeout: 20_000 });
      // Trois boosters ouverts depuis le héros (animation passée), pour un passeport et un Rétro qui ont des cartes.
      for (let i = 0; i < 3; i++) {
        const open = page.locator('.hero .btn--primary.btn--xl:not([disabled])');
        if (!(await open.count())) break;
        await open.first().click();
        await page.waitForSelector('.opening');
        await page.click('.opening__pack-btn');
        await page.waitForSelector('.reveal-card', { timeout: 10_000 });
        await page.click('.opening__bar .btn');
        await page.waitForSelector('.summary', { timeout: 10_000 });
        await page.click('.summary__actions .btn--ghost');
        await page.waitForSelector('.opening', { state: 'detached', timeout: 10_000 });
      }
      // Studio d'un joueur fictif (lien d'un avatar ou d'un pseudo sur l'accueil, Découvrir ou Amis), son passeport.
      let bot = false;
      for (const where of ['a[href="/discover"]', 'a[href="/friends"]']) {
        if (await page.locator('a[href="/u/lea.beats"], a[href="/u/maxvinyl"], a[href="/u/k.dot_fan"]').count()) {
          bot = true;
          break;
        }
        await clickVisible(where);
        await sleep(1500);
      }
      if (await page.locator('a[href="/u/lea.beats"], a[href="/u/maxvinyl"], a[href="/u/k.dot_fan"]').count()) bot = true;
      if (bot) {
        await clickVisible('a[href="/u/lea.beats"], a[href="/u/maxvinyl"], a[href="/u/k.dot_fan"]');
        await page.waitForSelector('[data-studio-stats] [data-passport-link]', { timeout: 20_000 });
        await page.locator('[data-studio-stats]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${OUT}/${p}-80-demo-bot-studio-stats.png` });
        await clickVisible('[data-passport-link]');
        await page.waitForSelector('[data-passport="other"] [data-pp="timeline"]', { timeout: 20_000 });
        await page.screenshot({ path: `${OUT}/${p}-81-demo-bot-passport.png`, fullPage: true });
        if (name === 'phone') await checkNoHorizontalScroll(page, `${label} passeport du joueur fictif`);
      } else fail(`[${label}] aucun lien vers un joueur fictif trouvé`);
      // Son propre passeport (depuis son Studio), puis son Rétro en avant-première.
      await clickVisible('a[href="/studio"]');
      await page.waitForSelector('[data-passport-link]', { timeout: 20_000 });
      await clickVisible('[data-passport-link]');
      await page.waitForSelector('[data-passport="self"]', { timeout: 20_000 });
      await page.screenshot({ path: `${OUT}/${p}-82-demo-passport.png`, fullPage: true });
      await clickVisible('[data-retro-link]');
      await page.waitForSelector('[data-retro="open"] [data-slide="intro"] [data-retro-cards]', { timeout: 20_000 });
      await sleep(400);
      await page.screenshot({ path: `${OUT}/${p}-83-demo-retro.png`, fullPage: true });
      await clickVisible('[data-retro-thumb="moments"]');
      await page.waitForSelector('[data-slide="moments"] [data-moment]', { timeout: 10_000 });
      await sleep(400);
      await page.locator('.pp-slide').screenshot({ path: `${OUT}/${p}-84-demo-retro-moments.png` });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} Rétro`);
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
await finish('Parcours P2-A complet sans erreur.');
if (stack) await stack.stop();
