import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb } from './db.js';
import { createMailer } from './mailer.js';
import { createServices, HttpError } from './services.js';
import { createAuth } from './auth.js';
import { createCovers } from './covers.js';
import { rateLimit } from './security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ dbFile } = {}) {
  const db = openDb(dbFile);
  const mailer = createMailer(db);
  const services = createServices(db);
  const auth = createAuth(db, mailer, services);
  const covers = createCovers(db);

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    });
    next();
  });
  app.use(express.json({ limit: '32kb' }));

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
  const actionLimit = rateLimit({ windowMs: 60_000, max: config.isTest ? 10_000 : 240, key: (req) => `u${req.user?.id}` });

  api.use(requireUser, actionLimit);

  api.get('/state', (req, res) => res.json(services.state(req.user.id)));

  api.post('/packs/open', (req, res) => {
    const result = services.openPacks(req.user.id, req.body.count);
    res.json({ ...result, state: services.state(req.user.id) });
  });
  api.post('/shop/buy-pack', (req, res) => {
    const result = services.buyPack(req.user.id);
    res.json({ ...result, state: services.state(req.user.id) });
  });
  api.post('/collection/recycle', (req, res) => {
    const result = services.recycleDuplicates(req.user.id);
    res.json({ ...result, state: services.state(req.user.id) });
  });
  api.post('/collection/press', (req, res) => {
    const result = services.pressCard(req.user.id, req.body.trackId);
    res.json({ ...result, state: services.state(req.user.id) });
  });

  api.post('/profile/avatar', (req, res) => {
    services.setAvatar(req.user.id, req.body.avatar, req.body.color);
    res.json({ state: services.state(req.user.id) });
  });
  api.post('/profile/showcase', (req, res) => {
    services.setShowcase(req.user.id, req.body.slots);
    res.json({ state: services.state(req.user.id) });
  });
  api.post('/profile/lang', (req, res) => {
    services.setLang(req.user.id, req.body.lang);
    res.json({ ok: true });
  });
  api.post('/profile/settings', (req, res) => {
    if (req.body.ratingScale !== undefined) services.setRatingScale(req.user.id, req.body.ratingScale);
    res.json({ state: services.state(req.user.id) });
  });
  api.get('/users/:username', (req, res) => res.json(services.publicProfile(req.user.id, req.params.username)));
  api.get('/users/:username/ratings', (req, res) => res.json(services.userRatings(req.params.username)));

  // Notes & critiques : :type = album | track ; l'identifiant d'un morceau contient « : » (ex. discovery:01).
  api.get('/ratings/feed', (req, res) => res.json(services.friendsFeed(req.user.id)));
  api.get('/ratings/:type/:id', (req, res) => res.json(services.itemRatings(req.user.id, req.params.type, req.params.id)));
  api.put('/ratings/:type/:id', (req, res) => {
    services.rate(req.user.id, req.params.type, req.params.id, req.body.score, req.body.review);
    res.json({ ...services.itemRatings(req.user.id, req.params.type, req.params.id), state: services.state(req.user.id) });
  });
  api.delete('/ratings/:type/:id', (req, res) => {
    services.unrate(req.user.id, req.params.type, req.params.id);
    res.json({ ...services.itemRatings(req.user.id, req.params.type, req.params.id), state: services.state(req.user.id) });
  });

  api.get('/friends', (req, res) => res.json(services.listFriends(req.user.id)));
  api.post('/friends/request', (req, res) => res.json(services.requestFriend(req.user.id, req.body.username)));
  api.post('/friends/:id/accept', (req, res) => {
    services.respondFriend(req.user.id, req.params.id, true);
    res.json(services.listFriends(req.user.id));
  });
  api.post('/friends/:id/decline', (req, res) => {
    services.respondFriend(req.user.id, req.params.id, false);
    res.json(services.listFriends(req.user.id));
  });
  api.delete('/friends/:userId', (req, res) => {
    services.removeFriend(req.user.id, req.params.userId);
    res.json(services.listFriends(req.user.id));
  });

  api.get('/blindtest', (req, res) => res.json(services.blindtestInfo(req.user.id)));
  api.post('/blindtest/start', async (req, res) => res.json(await services.startBlindtest(req.user.id, req.body.genre)));
  api.post('/blindtest/:id/answer', (req, res) => {
    const result = services.answerBlindtest(req.user.id, req.params.id, req.body.choice ?? null);
    res.json(result.final ? { ...result, state: services.state(req.user.id) } : result);
  });
  api.post('/blindtest/:id/next', async (req, res) => res.json(await services.nextBlindtestRound(req.user.id, req.params.id)));

  api.get('/admin/overview', requireAdmin, (req, res) => res.json(services.adminOverview()));
  api.post('/admin/users/:id/grant', requireAdmin, (req, res) => res.json(services.adminGrant(req.params.id, req.body)));
  api.get('/admin/covers', requireAdmin, (req, res) => res.json(covers.status()));
  api.post('/admin/covers/refresh', requireAdmin, (req, res) => {
    covers.refresh();
    res.json(covers.status());
  });
  api.get('/admin/reviews', requireAdmin, (req, res) => res.json(services.adminReviews()));
  api.delete('/admin/reviews/:userId/:type/:id', requireAdmin, (req, res) => {
    services.adminDeleteReview(req.params.userId, req.params.type, req.params.id);
    res.json(services.adminReviews());
  });
  api.post('/admin/me/reset', requireAdmin, (req, res) => {
    services.adminResetCollection(req.user.id);
    res.json({ state: services.state(req.user.id) });
  });
  api.post('/admin/me/complete', requireAdmin, (req, res) => {
    services.adminCompleteCollection(req.user.id);
    res.json({ state: services.state(req.user.id) });
  });
  api.post('/admin/me/almost', requireAdmin, (req, res) => {
    const result = services.adminAlmostAlbum(req.user.id, req.body.albumId);
    res.json({ ...result, state: services.state(req.user.id) });
  });

  // Boîte e-mail de test, uniquement hors production et sans SMTP configuré.
  app.get('/api/dev/emails', (req, res) => {
    if (!mailer.devMailbox) return res.status(404).json({ error: 'not_found' });
    res.json(db.prepare('SELECT id, to_addr AS "to", subject, text, html, created_at AS createdAt FROM dev_emails ORDER BY id DESC LIMIT 30').all());
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', api);
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
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  return { app, db, services, covers };
}
