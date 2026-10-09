// Comptes : inscription (e-mail + nom d'utilisateur unique + mot de passe, CGU acceptées et 15 ans ou plus),
// vérification d'e-mail, connexion, sessions par cookie HttpOnly, mot de passe oublié (PLAN.md 4.1.5, 7.2).
// - Inscription sans fuite des adresses inscrites : une adresse déjà confirmée reçoit la même réponse qu'une
//   inscription réussie, et son titulaire est prévenu par e-mail.
// - Connexion freinée par identifiant (5 échecs en 15 minutes), en plus de la limite par adresse IP.
// - Mots de passe en scrypt N = 2^17 ; un ancien hachage plus faible est refait à la connexion.
// - Première confirmation d'adresse : événement `user.verified` sur le bus (accueil des nouveaux joueurs, P1).
import express from 'express';
import { config, SESSION_DAYS, VERIFY_TOKEN_HOURS, RESET_TOKEN_MINUTES } from './config.js';
import { hashPassword, verifyPassword, needsRehash, dummyHash, newToken, sha256, parseCookies, rateLimit } from './security.js';
import { tx } from './db.js';
import { HttpError } from './services.js';
import { validateEmail, validatePassword, validateUsername } from '../shared/rules.js';

export const COOKIE = 'albummania_sid';
// Posé à l'inscription : le navigateur qui a créé le compte peut le vérifier sans retaper le mot de passe.
const SIGNUP_COOKIE = 'albummania_signup';

/** Frein par identifiant (PLAN.md 7.2) : au-delà de 5 échecs en 15 minutes, l'identifiant attend la fin de la fenêtre. */
export const LOGIN_FAILURES = { max: 5, windowMs: 15 * 60_000 };

// L'authentification est créée par app.js avant les modules : le module « legal » lui transmet leurs dépendances
// (bus d'événements…) à son initialisation, rangées par base de données (une application par base, en test aussi).
const MODULE_DEPS = new WeakMap();
/** Appelé par server/legal.js (init) : donne à l'authentification de cette base le bus des modules. */
export function bindAuthDeps(deps) {
  if (deps?.db) MODULE_DEPS.set(deps.db, deps);
}

/** Clé du frein de connexion : l'identifiant tel que la base le compare (adresse et pseudo sans casse). */
const identifierKey = (identifier) => String(identifier || '').trim().toLowerCase().slice(0, 320);

/**
 * `bus` (facultatif) : bus d'événements du domaine ; sans lui, celui que server/legal.js a branché pour cette base.
 * `now` : horloge (tests du frein de connexion).
 */
export function createAuth(db, mailer, services, { bus = null, now = Date.now } = {}) {
  const q = (sql) => db.prepare(sql);
  const emit = (event, payload) => (bus || MODULE_DEPS.get(db)?.bus)?.emit(event, payload);

  function setCookie(res, name, value, maxAgeMs) {
    const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
    // « Secure » dès que le site est servi en https, pas seulement avec NODE_ENV=production (PLAN.md 7.2).
    if (config.secureCookies) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }
  const setSessionCookie = (res, token, maxAgeMs) => setCookie(res, COOKIE, token, maxAgeMs);

  function startSession(res, userId) {
    const token = newToken();
    const at = Date.now();
    const ttl = SESSION_DAYS * 86_400_000;
    q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, at, at + ttl);
    setSessionCookie(res, token, ttl);
  }

  function issueToken(userId, purpose, ttlMs) {
    const token = newToken();
    q('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
    q('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
      sha256(token), userId, purpose, Date.now() + ttlMs, Date.now(),
    );
    return token;
  }

  function consumeToken(token, purpose) {
    if (typeof token !== 'string' || token.length < 20) return null;
    const row = q('SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = ?').get(sha256(token), purpose);
    if (!row) return null;
    q('DELETE FROM email_tokens WHERE token_hash = ?').run(row.token_hash);
    if (row.expires_at < Date.now()) return null;
    return row.user_id;
  }

  /** Un e-mail au plus par minute et par compte (renvoi, mot de passe oublié, tentative d'inscription). */
  function mailAllowed(user) {
    if (Date.now() - (user.last_mail_at || 0) <= 60_000) return false;
    q('UPDATE users SET last_mail_at = ? WHERE id = ?').run(Date.now(), user.id);
    return true;
  }

  /** Première confirmation de l'adresse (lien de l'e-mail, ou lien de réinitialisation) : prévient les modules. */
  function verifiedNow(userId) {
    emit('user.verified', { userId });
  }

  // ----- frein de connexion par identifiant ------------------------------------------------------------------
  const failures = new Map();
  setInterval(() => {
    const t = now();
    for (const [k, v] of failures) if (v.reset <= t) failures.delete(k);
  }, LOGIN_FAILURES.windowMs).unref();

  /** Millisecondes à attendre avant de retenter cet identifiant (0 : libre). */
  function loginWait(key) {
    const entry = failures.get(key);
    if (!entry) return 0;
    if (entry.reset <= now()) {
      failures.delete(key);
      return 0;
    }
    return entry.count >= LOGIN_FAILURES.max ? entry.reset - now() : 0;
  }
  function loginFailed(key) {
    const t = now();
    const entry = failures.get(key);
    if (!entry || entry.reset <= t) failures.set(key, { count: 1, reset: t + LOGIN_FAILURES.windowMs });
    else entry.count += 1;
  }

  /** Middleware : charge l'utilisateur connecté depuis le cookie de session. */
  function loadUser(req, _res, next) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const row = q('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token));
      if (row && row.expires_at > Date.now()) {
        const user = services.getUser(row.user_id);
        if (user && user.email_verified_at) req.user = user;
      }
    }
    next();
  }

  const router = express.Router();
  const signupLimit = rateLimit({ windowMs: 60 * 60_000, max: config.isTest ? 1000 : 10 });
  const loginLimit = rateLimit({ windowMs: 15 * 60_000, max: config.isTest ? 1000 : 30 });
  const mailLimit = rateLimit({ windowMs: 60 * 60_000, max: config.isTest ? 1000 : 8 });

  router.get('/username-available', (req, res) => {
    const u = String(req.query.u || '');
    const error = validateUsername(u);
    if (error) return res.json({ available: false, reason: error });
    const taken = q('SELECT 1 FROM users WHERE username = ?').get(u);
    res.json({ available: !taken, reason: taken ? 'username_taken' : null });
  });

  router.post('/signup', signupLimit, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const username = String(req.body.username || '').trim();
    const { password } = req.body;
    const lang = req.body.lang === 'en' ? 'en' : 'fr';
    const error = validateEmail(email) || validateUsername(username) || validatePassword(password);
    if (error) throw new HttpError(400, error);
    // Case « J'accepte les CGU et j'ai 15 ans ou plus » (PLAN.md 7.1) : deux valeurs, chacune obligatoire.
    if (req.body.acceptTerms !== true) throw new HttpError(400, 'terms_required');
    if (req.body.age15 !== true) throw new HttpError(400, 'age_required');
    const existing = q('SELECT * FROM users WHERE email = ?').get(email);
    // Pseudo d'abord, quelle que soit l'adresse : seul celui d'un compte jamais vérifié de la même adresse se
    // reprend. (Répondre différemment selon l'adresse dirait si elle est inscrite, ou à quel pseudo elle appartient.)
    const nameOwner = q('SELECT id FROM users WHERE username = ?').get(username);
    const reusable = existing && !existing.email_verified_at && nameOwner?.id === existing.id;
    if (nameOwner && !reusable) throw new HttpError(409, 'username_taken');

    const secret = newToken();
    // Même travail (hachage) et même réponse qu'une inscription réussie : la durée ne trahit rien non plus.
    const hash = await hashPassword(password);
    if (existing?.email_verified_at) {
      // Adresse déjà confirmée : aucun compte créé, le titulaire est prévenu (au plus un e-mail par minute).
      if (mailAllowed(existing)) {
        if (typeof mailer.sendSignupAttempt === 'function') await mailer.sendSignupAttempt(existing);
        else await mailer.sendReset(existing, issueToken(existing.id, 'reset', RESET_TOKEN_MINUTES * 60_000));
      }
      setCookie(res, SIGNUP_COOKIE, secret, VERIFY_TOKEN_HOURS * 3_600_000);
      return res.status(201).json({ ok: true, email, devMailbox: mailer.devMailbox });
    }

    const at = Date.now();
    const user = tx(db, () => {
      // Une adresse jamais vérifiée ne bloque pas son vrai propriétaire : le compte inachevé est remplacé
      // (sinon quelqu'un pourrait réserver ton adresse, et donc l'accès admin, avec son propre mot de passe).
      if (existing) q('DELETE FROM users WHERE id = ? AND email_verified_at IS NULL').run(existing.id);
      const { lastInsertRowid } = q(`INSERT INTO users (email, username, password_hash, role, lang, royalties, bonus_packs, packs, packs_at,
          created_at, last_mail_at, signup_secret, terms_accepted_at, terms_version)
        VALUES (?, ?, ?, 'player', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`).run(
        email, username, hash, lang, services.welcome.royalties, services.welcome.packs, at, at, at, sha256(secret), at, config.termsVersion,
      );
      return services.getUser(Number(lastInsertRowid));
    });
    const token = issueToken(user.id, 'verify', VERIFY_TOKEN_HOURS * 3_600_000);
    await mailer.sendVerification(user, token);
    setCookie(res, SIGNUP_COOKIE, secret, VERIFY_TOKEN_HOURS * 3_600_000);
    res.status(201).json({ ok: true, email, devMailbox: mailer.devMailbox });
  });

  router.post('/resend', mailLimit, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = q('SELECT * FROM users WHERE email = ?').get(email);
    // Réponse identique que le compte existe ou non (pas de fuite d'information).
    if (user && !user.email_verified_at && mailAllowed(user)) {
      const token = issueToken(user.id, 'verify', VERIFY_TOKEN_HOURS * 3_600_000);
      await mailer.sendVerification(user, token);
    }
    res.json({ ok: true, devMailbox: mailer.devMailbox });
  });

  router.post('/verify', loginLimit, async (req, res) => {
    const { token } = req.body;
    const row = typeof token === 'string' && token.length >= 20
      ? q("SELECT * FROM email_tokens WHERE token_hash = ? AND purpose = 'verify'").get(sha256(token))
      : null;
    if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'invalid_token');
    const user = services.getUser(row.user_id);
    // Le lien prouve qu'on possède la boîte mail ; il faut aussi prouver qu'on a créé le compte :
    // soit c'est le navigateur de l'inscription, soit on tape le mot de passe choisi à l'inscription.
    const secret = parseCookies(req.headers.cookie)[SIGNUP_COOKIE];
    const sameBrowser = !!secret && !!user.signup_secret && sha256(secret) === user.signup_secret;
    if (!sameBrowser) {
      if (typeof req.body.password !== 'string' || !req.body.password) throw new HttpError(401, 'password_required');
      if (!(await verifyPassword(req.body.password, user.password_hash))) throw new HttpError(401, 'invalid_credentials');
    }
    q('DELETE FROM email_tokens WHERE token_hash = ?').run(row.token_hash);
    q('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), packs_at = ?, signup_secret = NULL WHERE id = ?').run(Date.now(), Date.now(), user.id);
    startSession(res, user.id);
    setCookie(res, SIGNUP_COOKIE, '', 0);
    if (!user.email_verified_at) verifiedNow(user.id);
    res.json(services.state(user.id));
  });

  router.post('/login', loginLimit, async (req, res) => {
    const identifier = String(req.body.identifier || '').trim();
    const password = String(req.body.password || '');
    const key = identifierKey(identifier);
    const wait = loginWait(key);
    if (wait > 0) {
      res.set('Retry-After', String(Math.ceil(wait / 1000)));
      throw new HttpError(429, 'rate_limited');
    }
    const user = identifier.includes('@')
      ? q('SELECT * FROM users WHERE email = ?').get(identifier.toLowerCase())
      : q('SELECT * FROM users WHERE username = ?').get(identifier);
    // On vérifie toujours un hachage au coût visé, pour un temps de réponse constant (compte connu ou non).
    const ok = await verifyPassword(password, user?.password_hash || dummyHash());
    if (!user || !ok) {
      loginFailed(key);
      throw new HttpError(401, 'invalid_credentials');
    }
    failures.delete(key);
    if (!user.email_verified_at) throw new HttpError(403, 'email_unverified', { email: user.email });
    // Ancien hachage (coût plus faible) : refait maintenant que le mot de passe est connu.
    if (needsRehash(user.password_hash)) {
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
    }
    startSession(res, user.id);
    res.json(services.state(user.id));
  });

  router.post('/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) q('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    setSessionCookie(res, '', 0);
    res.json({ ok: true });
  });

  router.post('/forgot', mailLimit, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = q('SELECT * FROM users WHERE email = ?').get(email);
    if (user && mailAllowed(user)) {
      const token = issueToken(user.id, 'reset', RESET_TOKEN_MINUTES * 60_000);
      await mailer.sendReset(user, token);
    }
    res.json({ ok: true, devMailbox: mailer.devMailbox });
  });

  router.post('/reset', loginLimit, async (req, res) => {
    const error = validatePassword(req.body.password);
    if (error) throw new HttpError(400, error);
    const userId = consumeToken(req.body.token, 'reset');
    if (!userId) throw new HttpError(400, 'invalid_token');
    const before = services.getUser(userId);
    const hash = await hashPassword(req.body.password);
    // Le lien prouve aussi la possession de l'adresse e-mail.
    q('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(hash, Date.now(), userId);
    q('DELETE FROM sessions WHERE user_id = ?').run(userId);
    startSession(res, userId);
    if (before && !before.email_verified_at) verifiedNow(userId);
    res.json(services.state(userId));
  });

  return { router, loadUser };
}
