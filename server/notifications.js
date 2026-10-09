// Module « notifications » : notifications (demandes d'ami, décisions de modération, puis sociales en P1) (PLAN.md 4.1.7). Chantier : P0-F.
// Squelette posé par K0 (scripts/scaffold.mjs) : aucune route, et une API interne sans effet que les autres modules
// peuvent déjà appeler (deps.notifications). Contrat de module : voir server/modules.js.
export const name = 'notifications';

export function init(deps) {
  return {
    /** Crée (ou regroupe) une notification ; sans effet ici. */
    notify: (_userId, _kind, _data) => {},
    unreadCount: (_userId) => 0,
  };
}

export function routes(_r, _deps) {}
