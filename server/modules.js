// Registre des modules du serveur (PLAN.md 4.0, 9.1), dans l'ordre d'initialisation. Chaque fichier respecte le
// contrat de module :
//   export const name = 'social';               // clé de son API interne dans deps (deps.social)
//   export function init(deps) { return {}; }   // s'abonne à deps.bus, renvoie son API interne
//   export function routes(r, deps) {}          // monté sur /api après requireUser, AVANT les routes historiques
//   export function publicRoutes(r, deps) {}    // facultatif : monté sur /api sans compte
//   export function adminRoutes(r, deps) {}     // facultatif : monté sur /api/admin après requireAdmin
//   export const jobs = [];                      // facultatif : [{ name, run(deps) }] (server/jobs.js)
// Un module n'importe jamais le fichier d'un autre : il appelle deps.<nom>.<fonction>, et doit supporter le
// squelette sans effet (K0) d'un module rempli par un autre chantier du même niveau.
// Ajouter un module : créer son fichier (scripts/scaffold.mjs) et l'ajouter ici, à sa place dans l'ordre.
import * as moderation from './moderation.js';
import * as notifications from './notifications.js';
import * as search from './search.js';
import * as ratings from './ratings.js';
import * as tracks from './tracks.js';
import * as legal from './legal.js';
import * as account from './account.js';
import * as lists from './lists.js';
import * as collection from './collection.js';
import * as social from './social.js';
import * as feed from './feed.js';
import * as studio from './studio.js';
import * as match from './match.js';
import * as onboarding from './onboarding.js';
import * as discover from './discover.js';
import * as quests from './quests.js';
import * as badges from './badges.js';
import * as battles from './battles.js';
import * as passport from './passport.js';
import * as sets from './sets.js';
import * as events from './events.js';
import * as enrich from './enrich.js';
import * as workshop from './workshop.js';

export const MODULES = [
  moderation, notifications, search, ratings, tracks, legal, account, lists, collection, social, feed, studio,
  match, onboarding, discover, quests, badges, battles, passport, sets, events, enrich, workshop,
];

export default MODULES;
