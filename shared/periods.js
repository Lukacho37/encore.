// Périodes du jeu à l'heure de Paris (PLAN.md 3.1, 5.6) : jours de minuit à minuit, semaines du lundi 00:00 au
// lundi suivant, avec les changements d'heure. Partagé par le serveur (quêtes, quotas quotidiens, statistiques)
// et la démo. Clés : jour `d:2026-10-06`, semaine ISO `w:2026-W41`.

export const TIME_ZONE = 'Europe/Paris';
const HOUR = 3_600_000;
const DAY = 86_400_000;

let fmt = null;
try {
  fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
} catch {
  fmt = null;
}

/** Dernier dimanche du mois (0-11) à 01:00 UTC : heure du changement d'heure européen. */
const lastSundayAt1Utc = (y, m) => {
  const last = new Date(Date.UTC(y, m + 1, 0));
  return Date.UTC(y, m, last.getUTCDate() - last.getUTCDay(), 1);
};

/** Décalage de Paris sur UTC (ms) à l'instant `ms`. */
export function parisOffset(ms) {
  if (fmt) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
    const local = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return local - (ms - (ms % 1000 + 1000) % 1000);
  }
  // Moteur sans fuseaux horaires : règle européenne (été du dernier dimanche de mars au dernier dimanche d'octobre).
  const y = new Date(ms).getUTCFullYear();
  return ms >= lastSundayAt1Utc(y, 2) && ms < lastSundayAt1Utc(y, 9) ? 2 * HOUR : HOUR;
}

/** Date civile à Paris : { y, m (1-12), d, weekday (1 = lundi … 7 = dimanche) }. */
export function parisDate(ms = Date.now()) {
  const t = new Date(ms + parisOffset(ms));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: t.getUTCDay() || 7 };
}

/** Instant UTC de minuit, heure de Paris, du jour civil y-m-d (m de 1 à 12 ; les débordements sont permis). */
export function parisMidnight(y, m, d) {
  const utc = Date.UTC(y, m - 1, d);
  // Deux passes : le décalage de la veille au soir puis celui de minuit (les changements d'heure ont lieu à 2 h / 3 h).
  const guess = utc - parisOffset(utc - HOUR);
  return utc - parisOffset(guess);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Début (minuit à Paris) du jour qui contient `ms`, et début du jour suivant. */
export function dayStart(ms = Date.now()) {
  const { y, m, d } = parisDate(ms);
  return parisMidnight(y, m, d);
}
export function nextDayStart(ms = Date.now()) {
  const { y, m, d } = parisDate(ms);
  return parisMidnight(y, m, d + 1);
}

/** Début (lundi 00:00 à Paris) de la semaine qui contient `ms`, et début de la suivante. */
export function weekStart(ms = Date.now()) {
  const { y, m, d, weekday } = parisDate(ms);
  return parisMidnight(y, m, d - weekday + 1);
}
export function nextWeekStart(ms = Date.now()) {
  const { y, m, d, weekday } = parisDate(ms);
  return parisMidnight(y, m, d - weekday + 8);
}

/** Année et numéro de semaine ISO 8601 du jour civil y-m-d. */
function isoWeek(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday); // jeudi de la même semaine
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return { year, week };
}

/** Clé du jour à Paris : `d:2026-10-06`. */
export function dayKey(ms = Date.now()) {
  const { y, m, d } = parisDate(ms);
  return `d:${y}-${pad(m)}-${pad(d)}`;
}

/** Clé de la semaine ISO à Paris : `w:2026-W41`. */
export function weekKey(ms = Date.now()) {
  const { y, m, d } = parisDate(ms);
  const { year, week } = isoWeek(y, m, d);
  return `w:${year}-W${pad(week)}`;
}

/**
 * Bornes `{ start, end }` (ms, fin exclue) d'une clé `d:` ou `w:` ; null pour une autre clé
 * (`e:<slug>` dépend du calendrier des événements, `first` n'a pas de fin).
 */
export function periodBounds(key) {
  let match = /^d:(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
  if (match) {
    const [y, m, d] = match.slice(1).map(Number);
    return { start: parisMidnight(y, m, d), end: parisMidnight(y, m, d + 1) };
  }
  match = /^w:(\d{4})-W(\d{2})$/.exec(key || '');
  if (match) {
    const [year, week] = match.slice(1).map(Number);
    // Lundi de la semaine 1 = lundi de la semaine qui contient le 4 janvier.
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const monday = 4 - (jan4.getUTCDay() || 7) + 1 + (week - 1) * 7;
    return { start: parisMidnight(year, 1, monday), end: parisMidnight(year, 1, monday + 7) };
  }
  return null;
}

/** Bornes de la période courante : 'daily' ou 'weekly'. */
export function currentPeriod(scope, ms = Date.now()) {
  if (scope === 'daily') return { key: dayKey(ms), start: dayStart(ms), end: nextDayStart(ms) };
  if (scope === 'weekly') return { key: weekKey(ms), start: weekStart(ms), end: nextWeekStart(ms) };
  return null;
}
