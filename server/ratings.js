// Module « ratings » : notes et critiques v2 (identifiants, statistiques, amis puis communauté) (PLAN.md 4.1.2). Chantier : P0-C.
// Squelette posé par K0 (scripts/scaffold.mjs) : aucune route, et une API interne sans effet que les autres modules
// peuvent déjà appeler (deps.ratings). Contrat de module : voir server/modules.js.
export const name = 'ratings';

export function init(deps) {
  return {
    /** Enregistre une note : pas encore disponible (501 not_ready) tant que P0-C n'a pas rempli le module. */
    rate: () => {
      throw new deps.HttpError(501, 'not_ready');
    },
    /** Résumé des notes d'un album ou d'un morceau ({ count, avg… }) ; null ici. */
    summaryOf: (_type, _id) => null,
  };
}

export function routes(_r, _deps) {}
