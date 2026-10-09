// Performance (PLAN.md 7.3 ; critères P0.6 et P0.11). Deux volets :
//   1. Plans de requêtes : toutes les requêtes préparées par les chemins les plus fréquents d'un joueur (état, boosters,
//      pressage, profil, amis, notes, réglages, blind test) passent par un index : aucun parcours complet (SCAN) d'une
//      table du jeu. Vérifié sur une base neuve (sans statistiques) et, si PERF_DB est défini, sur la base peuplée.
//   2. Avec PERF_DB (copie de design/schema-proto/old.db : 5 000 joueurs, 786 000 cartes, 341 000 notes) : profil du
//      plus gros collectionneur (60 000 cartes, 3 000 vinyles) < 50 ms, profil d'un joueur ordinaire < 10 ms, réponse
//      d'un booster du gros collectionneur < 10 Ko, liste d'amis et vue admin en quelques millisecondes.
//   PERF_DB=/tmp/am-p0-a/perf.db node --test server/test/perf.test.js   (la base est recopiée : PERF_DB n'est pas modifiée)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApp, signupVerified, api } from './helpers.js';

const { openDb } = await import('../db.js');
const { createCatalog } = await import('../catalog.js');
const { createServices } = await import('../services.js');
const { pressCost } = await import('../../shared/rules.js');

// Tables qu'un chemin de joueur ne doit jamais parcourir en entier (les autres sont minuscules : kv, covers…).
const GUARDED = new Set(['users', 'sessions', 'email_tokens', 'cards', 'achievements', 'friendships', 'pack_openings',
  'blindtest_games', 'ratings', 'cat_artists', 'cat_albums', 'cat_tracks', 'rating_stats', 'user_album_progress', 'posts',
  'comments', 'likes', 'notifications', 'activity', 'blocks', 'reports', 'lists', 'list_items', 'battle_votes', 'user_quests',
  'search_docs', 'external_ids', 'admin_audit', 'moderation_actions']);

/** Alias → table d'une requête (FROM / JOIN). */
function aliases(sql) {
  const map = new Map();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(\w+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    map.set(m[1], m[1]);
    if (m[2] && !/^(WHERE|ON|JOIN|LEFT|INNER|CROSS|GROUP|ORDER|LIMIT|SET|VALUES|USING|AND|OR|SELECT)$/i.test(m[2])) map.set(m[2], m[1]);
  }
  return map;
}

/**
 * Étapes du plan qui parcourent une table surveillée en entier (« SCAN cards », « SCAN c USING INDEX … »). Seule
 * exception : la lecture d'un index dans son ordre jusqu'à la limite (« ORDER BY … LIMIT n » servi par l'index, sans
 * tri temporaire), qui s'arrête après n lignes (première page de la vue admin).
 */
function scans(db, sql) {
  const n = (sql.match(/\?/g) || []).length;
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(n).fill(1)).map((r) => r.detail);
  const names = aliases(sql);
  const orderedWalk = /\bORDER BY\b[\s\S]*\bLIMIT\b/i.test(sql) && !plan.some((d) => d.includes('TEMP B-TREE FOR ORDER BY'));
  return plan.filter((d) => {
    const m = /^SCAN (\w+)( USING (COVERING )?INDEX)?/.exec(d);
    return m && GUARDED.has(names.get(m[1]) ?? m[1]) && !(m[2] && orderedWalk);
  }).map((d) => `${d}   ←   ${sql.replace(/\s+/g, ' ').slice(0, 160)}`);
}

/** Requêtes préparées pendant `fn` (le service appelle db.prepare à chaque requête). */
async function capture(db, fn) {
  const orig = db.prepare;
  const seen = new Set();
  db.prepare = (sql) => {
    seen.add(sql);
    return orig.call(db, sql);
  };
  try {
    await fn();
  } finally {
    delete db.prepare;
  }
  // PRAGMA, transactions et écritures d'une seule ligne par clé ne passent pas par le planificateur de façon utile.
  return [...seen].filter((sql) => /^\s*(SELECT|WITH|INSERT\s+INTO\s+\w+\s*\([^)]*\)\s*SELECT|DELETE|UPDATE)/i.test(sql));
}

test('plans de requêtes : les chemins fréquents d’un joueur n’ont aucun parcours complet de table (base neuve)', async () => {
  const app = await startApp();
  try {
    const { db, services } = app;
    const p = await signupVerified(app, { username: 'plan_pat' });
    const friend = await signupVerified(app, { username: 'plan_fred' });
    db.prepare('UPDATE users SET bonus_packs = 10, royalties = 10000 WHERE id = ?').run(p.user.id);
    const call = (who, method, route, body) => api(app.base, who.cookie, method, route, body);
    const sqls = await capture(db, async () => {
      await call(p, 'GET', '/state');
      await call(p, 'POST', '/packs/open', {});
      await call(p, 'POST', '/packs/album', { albumId: 'discovery' });
      const missing = app.catalog.albumTracks('thriller').find((t) => pressCost(t.rarity) != null);
      await call(p, 'POST', '/collection/press', { trackId: missing.id });
      await call(p, 'POST', '/shop/buy-pack');
      await call(p, 'POST', '/profile/settings', { prefs: { listen: 'spotify' } });
      await call(p, 'POST', '/profile/showcase', { slots: [] });
      await call(p, 'GET', `/users/${friend.username}`);
      await call(p, 'GET', `/users/${p.username}`);
      await call(friend, 'POST', '/friends/request', { username: p.username });
      const inbox = (await call(p, 'GET', '/friends')).body;
      await call(p, 'POST', `/friends/${inbox.incoming[0].requestId}/accept`);
      await call(p, 'GET', '/friends');
      await call(p, 'PUT', '/ratings/album/discovery', { score: 7 });
      await call(p, 'GET', '/catalog/albums?ids=discovery,thriller');
      const game = (await call(p, 'POST', '/blindtest/start', { genre: 'all' })).body;
      await call(p, 'POST', `/blindtest/${game.gameId}/answer`, { choice: null });
      services.userSummaries([p.user.id, friend.user.id], p.user.id);
      services.focusAlbums(p.user.id);
      services.adminOverview({});
    });
    assert.ok(sqls.length > 30, `${sqls.length} requêtes relevées`);
    // Totaux de la vue admin : des COUNT(*) assumés sur toute la table (espace admin seulement, quelques ms).
    const adminTotals = /^SELECT COUNT\(\*\) AS (n|users)|^SELECT COUNT\(\*\) AS n FROM (pack_openings|ratings)$/;
    const bad = sqls.filter((sql) => !adminTotals.test(sql.trim())).flatMap((sql) => scans(db, sql));
    assert.deepEqual(bad, []);
    // Requêtes clés : l'index attendu est bien celui qui sert.
    const planOf = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array((sql.match(/\?/g) || []).length).fill(1)).map((r) => r.detail).join(' | ');
    const flat = (sql) => sql.replace(/\s+/g, ' ');
    const expect = (needle, index) => {
      const sql = sqls.find((s) => flat(s).includes(needle));
      assert.ok(sql, `requête « ${needle} » non exécutée`);
      assert.match(planOf(sql), index, needle);
    };
    expect('FROM user_album_progress WHERE user_id = ? AND owned < total', /uap_user_recent/);
    expect("WHERE a.user_id = ? AND a.key >= 'album:'", /sqlite_autoindex_achievements_1 \(user_id=\? AND key>\? AND key<\?\)/);
    expect('INSERT INTO user_album_progress', /SEARCH t USING INDEX cat_tracks_album[\s\S]*SEARCH c USING (COVERING )?INDEX sqlite_autoindex_cards_1/);
    expect("WHERE addressee_id = ? AND status = 'pending'", /idx_friend_addressee/);
    expect('FROM users WHERE id IN (SELECT value FROM json_each(?))', /INTEGER PRIMARY KEY/);
    expect('WHERE (requester_id = ? OR addressee_id = ?)', /MULTI-INDEX OR/);
    expect('FROM blindtest_games WHERE user_id = ? AND rewarded = 1', /idx_blindtest_user/);
  } finally {
    await app.close();
  }
});

test('plans de requêtes : tables des niveaux suivants et suppressions en cascade sans parcours complet', () => {
  const db = openDb(':memory:');
  const queries = [
    // Pastille des notifications (P0-F) et fil d'actualité (P1-A).
    'SELECT COUNT(*) AS n FROM (SELECT DISTINCT group_key FROM notifications WHERE user_id = ? AND read_at IS NULL LIMIT 100)',
    'SELECT id FROM activity WHERE actor_id IN (SELECT value FROM json_each(?)) AND created_at < ? ORDER BY created_at DESC LIMIT 20',
    'SELECT id FROM comments WHERE target_type = ? AND target_id = ? AND parent_id IS NULL ORDER BY created_at LIMIT 20',
    'SELECT COUNT(*) AS n FROM (SELECT 1 FROM ratings WHERE user_id = ? AND review_at >= ? LIMIT ?)',
    "SELECT id FROM ratings WHERE item_type = ? AND item_id = ? AND review IS NOT NULL AND hidden_at IS NULL ORDER BY updated_at DESC LIMIT 10",
    // Suppression d'un compte, d'un commentaire, d'un signalement : clés étrangères indexées (aucun parcours).
    'DELETE FROM users WHERE id = ?',
    'DELETE FROM comments WHERE id = ?',
    'DELETE FROM reports WHERE id = ?',
    'DELETE FROM lists WHERE id = ?',
    // Purges de nuit.
    'DELETE FROM sessions WHERE expires_at < ?',
    'DELETE FROM email_tokens WHERE expires_at < ?',
    'DELETE FROM users WHERE email_verified_at IS NULL AND created_at < ?',
    'DELETE FROM pack_openings WHERE created_at < ?',
  ];
  const bad = [];
  for (const sql of queries) {
    const n = (sql.match(/\?/g) || []).length;
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(n).fill(1)).map((r) => r.detail);
    for (const d of plan) {
      const m = /^SCAN (\w+)/.exec(d);
      // La purge des ouvertures de boosters parcourt pack_openings une fois par nuit (pas d'index sur la date seule).
      if (m && GUARDED.has(m[1]) && !(sql.startsWith('DELETE FROM pack_openings') && m[1] === 'pack_openings')) bad.push(`${d} ← ${sql}`);
    }
  }
  assert.deepEqual(bad, []);
  db.close();
});

const PERF_DB = process.env.PERF_DB;
test('base peuplée (PERF_DB) : profil du gros collectionneur < 50 ms, booster < 10 Ko, amis et admin en quelques ms', { skip: !PERF_DB && 'PERF_DB non défini' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-perf-'));
  const file = path.join(dir, 'perf.db');
  try {
    fs.copyFileSync(PERF_DB, file);
    const db = openDb(file);
    const catalog = createCatalog(db);
    const services = createServices(db, catalog);
    // Meilleur de trois mesures (`reset` avant chacune : caches vidés) : les autres chantiers font tourner leurs tests
    // en même temps sur la même machine, une mesure isolée peut tomber pendant un pic de charge.
    const ms = (fn, { reset = () => {}, runs = 3 } = {}) => {
      let best = Infinity;
      let result;
      for (let i = 0; i < runs; i++) {
        reset();
        const started = performance.now();
        result = fn();
        best = Math.min(best, performance.now() - started);
      }
      return [best, result];
    };
    const whale = db.prepare('SELECT id, username, unique_cards FROM users ORDER BY unique_cards DESC, id LIMIT 1').get();
    const typical = db.prepare('SELECT id, username, unique_cards FROM users WHERE id = 42').get();
    const vinyls = db.prepare("SELECT COUNT(*) AS n FROM achievements WHERE user_id = ? AND key >= 'album:' AND key < 'album;'").get(whale.id).n;
    assert.ok(whale.unique_cards >= 50_000 && vinyls >= 2_000, `gros collectionneur : ${whale.unique_cards} cartes, ${vinyls} vinyles`);
    const report = [];
    // Échauffement (compilation des requêtes et du code) sur un autre joueur.
    const other = db.prepare('SELECT username FROM users WHERE id NOT IN (?, ?) LIMIT 1').get(whale.id, typical.id).username;
    services.publicProfile(typical.id, other);

    const [whaleMs, profile] = ms(() => services.publicProfile(typical.id, whale.username), { reset: () => services.forget(whale.id) });
    report.push(`profil du gros collectionneur ${whaleMs.toFixed(1)} ms`);
    assert.ok(whaleMs < 50, report.at(-1));
    assert.equal(profile.role, undefined);
    assert.equal(profile.vinyls.length, Math.min(120, vinyls));
    const [typicalMs] = ms(() => services.publicProfile(whale.id, typical.username), { reset: () => services.forget(typical.id) });
    report.push(`profil ordinaire ${typicalMs.toFixed(1)} ms`);
    assert.ok(typicalMs < 10, report.at(-1));

    db.prepare('UPDATE users SET bonus_packs = bonus_packs + 5 WHERE id = ?').run(whale.id);
    const [packMs, response] = ms(() => ({ ...services.openPacks(whale.id, 1), state: services.state(whale.id, { partial: true }) }));
    const bytes = Buffer.byteLength(JSON.stringify(response));
    report.push(`booster du gros collectionneur ${packMs.toFixed(1)} ms, ${bytes} octets`);
    assert.ok(bytes < 10_000, report.at(-1));
    assert.ok(packMs < 150, report.at(-1));
    assert.equal(response.state.partial, true);

    const [partialMs] = ms(() => services.state(whale.id, { partial: true }));
    report.push(`état partiel ${partialMs.toFixed(1)} ms`);
    assert.ok(partialMs < 10, report.at(-1));

    const top = db.prepare(`SELECT u, COUNT(*) AS n FROM (SELECT requester_id AS u FROM friendships WHERE status = 'accepted'
      UNION ALL SELECT addressee_id FROM friendships WHERE status = 'accepted') GROUP BY u ORDER BY n DESC LIMIT 1`).get();
    services.listFriends(top.u);
    const [friendsMs, friends] = ms(() => services.listFriends(top.u));
    report.push(`${friends.friends.length} amis en ${friendsMs.toFixed(1)} ms`);
    assert.ok(friendsMs < 10, report.at(-1));

    const ids = db.prepare('SELECT id FROM users ORDER BY id LIMIT 300').all().map((r) => r.id);
    const [summaryMs, summaries] = ms(() => services.userSummaries(ids, typical.id));
    report.push(`300 résumés de joueurs ${summaryMs.toFixed(1)} ms`);
    assert.equal(summaries.size, 300);
    assert.ok(summaryMs < 10, report.at(-1));

    const [focusMs] = ms(() => services.focusAlbums(whale.id));
    report.push(`albums visés ${focusMs.toFixed(1)} ms`);
    assert.ok(focusMs < 10, report.at(-1));

    const [adminMs, overview] = ms(() => services.adminOverview({}));
    report.push(`vue admin ${adminMs.toFixed(1)} ms`);
    assert.equal(overview.users.length, 50);
    assert.ok(adminMs < 20, report.at(-1));

    // Plans sur la base peuplée (statistiques d'ANALYZE présentes) : mêmes règles qu'une base neuve.
    const vinylSql = `WITH v AS (SELECT a.key, a.created_at, a.rank FROM achievements a WHERE a.user_id = ? AND a.key >= 'album:'
      AND a.key < 'album;' ORDER BY a.created_at DESC LIMIT 120) SELECT v.key FROM v LEFT JOIN user_album_progress p
      ON p.user_id = ? AND p.album_id = substr(v.key, 7)`;
    assert.deepEqual(scans(db, vinylSql), []);
    console.log(`  base peuplée : ${report.join(' · ')}`);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
