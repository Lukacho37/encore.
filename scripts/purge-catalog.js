// Ancienne purge du catalogue importé de Deezer, REMPLACÉE par scripts/detach-provider.js (PLAN.md 3.2, 3.7, 7.1,
// chantier P2-C) : les joueurs gardent leurs cartes, leurs notes, leurs listes et leurs vinyles.
//   DATABASE_FILE=/var/data/albummania.db node scripts/purge-catalog.js --yes
// lance donc désormais le détachement de Deezer (non destructif : les albums non confirmés par MusicBrainz sont
// archivés, rien n'est supprimé). Puis CATALOG_IMPORT=off et COVERS=off, et redémarrage du serveur.
//
// La suppression d'origine reste possible pour une base de TEST seulement (elle efface les cartes des joueurs) :
//   node scripts/purge-catalog.js --destructive --yes
// Elle retire aussi tout ce qui dépend de ces albums, morceaux et artistes (PLAN.md 3.2, 3.7) : documents de la
// recherche globale, identifiants externes, coffrets, éléments de listes, agrégats et progression des joueurs. L'index
// de recherche est reconstruit au redémarrage suivant (quelques millisecondes pour les 20 albums de base).
import { openDb, tx } from '../server/db.js';
import { main as detach } from './detach-provider.js';

const yes = process.argv.includes('--yes');
if (!process.argv.includes('--destructive')) {
  if (!yes) {
    console.log('La purge est remplacée par le détachement du fournisseur (scripts/detach-provider.js) : les joueurs gardent tout.');
    console.log('Simulation :\n');
  }
  process.exitCode = detach(['deezer', ...(yes ? ['--yes'] : []), ...process.argv.slice(2).filter((a) => a === '--purge-facts' || a === '--json')]);
} else if (!yes) {
  console.log('Base de test seulement : supprime tous les albums importés de Deezer ET les cartes correspondantes des joueurs.');
  console.log('Relance avec --destructive --yes pour confirmer (fais d’abord une sauvegarde de la base).');
} else {
  destroy();
}

/** Suppression d'origine (base de test) : catalogue importé, cartes, notes et tout ce qui en dépend. */
function destroy() {
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
}
