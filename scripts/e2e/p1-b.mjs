// Parcours P1-B (PLAN.md 9.4, 8.2 P1.2, 2.5) : Studio, coquille et pages objet ; ordinateur 1440 × 900 et
// téléphone 390 × 844.
//   - Studio (le sien) : en-tête (avatar et son cadre, bio, niveau, « N amis »), onglets Vue d'ensemble · Critiques ·
//     Listes · Vinyles · Badges · Posts, blocs dans l'ordre par défaut de 2.5 ; éditeur : bio et confidentialité,
//     un bloc masqué et un bloc remonté (ordre relu après rechargement), artiste et morceau favoris (recherche), vinyle
//     mis en avant, cadre cosmétique (un cosmétique d'un niveau trop haut reste verrouillé) ; onglets Vinyles et
//     Critiques ; photo de profil « pochette d'un album complété » (vraie pochette, DESIGN-OVERRIDE point 5).
//   - Studio d'un autre : public (blocs, « Comparer nos goûts », menu ⋯), « amis » vu par un inconnu (en-tête seul,
//     message, pas d'onglets), vu par un ami (tout), « privé » vu par l'ami (en-tête seul) ; bloqué : introuvable.
//   - Page d'album : ordre de 2.5 (en-tête et actions Rechercher · Ajouter à une liste · Partager, ligne de
//     complétion, tracklist, notes et critiques, discussions, statistiques, similaires, « Autour de l'album ») ; pages
//     morceau et artiste avec leurs blocs (liste, discussions, duels).
//   - Amis : onglets Amis · Demandes · Suggestions, recherche de membres (carte du membre choisi et son menu ⋯),
//     Taste Match sur les lignes ; menu du compte : Quêtes et Badges ; Paramètres : confidentialité du Studio.
//   - Accueil d'un nouveau joueur : une seule redirection vers /welcome par session, jamais depuis les pages légales
//     ni les Paramètres.
//   - Démo autonome (dist-demo/albummania-demo.html) : Studios des joueurs fictifs (bio, blocs, vinyle mis en avant),
//     Studio réservé aux amis, éditeur de son Studio.
//   Zéro erreur de console (hors images Deezer bloquées par le bac à sable), pas de défilement horizontal.
//   BASE=http://localhost:5112 DATABASE_FILE=/tmp/am-p1-b/am.db OUT=/tmp/am-p1-b/shots node scripts/e2e/p1-b.mjs
//   (sans BASE : démarre sa propre copie sur 3112 / 5112 avec une copie neuve de $FIXTURE dans /tmp/am-p1-b/am.db)
//   FOCUS=desktop,phone,onboarding,demo : ne joue que ces parties (développement).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, run, shot, fail, finish, setBase, startStack, checkNoHorizontalScroll,
  launch, routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p1-b', apiPort: 3112, webPort: 5112, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const FOCUS = new Set((process.env.FOCUS || 'desktop,phone,onboarding,demo').split(',').map((s) => s.trim()));
const stamp = Date.now().toString(36).slice(-5);
const enc = encodeURIComponent;
const DEFAULT_BLOCKS = ['nine', 'showcase', 'vinyls', 'trophies', 'wishlist', 'artists', 'tracks', 'reviews', 'lists', 'recent', 'activity', 'stats'];
// Album court de la graine : deux boosters d'album le complètent (vinyle, photo de profil, page d'album complète).
const SHORT_ALBUM = 'kind-of-blue';

// ---------- joueurs (créés dans la base du site visé, avec une session) ----------

const DB_FILE = process.env.DATABASE_FILE || '/tmp/am-p1-b/am.db';
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA busy_timeout = 5000');
const { config } = await import('../../server/config.js');

/** Joueur vérifié (CGU acceptées) avec une session ; { id, username, token, cookie } ; `onboarded: false` = nouveau. */
function seedUser(username, { onboarded = true, xp = 0 } = {}) {
  const now = Date.now();
  const { id } = db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at,
      terms_accepted_at, terms_version, onboarded_at, bonus_packs, royalties, xp) VALUES (?, ?, 'x', ?, ?, ?, ?, ?, ?, 0, 0, ?) RETURNING id`)
    .get(`${username}@example.com`, username, now - 3 * 86_400_000, now, now - 3 * 86_400_000, now, config.termsVersion, onboarded ? now : null, xp);
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(crypto.createHash('sha256').update(token).digest('hex'), id, now, now + 86_400_000);
  return { id, username, token, cookie: `albummania_sid=${token}` };
}

/**
 * Joueur inscrit par l'API (inscription, e-mail de la boîte de test, confirmation) : il passe par le bus d'événements,
 * donc par l'index de la recherche des membres ; { id, username, token, cookie }.
 */
async function signupUser(username) {
  const headers = { 'X-AlbumMania': '1', 'Content-Type': 'application/json' };
  const email = `${username}@example.com`;
  const res = await fetch(`${BASE}/api/auth/signup`, { method: 'POST', headers, body: JSON.stringify({ email, username, password: 'motdepasse123', acceptTerms: true, age15: true }) });
  if (res.status !== 201) throw new Error(`inscription de ${username} : ${res.status}`);
  const mails = await (await fetch(`${BASE}/api/dev/emails`)).json();
  const token = /token=([\w-]+)/.exec(mails.find((m) => m.to === email).text)[1];
  const verify = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers, body: JSON.stringify({ token, password: 'motdepasse123' }) });
  const sid = /albummania_sid=([^;]+)/.exec(verify.headers.get('set-cookie') || '')?.[1];
  if (verify.status !== 200 || !sid) throw new Error(`confirmation de ${username} : ${verify.status}`);
  const user = (await verify.json()).user;
  db.prepare('UPDATE users SET onboarded_at = ? WHERE id = ?').run(Date.now(), user.id);
  return { id: user.id, username, token: sid, cookie: `albummania_sid=${sid}` };
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

/** Une collection pour que le Studio ait du contenu : boosters ouverts, un album court complété (vinyle). */
async function collect(user, { packs = 8, complete = true } = {}) {
  db.prepare('UPDATE users SET bonus_packs = bonus_packs + ?, royalties = royalties + 3000 WHERE id = ?').run(packs, user.id);
  for (let i = 0; i < packs; i++) await must('booster', callAs(user, 'POST', '/packs/open', { count: 1 }));
  if (!complete) return;
  for (let i = 0; i < 4; i++) {
    const r = await must('booster d’album', callAs(user, 'POST', '/packs/album', { albumId: SHORT_ALBUM }));
    if (r?.state?.user && (await callAs(user, 'GET', `/albums/${SHORT_ALBUM}/completion`)).body?.mine) break;
  }
}

/** Session du joueur dans le contexte du navigateur. */
const signIn = (ctx, user) => ctx.addCookies([{ name: 'albummania_sid', value: user.token, url: BASE }]);

/** Ordre dans la page : chaque sélecteur présent, et chacun après le précédent. */
async function inOrder(page, selectors) {
  return page.evaluate((list) => {
    const els = list.map((s) => document.querySelector(s));
    const missing = list.filter((_, i) => !els[i]);
    if (missing.length) return { ok: false, missing };
    for (let i = 1; i < els.length; i++) {
      if (!(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) return { ok: false, swapped: [list[i - 1], list[i]] };
    }
    return { ok: true };
  }, selectors);
}

const blocksShown = (page) => page.locator('[data-studio-blocks]').getAttribute('data-studio-blocks');

// Joueurs : un par fenêtre pour son propre Studio, un ami commun, un inconnu, un joueur qui bloque.
const people = {};
if (FOCUS.has('desktop') || FOCUS.has('phone')) {
  people.desktop = seedUser(`anais_${stamp}`, { xp: 5200 });
  people.phone = seedUser(`arno_${stamp}`, { xp: 5200 });
  people.friend = seedUser(`basile_${stamp}`, { xp: 900 });
  people.stranger = await signupUser(`cyrielle_${stamp}`);
  people.blocker = seedUser(`dorian_${stamp}`);
  await collect(people.desktop);
  await collect(people.phone);
  await collect(people.friend, { packs: 4, complete: false });
  await befriend(people.desktop, people.friend);
  await befriend(people.phone, people.friend);
  // Le bloqueur bloque le joueur du téléphone : chacun disparaît pour l'autre.
  await must('blocage', callAs(people.blocker, 'PUT', `/blocks/${people.phone.id}`));
  // L'ami a noté et critiqué l'album court (notes des amis sur la page d'album).
  await must('note de l’ami', callAs(people.friend, 'PUT', `/ratings/album/${SHORT_ALBUM}`, { score: 9, review: 'Un disque parfait pour finir la journée, So What en boucle.' }));
}

// ---------- son Studio, puis celui des autres (ordinateur et téléphone) ----------

for (const [v, viewport] of Object.entries(VIEWPORTS)) {
  if (!FOCUS.has(v)) continue;
  const p = v === 'desktop' ? 'd' : 'm';
  const me = people[v];

  await run(`${v}-studio`, viewport, async (page, ctx) => {
    await signIn(ctx, me);
    await page.goto(`${BASE}/studio`);
    await page.waitForSelector('[data-studio-head]');
    await page.waitForSelector('[data-studio-blocks]');
    await page.waitForTimeout(600);
    // Blocs par défaut dans l'ordre de 2.5 (les blocs vides des autres restent affichés pour soi).
    const initial = (await blocksShown(page)).split(',');
    if (initial.join() !== DEFAULT_BLOCKS.join()) fail(`[${v}] blocs par défaut : ${initial.join()}`);
    const tabs = await page.locator('.st-tabs .tabs__tab').allInnerTexts();
    if (tabs.map((s) => s.trim()).join('|') !== 'Vue d’ensemble|Critiques|Listes|Vinyles|Badges|Posts') fail(`[${v}] onglets du Studio : ${tabs.join('|')}`);
    await shot(page, `${p}-01-studio-top`);
    await shot(page, `${p}-02-studio-full`, { fullPage: true });
    await checkNoHorizontalScroll(page, `${v} studio`);

    // Éditeur : bio et confidentialité « Amis ».
    await page.click('[data-studio-edit]');
    await page.waitForSelector('.st-editor #st-bio');
    await page.fill('#st-bio', 'Jazz modal et pochettes bleues. Je collectionne un album à la fois.');
    await page.locator('.st-editor [data-visibility="friends"]').click();
    await page.waitForTimeout(200);
    await shot(page, `${p}-03-editor-profile`);
    await page.click('.st-editor [data-studio-save]');
    await page.waitForSelector('.toast');

    // Blocs : « Derniers morceaux obtenus » masqué, la vinylthèque remontée au-dessus de la vitrine.
    await page.click('.st-editor [data-editor-tab="blocks"]');
    await page.waitForSelector('[data-block-row="recent"]');
    await page.locator('[data-block-row="recent"] [role="switch"]').click();
    await page.locator('[data-block-row="vinyls"] .st-blocklist__moves .icon-btn').first().click();
    await page.waitForTimeout(150);
    await shot(page, `${p}-04-editor-blocks`);
    await page.click('.st-editor [data-studio-save]');
    await page.waitForSelector('.toast');

    // Favoris : un artiste et un morceau par la recherche.
    await page.click('.st-editor [data-editor-tab="favorites"]');
    await page.waitForSelector('#st-fav-artist-input');
    await page.fill('#st-fav-artist-input', 'miles davis');
    const artistOpt = page.locator('[role="option"]', { hasText: /Miles Davis/i }).first();
    await artistOpt.waitFor({ timeout: 15_000 });
    await artistOpt.click();
    await page.waitForSelector('.st-fav__chip');
    await page.fill('#st-fav-track-input', 'so what');
    const trackOpt = page.locator('[role="option"]', { hasText: /So What/i }).first();
    await trackOpt.waitFor({ timeout: 15_000 });
    await trackOpt.click();
    await page.waitForSelector('.st-fav__track');
    await shot(page, `${p}-05-editor-favorites`);
    await page.click('.st-editor [data-studio-save]');
    await page.waitForSelector('.toast');

    // À la une : le vinyle de l'album complété.
    await page.click('.st-editor [data-editor-tab="spotlight"]');
    await page.waitForSelector('.st-vpicks');
    await page.locator('.st-vpick:not(.st-vpick--auto)').first().click();
    await page.click('.st-editor [data-studio-save]');
    await page.waitForSelector('.toast');

    // Cosmétiques : cadre « Ivoire » (niveau 3) ; « Néon » (niveau 20) reste verrouillé.
    await page.click('.st-editor [data-editor-tab="cosmetics"]');
    await page.waitForSelector('[data-cosmetic="frame:ivoire"]');
    if (!(await page.locator('[data-cosmetic="frame:neon"]').isDisabled())) fail(`[${v}] cadre « Néon » (niveau 20) devrait être verrouillé`);
    await page.click('[data-cosmetic="frame:ivoire"]');
    await page.waitForTimeout(150);
    await shot(page, `${p}-06-editor-cosmetics`);
    await page.click('.st-editor [data-studio-save]');
    await page.waitForSelector('.toast');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.st-editor', { state: 'detached' });

    // Relu après rechargement : bio, confidentialité, ordre des blocs, favoris, vinyle mis en avant, cadre.
    await page.reload();
    await page.waitForSelector('[data-studio-blocks]');
    await page.waitForSelector('.st-head__bio');
    const bio = await page.locator('.st-head__bio').innerText();
    if (!bio.includes('pochettes bleues')) fail(`[${v}] bio absente de l'en-tête : « ${bio} »`);
    if (!(await page.locator('.st-head__vis').count())) fail(`[${v}] mention « Studio réservé aux amis » absente`);
    const order = (await blocksShown(page)).split(',');
    if (order.includes('recent')) fail(`[${v}] le bloc masqué « recent » est encore affiché`);
    if (order.indexOf('vinyls') > order.indexOf('showcase')) fail(`[${v}] la vinylthèque devait passer avant la vitrine : ${order.join()}`);
    await page.waitForSelector('.st-artists__item', { timeout: 10_000 });
    await page.waitForSelector('[data-featured-vinyl]');
    if (!(await page.locator('[data-studio-head] .avatar.st-frame--ivoire').count())) fail(`[${v}] cadre « Ivoire » absent de l'avatar`);
    await page.locator('[data-studio-head]').scrollIntoViewIfNeeded();
    await shot(page, `${p}-07-studio-after-edit`);
    await page.locator('[data-block="vinyls"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, `${p}-08-studio-vinyls-block`);
    await checkNoHorizontalScroll(page, `${v} studio édité`);

    // Photo de profil : la pochette de l'album complété (vraie pochette quand elle est disponible).
    await page.locator('[data-studio-head] .profile-head__edit').click();
    await page.waitForSelector('.avatar-picker .cover-pick:not(.is-locked)');
    await page.locator('.avatar-picker .cover-pick:not(.is-locked)').first().click();
    await page.locator('.avatar-picker .modal__actions .btn--primary').click();
    await page.waitForSelector('.avatar-picker', { state: 'detached' });
    const avatar = await callAs(me, 'GET', `/users/${enc(me.username)}`);
    if (avatar.body?.avatar !== `album:${SHORT_ALBUM}`) fail(`[${v}] photo de profil « pochette » non enregistrée : ${avatar.body?.avatar}`);
    if (!(await page.locator('[data-studio-head] .avatar img, [data-studio-head] .avatar .cover').count())) fail(`[${v}] la photo de profil ne montre pas la pochette`);

    // Onglets Vinyles et Critiques.
    await page.locator('[data-studio-tab-link="vinyls"]').click();
    await page.waitForSelector('[data-studio-tab="vinyls"] .vinyl-item');
    if (!page.url().endsWith('/studio/vinyls')) fail(`[${v}] l'onglet Vinyles devrait être dans l'adresse : ${page.url()}`);
    await shot(page, `${p}-09-tab-vinyls`);
    await page.locator('[data-studio-tab-link="reviews"]').click();
    await page.waitForSelector('[data-studio-tab="reviews"]');
    await page.waitForTimeout(500);
    await shot(page, `${p}-10-tab-reviews`);
    await page.locator('[data-studio-tab-link="badges"]').click();
    await page.waitForSelector('[data-studio-tab="badges"]');
    await page.waitForTimeout(500);
    await shot(page, `${p}-11-tab-badges`);
    await checkNoHorizontalScroll(page, `${v} onglets`);

    // Menu du compte : Quêtes et Badges.
    await page.locator('.account__btn').click();
    await page.waitForSelector('.sh-menu');
    await page.waitForTimeout(400);
    for (const href of ['/quests', '/badges', '/settings']) {
      if (!(await page.locator(`.sh-menu a[href="${href}"]`).count())) fail(`[${v}] menu du compte : lien ${href} absent`);
    }
    await shot(page, `${p}-12-account-menu`);
    await page.keyboard.press('Escape');

    // Paramètres : confidentialité du Studio (même réglage que l'éditeur), remise à « Public ».
    await page.goto(`${BASE}/settings`);
    await page.waitForSelector('[data-studio-privacy="friends"]');
    await page.locator('[data-studio-privacy] [data-visibility="public"]').click();
    await page.waitForSelector('[data-studio-privacy="public"]');
    await page.locator('[data-studio-privacy]').scrollIntoViewIfNeeded();
    await shot(page, `${p}-13-settings-privacy`);
    const vis = (await callAs(me, 'GET', '/me/profile')).body?.visibility;
    if (vis !== 'public') fail(`[${v}] confidentialité après les Paramètres : ${vis}`);
  });

  // ---------- Studio d'un autre : public, amis, privé, bloqué ----------
  await run(`${v}-others`, viewport, async (page, ctx) => {
    const { friend, stranger, blocker } = people;
    // Public, vu par l'ami : blocs, « Comparer nos goûts », menu ⋯.
    await signIn(ctx, friend);
    await page.goto(`${BASE}/u/${enc(me.username)}`);
    await page.waitForSelector('[data-studio-blocks]');
    if (await page.locator('[data-studio-edit]').count()) fail(`[${v}] « Modifier le Studio » visible sur le Studio d'un autre`);
    if (!(await page.locator('[data-studio-head] .sf-menu__btn').count())) fail(`[${v}] menu ⋯ Signaler / Bloquer absent du Studio d'un autre`);
    await page.waitForTimeout(500);
    await shot(page, `${p}-20-other-public`);
    await checkNoHorizontalScroll(page, `${v} studio d'un autre`);

    // « Amis » : l'inconnu ne voit que l'en-tête, l'ami voit tout.
    await must('studio amis', callAs(me, 'PUT', '/me/profile', { visibility: 'friends' }));
    await page.reload();
    await page.waitForSelector('[data-access="full"] [data-studio-blocks]');
    await ctx.clearCookies();
    await signIn(ctx, stranger);
    await page.goto(`${BASE}/u/${enc(me.username)}`);
    await page.waitForSelector('[data-access="header"] [data-studio-restricted="friends"]');
    if (await page.locator('.st-tabs').count()) fail(`[${v}] onglets visibles sur un Studio réservé aux amis`);
    if (await page.locator('[data-studio-blocks]').count()) fail(`[${v}] blocs visibles sur un Studio réservé aux amis`);
    const api = await callAs(stranger, 'GET', `/users/${enc(me.username)}`);
    if (api.body?.access !== 'header' || api.body?.vinyls?.length || api.body?.showcase?.length) fail(`[${v}] l'API montre trop d'un Studio « amis » : ${JSON.stringify(api.body).slice(0, 160)}`);
    await shot(page, `${p}-21-other-friends-only`);

    // « Privé » : même l'ami ne voit que l'en-tête.
    await must('studio privé', callAs(me, 'PUT', '/me/profile', { visibility: 'private' }));
    await ctx.clearCookies();
    await signIn(ctx, friend);
    await page.goto(`${BASE}/u/${enc(me.username)}`);
    await page.waitForSelector('[data-access="header"] [data-studio-restricted="private"]');
    await shot(page, `${p}-22-other-private`);
    await must('studio public', callAs(me, 'PUT', '/me/profile', { visibility: 'public' }));

    // Bloqué : le Studio est introuvable (le bloqueur a bloqué le joueur du téléphone).
    // Fenêtre à part : le 404 de l'API (attendu) y est la seule erreur tolérée.
    if (v === 'phone') {
      const blocked = await (await launch()).newContext({ viewport, locale: 'fr-FR' });
      await routeFonts(blocked);
      await blocked.addCookies([{ name: 'albummania_sid', value: blocker.token, url: BASE }]);
      const bp = await blocked.newPage();
      bp.on('pageerror', (e) => fail(`[${v} bloqué] ${e.message}`));
      bp.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && !/status of 404/.test(m.text()) && fail(`[${v} bloqué] console: ${m.text()}`));
      await bp.goto(`${BASE}/u/${enc(me.username)}`);
      await bp.waitForSelector('.empty-page');
      if (await bp.locator('[data-studio-head]').count()) fail(`[${v}] Studio d'un joueur bloqué affiché`);
      await bp.screenshot({ path: `${OUT}/${p}-22b-blocked.png` });
      await blocked.close();
      const api = await callAs(blocker, 'GET', `/users/${enc(me.username)}`);
      if (api.status !== 404) fail(`[${v}] Studio d'un joueur bloqué : ${api.status} au lieu de 404`);
    }

    // Amis : onglets, Taste Match sur les lignes, recherche d'un membre et sa carte (menu ⋯).
    await ctx.clearCookies();
    await signIn(ctx, me);
    await page.goto(`${BASE}/friends`);
    await page.waitForSelector('[data-friends-tab="suggestions"]');
    const ftabs = await page.locator('.st-friends-tabs .tabs__tab').count();
    if (ftabs !== 3) fail(`[${v}] onglets Amis · Demandes · Suggestions : ${ftabs}`);
    await page.waitForSelector('[data-friends-panel="friends"] .friend');
    await page.waitForTimeout(800);
    await shot(page, `${p}-23-friends`);
    await page.fill('#friend-search-input', stranger.username.slice(0, 7));
    const opt = page.locator('[role="option"]', { hasText: stranger.username }).first();
    await opt.waitFor({ timeout: 15_000 });
    await opt.click();
    await page.waitForSelector('.gs-friend-pick .sf-menu__btn');
    await shot(page, `${p}-24-friends-picked`);
    await page.click('[data-friends-tab="suggestions"]');
    await page.waitForSelector('[data-friends-panel="suggestions"]');
    await page.waitForTimeout(800);
    await shot(page, `${p}-25-friends-suggestions`);
    await page.click('[data-friends-tab="requests"]');
    await page.waitForSelector('[data-friends-panel="requests"]');
    await checkNoHorizontalScroll(page, `${v} amis`);
  });

  // ---------- pages objet : album (ordre de 2.5), morceau, artiste ----------
  await run(`${v}-objects`, viewport, async (page, ctx) => {
    await signIn(ctx, me);
    await page.goto(`${BASE}/album/${SHORT_ALBUM}`);
    await page.waitForSelector('.album-head');
    await page.waitForSelector('.tracklist');
    await page.waitForSelector('#critiques:not([aria-busy])');
    await page.waitForSelector('[data-discussions]');
    await page.waitForSelector('[data-album="rankings"]');
    await page.waitForSelector('.ls-album-lists');
    await page.waitForTimeout(600);
    const order = await inOrder(page, [
      '.album-head', '.album-head .gm-completion', '.album-head [data-add-to-list]', '.tracklist', '#critiques',
      '[data-album="discussions"]', '[data-album="stats"]', '[data-album="similar"]', '[data-album="around"]',
    ]);
    if (!order.ok) fail(`[${v}] ordre de la page d'album : ${JSON.stringify(order)}`);
    if (!(await page.locator('.album-head .st-album-share').count())) fail(`[${v}] « Partager » absent d'un album complété`);
    await shot(page, `${p}-30-album-top`);
    await shot(page, `${p}-31-album-full`, { fullPage: true });
    await checkNoHorizontalScroll(page, `${v} album`);
    // Album en cours : « Rechercher » (liste d'envies) dans les actions, pas de « Partager ».
    await page.goto(`${BASE}/album/discovery`);
    await page.waitForSelector('.album-head .gm-wish');
    await page.waitForSelector('.tracklist');
    if (await page.locator('.album-head .st-album-share').count()) fail(`[${v}] « Partager » sur un album pas encore complété`);
    const actions = await inOrder(page, ['.album-head .gm-wish', '.album-head [data-add-to-list]', '.album-booster', '.tracklist']);
    if (!actions.ok) fail(`[${v}] actions de l'album en cours : ${JSON.stringify(actions)}`);
    await page.waitForTimeout(400);
    await shot(page, `${p}-30b-album-progress`);
    await page.goto(`${BASE}/album/${SHORT_ALBUM}`);
    await page.waitForSelector('.tracklist');

    // Page morceau : « Ajouter à une liste », discussions, duel « Meilleur morceau de l'album ».
    await page.locator('.tracklist .tracklist__title').first().click();
    await page.waitForSelector('.trk-head');
    await page.waitForSelector('[data-track="discussions"] [data-discussions]');
    if (!(await page.locator('.trk-head [data-add-to-list]').count())) fail(`[${v}] « Ajouter à une liste » absent de la page morceau`);
    if (!(await page.locator('[data-track="battle"]').count())) fail(`[${v}] duel « Meilleur morceau » absent de la page morceau`);
    await page.waitForTimeout(400);
    await shot(page, `${p}-32-track-full`, { fullPage: true });
    await checkNoHorizontalScroll(page, `${v} morceau`);

    // Page artiste : discussions (et duel quand l'artiste a deux albums).
    await page.goto(`${BASE}/artist/daft-punk`);
    await page.waitForSelector('[data-artist="discussions"] [data-discussions]');
    if (!(await page.locator('[data-artist="battle"]').count())) fail(`[${v}] duel « Meilleur album de Daft Punk » absent`);
    await page.locator('[data-artist="battle"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, `${p}-33-artist-blocks`);
    await checkNoHorizontalScroll(page, `${v} artiste`);
  });
}

// ---------- accueil d'un nouveau joueur : une redirection par session, jamais depuis les pages légales ----------

if (FOCUS.has('onboarding')) {
  await run('onboarding-redirect', VIEWPORTS.desktop, async (page, ctx) => {
    const fresh = seedUser(`nouveau_${stamp}`, { onboarded: false });
    await signIn(ctx, fresh);
    // Pages légales et Paramètres : jamais de redirection.
    await page.goto(`${BASE}/legal/terms`);
    await page.waitForTimeout(1500);
    if (!page.url().includes('/legal/terms')) fail(`[onboarding] redirection depuis une page légale : ${page.url()}`);
    await page.goto(`${BASE}/settings`);
    await page.waitForTimeout(1500);
    if (!page.url().includes('/settings')) fail(`[onboarding] redirection depuis les Paramètres : ${page.url()}`);
    // Première page du jeu : une redirection vers /welcome.
    await page.goto(`${BASE}/collection`);
    await page.waitForURL('**/welcome', { timeout: 10_000 });
    await page.waitForTimeout(800);
    await shot(page, 'o-01-welcome');
    // Le joueur passe l'accueil : plus aucune redirection dans la session (même après rechargement).
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.hero');
    await page.waitForTimeout(1500);
    if (!page.url().endsWith('/')) fail(`[onboarding] seconde redirection : ${page.url()}`);
    await page.goto(`${BASE}/collection`);
    await page.waitForTimeout(1500);
    if (page.url().includes('/welcome')) fail('[onboarding] redirection répétée dans la même session');
    // Un joueur qui a déjà fait l'accueil n'est jamais redirigé.
    const done = seedUser(`ancien_${stamp}`);
    const other = await ctx.browser().newContext({ viewport: VIEWPORTS.desktop, locale: 'fr-FR' });
    await routeFonts(other);
    await other.addCookies([{ name: 'albummania_sid', value: done.token, url: BASE }]);
    const p2 = await other.newPage();
    p2.on('pageerror', (e) => fail(`[onboarding] ${e.message}`));
    await p2.goto(`${BASE}/collection`);
    await p2.waitForTimeout(1500);
    if (p2.url().includes('/welcome')) fail('[onboarding] joueur déjà accueilli redirigé');
    await other.close();
  });
}

// ---------- démo autonome ----------

const demoFile = path.join(ROOT, 'dist-demo/albummania-demo.html');
if (FOCUS.has('demo') && fs.existsSync(demoFile)) {
  const b = await launch();
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    const phone = name === 'phone';
    const ctx = await b.newContext({ viewport, locale: 'fr-FR', ...(phone && { hasTouch: true }) });
    await routeFonts(ctx);
    const page = await ctx.newPage();
    const label = `demo-${name}`;
    const p = phone ? 'm' : 'd';
    page.on('pageerror', (e) => fail(`[${label}] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${label}] console: ${m.text()}`));
    // La démo tient dans un seul fichier (routeur en mémoire) : on passe par la recherche globale et les onglets.
    const openMember = async (username) => {
      if (phone) {
        await page.locator('.search-trigger').first().click();
        await page.locator('.search-sheet input').fill(username);
      } else {
        await page.locator('header .gsearch__input').first().fill(username);
      }
      const option = page.locator('[role="option"]', { hasText: username }).first();
      await option.waitFor({ timeout: 15_000 });
      await option.click();
    };
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
      // Studio public d'un joueur fictif : bio, blocs, vinyle mis en avant, morceaux favoris.
      await openMember('maxvinyl');
      await page.waitForSelector('[data-studio="maxvinyl"] [data-studio-blocks]', { timeout: 15_000 });
      await page.waitForSelector('.st-head__bio');
      await page.waitForSelector('[data-featured-vinyl]');
      await page.waitForSelector('[data-block="tracks"] .top-tracks__item');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${p}-80-demo-bot-studio.png` });
      if (phone) await checkNoHorizontalScroll(page, `${label} studio`);
      // Studio réservé aux amis : l'en-tête seul.
      await openMember('soulcollector');
      await page.waitForSelector('[data-studio="soulcollector"][data-access="header"] [data-studio-restricted="friends"]', { timeout: 15_000 });
      await page.screenshot({ path: `${OUT}/${p}-81-demo-friends-only.png` });
      // Son Studio : éditeur, bio enregistrée.
      await page.locator(phone ? '.tabbar a[href="/studio"]' : '.topnav a[href="/studio"]').first().click();
      await page.waitForSelector('[data-studio-edit]');
      await page.click('[data-studio-edit]');
      await page.waitForSelector('.st-editor #st-bio');
      await page.fill('#st-bio', 'Je découvre AlbumMania : un booster par jour.');
      await page.click('.st-editor [data-studio-save]');
      await page.waitForSelector('.toast');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.st-head__bio');
      await page.screenshot({ path: `${OUT}/${p}-82-demo-own-studio.png` });
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
if (stack) await stack.stop();
await finish('Parcours P1-B sans erreur.');
