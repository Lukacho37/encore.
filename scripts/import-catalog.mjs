// Import du grand catalogue Deezer en ligne de commande, avec le même code que la tâche de fond du site
// (server/importer.js : genres et classements, albums studio dédoublonnés, /album/{id}, raretés par percentiles,
// pochettes en adresse seulement, file d'artistes en base pour reprendre après une coupure).
//
//   DATABASE_FILE=data/albummania.db node scripts/import-catalog.mjs [--target 20000] [--rps 8]
//
// S'arrête à la cible ; relancé, il reprend où il en était. Affiche un compteur tous les 500 albums.
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createCatalog } from '../server/catalog.js';
import { createImporter } from '../server/importer.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const target = arg('target', config.catalogTarget);
const rps = Math.min(8, Math.max(1, arg('rps', 8)));
const quiet = { log() {}, info() {}, warn() {}, error: console.error };

const db = openDb(config.dbFile, { log: null });
const catalog = createCatalog(db);
const importer = createImporter(db, catalog, {
  cfg: { ...config, catalogImport: 'deezer', catalogTarget: target },
  pauseMs: Math.ceil(1000 / rps),
  log: quiet,
});

const count = () => importer.status().albums;
let shown = Math.floor(count() / 500);
const tick = setInterval(() => {
  const n = count();
  if (Math.floor(n / 500) > shown) {
    shown = Math.floor(n / 500);
    console.log(`${n} albums`);
  }
}, 5000);

for (let attempt = 0; count() < target && attempt < 30; attempt += 1) {
  await importer.start({ force: true });
  if (count() < target) await new Promise((r) => setTimeout(r, 60_000));
}
importer.calibrate?.();
clearInterval(tick);
importer.stop?.();
console.log(`${count()} albums (cible ${target})`);
process.exit(0);
