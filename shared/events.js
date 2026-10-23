// Calendrier des événements (PLAN.md 6.9) — chantier P2-B. Défini dans le code (pas de table) et partagé par le
// serveur (server/events.js, server/quests.js), la démo (client/src/demo/mock/events.js) et le site (pages
// Événements, pastille de l'accueil).
//
// Un événement : deux semaines autour d'un thème (Rétro : décembre et janvier), fenêtre en jours civils de Paris
// (`from` et `to` inclus : du lundi 00:00 au lundi suivant 00:00 pour « 16–29 nov. »). Il apporte :
//   - 3 quêtes d'événement (période `e:<slug>` de user_quests, progression comptée dans la fenêtre comme les autres
//     quêtes, shared/quests.js), et un bonus quand les 3 sont réclamées : le badge de l'événement
//     (`badge:event:<slug>:gold`), son cadre quand il en a un, et son booster thématique (`event:<slug>`) ;
//   - une catégorie de battles existante (genre:electro, decade:1980…) : les votes de la fenêtre dans cette catégorie
//     portent battle_votes.event_slug, et elle est la catégorie du jour des battles pendant l'événement ;
//   - un coffret d'événement (shared/sets.js, `ev-<slug>`), qui reste ouvert après l'événement.
// Récompenses : des créations AlbumMania (cadres, badges), jamais une pochette, un logo ou un nom d'artiste ; le cadre
// se gagne pendant l'événement, le badge du coffret reste accessible ensuite (pas de FOMO dur). Les noms évitent les
// marques déposées (« Chansons d'Europe », jamais « Eurovision »).
import { parisDate, parisMidnight } from './periods.js';

export const EVENT_KINDS = ['event', 'retro'];
/** Quêtes par événement (slots 0 à 2 de la période e:<slug>). */
export const EVENT_SLOTS = 3;
/** Récompense de chaque quête d'événement (deux semaines pour la faire : un peu plus qu'une quête de la semaine). */
export const EVENT_QUEST_REWARD = { royalties: 120, xp: 100 };
/** Palier du badge d'un événement (les 3 quêtes réclamées pendant l'événement). */
export const EVENT_BADGE_TIER = 'gold';
/** La pastille de l'accueil annonce un événement à venir jusqu'à 21 jours avant son début. */
export const UPCOMING_DAYS = 21;
/** Fenêtre d'un aperçu (démo, parcours de test) : commencé il y a 2 jours, encore 12 jours. */
export const PREVIEW_BEFORE_DAYS = 2;
export const PREVIEW_AFTER_DAYS = 12;

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DAY = 86_400_000;

const quest = (id, category, metric, target, params = null) => ({
  id, category, metric, target, ...(params ? { params } : {}), reward: EVENT_QUEST_REWARD,
});

/**
 * Les événements, dans l'ordre du calendrier. `battle` : catégorie de battles (shared/battles.js) ; `setId` : coffret
 * de l'événement (shared/sets.js) ; `frame` : cadre gagné avec le bonus (cosmétique, shared/cosmetics.js) ;
 * `booster` : booster thématique du bonus (shared/rules.js EVENT_THEMES ; « taste » quand l'événement n'a pas de thème).
 */
export const EVENTS = [
  {
    slug: 'french-touch', kind: 'event', from: '2026-11-16', to: '2026-11-29', icon: 'disc',
    title: { fr: 'French Touch', en: 'French Touch' },
    battle: 'genre:electro', setId: 'ev-french-touch', frame: 'frame:french-touch', booster: 'event:french-touch',
    quests: [
      quest('ft-cards', 'collect', 'new_cards', 10, { genre: 'electro' }),
      quest('ft-set', 'collect', 'complete_album', 1, { set: 'ev-french-touch' }),
      quest('ft-battles', 'discover', 'battle_votes', 15, { event: 'french-touch' }),
    ],
  },
  {
    slug: 'retro-2026', kind: 'retro', year: 2026, from: '2026-12-01', to: '2027-01-31', icon: 'star',
    title: { fr: 'AlbumMania Rétro 2026', en: 'AlbumMania Rétro 2026' },
    battle: null, setId: null, frame: null, booster: 'taste',
    quests: [
      quest('rt26-rate', 'rate', 'rate_albums', 10),
      quest('rt26-complete', 'collect', 'complete_album', 1),
      quest('rt26-battles', 'discover', 'battle_votes', 20),
    ],
  },
  {
    slug: 'annees-80', kind: 'event', from: '2027-01-18', to: '2027-01-31', icon: 'disc',
    title: { fr: 'Années 80', en: 'The 80s' },
    battle: 'decade:1980', setId: 'ev-annees-80', frame: null, booster: 'event:annees-80',
    quests: [
      quest('a80-cards', 'collect', 'new_cards', 12, { decade: 1980 }),
      quest('a80-rate', 'rate', 'rate_albums', 3, { decade: 1980 }),
      quest('a80-battles', 'discover', 'battle_votes', 15, { event: 'annees-80' }),
    ],
  },
  {
    slug: 'rap-us-90', kind: 'event', from: '2027-02-15', to: '2027-02-28', icon: 'disc',
    title: { fr: 'Rap US 90', en: '90s US rap' },
    battle: 'genre_decade:rap:1990', setId: 'ev-rap-us-90', frame: null, booster: 'event:rap-us-90',
    quests: [
      quest('r90-cards', 'collect', 'new_cards', 10, { genre: 'rap', decade: 1990 }),
      quest('r90-rate', 'rate', 'rate_albums', 3, { genre: 'rap', decade: 1990 }),
      quest('r90-battles', 'discover', 'battle_votes', 15, { event: 'rap-us-90' }),
    ],
  },
  {
    slug: 'rock-legends', kind: 'event', from: '2027-03-15', to: '2027-03-28', icon: 'disc',
    title: { fr: 'Légendes du rock', en: 'Rock legends' },
    battle: 'genre:rock', setId: 'ev-rock-legends', frame: 'frame:rock-legends', booster: 'event:rock-legends',
    quests: [
      quest('rl-cards', 'collect', 'new_cards', 12, { genre: 'rock' }),
      quest('rl-set', 'collect', 'complete_album', 1, { set: 'ev-rock-legends' }),
      quest('rl-battles', 'discover', 'battle_votes', 15, { event: 'rock-legends' }),
    ],
  },
  {
    // Semaine du concours européen de la chanson (mai 2027) : dates à confirmer quand elles seront publiées.
    slug: 'chansons-d-europe', kind: 'event', from: '2027-05-10', to: '2027-05-16', icon: 'headphones',
    title: { fr: 'Chansons d’Europe', en: 'Songs of Europe' },
    battle: 'genre:chanson', setId: null, frame: null, booster: 'event:chansons-d-europe',
    quests: [
      quest('ce-tracks', 'rate', 'rate_tracks', 10),
      quest('ce-cards', 'collect', 'new_cards', 8, { genre: 'chanson' }),
      quest('ce-battles', 'discover', 'battle_votes', 10, { event: 'chansons-d-europe' }),
    ],
  },
  {
    // Défi de la communauté : chacun fait sa liste des albums de l'été.
    slug: 'albums-de-l-ete', kind: 'event', from: '2027-07-05', to: '2027-07-18', icon: 'list',
    title: { fr: 'Albums de l’été', en: 'Summer albums' },
    battle: 'global:album', setId: null, frame: null, booster: 'taste',
    quests: [
      quest('ete-list', 'discover', 'add_to_list', 5),
      quest('ete-rate', 'rate', 'rate_albums', 5),
      quest('ete-battles', 'discover', 'battle_votes', 15, { event: 'albums-de-l-ete' }),
    ],
  },
];

const BY_SLUG = new Map(EVENTS.map((e) => [e.slug, e]));

/** Définition d'un événement (sans sa fenêtre résolue). */
export const eventDef = (slug) => BY_SLUG.get(String(slug || '')) || null;

/** Clé de période des quêtes d'un événement : `e:<slug>`. */
export const eventPeriodKey = (slug) => `e:${slug}`;

/** `e:<slug>` → slug (null si la clé n'est pas celle d'un événement du calendrier). */
export function slugOfKey(key) {
  const m = /^e:([a-z0-9][a-z0-9-]{0,39})$/.exec(String(key || ''));
  return m && BY_SLUG.has(m[1]) ? m[1] : null;
}

/** Badge d'un événement : `badge:event:<slug>:gold`. */
export const eventBadgeKey = (slug) => `badge:event:${slug}:${EVENT_BADGE_TIER}`;

const ymd = (s) => s.split('-').map(Number);

/** Fenêtre d'un événement du calendrier : { start, end } en ms (fin exclue), jours civils de Paris. */
export function eventWindow(def) {
  const [y1, m1, d1] = ymd(def.from);
  const [y2, m2, d2] = ymd(def.to);
  return { start: parisMidnight(y1, m1, d1), end: parisMidnight(y2, m2, d2 + 1) };
}

/** Fenêtre d'un aperçu autour de `anchor` : commencé il y a 2 jours (minuit), fini dans 12 jours (minuit). */
export function previewWindow(anchor) {
  const { y, m, d } = parisDate(anchor);
  return { start: parisMidnight(y, m, d - PREVIEW_BEFORE_DAYS), end: parisMidnight(y, m, d + PREVIEW_AFTER_DAYS + 1) };
}

/** Prochain événement (hors Rétro) qui n'a pas commencé à `now` ; sinon le premier du calendrier. */
export function nextEventSlug(now = Date.now()) {
  const next = EVENTS.find((e) => e.kind === 'event' && eventWindow(e).start > now);
  return (next || EVENTS.find((e) => e.kind === 'event')).slug;
}

/**
 * Calendrier résolu à l'instant `now` : [{ ...définition, start, end, status: 'current' | 'upcoming' | 'past',
 * preview }]. `preview` : slug d'un événement montré « en cours » (démo, parcours de test ; jamais en production),
 * sa fenêtre étant `previewWindow(previewAnchor)`.
 */
export function resolveCalendar({ now = Date.now(), preview = null, previewAnchor = now } = {}) {
  return EVENTS.map((def) => {
    const shown = preview && def.slug === preview;
    const win = shown ? previewWindow(previewAnchor) : eventWindow(def);
    const status = now < win.start ? 'upcoming' : now >= win.end ? 'past' : 'current';
    return { ...def, start: win.start, end: win.end, status, preview: !!shown };
  });
}

/**
 * Jours civils de Paris entre aujourd'hui et `until` (un minuit de Paris) : 1 le dernier jour d'un événement, 0 après.
 * L'arrondi absorbe l'heure gagnée ou perdue aux changements d'heure.
 */
export function daysUntil(until, now = Date.now()) {
  const { y, m, d } = parisDate(now);
  return Math.max(0, Math.round((until - parisMidnight(y, m, d)) / DAY));
}

/**
 * Quête d'un événement → { def, vars } (même forme que parseQuest de shared/quests.js), ou null. La définition porte
 * scope 'event' et le slug de l'événement.
 */
export function parseEventQuest(slug, questId) {
  const ev = eventDef(slug);
  const q = ev?.quests.find((x) => x.id === questId);
  if (!q) return null;
  return { def: { ...q, scope: 'event', event: ev.slug, weight: 0 }, vars: {} };
}

/** Le slug est-il bien formé ? (routes) */
export const isEventSlug = (slug) => SLUG.test(String(slug || '')) && BY_SLUG.has(slug);
