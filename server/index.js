import { createApp } from './app.js';
import { config } from './config.js';

const { app } = createApp();

app.listen(config.port, () => {
  console.log(`\n  AlbumMania — API prête sur http://localhost:${config.port}`);
  if (!config.isProd) console.log(`  Site (dev) : ${config.appUrl}`);
  if (!config.smtp) console.log('  Aucun SMTP configuré : les e-mails arrivent dans la boîte de test (/dev/mailbox).');
  if (!config.adminEmails.length) console.log('  Aucun admin : renseigne ADMIN_EMAILS avec ton adresse pour activer l’espace admin.');
  else console.log(`  Admin réservé à : ${config.adminEmails.join(', ')}`);
  console.log('');
});
