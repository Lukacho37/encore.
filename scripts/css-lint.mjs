// Contrôle des feuilles de style (PLAN.md 0.5 et 9.2) — chantier P0-B.
//   npm run lint:css                  toutes les feuilles de client/src (**/*.css)
//   node scripts/css-lint.mjs a.css   seulement ces fichiers
// Règles (design/design-system-current.md, identité actuelle) :
//   hex          aucune couleur hexadécimale hors d'un bloc :root (les couleurs sont des jetons de app.css) ;
//   font-family  aucune famille de police hors de :root : font-family / font n'utilisent que var(--font-*) ou inherit ;
//   font-size    rien sous 12 px dans l'interface ; les micro-étiquettes des cartes (.card…) descendent à 10 px au plus
//                bas (plancher calculé : max(10px, 5cqi) → 10, clamp(12px, …) → 12, var(--fs-12) → 12) ;
//   prefix       chaque feuille d'un chantier déclare son préfixe sur sa première ligne (/* @prefix gs- */) ; chaque
//                sélecteur vise au moins une classe à ce préfixe ou un nom canonique du chantier (9.2), les classes
//                partagées (.panel, .btn…) n'y apparaissent qu'en ancêtre ou en descendant, jamais restylées seules.
// Les feuilles historiques de client/src/styles/ (app.css et les cinq feuilles de pages) n'ont pas de préfixe.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'client/src');
const TOKENS_FILE = path.join(SRC, 'styles/app.css');
const LEGACY = new Set(['app.css', 'home.css', 'collection.css', 'album.css', 'profile.css', 'admin.css'].map((f) => path.join(SRC, 'styles', f)));

// Noms canoniques des nouveaux composants (design/current-v2/components.css), permis au chantier qui les possède.
const CANONICAL = {
  'trk-': [/^track-head/],
  'sh-': [/^sheet/, /^mini-pack/, /^tabbar__count/],
  'gs-': [/^gsearch/, /^search-trigger/, /^search-sheet/, /^hl$/, /^kbd$/, /^stack-thumb/],
  'sf-': [/^bell/, /^notif/],
  'so-': [/^post/, /^mention/, /^act-btn/, /^review__(head|album|foot)/, /^thread/, /^comment/, /^composer/, /^home-cols/],
  'ls-': [/^nine/, /^list-card/],
  'dc-': [/^user-card/, /^match-/, /^cover-row/, /^steps/, /^pick-artists/, /^onboard__foot/],
  'pl-': [/^duel/, /^status-row/, /^quest-chip/, /^q-ring/, /^quest/, /^medal/],
  'pp-': [/^stat-grid/, /^stat-block/, /^stat-bars/],
};

const MIN_UI = 12;
const MIN_CARD = 10;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
// Éléments d'une carte de collection (cadre, pied, pastilles de rareté .pips) : unités de conteneur avec planchers.
const CARD_SELECTOR = /\.(?:card(?:__[\w-]+|--[\w-]+|-back[\w-]*)?|pips)(?![\w-])/;

// ---------- fichiers ----------

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

// ---------- jetons (pour résoudre var(--fs-*)) ----------

function readTokens() {
  const tokens = new Map();
  if (!fs.existsSync(TOKENS_FILE)) return tokens;
  postcss.parse(fs.readFileSync(TOKENS_FILE, 'utf8')).walkRules((rule) => {
    if (rule.selector.trim() !== ':root' || rule.parent?.type !== 'root') return;
    rule.walkDecls((d) => {
      if (d.prop.startsWith('--')) tokens.set(d.prop, d.value.trim());
    });
  });
  return tokens;
}
const TOKENS = readTokens();

// ---------- plancher d'une taille de police, en px (null : inconnu, ex. calc(var(--pw) * .05) des objets) ----------

/** Découpe les arguments d'une fonction au premier niveau de parenthèses. */
function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function floorOf(value, seen = new Set()) {
  const v = value.trim();
  let m;
  if ((m = /^(-?[\d.]+)px$/.exec(v))) return Number(m[1]);
  if ((m = /^(-?[\d.]+)rem$/.exec(v))) return Number(m[1]) * 16;
  if ((m = /^(-?[\d.]+)em$/.exec(v))) return Number(m[1]) * 15; // relatif au parent ; base : le corps de texte (15 px)
  if ((m = /^(-?[\d.]+)%$/.exec(v))) return (Number(m[1]) / 100) * 15;
  if ((m = /^var\((--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v))) {
    if (seen.has(m[1])) return null;
    seen.add(m[1]);
    if (TOKENS.has(m[1])) return floorOf(TOKENS.get(m[1]), seen);
    return m[2] ? floorOf(m[2], seen) : null;
  }
  if ((m = /^(clamp|max|min)\((.*)\)$/.exec(v))) {
    const args = splitArgs(m[2]).map((a) => floorOf(a, seen));
    if (m[1] === 'clamp') return args[0] ?? null;
    const known = args.filter((x) => x != null);
    if (!known.length) return null;
    if (m[1] === 'max') return Math.max(...known);
    return known.length === args.length ? Math.min(...known) : null; // min() avec un terme inconnu : indécidable
  }
  return null; // calc(), cqi, vw… seuls : objets dessinés à l'échelle (booster, logo), non contrôlés
}

/** Composant « taille » d'un raccourci font: … (« var(--fw-ui) 14px/1.3 var(--font-body) » → « 14px »). */
function shorthandSize(value) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (ch === ' ' || ch === '/')) {
      if (cur) parts.push(cur);
      if (ch === '/') parts.push('/');
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  for (const p of parts) {
    if (p === '/') break;
    if (/^var\(--(fw|font|lh|ls|fst)-/.test(p)) continue;
    if (/^(normal|italic|oblique|bold|bolder|lighter|small-caps|\d{3})$/.test(p)) continue;
    if (/^(-?[\d.]+(px|em|rem|%)|var\(|clamp\(|max\(|min\(|calc\()/.test(p)) return p;
  }
  return null;
}

// ---------- contrôle ----------

const problems = [];
const report = (file, line, rule, message) => problems.push({ file: path.relative(ROOT, file), line, rule, message });
const lineOf = (node) => node.source?.start?.line ?? 0;

function inRoot(node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === 'rule' && p.selector.trim() === ':root') return true;
  return false;
}

function inKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === 'atrule' && /keyframes$/.test(p.name)) return true;
  return false;
}

const classesOf = (selector) => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);

function lintFile(file) {
  const css = fs.readFileSync(file, 'utf8');
  let root;
  try {
    root = postcss.parse(css, { from: file });
  } catch (err) {
    report(file, err.line ?? 0, 'parse', err.reason || err.message);
    return;
  }
  const prefix = /^\s*\/\*\s*@prefix\s+([a-z][\w-]*-)\s*\*\//.exec(css)?.[1] || null;
  if (!LEGACY.has(file) && !prefix) report(file, 1, 'prefix', 'déclare le préfixe du chantier sur la première ligne : /* @prefix xx- */');

  root.walkDecls((decl) => {
    if (inRoot(decl)) return;
    const value = decl.value;
    if (HEX.test(value)) report(file, lineOf(decl), 'hex', `couleur hexadécimale « ${value.match(HEX)[0]} » : utilise un jeton de :root (app.css)`);

    const prop = decl.prop.toLowerCase();
    if (prop === 'font-family' && !/^(var\(--font-[\w-]+\)|inherit|initial|unset)$/.test(value.trim())) {
      report(file, lineOf(decl), 'font-family', `famille « ${value} » : utilise var(--font-display | --font-body | --font-mono)`);
    }
    if (prop === 'font' && !/var\(--font-[\w-]+\)/.test(value) && !/^(inherit|initial|unset)$/.test(value.trim())) {
      report(file, lineOf(decl), 'font-family', `raccourci « font: ${value} » sans var(--font-*)`);
    }

    let size = null;
    if (prop === 'font-size') size = value.trim();
    else if (prop === 'font') size = shorthandSize(value);
    if (size == null || inKeyframes(decl)) return;
    const floor = floorOf(size);
    if (floor == null || floor >= MIN_UI) return;
    const selector = decl.parent?.type === 'rule' ? decl.parent.selector : '';
    const card = !!selector && selector.split(',').every((s) => CARD_SELECTOR.test(s));
    if (card && floor >= MIN_CARD) return;
    report(file, lineOf(decl), 'font-size', card
      ? `micro-étiquette de carte à ${floor} px : ${MIN_CARD} px minimum (masquer l'élément sur les petites cartes plutôt que le rapetisser)`
      : `texte d'interface à ${floor} px (« ${size} ») : ${MIN_UI} px minimum (var(--fs-12))`);
  });

  if (!prefix) return;
  const canonical = CANONICAL[prefix] || [];
  root.walkRules((rule) => {
    if (inKeyframes(rule) || rule.selector.trim() === ':root') return;
    for (const sel of rule.selectors) {
      const own = classesOf(sel).some((c) => c.startsWith(prefix) || canonical.some((re) => re.test(c)));
      if (!own) report(file, lineOf(rule), 'prefix', `« ${sel} » ne vise aucune classe ${prefix}… : une classe partagée ne se restyle pas seule`);
    }
  });
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = args.length ? args.map((f) => path.resolve(f)) : walk(SRC).sort();
for (const file of files) lintFile(file);

problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
if (problems.length) {
  for (const p of problems) console.log(`${p.file}:${p.line}  [${p.rule}]  ${p.message}`);
  console.log(`\ncss-lint : ${problems.length} problème(s) dans ${new Set(problems.map((p) => p.file)).size} fichier(s).`);
  process.exitCode = 1;
} else {
  console.log(`css-lint : ${files.length} feuille(s) conforme(s) (jetons, polices, tailles ≥ ${MIN_UI} px, cartes ≥ ${MIN_CARD} px, préfixes).`);
}
