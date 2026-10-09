// Parcours P0-C (PLAN.md 9.3) : page morceau et notes v2, ordinateur 1440 × 900 et téléphone 390 × 844.
//   - On ouvre un morceau depuis le fil des amis (accueil), la tracklist d'un album et la fiche d'une carte
//     (« Voir la page du morceau ») ; un identifiant inconnu mène à « Cette face n'existe pas ».
//   - Page morceau : en-tête, ma carte, écoute, ma note, « Vos amis » avant « Communauté AlbumMania », « Voir plus »
//     (page suivante par curseur), ancres #review-<id>, autres morceaux de l'album avec le morceau en cours.
//   - Note en demi-étoiles : libellé « 4,5 étoiles », critique enregistrée.
//   - Lecteur Deezer : panneau « Le lecteur Deezer dépose des cookies », chargé seulement au clic (ou « Toujours charger »).
//   - Démo autonome (dist-demo/albummania-demo.html) : la page morceau s'ouvre depuis la tracklist d'un album.
//   Zéro erreur de console (hors images et lecteur Deezer bloqués par le bac à sable), pas de défilement horizontal.
//   BASE=http://localhost:5103 OUT=/tmp/am-p0-c/shots node scripts/e2e/p0-c.mjs
//   (sans BASE : démarre sa propre copie sur 3103 / 5103 avec une copie neuve de $FIXTURE dans /tmp/am-p0-c/am.db)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, run, shot, signup, login, fail, finish, setBase, startStack,
  checkNoHorizontalScroll, apiCall, launch, routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p0-c', apiPort: 3103, webPort: 5103, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);
const player = { email: `p0c_${stamp}@example.com`, username: `p0c_${stamp}` };
const TRACK = 'discovery:03';
const TRACK_URL = `/track/${encodeURIComponent(TRACK)}`;
// Morceau importé (faux Deezer de la copie du catalogue) : lien Deezer, donc lecteur intégré possible.
const IMPORTED = ['dz1000001:01', 'dz1000001:02', 'dz1000001:03'];
const enc = encodeURIComponent;

// Joueurs secondaires (l'ami, onze inconnus) : créés directement dans la base du site visé, avec une session, pour ne pas
// consommer les limites d'inscription et de connexion par adresse IP (10 inscriptions par heure hors test).
const DB_FILE = process.env.DATABASE_FILE || '/tmp/am-p0-c/am.db';
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA busy_timeout = 5000');
const { config } = await import('../../server/config.js');

/** Joueur vérifié (CGU acceptées, accueil fait) avec une session ouverte ; renvoie { id, username, cookie }. */
function seedUser(username) {
  const now = Date.now();
  const { id } = db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at,
      terms_accepted_at, terms_version, onboarded_at) VALUES (?, ?, 'x', ?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(`${username}@example.com`, username, now, now, now, now, config.termsVersion, now);
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(crypto.createHash('sha256').update(token).digest('hex'), id, now, now + 86_400_000);
  return { id, username, cookie: `albummania_sid=${token}` };
}

/** Appel de l'API (par le site visé) avec la session d'un joueur secondaire. */
async function callAs(user, method, apiPath, data) {
  const res = await fetch(`${BASE}/api${apiPath}`, {
    method,
    headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json', Cookie: user.cookie },
    ...(data !== undefined && { body: JSON.stringify(data) }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Le lecteur Deezer n'est pas joignable dans le bac à sable : une page vide le remplace (le clic reste vérifié). */
async function stubDeezerWidget(page) {
  await page.route(/widget\.deezer\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Deezer</title>' }));
}

const before = (page, a, b) => page.evaluate(([x, y]) => {
  const ea = document.querySelector(x);
  const eb = document.querySelector(y);
  return !!ea && !!eb && !!(ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING);
}, [a, b]);

const pathOf = (page) => new URL(page.url()).pathname;

// ---------- préparation : un ami qui note, onze inconnus qui critiquent le même morceau ----------

const friend = seedUser(`p0cf_${stamp}`);
const notes = [
  ['album', 'discovery', 8, 'Le disque des trajets de nuit, du début à la fin.'],
  ['track', 'discovery:01', 9, null],
  ['track', IMPORTED[0], 7, 'Un morceau importé qui tient la route.'],
  ['track', TRACK, 9, 'Digital Love : le solo de la fin, toujours.'],
];
for (const [type, id, score, review] of notes) {
  const r = await callAs(friend, 'PUT', `/ratings/${type}/${enc(id)}`, { score, ...(review ? { review } : {}) });
  if (r.status !== 200) fail(`[setup] note de l'ami ${type}:${id} : ${r.status} ${JSON.stringify(r.body)}`);
}
for (let i = 0; i < 11; i++) {
  const s = seedUser(`p0cs${i}_${stamp}`);
  const r = await callAs(s, 'PUT', `/ratings/track/${enc(TRACK)}`, { score: 4 + (i % 7), review: `Critique de la communauté numéro ${i + 1}, écrite pour le test.` });
  if (r.status !== 200) fail(`[setup] critique ${i} : ${r.status} ${JSON.stringify(r.body)}`);
}

// ---------- ordinateur ----------

await run('desktop', VIEWPORTS.desktop, async (page) => {
  await stubDeezerWidget(page);
  await signup(page, player.email, player.username);
  // Amitié : demande du joueur, acceptée par l'ami.
  const req = await apiCall(page, 'POST', '/friends/request', { username: friend.username });
  if (req.status !== 200) fail(`[desktop] demande d'ami : ${req.status} ${JSON.stringify(req.body)}`);
  const inbox = await callAs(friend, 'GET', '/friends');
  const incoming = inbox.body?.incoming?.[0];
  if (!incoming) throw new Error('demande d’ami non reçue');
  await callAs(friend, 'POST', `/friends/${incoming.requestId}/accept`);

  // Pages suivantes des critiques demandées par le site (jamais la première, qui arrive avec les notes de l'élément).
  const reviewPages = [];
  page.on('request', (r) => r.url().includes('/reviews?') && reviewPages.push(new URL(r.url())));

  // 1. Depuis le fil des amis de l'accueil : la note d'un morceau mène à sa page.
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.hero');
  const feedLink = page.locator(`.feed__item a.feed__title[href="${TRACK_URL}"]`).first();
  await feedLink.waitFor({ timeout: 15_000 });
  await feedLink.scrollIntoViewIfNeeded();
  await shot(page, 'd-10-home-feed');
  await feedLink.click();
  await page.waitForSelector('.track-head');
  if (pathOf(page) !== TRACK_URL) fail(`[desktop] fil des amis → ${pathOf(page)}, attendu ${TRACK_URL}`);
  await page.waitForSelector('.trk-group--community .review');
  await page.waitForTimeout(500);
  await shot(page, 'd-20-track');
  await shot(page, 'd-21-track-full', { fullPage: true });

  // 2. Composition de la page morceau.
  const title = (await page.textContent('.track-head h1')).trim();
  if (title !== 'Digital Love') fail(`[desktop] titre du morceau : « ${title} »`);
  for (const sel of ['.track-head__cover', '.track-head__card .card', '.trk-mine', '.trk-listen', '#ma-note .review-editor', '.album-ratings__community', '.trk-siblings .tracklist']) {
    if (!(await page.locator(sel).count())) fail(`[desktop] page morceau : « ${sel} » absent`);
  }
  if (!(await before(page, '.trk-group--friends', '.trk-group--community'))) fail('[desktop] « Vos amis » ne passe pas avant « Communauté AlbumMania »');
  const friendsText = await page.textContent('.trk-group--friends');
  if (!friendsText.includes(friend.username) || !friendsText.includes('Vos amis')) fail(`[desktop] groupe des amis : ${friendsText.slice(0, 120)}`);
  if (!(await page.textContent('.trk-group--community h3')).includes('Communauté AlbumMania')) fail('[desktop] titre « Communauté AlbumMania » absent');
  const anchors = await page.locator('.trk-group .review[id^="review-"]').count();
  if (anchors < 11) fail(`[desktop] ancres review-<id> : ${anchors}`);
  const rows = await page.locator('.trk-siblings .tracklist tbody tr').count();
  if (rows !== 14) fail(`[desktop] autres morceaux de l'album : ${rows} lignes (14 attendues)`);
  if ((await page.locator('.trk-siblings .trk-row--current').count()) !== 1) fail('[desktop] morceau en cours non repéré dans la tracklist');
  // « Voir plus » : les pages suivantes de la communauté (curseur), jusqu'à la fin, sans doublon.
  const firstPage = await page.locator('.trk-group--community .review').count();
  if (firstPage !== 10) fail(`[desktop] première page de la communauté : ${firstPage} critiques (10 attendues)`);
  const all = await apiCall(page, 'GET', `/ratings/track/${enc(TRACK)}/reviews?scope=community&limit=50`);
  const expected = all.body?.items?.length || 0;
  if (expected < 11) fail(`[desktop] critiques de la communauté côté API : ${expected}`);
  if (reviewPages.length) fail(`[desktop] critiques redemandées sans clic : ${reviewPages.map((u) => u.search).join(', ')}`);
  for (let i = 0; i < 6 && (await page.locator('.trk-group--community .load-more .btn').count()); i++) {
    const shown = await page.locator('.trk-group--community .review').count();
    await page.waitForFunction(() => !document.querySelector('.trk-group--community .load-more .btn')?.disabled);
    await page.click('.trk-group--community .load-more .btn');
    await page.waitForFunction((n) => document.querySelectorAll('.trk-group--community .review').length > n, shown, { timeout: 10_000 });
  }
  const ids = await page.locator('.trk-group--community .review').evaluateAll((els) => els.map((e) => e.id));
  if (ids.length !== expected || new Set(ids).size !== ids.length) fail(`[desktop] « Voir plus » : ${ids.length} critiques affichées (${new Set(ids).size} distinctes), ${expected} attendues`);
  // Chaque « Voir plus » = une page suivante, avec un seul curseur.
  const clicks = Math.ceil((expected - 10) / 10);
  if (reviewPages.length !== clicks || reviewPages.some((u) => u.searchParams.getAll('cursor').length !== 1)) {
    fail(`[desktop] pages suivantes : ${reviewPages.map((u) => u.search).join(', ')} (${clicks} attendue(s), un curseur chacune)`);
  }

  // 3. Note en demi-étoiles + critique.
  await page.locator('#ma-note').scrollIntoViewIfNeeded();
  const stars = await page.locator('#ma-note .star-input__stars').boundingBox();
  await page.mouse.click(stars.x + stars.width * 0.85, stars.y + stars.height / 2);
  const label = await page.getAttribute('#ma-note .review-editor__value', 'aria-label');
  if (!/4,5 étoiles/.test(label || '')) fail(`[desktop] libellé de la note : « ${label} » (attendu « 4,5 étoiles… »)`);
  const valuetext = await page.getAttribute('#ma-note .star-input__stars', 'aria-valuetext');
  if (!/4,5/.test(valuetext || '')) fail(`[desktop] aria-valuetext : « ${valuetext} »`);
  await page.fill('#review-f', 'Le vocoder le plus tendre de tout l’album.');
  const [saved] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/api/ratings/track/${enc(TRACK)}`) && r.request().method() === 'PUT'),
    page.click('#ma-note .review-editor__actions .btn--primary'),
  ]);
  const body = await saved.json();
  if (saved.status() !== 200 || body.mine?.score !== 9 || !Number.isInteger(body.mine?.id)) fail(`[desktop] note enregistrée : ${saved.status()} ${JSON.stringify(body.mine)}`);
  await page.waitForSelector('.toast');
  await page.waitForFunction(() => /Modifier ma note/.test(document.querySelector('.trk-head__actions .btn--primary')?.textContent || ''));
  await shot(page, 'd-22-track-rated');

  // 4. Lecteur Deezer d'un morceau importé : chargé seulement au clic.
  await page.goto(`${BASE}/track/${enc(IMPORTED[0])}`);
  await page.waitForSelector('.trk-listen__embed');
  if (await page.locator('iframe').count()) fail('[desktop] un lecteur est chargé sans clic');
  const embedText = await page.textContent('.trk-listen__embed');
  if (!embedText.includes('Le lecteur Deezer dépose des cookies')) fail(`[desktop] panneau du lecteur : ${embedText}`);
  const firstLink = await page.getAttribute('.trk-listen__links a', 'href');
  if (!/^https:\/\/www\.deezer\.com\/track\/\d+/.test(firstLink || '')) fail(`[desktop] premier lien d'écoute : ${firstLink}`);
  await shot(page, 'd-30-listen-placeholder');
  await page.click('.trk-listen__embed .btn--ghost');
  const frame = page.locator('iframe.trk-listen__frame');
  await frame.waitFor();
  const src = await frame.getAttribute('src');
  if (!/^https:\/\/widget\.deezer\.com\/widget\/dark\/track\/\d+$/.test(src || '')) fail(`[desktop] adresse du lecteur : ${src}`);
  const frameTitle = await frame.getAttribute('title');
  if (!/^Lecteur Deezer/.test(frameTitle || '')) fail(`[desktop] titre du lecteur : ${frameTitle}`);
  await shot(page, 'd-31-listen-loaded');
  // « Toujours charger » : le lecteur s'ouvre ensuite directement, jusqu'à ce que le choix soit effacé.
  await page.goto(`${BASE}/track/${enc(IMPORTED[1])}`);
  await page.waitForSelector('.trk-listen__embed');
  await page.click('.trk-listen__embed .btn--quiet');
  await page.waitForSelector('iframe.trk-listen__frame');
  await page.goto(`${BASE}/track/${enc(IMPORTED[2])}`);
  await page.waitForSelector('.trk-listen');
  await page.waitForSelector('iframe.trk-listen__frame', { timeout: 5000 }).catch(() => fail('[desktop] « Toujours charger » non retenu'));
  await page.evaluate(() => localStorage.removeItem('albummania.embeds'));

  // 5. Page album : en-tête avec l'écoute, « Vos amis » puis « Communauté AlbumMania », titres de la tracklist → morceau.
  await page.goto(`${BASE}/album/discovery`);
  await page.waitForSelector('.album-head .trk-listen');
  await page.waitForSelector('.album-ratings .trk-group--friends .review');
  if (!(await before(page, '.album-ratings .trk-group--friends', '.album-ratings .trk-group--community'))) fail('[desktop] album : amis après la communauté');
  await page.locator('#critiques').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, 'd-40-album-reviews');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('.toolbar .seg__btn:nth-child(2)');
  await page.waitForSelector('.tracklist a.tracklist__title');
  await shot(page, 'd-41-album-tracklist');
  await page.locator('.tracklist a.tracklist__title').first().click();
  await page.waitForSelector('.track-head');
  if (pathOf(page) !== `/track/${enc('discovery:01')}`) fail(`[desktop] tracklist → ${pathOf(page)}`);
  // Retour : la page précédente (l'album).
  await page.click('.back-link');
  await page.waitForSelector('.album-head');

  // 6. Fiche d'une carte : un seul titre, « Voir la page du morceau ».
  await page.click('.toolbar .seg__btn:nth-child(1)');
  await page.locator('.card-grid .card').nth(2).click();
  await page.waitForSelector('.card-detail');
  await page.waitForTimeout(300);
  const head = (await page.textContent('.modal__head h2')).trim();
  const cardTitle = (await page.textContent('.card-detail__title')).trim();
  if (head === cardTitle) fail(`[desktop] fiche de carte : titre en double « ${head} »`);
  if (!(await page.locator('.card-detail .trk-listen').count())) fail('[desktop] fiche de carte sans panneau d’écoute');
  await shot(page, 'd-50-card-modal');
  await page.click('.card-detail a:has-text("Voir la page du morceau")');
  await page.waitForSelector('.track-head');
  if (await page.locator('.modal').count()) fail('[desktop] la fiche reste ouverte sur la page du morceau');
  if (pathOf(page) !== TRACK_URL) fail(`[desktop] fiche → ${pathOf(page)}`);

});

// Morceau inconnu : « Cette face n'existe pas ». Contexte à part : le 404 attendu de GET /api/catalog/tracks/:id
// s'inscrit dans la console du navigateur (« Failed to load resource … 404 ») et n'est pas une erreur ici.
{
  const b = await launch();
  const ctx = await b.newContext({ viewport: VIEWPORTS.desktop, locale: 'fr-FR' });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  const expected = [];
  page.on('response', (r) => r.status() === 404 && expected.push(new URL(r.url()).pathname));
  page.on('pageerror', (e) => fail(`[desktop-404] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && !/status of 404/.test(m.text()) && fail(`[desktop-404] console: ${m.text()}`));
  try {
    await login(page, player.username);
    await page.goto(`${BASE}/track/${enc('nope:99')}`);
    await page.waitForSelector('.catalog-missing__title');
    const missing = await page.textContent('.catalog-missing__title');
    if (!/face/i.test(missing)) fail(`[desktop-404] morceau inconnu : « ${missing} »`);
    const others = expected.filter((p) => p !== `/api/catalog/tracks/${enc('nope:99')}`);
    if (others.length) fail(`[desktop-404] autres réponses 404 : ${others.join(', ')}`);
    await page.screenshot({ path: `${OUT}/d-60-track-404.png` });
  } catch (err) {
    await page.screenshot({ path: `${OUT}/zz-error-desktop-404.png` }).catch(() => {});
    fail(`[desktop-404] ${err.message}`);
  } finally {
    await ctx.close();
  }
}

// ---------- téléphone ----------

await run('phone', VIEWPORTS.phone, async (page) => {
  await stubDeezerWidget(page);
  await login(page, player.username);
  await page.goto(`${BASE}${TRACK_URL}`);
  await page.waitForSelector('.trk-group--community .review');
  await page.waitForTimeout(500);
  await shot(page, 'm-20-track');
  await shot(page, 'm-21-track-full', { fullPage: true });
  await checkNoHorizontalScroll(page, 'phone track');
  if (await page.locator('.track-head__card').isVisible()) fail('[phone] la carte de l’en-tête devrait laisser place à « Ma carte »');
  if (!(await page.locator('.trk-mine__card .card').isVisible())) fail('[phone] carte absente de « Ma carte »');
  // Tracklist du bas : tout tient dans l'écran (moyenne sous le titre), la colonne « Ta note » reste visible.
  const table = await page.$eval('.trk-siblings .table-wrap', (el) => {
    const mine = el.querySelector('tbody .trk-col-mine')?.getBoundingClientRect();
    return { sw: el.scrollWidth, cw: el.clientWidth, mineRight: mine ? mine.right : Infinity };
  });
  if (table.sw > table.cw + 1 || table.mineRight > 390) fail(`[phone] tracklist plus large que l’écran : ${JSON.stringify(table)}`);
  if (!(await page.locator('.trk-siblings .trk-avg-inline').first().isVisible())) fail('[phone] moyenne absente sous le titre');
  // Note en demi-étoiles sur téléphone (appui).
  await page.locator('#ma-note').scrollIntoViewIfNeeded();
  const stars = await page.locator('#ma-note .star-input__stars').boundingBox();
  await page.mouse.click(stars.x + stars.width * 0.65, stars.y + stars.height / 2);
  const label = await page.getAttribute('#ma-note .review-editor__value', 'aria-label');
  if (!/3,5 étoiles/.test(label || '')) fail(`[phone] libellé de la note : « ${label} »`);

  await page.goto(`${BASE}/track/${enc(IMPORTED[0])}`);
  await page.waitForSelector('.trk-listen__embed');
  await page.locator('.trk-listen').scrollIntoViewIfNeeded();
  await shot(page, 'm-30-listen');
  await checkNoHorizontalScroll(page, 'phone imported track');

  await page.goto(`${BASE}/album/discovery`);
  await page.waitForSelector('.album-ratings .trk-group--friends .review');
  await shot(page, 'm-40-album-full', { fullPage: true });
  await checkNoHorizontalScroll(page, 'phone album');
  await page.locator('.card-grid .card').first().click();
  await page.waitForSelector('.card-detail');
  await page.waitForTimeout(300);
  await shot(page, 'm-50-card-modal');
  await page.click('.card-detail a:has-text("Voir la page du morceau")');
  await page.waitForSelector('.track-head');
  await checkNoHorizontalScroll(page, 'phone track from card');
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
      if (await page.locator('.auth__form input[type=checkbox]').count()) {
        await page.fill('#su-email', `demo_c_${name}@example.com`);
        await page.fill('#su-user', `democ_${name}`);
        await page.fill('#su-pw', 'motdepasse123');
        if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', 'motdepasse123');
        for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
        await page.waitForSelector('.field__ok');
        await page.click('button[type=submit]');
        await page.click('.demo-mail .btn');
      } else {
        // Formulaire sans la case « CGU et 15 ans ou plus » (ajoutée par P0-D) : session de démo enregistrée, comme k0.
        await page.evaluate((who) => {
          const now = Date.now();
          localStorage.setItem('albummania.demo.v1', JSON.stringify({
            nextId: 2, cards: {}, achievements: {}, friendships: [], tokens: [], games: {}, ratings: [], session: 1,
            users: [{ id: 1, email: `${who}@example.com`, username: who, password: 'x', verified: now, role: 'player', lang: 'fr',
              avatar: 'initials', avatarColor: 'auto', royalties: 200, xp: 0, packs: 0, packsAt: now, bonusPacks: 5, showcase: [],
              createdAt: now, openings: 0 }],
          }));
        }, `democ_${name}`);
        await page.goto(`file://${demoFile}`);
      }
      await page.waitForSelector('.hero');
      await page.locator('a[href="/collection"]:visible').first().click();
      await page.waitForSelector('.album-grid a.album-tile');
      await page.locator('.album-grid a.album-tile').first().click();
      await page.waitForSelector('.album-head');
      await page.click('.toolbar .seg__btn:nth-child(2)');
      await page.locator('.tracklist a.tracklist__title').nth(2).click();
      await page.waitForSelector('.track-head');
      await page.waitForSelector('#critiques .review-editor');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${name === 'desktop' ? 'd' : 'm'}-70-demo-track.png` });
      if (name === 'phone') await checkNoHorizontalScroll(page, `${label} track`);
      // Une note en demi-étoiles dans la démo aussi.
      await page.locator('#ma-note .star-input__stars').scrollIntoViewIfNeeded();
      const stars = await page.locator('#ma-note .star-input__stars').boundingBox();
      await page.mouse.click(stars.x + stars.width * 0.85, stars.y + stars.height / 2);
      await page.click('#ma-note .review-editor__actions .btn--primary');
      await page.waitForSelector('.toast');
      await page.waitForFunction(() => document.querySelector('.album-ratings__community .community-score'));
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
await finish('Parcours P0-C sans erreur.');
if (stack) await stack.stop();
