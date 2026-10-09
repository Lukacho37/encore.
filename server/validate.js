// Validation des entrées (PLAN.md 7.2) : chaque route valide avant de toucher à la base. Les champs inconnus sont
// ignorés ; une valeur invalide lève HttpError(400, 'invalid_input', { field }) (ou le code demandé), sauf
// `id`, `ids` et `bool`, qui normalisent sans jamais lever (comme l'ancien `idOf`).
import { HttpError } from './services.js';

const fail = (code, field, extra) => {
  throw new HttpError(400, code || 'invalid_input', { ...(field && { field }), ...extra });
};
const absent = (v) => v === undefined || v === null;

/**
 * Texte : `trim` (défaut true) enlève les espaces autour ; longueur en caractères dans [min, max].
 * `optional` : une valeur absente (ou vide une fois nettoyée) donne `fallback` (null par défaut).
 */
export function str(v, { min = 0, max = 1000, trim = true, optional = false, fallback = null, field, code } = {}) {
  if (absent(v) && optional) return fallback;
  if (typeof v !== 'string') return fail(code, field);
  const s = (trim ? v.trim() : v).normalize('NFC');
  if (!s && optional) return fallback;
  const n = [...s].length;
  if (n < min) return fail(code, field, { min });
  if (n > max) return fail(code, field, { max });
  return s;
}

/** Entier dans [min, max] ; accepte un nombre ou une chaîne de chiffres (paramètres d'URL). */
export function int(v, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, optional = false, fallback = null, field, code } = {}) {
  if ((absent(v) || v === '') && optional) return fallback;
  const n = typeof v === 'string' && /^-?\d{1,16}$/.test(v.trim()) ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) return fail(code, field, { min, max });
  return n;
}

/** Une valeur parmi `list` (comparaison stricte). */
export function oneOf(v, list, { optional = false, fallback = null, field, code } = {}) {
  if ((absent(v) || v === '') && optional) return fallback;
  if (!list.includes(v)) return fail(code, field);
  return v;
}

/** Identifiant (album, morceau, artiste, cible…) : chaîne de 1 à 80 caractères, sinon null. */
export const id = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);

/** Liste d'identifiants (tableau ou « a,b,c ») : valides, sans doublon, au plus `max`. */
export function ids(list, max = 100) {
  const raw = Array.isArray(list) ? list : String(list ?? '').split(',');
  const out = [];
  for (const x of raw) {
    const v = id(typeof x === 'string' ? x.trim() : x);
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** Booléen : true, 1, '1', 'true', 'on' → true ; tout le reste → false. */
export const bool = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
