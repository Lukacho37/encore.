// Module « search » : recherche globale avec autocomplétion (PLAN.md 4.1.4, 5.1). Chantier : P0-E.
// Squelette posé par K0 (scripts/scaffold.mjs) : aucune route, et une API interne sans effet que les autres modules
// peuvent déjà appeler (deps.search). Contrat de module : voir server/modules.js.
export const name = 'search';

export function init(deps) {
  return {
    /** Ajoute ou met à jour un document de recherche (album, morceau, artiste, membre, liste). */
    upsert: (_doc) => {},
    remove: (_kind, _id) => {},
    /** Recalcule l'index après un import du catalogue. */
    refresh: () => {},
  };
}

export function routes(_r, _deps) {}
