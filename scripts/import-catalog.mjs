// Import du grand catalogue Deezer en ligne de commande, avec le même code que la tâche de fond du site
// (server/importer.js : genres et classements, albums studio dédoublonnés, /album/{id}, raretés par prestige,
// pochettes en adresse seulement, file d'artistes en base pour reprendre après une coupure).
//
//   DATABASE_FILE=data/albummania.db node scripts/import-catalog.mjs [--target 20000] [--rps 8] [--francophone] [--recalibrate]
//
// S'arrête à la cible ; relancé, il reprend où il en était. Affiche un compteur tous les 500 albums. Collecte ensuite le
// prestige des artistes et albums (server/prestige.js : Wikidata, ListenBrainz) puis calibre les raretés.
//   --recalibrate : recalcule toutes les raretés d'un catalogue déjà gelé (avant l'ouverture aux joueurs ; les cartes
//                   déjà tirées gardent la rareté de leur tirage).
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createCatalog } from '../server/catalog.js';
import { createImporter } from '../server/importer.js';
import { createPrestige } from '../server/prestige.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const target = arg('target', config.catalogTarget);
const rps = Math.min(8, Math.max(1, arg('rps', 8)));
const quiet = { log() {}, info() {}, warn() {}, error: console.error };

const db = openDb(config.dbFile, { log: null });
const catalog = createCatalog(db);
const prestige = createPrestige(db, { log: quiet });
const importer = createImporter(db, catalog, {
  cfg: { ...config, catalogImport: 'deezer', catalogTarget: target },
  pauseMs: Math.ceil(1000 / rps),
  log: quiet,
  prestige,
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

// --francophone : artistes francophones (Wikidata) en tête de file, pour un catalogue déjà importé sans eux.
if (process.argv.includes('--francophone')) console.log(`${await importer.discoverFrancophone(-100000)} artistes francophones dans la file`);
for (let attempt = 0; count() < target && attempt < 30; attempt += 1) {
  await importer.start({ force: true });
  if (count() < target) await new Promise((r) => setTimeout(r, 60_000));
}
clearInterval(tick);
const rated = await prestige.collect();
if (rated) console.log(`prestige : ${rated.albumsFound} albums sur ${rated.albums} rapprochés de Wikidata, ${rated.artistsFound} artistes sur ${rated.artists}`);
if (process.argv.includes('--recalibrate')) importer.recalibrate();
else importer.calibrate();
importer.stop?.();
console.log(`${count()} albums (cible ${target})`);
process.exit(0);
