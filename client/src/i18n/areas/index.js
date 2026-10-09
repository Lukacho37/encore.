// Textes par zone du site, fusionnés dans les dictionnaires principaux (une zone = un fichier, pour éviter les conflits).
// L'ordre compte : une zone plus bas peut préciser une clé d'une zone plus haut (et de fr.js / en.js).
// Zones de la refonte (PLAN.md 9.1, posées par K0) : chacune appartient à un chantier, voir scripts/owners.json.
import collection from './collection.js';
import home from './home.js';
import album from './album.js';
import profile from './profile.js';
import admin from './admin.js';
import track from './track.js';
import shell from './shell.js';
import legal from './legal.js';
import search from './search.js';
import safety from './safety.js';
import social from './social.js';
import studio from './studio.js';
import lists from './lists.js';
import game from './game.js';
import discover from './discover.js';
import play from './play.js';
import passport from './passport.js';
import sets from './sets.js';
import enrich from './enrich.js';
import workshop from './workshop.js';

export default [
  collection, home, album, profile, admin,
  track, shell, legal, search, safety, social, studio, lists, game, discover, play, passport, sets, enrich, workshop,
];
