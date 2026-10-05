import { createApp } from './app.js';
import { config } from './config.js';

const { app, covers, importer } = createApp();

app.listen(config.port, (err) => {
  if (err) {
    console.error(`\n  Impossible de démarrer AlbumMania sur le port ${config.port} : ${err.message}\n`);
    process.exit(1);
  }
  console.log(`\n  AlbumMania — API prête sur http://localhost:${config.port}`);
  if (!config.isProd) console.log(`  Site (dev) : ${config.appUrl}`);
  if (!config.smtp && !config.isProd) console.log('  Aucun SMTP configuré : les e-mails arrivent dans la boîte de test (/dev/mailbox).');
  if (!config.smtp && config.isProd) console.warn('  ⚠ Aucun SMTP configuré : les e-mails de vérification ne partent pas (ils sont seulement écrits dans ce journal). Voir DEPLOIEMENT.md.');
  if (!config.adminEmails.length) console.log('  Aucun admin : renseigne ADMIN_EMAILS avec ton adresse pour activer l’espace admin.');
  else console.log(`  Admin réservé à : ${config.adminEmails.join(', ')}`);
  if (covers.order.length) console.log(`  Pochettes : ${covers.order.join(' puis ')}${config.spotify ? '' : ' (ajoute SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET pour Spotify)'}`);
  else if (config.covers === 'spotify') console.warn('  ⚠ COVERS=spotify mais SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET manquent : pochettes désactivées.');
  else if (process.env.COVERS && !/^\s*off\s*$/i.test(process.env.COVERS)) console.warn(`  ⚠ COVERS="${process.env.COVERS}" non reconnu : pochettes coupées (valeurs possibles : auto, spotify, deezer, off).`);
  else console.log('  Pochettes : désactivées (visuels générés).');
  covers.start();
  const cat = importer.status();
  if (cat.mode === 'off') console.log(`  Catalogue : ${cat.totalAlbums} albums (import automatique coupé, CATALOG_IMPORT=off).`);
  else if (cat.albums >= cat.target) console.log(`  Catalogue : ${cat.totalAlbums} albums (objectif de ${cat.target} albums importés atteint).`);
  else console.log(`  Catalogue : ${cat.totalAlbums} albums, import Deezer en cours vers ${cat.target} albums (suivi dans l'espace admin).`);
  importer.schedule();
  console.log('');
});
