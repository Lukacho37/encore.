// Tâches de nuit (PLAN.md 3.8) : chaque module déclare `export const jobs = [{ name, run(deps) }]`, app.js les
// enregistre ici après celles du cœur (CORE_JOBS). Le planificateur les lance chaque nuit à 04:10 heure de Paris, et
// une fois au démarrage pour chaque tâche dont la dernière exécution (kv['job:<nom>']) date de plus de 26 h.
// Chaque tâche tourne dans son propre try/catch : une tâche en panne n'empêche jamais les suivantes.
import { parisDate, parisMidnight, parisOffset } from '../shared/periods.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Heure des tâches, heure de Paris. */
export const RUN_AT = { hour: 4, minute: 10 };
/** Au démarrage, une tâche est rattrapée si sa dernière exécution date de plus de 26 h. */
export const STALE_MS = 26 * HOUR;

/** Prochain 04:10 à Paris strictement après `now` (changements d'heure compris). */
export function nextRunAt(now = Date.now(), { hour = RUN_AT.hour, minute = RUN_AT.minute } = {}) {
  const { y, m, d } = parisDate(now);
  for (let i = 0; i < 3; i++) {
    const midnight = parisMidnight(y, m, d + i);
    let at = midnight + hour * HOUR + minute * 60_000;
    // Un jour de changement d'heure, l'heure locale avance ou recule entre minuit et 04:10.
    at -= parisOffset(at) - parisOffset(midnight);
    if (at > now) return at;
  }
  return now + DAY;
}

/** Tâches du cœur (P0-A) : purges de rétention et entretien de la base. */
export const CORE_JOBS = [
  {
    // Sessions et jetons expirés ; comptes jamais vérifiés de plus de 7 jours (libère les pseudos réservés).
    name: 'purge-auth',
    run({ db }) {
      const now = Date.now();
      const sessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now).changes;
      const tokens = db.prepare('DELETE FROM email_tokens WHERE expires_at < ?').run(now).changes;
      const users = db.prepare('DELETE FROM users WHERE email_verified_at IS NULL AND created_at < ?').run(now - 7 * DAY).changes;
      return { sessions, tokens, users };
    },
  },
  {
    // Boîte e-mail de test : 7 jours.
    name: 'purge-dev-emails',
    run({ db }) {
      return { emails: db.prepare('DELETE FROM dev_emails WHERE created_at < ?').run(Date.now() - 7 * DAY).changes };
    },
  },
  {
    // Ouvertures de boosters : 400 jours (le Rétro de l'année en a besoin).
    name: 'purge-openings',
    run({ db }) {
      return { openings: db.prepare('DELETE FROM pack_openings WHERE created_at < ?').run(Date.now() - 400 * DAY).changes };
    },
  },
  {
    name: 'optimize',
    run({ db }) {
      db.exec('PRAGMA optimize');
      return {};
    },
  },
];

export function createJobs(deps, { log = console } = {}) {
  const jobs = new Map();
  let timer = null;
  let running = null;

  /** Enregistre les tâches d'un module (`owner` = nom du module, pour les journaux). */
  function register(owner, list = []) {
    for (const job of list) {
      if (!job || typeof job.name !== 'string' || typeof job.run !== 'function') {
        throw new TypeError(`jobs : tâche invalide dans le module « ${owner} »`);
      }
      if (jobs.has(job.name)) throw new Error(`jobs : la tâche « ${job.name} » est déclarée deux fois (${jobs.get(job.name).owner}, ${owner})`);
      jobs.set(job.name, { ...job, owner });
    }
  }
  register('core', CORE_JOBS);

  const kvKey = (name) => `job:${name}`;
  /** Date (ms) de la dernière exécution réussie d'une tâche, ou null. */
  const lastRun = (name) => {
    const row = deps.db.prepare('SELECT value FROM kv WHERE key = ?').get(kvKey(name));
    const at = Number(row?.value);
    return row && Number.isFinite(at) ? at : null;
  };
  const markRun = (name, at) => deps.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(kvKey(name), String(at));

  /** Lance une tâche tout de suite (tests, espace admin) ; ses erreurs remontent à l'appelant. */
  async function runJob(name) {
    const job = jobs.get(name);
    if (!job) throw new Error(`jobs : tâche inconnue « ${name} »`);
    const result = await job.run(deps);
    markRun(name, Date.now());
    return result;
  }

  /**
   * Lance les tâches demandées l'une après l'autre (toutes par défaut), chacune dans son try/catch.
   * Renvoie [{ name, ok, ms, result | error }].
   */
  async function runAll(names = [...jobs.keys()]) {
    const report = [];
    for (const name of names) {
      const started = Date.now();
      try {
        const result = await runJob(name);
        report.push({ name, ok: true, ms: Date.now() - started, result });
      } catch (err) {
        log.error?.(`[jobs] « ${name} » en erreur :`, err);
        report.push({ name, ok: false, ms: Date.now() - started, error: err.message });
      }
    }
    return report;
  }

  /** Tâches jamais lancées ou lancées il y a plus de 26 h. */
  const stale = (now = Date.now()) => [...jobs.keys()].filter((name) => {
    const at = lastRun(name);
    return at == null || now - at > STALE_MS;
  });

  async function track(promise) {
    running = promise;
    try {
      return await promise;
    } finally {
      running = null;
    }
  }

  function schedule() {
    clearTimeout(timer);
    const wait = Math.max(1000, nextRunAt(Date.now()) - Date.now());
    timer = setTimeout(async () => {
      await track(runAll());
      if (timer) schedule();
    }, wait);
    timer.unref?.();
  }

  /**
   * Démarre le planificateur (index.js, jamais dans les tests) : rattrapage des tâches en retard quelques secondes
   * après le démarrage, puis chaque nuit à 04:10 heure de Paris.
   */
  function start({ catchUpDelayMs = 5000 } = {}) {
    if (timer) return;
    const catchUp = setTimeout(() => {
      const late = stale();
      if (late.length) track(runAll(late));
    }, catchUpDelayMs);
    catchUp.unref?.();
    schedule();
  }

  function stop() {
    clearTimeout(timer);
    timer = null;
  }

  return {
    register,
    runJob,
    runAll,
    stale,
    lastRun,
    start,
    stop,
    nextRunAt: () => nextRunAt(Date.now()),
    names: () => [...jobs.keys()],
    get: (name) => jobs.get(name),
    /** Exécution en cours (promesse) ou null. */
    get running() {
      return running;
    },
  };
}
