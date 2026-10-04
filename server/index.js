import { createApp } from './app.js';
import { config } from './config.js';

const { app } = createApp();

app.listen(config.port, () => {
  console.log(`\n  encore. — API prête sur http://localhost:${config.port}`);
  if (!config.isProd) console.log(`  Site (dev) : ${config.appUrl}`);
  if (!config.smtp) console.log('  Aucun SMTP configuré : les e-mails arrivent dans la boîte de test (/dev/mailbox).');
  console.log('');
});
