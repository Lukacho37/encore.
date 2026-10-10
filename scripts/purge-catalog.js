// Retire du site tous les albums importés de Deezer (cartes des joueurs comprises) et garde les 20 albums de base.
// Avec CATALOG_IMPORT=off pour que le serveur ne réimporte rien, puis redémarre le serveur (il garde le catalogue en mémoire) :
//   DATABASE_FILE=/var/data/albummania.db node scripts/purge-catalog.js --yes
// Retire aussi tout ce qui dépend de ces albums, morceaux et artistes (PLAN.md 3.2, 3.7) : documents de la recherche
// globale, identifiants externes, coffrets, éléments de listes, agrégats et progression des joueurs. L'index de
// recherche est reconstruit au redémarrage suivant (quelques millisecondes pour les 20 albums de base).
import { openDb, tx } from '../server/db.js';

if (!process.argv.includes('--yes')) {
  console.log('Supprime tous les albums importés de Deezer et les cartes correspondantes des joueurs.');
  console.log('Relance avec --yes pour confirmer (fais d’abord une sauvegarde de la base).');
  process.exit(0);
}

const db = openDb();
const imported = "SELECT id FROM cat_tracks WHERE source = 'deezer'";
const importedAlbums = "SELECT id FROM cat_albums WHERE source = 'deezer'";
const importedArtists = "SELECT id FROM cat_artists WHERE source = 'deezer'";
const counts = tx(db, () => {
  // Joueurs touchés : leurs compteurs de cartes sont recalculés à la fin.
  const touched = db.prepare(`SELECT DISTINCT user_id FROM cards WHERE track_id IN (${imported})`).all().map((r) => r.user_id);
  const cards = db.prepare(`DELETE FROM cards WHERE track_id IN (${imported})`).run().changes;
  db.prepare(`DELETE FROM ratings WHERE (item_type = 'track' AND item_id IN (${imported}))
    OR (item_type = 'album' AND item_id IN (${importedAlbums}))`).run();
  db.prepare(`DELETE FROM rating_stats WHERE (item_type = 'track' AND item_id IN (${imported}))
    OR (item_type = 'album' AND item_id IN (${importedAlbums}))`).run();
  db.prepare(`DELETE FROM achievements WHERE key IN (SELECT 'album:' || id FROM cat_albums WHERE source = 'deezer')
    OR key IN (SELECT 'artist:' || id FROM cat_artists WHERE source = 'deezer')`).run();
  db.prepare("UPDATE users SET avatar = 'initials' WHERE avatar IN (SELECT 'album:' || id FROM cat_albums WHERE source = 'deezer')").run();
  db.prepare(`DELETE FROM user_album_progress WHERE album_id IN (${importedAlbums})`).run();

  // Listes : éléments retirés, nombre d'éléments recalculé.
  const lists = db.prepare(`SELECT DISTINCT list_id FROM list_items WHERE (item_type = 'track' AND item_id IN (${imported}))
    OR (item_type = 'album' AND item_id IN (${importedAlbums}))`).all().map((r) => r.list_id);
  db.prepare(`DELETE FROM list_items WHERE (item_type = 'track' AND item_id IN (${imported}))
    OR (item_type = 'album' AND item_id IN (${importedAlbums}))`).run();
  const recountList = db.prepare('UPDATE lists SET item_count = (SELECT COUNT(*) FROM list_items WHERE list_id = lists.id) WHERE id = ?');
  for (const id of lists) recountList.run(id);

  db.prepare(`DELETE FROM set_albums WHERE album_id IN (${importedAlbums})`).run();
  db.prepare(`DELETE FROM external_ids WHERE (entity_type = 'track' AND entity_id IN (${imported}))
    OR (entity_type = 'album' AND entity_id IN (${importedAlbums})) OR (entity_type = 'artist' AND entity_id IN (${importedArtists}))`).run();

  // Recherche globale : documents (et leurs lignes FTS) des éléments retirés ; reconstruction complète au démarrage.
  const docs = `SELECT id FROM search_docs WHERE (kind = 'track' AND ref_id IN (${imported}))
    OR (kind = 'album' AND ref_id IN (${importedAlbums})) OR (kind = 'artist' AND ref_id IN (${importedArtists}))`;
  db.prepare(`DELETE FROM search_fts WHERE rowid IN (${docs})`).run();
  db.prepare(`DELETE FROM search_tri WHERE rowid IN (${docs})`).run();
  const searchDocs = db.prepare(`DELETE FROM search_docs WHERE id IN (${docs})`).run().changes;
  db.prepare("DELETE FROM kv WHERE key IN ('search:version', 'search:marks')").run();

  const tracks = db.prepare("DELETE FROM cat_tracks WHERE source = 'deezer'").run().changes;
  db.prepare(`DELETE FROM cat_search WHERE album_id IN (${importedAlbums})`).run();
  const albums = db.prepare("DELETE FROM cat_albums WHERE source = 'deezer'").run().changes;
  db.prepare("DELETE FROM cat_artists WHERE source = 'deezer'").run();
  db.prepare('DELETE FROM import_artists').run();
  db.prepare("DELETE FROM kv WHERE key LIKE 'import%' OR key = 'rankBreaks'").run();

  const recountCards = db.prepare('UPDATE users SET unique_cards = (SELECT COUNT(DISTINCT track_id) FROM cards WHERE user_id = users.id) WHERE id = ?');
  for (const id of touched) recountCards.run(id);
  return { albums, tracks, cards, searchDocs };
});
db.exec('VACUUM');
console.log(`Retirés : ${counts.albums} albums, ${counts.tracks} cartes du catalogue, ${counts.cards} cartes de joueurs, ${counts.searchDocs} documents de recherche.`);
