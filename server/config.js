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

// Interrupteur des pochettes : il échoue fermé. Vide ou absent = "auto" ; toute valeur inconnue (« OFF », « désactivé »,
// une faute de frappe…) coupe les pochettes plutôt que de les laisser allumées.
export function coversMode(v) {
  const mode = String(v ?? '').trim().toLowerCase();
  if (!mode) return 'auto';
  return ['auto', 'spotify', 'deezer'].includes(mode) ? mode : 'off';
}

// Import du catalogue : il échoue fermé, comme les pochettes. Absent = "deezer" (sauf pendant les tests) ; toute autre
// valeur que "deezer" (« off », « non », une faute de frappe…) coupe l'import automatique.
export function catalogImportMode(v, isTest = false) {
  const mode = String(v ?? '').trim().toLowerCase();
  if (!mode) return isTest ? 'off' : 'deezer';
  return mode === 'deezer' ? 'deezer' : 'off';
}

/** Adresse locale (localhost, 127.0.0.1, ::1, *.localhost) : seule une telle adresse autorise la boîte de test. */
export function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/**
 * Boîte e-mail de test (/dev/mailbox, /api/dev/emails) : seulement avec DEV_MAILBOX=1 ET une adresse APP_URL locale.
 * DEV_MAILBOX=1 avec une adresse publique est une erreur de configuration : le serveur refuse de démarrer
 * (sinon n'importe qui lirait les liens de confirmation et de mot de passe des joueurs).
 */
export function devMailboxMode(flag, appUrl) {
  const on = /^\s*(1|true|yes|on)\s*$/i.test(String(flag ?? ''));
  if (!on) return { enabled: false, error: null };
  if (!isLocalUrl(appUrl)) {
    return { enabled: false, error: `DEV_MAILBOX=1 n'est permis qu'avec une adresse APP_URL locale (reçu : ${appUrl}). Retire DEV_MAILBOX en production.` };
  }
  return { enabled: true, error: null };
}

const appUrl = (env.APP_URL || (isProd ? `http://localhost:${port}` : 'http://localhost:5173')).replace(/\/$/, '');
const devMailbox = devMailboxMode(env.DEV_MAILBOX, appUrl);
// Version des CGU en vigueur (date de publication) : un changement affiche le bandeau d'acceptation aux comptes
// existants et bloque leurs écritures publiques jusqu'à l'acceptation (PLAN.md 7.1).
const termsVersion = String(env.TERMS_VERSION || '2026-10-06').trim();
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export const config = {
  isProd,
  isTest: env.NODE_ENV === 'test',
  port,
  appUrl,
  // Cookies « Secure » dès que le site est servi en https (pas seulement avec NODE_ENV=production).
  secureCookies: isProd || appUrl.startsWith('https://'),
  // Boîte e-mail de test (voir devMailboxMode) ; devMailboxError non nul = le serveur refuse de démarrer.
  devMailbox: devMailbox.enabled,
  devMailboxError: devMailbox.error,
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

  // Le blind test se joue en mode indices uniquement : aucun extrait audio n'est diffusé (PLAN.md 7.1 ; l'ancien
  // interrupteur BLINDTEST_AUDIO=itunes est supprimé, les conditions d'Apple interdisent ces extraits dans un jeu).

  // Vraies pochettes : "auto" (= Deezer), "deezer" ou "off". Les images ne sont jamais copiées : le site affiche celle
  // hébergée par la plateforme, avec un lien vers elle. L'API Web de Spotify n'est plus utilisée (ses conditions
  // interdisent les jeux) : `spotify` reste toujours null, SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET sont ignorés.
  covers: coversMode(env.COVERS),
  coversRaw: env.COVERS,
  coversInvalid: coversMode(env.COVERS) === 'off' && !/^\s*off\s*$/i.test(env.COVERS || ''),
  coversMarket: (env.COVERS_MARKET || 'FR').toUpperCase(),
  spotify: null,
  // Vraies pochettes dans les images partagées (Mes 9 albums, Rétro…) : "deezer" pour les autoriser (composées dans
  // le navigateur seulement), sinon false = visuels AlbumMania générés (par défaut, PLAN.md 7.1).
  // Vraies pochettes dans les images de partage (décision du propriétaire) ; SHARE_COVERS=off les remplace par les visuels générés.
  shareCovers: /^\s*off\s*$/i.test(env.SHARE_COVERS || '') ? false : 'deezer',

  // Mentions légales (/legal/mentions, GET /api/legal/info) : éditeur, directeur de la publication, hébergeur.
  legal: {
    editor: { name: text(env.LEGAL_EDITOR_NAME), address: text(env.LEGAL_EDITOR_ADDRESS), email: text(env.LEGAL_EDITOR_EMAIL) },
    publicationDirector: text(env.LEGAL_PUBLICATION_DIRECTOR),
    host: { name: text(env.LEGAL_HOST_NAME), address: text(env.LEGAL_HOST_ADDRESS), phone: text(env.LEGAL_HOST_PHONE) },
    contactEmail: text(env.LEGAL_CONTACT_EMAIL) || text(env.LEGAL_EDITOR_EMAIL),
  },
  termsVersion,
  termsUpdatedAt: text(env.TERMS_UPDATED_AT) || termsVersion,
  // Grand catalogue importé depuis Deezer : "deezer" (par défaut) ou "off" (seulement les 20 albums de base).
  catalogImport: catalogImportMode(env.CATALOG_IMPORT, env.NODE_ENV === 'test'),
  catalogImportInvalid: !!String(env.CATALOG_IMPORT ?? '').trim() && !/^\s*(deezer|off)\s*$/i.test(env.CATALOG_IMPORT),
  catalogTarget: Math.max(0, Number(env.CATALOG_TARGET) || 20000),
  catalogMinArtistFans: Number(env.CATALOG_MIN_ARTIST_FANS) || 15000,
  catalogMinAlbumFans: Number(env.CATALOG_MIN_ALBUM_FANS) || 500,
  catalogMaxAlbumsPerArtist: Number(env.CATALOG_MAX_ALBUMS_PER_ARTIST) || 10,

  // Adresses des API : à ne changer que pour les tests.
  spotifyApiUrl: (env.SPOTIFY_API_URL || 'https://api.spotify.com').replace(/\/$/, ''),
  spotifyAccountsUrl: (env.SPOTIFY_ACCOUNTS_URL || 'https://accounts.spotify.com').replace(/\/$/, ''),
  deezerApiUrl: (env.DEEZER_API_URL || 'https://api.deezer.com').replace(/\/$/, ''),
};

export const SESSION_DAYS = 30;
export const VERIFY_TOKEN_HOURS = 24;
export const RESET_TOKEN_MINUTES = 60;
