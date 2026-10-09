import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './services.js';
import { dayStart, nextDayStart } from '../shared/periods.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  const [algo, N, r, p, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(key, expected);
}

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const newId = () => crypto.randomBytes(12).toString('base64url');

/** Générateur aléatoire cryptographique renvoyant un flottant dans [0, 1). */
export const secureRandom = () => crypto.randomInt(0, 2 ** 47) / 2 ** 47;

/**
 * En-tête Cookie → { nom: valeur }. Ne lève jamais : un cookie mal encodé (« %E0 ») est ignoré, un en-tête absent
 * ou d'un autre type donne {}. Objet sans prototype : un cookie nommé « __proto__ » reste une simple clé.
 */
export function parseCookies(header = '') {
  const out = Object.create(null);
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // valeur mal encodée : cookie ignoré
    }
  }
  return out;
}

/** Limiteur de débit en mémoire, par clé (IP, identifiant…). */
export function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited' });
    }
    next();
  };
}

/**
 * Limites de débit nommées (PLAN.md 4.0), partagées par les routes historiques et les modules (`deps.limits`).
 * Fenêtres fixes en mémoire ; multipliées par 1000 en test. `read` et `write` reprennent les compteurs d'avant
 * (navigation dans le catalogue, actions) : mêmes clés, mêmes plafonds.
 */
export function createLimits({ isTest = false } = {}) {
  const k = isTest ? 1000 : 1;
  const user = (prefix) => (req) => `${prefix}${req.user?.id}`;
  const ip = (prefix) => (req) => `${prefix}${req.ip}`;
  return {
    read: rateLimit({ windowMs: 60_000, max: 600 * k, key: user('b') }),
    write: rateLimit({ windowMs: 60_000, max: 240 * k, key: user('u') }),
    search: rateLimit({ windowMs: 60_000, max: 120 * k, key: user('s') }),
    heavy: rateLimit({ windowMs: 60_000, max: 20 * k, key: user('h') }),
    guestRead: rateLimit({ windowMs: 60_000, max: 120 * k, key: ip('g') }),
    guestForm: rateLimit({ windowMs: 60 * 60_000, max: 5 * k, key: ip('f') }),
  };
}

/**
 * Plafonds quotidiens (PLAN.md 4.0) : chaque quota compte les lignes de sa table source depuis minuit, heure de Paris,
 * avec un COUNT(*) indexé et borné. Ils survivent donc aux redémarrages et ne dérivent jamais.
 * `sql` : requête de comptage (paramètres : joueur, début du jour, plafond + 1 pour borner le parcours).
 */
export const QUOTAS = {
  posts: { max: 20, sql: 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM posts WHERE user_id = ? AND created_at >= ? LIMIT ?)' },
  comments: { max: 60, sql: 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM comments WHERE user_id = ? AND created_at >= ? LIMIT ?)' },
  // Nouvelles critiques écrites (review_at = date du texte) ; une simple note ne compte pas.
  reviews: { max: 30, sql: 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM ratings WHERE user_id = ? AND review_at >= ? LIMIT ?)' },
  friend_requests: { max: 30, sql: 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM friendships WHERE requester_id = ? AND created_at >= ? LIMIT ?)' },
  reports: { max: 20, sql: 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM reports WHERE reporter_id = ? AND created_at >= ? LIMIT ?)' },
  lists: { max: 20, sql: "SELECT COUNT(*) AS n FROM (SELECT 1 FROM lists WHERE user_id = ? AND kind = 'list' AND created_at >= ? LIMIT ?)" },
  battle_votes: { max: 200, sql: 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM battle_votes WHERE user_id = ? AND created_at >= ? LIMIT ?)' },
};

/**
 * Quotas quotidiens persistants : `deps.quota(userId, kind)` à appeler AVANT d'écrire la nouvelle ligne ; lève
 * 429 { error: 'quota_exceeded', kind, resetAt } quand le plafond du jour est atteint. `quota.count(userId, kind)`
 * et `quota.remaining(userId, kind)` pour l'affichage ; `limits` remplace des plafonds (tests).
 */
export function createQuota(db, { limits = {}, now = Date.now } = {}) {
  const statements = new Map();
  const spec = (kind) => {
    const q = QUOTAS[kind];
    if (!q) throw new Error(`quota inconnu : « ${kind} »`);
    return { ...q, max: limits[kind] ?? q.max };
  };
  const stmt = (kind) => {
    if (!statements.has(kind)) statements.set(kind, db.prepare(QUOTAS[kind].sql));
    return statements.get(kind);
  };
  function count(userId, kind) {
    const { max } = spec(kind);
    return stmt(kind).get(userId, dayStart(now()), max + 1).n;
  }
  function quota(userId, kind) {
    const { max } = spec(kind);
    if (count(userId, kind) >= max) throw new HttpError(429, 'quota_exceeded', { kind, max, resetAt: nextDayStart(now()) });
  }
  quota.count = count;
  quota.remaining = (userId, kind) => Math.max(0, spec(kind).max - count(userId, kind));
  quota.limit = (kind) => spec(kind).max;
  return quota;
}
