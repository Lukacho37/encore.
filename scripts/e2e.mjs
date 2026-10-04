// Parcours de bout en bout avec un vrai navigateur + captures d'écran.
// Usage : BASE=http://localhost:3100 OUT=./shots node scripts/e2e.mjs
// Le serveur doit tourner sans SMTP (boîte e-mail de test) et avec ADMIN_EMAILS=luka@example.com.
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = process.env.OUT || 'shots';
const executablePath = process.env.CHROMIUM || undefined;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath });
const errors = [];

async function run(name, viewport, fn) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'fr-FR' });
  // Derrière un proxy qui intercepte le TLS, le navigateur de test ne fait pas confiance aux polices Google :
  // ROUTE_FONTS_VIA_CURL=1 les télécharge avec curl (qui utilise le magasin de certificats du système).
  if (process.env.ROUTE_FONTS_VIA_CURL) {
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (route) => {
      const body = execFileSync('curl', ['-sS', '-A', 'Mozilla/5.0 Chrome/140', route.request().url()]);
      const type = route.request().url().includes('googleapis') ? 'text/css' : 'font/woff2';
      route.fulfill({ status: 200, body, headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  // Le 401 sur /api/state avant connexion est attendu.
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('401') && errors.push(`[${name}] console: ${m.text()}`));
  try {
    await fn(page);
  } finally {
    await ctx.close();
  }
}

const shot = (page, file) => page.screenshot({ path: `${OUT}/${file}.png`, fullPage: false });

async function signup(page, email, username) {
  await page.goto(`${BASE}/signup`);
  await page.fill('#su-email', email);
  await page.fill('#su-user', username);
  await page.fill('#su-pw', 'motdepasse123');
  await page.fill('#su-confirm', 'motdepasse123');
  await page.waitForSelector('.field__ok');
  await page.click('button[type=submit]');
  await page.waitForURL('**/check-email');
  const mails = await (await page.request.get(`${BASE}/api/dev/emails`)).json();
  const mail = mails.find((m) => m.to === email);
  const token = /token=([\w-]+)/.exec(mail.text)[1];
  await page.goto(`${BASE}/verify?token=${token}`);
  await page.waitForSelector('.hero');
}

await run('desktop', { width: 1280, height: 820 }, async (page) => {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('.auth__form');
  await page.waitForTimeout(400);
  await shot(page, '01-login');

  await page.goto(`${BASE}/signup`);
  await page.fill('#su-email', 'luka@example.com');
  await page.fill('#su-user', 'luka');
  await page.fill('#su-pw', 'motdepasse123');
  await page.fill('#su-confirm', 'motdepasse123');
  await page.waitForSelector('.field__ok');
  await shot(page, '02-signup');
  await page.click('button[type=submit]');
  await page.waitForURL('**/check-email');
  await shot(page, '03-check-email');

  await page.goto(`${BASE}/dev/mailbox`);
  await page.waitForSelector('.mail__row');
  await page.click('.mail__row');
  await shot(page, '04-mailbox');
  await page.click('.mail__body .btn');
  await page.waitForSelector('.hero');
  await page.waitForTimeout(500);
  await shot(page, '05-home');

  // Ouverture d'un booster
  await page.click('.hero__actions .btn--primary');
  await page.waitForSelector('.opening');
  await page.waitForTimeout(400);
  await shot(page, '06-pack');
  await page.click('.opening__pack-btn');
  await page.waitForSelector('.reveal-card', { timeout: 5000 });
  await page.waitForTimeout(500);
  await shot(page, '07-reveal-back');
  for (let i = 0; i < 5; i++) {
    await page.click('.opening__stage');
    await page.waitForTimeout(900);
    if (i === 0 || i === 4) await shot(page, `08-reveal-front-${i}`);
    await page.click('.opening__stage');
    await page.waitForTimeout(450);
  }
  await page.waitForSelector('.summary');
  await page.waitForTimeout(900);
  await shot(page, '09-summary');
  await page.click('.summary__actions .btn--ghost');

  // Admin : 10 boosters d'un coup
  await page.click('.hero__actions .btn--ghost');
  await page.click('.opening__pack-btn');
  await page.waitForSelector('.summary', { timeout: 8000 });
  await page.waitForTimeout(1200);
  await shot(page, '10-summary-x10');
  await page.click('.summary__actions .btn--ghost');

  await page.goto(`${BASE}/collection`);
  await page.waitForSelector('.album-grid');
  await page.waitForTimeout(300);
  await shot(page, '11-collection');

  await page.goto(`${BASE}/album/the-college-dropout`);
  await page.waitForSelector('.album-head');
  await page.waitForTimeout(300);
  await shot(page, '12-album-college-dropout');
  await page.click('.card-grid .card');
  await page.waitForSelector('.card-detail');
  await page.waitForTimeout(300);
  await shot(page, '13-card-modal');
  // Note du morceau depuis la fiche (4 étoiles = 8/10)
  const stars = await page.locator('.track-rating .star-input__stars').boundingBox();
  await page.mouse.click(stars.x + stars.width * 0.78, stars.y + stars.height / 2);
  await page.waitForTimeout(500);
  await shot(page, '13b-card-rated');
  await page.keyboard.press('Escape');

  // Note + critique de l'album
  await page.locator('#critiques').scrollIntoViewIfNeeded();
  const albumStars = await page.locator('.album-ratings .star-input__stars').boundingBox();
  await page.mouse.click(albumStars.x + albumStars.width * 0.95, albumStars.y + albumStars.height / 2);
  await page.fill('#review-f', 'Le premier Kanye reste le plus attachant : des boucles soul, de l’humour et Jesus Walks.');
  await page.click('.album-ratings .review-editor__actions .btn--primary');
  await page.waitForTimeout(600);
  await shot(page, '12b-album-review');
  // Vue tracklist
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('.toolbar .seg__btn:nth-child(2)');
  await page.waitForSelector('.tracklist');
  await page.waitForTimeout(300);
  await shot(page, '12c-tracklist');

  // Guide des raretés
  await page.goto(`${BASE}/collection`);
  await page.click('.rarity-help .link-btn');
  await page.waitForSelector('.rarity-guide');
  await page.waitForTimeout(300);
  await shot(page, '11b-rarity-guide');
  await page.keyboard.press('Escape');

  // Admin : album presque complet puis pressage de la dernière carte
  await page.goto(`${BASE}/admin`);
  await page.waitForSelector('.table');
  await shot(page, '14-admin');
  await page.selectOption('#admin-album', 'discovery');
  await page.click('.admin-tools--row .btn--ghost');
  await page.waitForTimeout(400);
  await page.request.post(`${BASE}/api/admin/users/1/grant`, { headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json' }, data: { royalties: 5000 } });
  await page.goto(`${BASE}/album/discovery`);
  await page.waitForSelector('.press-btn');
  await page.click('.press-btn');
  await page.waitForSelector('.press__actions .btn--primary');
  await page.click('.press__actions .btn--primary');
  await page.waitForSelector('.celebrate');
  await page.waitForTimeout(600);
  await shot(page, '15-album-complete');
  await page.click('.celebrate .btn');
  await page.waitForTimeout(300);
  await shot(page, '15b-album-vinyl-header');

  // Profil : photo de profil + studio
  await page.goto(`${BASE}/profile`);
  await page.waitForSelector('.profile-head');
  await page.click('.profile-head__edit');
  await page.waitForSelector('.avatar-picker');
  await page.click('.cover-pick:not(.is-locked)');
  await shot(page, '16-avatar-picker');
  await page.click('.avatar-picker .modal__actions .btn--primary');
  await page.waitForTimeout(400);
  await page.waitForSelector('.vinyl-shelf .vinyl');
  await shot(page, '16b-vinyl-shelf');
  await page.click('.vinyl-shelf button.vinyl');
  await page.waitForSelector('.turntable');
  await page.click('.turntable__start');
  await page.waitForTimeout(1400);
  await shot(page, '16c-turntable');
  await page.keyboard.press('Escape');
  await page.click('.showcase__empty');
  await page.waitForSelector('.card-grid--picker');
  await page.click('.card-grid--picker .card');
  await page.waitForTimeout(500);
  await shot(page, '17-profile-studio');
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(200);
  await shot(page, '18-profile-studio-scrolled');

  // Langue anglaise
  await page.click('.topbar .seg__btn:nth-child(2)');
  await page.goto(`${BASE}/collection/artists`);
  await page.waitForSelector('.artist-list');
  await shot(page, '19-artists-en');
  await page.click('.topbar .seg__btn:nth-child(1)');

  // Blind test
  await page.goto(`${BASE}/blindtest`);
  await page.waitForSelector('.genre-grid');
  await page.click('.genre-btn--rap');
  await shot(page, '20-blindtest-intro');
  await page.click('.bt-intro .btn--xl');
  await page.waitForSelector('.bt-choices');
  await page.waitForTimeout(4500);
  await shot(page, '21-blindtest-round');
  await page.click('.bt-choice');
  await page.waitForSelector('.bt-result');
  await shot(page, '22-blindtest-answer');
});

// Deuxième joueur : demande d'ami
await run('friend', { width: 1280, height: 820 }, async (page) => {
  await signup(page, 'nino@example.com', 'nino_beats');
  await page.goto(`${BASE}/friends`);
  await page.fill('#friend-name', 'luka');
  await page.click('.add-friend .btn');
  await page.waitForSelector('.form-ok');
  await shot(page, '23-friends-sent');
  // nino note un album avec une critique : elle apparaîtra dans l'activité de luka
  await page.request.put(`${BASE}/api/ratings/album/discovery`, {
    headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json' },
    data: { score: 9, review: 'Toujours aussi lumineux, vingt-cinq ans après.' },
  });
  // un joueur ordinaire n'a pas accès à l'admin
  const adminRes = await page.request.get(`${BASE}/api/admin/overview`);
  if (adminRes.status() !== 403) errors.push(`[friend] admin accessible (${adminRes.status()})`);
});

await run('mobile', { width: 390, height: 844 }, async (page) => {
  await page.goto(`${BASE}/login`);
  await page.fill('#login-id', 'luka');
  await page.fill('#login-pw', 'motdepasse123');
  await shot(page, '30-m-login');
  await page.click('button[type=submit]');
  await page.waitForSelector('.hero');
  await page.waitForTimeout(400);
  await shot(page, '31-m-home');
  await page.click('.account__btn');
  await page.waitForSelector('.menu');
  await shot(page, '32-m-menu');
  await page.click('.menu__item[href="/friends"]');
  await page.waitForSelector('.friend-list');
  await shot(page, '33-m-friends');
  await page.click('.friend-list .btn--primary');
  await page.waitForTimeout(400);
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.feed');
  await page.locator('.feed').scrollIntoViewIfNeeded();
  await shot(page, '33b-m-feed');

  await page.goto(`${BASE}/`);
  await page.click('.hero__actions .btn--primary');
  await page.click('.opening__pack-btn');
  await page.waitForSelector('.reveal-card', { timeout: 5000 });
  await page.waitForTimeout(400);
  await shot(page, '34-m-reveal-back');
  await page.click('.opening__stage');
  await page.waitForTimeout(900);
  await shot(page, '35-m-reveal-front');
  await page.click('.opening__bar .btn');
  await page.waitForSelector('.summary');
  await page.waitForTimeout(900);
  await shot(page, '36-m-summary');
  await page.click('.summary__actions .btn--ghost');

  await page.goto(`${BASE}/album/discovery`);
  await page.waitForSelector('.album-head');
  await shot(page, '37-m-album');
  await page.goto(`${BASE}/profile`);
  await page.waitForSelector('.profile-head');
  await shot(page, '38-m-profile');
  await page.goto(`${BASE}/u/nino_beats`);
  await page.waitForSelector('.profile-head');
  await shot(page, '39-m-friend-profile');
  await page.goto(`${BASE}/blindtest`);
  await page.waitForSelector('.genre-grid');
  await shot(page, '40-m-blindtest');
  await page.goto(`${BASE}/collection`);
  await page.waitForSelector('.album-grid');
  await shot(page, '41-m-collection');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) errors.push('[mobile] horizontal overflow on /collection');
});

await browser.close();
if (errors.length) {
  console.log('ERREURS :\n' + errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Parcours complet sans erreur.');
}
