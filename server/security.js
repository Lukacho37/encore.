import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './services.js';
import { dayStart, nextDayStart } from '../shared/periods.js';

const scryptRaw = promisify(crypto.scrypt);
// File d'attente : au plus deux calculs scrypt simultanés, pour borner la mémoire lors d'une rafale de connexions.
let scryptRunning = 0;
const scryptQueue = [];
async function scrypt(...args) {
  // La place libérée passe directement au suivant de la file : aucun nouvel appel ne peut s'intercaler entre les deux.
  if (scryptRunning >= 2) await new Promise((resolve) => scryptQueue.push(resolve));
  else scryptRunning += 1;
  try {
    return await scryptRaw(...args);
  } finally {
    const next = scryptQueue.shift();
    if (next) next();
    else scryptRunning -= 1;
  }
}

/**
 * Coût de scrypt (PLAN.md 7.2) : N = 2^16, r = 8, p = 2, l'équivalent OWASP de N = 2^17, p = 1 pour le même temps de
 * calcul avec deux fois moins de mémoire (64 Mo par calcul). Au plus deux calculs à la fois : 128 Mo au maximum,
 * compatible avec une petite instance de 512 Mo. Les tests gardent N = 2^14 pour rester rapides. Un mot de passe haché
 * avec d'autres paramètres (les comptes d'avant, en 2^14) est re-haché à la connexion : `needsRehash(stored)` le dit,
 * auth.js appelle alors hashPassword (P0-D).
 */
export const SCRYPT_COST = { N: 2 ** 16, r: 8, p: 2, keylen: 64 };
/** N visé pour un nouveau hachage. */
export const scryptN = () => (process.env.NODE_ENV === 'test' ? 2 ** 14 : SCRYPT_COST.N);
// Plafond de mémoire de node:crypto (32 Mo par défaut, trop peu au-delà de N = 2^14) : 128 × N × r × p, avec une marge.
const maxmemOf = (N, r, p) => 256 * N * r * p;
const MAX_N = 2 ** 20;

/** Hachage scrypt « scrypt$N$r$p$sel$clé » ; `N` permet aux tests de produire un hachage de l'ancien coût. */
export async function hashPassword(password, { N = scryptN() } = {}) {
  const { r, p, keylen } = SCRYPT_COST;
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem: maxmemOf(N, r, p) });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Paramètres d'un hachage enregistré, ou null s'il est illisible. */
function parseHash(stored) {
  const [algo, N, r, p, salt, hash] = String(stored ?? '').split('$');
  const n = Number(N);
  if (algo !== 'scrypt' || !salt || !hash) return null;
  if (!Number.isInteger(n) || n < 2 || n > MAX_N || (n & (n - 1)) !== 0) return null;
  if (!Number.isInteger(Number(r)) || Number(r) < 1 || Number(r) > 32 || !Number.isInteger(Number(p)) || Number(p) < 1 || Number(p) > 16) return null;
  return { N: n, r: Number(r), p: Number(p), salt: Buffer.from(salt, 'base64'), hash: Buffer.from(hash, 'base64') };
}

/** Mot de passe correct ? Un hachage illisible répond non (jamais d'exception, donc jamais de 500). */
export async function verifyPassword(password, stored) {
  const h = parseHash(stored);
  if (!h || !h.hash.length) return false;
  const key = await scrypt(String(password).normalize('NFKC'), h.salt, h.hash.length, { N: h.N, r: h.r, p: h.p, maxmem: maxmemOf(h.N, h.r, h.p) });
  return crypto.timingSafeEqual(key, h.hash);
}

/**
 * Hachage factice au coût visé, pour vérifier un identifiant inconnu en autant de temps qu'un vrai compte (la durée
 * de la connexion ne révèle pas si l'adresse ou le pseudo existe).
 */
export const dummyHash = () => `scrypt$${scryptN()}$${SCRYPT_COST.r}$${SCRYPT_COST.p}$${'A'.repeat(22)}==$${'A'.repeat(86)}==`;

/** Hachage à refaire (coût plus faible que le coût visé, paramètres différents ou format inconnu) ? */
export function needsRehash(stored) {
  const h = parseHash(stored);
  return !h || h.N < scryptN() || h.r !== SCRYPT_COST.r || h.p !== SCRYPT_COST.p || h.hash.length !== SCRYPT_COST.keylen;
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
