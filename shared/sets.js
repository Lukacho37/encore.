// Coffrets (« sets », PLAN.md 6.8) — chantier P2-B. Partagé par le serveur (server/sets.js), la démo
// (client/src/demo/mock/sets.js) et le site (onglet Coffrets, page /sets/:id).
//
// Un coffret réunit 6 à 12 albums à compléter ; sa progression est le nombre d'albums complétés (achievements
// `album:<id>`), jamais un pourcentage du catalogue : « 3/8 du coffret French Touch » plutôt que « 0,1 % de 240 261 ».
// Trois sortes :
//   editorial  choisis à la main (ci-dessous) : albums désignés par leur identifiant de la graine ou par
//              « artiste + titre » (retrouvés dans le catalogue importé), complétés par une règle de remplissage ;
//   event      le coffret d'un événement (shared/events.js), même forme qu'un éditorial ;
//   generated  genre × décennie : les 8 albums les plus populaires, figés à la création (tâche `sets-generate`).
// Un coffret n'est créé que lorsqu'il réunit assez d'albums (MIN_SET_ALBUMS ; 8 pour un généré), puis sa liste ne
// bouge plus : la progression et les récompenses d'un joueur ne reculent jamais. Les coffrets restent ouverts pour
// toujours (pas de FOMO). Récompenses : aux 3/4 des albums (6 sur 8), le badge `badge:set:<id>:bronze` ; tous les
// albums, le cadre du coffret (`frame:set-<id>`, cosmétique AlbumMania, jamais une pochette).
import { THEME_GENRES } from './rules.js';

export const SET_KINDS = ['editorial', 'event', 'generated'];
/** Albums d'un coffret généré (genre × décennie). */
export const GENERATED_SIZE = 8;
/** Un coffret éditorial ou d'événement n'est créé qu'à partir de 6 albums retrouvés dans le catalogue. */
export const MIN_SET_ALBUMS = 6;
/** Au plus 12 albums par coffret. */
export const MAX_SET_ALBUMS = 12;
/** Décennies des coffrets générés. */
export const GENERATED_DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020];
/** Genres des coffrets générés (les clés des genres du catalogue). */
export const GENERATED_GENRES = THEME_GENRES;
/** Palier du badge d'un coffret. */
export const SET_BADGE_TIER = 'bronze';

// 35 caractères au plus : le cadre « frame:set-<id> » garde une clé de 40 caractères au plus (shared/cosmetics.js).
const SET_ID = /^(ed|ev|g)-[a-z0-9][a-z0-9-]{0,31}$/;

/** Noms des genres pour les titres des coffrets générés gardés en base (le site les retraduit avec genre.*). */
const GENRE_NAMES = {
  fr: {
    pop: 'Pop', rock: 'Rock', rap: 'Rap', electro: 'Électro', soul: 'R&B / Soul', jazz: 'Jazz', reggae: 'Reggae',
    chanson: 'Chanson française', latin: 'Latino', metal: 'Metal', country: 'Country / Folk', classical: 'Classique',
    soundtrack: 'Musiques de film', world: 'Musiques du monde',
  },
  en: {
    pop: 'Pop', rock: 'Rock', rap: 'Rap', electro: 'Electronic', soul: 'R&B / Soul', jazz: 'Jazz', reggae: 'Reggae',
    chanson: 'French chanson', latin: 'Latin', metal: 'Metal', country: 'Country / Folk', classical: 'Classical',
    soundtrack: 'Soundtracks', world: 'World music',
  },
};

const a = (artist, title, id = null) => ({ artist, title, ...(id ? { id } : {}) });

/**
 * Coffrets définis dans le code : éditoriaux et d'événements. `albums` : sélection dans l'ordre (identifiant de la
 * graine quand l'album en fait partie, sinon artiste + titre exacts) ; `fill` : règle qui complète jusqu'à `size`
 * avec les albums les plus populaires ({ genre, decade, year, from, to, country } ; le pays d'artiste passe d'abord
 * quand il est connu) ; `size` : nombre d'albums visé.
 */
export const CODE_SETS = [
  {
    id: 'ed-classiques', kind: 'editorial', size: 10,
    title: { fr: 'Les classiques du bac', en: 'Crate classics' },
    albums: [
      a('Miles Davis', 'Kind of Blue', 'kind-of-blue'),
      a('The Beatles', 'Abbey Road', 'abbey-road'),
      a('Pink Floyd', 'The Dark Side of the Moon', 'the-dark-side-of-the-moon'),
      a('Bob Marley & The Wailers', 'Exodus', 'exodus'),
      a('Serge Gainsbourg', 'Histoire de Melody Nelson', 'histoire-de-melody-nelson'),
      a('Michael Jackson', 'Thriller', 'thriller'),
      a('Queen', 'A Night at the Opera', 'a-night-at-the-opera'),
      a('Nirvana', 'Nevermind', 'nevermind'),
      a('Daft Punk', 'Discovery', 'discovery'),
      a('Amy Winehouse', 'Back to Black', 'back-to-black'),
    ],
  },
  {
    id: 'ed-essentiels-1977', kind: 'editorial', size: 10,
    title: { fr: 'Essentiels 1977', en: '1977 essentials' },
    albums: [
      a('Bob Marley & The Wailers', 'Exodus', 'exodus'),
      a('Fleetwood Mac', 'Rumours'),
      a('Sex Pistols', 'Never Mind the Bollocks, Here’s the Sex Pistols'),
      a('Sex Pistols', "Never Mind the Bollocks, Here's the Sex Pistols"),
      a('Pink Floyd', 'Animals'),
      a('Kraftwerk', 'Trans-Europe Express'),
      a('David Bowie', 'Low'),
      a('Television', 'Marquee Moon'),
      a('Steely Dan', 'Aja'),
      a('Talking Heads', 'Talking Heads: 77'),
      a('Ramones', 'Rocket to Russia'),
      a('The Clash', 'The Clash'),
    ],
    fill: { year: 1977 },
  },
  {
    id: 'ev-french-touch', kind: 'event', event: 'french-touch', size: 8,
    title: { fr: 'French Touch', en: 'French Touch' },
    albums: [
      a('Daft Punk', 'Discovery', 'discovery'),
      a('Daft Punk', 'Homework'),
      a('Air', 'Moon Safari', 'moon-safari'),
      a('Justice', '†'),
      a('Cassius', '1999'),
      a('Phoenix', 'Wolfgang Amadeus Phoenix'),
      a('Kavinsky', 'OutRun'),
      a('Sébastien Tellier', 'Sexuality'),
      a('Air', 'Talkie Walkie'),
      a('Daft Punk', 'Random Access Memories', 'random-access-memories'),
    ],
    fill: { genre: 'electro', from: 1994, to: 2014, country: 'FR' },
  },
  {
    id: 'ev-annees-80', kind: 'event', event: 'annees-80', size: 8,
    title: { fr: 'Années 80', en: 'The 80s' },
    albums: [
      a('Michael Jackson', 'Thriller', 'thriller'),
      a('Prince', 'Purple Rain'),
      a('Bruce Springsteen', 'Born in the U.S.A.'),
      a('U2', 'The Joshua Tree'),
      a('Guns N’ Roses', 'Appetite for Destruction'),
      a("Guns N' Roses", 'Appetite for Destruction'),
      a('AC/DC', 'Back in Black'),
      a('Madonna', 'Like a Virgin'),
      a('Kate Bush', 'Hounds of Love'),
      a('The Police', 'Synchronicity'),
    ],
    fill: { decade: 1980 },
  },
  {
    id: 'ev-rap-us-90', kind: 'event', event: 'rap-us-90', size: 8,
    title: { fr: 'Rap US 90', en: '90s US rap' },
    albums: [
      a('Nas', 'Illmatic'),
      a('Dr. Dre', 'The Chronic'),
      a('The Notorious B.I.G.', 'Ready to Die'),
      a('Wu-Tang Clan', 'Enter the Wu-Tang (36 Chambers)'),
      a('Lauryn Hill', 'The Miseducation of Lauryn Hill'),
      a('OutKast', 'Aquemini'),
      a('A Tribe Called Quest', 'The Low End Theory'),
      a('Snoop Dogg', 'Doggystyle'),
      a('2Pac', 'Me Against the World'),
      a('JAY-Z', 'Reasonable Doubt'),
    ],
    fill: { genre: 'rap', decade: 1990, country: 'US' },
  },
  {
    id: 'ev-rock-legends', kind: 'event', event: 'rock-legends', size: 8,
    title: { fr: 'Légendes du rock', en: 'Rock legends' },
    albums: [
      a('The Beatles', 'Abbey Road', 'abbey-road'),
      a('Pink Floyd', 'The Dark Side of the Moon', 'the-dark-side-of-the-moon'),
      a('Queen', 'A Night at the Opera', 'a-night-at-the-opera'),
      a('Nirvana', 'Nevermind', 'nevermind'),
      a('Led Zeppelin', 'Led Zeppelin IV'),
      a('The Rolling Stones', 'Exile on Main St.'),
      a('The Clash', 'London Calling'),
      a('Radiohead', 'OK Computer'),
      a('Eagles', 'Hotel California'),
    ],
    fill: { genre: 'rock' },
  },
];

const BY_ID = new Map(CODE_SETS.map((s) => [s.id, s]));

/** Définition d'un coffret du code (null pour un coffret généré). */
export const codeSet = (id) => BY_ID.get(id) || null;

/** Identifiant bien formé ? (routes) */
export const isSetId = (id) => typeof id === 'string' && SET_ID.test(id);

/** Identifiant d'un coffret généré : g-<genre>-<décennie>. */
export const generatedId = (genre, decade) => `g-${genre}-${decade}`;

/** Règle d'un coffret généré lue dans son identifiant : { genre, decade } ou null. */
export function generatedRule(id) {
  const m = /^g-([a-z]+)-(\d{4})$/.exec(String(id || ''));
  if (!m || !GENERATED_GENRES.includes(m[1]) || !GENERATED_DECADES.includes(Number(m[2]))) return null;
  return { genre: m[1], decade: Number(m[2]) };
}

/** Titres (fr, en) d'un coffret généré, gardés en base (le site les recompose avec ses propres noms de genre). */
export function generatedTitles(genre, decade) {
  const dFr = decade < 2000 ? String(decade % 100).padStart(2, '0') : String(decade);
  return {
    fr: `${GENRE_NAMES.fr[genre] || genre} · années ${dFr}`,
    en: `${GENRE_NAMES.en[genre] || genre} · ${decade}s`,
  };
}

/** Badge d'un coffret. */
export const setBadgeKey = (id) => `badge:set:${id}:${SET_BADGE_TIER}`;
/** Cadre d'un coffret (cosmétique). */
export const setFrameId = (id) => `frame:set-${id}`;

/**
 * Seuils et récompenses d'un coffret de `albumCount` albums : badge aux 3/4 (6 sur 8, 9 sur 12), cadre au complet.
 * Renvoie { badgeAt, frameAt, badge, frame }.
 */
export function setRewards(id, albumCount) {
  const n = Math.max(1, Number(albumCount) || 1);
  return { badgeAt: Math.max(1, Math.ceil((n * 3) / 4)), frameAt: n, badge: setBadgeKey(id), frame: setFrameId(id) };
}

/** Rang d'affichage des sortes de coffrets (éditoriaux, événements, générés). */
export const kindRank = (kind) => Math.max(0, SET_KINDS.indexOf(kind));
