import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb, tx } from './db.js';
import { createMailer } from './mailer.js';
import { createServices, HttpError } from './services.js';
import { createAuth } from './auth.js';
import { createCovers } from './covers.js';
import { createCatalog } from './catalog.js';
import { createImporter } from './importer.js';
import { createLimits, createQuota } from './security.js';
import { createBus } from './bus.js';
import { createJobs } from './jobs.js';
import { createLru } from './lru.js';
import * as validate from './validate.js';
import * as paging from './paging.js';
import * as periods from '../shared/periods.js';
import { MODULES } from './modules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `dbFile` : fichier SQLite (':memory:' en test) ; `db` : base déjà ouverte (tests qui préparent un catalogue
 * avant le démarrage, comme en production où les données existent avant le serveur).
 */
/**
 * En-têtes de sécurité de toutes les réponses (PLAN.md 7.2). Les entrées Google Fonts de la CSP partiront avec
 * l'hébergement des polices (P2-E) ; les pochettes viennent du CDN de Deezer, les lecteurs intégrés de leurs sites.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.dzcdn.net https://coverartarchive.org https://*.archive.org",
  'frame-src https://widget.deezer.com https://open.spotify.com https://embed.music.apple.com',
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function securityHeaders({ hsts = false } = {}) {
  const headers = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (hsts) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

export function createApp({ dbFile, db: openedDb } = {}) {
  // DEV_MAILBOX=1 avec une adresse publique : on refuse de démarrer plutôt que d'exposer les liens des e-mails.
  if (config.devMailboxError) throw new Error(config.devMailboxError);
  const db = openedDb || openDb(dbFile);
  const bus = createBus();
  const mailer = createMailer(db);
  const catalog = createCatalog(db);
  const importer = createImporter(db, catalog);
  const services = createServices(db, catalog, { bus });
  const auth = createAuth(db, mailer, services);
  const covers = createCovers(db);

  // Dépendances partagées par tous les modules (PLAN.md 4.0). Chaque module ajoute ensuite son API interne sous
  // son nom (deps.ratings, deps.search…), dans l'ordre de server/modules.js. `limits` : limites nommées (read, write,
  // search, heavy, guestRead, guestForm) ; `quota(userId, kind)` : quotas quotidiens ; `refs()` : références du
  // catalogue d'une réponse ; `tx(fn)` : transaction ; `lru({ max, ttlMs })` : fabrique de caches ; `validate`,
  // `paging`, `periods` : outils communs ; `access` et `notify` : raccourcis vers moderation et notifications.
  const limits = createLimits({ isTest: config.isTest });
  const deps = {
    db, config, catalog, services, bus, limits, quota: createQuota(db), refs: services.refs,
    tx: (fn) => tx(db, fn), HttpError, validate, paging, lru: createLru, periods,
    access: null, notify: null,
  };
  for (const mod of MODULES) {
    if (!mod.name || mod.name in deps) throw new Error(`Module serveur sans nom ou en double : « ${mod.name} »`);
    deps[mod.name] = mod.init?.(deps) ?? {};
    // Raccourcis du contrat : règles de visibilité et blocages (P0-F), envoi d'une notification (P0-F).
    if (mod.name === 'moderation') deps.access = deps.moderation.access;
    if (mod.name === 'notifications') deps.notify = deps.notifications.notify;
  }
  // Les services appellent les modules par deps (règles d'accès, notifications non lues, quotas).
  services.bind(deps);
  // Tâches de nuit : celles du cœur (server/jobs.js) puis celles des modules ; jobs.start() est lancé par index.js.
  const jobs = createJobs(deps);
  for (const mod of MODULES) jobs.register(mod.name, mod.jobs);

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  const headers = securityHeaders({ hsts: config.isProd && config.appUrl.startsWith('https://') });
  app.use((req, res, next) => {
    res.set(headers);
    // Réponses de l'API jamais gardées en cache par défaut (une route peut en décider autrement).
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  // Requête sans corps JSON (pas de Content-Type) : un objet vide, pour une erreur de validation plutôt qu'une 500.
  app.use((req, _res, next) => {
    req.body ??= {};
    next();
  });

  // Protection CSRF : toute requête qui modifie des données doit porter l'en-tête X-AlbumMania,
  // qu'un site tiers ne peut pas ajouter sans autorisation CORS.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.get('X-AlbumMania') !== '1') return res.status(403).json({ error: 'csrf' });
    next();
  });

  app.use('/api', auth.loadUser);
  app.use('/api/auth', auth.router);

  // Pochettes et liens d'écoute : publics, l'écran de connexion en affiche aussi.
  app.get('/api/covers', (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json(covers.snapshot());
  });

  const api = express.Router();
  const requireUser = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'unauthenticated')));
  const requireAdmin = (req, _res, next) => (services.isAdmin(req.user) ? next() : next(new HttpError(403, 'forbidden')));
  const actionLimit = limits.write;

  // Navigation dans le catalogue : beaucoup de petites requêtes (défilement, recherche), limite à part.
  const browseLimit = limits.read;
  // Sans compte, limite par adresse IP (plus basse : l'écran de connexion n'affiche que quelques cartes).
  const guestBrowseLimit = limits.guestRead;
  const openBrowse = (req, res, next) => (req.user ? browseLimit : guestBrowseLimit)(req, res, next);

  // Cartes et chiffres du catalogue : lisibles sans compte (l'éventail de cartes de l'écran de connexion),
  // rien de propre à un joueur. Tout le reste de /api/catalog demande d'être connecté.
  app.get('/api/catalog/tracks', openBrowse, (req, res) => res.json(services.tracksByIds(req.query.ids)));
  app.get('/api/catalog/info', openBrowse, (_req, res) => res.json({ totals: catalog.totals(), genres: catalog.genres(), decades: catalog.decades() }));

  // Boîte e-mail de test, uniquement hors production et sans SMTP configuré.
  app.get('/api/dev/emails', (req, res) => {
    if (!mailer.devMailbox) return res.status(404).json({ error: 'not_found' });
    res.json(db.prepare('SELECT id, to_addr AS "to", subject, text, html, created_at AS createdAt FROM dev_emails ORDER BY id DESC LIMIT 30').all());
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // Routes publiques des modules (sans compte) : chaque route choisit sa limite (deps.limits.guestRead…).
  const publicApi = express.Router();
  for (const mod of MODULES) mod.publicRoutes?.(publicApi, deps);
  app.use('/api', publicApi);

  // Routeur des joueurs connectés : routes des modules d'abord (elles peuvent remplacer une route historique),
  // puis le sous-routeur admin, puis les routes historiques.
  const user = express.Router();
  user.use(requireUser);
  for (const mod of MODULES) mod.routes?.(user, deps);

  // Espace admin : un seul sous-routeur, gardé une fois (ADMIN_EMAILS, recalculé à chaque requête).
  const admin = express.Router();
  admin.use(requireAdmin, actionLimit);
  for (const mod of MODULES) mod.adminRoutes?.(admin, deps);
  user.use('/admin', admin);

  const browse = express.Router();
  browse.use(browseLimit);
  browse.get('/albums', (req, res) => res.json(services.browseAlbums(req.user.id, req.query)));
  browse.get('/albums/:id', (req, res) => res.json(services.albumDetail(req.params.id)));
  browse.get('/artists', (req, res) => res.json(services.artistsByIds(req.query.ids)));
  browse.get('/artists/:id', (req, res) => res.json(services.artistDetail(req.params.id)));
  browse.get('/promos', (req, res) => res.json(services.browsePromos(req.query)));
  browse.get('/mine', (req, res) => res.json(services.myCards(req.user.id, req.query)));
  browse.get('/groups', (req, res) => res.json(services.groups(req.user.id, req.query.by)));
  user.use('/catalog', browse);

  // Lectures (état, profils, amis, notes) : limite `read` ; actions : limite `write` (PLAN.md 4.0).
  api.use((req, res, next) => (req.method === 'GET' ? limits.read : actionLimit)(req, res, next));

  // État complet : seulement ici (et à la connexion). Les actions renvoient un état partiel + leurs deltas
  // (PLAN.md 4.1.1) ; le site les fusionne (client/src/state/mergeState.js).
  api.get('/state', (req, res) => res.json(services.state(req.user.id)));
  const partial = (req) => services.state(req.user.id, { partial: true });
  const full = (req) => services.state(req.user.id);

  api.post('/packs/open', (req, res) => {
    const result = services.openPacks(req.user.id, req.body.count);
    res.json({ ...result, state: partial(req) });
  });
  api.post('/packs/album', (req, res) => {
    const result = services.openAlbumPack(req.user.id, req.body.albumId);
    res.json({ ...result, state: partial(req) });
  });
  api.post('/shop/buy-pack', (req, res) => {
    const result = services.buyPack(req.user.id);
    res.json({ ...result, state: partial(req) });
  });
  // Recycler change le nombre d'exemplaires de chaque carte : état complet.
  api.post('/collection/recycle', (req, res) => {
    const result = services.recycleDuplicates(req.user.id);
    res.json({ ...result, state: full(req) });
  });
  api.post('/collection/press', (req, res) => {
    const result = services.pressCard(req.user.id, req.body.trackId);
    res.json({ ...result, state: partial(req) });
  });

  api.post('/profile/avatar', (req, res) => {
    services.setAvatar(req.user.id, req.body.avatar, req.body.color);
    res.json({ state: partial(req) });
  });
  api.post('/profile/showcase', (req, res) => {
    services.setShowcase(req.user.id, req.body.slots);
    res.json({ state: partial(req) });
  });
  api.post('/profile/lang', (req, res) => {
    services.setLang(req.user.id, req.body.lang);
    res.json({ ok: true });
  });
  api.post('/profile/settings', (req, res) => {
    // Tout est validé avant d'écrire : un champ refusé n'en enregistre aucun.
    if (req.body.ratingScale !== undefined && !['stars', 'points'].includes(req.body.ratingScale)) throw new HttpError(400, 'invalid_scale');
    if (req.body.prefs !== undefined) services.setPrefs(req.user.id, req.body.prefs);
    if (req.body.ratingScale !== undefined) services.setRatingScale(req.user.id, req.body.ratingScale);
    res.json({ state: partial(req) });
  });
  api.get('/users/:username', (req, res) => res.json(services.publicProfile(req.user.id, req.params.username)));
  api.get('/users/:username/ratings', (req, res) => res.json(services.userRatings(req.params.username)));

  // Notes & critiques : :type = album | track ; l'identifiant d'un morceau contient « : » (ex. discovery:01).
  api.get('/ratings/feed', (req, res) => res.json(services.friendsFeed(req.user.id)));
  api.get('/ratings/:type/:id', (req, res) => res.json(services.itemRatings(req.user.id, req.params.type, req.params.id)));
  // `rating` : le delta de la note du joueur (score null = note retirée), fusionné dans state.ratings par le site.
  api.put('/ratings/:type/:id', (req, res) => {
    services.rate(req.user.id, req.params.type, req.params.id, req.body.score, req.body.review);
    const { type, id } = req.params;
    res.json({ ...services.itemRatings(req.user.id, type, id), rating: { type, id, score: req.body.score }, state: partial(req) });
  });
  api.delete('/ratings/:type/:id', (req, res) => {
    services.unrate(req.user.id, req.params.type, req.params.id);
    const { type, id } = req.params;
    res.json({ ...services.itemRatings(req.user.id, type, id), rating: { type, id, score: null }, state: partial(req) });
  });

  // Amis : chaque action renvoie aussi l'état partiel (pastille des demandes reçues à jour sans recharger l'état).
  api.get('/friends', (req, res) => res.json(services.listFriends(req.user.id)));
  api.post('/friends/request', (req, res) => res.json({ ...services.requestFriend(req.user.id, req.body.username), state: partial(req) }));
  api.post('/friends/:id/accept', (req, res) => {
    services.respondFriend(req.user.id, req.params.id, true);
    res.json({ ...services.listFriends(req.user.id), state: partial(req) });
  });
  api.post('/friends/:id/decline', (req, res) => {
    services.respondFriend(req.user.id, req.params.id, false);
    res.json({ ...services.listFriends(req.user.id), state: partial(req) });
  });
  api.delete('/friends/:userId', (req, res) => {
    services.removeFriend(req.user.id, req.params.userId);
    res.json({ ...services.listFriends(req.user.id), state: partial(req) });
  });

  api.get('/blindtest', (req, res) => res.json(services.blindtestInfo(req.user.id)));
  api.post('/blindtest/start', async (req, res) => res.json(await services.startBlindtest(req.user.id, req.body.genre)));
  api.post('/blindtest/:id/answer', (req, res) => {
    const result = services.answerBlindtest(req.user.id, req.params.id, req.body.choice ?? null);
    res.json(result.final ? { ...result, state: partial(req) } : result);
  });
  api.post('/blindtest/:id/next', async (req, res) => res.json(await services.nextBlindtestRound(req.user.id, req.params.id)));

  // Routes historiques de l'espace admin (après celles des modules). Chaque action qui modifie est écrite dans
  // admin_audit (services.audit, aussi offert aux modules par deps.services.audit).
  const audit = (req, action, target, payload) => services.audit(req.user.id, action, target, payload);
  admin.get('/overview', (req, res) => res.json(services.adminOverview({ cursor: req.query.cursor, limit: req.query.limit })));
  admin.post('/users/:id/grant', (req, res) => {
    const result = services.adminGrant(req.params.id, req.body);
    audit(req, 'grant', `user:${Number(req.params.id) || 0}`, result);
    res.json(result);
  });
  admin.get('/covers', (req, res) => res.json(covers.status()));
  admin.post('/covers/refresh', (req, res) => {
    covers.refresh();
    audit(req, 'covers.refresh');
    res.json(covers.status());
  });
  admin.get('/reviews', (req, res) => res.json(services.adminReviews()));
  admin.delete('/reviews/:userId/:type/:id', (req, res) => {
    services.adminDeleteReview(req.params.userId, req.params.type, req.params.id);
    audit(req, 'review.delete', `review:${req.params.userId}:${req.params.type}:${req.params.id}`);
    res.json(services.adminReviews());
  });
  // Outils de test sur la collection de l'admin : état complet (beaucoup de cartes changent d'un coup).
  admin.post('/me/reset', (req, res) => {
    services.adminResetCollection(req.user.id);
    audit(req, 'me.reset');
    res.json({ state: full(req) });
  });
  admin.get('/catalog', (req, res) => res.json(importer.status()));
  admin.post('/catalog/import', (req, res) => {
    importer.start({ force: true });
    audit(req, 'catalog.import');
    res.json(importer.status());
  });
  admin.post('/catalog/pause', (req, res) => {
    importer.pause();
    audit(req, 'catalog.pause');
    res.json(importer.status());
  });
  admin.post('/me/complete', (req, res) => {
    services.adminCompleteCollection(req.user.id, req.body.albumId);
    audit(req, 'me.complete', req.body.albumId ? `album:${String(req.body.albumId).slice(0, 80)}` : null);
    res.json({ state: full(req) });
  });
  admin.post('/me/almost', (req, res) => {
    const result = services.adminAlmostAlbum(req.user.id, req.body.albumId);
    audit(req, 'me.almost', `album:${String(req.body.albumId).slice(0, 80)}`);
    res.json({ ...result, state: full(req) });
  });

  user.use(api);
  app.use('/api', user);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

  // En production, le serveur sert aussi le site compilé (npm run build).
  const dist = path.join(root, 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    // Corps au-delà de 32 Ko (les exports et images partagées sont construits dans le navigateur, jamais envoyés).
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    // Autre corps illisible (encodage, type) : erreur du client, pas du serveur.
    if (err.status >= 400 && err.status < 500 && err.type) return res.status(err.status).json({ error: 'bad_request' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  return { app, db, services, covers, catalog, importer, deps, jobs };
}
