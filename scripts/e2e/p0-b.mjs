// Parcours P0-B (PLAN.md 9.3, critère P0.1) : le design system de l'identité actuelle, sans changement de look.
// Ordinateur 1440 × 900 et téléphone 390 × 844 :
//  - mesures de l'audit (design/audit-tools) sur l'accueil, la collection, l'album, l'artiste, le Studio, les amis, le
//    blind test, le guide des raretés, la fiche carte et l'ouverture de booster : aucun texte d'interface sous 12 px,
//    aucune micro-étiquette de carte sous 10 px, aucun texte courant sous 4,5:1 (3:1 pour les grands titres) ;
//  - héros Boosters et rangée Boutique / Doublons / Blind test : balisage et taille du titre inchangés ;
//  - correctifs permis : bouton désactivé en contour, barre d'onglets opaque (une colonne égale par onglet), grille
//    de cartes à 2 colonnes sur téléphone, reflet holo jamais posé sur une vraie pochette, avatar d'album = pochette
//    de l'album (vraie pochette, visuel généré en repli : DECISION-DESIGN.md, point 5) ; cartes de 84 à 320 px sans
//    titre coupé ni ligne d'artiste à moitié visible ;
//  - pas de défilement horizontal sur téléphone, zéro erreur de console ;
//  - captures côte à côte avec design/shots-current (SHOTS_CURRENT) pour la revue de parité ;
//  - démo autonome (dist-demo/albummania-demo.html) si elle est construite.
//   BASE=http://localhost:5102 OUT=/tmp/am-p0-b/shots node scripts/e2e/p0-b.mjs
//   (sans BASE : démarre sa propre copie sur 3102 / 5102 avec une copie de $FIXTURE dans /tmp/am-p0-b/am.db)
// Les fonctions `measure` et `cardFit` sont exportées (exécutées dans la page) : d'autres parcours peuvent les réutiliser.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Exécutée dans la page : tailles et contrastes de tous les textes visibles. Chaque texte est classé : `ui` (interface,
 * 12 px minimum), `card` (dans une carte de collection, 10 px minimum), `object` (logo, booster dessiné, dos de carte,
 * vinyles, initiale d'un avatar — image décorative masquée aux lecteurs d'écran, le pseudo est écrit à côté — : objets
 * à l'échelle, non contrôlés). Le contraste est calculé contre la pile des fonds (couleurs et premier
 * arrêt des dégradés), opacités comprises ; les contrôles désactivés en sont exclus (WCAG 1.4.3).
 */
export function measure() {
  const OBJECT = '.pack, .mini-pack, .logo, .card-back, .vinyl, .disc, .turntable, .opening__pack, .pack-art, .avatar';
  const CARD = '.card';
  const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const fromLin = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  function oklabToRgb(L, a, b) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return [r, g, bb].map((v) => Math.max(0, Math.min(255, fromLin(Math.max(0, v)) * 255)));
  }
  function parse(c) {
    if (!c) return null;
    let m = c.match(/^rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    m = c.match(/^color\(srgb ([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 };
    }
    m = c.match(/^oklab\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : Number(x)));
      const [r, g, b] = oklabToRgb(p[0], p[1], p[2]);
      return { r, g, b, a: p.length > 3 ? p[3] : 1 };
    }
    m = c.match(/^oklch\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : Number(x)));
      const h = (p[2] * Math.PI) / 180;
      const [r, g, b] = oklabToRgb(p[0], p[1] * Math.cos(h), p[1] * Math.sin(h));
      return { r, g, b, a: p.length > 3 ? p[3] : 1 };
    }
    return null;
  }
  const lum = ({ r, g, b }) => 0.2126 * toLin(r / 255) + 0.7152 * toLin(g / 255) + 0.0722 * toLin(b / 255);
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  function bgOf(el) {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 0.98) break;
      }
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('url(')) {
        const g = cs.backgroundImage.match(/(rgba?|color|oklab|oklch)\([^)]*\)/);
        const gc = g && parse(g[0]);
        if (gc) {
          layers.push(gc);
          if (gc.a >= 0.98) break;
        }
      }
    }
    let acc = { r: 15, g: 12, b: 21, a: 1 }; // --ink, fond de la page
    for (let i = layers.length - 1; i >= 0; i--) acc = blend(layers[i], acc);
    return acc;
  }
  const out = { texts: 0, small: [], smallCard: [], lowContrast: [], sizes: {} };
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const txt = node.textContent.trim();
    if (!txt) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('svg, .sr-only, .visually-hidden')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let op = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
    if (op < 0.05) continue;
    const kind = el.closest(OBJECT) ? 'object' : el.closest(CARD) ? 'card' : 'ui';
    const size = parseFloat(cs.fontSize);
    out.texts++;
    const key = String(Math.round(size * 2) / 2);
    out.sizes[key] = (out.sizes[key] || 0) + 1;
    const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
    const sample = { t: txt.slice(0, 40), size, cls, kind };
    if (kind === 'ui' && size < 11.95) out.small.push(sample);
    if (kind === 'card' && size < 9.95) out.smallCard.push(sample);
    if (kind !== 'ui' || el.closest('button:disabled, [aria-disabled="true"], .is-disabled')) continue;
    const col = parse(cs.color);
    if (!col) continue;
    // Texte en dégradé (background-clip: text, couleur transparente) : décor, contraste non mesurable.
    if (col.a === 0) continue;
    const bg = bgOf(el);
    const fg = blend({ ...col, a: col.a * op }, bg);
    const L1 = lum(fg);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) out.lowContrast.push({ ...sample, ratio: Math.round(ratio * 100) / 100, color: cs.color });
  }
  return out;
}

/**
 * Exécutée dans la page (grille .card-grid chargée) : force des cartes de 84 à 320 px et vérifie, carte par carte, que
 * le titre n'est pas coupé de plus de 3 px (le bas des jambages, comme avant les planchers) et que la ligne de
 * l'artiste est entière ou masquée (colonne hors champ, display: none), jamais à moitié. Remet la grille en place.
 */
export function cardFit() {
  const style = document.createElement('style');
  document.head.append(style);
  const out = { checked: 0, problems: [] };
  for (let w = 84; w <= 320; w += 4) {
    style.textContent = `.card-grid { grid-template-columns: repeat(auto-fill, ${w}px) !important; }`;
    for (const card of document.querySelectorAll('.card-grid .card')) {
      const title = card.querySelector('.card__title');
      const body = card.querySelector('.card__body');
      const foot = card.querySelector('.card__foot');
      if (!title || !body || !foot || getComputedStyle(body).display === 'none') continue;
      out.checked++;
      // Hauteur naturelle du titre (deux lignes au plus) : un clone hors flux, à la même largeur.
      const clone = title.cloneNode(true);
      clone.style.cssText = `position:absolute;left:-9999px;top:0;width:${title.getBoundingClientRect().width}px;flex:none;height:auto;min-height:0`;
      body.append(clone);
      const natural = clone.getBoundingClientRect().height;
      clone.remove();
      const tb = title.getBoundingClientRect();
      const bb = body.getBoundingClientRect();
      const bottom = getComputedStyle(body).overflow === 'hidden' ? Math.min(bb.bottom, foot.getBoundingClientRect().top) : foot.getBoundingClientRect().top;
      const cut = natural - (Math.min(tb.bottom, bottom) - tb.top);
      const name = title.textContent.slice(0, 30);
      if (cut > 3.2) out.problems.push({ w, title: name, what: `titre coupé de ${cut.toFixed(1)} px` });
      const artist = card.querySelector('.card__artist');
      if (artist && getComputedStyle(artist).display !== 'none') {
        const ab = artist.getBoundingClientRect();
        const shown = ab.left < bb.right - 1;
        if (shown && (ab.bottom > bottom + 1.5 || ab.top < tb.bottom - 1.5)) out.problems.push({ w, title: name, what: 'ligne de l’artiste à moitié visible' });
      }
    }
  }
  style.remove();
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) await main();

async function main() {
  const lib = await import('./lib.mjs');
  const { ROOT, OUT, VIEWPORTS, run, signupViaApi, loginAdmin, apiCall, fail, finish, setBase, startStack, checkNoHorizontalScroll, launch, routeFonts, ignoredConsole } = lib;

  let stack = null;
  if (!process.env.BASE) {
    stack = await startStack({ id: 'p0-b', apiPort: 3102, webPort: 5102, freshDb: true });
    setBase(stack.base);
  }
  const BASE = stack ? stack.base : lib.BASE;
  const SHOTS_CURRENT = process.env.SHOTS_CURRENT || '';
  const stamp = Date.now().toString(36).slice(-5);
  const player = { email: `p0b_${stamp}@example.com`, username: `p0b_${stamp}` };
  const friend = { email: `p0bf_${stamp}@example.com`, username: `p0bf_${stamp}` };
  const audit = {};

  /** Attend la fin des chargements et des polices, puis fige les animations infinies (captures comparables). */
  async function settle(page, ms = 700) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(ms);
  }
  const capture = (page, name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...opts });

  /** Mesure la page et relève les textes trop petits ou trop pâles. */
  async function check(page, name) {
    const m = await page.evaluate(measure);
    audit[name] = { texts: m.texts, sizes: m.sizes, small: m.small, smallCard: m.smallCard, lowContrast: m.lowContrast };
    const list = (arr) => arr.slice(0, 6).map((s) => `« ${s.t} » ${s.size}px .${s.cls}${s.ratio ? ` ${s.ratio}:1` : ''}`).join(' ; ');
    if (m.small.length) fail(`[${name}] ${m.small.length} texte(s) d'interface sous 12 px : ${list(m.small)}`);
    if (m.smallCard.length) fail(`[${name}] ${m.smallCard.length} micro-étiquette(s) de carte sous 10 px : ${list(m.smallCard)}`);
    if (m.lowContrast.length) fail(`[${name}] ${m.lowContrast.length} texte(s) sous 4,5:1 : ${list(m.lowContrast)}`);
  }

  /** Page + capture + mesures (+ défilement horizontal sur téléphone). */
  async function visit(page, v, route, selector, name, { full = false, ms } = {}) {
    await page.goto(`${BASE}${route}`);
    await page.waitForSelector(selector, { timeout: 20_000 });
    await settle(page, ms);
    await capture(page, `${v}-${name}`);
    if (full) await capture(page, `${v}-${name}-full`, { fullPage: true });
    await check(page, `${v}-${name}`);
    if (v === 'm') await checkNoHorizontalScroll(page, `${v} ${route}`);
  }

  // ---------- comptes : un collectionneur (admin, cartes, album complété, avatar d'album) et un nouveau joueur ----------
  let adminId = null;
  await run('setup', VIEWPORTS.desktop, async (page, ctx) => {
    await signupViaApi(page, friend.email, friend.username);
    await apiCall(page, 'PUT', '/ratings/album/discovery', { score: 9, review: 'Le disque des trajets de nuit.' });
    await ctx.clearCookies();
    await signupViaApi(page, player.email, player.username);
    await ctx.clearCookies();
    await loginAdmin(page);
    const st = await apiCall(page, 'GET', '/state');
    adminId = st.body?.user?.id;
    for (let i = 0; i < 4; i++) await apiCall(page, 'POST', '/packs/open', { count: 10 });
    const done = await apiCall(page, 'POST', '/admin/me/complete', { albumId: 'moon-safari' });
    if (done.status !== 200) fail(`[setup] album complété : ${done.status}`);
    await apiCall(page, 'POST', '/admin/me/almost', { albumId: 'discovery' });
    await apiCall(page, 'PUT', '/ratings/album/moon-safari', { score: 8, review: 'La bande-son d’un dimanche matin.' });
    // Avatar d'album : la pochette de l'album complété (DECISION-DESIGN.md, point 5).
    const av = await apiCall(page, 'POST', '/profile/avatar', { avatar: 'album:moon-safari' });
    if (av.status !== 200) fail(`[setup] avatar d'album : ${av.status}`);
    await apiCall(page, 'POST', '/friends/request', { username: friend.username });
  });
  await run('setup-friend', VIEWPORTS.desktop, async (page) => {
    const res = await page.request.post(`${BASE}/api/auth/login`, { headers: { 'X-AlbumMania': '1' }, data: { identifier: friend.username, password: lib.PASSWORD } });
    if (res.status() !== 200) throw new Error(`connexion de ${friend.username} : ${res.status()}`);
    const list = await apiCall(page, 'GET', '/friends');
    const incoming = (list.body?.incoming || []).find((r) => r.user?.id === adminId || r.username === lib.ADMIN.username) || list.body?.incoming?.[0];
    const accepted = incoming && await apiCall(page, 'POST', `/friends/${incoming.requestId ?? incoming.id}/accept`);
    if (accepted?.status !== 200) fail(`[setup-friend] demande d'ami non acceptée : ${accepted?.status ?? 'aucune demande reçue'}`);
  });

  const asUser = async (page, identifier) => {
    const res = await page.request.post(`${BASE}/api/auth/login`, { headers: { 'X-AlbumMania': '1' }, data: { identifier, password: lib.PASSWORD } });
    if (res.status() !== 200) throw new Error(`connexion de ${identifier} : ${res.status()}`);
  };

  for (const [v, viewport] of [['d', VIEWPORTS.desktop], ['m', VIEWPORTS.phone]]) {
    // ---------- nouveau joueur : le héros de la référence (« N boosters disponibles »), boutons désactivés ----------
    await run(`${v}-player`, viewport, async (page) => {
      await asUser(page, player.username);
      await visit(page, v, '/', '.hero', '10-new-home');
      const hero = await page.evaluate(() => {
        const h = document.querySelector('section.hero#booster');
        const title = h?.querySelector('.hero__title');
        const disabled = [...document.querySelectorAll('.home-panels .btn:disabled')].map((b) => {
          const cs = getComputedStyle(b);
          return { bg: cs.backgroundColor, border: cs.borderTopColor, color: cs.color };
        });
        return {
          pack: !!h?.querySelector(':scope > .hero__pack .pack'),
          eyebrow: h?.querySelector('.hero__panel > .eyebrow')?.textContent || '',
          title: title?.textContent || '',
          titleSize: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
          cta: !!h?.querySelector('.hero__actions > .btn.btn--primary.btn--xl'),
          help: !!h?.querySelector('.hero__help'),
          panels: [...document.querySelectorAll('.home-panels > .panel')].map((p) => p.id || p.className),
          disabled,
        };
      });
      if (!hero.pack || !hero.cta || !hero.help) fail(`[${v}-player] héros incomplet : ${JSON.stringify(hero)}`);
      if (!/booster/i.test(hero.title)) fail(`[${v}-player] titre du héros : « ${hero.title} »`);
      // Titre du héros : clamp(30px, 4.6vw, 52px), comme avant (± 2 px).
      const expected = Math.min(52, Math.max(30, viewport.width * 0.046));
      if (Math.abs(hero.titleSize - expected) > 2) fail(`[${v}-player] titre du héros à ${hero.titleSize}px (attendu ${expected.toFixed(1)}px)`);
      if (hero.panels.length !== 3 || hero.panels[0] !== 'boutique' || !/panel--bt/.test(hero.panels[2])) fail(`[${v}-player] rangée Boutique / Doublons / Blind test : ${hero.panels.join(', ')}`);
      // Bouton désactivé : contour atténué, fond transparent (plus d'aplat gris).
      for (const d of hero.disabled) {
        if (!/rgba\(0, 0, 0, 0\)|transparent/.test(d.bg)) fail(`[${v}-player] bouton désactivé avec un fond ${d.bg}`);
      }
      if (!hero.disabled.length) fail(`[${v}-player] aucun bouton désactivé trouvé sur l'accueil d'un nouveau joueur`);
      // Fil des amis vide : l'état vide propose de trouver des amis.
      const feedEmpty = await page.locator('.empty-state a[href="/friends"]').count();
      if (!feedEmpty) fail(`[${v}-player] état vide du fil des amis absent`);
      await capture(page, `${v}-10-new-home-full`, { fullPage: true });
      if (v === 'm') {
        const bar = await page.evaluate(() => {
          const t = document.querySelector('.tabbar');
          if (!t) return null;
          const cs = getComputedStyle(t);
          const widths = [...t.querySelectorAll(':scope > .tabbar__link, :scope > a, :scope > button')].map((a) => Math.round(a.getBoundingClientRect().width));
          return { bg: cs.backgroundColor, blur: cs.backdropFilter, cols: cs.gridTemplateColumns.split(' ').length, widths, bar: Math.round(t.getBoundingClientRect().width) };
        });
        if (!bar) fail('[m-player] barre d\'onglets absente');
        else {
          if (!/^rgb\(/.test(bar.bg) && !/, 1\)$/.test(bar.bg)) fail(`[m-player] barre d'onglets translucide : ${bar.bg}`);
          if (bar.blur && bar.blur !== 'none') fail(`[m-player] barre d'onglets floutée : ${bar.blur}`);
          // Une colonne égale par onglet (5 avec la navigation de P0-D), sans case vide.
          if (bar.cols !== bar.widths.length || bar.widths.length < 4 || bar.widths.length > 5) fail(`[m-player] barre d'onglets : ${bar.cols} colonnes pour ${bar.widths.length} onglets`);
          if (Math.max(...bar.widths) - Math.min(...bar.widths) > 1) fail(`[m-player] onglets de largeurs inégales : ${bar.widths.join(', ')}`);
          if (Math.abs(bar.widths.reduce((a, b) => a + b, 0) - bar.bar) > bar.widths.length) fail(`[m-player] la barre d'onglets n'est pas remplie : ${bar.widths.join(' + ')} ≠ ${bar.bar}`);
        }
      }
    });

    // ---------- collectionneur ----------
    await run(`${v}-collector`, viewport, async (page) => {
      await asUser(page, lib.ADMIN.username);
      await visit(page, v, '/', '.hero', '30-home', { full: true, ms: 1200 });
      // Fil des amis : la note de l'ami mène à la page de l'album (même lien que partout, useRatedItem).
      const feed = await page.locator('.feed__item .feed__title[href^="/album/"]').count();
      if (!feed) fail(`[${v}-collector] fil des amis vide alors qu'un ami a noté un album`);

      // Guide des raretés (séparation jeu / œuvres, royalties = monnaie de jeu), empilé sur téléphone.
      await page.locator('.hero__help').click();
      await page.waitForSelector('.rarity-guide');
      await settle(page, 600);
      await capture(page, `${v}-32-rarity-guide`);
      await check(page, `${v}-32-rarity-guide`);
      const guide = await page.evaluate(() => ({
        game: document.querySelector('.rarity-guide__game')?.textContent || '',
        overflow: (() => { const w = document.querySelector('.rarity-guide .table-wrap'); return w ? w.scrollWidth - w.clientWidth : 0; })(),
      }));
      if (!/monnaie de jeu/.test(guide.game)) fail(`[${v}] guide des raretés : la mention « monnaie de jeu » manque`);
      if (v === 'm' && guide.overflow > 1) fail(`[m] guide des raretés : le tableau déborde de ${guide.overflow} px`);
      if (v === 'm') {
        await page.locator('.modal').first().evaluate((el) => el.scrollBy(0, 900)).catch(() => {});
        await page.waitForTimeout(300);
        await capture(page, `${v}-32b-rarity-guide-scrolled`);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);

      // Fiche d'une carte récente.
      const card = page.locator('.card-row .card').first();
      if (await card.count()) {
        await card.scrollIntoViewIfNeeded();
        await card.click();
        await page.waitForSelector('.card-detail');
        await settle(page, 600);
        await capture(page, `${v}-33-card-modal`);
        await check(page, `${v}-33-card-modal`);
        await page.keyboard.press('Escape');
      } else fail(`[${v}] aucune carte récente sur l'accueil du collectionneur`);

      for (const tab of ['albums', 'cards', 'artists', 'promos', 'genres', 'decades']) {
        await visit(page, v, `/collection/${tab}`, '.collection', `50-coll-${tab}`, { ms: 1000 });
      }
      if (v === 'm') {
        await page.goto(`${BASE}/collection/cards`);
        await page.waitForSelector('.card-grid .card');
        const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.card-grid')).gridTemplateColumns.split(' ').length);
        if (cols !== 2) fail(`[m] grille de cartes à ${cols} colonnes sur téléphone (2 attendues)`);
      } else {
        // Cartes de 84 à 320 px : un titre n'est jamais coupé au milieu d'une ligne (au plus le bas des jambages, comme
        // avant les planchers) et la ligne de l'artiste est entière ou masquée, jamais à moitié.
        await page.goto(`${BASE}/collection/cards`);
        await page.waitForSelector('.card-grid .card .card__title');
        await settle(page, 400);
        const fit = await page.evaluate(cardFit);
        if (!fit.checked) fail('[d] contrôle des cartes : aucune carte mesurée');
        for (const p of fit.problems.slice(0, 6)) fail(`[d] carte de ${p.w}px « ${p.title} » : ${p.what}`);
      }
      await visit(page, v, '/album/discovery', '.album-head', '60-album-discovery', { full: true, ms: 1200 });
      await visit(page, v, '/album/moon-safari', '.album-head', '62-album-completed', { ms: 1200 });
      await visit(page, v, '/artist/daft-punk', '.artist-page', '64-artist', { ms: 1200 });
      await visit(page, v, '/studio', '.profile-head', '70-profile', { full: true, ms: 1200 });
      // Avatar « album:<id> » : la pochette de l'album (vraie pochette, ou visuel généré quand l'image manque, comme ici
      // où le CDN est bloqué), jamais l'initiale.
      const avatar = await page.evaluate(() => {
        const a = document.querySelector('.profile-head .avatar');
        return a ? { cover: !!a.querySelector('.cover, img, svg'), initial: !!a.querySelector(':scope > span') } : null;
      });
      if (!avatar?.cover || avatar.initial) fail(`[${v}] avatar d'album : ${JSON.stringify(avatar)}`);
      await visit(page, v, '/friends', '.friends', '74-friends', { ms: 1000 });
      await visit(page, v, '/blindtest', '.genre-grid', '20-bt-intro', { ms: 800 });

      // Reflet holo : sur une vraie pochette, l'image passe au-dessus du reflet (seul le cadre brille).
      const holo = await page.evaluate(() => {
        const el = document.createElement('div');
        el.className = 'card card--rare card--holo card--cover';
        el.style.cssText = 'position:fixed;left:-500px;top:0;width:160px';
        el.innerHTML = '<span class="card__inner"><span class="card__art"></span></span><span class="card__holo"></span>';
        document.body.append(el);
        const z = (s) => Number(getComputedStyle(el.querySelector(s)).zIndex) || 0;
        const r = { art: z('.card__art'), holo: z('.card__holo') };
        el.remove();
        return r;
      });
      if (!(holo.art > holo.holo)) fail(`[${v}] reflet holo au-dessus d'une vraie pochette : ${JSON.stringify(holo)}`);

      // Ouverture d'un booster : écran inchangé (booster, déchirure, révélation, résumé).
      await page.goto(`${BASE}/`);
      await page.waitForSelector('.hero');
      await settle(page, 800);
      await page.locator('.hero .btn--primary').first().click();
      await page.waitForSelector('.opening__pack-btn');
      await page.waitForTimeout(900);
      await capture(page, `${v}-40-pack`);
      await check(page, `${v}-40-pack`);
      await page.locator('.opening__pack-btn').click();
      await page.waitForSelector('.reveal-card', { timeout: 10_000 });
      await page.waitForTimeout(900);
      await page.locator('.reveal-card').click().catch(() => {});
      await page.waitForTimeout(1200);
      await capture(page, `${v}-43-reveal-front`);
      await page.getByRole('button', { name: /Tout révéler|Reveal all/ }).click().catch(() => {});
      await page.waitForSelector('.summary', { timeout: 10_000 });
      await page.waitForTimeout(1500);
      await capture(page, `${v}-44-summary`);
      await check(page, `${v}-44-summary`);
      await page.keyboard.press('Escape');
    });
  }

  // ---------- captures côte à côte avec design/shots-current (revue de parité) ----------
  if (SHOTS_CURRENT && fs.existsSync(SHOTS_CURRENT)) {
    const b = await launch();
    const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    const names = fs.readdirSync(OUT).filter((f) => /^[dm]-\d/.test(f) && f.endsWith('.png') && fs.existsSync(path.join(SHOTS_CURRENT, f)));
    const uri = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
    for (const f of names) {
      await page.setContent(`<body style="margin:0;background:#000;display:flex;align-items:flex-start;gap:8px;font:14px sans-serif;color:#fff">
        <figure style="margin:0;flex:1"><figcaption>avant (shots-current)</figcaption><img style="width:100%" src="${uri(path.join(SHOTS_CURRENT, f))}"></figure>
        <figure style="margin:0;flex:1"><figcaption>après (P0-B)</figcaption><img style="width:100%" src="${uri(path.join(OUT, f))}"></figure></body>`);
      await page.waitForFunction(() => [...document.images].every((i) => i.complete));
      const height = await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
      await page.setViewportSize({ width: 1600, height: Math.max(200, Math.min(height, 12_000)) });
      await page.screenshot({ path: path.join(OUT, `compare-${f}`) });
    }
    await ctx.close();
    console.log(`${names.length} capture(s) côte à côte avec ${SHOTS_CURRENT}.`);
  }

  // ---------- démo autonome ----------
  const demoFile = path.join(ROOT, 'dist-demo/albummania-demo.html');
  if (fs.existsSync(demoFile)) {
    const b = await launch();
    for (const [v, viewport] of [['d', VIEWPORTS.desktop], ['m', VIEWPORTS.phone]]) {
      const ctx = await b.newContext({ viewport, locale: 'fr-FR' });
      await routeFonts(ctx);
      const page = await ctx.newPage();
      const label = `${v}-demo`;
      page.on('pageerror', (e) => fail(`[${label}] ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${label}] console: ${m.text()}`));
      try {
        await page.goto(`file://${demoFile}`);
        await page.waitForSelector('.auth__form', { timeout: 20_000 });
        await page.getByText(/Créer un compte/).first().click();
        await page.fill('#su-email', `demo_${v}@example.com`);
        await page.fill('#su-user', `demo_${v}`);
        await page.fill('#su-pw', lib.PASSWORD);
        if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', lib.PASSWORD);
        for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
        await page.waitForSelector('.field__ok');
        await page.click('button[type=submit]');
        // Inscription refusée (ex. case « CGU et 15 ans » absente du formulaire alors que la démo l'exige) : le message
        // du formulaire plutôt qu'une attente qui expire.
        await page.waitForSelector('.demo-mail .btn, .form-error', { timeout: 20_000 });
        const refused = await page.locator('.form-error').first().textContent({ timeout: 500 }).catch(() => null);
        if (refused) throw new Error(`inscription de démo refusée : « ${refused.trim()} »`);
        await page.click('.demo-mail .btn');
        await page.waitForSelector('.hero');
        await settle(page, 600);
        await capture(page, `${v}-90-demo-home`);
        await check(page, `${v}-90-demo-home`);
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

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(audit, null, 1));
  const pages = Object.keys(audit).length;
  await finish(`Parcours P0-B sans erreur : ${pages} écrans mesurés (0 texte d'interface < 12 px, 0 carte < 10 px, 0 texte < 4,5:1).`);
  if (stack) await stack.stop();
}
