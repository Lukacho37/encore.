// Pagination par curseur (PLAN.md 4.0) : `?cursor=<opaque>&limit=<n>` → `{ items, nextCursor }`, nextCursor null
// à la fin. Le curseur est du JSON en base64url : `[valeurDeTri, id]` pour les listes triées sur un index
// (`WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT n + 1`), `[offset]` pour les listes
// classées par score (recherche : 240 au plus, classements : 500). Aucune route ne renvoie une liste sans limite.
import { HttpError } from './services.js';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

const badCursor = () => {
  throw new HttpError(400, 'invalid_input', { field: 'cursor' });
};

/** Taille de page demandée, ramenée dans [1, max] (valeur absente ou illisible → `def`). */
export function limitOf(raw, { def = DEFAULT_LIMIT, max = MAX_LIMIT } = {}) {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : Math.min(def, max);
}

export const encodeCursor = (values) => Buffer.from(JSON.stringify(values)).toString('base64url');

/**
 * Curseur reçu → tableau de valeurs (chaînes, nombres ou null), ou null s'il n'y en a pas.
 * Un curseur illisible ou de la mauvaise longueur répond 400 `invalid_input` (field: 'cursor').
 */
export function decodeCursor(raw, { length } = {}) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > 512 || !/^[\w-]+$/.test(raw)) return badCursor();
  let values;
  try {
    values = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return badCursor();
  }
  if (!Array.isArray(values) || !values.length || (length && values.length !== length)) return badCursor();
  if (!values.every((v) => v === null || typeof v === 'string' || Number.isFinite(v))) return badCursor();
  return values;
}

/** `{ cursor, limit }` d'une requête (`req.query`), pour une liste triée sur un index. */
export function pageOf(query = {}, { def, max, length = 2 } = {}) {
  return { cursor: decodeCursor(query.cursor, { length }), limit: limitOf(query.limit, { def, max }) };
}

/**
 * Page d'une requête lue avec `LIMIT limit + 1` : garde `limit` lignes et, s'il en reste, construit le curseur
 * suivant depuis la dernière ligne gardée (`keyOf(row)` → `[valeurDeTri, id]`).
 */
export function keysetPage(rows, limit, keyOf) {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit && items.length ? encodeCursor(keyOf(items[items.length - 1])) : null };
}

/** Décalage d'un curseur `[offset]` (0 sans curseur), plafonné à `cap`. */
export function offsetOf(raw, { cap = 240 } = {}) {
  const values = decodeCursor(raw, { length: 1 });
  if (!values) return 0;
  const [offset] = values;
  if (!Number.isInteger(offset) || offset < 0) return badCursor();
  return Math.min(offset, cap);
}

/**
 * Page d'une liste classée lue avec `LIMIT limit + 1 OFFSET offset` ; pas de page suivante au-delà de `cap`.
 */
export function offsetPage(rows, offset, limit, { cap = 240 } = {}) {
  const items = rows.slice(0, limit);
  const next = offset + items.length;
  return { items, nextCursor: rows.length > limit && next < cap ? encodeCursor([next]) : null };
}
