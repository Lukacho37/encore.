// Retire du site tous les albums importés de Deezer (cartes des joueurs comprises) et garde les 20 albums de base.
// Avec CATALOG_IMPORT=off pour que le serveur ne réimporte rien, puis redémarre le serveur (il garde le catalogue en mémoire) :
//   DATABASE_FILE=/var/data/albummania.db node scripts/purge-catalog.js --yes
import { openDb, tx } from '../server/db.js';

if (!process.argv.includes('--yes')) {
  console.log('Supprime tous les albums importés de Deezer et les cartes correspondantes des joueurs.');
  console.log('Relance avec --yes pour confirmer (fais d’abord une sauvegarde de la base).');
  process.exit(0);
}

const db = openDb();
const imported = "SELECT id FROM cat_tracks WHERE source = 'deezer'";
const counts = tx(db, () => {
  const cards = db.prepare(`DELETE FROM cards WHERE track_id IN (${imported})`).run().changes;
  db.prepare(`DELETE FROM ratings WHERE (item_type = 'track' AND item_id IN (${imported}))
    OR (item_type = 'album' AND item_id IN (SELECT id FROM cat_albums WHERE source = 'deezer'))`).run();
  db.prepare("DELETE FROM achievements WHERE key IN (SELECT 'album:' || id FROM cat_albums WHERE source = 'deezer') OR key IN (SELECT 'artist:' || id FROM cat_artists WHERE source = 'deezer')").run();
  db.prepare("UPDATE users SET avatar = 'initials' WHERE avatar IN (SELECT 'album:' || id FROM cat_albums WHERE source = 'deezer')").run();
  const tracks = db.prepare("DELETE FROM cat_tracks WHERE source = 'deezer'").run().changes;
  db.prepare("DELETE FROM cat_search WHERE album_id IN (SELECT id FROM cat_albums WHERE source = 'deezer')").run();
  const albums = db.prepare("DELETE FROM cat_albums WHERE source = 'deezer'").run().changes;
  db.prepare("DELETE FROM cat_artists WHERE source = 'deezer'").run();
  db.prepare('DELETE FROM import_artists').run();
  db.prepare("DELETE FROM kv WHERE key LIKE 'import%' OR key = 'rankBreaks'").run();
  return { albums, tracks, cards };
});
db.exec('VACUUM');
console.log(`Retirés : ${counts.albums} albums, ${counts.tracks} cartes du catalogue, ${counts.cards} cartes de joueurs.`);
