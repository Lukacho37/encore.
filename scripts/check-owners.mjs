// Contrôle de la propriété des fichiers (PLAN.md 9.0, 9.8) : compare les fichiers modifiés ou créés
// (`git status --porcelain`) avec scripts/owners.json et signale ceux qu'aucun chantier du niveau ne possède.
//   node scripts/check-owners.mjs p0            fichiers modifiés, rangés par chantier ; hors propriété → code 1
//   node scripts/check-owners.mjs p0 P0-E       idem, avec la liste du seul chantier P0-E mise en avant
//   node scripts/check-owners.mjs p0 --list P0-E    fichiers et dossiers que possède P0-E
//   node scripts/check-owners.mjs p1 --since a6ca099  compte aussi les fichiers des commits de sauvegarde depuis a6ca099
// Lecture seule : ne modifie ni l'arbre ni l'index git.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owners = JSON.parse(fs.readFileSync(path.join(root, 'scripts/owners.json'), 'utf8'));
const args = process.argv.slice(2);
const listMode = args.includes('--list');
const sinceAt = args.indexOf('--since');
const since = sinceAt >= 0 ? args[sinceAt + 1] : null;
const [levelArg, wsArg] = args.filter((a, i) => a !== '--list' && (sinceAt < 0 || (i !== sinceAt && i !== sinceAt + 1)));
const levels = owners.levels;
const level = Object.keys(levels).find((l) => l.toLowerCase() === String(levelArg || '').toLowerCase());
if (!level) {
  console.log(`Usage : node scripts/check-owners.mjs <niveau> [chantier] [--list]   niveaux : ${Object.keys(levels).join(', ')}`);
  process.exit(2);
}
const table = levels[level];
const ws = wsArg && Object.keys(table).find((w) => w.toLowerCase() === wsArg.toLowerCase());
if (wsArg && !ws) {
  console.log(`Chantier inconnu pour ${level} : ${wsArg} (chantiers : ${Object.keys(table).join(', ')})`);
  process.exit(2);
}

// Fichier → chantier : un fichier cité explicitement l'emporte ; sinon le dossier le plus précis.
const exact = new Map();
const folders = [];
const problems = [];
for (const [name, entries] of Object.entries(table)) {
  for (const entry of entries) {
    if (entry.endsWith('/')) folders.push([entry, name]);
    else if (exact.has(entry) && exact.get(entry) !== name) problems.push(`${entry} : cité par ${exact.get(entry)} et ${name}`);
    else exact.set(entry, name);
  }
}
folders.sort((a, b) => b[0].length - a[0].length);
const ownerOf = (file) => exact.get(file) || folders.find(([dir]) => file.startsWith(dir))?.[1] || null;

if (listMode) {
  if (!ws) {
    console.log('Indique le chantier : --list <chantier>');
    process.exit(2);
  }
  console.log(`${level} · ${ws} possède :\n  ${table[ws].join('\n  ')}`);
  process.exit(0);
}

// -uall : chaque fichier non suivi est listé (pas seulement son dossier) ; un renommage compte pour ses deux noms.
const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: root, encoding: 'utf8' });
const changed = [];
for (const line of status.split('\n').filter(Boolean)) {
  const file = line.slice(3);
  const unquote = (p) => (p.startsWith('"') ? JSON.parse(p) : p);
  if (file.includes(' -> ')) changed.push(...file.split(' -> ').map(unquote));
  else changed.push(unquote(file));
}

// --since <révision> : les fichiers modifiés par les commits depuis cette révision comptent aussi (sauvegardes en cours de niveau).
if (since) {
  const committed = execFileSync('git', ['diff', '--name-only', '--no-renames', since, 'HEAD'], { cwd: root, encoding: 'utf8' });
  for (const file of committed.split('\n').filter(Boolean)) if (!changed.includes(file)) changed.push(file);
}

const byOwner = new Map();
const outside = [];
for (const file of changed) {
  const owner = ownerOf(file);
  if (!owner) outside.push(file);
  else {
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(file);
  }
}

console.log(`Niveau ${level} : ${changed.length} fichier(s) modifié(s) ou créé(s).`);
for (const [owner, files] of [...byOwner].sort()) {
  const mark = ws && owner === ws ? ' ◀' : '';
  console.log(`\n${owner}${mark} (${files.length})\n  ${files.join('\n  ')}`);
}
if (problems.length) console.log(`\nowners.json : propriétaires en double\n  ${problems.join('\n  ')}`);
if (outside.length) {
  console.log(`\nHORS PROPRIÉTÉ (${outside.length}) : aucun chantier de ${level} ne possède ces fichiers\n  ${outside.join('\n  ')}`);
} else {
  console.log(`\nAucun fichier hors propriété.`);
}
process.exitCode = outside.length || problems.length ? 1 : 0;
