// Retour après la connexion — chantier P0-D (PLAN.md 2.1, P0.8) : la page demandée par un visiteur est gardée dans
// state.from (routes.jsx) et rouverte après la connexion, si c'est bien une page interne du site.

// Pages de connexion : jamais une destination après la connexion (on y reviendrait en boucle).
const AUTH_PATH = /^\/(login|signup|check-email|forgot|verify|reset)(?=[/?#]|$)/i;
const ORIGIN = 'http://albummania.invalid';

/**
 * Page à rouvrir après la connexion : seulement une adresse interne du site (chemin, requête, ancre), jamais une page
 * de connexion ni une adresse externe (« //exemple.com », « https://… », « /\exemple.com »…). Sinon l'accueil.
 */
export function safeFrom(from) {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || from.includes('\\')) return '/';
  let url;
  try {
    url = new URL(from, ORIGIN);
  } catch {
    return '/';
  }
  // Les tabulations et retours à la ligne sont retirés par l'analyse d'adresse : « /\t/exemple.com » change d'origine.
  if (url.origin !== ORIGIN || AUTH_PATH.test(url.pathname)) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
