// Jumeau de démo du module « legal » (server/legal.js, P0-D, PLAN.md 4.1.5) : mêmes routes, mêmes formes.
// GET /legal/info : coordonnées vides (la démo n'a pas d'éditeur déclaré : les pages affichent « non renseigné »),
// version des CGU, plateformes : Deezer quand les vraies pochettes sont intégrées à la page (../covers.js), aucune sinon
// (visuels générés et catalogue de base).
// POST /legal/accept : enregistre l'acceptation de la version en vigueur (409 terms_outdated sinon).
import { DEMO_COVERS } from '../covers.js';

export const name = 'legal';

/** Version des CGU de la démo : la même que celle du cœur (client/src/demo/mockServer.js, TERMS_VERSION). */
export const TERMS_VERSION = '2026-10-06';

export function legalInfo() {
  return {
    editor: { name: null, address: null, email: null },
    publicationDirector: null,
    host: { name: null, address: null, phone: null },
    contactEmail: null,
    termsVersion: TERMS_VERSION,
    termsUpdatedAt: TERMS_VERSION,
    shareCovers: !!DEMO_COVERS,
    providers: DEMO_COVERS ? ['deezer'] : [],
  };
}

export const routes = [
  ['GET', /^\/legal\/info$/, () => legalInfo()],
  ['POST', /^\/legal\/accept$/, ({ body, ctx }) => {
    const u = ctx.me();
    const version = typeof body?.version === 'string' ? body.version.trim() : '';
    if (!version) ctx.fail(400, 'invalid_input', { field: 'version' });
    if (version !== TERMS_VERSION) ctx.fail(409, 'terms_outdated', { termsVersion: TERMS_VERSION });
    u.termsAcceptedAt = Date.now();
    u.termsVersion = version;
    return { ok: true, state: ctx.partialState() };
  }],
];

export function seed() {}

export function migrate() {}
