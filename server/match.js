// Module « match » : Taste Match (PLAN.md 4.2.7, 5.3). Chantier : P1-E.
// Squelette posé par K0 (scripts/scaffold.mjs) : aucune route, et une API interne sans effet que les autres modules
// peuvent déjà appeler (deps.match). Contrat de module : voir server/modules.js.
export const name = 'match';

export function init(deps) {
  return {
    /** Score de goûts en cache entre deux joueurs ; null ici. */
    cachedScore: (_a, _b) => null,
  };
}

export function routes(_r, _deps) {}
