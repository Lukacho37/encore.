// Registre des modules et dépendances partagées (PLAN.md 4.0, 9.1 K0) : ordre, contrat des squelettes, montage des
// routes (publiques, joueurs avant les routes historiques, admin gardé une fois), tâches, petits outils communs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, signupVerified, api, login } from './helpers.js';

process.env.ADMIN_EMAILS = 'boss@example.com';
const { MODULES } = await import('../modules.js');
const { createBus } = await import('../bus.js');
const { createLru } = await import('../lru.js');
const paging = await import('../paging.js');
const validate = await import('../validate.js');
const periods = await import('../../shared/periods.js');

const ORDER = ['moderation', 'notifications', 'search', 'ratings', 'tracks', 'legal', 'account', 'lists', 'collection', 'social',
  'feed', 'studio', 'match', 'onboarding', 'discover', 'quests', 'badges', 'battles', 'passport', 'sets', 'events', 'enrich', 'workshop'];

// Module de test ajouté en fin de registre le temps de démarrer l'application.
const probe = {
  name: 'probe',
  init: (deps) => ({ sawRatings: !!deps.ratings, sawAccess: !!deps.access }),
  routes(r) {
    r.get('/blindtest', (_req, res) => res.json({ shadowed: true }));
    r.get('/probe/me', (req, res) => res.json({ id: req.user.id }));
  },
  publicRoutes(r, deps) {
    r.get('/probe/public', deps.limits.guestRead, (_req, res) => res.json({ ok: true }));
  },
  adminRoutes(r) {
    r.get('/probe', (_req, res) => res.json({ admin: true }));
  },
  jobs: [{ name: 'probe-job', run: (deps) => deps.probe.sawRatings }],
};
MODULES.push(probe);
const app = await startApp();
MODULES.splice(MODULES.indexOf(probe), 1);
test.after(() => app.close());

test('registre : les 23 modules du plan, dans l’ordre, chacun au contrat', () => {
  assert.deepEqual(MODULES.map((m) => m.name), ORDER);
  for (const m of MODULES) {
    assert.equal(typeof m.init, 'function', m.name);
    assert.equal(typeof m.routes, 'function', m.name);
    assert.ok(app.deps[m.name] && typeof app.deps[m.name] === 'object', `deps.${m.name}`);
  }
});

test('deps : dépendances partagées et API sans effet des squelettes', () => {
  const { deps } = app;
  for (const k of ['db', 'config', 'catalog', 'services', 'bus', 'limits', 'quota', 'refs', 'tx', 'HttpError', 'validate', 'paging', 'lru', 'periods', 'access', 'notify']) {
    assert.ok(deps[k], `deps.${k}`);
  }
  for (const k of ['read', 'write', 'search', 'heavy', 'guestRead', 'guestForm']) assert.equal(typeof deps.limits[k], 'function', `limits.${k}`);
  assert.equal(deps.probe.sawRatings, true, 'un module voit les modules initialisés avant lui');
  assert.equal(deps.probe.sawAccess, true);
  assert.equal(deps.access, deps.moderation.access);
  assert.equal(deps.notify, deps.notifications.notify);
  // API internes promises par K0 (PLAN.md 9.1) : présentes, qu'elles soient encore des squelettes ou déjà remplies par
  // leur chantier du même niveau. On ne vérifie que ce qui reste vrai dans les deux cas (aucun blocage ni amitié en base).
  const internal = {
    access: ['hiddenIds', 'isBlocked', 'canSee', 'assertActive', 'linkPolicy'],
    moderation: ['purgeTarget', 'snapshot'],
    notifications: ['notify', 'unreadCount'],
    ratings: ['rate', 'summaryOf'],
    search: ['upsert', 'remove', 'refresh'],
    lists: ['setGrid9'],
    collection: ['addXp', 'grantBooster', 'grantCosmetic', 'unlockedCosmetics'],
    match: ['cachedScore'],
  };
  for (const [mod, fns] of Object.entries(internal)) {
    for (const fn of fns) assert.equal(typeof deps[mod][fn], 'function', `deps.${mod}.${fn}`);
  }
  assert.equal(deps.access.hiddenIds(1).size, 0);
  assert.equal(deps.access.isBlocked(1, 2), false);
  assert.equal(deps.access.canSee(1, 2, 'public'), true);
  assert.equal(deps.access.canSee(1, 2, 'friends'), false);
  assert.equal(deps.access.canSee(2, 2, 'private'), true);
  assert.equal(deps.access.linkPolicy('texte'), 'texte');
  assert.equal(deps.notifications.unreadCount(1), 0);
  // Modules du niveau P1 : encore des squelettes en P0.
  assert.equal(deps.lists.setGrid9(1, []), undefined);
  assert.equal(deps.match.cachedScore(1, 2), null);
  assert.deepEqual(deps.collection.unlockedCosmetics(1), []);
  assert.deepEqual(deps.refs({ albumIds: ['discovery'] }).albums.map((a) => a.id), ['discovery']);
  assert.equal(deps.tx(() => 42), 42);
});

test('deps.collection.addXp ajoute l’XP du joueur', async () => {
  const p = await signupVerified(app, { username: 'xpman' });
  const before = app.db.prepare('SELECT xp FROM users WHERE id = ?').get(p.user.id).xp;
  app.deps.collection.addXp(p.user.id, 35);
  assert.equal(app.db.prepare('SELECT xp FROM users WHERE id = ?').get(p.user.id).xp, before + 35);
});

test('routes : publiques, joueurs avant les routes historiques, admin gardé une seule fois', async () => {
  assert.equal((await api(app.base, '', 'GET', '/probe/public')).status, 200);
  assert.equal((await api(app.base, '', 'GET', '/probe/me')).status, 401);
  const p = await signupVerified(app, { username: 'routier' });
  assert.equal((await api(app.base, p.cookie, 'GET', '/probe/me')).body.id, p.user.id);
  assert.deepEqual((await api(app.base, p.cookie, 'GET', '/blindtest')).body, { shadowed: true }, 'la route du module passe avant la route historique');
  assert.equal((await api(app.base, p.cookie, 'GET', '/state')).status, 200, 'les routes historiques répondent toujours');

  assert.equal((await api(app.base, '', 'GET', '/admin/probe')).status, 401);
  assert.equal((await api(app.base, p.cookie, 'GET', '/admin/probe')).status, 403);
  assert.equal((await api(app.base, p.cookie, 'GET', '/admin/overview')).status, 403);
  await signupVerified(app, { username: 'boss', email: 'boss@example.com' });
  const boss = await login(app, 'boss');
  assert.deepEqual((await api(app.base, boss, 'GET', '/admin/probe')).body, { admin: true });
  assert.equal((await api(app.base, boss, 'GET', '/admin/overview')).status, 200, 'routes admin historiques sur le même sous-routeur');
  assert.equal((await api(app.base, boss, 'GET', '/admin/nothing-here')).status, 404);
  assert.equal((await api(app.base, '', 'GET', '/health')).status, 200);
});

test('tâches : celles des modules sont enregistrées et se lancent à la demande', async () => {
  assert.ok(app.jobs.names().includes('probe-job'));
  assert.equal(await app.jobs.runJob('probe-job'), true);
  await assert.rejects(() => app.jobs.runJob('inconnue'));
});

test('bus : chaque abonné est isolé, la diffusion continue après une erreur', () => {
  const errors = [];
  const bus = createBus({ log: { error: (...a) => errors.push(a) } });
  const seen = [];
  bus.on('cards.added', () => {
    throw new Error('boom');
  });
  const off = bus.on('cards.added', (p) => seen.push(p.userId));
  assert.equal(bus.emit('cards.added', { userId: 7 }), 1);
  assert.deepEqual(seen, [7]);
  assert.equal(errors.length, 1);
  off();
  bus.emit('cards.added', { userId: 8 });
  assert.deepEqual(seen, [7]);
  assert.equal(bus.emit('rien', {}), 0);
});

test('paging : curseurs opaques, limites bornées, curseur invalide → 400', () => {
  assert.equal(paging.limitOf(undefined), 20);
  assert.equal(paging.limitOf('500'), 50);
  assert.equal(paging.limitOf('0'), 20);
  const c = paging.encodeCursor([1700000000000, 42]);
  assert.match(c, /^[\w-]+$/);
  assert.deepEqual(paging.decodeCursor(c), [1700000000000, 42]);
  assert.equal(paging.decodeCursor(''), null);
  for (const bad of ['%%%', paging.encodeCursor({ a: 1 }), paging.encodeCursor([]), paging.encodeCursor([[1]]), 'abc']) {
    assert.throws(() => paging.decodeCursor(bad, { length: 2 }), (err) => err.status === 400 && err.code === 'invalid_input', bad);
  }
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: 10 - i, at: 1000 - i }));
  const page = paging.keysetPage(rows, 5, (r) => [r.at, r.id]);
  assert.equal(page.items.length, 5);
  assert.deepEqual(paging.decodeCursor(page.nextCursor), [996, 6]);
  assert.equal(paging.keysetPage(rows.slice(0, 3), 5, (r) => [r.at, r.id]).nextCursor, null);
  assert.equal(paging.offsetOf(paging.encodeCursor([9999]), { cap: 240 }), 240);
  assert.equal(paging.offsetPage(rows, 230, 5, { cap: 240 }).nextCursor, paging.encodeCursor([235]));
  assert.equal(paging.offsetPage(rows, 235, 5, { cap: 240 }).nextCursor, null);
});

test('lru : durée de vie, éviction du plus ancien, wrap', () => {
  let now = 0;
  const cache = createLru({ max: 2, ttlMs: 100, now: () => now });
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1); // a devient le plus récent
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  now = 150;
  assert.equal(cache.get('a'), undefined);
  let calls = 0;
  assert.equal(cache.wrap('x', () => ++calls), 1);
  assert.equal(cache.wrap('x', () => ++calls), 1);
  cache.set('user:1:a', 1);
  cache.deletePrefix('user:1:');
  assert.equal(cache.get('user:1:a'), undefined);
});

test('validate : textes, entiers, listes, identifiants', () => {
  assert.equal(validate.str('  bonjour  ', { max: 10 }), 'bonjour');
  assert.throws(() => validate.str('trop long', { max: 3, field: 'bio' }), (err) => err.status === 400 && err.extra.field === 'bio');
  assert.throws(() => validate.str(42), (err) => err.code === 'invalid_input');
  assert.equal(validate.str(undefined, { optional: true }), null);
  assert.equal(validate.str('   ', { optional: true, fallback: '' }), '');
  assert.equal(validate.int('12', { min: 1, max: 50 }), 12);
  assert.throws(() => validate.int('12.5'));
  assert.throws(() => validate.int(99, { max: 50 }));
  assert.equal(validate.int('', { optional: true, fallback: 20 }), 20);
  assert.equal(validate.oneOf('friends', ['public', 'friends']), 'friends');
  assert.throws(() => validate.oneOf('tous', ['public', 'friends'], { code: 'invalid_visibility' }), (err) => err.code === 'invalid_visibility');
  assert.equal(validate.id('discovery:01'), 'discovery:01');
  assert.equal(validate.id(['x']), null);
  assert.equal(validate.id('x'.repeat(81)), null);
  assert.deepEqual(validate.ids('a, b,a,,c', 2), ['a', 'b']);
  assert.deepEqual(validate.ids(['a', 3, 'b']), ['a', 'b']);
  assert.equal(validate.bool('true'), true);
  assert.equal(validate.bool('non'), false);
});

test('periods : jours et semaines à l’heure de Paris, changements d’heure compris', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(periods.dayKey(at('2026-10-06T21:59:59Z')), 'd:2026-10-06');
  assert.equal(periods.dayKey(at('2026-10-06T22:00:00Z')), 'd:2026-10-07', 'minuit à Paris = 22 h UTC en été');
  assert.equal(periods.weekKey(at('2026-10-06T12:00:00Z')), 'w:2026-W41');
  assert.equal(periods.weekKey(at('2026-10-04T21:59:59Z')), 'w:2026-W40', 'dimanche soir à Paris');
  assert.equal(periods.weekKey(at('2027-01-01T12:00:00Z')), 'w:2026-W53');
  const spring = periods.periodBounds('d:2026-03-29');
  assert.equal((spring.end - spring.start) / 3_600_000, 23);
  const autumn = periods.periodBounds('d:2026-10-25');
  assert.equal((autumn.end - autumn.start) / 3_600_000, 25);
  assert.equal(periods.dayStart(at('2026-10-25T12:00:00Z')), at('2026-10-24T22:00:00Z'));
  assert.equal(periods.nextDayStart(at('2026-10-25T12:00:00Z')), at('2026-10-25T23:00:00Z'));
  assert.equal(periods.weekStart(at('2026-10-06T12:00:00Z')), at('2026-10-04T22:00:00Z'));
  assert.deepEqual(periods.periodBounds('w:2026-W41'), { start: at('2026-10-04T22:00:00Z'), end: at('2026-10-11T22:00:00Z') });
  assert.equal(periods.periodBounds('first'), null);
  // Toute l'année : chaque instant est dans les bornes de son jour et de sa semaine.
  for (let t = at('2026-01-01T00:00:00Z'); t < at('2027-01-04T00:00:00Z'); t += 3_600_000) {
    const d = periods.periodBounds(periods.dayKey(t));
    const w = periods.periodBounds(periods.weekKey(t));
    assert.ok(d.start <= t && t < d.end && w.start <= t && t < w.end, new Date(t).toISOString());
  }
});

test('helpers : inscription vérifiée, client HTTP avec cookies', async () => {
  const p = await signupVerified(app, { username: 'helper_ok' });
  assert.equal(p.user.username, 'helper_ok');
  const st = await api(app.base, p.cookie, 'GET', '/api/state');
  assert.equal(st.status, 200);
  assert.equal(st.body.user.username, 'helper_ok');
  const out = await api(app.base, p.cookie, 'POST', '/auth/logout');
  assert.equal(out.status, 200);
  assert.equal((await api(app.base, out.cookie, 'GET', '/state')).status, 401, 'le cookie de session effacé est retiré');
});
