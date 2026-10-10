// Recherche globale : règles communes au serveur (server/search.js), à la démo (client/src/demo/mock/search.js) et au
// site (surlignage de la partie tapée). PLAN.md 5.1. Chantier P0-E.
//
// Une requête est normalisée (repliée, sans ponctuation, 8 mots au plus) ; chaque mot cherche un début de mot du nom
// ou du contexte (artiste, album…). Le score d'un résultat mélange le texte (nom exact, début du nom, mots trouvés
// dans le nom), la popularité a priori (`weight` ∈ [0, 1]) et un petit bonus quand le joueur a déjà des cartes de cet
// album ou de cet artiste. Fautes de frappe : similarité de Jaccard sur les trigrammes du nom et de ses mots.
import { foldText } from './rules.js';

/** Types de résultats, dans l'ordre d'affichage des groupes. */
export const SEARCH_KINDS = ['album', 'track', 'artist', 'user', 'list'];
/** Lignes par groupe dans les suggestions « Tout » ; une recherche sur un seul type en renvoie SCOPE_QUOTA. */
export const QUOTAS = { album: 4, track: 4, artist: 3, user: 3, list: 2 };
export const SCOPE_QUOTA = 8;
/** Compteurs plafonnés (le site affiche « 99+ »), résultats paginés plafonnés. */
export const COUNT_CAP = 100;
export const RESULTS_CAP = 240;
/** Une requête normalisée plus courte ne cherche rien (pas d'erreur). */
export const MIN_QUERY = 2;
export const MAX_TOKENS = 8;
/** Recherche approchée : dès 4 lettres (sans les espaces), similarité minimale d'un résultat, d'une suggestion. */
export const TYPO_MIN_LENGTH = 4;
export const TYPO_MIN_SIM = 0.3;
export const SUGGEST_MIN_SIM = 0.4;
/** Requêtes de 3 caractères ou moins : classées par popularité (index de préfixes de 2 et 3 lettres). */
export const SHORT_QUERY = 3;

/** Forme normalisée d'un texte : repliée (accents, casse, œ → oe…), ponctuation remplacée par des espaces. */
export function normalize(s) {
  return foldText(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Mots d'une requête normalisée (8 au plus). */
export function tokensOf(fq) {
  return fq ? fq.split(' ').filter(Boolean).slice(0, MAX_TOKENS) : [];
}

/** Requête normalisée et ses mots ; `null` si elle est trop courte. */
export function prepareQuery(q) {
  const fq = normalize(String(q ?? '').slice(0, 200)).split(' ').filter(Boolean).slice(0, MAX_TOKENS).join(' ');
  if (fq.length < MIN_QUERY) return null;
  return { fq, tokens: tokensOf(fq), compact: fq.replace(/ /g, '') };
}

/** Corps de requête FTS5 : chaque mot est un préfixe entre guillemets (`"daft"* "pu"*`). */
export function ftsBody(tokens) {
  return tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
}

/** Trigrammes d'un texte normalisé, avec deux espaces devant et un derrière (le début du mot compte double). */
export function trigrams(s) {
  const p = `  ${s} `;
  const out = new Set();
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return out;
}

/** Trigrammes « pleins » (sans espace) d'une requête sans espaces : ce que l'index trigramme peut retrouver. */
export function queryGrams(compact) {
  return [...trigrams(compact)].filter((g) => !g.includes(' '));
}

export function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter || 1);
}

/**
 * Similarité d'un nom normalisé avec la requête : le meilleur Jaccard entre les trigrammes de la requête et ceux du
 * nom entier ou de l'un de ses mots de 3 lettres ou plus (« kendrik » ressemble au mot « kendrick »).
 */
export function similarity(queryTri, folded, min = 0) {
  // Jaccard ≤ (plus petit ensemble) / (plus grand) : un texte trop court ou trop long ne peut pas atteindre `min`
  // (un texte de n caractères a au plus n + 1 trigrammes).
  const size = queryTri.size;
  const reachable = (s) => s.length + 1 >= size * min && size >= (s.length + 1) * min * 0.5;
  let best = reachable(folded) ? jaccard(queryTri, trigrams(folded)) : 0;
  if (folded.includes(' ')) {
    for (const w of folded.split(' ')) {
      if (w.length >= 3 && reachable(w)) best = Math.max(best, jaccard(queryTri, trigrams(w)));
    }
  }
  return best;
}

/** Score de texte : nom exact 1 ; nom qui commence par la requête 0,9 ; sinon 0,5 + 0,3 × part des mots trouvés dans le nom. */
export function textScore(folded, fq, tokens) {
  if (folded === fq) return 1;
  if (folded.startsWith(fq)) return 0.9;
  const words = folded.split(' ');
  const inName = tokens.filter((t) => words.some((w) => w.startsWith(t))).length / (tokens.length || 1);
  return 0.5 + 0.3 * inName;
}

/** Score de texte d'un résultat trouvé par ressemblance (faute de frappe). */
export const typoScore = (sim) => 0.3 + 0.5 * sim;

/** Score final : texte d'abord, popularité ensuite, petit bonus si le joueur a des cartes de cet album ou artiste. */
export function finalScore(text, weight, owned = false) {
  return 0.75 * text + 0.2 * (weight || 0) + (owned ? 0.05 : 0);
}

/** Ordre des résultats d'un groupe : score décroissant, puis popularité. */
export const byScore = (a, b) => b.score - a.score || (b.weight || 0) - (a.weight || 0);

/** Le meilleur premier résultat d'un groupe : texte d'abord, puis score (PLAN.md 5.1, point 8). */
export const betterTop = (a, b) => !b || a.text > b.text || (a.text === b.text && a.score > b.score);

/** Une requête en ligne (champ `q` d'une adresse) : texte borné. */
export const cleanQuery = (q) => (typeof q === 'string' ? q.slice(0, 100) : '');

// ---------- popularité a priori (`weight` ∈ [0, 1], PLAN.md 5.1) ----------

const logRatio = (n, max) => (max > 0 ? Math.log10(1 + Math.max(0, n || 0)) / Math.log10(1 + max) : 0);

/**
 * Album ou artiste : log10(1 + fans) / log10(1 + fans maximum). Un album de la graine n'a pas de nombre de fans
 * (0) : on prend alors la popularité moyenne de ses morceaux (indice 0–100), pour que « Discovery » ne passe pas
 * derrière un album inconnu.
 */
export function fansWeight(fans, maxFans, avgPop = 0) {
  return fans > 0 ? Math.min(1, logRatio(fans, maxFans)) : Math.min(1, Math.max(0, avgPop || 0) / 100);
}
export const trackWeight = (pop) => Math.min(1, Math.max(0, pop || 0) / 100);
export const userWeight = (uniqueCards) => Math.min(1, Math.log10(1 + Math.max(0, uniqueCards || 0)) / 4);
export const listWeight = (likes) => 0.2 + 0.8 * Math.min(1, Math.log10(1 + Math.max(0, likes || 0)) / 2);

// ---------- surlignage (site) ----------

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * Découpe `text` en morceaux `{ text, hit }` : `hit` marque le début de chaque mot qui commence par un mot de la
 * requête (comparaison sur la forme repliée : « carree » surligne « carrée »). Sert à <mark class="hl">.
 */
export function highlightParts(text, q) {
  const source = String(text ?? '');
  const tokens = tokensOf(normalize(q || '')).sort((a, b) => b.length - a.length);
  if (!tokens.length || !source) return [{ text: source, hit: false }];
  const parts = [];
  let last = 0;
  for (const m of source.matchAll(WORD)) {
    const word = m[0];
    const folded = normalize(word).replace(/ /g, '');
    const token = tokens.find((t) => folded.startsWith(t));
    if (!token) continue;
    // Plus petit début du mot d'origine dont la forme repliée couvre le mot tapé (œ → oe, ß → ss…).
    let cut = word.length;
    for (let i = 1; i <= word.length; i++) {
      if (normalize(word.slice(0, i)).replace(/ /g, '').length >= token.length) {
        cut = i;
        break;
      }
    }
    // Ne pas couper une lettre et ses accents combinés.
    while (cut < word.length && /\p{M}/u.test(word[cut])) cut += 1;
    if (m.index > last) parts.push({ text: source.slice(last, m.index), hit: false });
    parts.push({ text: word.slice(0, cut), hit: true });
    last = m.index + cut;
  }
  if (last < source.length) parts.push({ text: source.slice(last), hit: false });
  return parts.length ? parts : [{ text: source, hit: false }];
}
