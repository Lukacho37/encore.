// Parcours P2-C (PLAN.md 9.5, 8.3 P2.6) : provenance et enrichissement du catalogue ; ordinateur 1440 × 900 et
// téléphone 390 × 844.
//   - Espace admin, onglet Catalogue : enrichissement MusicBrainz / Wikidata contre un faux service local (le bac à
//     sable n'a pas Internet ; le serveur garde son vrai rythme : 1,1 s entre deux requêtes, User-Agent avec contact),
//     pause, reprise ; albums proches recalculés ; détachement de Deezer simulé puis confirmé (nom tapé).
//   - Page album : lecteurs Spotify et Apple Music proposés grâce aux identifiants trouvés, chargés seulement après le
//     clic (« Charger le lecteur », « Toujours charger »), jamais en lecture automatique ; crédit MusicBrainz · Wikidata.
//   - Après le détachement : album importé « archivé » (note du panneau d'écoute), plus de lien Deezer, la collection
//     de l'admin garde ses cartes et sa note.
//   - Démo autonome (dist-demo/albummania-demo.html) : lecteur Spotify d'un album de la graine, panneau admin vivant.
//   Zéro erreur de console (hors ressources bloquées par le réseau), pas de défilement horizontal sur téléphone.
//   BASE=http://localhost:5123 OUT=/tmp/am-p2-c/shots node scripts/e2e/p2-c.mjs
//   (sans BASE : démarre sa propre copie sur 3123 / 5123 avec une copie neuve de $FIXTURE dans /tmp/am-p2-c/am.db)
//   FOCUS=desktop,phone,detach,demo : ne joue que ces parties (développement).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, fail, finish, setBase, startStack, checkNoHorizontalScroll, launch, routeFonts,
  ignoredConsole, loginAdmin, apiCall, homeAfterWelcome,
} from './lib.mjs';

const FOCUS = new Set((process.env.FOCUS || 'desktop,phone,detach,demo').split(',').map((s) => s.trim()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONTACT = 'e2e-contact@example.com';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DISCOVERY_SPOTIFY = '2noRn2Aes5aoNVsU6iWThc';

// ---------- faux MusicBrainz / Wikidata (Daft Punk et Air ; le reste : rien trouvé) ----------

let dbFile = process.env.DB_FILE || null;
const log = [];
const claim = (v) => ({ mainsnak: { datavalue: { value: v } }, rank: 'normal' });
const ARTISTS = {
  [uuid(1)]: { id: uuid(1), name: 'Daft Punk', country: 'FR', relations: [
    { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q185828' } },
    { type: 'free streaming', url: { resource: 'https://open.spotify.com/artist/4tZwfgrHOc3mvqYlEYSvVi' } },
  ] },
  [uuid(2)]: { id: uuid(2), name: 'Air', country: 'FR', relations: [] },
};
const RELEASES = {
  discovery: { id: uuid(101), rg: uuid(201), title: 'Discovery', artist: uuid(1), barcode: '724384960650',
    relations: [{ type: 'free streaming', url: { resource: `https://open.spotify.com/album/${DISCOVERY_SPOTIFY}` } }],
    rgRelations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q1129999' } }] },
  'random-access-memories': { id: uuid(102), rg: uuid(202), title: 'Random Access Memories', artist: uuid(1), barcode: null,
    relations: [{ type: 'free streaming', url: { resource: 'https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa' } }], rgRelations: [] },
  'moon-safari': { id: uuid(103), rg: uuid(203), title: 'Moon Safari', artist: uuid(2), barcode: null, relations: [], rgRelations: [] },
};
const ENTITIES = {
  Q1129999: { id: 'Q1129999', claims: { P436: [claim(uuid(201))], P2281: [claim('697194953')] } },
  Q185828: { id: 'Q185828', claims: { P434: [claim(uuid(1))], P2850: [claim('5468295')] } },
};

function titlesOf(albumId) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    return db.prepare('SELECT title FROM cat_tracks WHERE album_id = ? ORDER BY n').all(albumId).map((r) => r.title);
  } finally {
    db.close();
  }
}

function release(key, full) {
  const r = RELEASES[key];
  const a = ARTISTS[r.artist];
  const titles = titlesOf(key);
  const base = {
    id: r.id, title: r.title, status: 'Official', barcode: r.barcode, score: 100, 'track-count': titles.length,
    'artist-credit': [{ name: a.name, joinphrase: '', artist: { id: a.id, name: a.name } }], 'release-group': { id: r.rg, 'primary-type': 'Album' },
  };
  if (!full) return base;
  return {
    ...base, relations: r.relations, 'release-group': { ...base['release-group'], relations: r.rgRelations },
    media: [{ position: 1, tracks: titles.map((title, i) => ({ position: i + 1, title, recording: { id: uuid(5000 + Number(r.id.slice(-3)) * 100 + i), title, isrcs: [] } })) }],
  };
}

async function startFake() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://fake');
    log.push({ t: Date.now(), kind: u.pathname.startsWith('/w/') ? 'wd' : 'mb', path: u.pathname, ua: req.headers['user-agent'] });
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (u.pathname.startsWith('/w/')) {
      const ids = String(u.searchParams.get('ids') || '').split('|');
      return send(200, { entities: Object.fromEntries(ids.map((id) => [id, ENTITIES[id] || { id, missing: '' }])) });
    }
    const q = u.searchParams.get('query') || '';
    let m;
    if (u.pathname === '/ws/2/release') {
      m = /^release:"(.*)" AND artist:"(.*)"$/.exec(q);
      const keys = m ? Object.keys(RELEASES).filter((k) => RELEASES[k].title.toLowerCase() === m[1].toLowerCase() && ARTISTS[RELEASES[k].artist].name.toLowerCase() === m[2].toLowerCase()) : [];
      return send(200, { releases: keys.map((k) => release(k, false)) });
    }
    if ((m = /^\/ws\/2\/release\/([0-9a-f-]+)$/.exec(u.pathname))) {
      const key = Object.keys(RELEASES).find((k) => RELEASES[k].id === m[1]);
      return key ? send(200, release(key, true)) : send(404, { error: 'Not Found' });
    }
    if ((m = /^\/ws\/2\/artist\/([0-9a-f-]+)$/.exec(u.pathname))) return ARTISTS[m[1]] ? send(200, ARTISTS[m[1]]) : send(404, { error: 'Not Found' });
    if (u.pathname === '/ws/2/artist' || u.pathname === '/ws/2/recording') return send(200, { artists: [], recordings: [] });
    return send(404, { error: 'Not Found' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const fake = await startFake();
let stack = null;
if (!process.env.BASE) {
  stack = await startStack({
    id: 'p2-c', apiPort: 3123, webPort: 5123, freshDb: true,
    env: { ENRICH: 'musicbrainz', ENRICH_CONTACT: CONTACT, MUSICBRAINZ_API_URL: `${fake.base}/ws/2`, WIKIDATA_API_URL: `${fake.base}/w/api.php` },
  });
  setBase(stack.base);
  dbFile = path.join(stack.dir, 'am.db');
}
const BASE = stack ? stack.base : INITIAL_BASE;

/** Attend que `fn()` (asynchrone) renvoie une valeur vraie. */
async function until(fn, { timeout = 60_000, every = 500, label = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`délai dépassé : ${label}`);
    await sleep(every);
  }
}

/** Capture après le chargement des images et la fin des animations. */
async function settledShot(page, file, opts = {}) {
  await page.waitForLoadState('networkidle').catch(() => {});
  if (opts.fullPage) await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(250);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: !!opts.fullPage });
}

async function openCatalogTab(page) {
  await page.goto(`${BASE}/admin/catalog`);
  await page.waitForSelector('.en-panel .adm-phase');
}

const phaseText = (page) => page.locator('.en-panel').first().locator('.adm-phase').innerText();

// ---------- parcours ----------

async function enrichFlow(page, p, { phone = false } = {}) {
  await loginAdmin(page);
  // Préparation : l'admin complète un album importé (cartes + vinyle) et le note (vérifié après le détachement).
  if (!phone) {
    assert200(await apiCall(page, 'POST', '/admin/me/complete', { albumId: 'dz1000001' }), 'album complété');
    assert200(await apiCall(page, 'PUT', '/ratings/album/dz1000001', { score: 9 }), 'note');
  }
  // État connu : en pause (la tâche de nuit, rattrapée au démarrage, a pu lancer la passe toute seule).
  await apiCall(page, 'POST', '/admin/enrich/pause');
  await openCatalogTab(page);
  const ua = await page.locator('.en-ua').innerText();
  if (!ua.includes(CONTACT)) fail(`[${p}] identité envoyée sans contact : ${ua}`);
  if (!/En pause|Passe terminée/i.test(await phaseText(page))) fail(`[${p}] état inattendu : ${await phaseText(page)}`);
  await settledShot(page, `${p}-10-enrich-paused`, { fullPage: true });

  // Reprise : la passe avance (Daft Punk puis Air, à 1,1 s par requête). Compteur de requêtes du serveur relevé
  // avant et après, pour vérifier son rythme (une requête MusicBrainz par 1,1 s au plus).
  const before = (await apiCall(page, 'GET', '/admin/enrich')).body;
  const t0 = Date.now();
  const resume = page.locator('.en-panel').first().getByRole('button', { name: /^(Reprendre|Lancer)$/ });
  if (await resume.isEnabled()) {
    await resume.click();
    await page.waitForSelector('.toast');
  }
  await until(async () => {
    const s = (await apiCall(page, 'GET', '/admin/enrich')).body;
    return (s.counts?.spotify?.album >= 2 && s.counts?.apple?.album >= 1) || s.phase === 'done' ? s : null;
  }, { timeout: 90_000, label: 'identifiants Spotify et Apple trouvés' });
  await openCatalogTab(page);
  await settledShot(page, `${p}-11-enrich-running`, { fullPage: true });
  const pause = page.locator('.en-panel').first().getByRole('button', { name: 'Mettre en pause' });
  if (await pause.isEnabled()) {
    await pause.click();
    await page.waitForSelector('.toast');
    await until(async () => /En pause/i.test(await phaseText(page)), { timeout: 30_000, every: 1000, label: 'pause' });
  }
  // Politesse : User-Agent avec contact sur chaque requête ; pas plus d'une requête MusicBrainz par 1,1 s d'après le
  // compteur du serveur (les heures d'arrivée relevées dans ce processus, qui pilote aussi le navigateur, sont trop
  // bruitées pour un écart requête par requête : celui-ci est vérifié côté client par server/test/enrich.test.js).
  if (!log.length || log.some((r) => !String(r.ua).includes(CONTACT))) fail(`[${p}] User-Agent manquant`);
  const after = (await apiCall(page, 'GET', '/admin/enrich')).body;
  const sent = (after.requests?.musicbrainz || 0) - (before.requests?.musicbrainz || 0);
  const allowed = Math.floor((Date.now() - t0) / 1100) + 1;
  if (sent > allowed) fail(`[${p}] ${sent} requêtes MusicBrainz en ${Date.now() - t0} ms (au plus ${allowed})`);
  const mb = log.filter((r) => r.kind === 'mb').map((r) => r.t);
  if (mb.length > 3 && (mb[mb.length - 1] - mb[0]) / (mb.length - 1) < 1050) fail(`[${p}] rythme moyen MusicBrainz trop rapide`);

  // Albums proches.
  await page.getByRole('button', { name: 'Recalculer maintenant' }).click();
  await page.waitForSelector('.toast');
  if (phone) await checkNoHorizontalScroll(page, `${p}-admin`);
  await settledShot(page, `${p}-12-similar`, { fullPage: true });

  // Page album : lecteurs proposés, chargés seulement après le clic.
  await page.goto(`${BASE}/album/discovery`);
  await page.waitForSelector('.en-player');
  const switches = await page.locator('.en-switch .seg__btn').allInnerTexts();
  if (switches.join(',') !== 'Spotify,Apple Music') fail(`[${p}] lecteurs proposés : ${switches.join(',')}`);
  if (await page.locator('.en-player iframe').count()) fail(`[${p}] un lecteur chargé sans clic`);
  const credit = await page.locator('.en-credit').innerText();
  if (!/MusicBrainz/.test(credit) || !/Wikidata/.test(credit)) fail(`[${p}] crédit des identifiants absent : ${credit}`);
  await page.locator('.en-player').scrollIntoViewIfNeeded();
  await settledShot(page, `${p}-20-album-listen`);
  await page.locator('.en-player').getByRole('button', { name: 'Charger le lecteur' }).click();
  const spotify = page.locator(`.en-player iframe[src="https://open.spotify.com/embed/album/${DISCOVERY_SPOTIFY}"]`);
  await spotify.waitFor({ state: 'attached' });
  const attrs = await spotify.evaluate((f) => `${f.src} ${f.getAttribute('allow')}`);
  if (/autoplay/i.test(attrs)) fail(`[${p}] lecture automatique : ${attrs}`);
  if (!/Lecteur Spotify/.test(await spotify.getAttribute('title'))) fail(`[${p}] titre du lecteur Spotify`);
  await page.locator('.en-switch').getByRole('button', { name: 'Apple Music' }).click();
  await page.locator('.en-player').getByText('Écouter avec Apple Music').waitFor();
  await page.locator('.en-player').getByRole('button', { name: 'Toujours charger' }).click();
  await page.locator('.en-player iframe[src^="https://embed.music.apple.com/fr/album/697194953"]').waitFor({ state: 'attached' });
  const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem('albummania.embeds') || '{}'));
  if (remembered.apple !== 'always' || remembered.spotify) fail(`[${p}] choix mémorisés : ${JSON.stringify(remembered)}`);
  await settledShot(page, `${p}-21-album-players`);
  if (phone) await checkNoHorizontalScroll(page, `${p}-album`);
  await page.evaluate(() => localStorage.removeItem('albummania.embeds'));

  // Page morceau : liens d'écoute (recherches), pas de lecteur sans identifiant de morceau.
  await page.goto(`${BASE}/track/${encodeURIComponent('discovery:01')}`);
  await page.waitForSelector('.trk-listen__links a');
  if ((await page.locator('.trk-listen__links a').count()) !== 4) fail(`[${p}] liens d'écoute du morceau`);
  if (await page.locator('.en-player').count()) fail(`[${p}] lecteur sur un morceau sans identifiant`);
}

/** Comme lib.run, mais chaque erreur de console dit quelle ressource l'a causée. */
async function runC(name, viewport, fn) {
  const b = await launch();
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, locale: 'fr-FR' });
  await routeFonts(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`[${name}] ${e.message}`));
  // Seule exception attendue : les classements d'un album archivé répondent 404 (server/battles.js, P1-F, hors de ce
  // chantier : correctif demandé dans le compte rendu P2-C).
  page.on('console', (m) => m.type() === 'error' && !ignoredConsole(m.text()) && fail(`[${name}] console: ${m.text()} (${m.location()?.url || '?'})`));
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

function assert200(r, label) {
  if (r.status !== 200) throw new Error(`${label} : ${r.status} ${JSON.stringify(r.body)}`);
}

async function detachFlow(page, p) {
  await loginAdmin(page);
  await openCatalogTab(page);
  const panel = page.locator('.en-detach');
  await panel.scrollIntoViewIfNeeded();
  await panel.getByRole('button', { name: /^Simuler/ }).click();
  await panel.locator('.en-report').waitFor({ timeout: 30_000 });
  const report = await panel.locator('.en-report').innerText();
  if (!/archivés/i.test(report)) fail(`[${p}] compte rendu : ${report.slice(0, 200)}`);
  await settledShot(page, `${p}-30-detach-simulation`, { fullPage: true });
  await panel.locator('.en-confirm__input').fill('deezer');
  await panel.getByRole('button', { name: 'Se détacher de Deezer' }).click();
  await panel.getByRole('button', { name: 'Confirmer' }).click();
  await page.locator('.toast', { hasText: 'Détachement terminé.' }).waitFor({ timeout: 120_000 });
  await panel.locator('.en-note--done').waitFor();
  await settledShot(page, `${p}-31-detached`, { fullPage: true });
  // L'import est coupé.
  const cat = (await apiCall(page, 'GET', '/admin/catalog')).body;
  if (!cat.detached) fail(`[${p}] import pas marqué détaché`);
  // L'album importé est archivé : note dans le panneau d'écoute, plus de Deezer ; l'admin garde ses cartes et sa note.
  await page.goto(`${BASE}/album/dz1000001`);
  await page.locator('.en-archived').waitFor();
  const links = await page.locator('.trk-listen__links a').allInnerTexts();
  if (links.some((l) => /Deezer/.test(l))) fail(`[${p}] lien Deezer après le détachement`);
  const state = (await apiCall(page, 'GET', '/state')).body;
  if (!state.cards.some((c) => String(c.t).startsWith('dz1000001:'))) fail(`[${p}] cartes perdues`);
  if (!state.ratings.some((r) => r.i === 'dz1000001')) fail(`[${p}] note perdue`);
  await page.locator('.en-archived').scrollIntoViewIfNeeded();
  await settledShot(page, `${p}-40-album-archived`);
}

async function archivedPhone(page, p) {
  await loginAdmin(page);
  await page.goto(`${BASE}/album/dz1000001`);
  await page.locator('.en-archived').waitFor();
  await page.locator('.en-archived').scrollIntoViewIfNeeded();
  await settledShot(page, `${p}-40-album-archived`);
  await checkNoHorizontalScroll(page, `${p}-archived`);
  await openCatalogTab(page);
  await page.locator('.en-note--done').waitFor();
  await settledShot(page, `${p}-31-detached`, { fullPage: true });
  await checkNoHorizontalScroll(page, `${p}-admin-detached`);
}

try {
  if (FOCUS.has('desktop')) await runC('desktop', VIEWPORTS.desktop, (page) => enrichFlow(page, 'd'));
  if (FOCUS.has('phone')) await runC('phone', VIEWPORTS.phone, (page) => enrichFlow(page, 'p', { phone: true }));
  if (FOCUS.has('detach')) {
    await runC('detach-desktop', VIEWPORTS.desktop, (page) => detachFlow(page, 'd'));
    await runC('detach-phone', VIEWPORTS.phone, (page) => archivedPhone(page, 'p'));
  }

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
      try {
        await page.goto(`file://${demoFile}`);
        await page.waitForSelector('.auth__form', { timeout: 20_000 });
        await page.getByText(/Créer un compte/).first().click();
        await page.fill('#su-email', `demo_c_${name}@example.com`);
        await page.fill('#su-user', `democ_${name}`);
        await page.fill('#su-pw', 'motdepasse123');
        if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', 'motdepasse123');
        for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
        await page.waitForSelector('.field__ok');
        await page.click('button[type=submit]');
        await page.click('.demo-mail .btn');
        await homeAfterWelcome(page, { url: `file://${demoFile}`, navigate: false });
        // Admin de la démo : le rôle est posé dans la sauvegarde (le code de déblocage n'est pas public).
        await page.evaluate(() => {
          const key = 'albummania.demo.v1';
          const data = JSON.parse(localStorage.getItem(key));
          data.users.find((u) => u.id === data.session).role = 'admin';
          localStorage.setItem(key, JSON.stringify(data));
        });
        await page.goto(`file://${demoFile}`);
        await page.waitForFunction(() => /illimités/.test(document.querySelector('.hero')?.textContent || ''), null, { timeout: 20_000 });
        // Album de la graine : le lecteur Spotify est proposé (identifiants de l'instantané), chargé après le clic.
        await page.evaluate(() => [...document.querySelectorAll('a[href="/collection"]')].find((a) => a.offsetParent !== null)?.click());
        const tile = page.locator('a[href="/album/discovery"]').first();
        await tile.waitFor({ timeout: 20_000 });
        await tile.click();
        await page.locator('.en-player').waitFor({ timeout: 20_000 });
        await page.locator('.en-player').getByText('Écouter avec Spotify').waitFor();
        await page.locator('.en-player').scrollIntoViewIfNeeded();
        await settledShot(page, `${p}-80-demo-album-listen`);
        await page.locator('.en-player').getByRole('button', { name: 'Charger le lecteur' }).click();
        await page.locator(`.en-player iframe[src*="${DISCOVERY_SPOTIFY}"]`).waitFor({ state: 'attached' });
        if (name === 'phone') await checkNoHorizontalScroll(page, `${label}-album`);
        // Espace admin : panneau d'enrichissement vivant (passe simulée), simulation du détachement.
        await page.click('.account__btn');
        await page.getByRole('menuitem', { name: 'Admin', exact: true }).click();
        await page.waitForSelector('.sf-admin-tabs');
        await page.locator('.sf-admin-tabs a', { hasText: 'Catalogue' }).click();
        await page.waitForSelector('.en-panel .adm-phase');
        await page.locator('.en-panel').first().getByRole('button', { name: 'Lancer' }).click();
        await page.locator('.en-panel').first().locator('.adm-phase', { hasText: 'En cours' }).waitFor();
        await page.locator('.en-detach').getByRole('button', { name: /^Simuler/ }).click();
        await page.locator('.en-report').waitFor();
        await settledShot(page, `${p}-81-demo-admin`, { fullPage: true });
        if (name === 'phone') await checkNoHorizontalScroll(page, `${label}-admin`);
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
} finally {
  await finish('Parcours P2-C complet sans erreur.');
  fake.server.close();
  await stack?.stop();
}
