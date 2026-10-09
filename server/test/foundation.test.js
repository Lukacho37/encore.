// Fondations du serveur (PLAN.md 4.0, 4.1.1, 7.2 ; critères P0.6 et P0.11) : état partiel des actions et fusion du
// site (client/src/state/mergeState.js) égale à un état complet tout neuf ; durcissement (corps absent, cookie mal
// formé, corps trop gros) ; en-têtes de sécurité ; boîte e-mail de test ; demandes d'ami (délai après un refus,
// blocages, quota) ; résumés de joueurs en deux requêtes ; profil sans `role` ; préférences ; espace admin paginé et
// journalisé ; événements du bus après la validation ; tâches de nuit ; coût de scrypt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, signupVerified, api, login } from './helpers.js';
import { mergeResponse } from '../../client/src/state/mergeState.js';

process.env.ADMIN_EMAILS = 'boss@example.com';
const app = await startApp();
test.after(() => app.close());
const { db, services, deps } = app;
const { CSP, securityHeaders } = await import('../app.js');
const { devMailboxMode, isLocalUrl } = await import('../config.js');
const { createJobs, nextRunAt } = await import('../jobs.js');
const { createQuota, hashPassword, verifyPassword, needsRehash, parseCookies, SCRYPT_COST, dummyHash } = await import('../security.js');
const { pressCost } = await import('../../shared/rules.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const call = (who, method, p, body) => api(app.base, typeof who === 'string' ? who : who?.cookie ?? '', method, p, body);
const userRow = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);
const DAY = 86_400_000;

/** Compte les requêtes préparées pendant `fn` (services appelle db.prepare à chaque requête). */
function countQueries(fn) {
  const orig = db.prepare;
  const seen = [];
  db.prepare = (sql) => {
    seen.push(sql);
    return orig.call(db, sql);
  };
  try {
    return { result: fn(), queries: seen };
  } finally {
    delete db.prepare;
  }
}

/** Joueurs ajoutés directement en base (vérifiés), pour les tests qui en demandent beaucoup. */
let rawCounter = 0;
function rawUsers(n, { createdAt = Date.now() } = {}) {
  const ins = db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at)
    VALUES (?, ?, 'x', ?, ?, ?)`);
  return Array.from({ length: n }, (_, i) => {
    rawCounter += 1;
    return Number(ins.run(`raw${rawCounter}@example.com`, `raw_${rawCounter}`, createdAt, createdAt, createdAt - i).lastInsertRowid);
  });
}

/** État comparable : sans l'heure du serveur ni les références du catalogue, listes triées. */
function normalize(state) {
  const sortBy = (list, key) => [...(list || [])].map((x) => ({ ...x })).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const { serverTime: _t, catalog: _c, ...rest } = state;
  return {
    ...rest,
    cards: sortBy(state.cards, (c) => `${c.t}|${c.v}`),
    achievements: sortBy(state.achievements, (a) => a.key),
    ratings: sortBy(state.ratings, (r) => `${r.t}|${r.i}`),
  };
}

test('état partiel : après une suite d’actions, l’état fusionné par le site est égal à un GET /api/state tout neuf', async () => {
  const p = await signupVerified(app, { username: 'merge_ana' });
  const friend = await signupVerified(app, { username: 'merge_bob' });
  db.prepare('UPDATE users SET bonus_packs = 40, royalties = 50000 WHERE id = ?').run(p.user.id);
  let s = (await call(p, 'GET', '/state')).body;
  assert.equal(s.partial, false);
  let sizes = [];
  /** Action : la réponse porte un état partiel (ou complet pour `full`), fusionné comme le fait le site. */
  async function apply(method, route, body, { full = false } = {}) {
    const r = await call(p, method, route, body);
    assert.equal(r.status, 200, `${method} ${route} : ${JSON.stringify(r.body).slice(0, 300)}`);
    assert.equal(r.body.state.partial, full ? false : true, `${method} ${route} : état ${full ? 'complet' : 'partiel'} attendu`);
    if (!full) assert.deepEqual(Object.keys(r.body.state).sort(), ['counts', 'packs', 'partial', 'serverTime', 'stats', 'user']);
    sizes.push(JSON.stringify(r.body).length);
    s = mergeResponse(s, r.body);
    assert.ok(s, 'fusion sans état de départ');
    return r.body;
  }
  /** Point de contrôle : l'état fusionné est celui que le serveur renverrait maintenant. */
  async function check(label) {
    const fresh = (await call(p, 'GET', '/state')).body;
    assert.deepEqual(normalize(s), normalize(fresh), `état fusionné différent après : ${label}`);
  }

  for (let i = 0; i < 12; i++) await apply('POST', '/packs/open', {});
  await apply('POST', '/shop/buy-pack');
  await apply('POST', '/packs/open', {});
  await check('boosters');
  assert.ok(Math.max(...sizes) < 10_000, `réponse d’un booster : ${Math.max(...sizes)} octets`);

  // Boosters d'album jusqu'à compléter Discovery (succès avec son « Pressage n° »).
  for (let i = 0; i < 4; i++) await apply('POST', '/packs/album', { albumId: 'discovery' });
  const done = s.achievements.find((a) => a.key === 'album:discovery');
  assert.ok(done && done.rank >= 1, 'album complété avec son rang');
  await check('boosters d’album');

  const missing = app.catalog.albumTracks('abbey-road').find((t) => pressCost(t.rarity) != null && !s.cards.some((c) => c.t === t.id));
  await apply('POST', '/collection/press', { trackId: missing.id });
  await check('pressage');

  await apply('PUT', '/ratings/album/discovery', { score: 8 });
  await apply('PUT', `/ratings/track/${encodeURIComponent('discovery:01')}`, { score: 9 });
  await apply('DELETE', '/ratings/album/discovery');
  await check('notes');

  await apply('POST', '/profile/settings', { prefs: { listen: 'apple' }, ratingScale: 'points' });
  await apply('POST', '/profile/avatar', { color: '#3fd6c4' });
  await apply('POST', '/profile/showcase', { slots: [s.cards[0].t, null, s.cards[1].t] });
  assert.equal(s.user.prefs.listen, 'apple');
  await check('profil');

  // Une demande reçue arrive dans les pastilles avec la réponse suivante ; l'accepter les met à jour.
  await call(friend, 'POST', '/friends/request', { username: p.username });
  await apply('POST', '/packs/open', {});
  assert.equal(s.counts.pendingFriends, 1);
  const inbox = (await call(p, 'GET', '/friends')).body;
  await apply('POST', `/friends/${inbox.incoming[0].requestId}/accept`);
  assert.equal(s.counts.pendingFriends, 0);
  assert.equal(s.pendingFriends, 0, 'ancien nom gardé pendant P0');
  await check('amis');

  // Blind test : seule la réponse finale porte l'état (boosters de récompense, XP).
  const start = (await call(p, 'POST', '/blindtest/start', { genre: 'all' })).body;
  for (;;) {
    const qs = JSON.parse(db.prepare('SELECT questions, current FROM blindtest_games WHERE id = ?').get(start.gameId).questions);
    const current = db.prepare('SELECT current FROM blindtest_games WHERE id = ?').get(start.gameId).current;
    const r = await call(p, 'POST', `/blindtest/${start.gameId}/answer`, { choice: qs[current].answer });
    assert.equal(r.status, 200);
    if (r.body.final) {
      assert.equal(r.body.state.partial, true);
      s = mergeResponse(s, r.body);
      break;
    }
    assert.equal(r.body.state, undefined);
    await call(p, 'POST', `/blindtest/${start.gameId}/next`);
  }
  await check('blind test');

  // Recycler change le nombre d'exemplaires de chaque carte : état complet ; puis de nouveau des états partiels.
  await apply('POST', '/collection/recycle', {}, { full: true });
  await apply('POST', '/packs/open', {});
  await apply('POST', '/packs/album', { albumId: 'thriller' });
  await check('recyclage puis boosters');
});

test('GET /api/state : pastilles, préférences, accueil, CGU, rang des succès ; dernière visite écrite au plus une fois par minute', async () => {
  const p = await signupVerified(app, { username: 'state_lea' });
  const st = (await call(p, 'GET', '/state')).body;
  assert.deepEqual(st.counts, { pendingFriends: 0, unread: 0 });
  assert.equal(st.pendingFriends, 0);
  assert.deepEqual(st.user.prefs, { listen: 'deezer', emailDigest: false });
  assert.equal(st.user.onboarded, userRow(p.user.id).onboarded_at != null);
  assert.equal(typeof st.user.termsOk, 'boolean');
  db.prepare('UPDATE users SET terms_accepted_at = ?, terms_version = ? WHERE id = ?').run(Date.now(), app.deps.config.termsVersion, p.user.id);
  assert.equal((await call(p, 'GET', '/state')).body.user.termsOk, true);
  db.prepare("UPDATE users SET terms_version = '2000-01-01' WHERE id = ?").run(p.user.id);
  assert.equal((await call(p, 'GET', '/state')).body.user.termsOk, false, 'CGU d’une ancienne version');
  assert.ok(Array.isArray(st.achievements));

  db.prepare('UPDATE users SET last_seen_at = NULL WHERE id = ?').run(p.user.id);
  await call(p, 'GET', '/state');
  const seen = userRow(p.user.id).last_seen_at;
  assert.ok(seen > 0);
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(seen - 30_000, p.user.id);
  await call(p, 'GET', '/state');
  assert.equal(userRow(p.user.id).last_seen_at, seen - 30_000, 'pas d’écriture moins d’une minute après');
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(seen - 61_000, p.user.id);
  await call(p, 'GET', '/state');
  assert.ok(userRow(p.user.id).last_seen_at >= seen, 'écrite de nouveau après une minute');
  // Stock de boosters plein : packs_at n'est pas réécrit à chaque lecture.
  db.prepare('UPDATE users SET packs = 5, packs_at = ? WHERE id = ?').run(Date.now() - 10_000, p.user.id);
  const at = userRow(p.user.id).packs_at;
  await call(p, 'GET', '/state');
  assert.equal(userRow(p.user.id).packs_at, at);
});

test('durcissement : corps absent, cookie mal formé, corps de 33 Ko, JSON invalide : jamais de 500', async () => {
  const p = await signupVerified(app, { username: 'hard_max' });
  // Requête sans Content-Type ni corps : erreur de validation, pas 500.
  const bare = await fetch(`${app.base}/api/auth/signup`, { method: 'POST', headers: { 'X-AlbumMania': '1' } });
  assert.equal(bare.status, 400);
  const bareAction = await fetch(`${app.base}/api/profile/settings`, { method: 'POST', headers: { 'X-AlbumMania': '1', Cookie: p.cookie } });
  assert.equal(bareAction.status, 200);
  assert.equal((await fetch(`${app.base}/api/friends/request`, { method: 'POST', headers: { 'X-AlbumMania': '1', Cookie: p.cookie } })).status, 404);
  // Cookie mal encodé : ignoré (visiteur), jamais d'exception.
  const bad = 'am_session=%E0%A4%A; autre=%; =vide; sans-egal';
  assert.equal((await call(bad, 'GET', '/health')).status, 200);
  assert.equal((await call(bad, 'GET', '/catalog/info')).status, 200);
  assert.equal((await call(bad, 'GET', '/state')).status, 401);
  assert.equal((await call(`${p.cookie}; x=%E0%A4%A`, 'GET', '/state')).status, 200, 'un cookie illisible n’empêche pas de lire les autres');
  assert.deepEqual({ ...parseCookies('a=1; a=2; b=%41; c=%E0%A4%A') }, { a: '1', b: 'A' });
  assert.deepEqual({ ...parseCookies(undefined) }, {});
  assert.equal(Object.getPrototypeOf(parseCookies('__proto__=1')), null);
  // Corps au-delà de 32 Ko : 413.
  const big = await call(p, 'POST', '/profile/settings', { ratingScale: 'stars', pad: 'x'.repeat(33 * 1024) });
  assert.equal(big.status, 413);
  assert.equal(big.body.error, 'payload_too_large');
  // JSON illisible : 400.
  const broken = await fetch(`${app.base}/api/profile/settings`, {
    method: 'POST', headers: { 'X-AlbumMania': '1', 'Content-Type': 'application/json', Cookie: p.cookie }, body: '{"ratingScale":',
  });
  assert.equal(broken.status, 400);
  assert.equal((await broken.json()).error, 'bad_json');
  // Route inconnue de l'API : 404 en JSON.
  assert.deepEqual((await call(p, 'GET', '/nulle-part')).body, { error: 'not_found' });
});

test('en-têtes de sécurité : CSP, Permissions-Policy, COOP, nosniff, pas de cache sur l’API', async () => {
  const r = await fetch(`${app.base}/api/health`);
  const h = r.headers;
  assert.equal(h.get('content-security-policy'), CSP);
  assert.match(CSP, /default-src 'self'/);
  assert.match(CSP, /frame-ancestors 'none'/);
  assert.match(CSP, /img-src 'self' data: blob: https:\/\/\*\.dzcdn\.net/);
  assert.match(CSP, /frame-src https:\/\/widget\.deezer\.com/);
  assert.equal(h.get('x-content-type-options'), 'nosniff');
  assert.equal(h.get('x-frame-options'), 'DENY');
  assert.equal(h.get('referrer-policy'), 'same-origin');
  assert.equal(h.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  assert.equal(h.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(h.get('cache-control'), 'no-store');
  assert.equal(h.get('x-powered-by'), null);
  assert.equal(h.get('strict-transport-security'), null, 'HSTS seulement en production sur https');
  assert.match(securityHeaders({ hsts: true })['Strict-Transport-Security'], /max-age=\d+/);
  assert.equal((await fetch(`${app.base}/api/covers`)).headers.get('cache-control'), 'public, max-age=300');
});

test('boîte e-mail de test : seulement avec DEV_MAILBOX=1 et une adresse locale, sinon refus de démarrer', async () => {
  assert.deepEqual(devMailboxMode('1', 'http://localhost:5173'), { enabled: true, error: null });
  assert.deepEqual(devMailboxMode(undefined, 'http://localhost:5173'), { enabled: false, error: null });
  assert.deepEqual(devMailboxMode('0', 'https://albummania.fr'), { enabled: false, error: null });
  const refused = devMailboxMode('1', 'https://albummania.fr');
  assert.equal(refused.enabled, false);
  assert.match(refused.error, /DEV_MAILBOX/);
  for (const url of ['http://localhost:5101', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'http://app.localhost']) assert.ok(isLocalUrl(url), url);
  for (const url of ['https://albummania.fr', 'http://localhost.evil.com', 'pas une adresse', 'http://192.168.1.2']) assert.ok(!isLocalUrl(url), url);
  // Les tests n'ouvrent pas la boîte : la route répond comme une route inconnue.
  assert.equal((await call('', 'GET', '/dev/emails')).status, 404);
  // Serveur lancé avec DEV_MAILBOX=1 et une adresse publique : il refuse de démarrer (avant d'ouvrir la base).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-mailbox-'));
  try {
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'server/index.js')], {
      cwd: dir,
      env: { ...process.env, NODE_ENV: 'production', DEV_MAILBOX: '1', APP_URL: 'https://albummania.example', PORT: '0', DATABASE_FILE: path.join(dir, 'x.db') },
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /DEV_MAILBOX/);
    assert.ok(!fs.existsSync(path.join(dir, 'x.db')), 'aucune base ouverte');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('amis : refus gardé 7 jours (409 request_cooldown), demande inverse permise, joueur bloqué = pseudo inconnu, quota quotidien', async () => {
  const a = await signupVerified(app, { username: 'cool_ann' });
  const b = await signupVerified(app, { username: 'cool_ben' });
  const requested = await call(a, 'POST', '/friends/request', { username: b.username });
  assert.equal(requested.body.status, 'pending');
  assert.equal(requested.body.state.partial, true);
  const inbox = (await call(b, 'GET', '/friends')).body;
  assert.equal(inbox.incoming.length, 1);
  const declined = await call(b, 'POST', `/friends/${inbox.incoming[0].requestId}/decline`);
  assert.equal(declined.status, 200);
  assert.equal(declined.body.incoming.length, 0);
  assert.equal(declined.body.state.counts.pendingFriends, 0);
  const row = db.prepare('SELECT * FROM friendships WHERE id = ?').get(inbox.incoming[0].requestId);
  assert.equal(row.status, 'declined', 'la ligne reste pour le délai');
  assert.equal((await call(a, 'GET', '/friends')).body.outgoing.length, 0, 'un refus n’apparaît nulle part');
  assert.equal((await call(a, 'GET', `/users/${b.username}`)).body.friendship, 'none');
  const again = await call(a, 'POST', '/friends/request', { username: b.username });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'request_cooldown');
  assert.equal(again.body.until, row.responded_at + 7 * DAY);
  // Celui qui a refusé peut changer d'avis.
  const reverse = await call(b, 'POST', '/friends/request', { username: a.username });
  assert.equal(reverse.body.status, 'pending');
  const fromB = (await call(a, 'GET', '/friends')).body.incoming;
  assert.equal(fromB[0].user.username, b.username);
  // L'expéditeur annule sa demande : la ligne disparaît.
  assert.equal((await call(b, 'POST', `/friends/${fromB[0].requestId}/decline`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM friendships WHERE id = ?').get(fromB[0].requestId).n, 0);
  // Un refus de plus de 7 jours ne bloque plus : la même ligne repart en demande.
  const oldDecline = Number(db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'declined', ?, ?)")
    .run(a.user.id, b.user.id, Date.now() - 9 * DAY, Date.now() - 8 * DAY).lastInsertRowid);
  assert.equal((await call(a, 'POST', '/friends/request', { username: b.username })).body.status, 'pending');
  assert.equal(db.prepare('SELECT status FROM friendships WHERE id = ?').get(oldDecline).status, 'pending');

  // Blocage (dans un sens ou dans l'autre) : demande et profil répondent comme pour un pseudo inconnu.
  const c = await signupVerified(app, { username: 'cool_cid' });
  db.prepare('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(c.user.id, a.user.id, Date.now());
  const restore = [];
  if (!deps.access.isBlocked(a.user.id, c.user.id)) {
    // Règles d'accès encore au squelette de K0 (P0-F les remplit) : on simule le blocage enregistré.
    const blocked = (x, y) => !!db.prepare('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)').get(x, y, y, x);
    const { isBlocked, hiddenIds } = deps.access;
    deps.access.isBlocked = blocked;
    deps.access.hiddenIds = (viewer) => new Set(db.prepare('SELECT CASE WHEN blocker_id = ? THEN blocked_id ELSE blocker_id END AS id FROM blocks WHERE blocker_id = ? OR blocked_id = ?').all(viewer, viewer, viewer).map((r) => r.id));
    restore.push(() => Object.assign(deps.access, { isBlocked, hiddenIds }));
  }
  try {
    for (const [from, to] of [[a, c], [c, a]]) {
      const r = await call(from, 'POST', '/friends/request', { username: to.username });
      assert.equal(r.status, 404);
      assert.equal(r.body.error, 'user_not_found');
      assert.equal((await call(from, 'GET', `/users/${to.username}`)).status, 404);
    }
    assert.ok(!services.userSummaries([a.user.id, c.user.id], c.user.id).has(a.user.id), 'résumé d’un joueur bloqué absent');
  } finally {
    for (const fn of restore) fn();
  }

  // Quota : 30 demandes par jour (heure de Paris), compté dans la table elle-même.
  const d = await signupVerified(app, { username: 'cool_dee' });
  const others = rawUsers(30);
  const ins = db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)");
  for (const id of others) ins.run(d.user.id, id, Date.now());
  const over = await call(d, 'POST', '/friends/request', { username: a.username });
  assert.equal(over.status, 429);
  assert.equal(over.body.error, 'quota_exceeded');
  assert.equal(over.body.kind, 'friend_requests');
  assert.ok(over.body.resetAt > Date.now());
});

test('quotas : comptés depuis minuit à Paris, plafonds remplaçables, kind inconnu refusé', () => {
  const [u] = rawUsers(1);
  const [v, w] = rawUsers(2);
  let now = Date.parse('2026-10-09T21:30:00Z'); // 23 h 30 à Paris
  const quota = createQuota(db, { limits: { friend_requests: 2 }, now: () => now });
  const ins = db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)");
  ins.run(u, v, now - 60_000);
  assert.doesNotThrow(() => quota(u, 'friend_requests'));
  ins.run(u, w, now - 30_000);
  assert.equal(quota.count(u, 'friend_requests'), 2);
  assert.equal(quota.remaining(u, 'friend_requests'), 0);
  assert.throws(() => quota(u, 'friend_requests'), (err) => err.status === 429 && err.extra.resetAt === Date.parse('2026-10-09T22:00:00Z'));
  now = Date.parse('2026-10-09T22:00:01Z'); // minuit passé à Paris
  assert.equal(quota.count(u, 'friend_requests'), 0);
  assert.throws(() => quota(u, 'inconnu'), /quota inconnu/);
  assert.equal(createQuota(db).limit('posts'), 20);
});

test('userSummaries : exactement deux requêtes, relations vues du joueur, comptes non vérifiés absents', async () => {
  const viewer = await signupVerified(app, { username: 'sum_vic' });
  const friend = await signupVerified(app, { username: 'sum_fay' });
  const incoming = await signupVerified(app, { username: 'sum_ian' });
  const ids = rawUsers(40);
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', 1, 1)").run(viewer.user.id, friend.user.id);
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', 1)").run(incoming.user.id, viewer.user.id);
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', 1)").run(viewer.user.id, ids[0]);
  db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'declined', 1, 1)").run(viewer.user.id, ids[1]);
  db.prepare('UPDATE users SET email_verified_at = NULL WHERE id = ?').run(ids[2]);
  db.prepare("UPDATE users SET unique_cards = 77, cosmetics = '{\"frame\":\"gold\",\"title\":\"Disquaire\"}' WHERE id = ?").run(friend.user.id);
  const wanted = [viewer.user.id, friend.user.id, incoming.user.id, ...ids, 999_999];
  const { result, queries } = countQueries(() => services.userSummaries(wanted, viewer.user.id, { hidden: new Set() }));
  assert.equal(queries.length, 2, queries.join('\n'));
  assert.equal(result.get(viewer.user.id).relation, 'self');
  assert.deepEqual(result.get(friend.user.id), {
    id: friend.user.id, username: 'sum_fay', avatar: 'initials', avatarColor: userRow(friend.user.id).avatar_color, level: 1,
    uniqueCards: 77, frame: 'gold', title: 'Disquaire', relation: 'friend',
  });
  assert.equal(result.get(incoming.user.id).relation, 'incoming');
  assert.equal(result.get(ids[0]).relation, 'outgoing');
  assert.equal(result.get(ids[1]).relation, null, 'un refus n’est pas une relation');
  assert.ok(!result.has(ids[2]), 'compte non vérifié absent');
  assert.ok(!result.has(999_999));
  assert.equal(result.size, wanted.length - 2);
  // Sans joueur qui regarde : une seule requête, aucune relation.
  const anon = countQueries(() => services.userSummaries([friend.user.id]));
  assert.equal(anon.queries.length, 1);
  assert.equal(anon.result.get(friend.user.id).relation, null);
  // Liste d'amis : le nombre de requêtes ne dépend pas du nombre d'amis (plus de N+1).
  const many = rawUsers(25);
  for (const id of many) db.prepare("INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (?, ?, 'accepted', 2, 2)").run(id, viewer.user.id);
  const list = countQueries(() => services.listFriends(viewer.user.id));
  assert.ok(list.queries.length <= 4, `${list.queries.length} requêtes pour ${list.result.friends.length} amis`);
  assert.equal(list.result.friends.length, 26);
  const entry = list.result.friends.find((f) => f.user.id === friend.user.id);
  assert.equal(entry.user.uniqueCards, 77);
  assert.equal(entry.user.unique, 77, 'ancien nom gardé');
  assert.equal(entry.user.relation, 'friend');
  assert.equal(list.result.incoming[0].user.relation, 'incoming');
});

test('profil public : même forme sans `role`, vinyles avec leur rang, gardé 30 s puis oublié quand la collection change', async () => {
  const owner = await signupVerified(app, { username: 'prof_oli' });
  const viewer = await signupVerified(app, { username: 'prof_val' });
  db.prepare('UPDATE users SET bonus_packs = 10, royalties = 5000 WHERE id = ?').run(owner.user.id);
  for (let i = 0; i < 4; i++) await call(owner, 'POST', '/packs/album', { albumId: 'back-to-black' });
  const profile = (await call(viewer, 'GET', `/users/${owner.username}`)).body;
  assert.equal(profile.role, undefined);
  assert.equal(profile.email, undefined);
  for (const k of ['id', 'username', 'avatar', 'avatarColor', 'level', 'createdAt', 'stats', 'showcase', 'completedAlbums', 'vinyls',
    'masteredArtists', 'upcoming', 'friendship', 'requestId', 'catalog']) assert.ok(k in profile, k);
  const vinyl = profile.vinyls.find((v) => v.albumId === 'back-to-black');
  assert.ok(vinyl, 'vinyle de l’album complété');
  assert.equal(vinyl.rank, 1, 'premier joueur à compléter l’album');
  assert.ok(['black', 'holo'].includes(vinyl.edition));
  assert.equal(profile.stats.unique, userRow(owner.user.id).unique_cards);
  // Deuxième lecture : seule la relation est recalculée.
  const cached = countQueries(() => services.publicProfile(viewer.user.id, owner.username));
  assert.ok(cached.queries.length <= 2, cached.queries.join('\n'));
  await call(owner, 'POST', '/packs/open', {});
  const after = (await call(viewer, 'GET', `/users/${owner.username}`)).body;
  assert.equal(after.stats.unique, userRow(owner.user.id).unique_cards, 'cache oublié après une nouvelle carte');
  assert.equal((await call(viewer, 'GET', '/users/personne')).status, 404);
});

test('réglages : plateforme d’écoute préférée, validée avant toute écriture', async () => {
  const p = await signupVerified(app, { username: 'pref_pia' });
  const ok = await call(p, 'POST', '/profile/settings', { prefs: { listen: 'spotify', emailDigest: true, inconnu: 1 } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.state.user.prefs, { listen: 'spotify', emailDigest: true });
  assert.deepEqual(JSON.parse(userRow(p.user.id).prefs), { listen: 'spotify', emailDigest: true });
  const bad = await call(p, 'POST', '/profile/settings', { prefs: { listen: 'napster' }, ratingScale: 'points' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_input');
  assert.equal(bad.body.field, 'prefs.listen');
  assert.equal(userRow(p.user.id).rating_scale, 'stars', 'rien d’écrit quand un champ est refusé');
  assert.equal((await call(p, 'POST', '/profile/settings', { prefs: 'deezer' })).body.field, 'prefs');
  assert.equal((await call(p, 'POST', '/profile/settings', { prefs: { emailDigest: 'oui' } })).body.field, 'prefs.emailDigest');
  assert.equal((await call(p, 'POST', '/profile/settings', { ratingScale: 'emoji' })).body.error, 'invalid_scale');
  db.prepare("UPDATE users SET prefs = '{pas du json' WHERE id = ?").run(p.user.id);
  assert.deepEqual((await call(p, 'GET', '/state')).body.user.prefs, { listen: 'deezer', emailDigest: false }, 'JSON illisible → valeurs par défaut');
});

test('admin : vue d’ensemble paginée (50 par page, totaux réels), chaque action modifiante journalisée, rôle en base ignoré', async () => {
  await signupVerified(app, { username: 'boss', email: 'boss@example.com' });
  const boss = await login(app, 'boss');
  const player = await signupVerified(app, { username: 'adm_pat' });
  rawUsers(60);
  const first = await call(boss, 'GET', '/admin/overview');
  assert.equal(first.status, 200);
  assert.equal(first.body.users.length, 50);
  assert.ok(first.body.nextCursor);
  const all = [...first.body.users];
  for (let cursor = first.body.nextCursor; cursor;) {
    const page = (await call(boss, 'GET', `/admin/overview?cursor=${cursor}`)).body;
    all.push(...page.users);
    cursor = page.nextCursor;
  }
  const totals = db.prepare('SELECT COUNT(*) AS users, COUNT(email_verified_at) AS verified, SUM(unique_cards) AS cards FROM users').get();
  assert.equal(all.length, totals.users);
  assert.equal(new Set(all.map((u) => u.id)).size, totals.users, 'aucun joueur en double d’une page à l’autre');
  assert.deepEqual([first.body.totals.users, first.body.totals.verified, first.body.totals.cards], [totals.users, totals.verified, totals.cards]);
  assert.equal((await call(boss, 'GET', '/admin/overview?cursor=%%%')).status, 400);

  const grant = await call(boss, 'POST', `/admin/users/${player.user.id}/grant`, { packs: 3, royalties: 50 });
  assert.equal(grant.status, 200);
  const audit = db.prepare("SELECT * FROM admin_audit WHERE action = 'grant' ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.target, `user:${player.user.id}`);
  assert.deepEqual(JSON.parse(audit.payload), { packs: 3, royalties: 50 });
  assert.equal(audit.admin_id, userRow(audit.admin_id).id);
  await call(boss, 'POST', '/admin/me/almost', { albumId: 'thriller' });
  assert.ok(db.prepare("SELECT 1 FROM admin_audit WHERE action = 'me.almost' AND target = 'album:thriller'").get());
  services.audit(null, 'x'.repeat(200), 'y', { big: 'z'.repeat(5000) });
  const long = db.prepare('SELECT action, payload FROM admin_audit ORDER BY id DESC LIMIT 1').get();
  assert.equal(long.action.length, 80);
  assert.ok(long.payload.length <= 4001);

  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(player.user.id);
  assert.equal((await call(player, 'GET', '/admin/overview')).status, 403);
  assert.equal((await call(player, 'POST', `/admin/users/${player.user.id}/grant`, { packs: 1 })).status, 403);
});

test('bus : événements émis après la validation de la transaction, un abonné en panne ne casse rien', async () => {
  const p = await signupVerified(app, { username: 'bus_bea' });
  const events = [];
  const offs = [];
  for (const name of ['cards.added', 'pack.opened', 'album.completed', 'artist.mastered', 'friend.requested', 'friend.accepted', 'blindtest.finished']) {
    offs.push(deps.bus.on(name, (payload) => events.push({ name, payload, inTx: db.isTransaction })));
  }
  offs.push(deps.bus.on('cards.added', () => {
    throw new Error('abonné en panne');
  }));
  const quiet = console.error;
  console.error = () => {};
  try {
    // Toutes les cartes de « 21 » sauf une, puis le pressage de la dernière : album complété.
    const tracks = app.catalog.albumTracks('21');
    const last = tracks.find((t) => pressCost(t.rarity) != null);
    const ins = db.prepare("INSERT INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, ?, 'std', 1, ?)");
    for (const t of tracks) if (t.id !== last.id) ins.run(p.user.id, t.id, Date.now());
    services.refreshProgress(p.user.id, ['21']);
    db.prepare('UPDATE users SET unique_cards = ?, royalties = 10000, bonus_packs = 3 WHERE id = ?').run(tracks.length - 1, p.user.id);
    const pressed = await call(p, 'POST', '/collection/press', { trackId: last.id });
    assert.equal(pressed.status, 200, 'l’action réussit malgré l’abonné en panne');
    assert.equal(pressed.body.achievements.find((a) => a.key === 'album:21')?.rank, 1);
    const opened = await call(p, 'POST', '/packs/open', {});
    assert.equal(opened.status, 200);
    const other = await signupVerified(app, { username: 'bus_bo' });
    await call(other, 'POST', '/friends/request', { username: p.username });
    const inbox = (await call(p, 'GET', '/friends')).body;
    await call(p, 'POST', `/friends/${inbox.incoming[0].requestId}/accept`);
  } finally {
    console.error = quiet;
    for (const off of offs) off();
  }
  assert.ok(events.every((e) => e.inTx === false), 'aucun abonné appelé pendant la transaction');
  const added = events.filter((e) => e.name === 'cards.added');
  assert.equal(added.length, 2);
  assert.equal(added[0].payload.source, 'press');
  assert.ok(added[0].payload.albumDeltas.some((d) => d.albumId === '21' && d.after === d.total));
  assert.ok(Array.isArray(added[0].payload.artistDeltas));
  for (const k of ['userId', 'source', 'cards', 'albumDeltas', 'artistDeltas', 'achievements', 'levelBefore', 'levelAfter']) assert.ok(k in added[1].payload, k);
  const completed = events.find((e) => e.name === 'album.completed');
  assert.deepEqual({ ...completed.payload, at: 0 }, { userId: p.user.id, albumId: '21', rank: 1, at: 0 });
  assert.deepEqual(events.find((e) => e.name === 'pack.opened').payload, { userId: p.user.id, source: 'pack', count: 1 });
  assert.ok(events.find((e) => e.name === 'friend.requested').payload.requestId > 0);
  assert.equal(events.find((e) => e.name === 'friend.accepted').payload.userId, p.user.id);
});

test('tâches de nuit : purges de rétention, chaque tâche isolée, 04:10 à Paris, rattrapage au démarrage', async () => {
  const now = Date.now();
  const [old] = rawUsers(1, { createdAt: now - 30 * DAY });
  const ins = db.prepare(`INSERT INTO users (email, username, password_hash, email_verified_at, packs_at, created_at) VALUES (?, ?, 'x', NULL, 0, ?)`);
  const stale = Number(ins.run('stale@example.com', 'stale_unverified', now - 8 * DAY).lastInsertRowid);
  const recent = Number(ins.run('recent@example.com', 'recent_unverified', now - DAY).lastInsertRowid);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run('expired', old, now - 40 * DAY, now - 1);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run('valid', old, now, now + DAY);
  db.prepare("INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES ('t-old', ?, 'reset', ?, ?)").run(old, now - 1, now - DAY);
  db.prepare("INSERT INTO dev_emails (to_addr, subject, text, html, created_at) VALUES ('a', 's', 't', 'h', ?), ('b', 's', 't', 'h', ?)").run(now - 8 * DAY, now);
  db.prepare("INSERT INTO pack_openings (user_id, source, cards, created_at) VALUES (?, 'pack', '[]', ?), (?, 'pack', '[]', ?)").run(old, now - 401 * DAY, old, now - 399 * DAY);

  const report = await app.jobs.runAll(['purge-auth', 'purge-dev-emails', 'purge-openings', 'optimize']);
  assert.ok(report.every((r) => r.ok), JSON.stringify(report));
  const auth = report[0].result;
  assert.ok(auth.sessions >= 1 && auth.tokens >= 1 && auth.users >= 1, JSON.stringify(auth));
  assert.ok(!userRow(stale), 'compte jamais vérifié de plus de 7 jours supprimé (pseudo libéré)');
  assert.ok(userRow(recent), 'compte non vérifié récent gardé');
  assert.ok(userRow(old), 'compte vérifié gardé');
  assert.ok(db.prepare("SELECT 1 FROM sessions WHERE token_hash = 'valid'").get());
  assert.ok(!db.prepare("SELECT 1 FROM sessions WHERE token_hash = 'expired'").get());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dev_emails WHERE created_at < ?').get(now - 7 * DAY).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pack_openings WHERE user_id = ?').get(old).n, 1);
  for (const name of ['purge-auth', 'purge-dev-emails', 'purge-openings', 'optimize']) assert.ok(app.jobs.lastRun(name) >= now, name);
  for (const name of ['purge-auth', 'purge-dev-emails', 'purge-openings', 'optimize']) assert.ok(app.jobs.names().includes(name));

  // 04:10 à Paris : 02:10 UTC en été, 03:10 UTC en hiver, jours de changement d'heure compris.
  assert.equal(nextRunAt(Date.parse('2026-10-09T12:00:00Z')), Date.parse('2026-10-10T02:10:00Z'));
  assert.equal(nextRunAt(Date.parse('2026-10-10T02:09:00Z')), Date.parse('2026-10-10T02:10:00Z'));
  assert.equal(nextRunAt(Date.parse('2026-10-10T02:10:00Z')), Date.parse('2026-10-11T02:10:00Z'));
  assert.equal(nextRunAt(Date.parse('2026-10-24T12:00:00Z')), Date.parse('2026-10-25T03:10:00Z'), 'nuit du passage à l’heure d’hiver');
  assert.equal(nextRunAt(Date.parse('2026-03-28T12:00:00Z')), Date.parse('2026-03-29T02:10:00Z'), 'nuit du passage à l’heure d’été');
  assert.equal(nextRunAt(Date.parse('2026-12-31T23:30:00Z')), Date.parse('2027-01-01T03:10:00Z'));

  // Planificateur isolé : une tâche en panne n'empêche pas les autres ; au démarrage, seules les tâches en retard
  // (jamais lancées ou il y a plus de 26 h) sont rattrapées.
  const logs = [];
  const jobs = createJobs({ db }, { log: { error: (...a) => logs.push(a) } });
  let ran = 0;
  jobs.register('test', [{ name: 'boom', run: () => { throw new Error('boom'); } }, { name: 'counter', run: () => { ran += 1; } }]);
  const r = await jobs.runAll(['boom', 'counter']);
  assert.deepEqual(r.map((x) => [x.name, x.ok]), [['boom', false], ['counter', true]]);
  assert.equal(logs.length, 1);
  assert.throws(() => jobs.register('test', [{ name: 'counter', run() {} }]), /deux fois/);
  db.prepare("INSERT INTO kv (key, value) VALUES ('job:counter', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(Date.now() - 27 * 3_600_000));
  db.prepare("INSERT INTO kv (key, value) VALUES ('job:optimize', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(Date.now()));
  assert.ok(jobs.stale().includes('counter'));
  assert.ok(!jobs.stale().includes('optimize'));
  ran = 0;
  jobs.start({ catchUpDelayMs: 10 });
  try {
    for (let i = 0; i < 100 && (!ran || jobs.running); i++) await new Promise((res) => setTimeout(res, 20));
  } finally {
    jobs.stop();
  }
  assert.equal(ran, 1, 'tâche en retard rattrapée au démarrage');
  assert.ok(!jobs.stale().includes('counter'));
});

test('mots de passe : scrypt N = 2^17 visé (2^14 en test), re-hachage des anciens coûts, hachage illisible refusé sans erreur', async () => {
  assert.equal(SCRYPT_COST.N, 2 ** 17);
  const current = await hashPassword('motdepasse123');
  assert.match(current, /^scrypt\$16384\$8\$1\$/);
  assert.equal(needsRehash(current), false);
  assert.equal(await verifyPassword('motdepasse123', current), true);
  assert.equal(await verifyPassword('autre', current), false);
  const weak = await hashPassword('motdepasse123', { N: 2 ** 12 });
  assert.equal(needsRehash(weak), true);
  assert.equal(await verifyPassword('motdepasse123', weak), true);
  const strong = await hashPassword('motdepasse123', { N: 2 ** 17 });
  assert.match(strong, /^scrypt\$131072\$/);
  assert.equal(await verifyPassword('motdepasse123', strong), true, 'plafond de mémoire suffisant pour 2^17');
  // Hachage factice : même coût qu'un vrai compte, ne correspond à aucun mot de passe.
  assert.match(dummyHash(), /^scrypt\$16384\$8\$1\$/);
  assert.equal(needsRehash(dummyHash()), false);
  assert.equal(await verifyPassword('motdepasse123', dummyHash()), false);
  for (const bad of ['', 'md5$abc', 'scrypt$abc$8$1$AA==$AA==', 'scrypt$3$8$1$AA==$AA==', `scrypt$${2 ** 24}$8$1$AA==$AA==`, null]) {
    assert.equal(await verifyPassword('x', bad), false, String(bad));
    assert.equal(needsRehash(bad), true);
  }
});

test('navigation : albums demandés par identifiants avec la progression du joueur (user_album_progress)', async () => {
  const p = await signupVerified(app, { username: 'ids_ivy' });
  db.prepare('UPDATE users SET royalties = 5000 WHERE id = ?').run(p.user.id);
  await call(p, 'POST', '/packs/album', { albumId: 'exodus' });
  const r = await call(p, 'GET', '/catalog/albums?ids=exodus,discovery,inconnu');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((a) => a.id), ['exodus', 'discovery']);
  const owned = db.prepare("SELECT owned FROM user_album_progress WHERE user_id = ? AND album_id = 'exodus'").get(p.user.id).owned;
  assert.ok(owned >= 1);
  assert.equal(r.body.items[0].owned, owned);
  assert.equal(r.body.items[1].owned, 0);
});
