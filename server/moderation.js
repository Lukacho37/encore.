// Module « moderation » : signalements, blocages, file de modération, décisions, appels, suspensions (PLAN.md 4.1.6). Chantier : P0-F.
// Squelette posé par K0 (scripts/scaffold.mjs) : aucune route, et une API interne sans effet que les autres modules
// peuvent déjà appeler (deps.moderation). Contrat de module : voir server/modules.js.
export const name = 'moderation';

export function init(deps) {
  // Règles d'accès permissives tant que P0-F n'a pas rempli le module (deps.access).
  const access = {
    /** Joueurs à masquer pour `viewerId` (bloqués dans un sens ou dans l'autre). */
    hiddenIds: (_viewerId) => new Set(),
    isBlocked: (_a, _b) => false,
    /** Visibilité d'un contenu de `ownerId` pour `viewerId` : 'public' | 'friends' | 'private'. */
    canSee: (viewerId, ownerId, visibility) => visibility === 'public' || viewerId === ownerId,
    /** Lève 403 suspended / terms_required pour une écriture de contenu ; sans effet ici. */
    assertActive: (_user) => {},
    /** Politique des liens d'un texte publié ; renvoie le texte tel quel ici. */
    linkPolicy: (text) => text,
  };
  return {
    access,
    /** Supprime tout ce qui dépend d'un contenu retiré (notifications, signalements…). */
    purgeTarget: (_type, _id) => {},
    /** Copie figée d'un contenu signalé (pour la décision de modération). */
    snapshot: (_type, _id) => null,
  };
}

export function routes(_r, _deps) {}
