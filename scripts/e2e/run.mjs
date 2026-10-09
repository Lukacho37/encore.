// Lance les parcours navigateur d'un niveau (PLAN.md 9.8) : `npm run e2e p0` exécute, l'un après l'autre,
// scripts/e2e/p0.mjs (s'il existe) puis scripts/e2e/p0-*.mjs ; `npm run e2e full` lance full.mjs ;
// `npm run e2e all` les lance tous (k0, p0-a…, full),
// `--legacy` ajoute le parcours historique scripts/e2e.mjs. Les variables (BASE, OUT, CHROMIUM…) sont transmises ;
// chaque script écrit ses captures dans $OUT/<script>/.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const level = (args.find((a) => !a.startsWith('--')) || '').toLowerCase();
if (!level) {
  console.log('Usage : node scripts/e2e/run.mjs <niveau|all> [--legacy]   (ex. k0, p0, p1)');
  process.exit(2);
}

const scripts = fs.readdirSync(dir)
  .filter((f) => /^[a-z0-9-]+\.mjs$/.test(f) && !['lib.mjs', 'run.mjs'].includes(f))
  .filter((f) => level === 'all' || f === `${level}.mjs` || f.startsWith(`${level}-`))
  .sort()
  .map((f) => path.join(dir, f));
if (args.includes('--legacy')) scripts.push(path.join(dir, '..', 'e2e.mjs'));
if (!scripts.length) {
  console.log(`Aucun parcours pour « ${level} » dans scripts/e2e/.`);
  process.exit(1);
}

const out = process.env.OUT || 'shots';
const results = [];
for (const file of scripts) {
  const name = path.basename(file, '.mjs');
  console.log(`\n▶ ${name}`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit', env: { ...process.env, OUT: path.join(out, name) } });
  results.push({ name, ok: r.status === 0, s: ((Date.now() - started) / 1000).toFixed(1) });
}

console.log('\nBilan :');
for (const r of results) console.log(`  ${r.ok ? 'OK    ' : 'ÉCHEC '} ${r.name} (${r.s} s)`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
