// Sortie d'un fournisseur du catalogue (PLAN.md 3.7, 7.1) — chantier P2-C. Remplace la purge destructive
// (scripts/purge-catalog.js) : les joueurs gardent leurs cartes, leurs notes, leurs listes et leurs vinyles.
//
//   DATABASE_FILE=/var/data/albummania.db node scripts/detach-provider.js deezer            compte rendu, rien ne change
//   DATABASE_FILE=/var/data/albummania.db node scripts/detach-provider.js deezer --yes      détachement
//   … --yes --purge-facts      efface aussi les faits propres au fournisseur (rang d'écoute, fans, identifiants Deezer,
//                              file d'import) ;  --json : compte rendu en JSON.
//
// Ce que fait le détachement (server/enrich.js, detachProvider) : plus aucun appel au fournisseur (l'import refuse de
// démarrer), ses pochettes et ses liens ne s'affichent plus (visuels générés à la place) ; les albums, morceaux et
// artistes qu'une autre source confirme (identifiant MusicBrainz trouvé par code-barres, ISRC, ou titre et artiste :
// enrichissement de l'espace admin) restent au catalogue ; les autres passent en status = 'withdrawn' : absents des
// boosters, de la recherche, des duels et de Découvrir, mais « archivés » dans les collections, les notes et les
// listes. Rien n'est supprimé. Le même détachement existe dans l'espace admin (onglet Catalogue).
// Ensuite : CATALOG_IMPORT=off et COVERS=off dans l'environnement, puis redémarrage du serveur (il garde le catalogue
// en mémoire ; l'index de recherche est reconstruit au démarrage). Fais d'abord une sauvegarde de la base.
import { pathToFileURL } from 'node:url';
import { openDb } from '../server/db.js';
import { DETACHABLE, detachProvider } from '../server/enrich.js';
import { providerDetached } from '../server/importer.js';

const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n || 0);

/** Compte rendu lisible (une ligne par type d'élément, puis ce que gardent les joueurs). */
export function describe(report) {
  const row = (label, r) => `  ${label.padEnd(9)} ${fmt(r.kept).padStart(8)} gardés · ${fmt(r.withdrawn).padStart(8)} archivés`;
  return [
    `${report.dryRun ? 'Simulation (rien ne change)' : 'Détachement fait'} — fournisseur ${report.source} :`,
    row('Albums', report.albums),
    row('Morceaux', report.tracks),
    row('Promos', report.promos),
    row('Artistes', report.artists),
    `  Joueurs : ${fmt(report.players.withCards)} gardent ${fmt(report.players.cards)} cartes archivées ; ${fmt(report.players.ratings)} notes et ${fmt(report.players.listItems)} éléments de listes restent en place.`,
    `  Pochettes bloquées : ${fmt(report.covers)}.`,
    report.purgeFacts ? `  Faits du fournisseur effacés : ${fmt(report.facts.externalIds)} identifiants, file d'import vidée.` : null,
  ].filter(Boolean).join('\n');
}

/** Point d'entrée (aussi appelé par scripts/purge-catalog.js) ; renvoie le code de sortie. */
export function main(argv = process.argv.slice(2), { log = console.log, db: given = null } = {}) {
  const source = argv.find((a) => !a.startsWith('--'));
  const yes = argv.includes('--yes');
  const json = argv.includes('--json');
  const purgeFacts = argv.includes('--purge-facts');
  if (!source || !DETACHABLE.includes(source)) {
    log(`Usage : node scripts/detach-provider.js <${DETACHABLE.join('|')}> [--yes] [--purge-facts] [--json]`);
    return 2;
  }
  const db = given || openDb();
  try {
    const already = providerDetached(db, source);
    if (already && yes) {
      log(json ? JSON.stringify({ alreadyDetached: true, at: already.at }) : `${source} est déjà détaché (le ${new Date(already.at).toLocaleString('fr-FR')}).`);
      return 0;
    }
    const report = detachProvider(db, source, { dryRun: !yes, purgeFacts, by: 'script' });
    if (json) log(JSON.stringify(report));
    else {
      log(describe(report));
      log(yes
        ? '\nÀ faire maintenant : CATALOG_IMPORT=off et COVERS=off dans l’environnement, puis redémarre le serveur.'
        : '\nRelance avec --yes pour détacher (fais d’abord une sauvegarde de la base).');
    }
    return 0;
  } finally {
    if (!given) db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
