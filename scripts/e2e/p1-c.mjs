// Parcours P1-C (PLAN.md 9.4, 8.2 P1.3) : listes, « Mes 9 albums », images de partage ; ordinateur 1440 × 900 et
// téléphone 390 × 844 (écran tactile).
//   - Listes : page /lists (carte « Mes 9 albums » épinglée, onglets Mes listes · Amis · Populaires), création d'une
//     liste classée (recherche, doublon refusé, note, ordre aux boutons ↑ ↓ et au clavier), page de la liste (rangs,
//     notes, J'aime et commentaire d'un ami), modification (visibilité), « Ajouter à une liste » depuis la page d'un
//     album (ou, tant que la page d'album ne monte pas le bouton (P1-B), depuis une ligne d'une liste), « Mes 9
//     albums » dans la même feuille, suppression ; une liste réservée aux amis est introuvable pour un inconnu.
//   - « Mes 9 albums » (/nine, comme my9games) : titre modifiable, 9 cases remplies par la recherche, échange au
//     glisser (souris) et au clavier (Alt + flèche), « Déplacer » dans la fenêtre d'une case (au doigt), remplacer /
//     retirer une case, titres sous les pochettes, formats et thèmes, sauvegarde automatique (relue après
//     rechargement), « Générer l'image » → aperçu → téléchargement d'un PNG (taille, dimensions, signature) ; sur
//     téléphone « Partager » → fichier PNG donné à la feuille de partage du système (Web Share), ou, sans partage de
//     fichier, image en grand avec « Appuie longuement ». Lecture /u/:pseudo/nine par un ami.
//   - Moteur d'images (share/renderImage.js) : vraie pochette de même origine dessinée (pixels vérifiés) et ligne
//     d'attribution ; pochette d'une autre origine sans en-tête CORS, ou introuvable → visuel généré, l'export réussit
//     quand même ; avec CORS → vraie pochette ; trois formats, deux thèmes. Dans le site : liste d'albums importés aux
//     pochettes Deezer (CDN simulé par le navigateur) → image avec les vraies pochettes ; CDN bloqué → visuels générés.
//   - Démo autonome (dist-demo/albummania-demo.html) : listes et grilles des joueurs fictifs (recherche, page d'une
//     liste, onglet Populaires), image d'une liste en grand avec « Appuie longuement pour l'enregistrer ».
//   Zéro erreur de console (hors images Deezer bloquées par le bac à sable), pas de défilement horizontal.
//   BASE=http://localhost:5113 OUT=/tmp/am-p1-c/shots DATABASE_FILE=/tmp/am-p1-c/am.db node scripts/e2e/p1-c.mjs
//   (sans BASE : démarre sa propre copie sur 3113 / 5113 avec une copie neuve de $FIXTURE dans /tmp/am-p1-c/am.db)
//   FOCUS=desktop,phone,engine,demo : ne joue que ces parties (développement).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, shot, fail, finish, setBase, startStack, checkNoHorizontalScroll,
  launch, routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p1-c', apiPort: 3113, webPort: 5113, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const FOCUS = new Set((process.env.FOCUS || 'desktop,phone,engine,demo').split(',').map((s) => s.trim()));
const stamp = Date.now().toString(36).slice(-5);
const enc = encodeURIComponent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Les 9 albums de « Mes 9 albums » (albums de base du catalogue : mêmes identifiants dans la démo), avec la
// recherche tapée dans la fenêtre d'une case et un texte qui distingue la bonne ligne.
const NINE = [
  ['discovery', 'discovery', 'Daft Punk'],
  ['abbey-road', 'abbey road', 'Beatles'],
  ['thriller', 'thriller', 'Michael Jackson'],
  ['nevermind', 'nevermind', 'Nirvana'],
  ['back-to-black', 'back to black', 'Amy Winehouse'],
  ['kind-of-blue', 'kind of blue', 'Miles Davis'],
  ['random-access-memories', 'random access memories', 'Daft Punk'],
  ['moon-safari', 'moon safari', 'Air'],
  ['exodus', 'exodus', 'Bob Marley'],
];

// ---------- joueurs (créés dans la base du site visé, avec une session) ----------

const DB_FILE = process.env.DATABASE_FILE || '/tmp/am-p1-c/am.db';
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA busy_timeout = 5000');
const { config } = await import('../../server/config.js');

/** Joueur vérifié (CGU acceptées, accueil fait) avec une session ; { id, username, token, cookie }. */
function seedUser(username) {
  const now = Date.now();
  const { id } = db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at,
      terms_accepted_at, terms_version, onboarded_at, bonus_packs) VALUES (?, ?, 'x', ?, ?, ?, ?, ?, ?, 2) RETURNING id`)
    .get(`${username}@example.com`, username, now - 3 * 86_400_000, now, now - 3 * 86_400_000, now, config.termsVersion, now);
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(crypto.createHash('sha256').update(token).digest('hex'), id, now, now + 86_400_000);
  return { id, username, token, cookie: `albummania_sid=${token}` };
}

/** Appel de l'API (par le site visé) avec la session d'un joueur. */
async function callAs(user, method, apiPath, data) {
  const res = await fetch(`${BASE}/api${apiPath}`, {
    method,
    headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json', Cookie: user.cookie },
    ...(data !== undefined && { body: JSON.stringify(data) }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const must = async (label, promise, status = [200, 201]) => {
  const r = await promise;
  if (!status.includes(r.status)) fail(`[setup] ${label} : ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

async function befriend(a, b) {
  await must('demande d’ami', callAs(a, 'POST', '/friends/request', { username: b.username }));
  const inbox = await callAs(b, 'GET', '/friends');
  const req = inbox.body?.incoming?.find((x) => x.user.username === a.username);
  if (!req) throw new Error('demande d’ami non reçue');
  await must('acceptation', callAs(b, 'POST', `/friends/${req.requestId}/accept`));
}

const nina = seedUser(`nina_${stamp}`); // ordinateur
const nino = seedUser(`nino_${stamp}`); // téléphone
const omar = seedUser(`omar_${stamp}`); // ami des deux
const zoe = seedUser(`zoe_${stamp}`); // inconnue
await befriend(nina, omar);
await befriend(nino, omar);

// Omar : une liste publique classée avec des notes, une liste réservée aux amis, sa grille complète.
const omarList = (await must('liste d’Omar', callAs(omar, 'POST', '/lists', {
  title: `Pour les trajets de nuit ${stamp}`, description: 'Des disques à écouter fenêtre ouverte, du premier au dernier titre.',
  ranked: true, itemType: 'album', visibility: 'public',
  items: [
    { type: 'album', id: 'moon-safari', note: 'La Femme d’argent, dès la première note.' },
    { type: 'album', id: 'random-access-memories' },
    { type: 'album', id: 'kind-of-blue', note: 'Pour la fin du trajet.' },
    { type: 'album', id: 'the-dark-side-of-the-moon' },
  ],
}))).list;
await must('liste amis d’Omar', callAs(omar, 'POST', '/lists', {
  title: `Entre nous ${stamp}`, ranked: false, itemType: 'album', visibility: 'friends', items: [{ type: 'album', id: 'nevermind' }],
}));
await must('grille d’Omar', callAs(omar, 'PUT', '/me/grid9', {
  title: 'Mes 9 de toujours', slots: ['abbey-road', 'thriller', 'discovery', 'back-to-black', 'exodus', 'nevermind', 'kind-of-blue', 'moon-safari', '21'],
}));
// Zoé : une liste publique aimée (onglet Populaires), une liste privée.
const zoeList = (await must('liste de Zoé', callAs(zoe, 'POST', '/lists', {
  title: `Classiques du dimanche ${stamp}`, ranked: false, itemType: 'album', visibility: 'public',
  items: [{ type: 'album', id: 'abbey-road' }, { type: 'album', id: 'exodus' }, { type: 'album', id: 'thriller' }],
}))).list;
await must('J’aime d’Omar', callAs(omar, 'PUT', `/likes/list/${zoeList.id}`));
const zoePrivate = (await must('liste privée de Zoé', callAs(zoe, 'POST', '/lists', {
  title: 'Brouillon', ranked: false, itemType: 'album', visibility: 'private', items: [{ type: 'album', id: 'exodus' }],
}))).list;

/** Adresses de l'API dont le 404 est attendu (liste privée d'une autre ouverte exprès). */
const EXPECTED_404 = [`/api/lists/${zoePrivate.id}`];
/** Origines dont les erreurs de console sont attendues (CDN de pochettes simulé : refus CORS, 404 voulus). */
const EXPECTED_CONSOLE = [];

// Albums importés (pochettes Deezer) pour l'image d'une liste aux vraies pochettes.
const imported = db.prepare("SELECT id FROM cat_albums WHERE cover IS NOT NULL ORDER BY id DESC LIMIT 4").all().map((r) => r.id);

// ---------- outils du navigateur ----------

/** PNG d'une couleur unie (w × h), pour les fausses pochettes servies par le navigateur. */
function solidPng(w, h, [r, g, b]) {
  const row = w * 3 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw.set([r, g, b], y * row + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const GREEN = solidPng(64, 64, [0, 255, 0]);

/** Dimensions d'un fichier PNG (en-tête IHDR), ou null. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Relève les réponses HTTP en erreur de l'API (hors codes attendus), pour le diagnostic. */
function watchHttp(page, label, expected = []) {
  page.on('response', (r) => {
    const url = r.url();
    if (r.status() >= 400 && url.includes('/api/') && !expected.some((x) => url.includes(x))) console.log(`[${label}] HTTP ${r.status()} ${url}`);
  });
}

/**
 * Lance `fn(page, ctx)` dans un contexte neuf connecté avec `user` ; `touch` : téléphone (écran tactile, pointeur
 * grossier, sans partage de fichier). Erreurs de page et de console relevées sous `[label]`.
 */
async function session(label, viewport, user, fn, { touch = false } = {}) {
  const b = await launch();
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, locale: 'fr-FR', ...(touch && { hasTouch: true, isMobile: true }), acceptDownloads: true });
  await routeFonts(ctx);
  // Téléphone : Web Share simulé (Chromium sans interface ne répond jamais) ; window.__noShare = true imite un
  // navigateur qui ne sait pas partager de fichier. Les fichiers partagés sont relevés dans window.__shared.
  if (touch) {
    await ctx.addInitScript(() => {
      window.__shared = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data) => !window.__noShare && !!data?.files?.length });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data) => {
          const f = data?.files?.[0];
          window.__shared.push({ files: data?.files?.length || 0, type: f?.type, name: f?.name, size: f?.size, title: data?.title });
        },
      });
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`[${label}] ${e.message}`));
  // Les 404 attendus (liste privée d'une autre, demandée exprès) ne comptent pas comme des erreurs.
  const expected404 = (m) => /status of 404/.test(m.text()) && EXPECTED_404.some((x) => (m.location()?.url || '').includes(x));
  const expectedCdn = (m) => EXPECTED_CONSOLE.some((x) => m.text().includes(x) || (m.location()?.url || '').includes(x));
  page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && !expected404(m) && !expectedCdn(m) && fail(`[${label}] console: ${m.text()}`));
  watchHttp(page, label, EXPECTED_404);
  fs.mkdirSync(OUT, { recursive: true });
  try {
    if (user) {
      await ctx.addCookies([{ name: 'albummania_sid', value: user.token, url: BASE }]);
      await page.goto(`${BASE}/`);
      await page.waitForSelector('.hero');
    }
    await fn(page, ctx);
  } catch (err) {
    await page.screenshot({ path: `${OUT}/zz-error-${label}.png` }).catch(() => {});
    fail(`[${label}] ${err.stack || err.message}`);
  } finally {
    await ctx.close();
  }
}

/**
 * Les éléments `selector` tiennent dans la largeur de l'écran. Le corps de page coupe ce qui dépasse (`overflow-x:
 * clip`) et, en émulation de téléphone, la fenêtre de mise en page s'élargit au contenu (innerWidth > 390) : la
 * mesure se fait donc sur la largeur visible du document (clientWidth), en coordonnées de la page.
 */
async function checkFits(page, label, selector) {
  const out = await page.$$eval(selector, (els) => {
    const width = document.documentElement.clientWidth;
    return els.map((e) => {
      const r = e.getBoundingClientRect();
      const left = r.left + window.scrollX;
      return r.width && (left + r.width > width + 1 || left < -1) ? `${e.className} [${Math.round(left)}, ${Math.round(left + r.width)}] / ${width}` : null;
    }).filter(Boolean);
  });
  if (out.length) fail(`[${label}] hors de l’écran : ${out.slice(0, 3).join(' ; ')}`);
}

const go = async (page, url, selector) => {
  await page.goto(`${BASE}${url}`);
  if (selector) await page.waitForSelector(selector);
};

/** Choisit dans la recherche ouverte (`scope` : élément qui contient le champ) la ligne qui contient `text` et `hint`. */
async function pickFromSearch(page, scope, query, hint) {
  const input = scope.locator('input.gsearch__input, input[type=search], input').first();
  await input.fill(query);
  const option = scope.locator('[role="option"]', { hasText: hint }).first();
  await option.waitFor({ timeout: 15_000 });
  await option.click();
}

/** Remplit la case `index` de l'éditeur « Mes 9 albums » par la recherche. */
async function fillSlot(page, index, [, query, hint]) {
  await page.locator(`.ls-nine [data-slot="${index}"]`).first().click();
  const dialog = page.locator('[data-nine-picker]');
  await dialog.waitFor();
  // Le champ est actif tout de suite (comme my9games) : on tape sans cliquer dedans.
  await page.waitForFunction(() => document.activeElement?.classList.contains('gsearch__input'), null, { timeout: 3000 })
    .catch(() => fail(`[nine] le champ de recherche de la case ${index + 1} n’a pas le focus`));
  await page.keyboard.type(query);
  const option = dialog.locator('[role="option"]', { hasText: hint }).first();
  await option.waitFor({ timeout: 15_000 });
  await option.click();
  await dialog.waitFor({ state: 'detached' });
  await page.locator(`.ls-nine [data-slot="${index}"] .ls-nine__hit`).waitFor();
}

/** Albums des 9 cases de l'éditeur (null : case vide). */
const slotTitles = (page) => page.$$eval('.ls-nine .ls-nine__cell', (cells) => cells.map((c) => c.querySelector('[data-album]')?.dataset.album || null));

/** Attend la fin de la sauvegarde automatique (« Enregistré »). */
async function waitSaved(page) {
  await page.waitForFunction(() => document.querySelector('[data-save-status]')?.getAttribute('data-save-status') === 'saved', null, { timeout: 15_000 });
}

/** Ouvre la feuille de partage et attend l'image générée ; renvoie ses attributs. */
async function waitShareImage(page) {
  const img = page.locator('img[data-share-image]:not(.is-stale)');
  await img.waitFor({ timeout: 30_000 });
  return {
    width: Number(await img.getAttribute('data-width')),
    height: Number(await img.getAttribute('data-height')),
    bytes: Number(await img.getAttribute('data-bytes')),
    covers: await img.getAttribute('data-covers'),
  };
}

// ---------- ordinateur ----------

if (FOCUS.has('desktop')) await session('desktop', VIEWPORTS.desktop, nina, async (page, ctx) => {
  // 1. Listes : carte épinglée, onglets, état vide de « Mes listes ».
  await go(page, '/lists', '[data-grid9-card]');
  await page.locator('.ls-page .empty-state').waitFor();
  await shot(page, 'd-10-lists-empty');
  await page.locator('.ls-tabs .tabs__tab').nth(1).click();
  await page.locator(`[data-list-id="${omarList.id}"]`).waitFor();
  if (await page.locator('.list-card', { hasText: 'Brouillon' }).count()) fail('[desktop] une liste privée d’une autre apparaît');
  await shot(page, 'd-11-lists-friends');
  await page.locator('.ls-tabs .tabs__tab').nth(2).click();
  await page.locator(`[data-list-id="${zoeList.id}"]`).waitFor();
  if (!new URL(page.url()).search.includes('tab=popular')) fail('[desktop] l’onglet n’est pas dans l’adresse');

  // 2. Nouvelle liste classée : recherche, doublon refusé, note, ordre aux boutons et au clavier.
  await page.click('[data-new-list]');
  await page.waitForURL('**/lists/new');
  await page.fill('[data-list-title]', `Mes nuits blanches ${stamp}`);
  await page.fill('.ls-editor__meta textarea', 'Trois disques pour ne pas dormir.');
  await page.locator('.ls-editor__meta .ls-switch').click();
  const search = page.locator('.ls-editor__search');
  await pickFromSearch(page, search, 'abbey road', 'Beatles');
  await pickFromSearch(page, search, 'thriller', 'Michael Jackson');
  await pickFromSearch(page, search, 'kind of blue', 'Miles Davis');
  await page.locator('.ls-rows .ls-row').nth(2).waitFor();
  // Doublon : refusé tout de suite, la ligne déjà là clignote.
  await pickFromSearch(page, search, 'thriller', 'Michael Jackson');
  await page.locator('.ls-row--flash').waitFor();
  if ((await page.locator('.ls-rows .ls-row').count()) !== 3) fail('[desktop] un doublon a été ajouté à la liste');
  // Note sur Thriller.
  const thrillerRow = page.locator('.ls-row[data-item="album:thriller"]');
  await thrillerRow.locator('.ls-row__tools .icon-btn').first().click();
  await thrillerRow.locator('textarea').fill('Le clip, la nuit, la peur.');
  // Ordre : Abbey Road descend (↓), puis Kind of Blue monte au clavier (↑ sur sa poignée).
  await page.locator('.ls-row[data-item="album:abbey-road"] .ls-row__tools .icon-btn').nth(2).click();
  await page.locator('.ls-row[data-item="album:kind-of-blue"] .ls-row__grip').focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const order = await page.$$eval('.ls-rows .ls-row', (rows) => rows.map((r) => r.dataset.item));
  const wanted = ['album:kind-of-blue', 'album:thriller', 'album:abbey-road'];
  if (order.join() !== wanted.join()) fail(`[desktop] ordre de l’éditeur : ${order}, attendu ${wanted}`);
  const focusedGrip = await page.evaluate(() => document.activeElement?.closest('.ls-row')?.dataset.item);
  if (focusedGrip !== 'album:kind-of-blue') fail(`[desktop] le focus ne suit pas la ligne déplacée (${focusedGrip})`);
  await shot(page, 'd-20-list-editor', { fullPage: true });
  await page.click('[data-save-list]');
  await page.waitForURL(/\/list\/\d+$/);
  const listId = Number(new URL(page.url()).pathname.split('/').pop());
  await page.locator('.ls-items--ranked .ls-item').nth(2).waitFor();
  const shown = await page.$$eval('.ls-items .ls-item', (rows) => rows.map((r) => r.dataset.item));
  if (shown.join() !== wanted.join()) fail(`[desktop] ordre de la page : ${shown}`);
  const ranks = await page.$$eval('.ls-item__rank', (els) => els.map((e) => e.textContent.trim()));
  if (ranks.join() !== '1,2,3') fail(`[desktop] rangs : ${ranks}`);
  if (!(await page.locator('.ls-item__note', { hasText: 'Le clip, la nuit' }).count())) fail('[desktop] la note n’est pas affichée');

  // 3. Un ami aime et commente la liste ; la page les montre.
  await must('J’aime de l’ami', callAs(omar, 'PUT', `/likes/list/${listId}`));
  await must('commentaire de l’ami', callAs(omar, 'POST', '/comments', { targetType: 'list', targetId: listId, body: 'Thriller en deuxième, osé !' }));
  await page.reload();
  await page.locator('.comment', { hasText: 'Thriller en deuxième' }).waitFor();
  await shot(page, 'd-21-list-page', { fullPage: true });

  // 4. Modifier : visibilité « Amis » (une inconnue ne la trouve plus).
  await page.click('[data-edit-list]');
  await page.waitForURL(`**/list/${listId}/edit`);
  await page.locator('.ls-editor__meta .seg').last().locator('.seg__btn').nth(1).click();
  await page.click('[data-save-list]');
  await page.waitForURL(`**/list/${listId}`);
  await page.locator('.ls-head .eyebrow', { hasText: 'Amis' }).waitFor();
  const asZoe = await callAs(zoe, 'GET', `/lists/${listId}`);
  if (asZoe.status !== 404) fail(`[desktop] liste « amis » lue par une inconnue : ${asZoe.status}`);

  // 5. « Ajouter à une liste » depuis la page d'un album (P1-B monte le bouton) ou, sinon, depuis une ligne d'une liste.
  await go(page, '/album/discovery', '.album-head, .page');
  let from = 'album';
  // L'en-tête de l'album (et ses actions) arrive après la coquille : on attend le bouton un court instant.
  await page.locator('.album-head [data-add-to-list]').first().waitFor({ timeout: 8000 }).catch(() => {});
  if (!(await page.locator('[data-add-to-list]').first().isVisible().catch(() => false))) {
    from = 'list';
    console.log('[desktop] la page d’album ne monte pas encore « Ajouter à une liste » (P1-B) : essai depuis une liste.');
    await go(page, `/list/${omarList.id}`, '.ls-items');
    await must('Discovery chez Omar', callAs(omar, 'POST', `/lists/${omarList.id}/items`, { type: 'album', id: 'discovery' }), [201, 409]);
    await page.reload();
    await page.locator('.ls-item[data-item="album:discovery"] [data-add-to-list]').waitFor();
  }
  const button = from === 'album' ? page.locator('[data-add-to-list]').first() : page.locator('.ls-item[data-item="album:discovery"] [data-add-to-list]');
  await button.click();
  const sheet = page.locator('.ls-add-modal');
  await sheet.waitFor();
  const myRow = sheet.locator('.ls-pick__row', { hasText: `Mes nuits blanches ${stamp}` });
  await myRow.locator('button').click();
  await myRow.locator('.chip--cue').waitFor();
  // « Mes 9 albums » : Discovery va dans la première case vide.
  const gridRow = sheet.locator('.ls-pick__row--grid');
  await gridRow.locator('button').click();
  await gridRow.locator('.chip--cue').waitFor();
  await shot(page, 'd-30-add-to-list');
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  const after = await callAs(nina, 'GET', `/lists/${listId}`);
  if (after.body?.items?.length !== 4 || after.body.items[3].id !== 'discovery') fail(`[desktop] « Ajouter à une liste » : ${JSON.stringify(after.body?.items?.map((i) => i.id))}`);
  const again = await callAs(nina, 'POST', `/lists/${listId}/items`, { type: 'album', id: 'discovery' });
  if (again.status !== 409) fail(`[desktop] second ajout : ${again.status}, attendu 409 already_in_list`);

  // 6. « Mes 9 albums » : titre, 8 cases par la recherche (Discovery déjà en case 1), échanges, remplacement.
  await go(page, '/nine', '[data-nine-editor] .ls-nine');
  await page.locator('.ls-nine [data-slot="0"] .ls-nine__hit').waitFor();
  await shot(page, 'd-40-nine-start');
  const title = page.locator('[data-nine-title]');
  await title.fill(`Mes 9 de ${stamp}`);
  for (let i = 1; i < 9; i++) await fillSlot(page, i, NINE[i]);
  let titles = await slotTitles(page);
  if (titles.some((x) => !x)) fail(`[desktop] cases vides après remplissage : ${titles}`);
  if (!(await page.locator('[data-generate]').isEnabled())) fail('[desktop] « Générer l’image » reste désactivé à 9/9');
  // Glisser la case 1 sur la case 5 (souris).
  const box0 = await page.locator('.ls-nine [data-slot="0"]').boundingBox();
  const box4 = await page.locator('.ls-nine [data-slot="4"]').boundingBox();
  await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
  await page.mouse.down();
  await page.mouse.move(box0.x + box0.width / 2 + 20, box0.y + box0.height / 2 + 20, { steps: 4 });
  await page.mouse.move(box4.x + box4.width / 2, box4.y + box4.height / 2, { steps: 10 });
  await page.locator('.ls-nine__ghost').waitFor();
  await shot(page, 'd-41-nine-drag');
  await page.mouse.up();
  let next = await slotTitles(page);
  if (next[4] !== titles[0] || next[0] !== titles[4]) fail(`[desktop] glisser la case 1 sur la case 5 : ${titles} → ${next}`);
  // Au clavier : Alt + → sur la case 2 l'échange avec la case 3, le focus suit.
  titles = next;
  await page.locator('.ls-nine [data-slot="1"] .ls-nine__hit').focus();
  await page.keyboard.press('Alt+ArrowRight');
  next = await slotTitles(page);
  if (next[2] !== titles[1] || next[1] !== titles[2]) fail(`[desktop] Alt + → sur la case 2 : ${titles} → ${next}`);
  const focusedSlot = await page.evaluate(() => document.activeElement?.closest('[data-slot]')?.dataset.slot);
  if (focusedSlot !== '2') fail(`[desktop] le focus ne suit pas la case déplacée (${focusedSlot})`);
  // Remplacer / retirer : la case 9 ouvre la recherche avec « Retirer ».
  await page.locator('.ls-nine [data-slot="8"] .ls-nine__hit').click();
  // Piège du focus : Tab et Maj+Tab tournent dans la fenêtre (aria-modal), la page cachée derrière n'est jamais atteinte.
  await page.locator('.ls-picker__current button').waitFor();
  for (const key of ['Tab', 'Shift+Tab']) {
    const trail = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press(key);
      trail.push(await page.evaluate(() => (document.activeElement?.closest('[role="dialog"][aria-modal="true"]') ? 'D' : 'X')));
    }
    if (trail.includes('X')) fail(`[desktop] ${key} sort de la recherche « Mes 9 albums » : ${trail.join('')}`);
  }
  await page.locator('.ls-picker__current button').click();
  await page.locator('.ls-nine .nine__slot--empty[data-slot="8"]').waitFor();
  if (await page.locator('[data-generate]').isEnabled()) fail('[desktop] « Générer l’image » actif avec une case vide');
  await fillSlot(page, 8, NINE[8]);
  // Titres sous les pochettes, format carré, thème Papier (l'aperçu suit).
  await page.locator('.nine__tools .ls-nine-titles').click();
  await page.locator('.ls-nine__caption').nth(8).waitFor();
  await page.locator('.nine__tools .seg').first().locator('.seg__btn').nth(1).click();
  await page.locator('.nine__tools .seg').nth(1).locator('.seg__btn').nth(1).click();
  await page.locator('.nine-share.ls-fmt--square.nine-share--paper').waitFor();
  await waitSaved(page);
  await shot(page, 'd-42-nine-full');
  const saved = await callAs(nina, 'GET', '/me/grid9');
  const finalTitles = await slotTitles(page);
  if (saved.body?.title !== `Mes 9 de ${stamp}`) fail(`[desktop] titre enregistré : ${saved.body?.title}`);
  if (saved.body?.slots?.filter(Boolean).length !== 9) fail(`[desktop] cases enregistrées : ${JSON.stringify(saved.body?.slots)}`);
  await page.reload();
  await page.locator('.ls-nine [data-slot="8"] .ls-nine__hit').waitFor();
  if ((await slotTitles(page)).join() !== finalTitles.join()) fail('[desktop] la grille relue après rechargement diffère');
  if ((await title.inputValue()) !== `Mes 9 de ${stamp}`) fail('[desktop] titre relu après rechargement');

  // 7. Générer l'image (carré, Papier, titres) → aperçu → télécharger un PNG.
  await page.click('[data-generate]');
  const info = await waitShareImage(page);
  if (info.width !== 1080 || info.height !== 1080) fail(`[desktop] image carrée : ${info.width} × ${info.height}`);
  if (!(info.bytes > 20_000)) fail(`[desktop] image trop petite : ${info.bytes} octets`);
  // Bac à sable : pas de vraie pochette (Deezer bloqué, albums de base sans pochette connue) → visuels générés.
  if (info.covers !== '0') console.log(`[desktop] image avec vraies pochettes (${info.covers})`);
  await shot(page, 'd-43-nine-share');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.ls-share__actions .btn--primary').click()]);
  if (!/^albummania-.*\.png$/.test(download.suggestedFilename())) fail(`[desktop] nom du fichier : ${download.suggestedFilename()}`);
  const file = path.join(OUT, 'd-nine.png');
  await download.saveAs(file);
  const dims = pngSize(fs.readFileSync(file));
  if (!dims || dims.width !== 1080 || dims.height !== 1080) fail(`[desktop] PNG téléchargé : ${JSON.stringify(dims)}`);
  await page.keyboard.press('Escape');

  // 8. Image d'une liste d'albums importés aux pochettes Deezer : CDN simulé (CORS permis) → vraies pochettes et
  // ligne « Pochettes : Deezer » ; CDN bloqué (le bac à sable) → visuels générés, l'export réussit quand même.
  const realList = (await must('liste importée', callAs(nina, 'POST', '/lists', {
    title: `Trouvailles ${stamp}`, ranked: false, itemType: 'album', visibility: 'public', items: imported.map((id) => ({ type: 'album', id })),
  }))).list;
  await ctx.route(/dzcdn\.net\/images\//, (route) => route.fulfill({ status: 200, body: GREEN, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' } }));
  await go(page, `/list/${realList.id}`, '[data-list-image]');
  await page.click('[data-list-image]');
  const real = await waitShareImage(page);
  if (real.covers !== '1') fail('[desktop] image de liste : les vraies pochettes (CORS permis) ne sont pas utilisées');
  if (!/Deezer/.test(await page.locator('.ls-share__meta').textContent())) fail('[desktop] attribution « Pochettes : Deezer » absente');
  await shot(page, 'd-50-share-real-covers');
  await page.keyboard.press('Escape');
  await ctx.unroute(/dzcdn\.net\/images\//);
  await ctx.route(/dzcdn\.net\/images\//, (route) => route.abort('blockedbyclient'));
  await page.reload();
  await page.click('[data-list-image]');
  const blocked = await waitShareImage(page);
  if (blocked.covers !== '0' || !(blocked.bytes > 10_000)) fail(`[desktop] CDN bloqué : ${JSON.stringify(blocked)}`);
  await page.keyboard.press('Escape');
  await ctx.unroute(/dzcdn\.net\/images\//);

  // 9. Supprimer une liste depuis l'éditeur.
  await go(page, `/list/${realList.id}/edit`, '.ls-editor__delete');
  await page.click('.ls-editor__delete');
  await page.locator('.ls-editor__foot button', { hasText: /Supprimer|Confirmer/ }).last().click();
  await page.waitForURL('**/lists');
  const gone = await callAs(nina, 'GET', `/lists/${realList.id}`);
  if (gone.status !== 404) fail(`[desktop] liste supprimée encore lisible : ${gone.status}`);
  await page.locator(`[data-list-id="${listId}"]`).waitFor();
  await shot(page, 'd-12-lists-mine');
  await checkNoHorizontalScroll(page, 'desktop lists');
});

// Lecture par un ami, liste privée introuvable (ordinateur).
if (FOCUS.has('desktop')) await session('desktop-friend', VIEWPORTS.desktop, omar, async (page) => {
  await go(page, `/u/${enc(nina.username)}/nine`, '[data-nine-read] a.nine__slot');
  if ((await page.locator('[data-nine-read] a.nine__slot').count()) !== 9) fail('[desktop-friend] la grille lue n’a pas 9 pochettes');
  if (!(await page.locator('[data-nine-read] .ls-nine-read__title', { hasText: `Mes 9 de ${stamp}` }).count())) fail('[desktop-friend] titre de la grille');
  await page.locator('[data-nine-read] .ls-nine-head__side a[href="/nine"]').waitFor();
  await shot(page, 'd-60-nine-read');
  await go(page, `/list/${zoePrivate.id}`, '.ls-page .empty-state');
  await shot(page, 'd-61-list-gone');
});

// ---------- moteur d'images (ordinateur, modules du site chargés par Vite) ----------

// CDN de pochettes simulé par un vrai serveur d'une autre origine (127.0.0.1 ≠ localhost) : une réponse servie par
// Playwright (route.fulfill) reçoit toujours un en-tête CORS ajouté par Playwright, elle ne peut donc pas imiter un CDN
// qui n'en envoie pas.
async function coverCdn() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/cors/')) res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' }).end(GREEN);
    else if (req.url.startsWith('/nocors/')) res.writeHead(200, { 'content-type': 'image/png' }).end(GREEN);
    else res.writeHead(404, { 'content-type': 'text/plain' }).end('non');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

if (FOCUS.has('engine')) {
  const cdn = await coverCdn();
  EXPECTED_CONSOLE.push(cdn.origin);
  await session('engine', VIEWPORTS.desktop, nina, async (page, ctx) => {
    await ctx.route(`${BASE}/e2e-cover.png`, (route) => route.fulfill({ status: 200, body: GREEN, headers: { 'content-type': 'image/png' } }));
    const cases = [
      ['même origine', `${BASE}/e2e-cover.png`, true],
      ['autre origine, CORS', `${cdn.origin}/cors/a.png`, true],
      ['autre origine, sans CORS', `${cdn.origin}/nocors/a.png`, false],
      ['introuvable', `${cdn.origin}/missing/a.png`, false],
    ];
    for (const [label, src, real] of cases) {
      const res = await page.evaluate(async ({ src }) => {
        const { renderImage } = await import('/src/share/renderImage.js');
        const covers = { items: { discovery: { cover: src, provider: 'deezer' } }, broken: new Set() };
        const spec = { format: 'square', theme: 'ink', title: 'Essai', tiles: [{ albumId: 'discovery' }, { albumId: 'thriller' }, null, { albumId: 'exodus' }], footer: 'AlbumMania' };
        const out = await renderImage(spec, { covers });
        const bmp = await createImageBitmap(out.blob);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        let green = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i + 1] > 235 && px[i] < 30 && px[i + 2] < 30) green++;
        return { usedCovers: out.usedCovers, width: out.width, height: out.height, size: out.blob.size, type: out.blob.type, green };
      }, { src });
      if (res.type !== 'image/png' || res.width !== 1080 || res.height !== 1080 || !(res.size > 10_000)) fail(`[engine] ${label} : export ${JSON.stringify(res)}`);
      if (res.usedCovers !== real) fail(`[engine] ${label} : usedCovers ${res.usedCovers}, attendu ${real}`);
      // Une vignette sur quatre est la pochette verte (≈ un quart de la grille) ; sinon aucun pixel vert pur.
      if (real && res.green < 40_000) fail(`[engine] ${label} : vraie pochette absente des pixels (${res.green})`);
      if (!real && res.green > 0) fail(`[engine] ${label} : pixels de la pochette refusée dessinés (${res.green})`);
    }
    // Pochette retirée par l'admin (coverBlocked) : visuel généré même si la pochette est connue.
    const blockedCover = await page.evaluate(async ({ src }) => {
      const { renderImage } = await import('/src/share/renderImage.js');
      const store = await import('/src/catalogStore.js');
      const album = store.getAlbum('discovery');
      const art = album.art;
      album.art = { ...art, coverBlocked: true };
      try {
        const out = await renderImage({ format: 'portrait', theme: 'ink', title: 'Essai', tiles: [{ albumId: 'discovery' }, { albumId: 'thriller' }] }, { covers: { items: { discovery: { cover: src } }, broken: new Set() } });
        return out.usedCovers;
      } finally {
        album.art = art;
      }
    }, { src: `${BASE}/e2e-cover.png` });
    if (blockedCover !== false) fail('[engine] pochette retirée par l’admin dessinée quand même');
    // SHARE_COVERS=off (realCovers: false) : jamais de vraie pochette ; formats et thèmes.
    for (const [format, theme, w, h] of [['portrait', 'ink', 1080, 1350], ['story', 'ivory', 1080, 1920], ['square', 'ivory', 1080, 1080]]) {
      const res = await page.evaluate(async ({ src, format, theme }) => {
        const { renderImage } = await import('/src/share/renderImage.js');
        const tiles = ['discovery', 'abbey-road', 'thriller', 'nevermind', 'back-to-black', 'kind-of-blue', 'random-access-memories', 'moon-safari', 'exodus']
          .map((albumId, i) => (i % 2 ? { albumId, label: 'Titre', sub: 'Artiste' } : { albumId }));
        const out = await renderImage({ format, theme, title: 'Mes 9 albums', subtitle: '@nina', tiles, footer: 'AlbumMania' },
          { covers: { items: { discovery: { cover: src } }, broken: new Set() }, realCovers: false });
        return { usedCovers: out.usedCovers, width: out.width, height: out.height, size: out.blob.size };
      }, { src: `${BASE}/e2e-cover.png`, format, theme });
      if (res.usedCovers || res.width !== w || res.height !== h) fail(`[engine] ${format}/${theme} : ${JSON.stringify(res)}`);
    }
    // Spécification invalide : seule erreur possible.
    const invalid = await page.evaluate(async () => {
      const { renderImage } = await import('/src/share/renderImage.js');
      try {
        await renderImage({ tiles: [] });
        return 'résolue';
      } catch (err) {
        return err.code;
      }
  });
  if (invalid !== 'invalid_spec') fail(`[engine] spécification vide : ${invalid}`);
  });
  await cdn.close();
}

// ---------- téléphone ----------

if (FOCUS.has('phone')) await session('phone', VIEWPORTS.phone, nino, async (page) => {
  // 1. Listes (Amis : la liste d'Omar), sans défilement horizontal.
  await go(page, '/lists?tab=friends', `[data-list-id="${omarList.id}"]`);
  await shot(page, 'm-10-lists');
  await checkNoHorizontalScroll(page, 'phone lists');
  await checkFits(page, 'phone lists', '.list-card, .ls-tabs, .page-head .btn');
  // 2. Page de la liste d'Omar (rangs, notes), puis une liste créée sur le téléphone.
  await page.locator(`[data-list-id="${omarList.id}"]`).click();
  await page.locator('.ls-items--ranked .ls-item').first().waitFor();
  await shot(page, 'm-20-list-page');
  await checkNoHorizontalScroll(page, 'phone list page');
  await checkFits(page, 'phone list page', '.ls-head, .ls-item, .ls-item__add, .ls-head__actions > *');
  await go(page, '/lists/new', '[data-list-title]');
  await page.fill('[data-list-title]', `Pour le bus ${stamp}`);
  const search = page.locator('.ls-editor__search');
  await pickFromSearch(page, search, 'nevermind', 'Nirvana');
  await pickFromSearch(page, search, 'exodus', 'Bob Marley');
  await page.locator('.ls-rows .ls-row').nth(1).waitFor();
  // Pas de capture « pleine page » ici : elle remet l'émulation du pointeur à « souris » (Playwright).
  await page.locator('.ls-rows').scrollIntoViewIfNeeded();
  await shot(page, 'm-21-list-editor');
  await checkNoHorizontalScroll(page, 'phone list editor');
  await checkFits(page, 'phone list editor', '.ls-row, .ls-row__btn--remove, .ls-editor__foot .btn, .ls-editor__meta');
  await page.click('[data-save-list]');
  await page.waitForURL(/\/list\/\d+$/);
  await page.locator('.ls-items .ls-item').nth(1).waitFor();

  // 3. « Mes 9 albums » au doigt : 9 cases par la recherche, échange aux boutons ← →, titres.
  await go(page, '/nine', '[data-nine-editor] .ls-nine');
  await shot(page, 'm-30-nine-empty');
  await checkNoHorizontalScroll(page, 'phone nine');
  for (let i = 0; i < 9; i++) await fillSlot(page, i, NINE[i]);
  const titles = await slotTitles(page);
  // Toucher une case pleine : la fenêtre propose « Retirer » et « Déplacer » (→ : échange avec la case 5).
  await page.locator('.ls-nine [data-slot="3"] .ls-nine__hit').click();
  await page.locator('[data-nine-picker]').waitFor();
  await page.waitForTimeout(150);
  await shot(page, 'm-34-nine-slot-dialog');
  await page.locator('.ls-picker__move [data-move="right"]').click();
  await page.locator('[data-nine-picker]').waitFor({ state: 'detached' });
  const next = await slotTitles(page);
  if (next[4] !== titles[3] || next[3] !== titles[4]) fail(`[phone] « Déplacer → » de la case 4 : ${titles} → ${next}`);
  await page.locator('.nine__tools .ls-nine-titles').click();
  await waitSaved(page);
  await page.locator('.nine__tools').scrollIntoViewIfNeeded();
  await shot(page, 'm-31-nine-full');
  await checkNoHorizontalScroll(page, 'phone nine full');
  await checkFits(page, 'phone nine full', '.nine__desk, .ls-nine .nine__slot, .nine__tools .seg, [data-generate]');
  // 4. Générer → Partager sans partage de fichier (navigateur sans Web Share) → appui long.
  await page.click('[data-generate]');
  const info = await waitShareImage(page);
  if (info.width !== 1080 || info.height !== 1350) fail(`[phone] image 4:5 : ${info.width} × ${info.height}`);
  await shot(page, 'm-32-nine-share');
  // Partage du fichier PNG par la feuille du système (Web Share avec fichiers).
  await page.locator('.ls-share__actions .btn--ghost').click();
  await page.waitForFunction(() => window.__shared.length > 0);
  const shared = (await page.evaluate(() => window.__shared))[0];
  if (shared.files !== 1 || shared.type !== 'image/png' || !/^albummania-.*\.png$/.test(shared.name) || !(shared.size > 20_000)) fail(`[phone] fichier partagé : ${JSON.stringify(shared)}`);
  // Sans partage de fichier : l'image en grand, à enregistrer par un appui long.
  await page.evaluate(() => {
    window.__noShare = true;
  });
  await page.locator('.ls-share__actions .btn--ghost').click();
  await page.locator('.ls-share__save .ls-share__full').waitFor();
  const hint = await page.locator('.ls-share__hint').textContent();
  if (!/Appuie longuement/.test(hint)) fail(`[phone] consigne d’enregistrement : « ${hint} »`);
  await shot(page, 'm-33-nine-longpress');
  await checkNoHorizontalScroll(page, 'phone share');
  await checkFits(page, 'phone share', '.modal, .ls-share__full');
  await page.locator('.ls-share__save .btn--ghost').click();
  await page.keyboard.press('Escape');
  // 5. Lecture de la grille d'Omar.
  await go(page, `/u/${enc(omar.username)}/nine`, '[data-nine-read] a.nine__slot');
  await shot(page, 'm-40-nine-read');
  await checkNoHorizontalScroll(page, 'phone nine read');
  await checkFits(page, 'phone nine read', '.ls-nine-read__body, .ls-nine .nine__slot, .ls-nine-head__side > *');
}, { touch: true });

// ---------- démo autonome ----------

const demoFile = path.join(ROOT, 'dist-demo/albummania-demo.html');
if (FOCUS.has('demo') && fs.existsSync(demoFile)) {
  const b = await launch();
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const phone = name === 'phone';
    // Écran tactile sans isMobile : la page de la démo n'a pas de balise viewport (elle est publiée dans une page
    // hôte qui l'apporte), et isMobile la mettrait en page sur 980 px.
    const ctx = await b.newContext({ viewport, locale: 'fr-FR', ...(phone && { hasTouch: true }) });
    await routeFonts(ctx);
    const page = await ctx.newPage();
    const label = `demo-${name}`;
    const p = phone ? 'm' : 'd';
    page.on('pageerror', (e) => fail(`[${label}] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${label}] console: ${m.text()}`));
    try {
      await page.goto(`file://${demoFile}`);
      await page.waitForSelector('.auth__form', { timeout: 20_000 });
      await page.getByText(/Créer un compte/).first().click();
      await page.waitForSelector('#su-email');
      await page.fill('#su-email', `demo_c_${name}@example.com`);
      await page.fill('#su-user', `democ_${name}`);
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
      // Recherche globale : une liste d'un joueur fictif → sa page (rangs, notes, J'aime, commentaires des bots).
      if (phone) {
        await page.locator('.search-trigger').first().click();
        await page.locator('.search-sheet input').fill('trajets');
      } else {
        await page.locator('header .gsearch__input').first().fill('trajets');
      }
      const option = page.locator('[role="option"]', { hasText: /trajets/i }).first();
      await option.waitFor({ timeout: 15_000 });
      await option.click();
      await page.locator('[data-list-page] .ls-items .ls-item').first().waitFor({ timeout: 15_000 });
      await page.locator('.ls-comments .comment').first().waitFor({ timeout: 15_000 });
      await page.screenshot({ path: `${OUT}/${p}-80-demo-list.png` });
      if (phone) await checkNoHorizontalScroll(page, `${label} list`);
      // Image de la liste : dans la démo (pas de téléchargement), l'image en grand avec la consigne d'appui long.
      await page.click('[data-list-image]');
      await page.locator('img[data-share-image]:not(.is-stale)').waitFor({ timeout: 30_000 });
      await page.locator('.ls-share__actions .btn--primary').click();
      await page.locator('.ls-share__save .ls-share__full').waitFor();
      const hint = await page.locator('.ls-share__hint').textContent();
      if (phone && !/Appuie longuement/.test(hint)) fail(`[${label}] consigne d’appui long absente : « ${hint} »`);
      await page.screenshot({ path: `${OUT}/${p}-81-demo-longpress.png` });
      await page.locator('.ls-share__save .btn--ghost').click();
      await page.keyboard.press('Escape');
      // Toutes les listes : onglet Populaires (listes des joueurs fictifs), puis « Mes 9 albums ».
      await page.locator('.ls-page .ls-back, .ls-page a', { hasText: 'Listes' }).first().click();
      await page.locator('[data-grid9-card]').waitFor();
      await page.locator('.ls-tabs .tabs__tab').nth(2).click();
      await page.locator('.ls-cards .list-card').nth(1).waitFor({ timeout: 15_000 });
      await page.screenshot({ path: `${OUT}/${p}-82-demo-lists.png` });
      await page.locator('[data-grid9-card]').click();
      await page.locator('[data-nine-editor] .ls-nine [data-slot="0"]').waitFor();
      await fillSlot(page, 0, NINE[0]);
      await fillSlot(page, 1, NINE[1]);
      await page.screenshot({ path: `${OUT}/${p}-83-demo-nine.png` });
      if (phone) await checkNoHorizontalScroll(page, `${label} nine`);
    } catch (err) {
      await page.screenshot({ path: `${OUT}/zz-error-${label}.png` }).catch(() => {});
      fail(`[${label}] ${err.message}`);
    } finally {
      await ctx.close();
    }
  }
} else if (FOCUS.has('demo')) {
  console.log('Démo absente (npm run build:demo) : partie démo sautée.');
}

db.close();
await finish('Parcours P1-C sans erreur.');
if (stack) await stack.stop();
