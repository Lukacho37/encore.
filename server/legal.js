// Module « legal » : informations légales et acceptation des CGU (PLAN.md 4.1.5, 7.1). Chantier : P0-D.
// - GET  /api/legal/info   (public, limite guestRead, cache 1 h) : éditeur, directeur de la publication, hébergeur,
//   contact (variables LEGAL_*), version des CGU en vigueur, pochettes autorisées dans les images partagées,
//   plateformes d'où viennent les données et les pochettes affichées.
// - POST /api/legal/accept (joueur connecté) { version } : un compte existant accepte les CGU en vigueur après un
//   changement de version (409 terms_outdated si la version envoyée n'est plus celle en vigueur).
// L'inscription (case « J'accepte les CGU et j'ai 15 ans ou plus ») est dans server/auth.js ; ce module lui transmet
// les dépendances partagées (bus d'événements pour `user.verified`).
import { bindAuthDeps } from './auth.js';

export const name = 'legal';

/** Plateformes des pochettes réellement servies (même ordre que server/covers.js) et du catalogue importé. */
export function providersOf(config, { imported = false } = {}) {
  const mode = config.covers;
  const covers = mode === 'off' ? []
    : mode === 'spotify' ? (config.spotify ? ['spotify'] : [])
      : mode === 'deezer' ? ['deezer']
        : config.spotify ? ['spotify', 'deezer'] : ['deezer'];
  // Le grand catalogue (titres, artistes, pochettes, popularité) vient de l'API publique de Deezer.
  return [...new Set([...covers, ...(imported || config.catalogImport === 'deezer' ? ['deezer'] : [])])];
}

/** Réponse de GET /api/legal/info (aussi utilisée par les tests). */
export function legalInfo(config, { imported = false } = {}) {
  const legal = config.legal || {};
  const editor = legal.editor || {};
  const host = legal.host || {};
  return {
    editor: { name: editor.name ?? null, address: editor.address ?? null, email: editor.email ?? null },
    publicationDirector: legal.publicationDirector ?? null,
    host: { name: host.name ?? null, address: host.address ?? null, phone: host.phone ?? null },
    contactEmail: legal.contactEmail ?? null,
    termsVersion: config.termsVersion,
    termsUpdatedAt: config.termsUpdatedAt || config.termsVersion,
    // Vraies pochettes dans les images partagées (Mes 9 albums, Rétro…) : 'deezer' ou false (visuels générés).
    shareCovers: config.shareCovers || false,
    providers: providersOf(config, { imported }),
  };
}

export function init(deps) {
  // L'authentification (créée avant les modules par app.js) émet `user.verified` sur le bus des modules.
  bindAuthDeps(deps);
  const imported = () => {
    try {
      return (deps.catalog?.totals?.().imported || 0) > 0;
    } catch {
      return false;
    }
  };
  return {
    /** Informations légales publiques (forme de GET /api/legal/info). */
    info: () => legalInfo(deps.config, { imported: imported() }),
    /** Version des CGU en vigueur. */
    termsVersion: () => deps.config.termsVersion,
  };
}

export function publicRoutes(r, deps) {
  r.get('/legal/info', deps.limits.guestRead, (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(deps.legal.info());
  });
}

export function routes(r, deps) {
  r.post('/legal/accept', deps.limits.write, (req, res) => {
    const version = typeof req.body.version === 'string' ? req.body.version.trim() : '';
    if (!version) throw new deps.HttpError(400, 'invalid_input', { field: 'version' });
    // Une page restée ouverte pendant un changement de CGU renvoie l'ancienne version : on le dit plutôt que
    // d'enregistrer l'acceptation d'un texte que le joueur n'a pas vu.
    if (version !== deps.config.termsVersion) {
      throw new deps.HttpError(409, 'terms_outdated', { termsVersion: deps.config.termsVersion });
    }
    deps.db.prepare('UPDATE users SET terms_accepted_at = ?, terms_version = ? WHERE id = ?').run(Date.now(), version, req.user.id);
    res.json({ ok: true, state: deps.services.state(req.user.id, { partial: true }) });
  });
}
