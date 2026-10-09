import { createApp } from './app.js';
import { config } from './config.js';

// DEV_MAILBOX=1 avec une adresse publique : refus de démarrer (les liens des e-mails seraient lisibles par tous).
if (config.devMailboxError) {
  console.error(`\n  Impossible de démarrer AlbumMania : ${config.devMailboxError}\n`);
  process.exit(1);
}

const { app, covers, importer, jobs } = createApp();

app.listen(config.port, (err) => {
  if (err) {
    console.error(`\n  Impossible de démarrer AlbumMania sur le port ${config.port} : ${err.message}\n`);
    process.exit(1);
  }
  console.log(`\n  AlbumMania — API prête sur http://localhost:${config.port}`);
  if (!config.isProd) console.log(`  Site (dev) : ${config.appUrl}`);
  if (!config.smtp && config.devMailbox) console.log('  Aucun SMTP configuré : les e-mails arrivent dans la boîte de test (/dev/mailbox, DEV_MAILBOX=1).');
  else if (!config.smtp && !config.isProd) console.log('  Aucun SMTP configuré : les e-mails sont seulement écrits dans ce journal (DEV_MAILBOX=1 ouvre la boîte de test /dev/mailbox).');
  if (!config.smtp && config.isProd) console.warn('  ⚠ Aucun SMTP configuré : les e-mails de vérification ne partent pas (ils sont seulement écrits dans ce journal). Voir DEPLOIEMENT.md.');
  if (!config.adminEmails.length) console.log('  Aucun admin : renseigne ADMIN_EMAILS avec ton adresse pour activer l’espace admin.');
  else console.log(`  Admin réservé à : ${config.adminEmails.join(', ')}`);
  if (covers.order.length) console.log(`  Pochettes : ${covers.order.join(' puis ')}`);
  else if (config.covers === 'spotify') console.warn('  ⚠ COVERS=spotify : l’API de Spotify n’est plus utilisée (ses conditions interdisent les jeux), pochettes désactivées. Mets COVERS=auto pour Deezer.');
  else if (process.env.COVERS && !/^\s*off\s*$/i.test(process.env.COVERS)) console.warn(`  ⚠ COVERS="${process.env.COVERS}" non reconnu : pochettes coupées (valeurs possibles : auto, deezer, off).`);
  else console.log('  Pochettes : désactivées (visuels générés).');
  covers.start();
  const cat = importer.status();
  if (config.catalogImportInvalid) console.warn(`  ⚠ CATALOG_IMPORT="${process.env.CATALOG_IMPORT}" non reconnu : import automatique coupé (valeurs possibles : deezer, off).`);
  if (cat.mode === 'off') console.log(`  Catalogue : ${cat.totalAlbums} albums (import automatique coupé, CATALOG_IMPORT=${config.catalogImportInvalid ? 'non reconnu' : 'off'}).`);
  else if (cat.paused) console.log(`  Catalogue : ${cat.totalAlbums} albums, import Deezer en pause (bouton « Lancer » de l'espace admin pour reprendre).`);
  else if (cat.albums >= cat.target) console.log(`  Catalogue : ${cat.totalAlbums} albums (objectif de ${cat.target} albums importés atteint ; nouvelles sorties vérifiées chaque jour).`);
  else console.log(`  Catalogue : ${cat.totalAlbums} albums, import Deezer en cours vers ${cat.target} albums (suivi dans l'espace admin).`);
  importer.schedule();
  // Tâches de nuit : 04:10 heure de Paris, et rattrapage au démarrage des tâches en retard de plus de 26 h.
  jobs.start();
  const next = new Date(jobs.nextRunAt()).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  console.log(`  Tâches de nuit : ${jobs.names().length}, prochaine exécution le ${next} (heure de Paris).`);
  console.log('');
});
