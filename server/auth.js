// Comptes : inscription (e-mail + nom d'utilisateur unique + mot de passe), vérification d'e-mail,
// connexion, sessions par cookie HttpOnly, mot de passe oublié.
import express from 'express';
import { config, SESSION_DAYS, VERIFY_TOKEN_HOURS, RESET_TOKEN_MINUTES } from './config.js';
import { hashPassword, verifyPassword, newToken, sha256, parseCookies, rateLimit } from './security.js';
import { tx } from './db.js';
import { HttpError } from './services.js';
import { validateEmail, validatePassword, validateUsername } from '../shared/rules.js';

export const COOKIE = 'albummania_sid';
// Posé à l'inscription : le navigateur qui a créé le compte peut le vérifier sans retaper le mot de passe.
const SIGNUP_COOKIE = 'albummania_signup';

export function createAuth(db, mailer, services) {
  const q = (sql) => db.prepare(sql);

  function setCookie(res, name, value, maxAgeMs) {
    const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
    if (config.isProd) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }
  const setSessionCookie = (res, token, maxAgeMs) => setCookie(res, COOKIE, token, maxAgeMs);

  function startSession(res, userId) {
    const token = newToken();
    const now = Date.now();
    const ttl = SESSION_DAYS * 86_400_000;
    q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now, now + ttl);
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
    const existing = q('SELECT id, email_verified_at FROM users WHERE email = ?').get(email);
    if (existing?.email_verified_at) throw new HttpError(409, 'email_taken');
    const nameOwner = q('SELECT id FROM users WHERE username = ?').get(username);
    if (nameOwner && nameOwner.id !== existing?.id) throw new HttpError(409, 'username_taken');

    const hash = await hashPassword(password);
    const now = Date.now();
    const secret = newToken();
    const user = tx(db, () => {
      // Une adresse jamais vérifiée ne bloque pas son vrai propriétaire : le compte inachevé est remplacé
      // (sinon quelqu'un pourrait réserver ton adresse, et donc l'accès admin, avec son propre mot de passe).
      if (existing) q('DELETE FROM users WHERE id = ? AND email_verified_at IS NULL').run(existing.id);
      const { lastInsertRowid } = q(`INSERT INTO users (email, username, password_hash, role, lang, royalties, bonus_packs, packs, packs_at, created_at, last_mail_at, signup_secret)
        VALUES (?, ?, ?, 'player', ?, ?, ?, 0, ?, ?, ?, ?)`).run(email, username, hash, lang, services.welcome.royalties, services.welcome.packs, now, now, now, sha256(secret));
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
    if (user && !user.email_verified_at && Date.now() - (user.last_mail_at || 0) > 60_000) {
      q('UPDATE users SET last_mail_at = ? WHERE id = ?').run(Date.now(), user.id);
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
    res.json(services.state(user.id));
  });

  router.post('/login', loginLimit, async (req, res) => {
    const identifier = String(req.body.identifier || '').trim();
    const password = String(req.body.password || '');
    const user = identifier.includes('@')
      ? q('SELECT * FROM users WHERE email = ?').get(identifier.toLowerCase())
      : q('SELECT * FROM users WHERE username = ?').get(identifier);
    // On vérifie toujours un hash pour garder un temps de réponse constant.
    const ok = await verifyPassword(password, user?.password_hash || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
    if (!user || !ok) throw new HttpError(401, 'invalid_credentials');
    if (!user.email_verified_at) throw new HttpError(403, 'email_unverified', { email: user.email });
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
    if (user && Date.now() - (user.last_mail_at || 0) > 60_000) {
      q('UPDATE users SET last_mail_at = ? WHERE id = ?').run(Date.now(), user.id);
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
    const hash = await hashPassword(req.body.password);
    // Le lien prouve aussi la possession de l'adresse e-mail.
    q('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(hash, Date.now(), userId);
    q('DELETE FROM sessions WHERE user_id = ?').run(userId);
    startSession(res, userId);
    res.json(services.state(userId));
  });

  return { router, loadUser };
}
