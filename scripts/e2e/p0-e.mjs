// Parcours P0-E (PLAN.md 9.3, critère P0.2) : recherche globale avec suggestions — ordinateur 1440 × 900 et téléphone
// 390 × 844, zéro erreur de console (hors images Deezer bloquées par le bac à sable).
//   - Ordinateur : champ de la barre du haut (« / » le sélectionne), suggestions groupées avec pochettes dès 2 lettres,
//     motif combobox (aria-expanded, aria-activedescendant), album choisi au clavier (↓ Entrée), morceau choisi au clic,
//     faute de frappe (« dicovery » → « Vouliez-vous dire Discovery ? », ligne ≈), Échap ferme puis efface, Entrée
//     sans choix → page /search (onglets et compteurs, onglet Albums paginé), recherches récentes, combobox de la
//     Collection (Entrée filtre la grille), membre trouvé et ajouté depuis la page Amis ; temps serveur mesuré.
//   - Téléphone : icône de recherche, feuille plein écran (onglets par type, lignes de 62 px), choix d'un morceau,
//     bouton Retour qui ferme la feuille, Collection (ligne de progression, feuilles Statistiques et Filtres), aucun
//     défilement horizontal.
//   - Démo autonome (dist-demo/albummania-demo.html), si elle est construite : « stromea » → Stromae, même classement.
//   BASE=http://localhost:5105 OUT=/tmp/am-p0-e/shots node scripts/e2e/p0-e.mjs
//   (sans BASE : démarre sa propre copie sur 3105 / 5105 avec une copie neuve de $FIXTURE dans /tmp/am-p0-e/am.db)
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, PASSWORD, run, shot, signupViaApi, fail, finish, apiCall,
  setBase, startStack, checkNoHorizontalScroll, launch, routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p0-e', apiPort: 3105, webPort: 5105, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);
const player = { email: `p0e_${stamp}@example.com`, username: `p0e_${stamp}` };
const friend = { email: `zephyr_${stamp}@example.com`, username: `zephyr_${stamp}` };
const expect = (cond, message) => !cond && fail(message);

const panelRows = (page) => page.locator('.gsearch__panel [role="option"]:not(.gs-skel)');
const sheetRows = (page) => page.locator('.search-sheet [role="option"]:not(.gs-skel)');

/** Attend que la liste affiche des suggestions pour `text` (le titre surligné contient ce qui a été tapé). */
async function waitSuggestions(page, scope = '.gsearch__panel') {
  await page.waitForSelector(`${scope} [role="option"]:not(.gs-skel)`, { timeout: 10_000 });
  await page.waitForFunction((sel) => !document.querySelector(`${sel} .gs-listbox.is-stale`), scope);
}

/** Temps serveur d'une requête de suggestions (en-tête Server-Timing, pire de 3 requêtes distinctes). */
async function serverTime(page, q) {
  return page.evaluate(async (query) => {
    let worst = 0;
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(query)}&n=${Date.now()}-${i}`, { headers: { 'X-AlbumMania': '1' } });
      await res.json();
      const dur = Number(/dur=([\d.]+)/.exec(res.headers.get('server-timing') || '')?.[1]);
      worst = Math.max(worst, Number.isFinite(dur) ? dur : Infinity);
    }
    return worst;
  }, q);
}

// ---------- ordinateur ----------

await run('desktop', VIEWPORTS.desktop, async (page) => {
  await signupViaApi(page, friend.email, friend.username);
  await apiCall(page, 'POST', '/auth/logout', {});
  await signupViaApi(page, player.email, player.username);
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.hero');
  const input = page.locator('#gs-top-input');
  expect(await input.isVisible(), '[desktop] champ de recherche absent de la barre du haut');
  expect((await input.getAttribute('placeholder'))?.startsWith('Album, morceau'), '[desktop] texte d’exemple du champ');
  await shot(page, 'd-00-topbar');

  // « / » place le curseur dans le champ.
  await page.locator('body').click({ position: { x: 5, y: 600 } });
  await page.keyboard.press('/');
  expect(await page.evaluate(() => document.activeElement?.id) === 'gs-top-input', '[desktop] « / » ne sélectionne pas la recherche');

  // Suggestions dès 2 lettres, groupées, avec vignettes.
  await page.keyboard.type('daft');
  await waitSuggestions(page);
  expect(await input.getAttribute('aria-expanded') === 'true', '[desktop] aria-expanded');
  const listId = await input.getAttribute('aria-controls');
  expect(await page.locator(`#${listId}[role="listbox"]`).count() === 1, '[desktop] liste (role=listbox) introuvable');
  const heads = await page.locator('.gsearch__panel .gsearch__group-head .eyebrow').allInnerTexts();
  expect(heads.some((h) => /albums/i.test(h)) && heads.some((h) => /morceaux/i.test(h)) && heads.some((h) => /artistes/i.test(h)),
    `[desktop] groupes attendus (albums, morceaux, artistes) : ${heads.join(' | ')}`);
  expect(await page.locator('.gsearch__panel [role="option"] .gsearch__thumb').count() >= 5, '[desktop] vignettes (pochettes) absentes');
  expect(await page.locator('.gsearch__panel mark.hl').count() > 0, '[desktop] partie tapée non surlignée');
  await page.waitForTimeout(300);
  await shot(page, 'd-01-suggestions-daft');

  // Clavier : ↓ active la première ligne (un album), Entrée l'ouvre.
  await page.keyboard.press('ArrowDown');
  const active = await input.getAttribute('aria-activedescendant');
  expect(!!active && await page.locator(`#${active}.is-active`).count() === 1, '[desktop] aria-activedescendant / ligne active');
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/album\//, { timeout: 10_000 });
  await page.waitForSelector('.album-head, .page-head, h1');
  expect(await input.inputValue() === '', '[desktop] champ non vidé après un choix');

  // Clic sur un morceau.
  await input.click();
  await page.keyboard.type('get lucky');
  await waitSuggestions(page);
  await page.locator('.gsearch__panel [role="option"]', { hasText: 'Get Lucky' }).first().click();
  await page.waitForURL(/\/track\//, { timeout: 10_000 });
  expect(page.url().includes('random-access-memories'), `[desktop] mauvais morceau ouvert : ${page.url()}`);

  // Faute de frappe : suggestion « Vouliez-vous dire » et ligne approchée.
  await input.click();
  await page.keyboard.type('dicovery');
  await waitSuggestions(page);
  const fuzzy = await page.locator('.gsearch__fuzzy').innerText().catch(() => '');
  expect(/Discovery/.test(fuzzy), `[desktop] pas de « Vouliez-vous dire Discovery » (${fuzzy})`);
  expect(await panelRows(page).first().locator('.gs-approx').count() === 1, '[desktop] ligne approchée sans ≈');
  await shot(page, 'd-02-typo');

  // Échap ferme, un second Échap efface.
  await page.keyboard.press('Escape');
  expect(await input.getAttribute('aria-expanded') === 'false', '[desktop] Échap ne ferme pas la liste');
  await page.keyboard.press('Escape');
  expect(await input.inputValue() === '', '[desktop] second Échap n’efface pas');

  // Recherches récentes au focus d'un champ vide.
  await page.keyboard.press('ArrowDown');
  await page.waitForSelector('.gsearch__panel [role="option"]');
  const recent = await page.locator('.gsearch__panel .gsearch__group-head .eyebrow').first().innerText();
  expect(/récentes/i.test(recent), `[desktop] recherches récentes absentes (${recent})`);
  await shot(page, 'd-03-recent');

  // Entrée sans choix : page de résultats, onglets avec compteurs.
  await input.fill('night');
  await waitSuggestions(page);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/search\?q=night/, { timeout: 10_000 });
  await page.waitForSelector('.gs-page__tabs .gs-page__n');
  await page.waitForSelector('.gs-page .album-grid .album-tile');
  const tabs = await page.locator('.gs-page__tabs .tabs__tab').allInnerTexts();
  expect(tabs.length === 6 && /99\+/.test(tabs[1]), `[desktop] onglets et compteurs : ${tabs.join(' | ')}`);
  await shot(page, 'd-04-search-page', { fullPage: true });
  await page.locator('.gs-page__tabs .tabs__tab').nth(1).click();
  await page.waitForURL(/type=album/);
  await page.waitForFunction(() => document.querySelectorAll('.gs-page .album-grid .album-tile').length >= 24);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => document.querySelectorAll('.gs-page .album-grid .album-tile').length > 24, null, { timeout: 10_000 });
  await shot(page, 'd-05-search-albums');
  await checkNoHorizontalScroll(page, 'desktop /search');

  // Temps serveur des suggestions sur le grand catalogue (en-tête Server-Timing) : moins de 50 ms.
  const times = [];
  for (const q of ['stromea', 'daft pnuk', 'dicovery', 'kendrik', 'nevermnd', 'racine carree', 'abbey road beatles', 'get lucky', 'da', 'night', 'song night', 'zzzzqx']) {
    times.push([q, await serverTime(page, q)]);
  }
  console.log('Temps serveur des suggestions (pire de 3) :', times.map(([q, ms]) => `${q} ${ms.toFixed(1)} ms`).join(' · '));
  expect(times.every(([, ms]) => ms < 50), `[desktop] suggestions trop lentes : ${times.map(([q, ms]) => `${q} ${ms.toFixed(1)}`).join(', ')}`);

  // Collection : suggestions albums + morceaux, Entrée filtre la grille.
  await page.goto(`${BASE}/collection`);
  await page.waitForSelector('.album-grid .album-tile');
  await page.click('#collection-album-search-input');
  await page.keyboard.type('random');
  await waitSuggestions(page);
  const kinds = await page.locator('.gsearch__panel .gsearch__group-head .eyebrow').allInnerTexts();
  expect(kinds.every((k) => /albums|morceaux/i.test(k)), `[desktop] Collection : types proposés ${kinds.join(' | ')}`);
  await shot(page, 'd-06-collection-combobox');
  await page.keyboard.press('Enter');
  await page.waitForURL(/collection\?q=random/);
  await page.waitForFunction(() => [...document.querySelectorAll('.album-grid .album-tile__title')].some((el) => el.textContent.includes('Random Access Memories')));
  expect(await page.locator('#collection-album-search-input').getAttribute('aria-expanded') === 'false', '[desktop] liste restée ouverte après Entrée');
  await shot(page, 'd-07-collection-filtered');

  // Amis : membre trouvé par une partie de son pseudo, ajouté depuis sa ligne.
  await page.goto(`${BASE}/friends`);
  await page.click('#friend-search-input');
  await page.keyboard.type(friend.username.slice(0, 8));
  await waitSuggestions(page);
  await page.locator('.gsearch__panel [role="option"]', { hasText: friend.username }).first().click();
  await page.waitForSelector('.gs-friend-pick');
  await page.click('.gs-friend-pick .btn--primary');
  await page.waitForSelector('.form-ok');
  await shot(page, 'd-08-friends');
});

// ---------- téléphone ----------

await run('phone', VIEWPORTS.phone, async (page) => {
  await page.request.post(`${BASE}/api/auth/login`, { headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json' }, data: { identifier: player.username, password: PASSWORD } });
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.hero');
  expect(!(await page.locator('#gs-top-input').isVisible()), '[phone] champ en ligne visible sur téléphone');
  await page.click('.search-trigger');
  await page.waitForSelector('.search-sheet');
  await page.waitForTimeout(250);
  await shot(page, 'm-00-sheet');
  await page.keyboard.type('daft');
  await waitSuggestions(page, '.search-sheet');
  const rowHeight = await sheetRows(page).first().evaluate((el) => el.getBoundingClientRect().height);
  expect(rowHeight >= 62, `[phone] lignes de ${rowHeight} px (62 attendus)`);
  const fontSize = await page.$eval('.search-sheet .gsearch__input', (el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize >= 16, `[phone] champ en ${fontSize} px (zoom iOS)`);
  await shot(page, 'm-01-sheet-daft');
  await page.locator('.search-sheet__tabs .chip', { hasText: 'Morceaux' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.search-sheet [role="option"]').length >= 5);
  const subs = await sheetRows(page).locator('.gsearch__sub').allInnerTexts();
  expect(subs.length > 0 && subs.every((s) => s.startsWith('Morceau')), '[phone] onglet Morceaux : autres types listés');
  await shot(page, 'm-02-sheet-tracks');
  await sheetRows(page).first().click();
  await page.waitForURL(/\/track\//);
  expect(await page.locator('.search-sheet').count() === 0, '[phone] feuille restée ouverte après un choix');

  // Le bouton Retour ferme la feuille sans quitter la page.
  const before = page.url();
  await page.click('.search-trigger');
  await page.waitForSelector('.search-sheet');
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.search-sheet'));
  expect(page.url() === before, `[phone] Retour a quitté la page (${page.url()})`);

  // Collection : une ligne de progression, feuilles Statistiques et Filtres.
  await page.goto(`${BASE}/collection`);
  await page.waitForSelector('.album-grid .album-tile');
  expect(await page.locator('.gs-coll-line').isVisible(), '[phone] ligne de progression absente');
  expect(!(await page.locator('.coll-summary').first().isVisible()), '[phone] compteurs encore affichés en grand');
  await checkNoHorizontalScroll(page, 'phone /collection');
  await shot(page, 'm-03-collection');
  await page.click('.gs-coll-line .gs-link');
  await page.waitForSelector('.modal.gs-sheet .coll-summary');
  await page.waitForTimeout(300);
  await shot(page, 'm-04-stats');
  await page.keyboard.press('Escape');
  await page.click('.gs-filter-btn');
  await page.waitForSelector('.modal.gs-sheet .gs-filters');
  await page.locator('.modal.gs-sheet .chip-btn', { hasText: 'Rock' }).click();
  await page.waitForURL(/genre=rock/);
  await page.waitForTimeout(300);
  await shot(page, 'm-05-filters');
  await page.click('.modal.gs-sheet .gs-sheet__actions .btn--primary');
  expect(await page.locator('.gs-filter-btn .count-badge').innerText() === '1', '[phone] nombre de filtres actifs');

  for (const url of ['/', '/search?q=night', '/friends']) {
    await page.goto(`${BASE}${url}`);
    await page.waitForTimeout(800);
    await checkNoHorizontalScroll(page, `phone ${url}`);
  }
  await shot(page, 'm-06-friends');
  await page.goto(`${BASE}/search?q=random`);
  await page.waitForSelector('.gs-page .gs-row');
  await shot(page, 'm-07-search-page', { fullPage: true });
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
      await page.fill('#su-email', `demo_e_${name}@example.com`);
      await page.fill('#su-user', `demoe_${name}`);
      await page.fill('#su-pw', PASSWORD);
      if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', PASSWORD);
      for (const box of await page.locator('.auth__form input[type=checkbox]').all()) if (!(await box.isChecked())) await box.check();
      await page.click('button[type=submit]');
      await page.click('.demo-mail .btn');
      await page.waitForSelector('.hero');
      if (name === 'desktop') {
        await page.click('#gs-top-input');
        await page.keyboard.type('stromea');
        await waitSuggestions(page);
        const top = await panelRows(page).first().innerText();
        expect(/Stromae/.test(top), `[${label}] « stromea » ne propose pas Stromae (${top})`);
      } else {
        await page.click('.search-trigger');
        await page.keyboard.type('get lucky');
        await waitSuggestions(page, '.search-sheet');
        const top = await sheetRows(page).first().innerText();
        expect(/Get Lucky/.test(top), `[${label}] « get lucky » ne propose pas le morceau (${top})`);
      }
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${name === 'desktop' ? 'd' : 'm'}-80-demo-search.png` });
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

await finish('Parcours P0-E complet sans erreur.');
if (stack) await stack.stop();
