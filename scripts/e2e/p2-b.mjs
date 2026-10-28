// Parcours P2-B (PLAN.md 9.5, 8.3 P2.3 et P2.4) : coffrets et événements, ordinateur 1440 × 900 et téléphone 390 × 844.
//   - Le serveur est lancé avec EVENT_PREVIEW=french-touch (aperçu : l'événement « en cours », jamais en production).
//   - Accueil : le héros Boosters et la rangée Boutique / Doublons / Blind test restent en tête, inchangés ; la pastille
//     de l'événement vient SOUS la rangée (jamais dans le héros) et mène à la page de l'événement.
//   - /events/french-touch : 3 quêtes, bonus, coffret de l'événement, catégorie de battles ; 15 votes électro (API) font
//     la quête des battles, qui se réclame dans la page ; /events : calendrier (en cours, à venir).
//   - Collection › Coffrets : cartes des coffrets (vraies pochettes quand elles existent), filtres par sorte, page d'un
//     coffret (progression, récompenses, albums, amis). Genres / Décennies : lien vers le passeport quand il existe.
//   - Compte admin : albums complétés par l'outil admin, la page du coffret donne le badge (3/4) puis le cadre (complet),
//     le cadre est dans les cosmétiques du Studio.
//   - Démo autonome (dist-demo/albummania-demo.html) : un événement en cours et des coffrets pour un nouveau compte.
//   Zéro erreur de console (hors images Deezer bloquées par le bac à sable), pas de défilement horizontal sur téléphone.
//   BASE=http://localhost:5122 OUT=/tmp/am-p2-b/shots node scripts/e2e/p2-b.mjs (le serveur visé doit avoir EVENT_PREVIEW)
//   (sans BASE : démarre sa propre copie sur 3122 / 5122 avec une copie neuve de $FIXTURE dans /tmp/am-p2-b/am.db)
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, run, fail, finish, setBase, startStack, signup, signupViaApi, loginAdmin,
  checkNoHorizontalScroll, apiCall, launch, routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p2-b', apiPort: 3122, webPort: 5122, freshDb: true, env: { EVENT_PREVIEW: 'french-touch' } });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);
const prefix = (v) => (v === 'desktop' ? 'd' : 'm');

/** Ordre dans la page : `a` avant `b`. */
async function before(page, a, b) {
  return page.evaluate(([x, y]) => {
    const ea = document.querySelector(x);
    const eb = document.querySelector(y);
    return !!ea && !!eb && !!(ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, [a, b]);
}

/** Vote `n` duels électro (catégorie de l'événement) par l'API avec la session de la page. */
async function voteElectro(page, n, label) {
  let done = 0;
  for (let guard = 0; done < n && guard < n * 3; guard++) {
    const next = await apiCall(page, 'GET', `/battles/next?category=${encodeURIComponent('genre:electro')}&n=5`);
    if (next.status !== 200) {
      fail(`[${label}] battles/next ${next.status} ${JSON.stringify(next.body)}`);
      break;
    }
    for (const d of next.body.duels) {
      if (done >= n) break;
      const r = await apiCall(page, 'POST', '/battles/vote', { token: d.token, winner: 'a' });
      if (r.status === 200) done += 1;
      else if (r.status !== 409) fail(`[${label}] vote ${r.status} ${JSON.stringify(r.body)}`);
    }
  }
  return done;
}

/** Accueil d'un compte neuf (P1 : passage unique par /welcome, on revient à l'accueil). */
async function home(page) {
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.hero, [data-onboarding]');
  await page.waitForTimeout(300);
  if (!(await page.locator('.hero').count())) await page.goto(`${BASE}/`);
  await page.waitForSelector('.hero');
}

// ---------- parcours d'un joueur ----------

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  const p = prefix(name);
  await run(`p2-b-${name}`, viewport, async (page) => {
    const label = `p2-b-${name}`;
    const email = `pb_${p}_${stamp}@example.com`;
    const username = `pb_${p}_${stamp}`;
    if (name === 'desktop') await signup(page, email, username);
    else await signupViaApi(page, email, username);
    await home(page);

    // Accueil : héros et rangée en tête, pastille de l'événement dessous (jamais dans le héros).
    await page.waitForSelector('[data-home="events"] [data-chip="event"]', { timeout: 15_000 });
    if (await page.locator('.hero [data-chip], .hero [data-home="events"]').count()) fail(`[${label}] pastille d'événement dans le héros`);
    if (!(await before(page, '.hero', '.home-panels'))) fail(`[${label}] la rangée Boutique / Doublons / Blind test n'est plus sous le héros`);
    if (!(await before(page, '.home-panels', '[data-home="events"]'))) fail(`[${label}] la rangée de l'événement n'est pas sous la rangée`);
    const chip = page.locator('[data-chip="event"]').first();
    const chipText = await chip.innerText();
    if (!/French Touch/.test(chipText)) fail(`[${label}] pastille d'événement sans titre : ${chipText}`);
    if (!/0\/3/.test(chipText)) fail(`[${label}] pastille sans progression des quêtes : ${chipText}`);
    await page.screenshot({ path: `${OUT}/${p}-10-home-fold.png` });
    await page.locator('[data-home="events"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${p}-11-home-event-chip.png` });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} accueil`);

    // Page de l'événement.
    await chip.click();
    await page.waitForSelector('[data-page="event"] [data-period="event"] .quest[data-quest]');
    const quests = await page.locator('[data-page="event"] .quest[data-quest]').count();
    if (quests !== 3) fail(`[${label}] ${quests} quêtes d'événement au lieu de 3`);
    if (!(await page.locator('[data-bonus="event"]').count())) fail(`[${label}] pas de ligne de bonus`);
    if (!(await page.locator('[data-page="event"] [data-set="ev-french-touch"]').count())) fail(`[${label}] pas de coffret d'événement`);
    if (!(await page.locator('[data-page="event"] a[href*="/battles?category=genre"]').count())) fail(`[${label}] pas de lien vers les battles`);
    await page.screenshot({ path: `${OUT}/${p}-20-event.png`, fullPage: true });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} événement`);

    // 15 votes électro : la quête des battles se réclame dans la page.
    const votes = await voteElectro(page, 15, label);
    if (votes < 15) fail(`[${label}] seulement ${votes} votes électro`);
    await page.reload();
    const claim = page.locator('[data-quest="ft-battles"] .btn--primary');
    await claim.waitFor({ timeout: 15_000 });
    await claim.click();
    await page.waitForSelector('[data-quest="ft-battles"].quest--claimed, [data-quest="ft-battles"] .chip--gold');
    await page.waitForSelector('.toast');
    await page.screenshot({ path: `${OUT}/${p}-21-event-claimed.png` });

    // Page Quêtes : panneau « Quêtes de l'événement » (ses 3 quêtes, lien vers sa page).
    await page.goto(`${BASE}/quests`);
    const evPanel = page.locator('[data-period="event"][data-event="french-touch"]');
    await evPanel.locator('.quest[data-quest]').first().waitFor({ timeout: 15_000 });
    if ((await evPanel.locator('.quest[data-quest]').count()) !== 3) fail(`[${label}] page Quêtes : le panneau de l'événement n'a pas 3 quêtes`);
    if (!(await evPanel.locator('[data-quest="ft-battles"].quest--claimed').count())) fail(`[${label}] page Quêtes : la quête des battles n'est pas réclamée`);
    if (!(await evPanel.locator('a[href="/events/french-touch"]').count())) fail(`[${label}] page Quêtes : pas de lien vers l'événement`);
    await evPanel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${p}-23-quests-event.png` });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} quêtes`);
    await page.goto(`${BASE}/events/french-touch`);
    await page.waitForSelector('[data-page="event"] .set-ev-hero, [data-page="event"] .quest[data-quest]');

    // Calendrier.
    await page.locator('.back-link').first().click();
    await page.waitForSelector('[data-page="events"] .set-ev-hero[data-event="french-touch"]');
    if ((await page.locator('[data-page="events"] .set-ev-row').count()) < 4) fail(`[${label}] calendrier : trop peu d'événements à venir`);
    await page.screenshot({ path: `${OUT}/${p}-22-calendar.png`, fullPage: true });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} calendrier`);

    // Collection › Coffrets.
    await page.goto(`${BASE}/collection`);
    await page.locator('.coll-tabs a[href="/collection/sets"]').click();
    await page.waitForSelector('[data-tab="sets"] .set-card[data-set]');
    const cards = await page.locator('[data-tab="sets"] .set-card[data-set]').count();
    if (cards < 6) fail(`[${label}] seulement ${cards} coffrets`);
    await page.screenshot({ path: `${OUT}/${p}-30-sets.png`, fullPage: name === 'desktop' });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} coffrets`);
    await page.locator('[data-tab="sets"] [data-kind="event"]').click();
    await page.waitForFunction(() => {
      const list = [...document.querySelectorAll('[data-tab="sets"] .set-card[data-set]')];
      return list.length > 0 && list.every((el) => el.dataset.set.startsWith('ev-'));
    });
    await page.locator('[data-tab="sets"] [data-kind="all"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-tab="sets"] .set-card[data-set^="g-"]').length > 0);

    // Page d'un coffret.
    await page.locator('[data-tab="sets"] .set-card[data-set="ed-classiques"]').click();
    await page.waitForSelector('[data-page="set"] .set-head h1');
    await page.waitForSelector('[data-page="set"] .set-reward[data-reward="badge"]');
    await page.waitForSelector('[data-page="set"] .set-reward[data-reward="frame"]');
    const tiles = await page.locator('[data-page="set"] .album-grid .album-tile').count();
    if (tiles !== 10) fail(`[${label}] coffret : ${tiles} albums au lieu de 10`);
    await page.screenshot({ path: `${OUT}/${p}-31-set.png`, fullPage: true });
    if (name === 'phone') await checkNoHorizontalScroll(page, `${label} coffret`);

    // Un album du coffret : la vignette mène à sa page.
    await page.locator('[data-page="set"] .album-grid .album-tile').first().click();
    await page.waitForURL('**/album/**');

    // Genres : l'onglet reste ; lien vers le passeport quand sa page existe.
    await page.goto(`${BASE}/collection/genres`);
    // Les lignes vides du chargement (.coll-skel-row) ne comptent pas : on attend les vraies.
    await page.waitForSelector('.rows .row:not(.coll-skel-row)');
    const passport = fs.existsSync(path.join(ROOT, 'client/src/pages/Passport.jsx'));
    if (passport && !(await page.locator('[data-passport-link="genre"] a[href="/passport#pp-dist"]').count())) fail(`[${label}] pas de lien vers le passeport`);
  });
}

// ---------- récompenses d'un coffret (compte admin, outil « compléter un album ») ----------

await run('p2-b-rewards', VIEWPORTS.desktop, async (page) => {
  const label = 'p2-b-rewards';
  await loginAdmin(page);
  const set = await apiCall(page, 'GET', '/sets/ed-classiques');
  if (set.status !== 200) throw new Error(`/sets/ed-classiques ${set.status}`);
  const ids = set.body.albums.map((a) => a.id);
  for (const id of ids.slice(0, set.body.set.rewards.badgeAt)) {
    const r = await apiCall(page, 'POST', '/admin/me/complete', { albumId: id });
    if (r.status !== 200) fail(`[${label}] complete ${id} : ${r.status}`);
  }
  await page.goto(`${BASE}/sets/ed-classiques`);
  await page.waitForSelector('.set-reward--earned[data-reward="badge"]');
  await page.waitForSelector('.toast');
  if (await page.locator('.set-reward--earned[data-reward="frame"]').count()) fail(`[${label}] cadre donné avant le complet`);
  await page.screenshot({ path: `${OUT}/d-40-set-badge.png`, fullPage: true });
  for (const id of ids.slice(set.body.set.rewards.badgeAt)) await apiCall(page, 'POST', '/admin/me/complete', { albumId: id });
  await page.reload();
  await page.waitForSelector('.set-reward--earned[data-reward="frame"]');
  await page.screenshot({ path: `${OUT}/d-41-set-frame.png`, fullPage: true });
  const cos = await apiCall(page, 'GET', '/me/cosmetics');
  if (!cos.body?.unlocked?.some((c) => c.id === 'frame:set-ed-classiques')) fail(`[${label}] cadre du coffret absent des cosmétiques`);
  const notes = await apiCall(page, 'GET', '/notifications');
  if (!JSON.stringify(notes.body).includes('set_reward')) fail(`[${label}] pas de notification de coffret`);
  // La liste des coffrets montre le coffret complet en tête.
  await page.goto(`${BASE}/collection/sets`);
  await page.waitForSelector('[data-tab="sets"] .set-card--done[data-set="ed-classiques"]');
  // Le badge du coffret est une médaille de la page Badges (famille « set »), avec le nom du coffret.
  await page.goto(`${BASE}/badges`);
  const medal = page.locator('.pl-badges [data-medal="set"][data-variant="ed-classiques"]');
  await medal.waitFor({ timeout: 15_000 });
  if (await medal.evaluate((el) => el.classList.contains('medal--locked'))) fail(`[${label}] médaille du coffret verrouillée`);
  const medalText = await medal.innerText();
  if (!/Les classiques du bac/.test(medalText)) fail(`[${label}] médaille du coffret sans son nom : ${medalText}`);
  await medal.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/d-42-set-medal.png` });
  await medal.click();
  await page.waitForSelector('.pl-medal-detail');
  await page.screenshot({ path: `${OUT}/d-43-set-medal-detail.png` });
});

// ---------- accueil en décembre : la pastille du Rétro (P2-A) à côté de celle de l'événement ----------

await run('p2-b-retro', VIEWPORTS.phone, async (page) => {
  const label = 'p2-b-retro';
  await signupViaApi(page, `pb_r_${stamp}@example.com`, `pb_r_${stamp}`);
  // Horloge du navigateur au 5 décembre (la pastille du Rétro se décide côté site, comme sa page).
  await page.clock.install({ time: new Date('2026-12-05T10:00:00+01:00') });
  await home(page);
  const retroChip = fs.existsSync(path.join(ROOT, 'client/src/components/passport/RetroChip.jsx'));
  if (retroChip) {
    await page.waitForSelector('[data-home="events"] [data-chip="retro"]', { timeout: 15_000 });
    if (!(await before(page, '.home-panels', '[data-home="events"] [data-chip="retro"]'))) fail(`[${label}] pastille du Rétro au-dessus de la rangée`);
    await page.locator('[data-home="events"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/m-12-home-retro-chip.png` });
    await checkNoHorizontalScroll(page, `${label} accueil`);
  }
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
    const p = prefix(name);
    page.on('pageerror', (e) => fail(`[${label}] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${label}] console: ${m.text()}`));
    try {
      await page.goto(`file://${demoFile}`);
      await page.waitForSelector('.auth__form', { timeout: 20_000 });
      await page.getByText(/Créer un compte/).first().click();
      await page.waitForSelector('#su-email');
      await page.fill('#su-email', `demo_b_${name}@example.com`);
      await page.fill('#su-user', `demob_${name}`);
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
      // Un booster de bienvenue ouvert (écran d'ouverture inchangé) : les coffrets ont déjà des cartes.
      await page.click('.hero__actions .btn--primary');
      await page.waitForSelector('.opening__pack-btn', { timeout: 10_000 });
      await page.waitForTimeout(300);
      await page.click('.opening__pack-btn');
      await page.waitForSelector('.reveal-card', { timeout: 10_000 });
      await page.click('.opening__bar .btn');
      await page.waitForSelector('.summary', { timeout: 10_000 });
      await page.click('.summary__actions .btn--ghost');
      await page.waitForSelector('.opening', { state: 'detached', timeout: 5000 });
      // Un événement en cours dès l'arrivée, sous la rangée.
      await page.waitForSelector('[data-home="events"] [data-chip="event"]', { timeout: 15_000 });
      await page.locator('[data-home="events"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${p}-80-demo-home.png` });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} accueil`);
      await page.locator('[data-chip="event"]').first().click();
      await page.waitForSelector('[data-page="event"] .quest[data-quest]');
      const progressing = await page.locator('[data-page="event"] .quest[data-quest] .quest__count').allInnerTexts();
      if (!progressing.some((x) => !/^0\//.test(x))) fail(`[${label}] aucune quête d'événement entamée dans la démo`);
      await page.screenshot({ path: `${OUT}/${p}-81-demo-event.png`, fullPage: true });
      // Coffrets : par la page de l'événement, puis la collection.
      await page.locator('[data-page="event"] .set-card[data-set]').first().click();
      await page.waitForSelector('[data-page="set"] .album-grid .album-tile');
      await page.screenshot({ path: `${OUT}/${p}-82-demo-set.png`, fullPage: true });
      await page.locator('.back-link').first().click();
      await page.waitForSelector('[data-tab="sets"] .set-card[data-set]');
      const demoSets = await page.locator('[data-tab="sets"] .set-card[data-set]').count();
      if (demoSets < 4) fail(`[${label}] seulement ${demoSets} coffrets dans la démo`);
      const startedN = Number((await page.locator('[data-tab="sets"] [data-kind="started"] .coll-chip__n').innerText()).replace(/\D/g, ''));
      if (!startedN) fail(`[${label}] aucun coffret commencé après un booster`);
      await page.screenshot({ path: `${OUT}/${p}-83-demo-sets.png`, fullPage: name === 'desktop' });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} coffrets`);
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

await finish('Parcours P2-B complet sans erreur.');
if (stack) await stack.stop();
