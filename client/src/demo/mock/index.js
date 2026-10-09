// Registre des jumeaux de démo des modules du serveur (PLAN.md 9.1, K0), dans l'ordre de server/modules.js.
// Contrat d'un fichier client/src/demo/mock/<module>.js :
//   export const name = 'social';
//   export const routes = [[méthode, /^\/chemin$/, ({ params, body, query, ctx }) => réponse], …];
//     chemins sans le préfixe /api, comme les routes du cœur de mockServer.js ; elles sont essayées AVANT celles
//     du cœur (un module peut donc remplacer une route existante) ; `fail` de ctx lève une erreur d'API.
//   export function seed(db, ctx) {}     // une fois, sur une base de démo neuve (bots, contenus d'exemple)
//   export function migrate(db, ctx) {}  // à chaque chargement d'une sauvegarde : idempotent (db.posts ||= [] …),
//                                        // et sème ce qui manque à une sauvegarde d'avant le module.
// `ctx` (exporté par mockServer.js) : { db, me, userById, userByName, summaries(ids), refs, state, partialState,
// fail, save, now, rand, staticCatalog, TRACK, ALBUM, ARTIST }.
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

export default [
  moderation, notifications, search, ratings, tracks, legal, account, lists, collection, social, feed, studio,
  match, onboarding, discover, quests, badges, battles, passport, sets, events, enrich, workshop,
];
