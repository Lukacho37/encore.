// Parcours P1-F (PLAN.md 9.4, 8.2 P1.5 à P1.7) : quêtes, badges, battles et classements, ordinateur 1440 × 900 et
// téléphone 390 × 844.
//   - Des joueurs votent d'abord (par l'API) pour que les classements existent.
//   - Accueil : le héros Boosters et la rangée Boutique / Doublons / Blind test restent en tête ; la rangée des quêtes
//     vient dessous (Premiers pas, quêtes du jour) ; la battle compacte est dans la colonne.
//   - /battles : 5 duels votés à la souris (écarts d'Elo affichés, duel suivant), « Je ne connais pas », compteur du jour.
//   - /quests : la quête « Vote dans 5 battles » des Premiers pas se réclame (royalties créditées), relance du jour.
//   - Médaille « Juge » au 50e vote : message « Nouvelle médaille ! », puis /badges (médailles, détail des paliers).
//   - /rankings : hub des catégories (podium), classement global (rangs, Elo, « provisoire »), « Voter dans cette catégorie ».
//   - « Autour de l'album » et l'étagère de trophées quand leurs pages hôtes (P1-B) les montent.
//   - Démo autonome (dist-demo/albummania-demo.html) : quêtes en cours d'un nouveau compte, duel, classements des bots.
//   Zéro erreur de console (hors images Deezer bloquées par le bac à sable), pas de défilement horizontal.
//   BASE=http://localhost:5116 DATABASE_FILE=/tmp/am-p1-f/am.db OUT=/tmp/am-p1-f/shots node scripts/e2e/p1-f.mjs
//   (sans BASE : démarre sa propre copie sur 3116 / 5116 avec une copie neuve de $FIXTURE dans /tmp/am-p1-f/am.db)
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, run, fail, finish, setBase, startStack, signup, signupViaApi,
  checkNoHorizontalScroll, apiCall, launch, routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p1-f', apiPort: 3116, webPort: 5116, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);
const prefix = (v) => (v === 'desktop' ? 'd' : 'm');
const enc = encodeURIComponent;

/** Ordre dans la page : `a` avant `b`. */
async function before(page, a, b) {
  return page.evaluate(([x, y]) => {
    const ea = document.querySelector(x);
    const eb = document.querySelector(y);
    return !!ea && !!eb && !!(ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, [a, b]);
}

/** Vote `n` duels par l'API avec la session de la page (n'importe quelle catégorie). */
async function voteViaApi(page, n, label) {
  let done = 0;
  for (let guard = 0; done < n && guard < n * 3; guard++) {
    const next = await apiCall(page, 'GET', '/battles/next?n=5');
    if (next.status !== 200) break;
    for (const d of next.body.duels) {
      if (done >= n) break;
      const r = await apiCall(page, 'POST', '/battles/vote', { token: d.token, winner: Math.random() < 0.5 ? 'a' : 'b' });
      if (r.status === 200) done += 1;
      else if (r.status !== 409) fail(`[${label}] vote ${r.status} ${JSON.stringify(r.body)}`);
    }
  }
  return done;
}

// ---------- des votes d'abord : les classements existent ----------

{
  const b = await launch();
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  for (let i = 0; i < 6; i++) {
    await signupViaApi(page, `voter${i}_${stamp}@example.com`, `voter${i}_${stamp}`);
    const n = await voteViaApi(page, 30, 'votants');
    if (n < 20) fail(`[votants] seulement ${n} votes pour voter${i}`);
  }
  await ctx.close();
}

// ---------- parcours ----------

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  const p = prefix(name);
  await run(`p1-f-${name}`, viewport, async (page) => {
    const label = `p1-f-${name}`;
    const email = `pf_${p}_${stamp}@example.com`;
    const username = `pf_${p}_${stamp}`;
    if (name === 'desktop') await signup(page, email, username);
    else {
      await signupViaApi(page, email, username);
      await page.goto(`${BASE}/`);
      await page.waitForSelector('.hero');
    }

    // Accueil : héros et rangée en tête, quêtes dessous, battle dans la colonne (ou dans le fil sur téléphone).
    await page.waitForSelector('[data-home="quests"] .quest-chip', { timeout: 15_000 });
    if (!(await before(page, '.hero', '.home-panels')) || !(await before(page, '.home-panels', '[data-home="quests"]'))) {
      fail(`[${label}] la rangée des quêtes doit venir sous le héros et la rangée Boutique / Doublons / Blind test`);
    }
    const chips = await page.locator('[data-home="quests"] .quest-chip').count();
    if (chips < 1 || chips > 3) fail(`[${label}] ${chips} pastilles de quêtes (1 à 3 attendues)`);
    if (!(await page.locator('[data-home="quests"] [data-chip="first"]').count())) fail(`[${label}] pas de pastille « Premiers pas » pour un nouveau compte`);
    await page.locator('[data-home="quests"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${p}-01-home-quests.png` });
    if (name === 'desktop') {
      await page.waitForSelector('[data-home="battle"] .duel__side', { timeout: 15_000 });
      await page.locator('[data-home="battle"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${p}-02-home-battle.png` });
      // Un vote depuis la colonne : l'écart s'affiche, puis le duel suivant.
      const first = await page.locator('[data-home="battle"] .duel__side').first().getAttribute('aria-label');
      await page.locator('[data-home="battle"] .duel__side').first().click();
      await page.waitForSelector('[data-home="battle"] .duel__delta');
      await page.waitForFunction((label0) => {
        const side = document.querySelector('[data-home="battle"] .duel__side');
        return side && side.getAttribute('aria-label') !== label0 && !document.querySelector('[data-home="battle"] .duel__delta');
      }, first, { timeout: 10_000 });
    }
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} accueil`);

    // Battles : 5 votes à la souris (4 sur téléphone après le vote de l'accueil… ici 5 partout), puis « Je ne connais pas ».
    await page.goto(`${BASE}/battles`);
    await page.waitForSelector('.duel .duel__side:not([disabled])', { timeout: 15_000 });
    await page.screenshot({ path: `${OUT}/${p}-10-battle.png` });
    const target = name === 'desktop' ? 5 : 5;
    for (let i = 0; i < target; i++) {
      const token = await page.locator('.duel__arena').first().evaluate((el) => el.closest('.duel')?.dataset.duel + '|' + el.querySelector('.duel__side')?.getAttribute('aria-label'));
      await page.locator('.duel .duel__side:not([disabled])').nth(i % 2).click();
      await page.waitForSelector('.duel .duel__delta', { timeout: 10_000 });
      if (i === 0) await page.screenshot({ path: `${OUT}/${p}-11-battle-voted.png` });
      await page.waitForFunction((tok) => {
        const el = document.querySelector('.duel__arena');
        const now = `${el?.closest('.duel')?.dataset.duel}|${el?.querySelector('.duel__side')?.getAttribute('aria-label')}`;
        return now !== tok && !document.querySelector('.duel .duel__delta') && !!document.querySelector('.duel .duel__side:not([disabled])');
      }, token, { timeout: 10_000 });
    }
    const today = Number(await page.locator('.duel__head [data-today]').getAttribute('data-today'));
    const expected = name === 'desktop' ? 6 : 5;
    if (today !== expected) fail(`[${label}] compteur du jour ${today} (attendu ${expected})`);
    await page.getByRole('button', { name: /Je ne connais pas/ }).click();
    await page.waitForSelector('.duel .duel__side:not([disabled])');
    // Pas de lecteur intégré dans une battle (PLAN.md 7.1) ; « Écouter » mène à la page de l'album.
    if (await page.locator('.duel iframe, .trk-listen').count()) fail(`[${label}] lecteur intégré dans un duel`);
    const listen = await page.locator('.duel .duel__listen').first().getAttribute('href');
    if (!/^\/album\//.test(listen || '')) fail(`[${label}] « Écouter » doit mener à la page de l'album (${listen})`);
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} battles`);

    // Quêtes : « Vote dans 5 battles » (Premiers pas) est faite → Réclamer, royalties créditées.
    const royalties0 = (await apiCall(page, 'GET', '/state')).body.user.royalties;
    await page.goto(`${BASE}/quests`);
    await page.waitForSelector('[data-period="daily"] .quest');
    const row = page.locator('[data-period="first"] [data-quest="f-battles"]');
    await row.locator('button', { hasText: 'Réclamer' }).click();
    await row.locator('.chip', { hasText: 'Réclamée' }).waitFor();
    await page.waitForSelector('.toast');
    const royalties1 = (await apiCall(page, 'GET', '/state')).body.user.royalties;
    if (royalties1 - royalties0 !== 40) fail(`[${label}] récompense de la quête : ${royalties1 - royalties0} royalties (40 attendues)`);
    // Relance gratuite d'une quête du jour pas encore faite.
    const reroll = page.locator('[data-period="daily"] .quest__reroll').first();
    if (await reroll.count()) {
      await reroll.click();
      await page.waitForSelector('[data-period="daily"] .quest__reroll', { state: 'detached' });
    } else fail(`[${label}] pas de bouton de relance sur les quêtes du jour`);
    await page.screenshot({ path: `${OUT}/${p}-20-quests.png`, fullPage: true });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} quêtes`);

    // Médaille « Juge » au 50e vote : 43 par l'API, le dernier à la souris → message « Nouvelle médaille ! ».
    const counted = (await apiCall(page, 'GET', '/battles/next?n=1')).body.today?.votes ?? 0;
    await voteViaApi(page, 49 - counted, label);
    await page.goto(`${BASE}/battles`);
    await page.waitForSelector('.duel .duel__side:not([disabled])', { timeout: 15_000 });
    await page.locator('.duel .duel__side:not([disabled])').first().click();
    await page.waitForSelector('[data-toast="badge"]', { timeout: 10_000 });
    await page.screenshot({ path: `${OUT}/${p}-12-badge-toast.png` });

    // Badges : médailles gagnées et à gagner, détail des paliers.
    await page.goto(`${BASE}/badges`);
    await page.waitForSelector('.pl-badges .medal');
    const medals = await page.locator('.pl-badges .medal').count();
    if (medals < 20) fail(`[${label}] ${medals} médailles affichées (≈ 24 attendues)`);
    const judge = page.locator('.pl-badges [data-medal="judge"]');
    if (!(await judge.evaluate((el) => !el.classList.contains('medal--locked')))) fail(`[${label}] la médaille Juge devrait être gagnée`);
    await page.screenshot({ path: `${OUT}/${p}-30-badges.png`, fullPage: name === 'desktop' });
    await judge.click();
    await page.waitForSelector('.modal .pl-tiers .pl-tier.is-earned');
    await page.screenshot({ path: `${OUT}/${p}-31-badge-detail.png` });
    await page.keyboard.press('Escape');
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} badges`);

    // Classements : hub, classement global, voter dans la catégorie.
    await page.goto(`${BASE}/rankings`);
    await page.waitForSelector('.pl-cat[data-category="global:album"]', { timeout: 15_000 });
    await page.screenshot({ path: `${OUT}/${p}-40-rankings.png`, fullPage: name === 'desktop' });
    await page.locator('.pl-cat[data-category="global:album"]').click();
    await page.waitForSelector('.pl-rank');
    const ranks = await page.locator('.pl-rank').count();
    if (ranks < 10) fail(`[${label}] classement global : ${ranks} lignes`);
    if (!(await page.locator('.pl-rank .chip', { hasText: 'provisoire' }).count())) fail(`[${label}] aucun badge « provisoire » sous 50 votes`);
    const firstRank = await page.locator('.pl-rank').first().getAttribute('data-rank');
    if (firstRank !== '1') fail(`[${label}] premier rang ${firstRank}`);
    await page.screenshot({ path: `${OUT}/${p}-41-ranking.png` });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} classement`);
    const album = await page.locator('.pl-rank').first().getAttribute('data-id');
    await page.getByRole('link', { name: /Voter dans cette catégorie/ }).click();
    await page.waitForURL(/\/battles\?category=global/);
    await page.waitForSelector('.duel .duel__side:not([disabled])');

    // Page d'album : « Autour de l'album » quand P1-B monte l'emplacement.
    await page.goto(`${BASE}/album/${enc(album)}`);
    await page.waitForSelector('.album-head, .alb-head, h1', { timeout: 15_000 });
    await page.waitForTimeout(800);
    if (await page.locator('[data-album="rankings"]').count()) {
      await page.locator('[data-album="rankings"] .pl-around__row').first().waitFor();
      await page.locator('[data-album="rankings"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${p}-50-album-around.png` });
    } else {
      console.log(`[${label}] « Autour de l'album » pas encore monté par la page d'album (P1-B) : vérification sautée.`);
    }
    // Studio : étagère de trophées quand P1-B la monte.
    await page.goto(`${BASE}/studio`);
    await page.waitForTimeout(1200);
    if (await page.locator('[data-studio="trophies"]').count()) {
      await page.locator('[data-studio="trophies"] .medal').first().waitFor();
      await page.locator('[data-studio="trophies"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${p}-51-studio-trophies.png` });
    } else {
      console.log(`[${label}] étagère de trophées pas encore montée par le Studio (P1-B) : vérification sautée.`);
    }
  });
}

// ---------- démo autonome ----------

const demoFile = path.join(ROOT, 'dist-demo/albummania-demo.html');
if (fs.existsSync(demoFile)) {
  const b = await launch();
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const ctx = await b.newContext({ viewport, locale: 'fr-FR' });
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
      await page.fill('#su-email', `demo_f_${name}@example.com`);
      await page.fill('#su-user', `demof_${name}`);
      await page.fill('#su-pw', 'motdepasse123');
      if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', 'motdepasse123');
      for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
      await page.waitForSelector('.field__ok');
      await page.click('button[type=submit]');
      await page.click('.demo-mail .btn');
      await page.waitForSelector('.hero, [data-onboarding]', { timeout: 20_000 });
      if (!(await page.locator('.hero').count())) {
        await page.goto(`file://${demoFile}`);
        await page.waitForSelector('.hero');
      }
      // Quêtes en cours dès l'arrivée (Premiers pas, quêtes du jour).
      await page.waitForSelector('[data-home="quests"] .quest-chip', { timeout: 15_000 });
      await page.locator('[data-home="quests"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${p}-80-demo-home.png` });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} accueil`);
      await page.locator('[data-home="quests"] .quest-chip').first().click();
      await page.waitForSelector('[data-page="quests"] [data-period="daily"] .quest');
      const progressing = await page.locator('[data-page="quests"] .quest .quest__count').count();
      if (!progressing) fail(`[${label}] aucune quête en cours dans la démo`);
      await page.screenshot({ path: `${OUT}/${p}-81-demo-quests.png`, fullPage: true });
      // Duel, puis classements des joueurs fictifs.
      await page.locator('a[href="/badges"]').first().click();
      await page.waitForSelector('.pl-badges .medal');
      await page.screenshot({ path: `${OUT}/${p}-82-demo-badges.png` });
      // Retour à l'accueil (MemoryRouter : par le logo), puis battles par la colonne ou Découvrir.
      await page.locator('.topbar a').first().click();
      await page.waitForSelector('.hero');
      await page.evaluate(() => document.querySelector('a[href="/battles"]')?.click());
      await page.waitForSelector('.duel .duel__side:not([disabled])', { timeout: 15_000 });
      await page.locator('.duel .duel__side:not([disabled])').first().click();
      await page.waitForSelector('.duel .duel__delta');
      await page.screenshot({ path: `${OUT}/${p}-83-demo-battle.png` });
      await page.locator('a[href="/rankings"]').first().click();
      await page.waitForSelector('.pl-cat', { timeout: 15_000 });
      await page.screenshot({ path: `${OUT}/${p}-84-demo-rankings.png` });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} classements`);
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

await finish('Parcours P1-F complet sans erreur.');
if (stack) await stack.stop();
