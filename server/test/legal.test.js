// Inscription, connexion et informations légales (PLAN.md 4.1.5, 7.1, 7.2 ; chantier P0-D) : cases CGU et âge,
// inscription sans fuite des adresses inscrites, frein de connexion par identifiant, hachage refait à la connexion,
// événement `user.verified`, GET /api/legal/info et POST /api/legal/accept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { startApp, signupVerified, api, PASSWORD } from './helpers.js';

process.env.ADMIN_EMAILS = 'boss@example.com';
const { createAuth, LOGIN_FAILURES } = await import('../auth.js');
const { createMailer } = await import('../mailer.js');
const { hashPassword, needsRehash } = await import('../security.js');
const { legalInfo, providersOf } = await import('../legal.js');
const { config } = await import('../config.js');

const app = await startApp();
test.after(() => app.close());

const mails = (email) => app.db.prepare('SELECT COUNT(*) AS n FROM dev_emails WHERE to_addr = ?').get(email).n;
const signup = (body) => api(app.base, '', 'POST', '/auth/signup', { password: PASSWORD, ...body });

test('inscription : CGU et âge obligatoires, chacun avec son erreur ; acceptation enregistrée avec la version', async () => {
  const base = { email: 'cgu@example.com', username: 'cgu' };
  const none = await signup(base);
  assert.equal(none.status, 400);
  assert.equal(none.body.error, 'terms_required');
  const noAge = await signup({ ...base, acceptTerms: true });
  assert.equal(noAge.status, 400);
  assert.equal(noAge.body.error, 'age_required');
  // Une valeur « vraie » qui n'est pas true (case mal envoyée) ne vaut pas acceptation.
  assert.equal((await signup({ ...base, acceptTerms: 'yes', age15: true })).body.error, 'terms_required');
  assert.equal((await signup({ ...base, acceptTerms: true, age15: 1 })).body.error, 'age_required');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('cgu@example.com').n, 0, 'aucun compte créé');

  const before = Date.now();
  const ok = await signup({ ...base, acceptTerms: true, age15: true });
  assert.equal(ok.status, 201);
  const row = app.db.prepare('SELECT terms_accepted_at, terms_version FROM users WHERE email = ?').get('cgu@example.com');
  assert.ok(row.terms_accepted_at >= before);
  assert.equal(row.terms_version, config.termsVersion);
});

test('inscription sans fuite : une adresse déjà confirmée reçoit la même réponse, son titulaire est prévenu', async () => {
  const owner = await signupVerified(app, { email: 'deja@example.com', username: 'deja' });
  const fresh = await signup({ email: 'nouveau@example.com', username: 'nouveau', acceptTerms: true, age15: true });
  // L'e-mail de confirmation vient de partir : on recule l'horloge des envois (au plus un e-mail par minute).
  app.db.prepare('UPDATE users SET last_mail_at = 0 WHERE id = ?').run(owner.user.id);
  const before = mails('deja@example.com');
  const again = await signup({ email: 'Deja@Example.com', username: 'autrepseudo', acceptTerms: true, age15: true });
  assert.equal(again.status, 201, 'même statut qu’une inscription réussie');
  assert.deepEqual(Object.keys(again.body).sort(), Object.keys(fresh.body).sort(), 'même forme de réponse');
  assert.equal(again.body.email, 'deja@example.com');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM users WHERE username = ?').get('autrepseudo').n, 0, 'aucun compte créé');
  assert.equal(mails('deja@example.com'), before + 1, 'le titulaire reçoit un e-mail');
  // Au plus un e-mail par minute : une rafale de tentatives ne sert pas à inonder la boîte du titulaire.
  assert.equal((await signup({ email: 'deja@example.com', username: 'autrepseudo2', acceptTerms: true, age15: true })).status, 201);
  assert.equal(mails('deja@example.com'), before + 1);
  // Le compte existant n'est pas touché : il se connecte toujours avec son mot de passe.
  assert.equal((await api(app.base, '', 'POST', '/auth/login', { identifier: 'deja', password: PASSWORD })).status, 200);
  // Un pseudo pris répond pareil quelle que soit l'adresse (le pseudo est public, l'adresse ne l'est pas).
  assert.equal((await signup({ email: 'deja@example.com', username: owner.username, acceptTerms: true, age15: true })).body.error, 'username_taken');
  assert.equal((await signup({ email: 'inconnu@example.com', username: owner.username, acceptTerms: true, age15: true })).body.error, 'username_taken');
});

test('connexion : frein par identifiant (5 échecs en 15 min), sans casse, sans gêner les autres comptes', async () => {
  await signupVerified(app, { email: 'frein@example.com', username: 'frein' });
  await signupVerified(app, { email: 'voisin@example.com', username: 'voisin' });
  const login = (identifier, password) => api(app.base, '', 'POST', '/auth/login', { identifier, password });
  for (let i = 0; i < LOGIN_FAILURES.max; i += 1) {
    assert.equal((await login(i % 2 ? 'FREIN' : 'frein', 'mauvais')).status, 401, `échec ${i + 1}`);
  }
  const blocked = await login('frein', PASSWORD);
  assert.equal(blocked.status, 429, 'même avec le bon mot de passe, l’identifiant attend');
  assert.equal(blocked.body.error, 'rate_limited');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  // L'adresse e-mail du compte est un autre identifiant (le frein protège ce qui est tapé, pas le compte).
  assert.equal((await login('voisin', PASSWORD)).status, 200, 'un autre compte n’est pas freiné');
});

test('frein par identifiant : la fenêtre passée, l’identifiant est libre ; un succès remet le compteur à zéro', async () => {
  // Authentification montée seule avec une horloge factice, sur la base de l'application de test.
  let clock = Date.now();
  const auth = createAuth(app.db, createMailer(app.db), app.services, { now: () => clock });
  const mini = express();
  mini.use(express.json());
  mini.use('/api/auth', auth.router);
  mini.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.code || 'server_error' }));
  const server = mini.listen(0);
  await once(server, 'listening');
  const base = `http://localhost:${server.address().port}`;
  try {
    await signupVerified(app, { email: 'horloge@example.com', username: 'horloge' });
    const login = (password) => api(base, '', 'POST', '/auth/login', { identifier: 'horloge', password });
    for (let i = 0; i < LOGIN_FAILURES.max - 1; i += 1) assert.equal((await login('mauvais')).status, 401);
    assert.equal((await login(PASSWORD)).status, 200, 'sous le seuil, le bon mot de passe passe');
    for (let i = 0; i < LOGIN_FAILURES.max - 1; i += 1) assert.equal((await login('mauvais')).status, 401);
    assert.equal((await login(PASSWORD)).status, 200, 'le succès a remis le compteur à zéro');
    for (let i = 0; i < LOGIN_FAILURES.max; i += 1) assert.equal((await login('mauvais')).status, 401);
    assert.equal((await login(PASSWORD)).status, 429);
    clock += LOGIN_FAILURES.windowMs + 1;
    assert.equal((await login(PASSWORD)).status, 200, 'fenêtre passée : libre');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('mot de passe : un ancien hachage plus faible est refait à la connexion', async () => {
  const me = await signupVerified(app, { email: 'ancien@example.com', username: 'ancien' });
  const weak = await hashPassword(PASSWORD, { N: 2 ** 12 });
  assert.equal(needsRehash(weak), true);
  app.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(weak, me.user.id);
  assert.equal((await api(app.base, '', 'POST', '/auth/login', { identifier: 'ancien', password: PASSWORD })).status, 200);
  const stored = app.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(me.user.id).password_hash;
  assert.notEqual(stored, weak);
  assert.equal(needsRehash(stored), false);
  // Le nouveau hachage marche, l'ancien mot de passe aussi (même mot de passe, coût plus élevé).
  assert.equal((await api(app.base, '', 'POST', '/auth/login', { identifier: 'ancien', password: PASSWORD })).status, 200);
  assert.equal(app.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(me.user.id).password_hash, stored, 'pas refait à chaque connexion');
});

test('`user.verified` : émis une fois, à la première confirmation de l’adresse', async () => {
  const seen = [];
  const off = app.deps.bus.on('user.verified', (p) => seen.push(p.userId));
  try {
    const me = await signupVerified(app, { email: 'bienvenue@example.com', username: 'bienvenue' });
    assert.deepEqual(seen, [me.user.id]);
    // Mot de passe oublié sur un compte déjà confirmé : pas de second événement.
    app.db.prepare('UPDATE users SET last_mail_at = 0 WHERE id = ?').run(me.user.id);
    await api(app.base, '', 'POST', '/auth/forgot', { email: 'bienvenue@example.com' });
    const mail = app.db.prepare("SELECT text FROM dev_emails WHERE to_addr = ? AND text LIKE '%/reset?token=%' ORDER BY id DESC LIMIT 1").get('bienvenue@example.com');
    const token = /token=([\w-]+)/.exec(mail.text)[1];
    assert.equal((await api(app.base, '', 'POST', '/auth/reset', { token, password: 'nouveaumotdepasse' })).status, 200);
    assert.deepEqual(seen, [me.user.id]);
  } finally {
    off();
  }
});

test('GET /api/legal/info : public, en cache une heure, forme du plan, aucune donnée de compte', async () => {
  const r = await api(app.base, '', 'GET', '/legal/info');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /public, max-age=3600/);
  for (const k of ['editor', 'publicationDirector', 'host', 'contactEmail', 'termsVersion', 'termsUpdatedAt', 'shareCovers', 'providers']) {
    assert.ok(k in r.body, k);
  }
  assert.deepEqual(Object.keys(r.body.editor).sort(), ['address', 'email', 'name']);
  assert.deepEqual(Object.keys(r.body.host).sort(), ['address', 'name', 'phone']);
  assert.equal(r.body.termsVersion, config.termsVersion);
  assert.ok(Array.isArray(r.body.providers));
});

test('informations légales : variables LEGAL_*, pochettes partagées, plateformes', () => {
  const cfg = {
    termsVersion: '2026-11-01', termsUpdatedAt: '2026-11-01', shareCovers: 'deezer', covers: 'auto', spotify: null, catalogImport: 'off',
    legal: {
      editor: { name: 'Luka M.', address: '1 rue de la Musique, Paris', email: 'contact@albummania.fr' },
      publicationDirector: 'Luka M.',
      host: { name: 'Render', address: 'San Francisco', phone: '+1 000' },
      contactEmail: 'contact@albummania.fr',
    },
  };
  const info = legalInfo(cfg);
  assert.equal(info.editor.name, 'Luka M.');
  assert.equal(info.host.name, 'Render');
  assert.equal(info.shareCovers, 'deezer');
  assert.deepEqual(info.providers, ['deezer']);
  assert.equal(legalInfo({ ...cfg, shareCovers: false, legal: {} }).shareCovers, false);
  assert.equal(legalInfo({ ...cfg, legal: {} }).editor.name, null, 'champ absent = null, jamais undefined');
  // Plateformes : mêmes règles que server/covers.js, plus Deezer pour le catalogue importé.
  assert.deepEqual(providersOf({ covers: 'off', catalogImport: 'off' }), []);
  assert.deepEqual(providersOf({ covers: 'off', catalogImport: 'deezer' }), ['deezer']);
  assert.deepEqual(providersOf({ covers: 'off', catalogImport: 'off' }, { imported: true }), ['deezer']);
  assert.deepEqual(providersOf({ covers: 'auto', spotify: { clientId: 'a' }, catalogImport: 'off' }), ['spotify', 'deezer']);
  assert.deepEqual(providersOf({ covers: 'spotify', spotify: null, catalogImport: 'off' }), []);
});

test('POST /api/legal/accept : version en vigueur seulement ; termsOk revient dans l’état partiel', async () => {
  const me = await signupVerified(app, { email: 'accept@example.com', username: 'accept' });
  // Compte d'avant le changement de CGU.
  app.db.prepare("UPDATE users SET terms_version = '2020-01-01' WHERE id = ?").run(me.user.id);
  const state = await api(app.base, me.cookie, 'GET', '/state');
  assert.equal(state.body.user.termsOk, false);
  assert.equal((await api(app.base, '', 'POST', '/legal/accept', { version: config.termsVersion })).status, 401, 'connecté seulement');
  const empty = await api(app.base, me.cookie, 'POST', '/legal/accept', {});
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, 'invalid_input');
  const old = await api(app.base, me.cookie, 'POST', '/legal/accept', { version: '2020-01-01' });
  assert.equal(old.status, 409);
  assert.equal(old.body.error, 'terms_outdated');
  assert.equal(old.body.termsVersion, config.termsVersion);
  const ok = await api(app.base, me.cookie, 'POST', '/legal/accept', { version: config.termsVersion });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.state.partial, true);
  assert.equal(ok.body.state.user.termsOk, true);
  assert.equal(app.db.prepare('SELECT terms_version FROM users WHERE id = ?').get(me.user.id).terms_version, config.termsVersion);
});
