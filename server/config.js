// Configuration lue depuis les variables d'environnement (voir .env.example).
try {
  process.loadEnvFile();
} catch {
  // pas de fichier .env : on garde les valeurs par défaut
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT) || 3000;
const list = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const config = {
  isProd,
  isTest: env.NODE_ENV === 'test',
  port,
  appUrl: (env.APP_URL || (isProd ? `http://localhost:${port}` : 'http://localhost:5173')).replace(/\/$/, ''),
  dbFile: env.DATABASE_FILE || 'data/encore.db',
  trustProxy: env.TRUST_PROXY === 'true',

  packRegenMinutes: Number(env.PACK_REGEN_MINUTES) || 30,
  packMaxStock: Number(env.PACK_MAX_STOCK) || 5,

  adminEmails: list(env.ADMIN_EMAILS),
  // En développement, le tout premier compte créé devient admin pour faciliter les tests.
  firstUserIsAdmin: env.FIRST_USER_ADMIN ? env.FIRST_USER_ADMIN === 'true' : !isProd,

  smtp: env.SMTP_HOST
    ? {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT) || 587,
        secure: env.SMTP_SECURE === 'true',
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      }
    : null,
  mailFrom: env.MAIL_FROM || 'encore. <no-reply@encore.local>',

  // Extraits audio du blind test : "itunes" (aperçus de 30 s de l'API iTunes Search) ou "off" (mode indices).
  blindtestAudio: env.BLINDTEST_AUDIO || 'itunes',
  previewCountry: env.PREVIEW_COUNTRY || 'FR',
};

export const SESSION_DAYS = 30;
export const VERIFY_TOKEN_HOURS = 24;
export const RESET_TOKEN_MINUTES = 60;
