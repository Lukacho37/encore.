// Bus d'événements du domaine (PLAN.md 4.0) : un module annonce ce qui vient de se passer, les autres réagissent
// sans s'importer entre eux. `emit` est appelé APRÈS la validation de la transaction ; chaque abonné tourne de façon
// synchrone dans son propre try/catch (erreur journalisée, jamais propagée) : un fil d'actualité en panne ne peut pas
// casser l'ouverture d'un booster.

export function createBus({ log = console } = {}) {
  const handlers = new Map();

  /** Abonne `fn(payload)` à `event` ; renvoie la fonction de désabonnement. */
  function on(event, fn) {
    if (typeof fn !== 'function') throw new TypeError(`bus.on(${event}) : un abonné doit être une fonction`);
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
    return () => handlers.get(event)?.delete(fn);
  }

  /** Prévient les abonnés de `event` ; renvoie le nombre d'abonnés qui ont échoué (pour les tests). */
  function emit(event, payload) {
    let failed = 0;
    // Copie : un abonné peut se désabonner (ou en abonner un autre) pendant la diffusion.
    for (const fn of [...(handlers.get(event) || [])]) {
      try {
        fn(payload);
      } catch (err) {
        failed += 1;
        log.error?.(`[bus] abonné de « ${event} » en erreur :`, err);
      }
    }
    return failed;
  }

  const count = (event) => handlers.get(event)?.size || 0;

  return { on, emit, count };
}
