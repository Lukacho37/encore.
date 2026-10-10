// Parcours P0-F (PLAN.md 9.3, critère P0.10) : sécurité, notifications, droits sur les données, ordinateur 1440 × 900 et
// téléphone 390 × 844.
//   - « Signaler » une critique depuis le menu ⋯ d'une page album (motifs, précisions) ; « Bloquer » un autre auteur :
//     sa critique disparaît, sa demande d'ami est refusée (404).
//   - Formulaire public /report sans compte (DSA art. 16) : adresse d'une critique résolue vers la critique.
//   - Admin : file des signalements, décision « Masquer » avec exposé des motifs prérempli (les deux signalements du même
//     contenu sont clos), journal, suspensions, pochettes ; contestation de l'auteur puis annulation (contenu rétabli).
//   - Cloche : pastille, panneau des 5 dernières, page /notifications (décision, motif, « Contester ») ; demande d'ami
//     acceptée depuis la cloche ; sur téléphone, la cloche mène à /notifications.
//   - Paramètres : membres bloqués (Débloquer), « Exporter mes données » (fichier JSON), « Supprimer mon compte » (mot de
//     passe + pseudo, retour à la connexion, compte effacé).
//   - Démo autonome (dist-demo/albummania-demo.html) : l'admin de la démo décide d'un signalement d'exemple et d'une
//     contestation.
//   Zéro erreur de console (hors images Deezer bloquées par le bac à sable), pas de défilement horizontal sur téléphone.
//   BASE=http://localhost:5106 DATABASE_FILE=/tmp/am-p0-f/am.db OUT=/tmp/am-p0-f/shots node scripts/e2e/p0-f.mjs
//   (sans BASE : démarre sa propre copie sur 3106 / 5106 avec une copie neuve de $FIXTURE dans /tmp/am-p0-f/am.db)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  ROOT, BASE as INITIAL_BASE, OUT, VIEWPORTS, PASSWORD, ADMIN, run, shot, fail, finish, setBase, startStack,
  checkNoHorizontalScroll, launch, routeFonts, ignoredConsole,
} from './lib.mjs';

let stack = null;
if (!process.env.BASE) {
  stack = await startStack({ id: 'p0-f', apiPort: 3106, webPort: 5106, freshDb: true });
  setBase(stack.base);
}
const BASE = stack ? stack.base : INITIAL_BASE;
const stamp = Date.now().toString(36).slice(-5);
const ALBUM = 'discovery';

// Joueurs créés directement dans la base du site visé, avec une session (pas de limite d'inscription par adresse IP).
const DB_FILE = process.env.DATABASE_FILE || '/tmp/am-p0-f/am.db';
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA busy_timeout = 5000');
const { config } = await import('../../server/config.js');
const { hashPassword } = await import('../../server/security.js');
const PASSWORD_HASH = await hashPassword(PASSWORD);

/** Session ouverte pour un joueur ; renvoie le jeton du cookie. */
function openSession(id) {
  const now = Date.now();
  const token = crypto.randomBytes(24).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(crypto.createHash('sha256').update(token).digest('hex'), id, now, now + 86_400_000);
  return token;
}

/** Joueur vérifié (CGU acceptées, accueil fait, mot de passe PASSWORD) avec une session ; { id, username, email, token }. */
function seedUser(username, email = `${username}@example.com`) {
  const now = Date.now();
  let row = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!row) {
    row = db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at, xp,
        terms_accepted_at, terms_version, onboarded_at) VALUES (?, ?, ?, ?, ?, ?, 2000, ?, ?, ?) RETURNING id`)
      .get(email, username, PASSWORD_HASH, now, now, now - 3 * 86_400_000, now, config.termsVersion, now);
  }
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(row.id);
  return { id: u.id, username: u.username, email, token: openSession(u.id) };
}

/** Appel de l'API avec la session d'un joueur. */
async function callAs(user, method, apiPath, data) {
  const res = await fetch(`${BASE}/api${apiPath}`, {
    method,
    headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json', Cookie: `albummania_sid=${user.token}` },
    ...(data !== undefined && { body: JSON.stringify(data) }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Ouvre la session d'un joueur dans le contexte du navigateur. */
const signIn = (ctx, user) => ctx.addCookies([{ name: 'albummania_sid', value: user.token, url: BASE }]);
/** Attend un message (toast) contenant `text` ; sinon relève `message`. */
async function expectToast(page, text, message) {
  try {
    await page.locator('.toast', { hasText: text }).first().waitFor({ timeout: 10_000 });
  } catch {
    fail(message);
  }
}
const check = (cond, message) => (cond ? null : fail(message));
/** Capture après la fin des transitions (boutons qui viennent de s'activer, puces choisies). */
const settledShot = async (page, file, opts) => {
  await page.waitForTimeout(450);
  await shot(page, file, opts);
};

// ---------- préparation ----------

const author = seedUser(`p0fa_${stamp}`);
const troll = seedUser(`p0ft_${stamp}`);
const player = seedUser(`p0fp_${stamp}`);
const friendly = seedUser(`p0ff_${stamp}`);
const doomed = seedUser(`p0fd_${stamp}`);
const admin = seedUser(ADMIN.username, ADMIN.email);

for (const [who, score, review] of [
  [author, 2, `Disque surcoté ${stamp}, je préfère largement leurs premiers maxis. La production a mal vieilli.`],
  [troll, 1, `Nul ${stamp}. Rien à sauver sur ce disque, franchement.`],
]) {
  const res = await callAs(who, 'PUT', `/ratings/album/${ALBUM}`, { score, review });
  if (res.status !== 200) throw new Error(`critique de ${who.username} : ${res.status} ${JSON.stringify(res.body)}`);
}
const ridOf = (user) => db.prepare("SELECT id FROM ratings WHERE user_id = ? AND item_type = 'album' AND item_id = ?").get(user.id, ALBUM).id;
const authorRid = ridOf(author);
const trollRid = ridOf(troll);

// ---------- 1. signaler une critique, bloquer un auteur ----------

await run('d-report', VIEWPORTS.desktop, async (page, ctx) => {
  await signIn(ctx, player);
  await page.goto(`${BASE}/album/${ALBUM}`);
  const review = page.locator(`#review-${authorRid}`);
  await review.waitFor({ timeout: 20_000 });
  await review.scrollIntoViewIfNeeded();
  await review.locator('.sf-menu__btn').click();
  await page.getByRole('menuitem', { name: 'Signaler' }).click();
  await page.waitForSelector('.sf-dialog .sf-reasons');
  await page.locator('.sf-reason', { hasText: 'Spam ou publicité' }).click();
  await page.fill('.sf-dialog textarea', 'Message publicitaire collé partout.');
  await settledShot(page, 'd-10-report-dialog');
  await page.getByRole('button', { name: 'Envoyer le signalement' }).click();
  await expectToast(page, 'signalement est envoyé', '[d-report] message de confirmation absent');
  const rep = db.prepare("SELECT * FROM reports WHERE reporter_id = ? AND target_type = 'review' AND target_id = ?").get(player.id, String(authorRid));
  check(rep?.reason === 'spam' && rep.status === 'open', '[d-report] signalement non enregistré');
  // Un second signalement du même contenu est refusé (déjà signalé).
  const again = await callAs(player, 'POST', '/reports', { targetType: 'review', targetId: authorRid, reason: 'spam' });
  check(again.status === 409 && again.body?.error === 'already_reported', `[d-report] doublon accepté (${again.status})`);

  // Bloquer l'autre auteur : sa critique disparaît, sa demande d'ami est refusée.
  const trollReview = page.locator(`#review-${trollRid}`);
  await trollReview.scrollIntoViewIfNeeded();
  await trollReview.locator('.sf-menu__btn').click();
  await page.getByRole('menuitem', { name: `Bloquer @${troll.username}` }).click();
  await page.waitForSelector('.sf-dialog .btn--danger');
  await settledShot(page, 'd-11-block-confirm');
  await page.click('.sf-dialog .btn--danger');
  await expectToast(page, 'est bloqué', '[d-report] message de blocage absent');
  await page.reload();
  await review.waitFor();
  check(await trollReview.count() === 0, '[d-report] la critique du joueur bloqué est encore visible');
  const request = await callAs(troll, 'POST', '/friends/request', { username: player.username });
  check(request.status === 404, `[d-report] demande d'ami d'un joueur bloqué acceptée (${request.status})`);
});

// ---------- 2. formulaire public (sans compte) ----------

await run('d-guest-notice', VIEWPORTS.desktop, async (page) => {
  await page.goto(`${BASE}/report`);
  await page.waitForSelector('.sf-report-form');
  await page.getByLabel('Ton nom').fill('Camille Martin');
  await page.getByLabel('Ton adresse e-mail').fill(`camille_${stamp}@example.org`);
  await page.getByLabel('Adresse exacte du contenu').fill(`${BASE}/album/${ALBUM}#review-${authorRid}`);
  await page.getByLabel('Motif').selectOption('spam');
  await page.getByLabel('Explications').fill('Cette critique est une publicité déguisée pour une autre chaîne.');
  await page.locator('.sf-check input').check();
  await settledShot(page, 'd-20-report-guest', { fullPage: true });
  await page.click('.sf-report-form button[type=submit]');
  await page.waitForSelector('.sf-report-done');
  await shot(page, 'd-21-report-guest-done');
  const rep = db.prepare('SELECT * FROM reports WHERE reporter_id IS NULL AND reporter_email = ?').get(`camille_${stamp}@example.org`);
  check(rep?.target_type === 'review' && rep.target_id === String(authorRid) && rep.good_faith === 1, '[d-guest-notice] adresse non résolue vers la critique');
});

await run('m-guest-notice', VIEWPORTS.phone, async (page) => {
  await page.goto(`${BASE}/report`);
  await page.waitForSelector('.sf-report-form');
  await shot(page, 'm-20-report-guest', { fullPage: true });
  await checkNoHorizontalScroll(page, 'm-guest-notice');
});

// ---------- 3. l'admin décide ----------

let actionId = null;
await run('d-admin', VIEWPORTS.desktop, async (page, ctx) => {
  await signIn(ctx, admin);
  await page.goto(`${BASE}/admin/moderation`);
  const repId = db.prepare("SELECT id FROM reports WHERE reporter_id = ? AND target_type = 'review'").get(player.id).id;
  const card = page.locator(`#report-${repId}`);
  await card.waitFor({ timeout: 20_000 });
  check(await page.locator('.sf-admin-tabs .count-badge').count() === 1, '[d-admin] pas de pastille sur l’onglet Modération');
  check((await card.innerText()).includes('2 signalements'), '[d-admin] les deux signalements du même contenu ne sont pas comptés');
  await card.getByRole('radio', { name: 'Masquer' }).click();
  const statement = await card.locator('textarea').inputValue();
  check(statement.includes('Nous avons masqué') && statement.includes('règles de la communauté'), '[d-admin] exposé des motifs non prérempli');
  await card.scrollIntoViewIfNeeded();
  await settledShot(page, 'd-30-admin-queue');
  await card.getByRole('button', { name: 'Masquer le contenu' }).click();
  await expectToast(page, 'Contenu masqué', '[d-admin] confirmation absente');
  await card.waitFor({ state: 'detached' });
  const hidden = db.prepare('SELECT hidden_at FROM ratings WHERE id = ?').get(authorRid).hidden_at;
  check(!!hidden, '[d-admin] la critique n’est pas masquée');
  const open = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE target_type = 'review' AND target_id = ? AND status = 'open'").get(String(authorRid)).n;
  check(open === 0, '[d-admin] le signalement public du même contenu est resté ouvert');
  actionId = db.prepare("SELECT id FROM moderation_actions WHERE target_type = 'review' AND target_id = ? AND action = 'hide'").get(String(authorRid))?.id;
  check(!!actionId, '[d-admin] décision non enregistrée');
  const notified = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'moderation_action'").get(author.id).n;
  check(notified === 1, '[d-admin] auteur non prévenu');
  const resolved = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'report_resolved'").get(player.id).n;
  check(resolved === 1, '[d-admin] auteur du signalement non prévenu');

  // Traités, journal, suspensions, pochettes.
  await page.getByRole('button', { name: /^Traités/ }).click();
  await page.waitForSelector('.sf-case[data-status="actioned"]');
  await settledShot(page, 'd-31-admin-actioned');
  await page.getByRole('button', { name: 'Journal' }).click();
  await page.waitForSelector('.sf-audit');
  check((await page.locator('.sf-audit').innerText()).includes('moderation.hide'), '[d-admin] décision absente du journal');
  await settledShot(page, 'd-32-admin-audit');
  await page.getByRole('button', { name: 'Suspensions' }).click();
  await page.waitForSelector('.sf-mod__view .empty-state, .sf-mod__view .sf-rows');
  await page.goto(`${BASE}/admin/covers`);
  await page.waitForSelector('.sf-covers');
  await shot(page, 'd-33-admin-covers');
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector('.table');
  await shot(page, 'd-34-admin-overview');
});

// ---------- 4. l'auteur : cloche, page des notifications, contestation ----------

await run('d-bell-author', VIEWPORTS.desktop, async (page, ctx) => {
  await signIn(ctx, author);
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.hero');
  const badge = page.locator('.bell .count-badge');
  await badge.waitFor();
  check((await badge.innerText()).trim() === '1', '[d-bell-author] pastille de la cloche incorrecte');
  await page.click('.bell');
  await page.waitForSelector('.notif-panel .notif[data-kind="moderation_action"]');
  await settledShot(page, 'd-40-bell-panel');
  await page.click('.notif-panel__foot a');
  await page.waitForURL('**/notifications');
  const row = page.locator('.notif[data-kind="moderation_action"]');
  await row.waitFor();
  check((await row.innerText()).includes('Nous avons masqué'), '[d-bell-author] exposé des motifs absent de la page');
  await row.getByRole('button', { name: 'Contester' }).click();
  await page.fill('.sf-dialog textarea', 'Ma critique parle de l’album : elle n’a rien d’une publicité.');
  await page.getByRole('button', { name: 'Envoyer', exact: true }).click();
  await expectToast(page, 'Contestation envoyée', '[d-bell-author] contestation non confirmée');
  await row.locator('.chip').waitFor();
  await settledShot(page, 'd-41-notifications');
  const appealed = db.prepare('SELECT appealed_at FROM moderation_actions WHERE id = ?').get(actionId).appealed_at;
  check(!!appealed, '[d-bell-author] contestation non enregistrée');
});

await run('d-admin-appeal', VIEWPORTS.desktop, async (page, ctx) => {
  await signIn(ctx, admin);
  await page.goto(`${BASE}/admin/moderation?view=appeals`);
  const card = page.locator(`#appeal-${actionId}`);
  await card.waitFor({ timeout: 20_000 });
  await settledShot(page, 'd-35-admin-appeal');
  await card.locator('textarea').fill('Après relecture, la critique respecte les règles.');
  await card.getByRole('button', { name: 'Annuler la décision' }).click();
  await expectToast(page, 'Décision annulée', '[d-admin-appeal] confirmation absente');
  await card.waitFor({ state: 'detached' });
  check(!db.prepare('SELECT hidden_at FROM ratings WHERE id = ?').get(authorRid).hidden_at, '[d-admin-appeal] critique non rétablie');
  const told = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'appeal_decided'").get(author.id).n;
  check(told === 1, '[d-admin-appeal] auteur non prévenu de la réponse');
});

// ---------- 5. demande d'ami acceptée depuis la cloche ----------

await run('d-friend', VIEWPORTS.desktop, async (page, ctx) => {
  const sent = await callAs(friendly, 'POST', '/friends/request', { username: player.username });
  check(sent.status === 200, `[d-friend] demande d'ami refusée (${sent.status})`);
  await signIn(ctx, player);
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.bell .count-badge');
  await page.click('.bell');
  const row = page.locator('.notif-panel .notif[data-kind="friend_request"]');
  await row.waitFor();
  await settledShot(page, 'd-50-bell-friend');
  await row.getByRole('button', { name: 'Accepter' }).click();
  await expectToast(page, 'maintenant amis', '[d-friend] acceptation non confirmée');
  const f = db.prepare('SELECT status FROM friendships WHERE requester_id = ? AND addressee_id = ?').get(friendly.id, player.id);
  check(f?.status === 'accepted', '[d-friend] amitié non acceptée');
});

// ---------- 6. paramètres : bloqués, export, suppression ----------

await run('d-settings', VIEWPORTS.desktop, async (page, ctx) => {
  await signIn(ctx, player);
  await page.goto(`${BASE}/settings`);
  const blocked = page.locator('#blocked');
  await blocked.waitFor({ timeout: 20_000 });
  await blocked.getByText(troll.username).waitFor();
  await blocked.scrollIntoViewIfNeeded();
  await shot(page, 'd-60-settings', { fullPage: true });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Télécharger mes données' }).click(),
  ]);
  check(/^albummania-p0fp_.*\.json$/.test(download.suggestedFilename()), `[d-settings] nom du fichier exporté : ${download.suggestedFilename()}`);
  const file = await download.path();
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of ['profile', 'settings', 'cards', 'achievements', 'ratings', 'friendships', 'blocks', 'notifications', 'reportsMade', 'moderationDecisions']) {
    check(key in data, `[d-settings] section « ${key} » absente de l’export`);
  }
  check(data.blocks?.some((b) => b.username === troll.username), '[d-settings] blocage absent de l’export');
  check(data.reportsMade?.length >= 1, '[d-settings] signalement absent de l’export');
  await blocked.getByRole('button', { name: 'Débloquer' }).click();
  await expectToast(page, 'débloqué', '[d-settings] déblocage non confirmé');
  await blocked.getByText('Tu n’as bloqué personne.').waitFor();
});

await run('d-delete', VIEWPORTS.desktop, async (page, ctx) => {
  await signIn(ctx, doomed);
  await page.goto(`${BASE}/settings`);
  await page.locator('#delete').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Supprimer mon compte…' }).click();
  await page.getByLabel('Ton mot de passe').fill(PASSWORD);
  await page.getByLabel(/Tape ton pseudo/).fill(doomed.username);
  await settledShot(page, 'd-61-delete-account');
  await page.getByRole('button', { name: 'Supprimer définitivement' }).click();
  await page.waitForURL('**/login', { timeout: 15_000 });
  check(!db.prepare('SELECT 1 FROM users WHERE id = ?').get(doomed.id), '[d-delete] compte encore présent');
  check(!!db.prepare("SELECT 1 FROM admin_audit WHERE action = 'account_deleted' AND target = ?").get(`user:${doomed.id}`), '[d-delete] suppression absente du journal');
});

// ---------- 7. téléphone ----------

await run('m-author', VIEWPORTS.phone, async (page, ctx) => {
  await signIn(ctx, author);
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.hero');
  await page.click('a.bell');
  await page.waitForURL('**/notifications');
  await page.waitForSelector('.notif');
  await shot(page, 'm-40-notifications', { fullPage: true });
  await checkNoHorizontalScroll(page, 'm-author notifications');
});

await run('m-settings', VIEWPORTS.phone, async (page, ctx) => {
  await signIn(ctx, player);
  await page.goto(`${BASE}/settings`);
  await page.locator('#blocked').waitFor({ timeout: 20_000 });
  await page.locator('#blocked').scrollIntoViewIfNeeded();
  await shot(page, 'm-60-settings');
  await checkNoHorizontalScroll(page, 'm-settings');
});

await run('m-admin', VIEWPORTS.phone, async (page, ctx) => {
  await signIn(ctx, admin);
  await page.goto(`${BASE}/admin/moderation?view=reports`);
  await page.waitForSelector('.sf-mod__views');
  await page.getByRole('button', { name: /^Traités/ }).click();
  await page.waitForSelector('.sf-case');
  await settledShot(page, 'm-30-admin-moderation', { fullPage: true });
  await checkNoHorizontalScroll(page, 'm-admin');
  await page.goto(`${BASE}/album/${ALBUM}`);
  const review = page.locator(`#review-${authorRid}`);
  await review.waitFor({ timeout: 20_000 });
  await review.scrollIntoViewIfNeeded();
  await review.locator('.sf-menu__btn').click();
  await page.getByRole('menuitem', { name: 'Signaler' }).waitFor();
  await settledShot(page, 'm-10-safety-menu');
  await checkNoHorizontalScroll(page, 'm-admin album');
});

// ---------- 8. démo autonome ----------

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
      await page.fill('#su-email', `demo_f_${name}@example.com`);
      await page.fill('#su-user', `demof_${name}`);
      await page.fill('#su-pw', PASSWORD);
      if (await page.locator('#su-confirm').count()) await page.fill('#su-confirm', PASSWORD);
      for (const box of await page.locator('.auth__form input[type=checkbox]').all()) await box.check();
      await page.waitForSelector('.field__ok');
      await page.click('button[type=submit]');
      await page.click('.demo-mail .btn');
      await page.waitForSelector('.hero');
      // Admin de la démo : le rôle est posé dans la sauvegarde (le code de déblocage n'est pas public).
      await page.evaluate(() => {
        const key = 'albummania.demo.v1';
        const data = JSON.parse(localStorage.getItem(key));
        data.users.find((u) => u.id === data.session).role = 'admin';
        localStorage.setItem(key, JSON.stringify(data));
      });
      await page.goto(`file://${demoFile}`);
      // L'accueil s'affiche d'abord avec l'état gardé en mémoire : on attend l'état rechargé (rôle admin).
      await page.waitForFunction(() => /illimités/.test(document.querySelector('.hero')?.textContent || ''), null, { timeout: 20_000 });
      await page.click('.account__btn');
      await page.getByRole('menuitem', { name: 'Admin', exact: true }).click();
      await page.waitForSelector('.sf-admin-tabs');
      await page.locator('.sf-admin-tabs a', { hasText: 'Modération' }).click();
      const card = page.locator('.sf-case').filter({ hasText: 'Critique' }).first();
      await card.waitFor();
      await card.getByRole('radio', { name: 'Masquer' }).click();
      await settledShot(page, `${name === 'desktop' ? 'd' : 'm'}-70-demo-moderation`);
      await card.getByRole('button', { name: 'Masquer le contenu' }).click();
      await page.waitForSelector('.toast');
      await page.getByRole('button', { name: /^Contestations/ }).click();
      const appeal = page.locator('.sf-case').first();
      await appeal.waitFor();
      await appeal.getByRole('button', { name: 'Annuler la décision' }).click();
      await page.waitForSelector('.toast');
      if (name === 'phone') await checkNoHorizontalScroll(page, label);
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
await finish('Parcours P0-F sans erreur.');
if (stack) await stack.stop();
