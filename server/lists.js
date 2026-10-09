// Module « lists » : listes et « Mes 9 albums » (PLAN.md 4.2.4). Chantier : P1-C.
// Squelette posé par K0 (scripts/scaffold.mjs) : aucune route, et une API interne sans effet que les autres modules
// peuvent déjà appeler (deps.lists). Contrat de module : voir server/modules.js.
export const name = 'lists';

export function init(deps) {
  return {
    /** Remplace la grille « Mes 9 albums » d'un joueur (onboarding) ; sans effet ici. */
    setGrid9: (_userId, _albumIds) => {},
  };
}

export function routes(_r, _deps) {}
