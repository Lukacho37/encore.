// Module « collection » : jeu de collection : liste d'envies, focus, paliers de niveau, cosmétiques (PLAN.md 4.2.5, 6). Chantier : P1-D.
// Squelette posé par K0 (scripts/scaffold.mjs) : aucune route, et une API interne sans effet que les autres modules
// peuvent déjà appeler (deps.collection). Contrat de module : voir server/modules.js.
export const name = 'collection';

export function init(deps) {
  return {
    /** Ajoute de l'XP (P1-D y ajoutera les récompenses de niveau et l'événement level.up). */
    addXp: (userId, xp) => {
      deps.db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(xp, userId);
    },
    grantBooster: (_userId, _kind, _data) => {},
    grantCosmetic: (_userId, _key) => {},
    unlockedCosmetics: (_userId) => [],
  };
}

export function routes(_r, _deps) {}
