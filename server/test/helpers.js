// Outils communs des tests du serveur (PLAN.md 9.0) : une application sur une base en mémoire et un port libre,
// des inscriptions vérifiées en une ligne, un petit client HTTP qui garde les cookies.
//   const app = await startApp();                       // catalogue de base (20 albums)
//   const app = await startApp({ catalog: { artists: 40 } });  // + catalogue importé d'un faux Deezer
//   const alice = await signupVerified(app, { username: 'alice' });
//   const r = await api(app.base, alice.cookie, 'GET', '/state');   // → { status, body, cookie, headers }
// Les variables d'environnement d'un test (ADMIN_EMAILS…) doivent être posées avant le premier startApp().
import { once } from 'node:events';

process.env.NODE_ENV = 'test';
process.env.COVERS ??= 'off';
process.env.BLINDTEST_AUDIO ??= 'off';

export const PASSWORD = 'motdepasse123';

const IMPORT_CFG = {
  catalogImport: 'deezer',
  catalogMinArtistFans: 15000,
  catalogMinAlbumFans: 100,
  catalogMaxAlbumsPerArtist: 10,
  deezerApiUrl: 'https://deezer.test',
  covers: 'auto',
};

/**
 * Démarre une application complète (modules compris) sur `:memory:` et un port libre.
 * `catalog` : absent → catalogue de base ; objet → import d'un faux Deezer avant le démarrage
 * (`{ artists, albumsPerArtist, target }`, voir fakeDeezer.js) ; fonction `async (db) => {}` → préparation libre.
 * Renvoie `{ app, db, deps, services, catalog, jobs, server, base, close() }`.
 */
export async function startApp({ catalog } = {}) {
  const { openDb } = await import('../db.js');
  const { createApp } = await import('../app.js');
  const db = openDb(':memory:');
  if (typeof catalog === 'function') await catalog(db);
  else if (catalog) {
    const { createCatalog } = await import('../catalog.js');
    const { createImporter } = await import('../importer.js');
    const { makeFakeDeezer } = await import('./fakeDeezer.js');
    const { target = 150, ...fakeOptions } = catalog;
    const importer = createImporter(db, createCatalog(db, { covers: () => true }), {
      cfg: { ...IMPORT_CFG, catalogTarget: target },
      fetchImpl: makeFakeDeezer(fakeOptions).fetchImpl,
      pauseMs: 0,
      log: { warn() {}, log() {} },
    });
    await importer.start();
  }
  const ctx = createApp({ db });
  const server = ctx.app.listen(0);
  await once(server, 'listening');
  const base = `http://localhost:${server.address().port}`;
  const close = () => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
  return { ...ctx, server, base, close };
}

/** Fusionne les Set-Cookie d'une réponse dans une chaîne `Cookie` (un cookie expiré est retiré). */
function mergeCookies(cookie, res) {
  const jar = new Map((cookie || '').split(';').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i), p.slice(i + 1)];
  }));
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(';');
    const i = pair.indexOf('=');
    const k = pair.slice(0, i).trim();
    if (attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) jar.delete(k);
    else jar.set(k, pair.slice(i + 1).trim());
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Appel HTTP vers l'application, avec l'en-tête anti-CSRF. `path` avec ou sans le préfixe /api.
 * Renvoie `{ status, body, cookie, headers }` ; `cookie` contient les cookies reçus en plus de ceux envoyés.
 */
export async function api(base, cookie, method, path, body) {
  const url = base + (path.startsWith('/api/') || path === '/api' ? path : `/api${path}`);
  const res = await fetch(url, {
    method,
    headers: {
      'X-AlbumMania': '1',
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(cookie && { Cookie: cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Réponse qui n'est pas du JSON : gardée telle quelle.
  }
  return { status: res.status, body: parsed, cookie: mergeCookies(cookie, res), headers: res.headers };
}

let counter = 0;

/**
 * Inscrit un joueur (CGU acceptées, 15 ans ou plus) et confirme son adresse avec le lien de la boîte de test.
 * Renvoie `{ cookie, user, state, email, username, password }`. `app` = résultat de startApp().
 */
export async function signupVerified(app, { email, username, password = PASSWORD, lang = 'fr' } = {}) {
  counter += 1;
  username ??= `joueur${counter}_${process.pid % 1000}`;
  email ??= `${username.toLowerCase()}@example.com`;
  const signup = await api(app.base, '', 'POST', '/auth/signup', { email, username, password, lang, acceptTerms: true, age15: true });
  if (signup.status !== 201) throw new Error(`inscription de ${username} : ${signup.status} ${JSON.stringify(signup.body)}`);
  const mail = app.db.prepare('SELECT text FROM dev_emails WHERE to_addr = ? ORDER BY id DESC LIMIT 1').get(email.toLowerCase());
  const token = /token=([\w-]+)/.exec(mail?.text || '')?.[1];
  if (!token) throw new Error(`pas d'e-mail de confirmation pour ${email}`);
  const verify = await api(app.base, signup.cookie, 'POST', '/auth/verify', { token });
  if (verify.status !== 200) throw new Error(`confirmation de ${username} : ${verify.status} ${JSON.stringify(verify.body)}`);
  return { cookie: verify.cookie, user: verify.body.user, state: verify.body, email, username, password };
}

/** Connexion d'un joueur existant ; renvoie le cookie de session. */
export async function login(app, identifier, password = PASSWORD) {
  const r = await api(app.base, '', 'POST', '/auth/login', { identifier, password });
  if (r.status !== 200) throw new Error(`connexion de ${identifier} : ${r.status} ${JSON.stringify(r.body)}`);
  return r.cookie;
}
