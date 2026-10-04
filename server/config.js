import fs from 'node:fs';

// Configuration lue depuis les variables d'environnement (voir .env.example).
try {
  process.loadEnvFile();
} catch {
  // pas de fichier .env : on garde les valeurs par défaut
}

const env = process.env;

// Avant le renommage, la base s'appelait data/encore.db : on continue de l'utiliser si elle existe.
function defaultDbFile() {
  if (!fs.existsSync('data/albummania.db') && fs.existsSync('data/encore.db')) return 'data/encore.db';
  return 'data/albummania.db';
}
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT) || 3000;
const list = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const config = {
  isProd,
  isTest: env.NODE_ENV === 'test',
  port,
  appUrl: (env.APP_URL || (isProd ? `http://localhost:${port}` : 'http://localhost:5173')).replace(/\/$/, ''),
  dbFile: env.DATABASE_FILE || defaultDbFile(),
  trustProxy: env.TRUST_PROXY === 'true',

  packRegenMinutes: Number(env.PACK_REGEN_MINUTES) || 30,
  packMaxStock: Number(env.PACK_MAX_STOCK) || 5,

  // L'accès admin est réservé aux adresses listées ici (en pratique : la tienne).
  // Il est recalculé à chaque requête : il ne peut être ni stocké en base ni donné à quelqu'un d'autre.
  adminEmails: list(env.ADMIN_EMAILS),

  smtp: env.SMTP_HOST
    ? {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT) || 587,
        secure: env.SMTP_SECURE === 'true',
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      }
    : null,
  mailFrom: env.MAIL_FROM || 'AlbumMania <no-reply@albummania.local>',

  // Extraits audio du blind test : "off" (mode indices, par défaut) ou "itunes" (aperçus de 30 s de l'API iTunes Search).
  // Les conditions d'Apple interdisent ces aperçus dans un jeu : ne pas activer "itunes" sans autorisation écrite.
  blindtestAudio: env.BLINDTEST_AUDIO || 'off',
  previewCountry: env.PREVIEW_COUNTRY || 'FR',

  // Vraies pochettes : "auto" (Spotify si les clés sont renseignées, sinon Deezer), "spotify", "deezer" ou "off".
  // Les images ne sont jamais copiées : le site affiche celle hébergée par la plateforme, avec un lien vers elle.
  covers: ['auto', 'spotify', 'deezer', 'off'].includes(env.COVERS) ? env.COVERS : 'auto',
  coversMarket: (env.COVERS_MARKET || 'FR').toUpperCase(),
  spotify: env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET
    ? { clientId: env.SPOTIFY_CLIENT_ID, clientSecret: env.SPOTIFY_CLIENT_SECRET }
    : null,
  // Adresses des API : à ne changer que pour les tests.
  spotifyApiUrl: (env.SPOTIFY_API_URL || 'https://api.spotify.com').replace(/\/$/, ''),
  spotifyAccountsUrl: (env.SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com').replace(/\/$/, ''),
  deezerApiUrl: (env.DEEZER_API_URL || 'https://api.deezer.com').replace(/\/$/, ''),
};

export const SESSION_DAYS = 30;
export const VERIFY_TOKEN_HOURS = 24;
export const RESET_TOKEN_MINUTES = 60;
