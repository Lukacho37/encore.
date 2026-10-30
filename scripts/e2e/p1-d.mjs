// Parcours P1-D (PLAN.md 9.4, 8.2 P1.10) : jeu de collection, ordinateur 1440 × 900 et téléphone 390 × 844.
//   - Accueil : héros Boosters et rangée Boutique / Doublons / Blind test en tête, inchangés ; « Boosters spéciaux »
//     dessous (boosters du joueur posés dans la base) ; « Voir les chances » ; ouverture d'un booster thématique avec
//     l'écran d'ouverture inchangé ; booster d'album « au choix » (recherche de l'album, puis ouverture).
//   - Niveau gagné en ouvrant les boosters de bienvenue : message « Niveau N ! » (+1 booster bonus).
//   - Guide des raretés : chaque règle publiée (ciblage, pitié douce, promos, raretés gelées, boosters spéciaux, paliers).
//   - Albums recherchés : bouton « Rechercher » de la page d'album (ajout, rechargement, retrait), promo verrouillée.
//   - Moment de complétion : l'admin prépare un album à une carte près (outil admin), l'ouvre en booster d'album et voit
//     « Complété le … · Pressage n° … », « Noter l'album », « Mettre en avant », « Partager » ; mouvement réduit sur
//     téléphone (la carte des statistiques apparaît sans animation) ; Pressage n° sur l'étagère du profil.
//   - Démo autonome (dist-demo/albummania-demo.html) : boosters spéciaux offerts, ouverture, chances.
//   Zéro erreur de console (hors images Deezer bloquées par le bac à sable), pas de défilement horizontal.
//   BASE=http://localhost:5114 DATABASE_FILE=/tmp/am-p1-d/am.db OUT=/tmp/am-p1-d/shots node scripts/e2e/p1-d.mjs
//   (sans BASE : démarre sa propre copie sur 3114 / 5114 avec une copie neuve de $FIXTURE dans /tmp/am-p1-d/am.db)
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, run, shot, fail, finish, setBase, startStack, signupViaApi, loginAdmin,
  checkNoHorizontalScroll, apiCall, launch, routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p1-d', apiPort: 3114, webPort: 5114, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);
const DB_FILE = process.env.DATABASE_FILE || '/tmp/am-p1-d/am.db';
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA busy_timeout = 5000');

// Albums de la graine : courts, pour que le booster d'album de l'admin complète l'album d'un coup.
const COMPLETE = { desktop: 'kind-of-blue', phone: 'histoire-de-melody-nelson' };
const WISH = 'discovery';
const prefix = (v) => (v === 'desktop' ? 'd' : 'm');

/** Boosters spéciaux posés dans l'inventaire du joueur (comme une quête, un palier ou l'accueil les donneraient). */
function grantBoosters(userId, list) {
  const ins = db.prepare('INSERT INTO user_boosters (user_id, kind, theme, source, created_at) VALUES (?, ?, ?, ?, ?)');
  list.forEach(([kind, theme, source], i) => ins.run(userId, kind, theme, source, Date.now() - i * 1000));
}

/** Écran d'ouverture (inchangé) : on déchire le paquet, on révèle tout, on attend le résumé. */
async function openToSummary(page) {
  await page.waitForSelector('.opening__pack-btn', { timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.click('.opening__pack-btn');
  await page.waitForSelector('.reveal-card', { timeout: 10_000 });
  await page.click('.opening__bar .btn');
  await page.waitForSelector('.summary', { timeout: 10_000 });
}

async function closeOpening(page) {
  await page.click('.summary__actions .btn--ghost');
  await page.waitForSelector('.opening', { state: 'detached', timeout: 5000 });
}

/** Ordre dans la page : `a` avant `b`. */
const before = (page, a, b) => page.evaluate(([x, y]) => {
  const ea = document.querySelector(x);
  const eb = document.querySelector(y);
  return !!ea && !!eb && !!(ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING);
}, [a, b]);

for (const [v, viewport] of Object.entries(VIEWPORTS)) {
  const p = prefix(v);

  // ---------- joueur : boosters spéciaux, niveau, guide des raretés, albums recherchés ----------
  await run(`${v}-joueur`, viewport, async (page) => {
    const username = `p1d${p}_${stamp}`;
    const user = await signupViaApi(page, `${username}@example.com`, username);
    // Parcours d'accueil (P1-E) déjà fait : l'accueil s'ouvre directement.
    db.prepare('UPDATE users SET onboarded_at = ? WHERE id = ?').run(Date.now(), user.id);
    grantBoosters(user.id, [
      ['theme', 'genre:rock', 'quest:w'],
      ['album', 'album:choice', 'onboarding'],
      ['theme', 'decade:1990', 'level:10'],
    ]);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.hero');
    await page.waitForSelector('#boosters-speciaux .gm-special__item');
    // Héros et rangée en tête, inchangés ; le panneau vient dessous.
    if (!(await before(page, '.hero', '.home-panels')) || !(await before(page, '.home-panels', '#boosters-speciaux'))) {
      fail(`[${v}] « Boosters spéciaux » doit suivre le héros et la rangée Boutique / Doublons / Blind test`);
    }
    const items = await page.locator('.gm-special__item').count();
    if (items !== 3) fail(`[${v}] 3 boosters spéciaux attendus, ${items} affichés`);
    await page.locator('#boosters-speciaux').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, `${p}-01-home-special`);
    await checkNoHorizontalScroll(page, `${v} accueil`);

    // Chances publiées (booster standard) : tableau carte par carte, pitié, ciblage.
    await page.click('#boosters-speciaux .gm-special__head .link-btn');
    await page.waitForSelector('.gm-odds-modal .gm-odds__table');
    await page.waitForTimeout(400);
    const oddsText = await page.locator('.gm-odds-modal').innerText();
    for (const word of ['Pitié douce', 'Boosters ciblés', 'Légendaire', 'Promo']) if (!oddsText.toLowerCase().includes(word.toLowerCase())) fail(`[${v}] chances : « ${word} » absent`);
    // Une ligne par rareté (7), une colonne par carte (5), sans défilement dans la fenêtre.
    const shape = await page.locator('.gm-odds-modal .gm-odds__table').evaluate((table) => ({
      rows: table.tBodies[0].rows.length, cols: table.tHead.rows[0].cells.length - 1,
      overflow: table.parentElement.scrollWidth - table.parentElement.clientWidth,
    }));
    if (shape.rows !== 7 || shape.cols !== 5 || shape.overflow > 1) fail(`[${v}] tableau des chances : ${JSON.stringify(shape)}`);
    await shot(page, `${p}-02-odds`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.gm-odds-modal', { state: 'detached' });

    // Booster thématique « Rock » : l'écran d'ouverture habituel, 5 cartes de rock.
    const rock = page.locator('.gm-special__item', { hasText: 'Rock' });
    await rock.locator('.btn--primary').click();
    await page.waitForSelector('.opening');
    await page.waitForTimeout(500);
    await shot(page, `${p}-03-special-pack`);
    await openToSummary(page);
    await page.waitForTimeout(600);
    await shot(page, `${p}-04-special-summary`);
    await closeOpening(page);
    await page.waitForFunction(() => document.querySelectorAll('.gm-special__item').length === 2, null, { timeout: 5000 });
    const genres = db.prepare(`SELECT DISTINCT t.genre FROM pack_openings po, json_each(po.cards) c JOIN cat_tracks t ON t.id = json_extract(c.value, '$.trackId')
      WHERE po.user_id = ? AND po.source = 'special'`).all(user.id).map((r) => r.genre);
    if (genres.join() !== 'rock') fail(`[${v}] booster « Rock » : genres tirés ${genres.join(', ')}`);

    // Booster d'album au choix : on cherche l'album, on le choisit, il s'ouvre.
    await page.locator('.gm-special__item', { hasText: /au choix/ }).locator('.btn--primary').click();
    await page.waitForSelector('.gm-choose input');
    await page.fill('.gm-choose input', 'Kind of Blue');
    await page.waitForSelector('.gm-choose [role=option]', { timeout: 10_000 });
    // Les suggestions restent dans la fenêtre (pas coupées par son bord).
    const inside = await page.evaluate(() => {
      const modal = document.querySelector('.gm-choose').getBoundingClientRect();
      const opt = document.querySelector('.gm-choose [role=option]').getBoundingClientRect();
      return opt.top >= modal.top && opt.bottom <= modal.bottom + 1 && opt.left >= modal.left && opt.right <= modal.right + 1;
    });
    if (!inside) fail(`[${v}] suggestions d'albums coupées par la fenêtre « Quel album ? »`);
    await page.waitForTimeout(300);
    await shot(page, `${p}-05-choose-album`);
    await page.locator('.gm-choose [role=option]', { hasText: 'Kind of Blue' }).first().click();
    await openToSummary(page);
    const albumCards = await page.locator('.summary__cell').count();
    if (albumCards !== 5) fail(`[${v}] booster d'album au choix : ${albumCards} cartes`);
    await closeOpening(page);
    await page.waitForFunction(() => document.querySelectorAll('.gm-special__item').length === 1, null, { timeout: 5000 });

    // Boosters de bienvenue : le premier niveau gagné affiche « Niveau N ! » (+1 booster bonus).
    let leveled = false;
    for (let i = 0; i < 8 && !leveled; i++) {
      const btn = page.locator('.hero__actions .btn--primary');
      if (await btn.isDisabled()) break;
      await btn.click();
      await openToSummary(page);
      await closeOpening(page);
      leveled = await page.waitForSelector('.gm-levelup', { timeout: 2500 }).then(() => true, () => false);
    }
    if (!leveled) fail(`[${v}] aucun message de niveau après les boosters de bienvenue`);
    else {
      const text = await page.locator('.gm-levelup').innerText();
      if (!/Niveau \d+/.test(text) || !/boosters? bonus/.test(text)) fail(`[${v}] message de niveau : « ${text} »`);
      await shot(page, `${p}-06-level-up`);
      await page.click('.gm-levelup__close');
    }
    await checkNoHorizontalScroll(page, `${v} accueil après ouvertures`);

    // Guide des raretés : chaque règle du jeu est publiée.
    await page.locator('.hero__help').click();
    await page.waitForSelector('.rarity-guide');
    const guide = await page.locator('.rarity-guide').innerText();
    for (const word of ['Boosters ciblés', 'Pitié douce', '1 200 royalties', 'ne change jamais', 'Boosters spéciaux', 'Paliers de niveau', 'Niveau 50']) {
      if (!guide.includes(word.replace(/ /g, ' ')) && !guide.includes(word) && !guide.replace(/[  ]/g, ' ').includes(word)) fail(`[${v}] guide : « ${word} » absent`);
    }
    await page.locator('.gm-guide__block').first().scrollIntoViewIfNeeded();
    await shot(page, `${p}-07-rarity-guide`);
    await page.keyboard.press('Escape');

    // Albums recherchés : bouton de la page d'album (monté par la page d'album, P1-B).
    await page.goto(`${BASE}/album/${WISH}`);
    await page.waitForSelector('.album-head');
    const toggle = page.locator('.album-head .gm-wish, .album-page .btn.gm-wish').first();
    if (!(await toggle.count())) {
      fail(`[${v}] WishlistToggle absent de la page d'album (slot à monter par P1-B, AlbumPage.jsx)`);
    } else {
      await toggle.click();
      await page.waitForSelector('.btn.gm-wish[aria-pressed=true]');
      await page.waitForSelector('.toast');
      await shot(page, `${p}-08-wishlist-on`);
      const wish = await apiCall(page, 'GET', '/me/wishlist');
      if (!wish.body?.items?.includes(WISH) || wish.body.max !== 12) fail(`[${v}] liste d'envies : ${JSON.stringify(wish.body).slice(0, 120)}`);
      await page.reload();
      await page.waitForSelector('.btn.gm-wish[aria-pressed=true]');
      await page.locator('.btn.gm-wish').first().click();
      await page.waitForSelector('.btn.gm-wish[aria-pressed=false]');
    }
    await checkNoHorizontalScroll(page, `${v} page d'album`);

    // Pressage réservé à l'admin : un joueur n'achète aucune carte précise.
    const promo = await apiCall(page, 'GET', `/me/press/${encodeURIComponent('promo:hey-jude')}`);
    if (promo.body?.reason !== 'admin_only' || promo.body?.cost !== null) fail(`[${v}] pressage refusé attendu : ${JSON.stringify(promo.body)}`);
  });

  // ---------- admin : album complété avec l'outil admin, moment de complétion, Pressage n° ----------
  await run(`${v}-admin`, viewport, async (page) => {
    if (v === 'phone') await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginAdmin(page);
    const albumId = COMPLETE[v];
    const almost = await apiCall(page, 'POST', '/admin/me/almost', { albumId });
    if (almost.status !== 200) throw new Error(`outil admin « presque complet » : ${almost.status}`);
    await page.goto(`${BASE}/album/${albumId}`);
    await page.waitForSelector('.album-booster__btn');
    await page.click('.album-booster__btn');
    await openToSummary(page);
    await page.waitForSelector('.summary .gm-moment', { timeout: 5000 });
    await page.waitForTimeout(v === 'phone' ? 300 : 2600);
    const moment = await page.locator('.summary .gm-moment').innerText();
    if (!/Complété le/.test(moment) || !/Pressage n°\s?\d+/.test(moment.replace(/ /g, ' '))) fail(`[${v}] moment de complétion : « ${moment} »`);
    for (const action of ['Noter l’album', 'Mettre en avant sur mon Studio', 'Partager']) {
      if (!moment.includes(action)) fail(`[${v}] action « ${action} » absente du moment de complétion`);
    }
    if (v === 'phone') {
      const anim = await page.locator('.summary .gm-moment').evaluate((el) => getComputedStyle(el).animationName);
      if (anim !== 'none') fail(`[${v}] mouvement réduit : la carte des statistiques est animée (${anim})`);
    }
    await page.locator('.summary .achievement').first().scrollIntoViewIfNeeded();
    await shot(page, `${p}-10-completion-moment`);
    await page.locator('.gm-moment__actions .btn', { hasText: 'Noter' }).click();
    await page.waitForSelector('.gm-moment__rate');
    await page.locator('.gm-moment__rate').scrollIntoViewIfNeeded();
    await shot(page, `${p}-11-completion-rate`);
    await checkNoHorizontalScroll(page, `${v} résumé`);
    await closeOpening(page);

    const completion = await apiCall(page, 'GET', `/albums/${albumId}/completion`);
    if (!(completion.body?.mine?.rank >= 1) || !(completion.body?.completedBy >= 1)) fail(`[${v}] complétion : ${JSON.stringify(completion.body).slice(0, 160)}`);
    // Ligne de complétion de la page d'album (CompletionLine, montée par P1-B) quand elle est là.
    if (await page.locator('.gm-completion').count()) {
      await page.waitForSelector('.gm-completion__mine');
      await page.locator('.gm-completion').scrollIntoViewIfNeeded();
      await page.waitForSelector('.gm-levelup', { state: 'detached', timeout: 8000 }).catch(() => {});
      await shot(page, `${p}-12-album-completion-line`);
    }

    // Étagère du profil : « Pressage n° » sous le vinyle.
    await page.goto(`${BASE}/u/luka`);
    await page.waitForSelector('.vinyl-item');
    const pressing = page.locator('.gm-pressing--shelf').first();
    if (!(await pressing.count())) fail(`[${v}] « Pressage n° » absent de l'étagère de vinyles`);
    else {
      await pressing.scrollIntoViewIfNeeded();
      await shot(page, `${p}-13-shelf-pressing`);
    }
    await checkNoHorizontalScroll(page, `${v} profil`);
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
    page.on('pageerror', (e) => fail(`[${label}] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${label}] console: ${m.text()}`));
    try {
      await page.goto(`file://${demoFile}`);
      await page.waitForSelector('.auth__form', { timeout: 20_000 });
      await page.getByText(/Créer un compte/).first().click();
      await page.waitForSelector('#su-email');
      await page.fill('#su-email', `demo_d_${name}@example.com`);
      await page.fill('#su-user', `demod_${name}`);
      await page.fill('#su-pw', 'motdepasse123');
      if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', 'motdepasse123');
      for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
      await page.waitForSelector('.field__ok');
      await page.click('button[type=submit]');
      await page.click('.demo-mail .btn');
      // Parcours d'accueil (P1-E) : un nouveau compte arrive sur /welcome (une fois par session) ; on revient à l'accueil.
      await page.waitForSelector('.hero, [data-onboarding]');
      if (!(await page.locator('.hero').count())) {
        await page.goto(`file://${demoFile}`);
        await page.waitForSelector('.hero');
      }
      if (!(await page.locator('#boosters-speciaux').count())) {
        await page.locator('a[href="/"]:visible').first().click().catch(() => {});
      }
      await page.waitForSelector('#boosters-speciaux .gm-special__item', { timeout: 10_000 });
      const n = await page.locator('.gm-special__item').count();
      if (n !== 3) fail(`[${label}] 3 boosters spéciaux offerts attendus, ${n}`);
      await page.locator('#boosters-speciaux').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/${prefix(name)}-20-demo-special.png` });
      await page.locator('.gm-special__item', { hasText: 'Rap' }).locator('.btn--primary').click();
      await openToSummary(page);
      await page.screenshot({ path: `${OUT}/${prefix(name)}-21-demo-special-summary.png` });
      await closeOpening(page);
      await page.waitForFunction(() => document.querySelectorAll('.gm-special__item').length === 2, null, { timeout: 5000 });
      // Chances du booster « Années 70 ».
      await page.locator('.gm-special__item', { hasText: '70' }).locator('.link-btn').click();
      await page.waitForSelector('.gm-odds-modal .gm-odds__table');
      await page.keyboard.press('Escape');
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} accueil`);
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

db.close();
if (stack) await stack.stop();
await finish('Parcours P1-D sans erreur.');
