// Mise en forme commune du passeport et du Rétro — chantier P2-A (fichier propre au dossier components/passport/) :
// mois et trimestres dans la langue du site, parts en pour cent, « il y a 12 min », noms de genres et de décennies,
// couleurs des genres (jetons de app.css, dans un ordre fixe vérifié pour le daltonisme : turquoise, violet, or,
// bleu, orange ; au-delà, « Autres » en gris), saison du Rétro (décembre et janvier, heure de Paris).
import { parisDate } from '@shared/periods.js';

/** Couleurs des genres, dans cet ordre (séparation vérifiée pour les trois formes de daltonisme). */
export const GENRE_COLORS = ['var(--cue)', 'var(--r-super)', 'var(--gold)', 'var(--r-rare)', 'var(--r-ultra)'];
export const OTHER_COLOR = 'var(--haze-2)';
/** Couleur de chaque rareté (celles des cartes). */
export const RARITY_COLORS = {
  common: 'var(--r-common)', uncommon: 'var(--r-uncommon)', rare: 'var(--r-rare)', super: 'var(--r-super)',
  ultra: 'var(--r-ultra)', legendary: 'var(--r-legendary)', promo: 'var(--r-promo)',
};

/** Nom d'un genre (identifiant gardé s'il n'a pas de traduction). */
export function genreName(t, id) {
  const label = t(`genre.${id}`);
  return label === `genre.${id}` ? String(id) : label;
}

/** « années 90 », « années 2000 » (« 90s », « 2000s »). */
export function decadeLabel(t, decade) {
  const d = Number(decade);
  return t('passport.decade', { d: d < 2000 ? String(d % 100).padStart(2, '0') : d });
}

/** Instant (ms) du milieu d'un mois « AAAA-MM » (assez loin des bords pour tous les fuseaux). */
const monthMid = (key) => {
  const [y, m] = String(key).split('-').map(Number);
  return Date.UTC(y, m - 1, 15, 12);
};

/** « mars 2026 » ; `short` : « mars » ; `narrow` : « M ». */
export function monthLabel(key, lang, { short = false, narrow = false, year = !short && !narrow } = {}) {
  const opts = { month: narrow ? 'narrow' : short ? 'short' : 'long', timeZone: 'UTC', ...(year ? { year: 'numeric' } : {}) };
  return new Intl.DateTimeFormat(lang, opts).format(new Date(monthMid(key)));
}

/** Mois et année d'un instant (« mars 2026 »), heure de Paris. */
export function monthOf(ms, lang) {
  const { y, m } = parisDate(ms);
  return monthLabel(`${y}-${String(m).padStart(2, '0')}`, lang);
}

/** « T3 2026 » / « Q3 2026 » d'une clé « 2026-T3 ». */
export function quarterLabel(t, key) {
  const [y, q] = String(key).split('-T');
  return t('passport.quarter', { q, y });
}

/** Part de 0 à 1 en pour cent (« 38 % », espace fine en français). */
export function pct(lang, share, digits = 0) {
  return new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: digits }).format(share || 0);
}

/** « il y a 12 min », « à l'instant », « hier ». */
export function ago(lang, at, now = Date.now()) {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' });
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return rtf.format(0, 'second');
  if (diff < 3_600_000) return rtf.format(-Math.floor(diff / 60_000), 'minute');
  if (diff < 86_400_000) return rtf.format(-Math.floor(diff / 3_600_000), 'hour');
  return rtf.format(-Math.floor(diff / 86_400_000), 'day');
}

/** Note (0 à 10) dans l'échelle du joueur : « 4,5 ★ » ou « 9/10 ». */
export function scoreLabel(t, lang, value, scale, digits = 1) {
  if (value == null) return '';
  const fmt = new Intl.NumberFormat(lang, { maximumFractionDigits: digits });
  return scale === 'points' ? t('passport.dist.points', { v: fmt.format(value) }) : t('passport.dist.stars', { v: fmt.format(value / 2) });
}

/**
 * Couleurs des genres d'un passeport : les 5 premiers genres de la collection (puis ceux de l'évolution) gardent la
 * même couleur dans tous les graphiques ; les autres sont regroupés en « Autres ».
 */
export function genreColors(passport) {
  const order = [...(passport?.distributions?.genres || []).map((g) => g.id), ...(passport?.evolution?.genres || [])];
  const map = new Map();
  for (const g of order) if (!map.has(g) && map.size < GENRE_COLORS.length) map.set(g, GENRE_COLORS[map.size]);
  return map;
}

// ----- saison du Rétro ----------------------------------------------------------------------------------------

/** Décembre ou janvier à Paris : la saison du Rétro (puce de l'accueil). */
export function isRetroSeason(now = Date.now()) {
  const { m } = parisDate(now);
  return m === 12 || m === 1;
}

/** Année du Rétro à mettre en avant : celle en cours en décembre, la précédente en janvier (et le reste de l'année). */
export function retroYear(now = Date.now()) {
  const { y, m } = parisDate(now);
  return m === 12 ? y : y - 1;
}
