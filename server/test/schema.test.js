// Schéma global (PLAN.md section 3, critère P0.3) : une base neuve et une base de l'ancienne version migrée finissent
// au même user_version avec le même sqlite_master ; un second démarrage ne fait rien ; les étapes recalculent bien
// les compteurs ; la suppression d'un compte part en cascade au niveau SQL (section 3.7).
// Variable facultative : FIXTURE=<copie de fixture20k.db> migre aussi une copie du grand catalogue (20 000 albums).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.NODE_ENV = 'test';
const { openDb, runSteps, SCHEMA_VERSION, COLUMNS, INDEXES } = await import('../db.js');

/**
 * Schéma de la version d'avant la refonte (server/db.js au commit 5d6dd5e), recopié tel quel : c'est la forme des
 * bases déjà en production. Ne jamais le modifier.
 */
const LEGACY_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  email_verified_at INTEGER,
  role TEXT NOT NULL DEFAULT 'player',
  lang TEXT NOT NULL DEFAULT 'fr',
  avatar TEXT NOT NULL DEFAULT 'initials',
  avatar_color TEXT NOT NULL DEFAULT '#ff4f7e',
  royalties INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  packs INTEGER NOT NULL DEFAULT 0,
  packs_at INTEGER NOT NULL,
  bonus_packs INTEGER NOT NULL DEFAULT 0,
  showcase TEXT NOT NULL DEFAULT '[]',
  last_mail_at INTEGER,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, track_id, variant)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS friendships (
  id INTEGER PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  responded_at INTEGER,
  UNIQUE (requester_id, addressee_id)
);

CREATE TABLE IF NOT EXISTS pack_openings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  cards TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blindtest_games (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  genre TEXT NOT NULL,
  questions TEXT NOT NULL,
  current INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  rewarded INTEGER NOT NULL DEFAULT 0,
  reward_packs INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS ratings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  review TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_type, item_id)
);

-- Catalogue musical : la graine (shared/catalog.js) et les albums importés depuis Deezer.
CREATE TABLE IF NOT EXISTS cat_artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT,
  genre TEXT,
  fans INTEGER NOT NULL DEFAULT 0,
  track_count INTEGER NOT NULL DEFAULT 0,
  album_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  deezer_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cat_albums (
  id TEXT PRIMARY KEY,
  artist_id TEXT NOT NULL REFERENCES cat_artists(id),
  title TEXT NOT NULL,
  year INTEGER,
  genre TEXT,
  art TEXT,
  catalog INTEGER NOT NULL UNIQUE,
  track_count INTEGER NOT NULL,
  fans INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  deezer_id TEXT UNIQUE,
  cover TEXT,
  cover_w INTEGER,
  thumb TEXT,
  thumb_w INTEGER,
  url TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cat_albums_artist ON cat_albums(artist_id);
CREATE INDEX IF NOT EXISTS cat_albums_genre ON cat_albums(genre, fans);
CREATE INDEX IF NOT EXISTS cat_albums_year ON cat_albums(year);
CREATE INDEX IF NOT EXISTS cat_albums_fans ON cat_albums(fans);

CREATE TABLE IF NOT EXISTS cat_tracks (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  album_id TEXT REFERENCES cat_albums(id),
  artist_id TEXT NOT NULL REFERENCES cat_artists(id),
  n INTEGER NOT NULL,
  total INTEGER NOT NULL,
  title TEXT NOT NULL,
  feat TEXT,
  year INTEGER,
  genre TEXT,
  pop INTEGER NOT NULL,
  rarity TEXT NOT NULL,
  rank INTEGER,
  promo_kind TEXT,
  context TEXT,
  art TEXT,
  url TEXT,
  cover TEXT,
  thumb TEXT,
  source TEXT NOT NULL,
  deezer_id TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cat_tracks_album ON cat_tracks(album_id, n);
CREATE INDEX IF NOT EXISTS cat_tracks_artist ON cat_tracks(artist_id);
CREATE INDEX IF NOT EXISTS cat_tracks_rarity ON cat_tracks(rarity);
CREATE INDEX IF NOT EXISTS cat_tracks_pop ON cat_tracks(pop);
CREATE INDEX IF NOT EXISTS cat_tracks_kind ON cat_tracks(kind, n);
CREATE INDEX IF NOT EXISTS cards_track ON cards(track_id);

CREATE VIRTUAL TABLE IF NOT EXISTS cat_search USING fts5(album_id UNINDEXED, title, artist, tokenize = 'unicode61 remove_diacritics 2');

-- Importation du catalogue : file d'artistes à explorer et état de l'import.
CREATE TABLE IF NOT EXISTS import_artists (
  deezer_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  fans INTEGER NOT NULL DEFAULT 0,
  genre TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  depth INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS import_artists_queue ON import_artists(status, depth, priority, fans);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Pochettes officielles : seulement l'adresse des images et des pages, jamais les fichiers.
CREATE TABLE IF NOT EXISTS covers (
  item_key TEXT PRIMARY KEY,
  provider TEXT,
  cover TEXT,
  cover_w INTEGER,
  thumb TEXT,
  thumb_w INTEGER,
  url TEXT,
  tracks TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS previews (
  track_id TEXT PRIMARY KEY,
  url TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dev_emails (
  id INTEGER PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  html TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON email_tokens(user_id, purpose);
CREATE INDEX IF NOT EXISTS idx_friend_addressee ON friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS idx_openings_user ON pack_openings(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_blindtest_user ON blindtest_games(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ratings_item ON ratings(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_ratings_recent ON ratings(updated_at);
`;

/** Colonnes ajoutées par l'ancienne version (son tableau MIGRATIONS). */
const LEGACY_COLUMNS = [
  "ALTER TABLE users ADD COLUMN rating_scale TEXT NOT NULL DEFAULT 'stars'",
  'ALTER TABLE users ADD COLUMN signup_secret TEXT',
];

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-schema-'));
test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
const tmpFile = (name) => path.join(tmpDir, name);

/** sqlite_master (sans les statistiques d'ANALYZE), une ligne par objet. */
const master = (db) => db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master
  WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type, name`).all().map((r) => `${r.type}|${r.name}|${r.tbl_name}|${r.sql}`);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const count = (db, table, where = '1', ...args) => db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args).n;

/** Différences de sqlite_master entre deux bases (lisibles dans le message d'échec). */
function assertSameMaster(a, b, label) {
  const left = new Set(master(a));
  const right = new Set(master(b));
  const onlyLeft = [...left].filter((x) => !right.has(x)).map((x) => x.slice(0, 160));
  const onlyRight = [...right].filter((x) => !left.has(x)).map((x) => x.slice(0, 160));
  assert.deepEqual({ onlyLeft, onlyRight }, { onlyLeft: [], onlyRight: [] }, `${label} : sqlite_master différent`);
}

/**
 * Base au format de l'ancienne version, avec un petit jeu de données qui exerce chaque étape : notes (dont une
 * critique), cartes holo et standard, succès d'album obtenus à des dates différentes, identifiants Deezer en colonnes
 * et dans covers, couleur d'avatar par défaut et couleur choisie.
 */
function legacyDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(LEGACY_SCHEMA);
  for (const sql of LEGACY_COLUMNS) db.exec(sql);
  db.exec(`
    INSERT INTO cat_artists (id, name, source, deezer_id, track_count, created_at) VALUES
      ('ar1', 'Artiste importé', 'deezer', '111', 2, 1000), ('ar-seed', 'Artiste de base', 'seed', NULL, 3, 1000);
    INSERT INTO cat_albums (id, artist_id, title, catalog, track_count, source, deezer_id, created_at) VALUES
      ('al1', 'ar1', 'Album importé', 1001, 2, 'deezer', '222', 1000),
      ('al-seed', 'ar-seed', 'Album de base', 1, 2, 'seed', NULL, 1000);
    INSERT INTO cat_tracks (id, kind, album_id, artist_id, n, total, title, pop, rarity, source, deezer_id, created_at) VALUES
      ('al1:01', 'album', 'al1', 'ar1', 1, 2, 'Un', 80, 'common', 'deezer', 't1', 1000),
      ('al1:02', 'album', 'al1', 'ar1', 2, 2, 'Deux', 20, 'rare', 'deezer', 't2', 1000),
      ('al-seed:01', 'album', 'al-seed', 'ar-seed', 1, 2, 'Base un', 50, 'uncommon', 'seed', NULL, 1000),
      ('al-seed:02', 'album', 'al-seed', 'ar-seed', 2, 2, 'Base deux', 10, 'epic', 'seed', NULL, 1000),
      ('promo:x', 'promo', NULL, 'ar-seed', 1, 1, 'Single', 60, 'promo', 'seed', NULL, 1000);
    INSERT INTO covers (item_key, provider, url, fetched_at) VALUES
      ('al-seed', 'deezer', 'https://www.deezer.com/fr/album/333', 2000),
      ('promo:x', 'deezer', 'https://www.deezer.com/track/444', 2000),
      ('al1', 'spotify', 'https://open.spotify.com/album/zzz', 2000);
    INSERT INTO users (id, email, username, password_hash, email_verified_at, packs_at, created_at) VALUES
      (1, 'alice@example.com', 'alice', 'x', 10, 0, 100);
    INSERT INTO users (id, email, username, password_hash, email_verified_at, avatar_color, packs_at, created_at) VALUES
      (2, 'bob@example.com', 'bob', 'x', 20, '#3fd6c4', 0, 200);
    INSERT INTO cards (user_id, track_id, variant, count, first_at) VALUES
      (1, 'al1:01', 'std', 2, 300), (1, 'al1:01', 'holo', 1, 310), (1, 'al1:02', 'std', 1, 320), (1, 'al-seed:01', 'std', 1, 330),
      (2, 'al1:01', 'std', 1, 250), (2, 'al1:02', 'holo', 1, 260), (2, 'al1:02', 'std', 1, 270);
    INSERT INTO achievements (user_id, key, created_at) VALUES
      (1, 'album:al1', 320), (2, 'album:al1', 270), (1, 'artist:ar1', 320);
    INSERT INTO ratings (user_id, item_type, item_id, score, review, created_at, updated_at) VALUES
      (1, 'album', 'al1', 8, 'Top', 10, 20), (2, 'album', 'al1', 6, NULL, 5, 5), (1, 'track', 'al1:01', 9, NULL, 30, 30);
    INSERT INTO friendships (requester_id, addressee_id, status, created_at, responded_at) VALUES (1, 2, 'accepted', 400, 410);
  `);
  return db;
}

test('base neuve : user_version = 9, toutes les tables, colonnes et index du plan', () => {
  const db = openDb(':memory:');
  assert.equal(SCHEMA_VERSION, 9);
  assert.equal(version(db), 9);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  for (const t of ['users', 'sessions', 'email_tokens', 'cards', 'achievements', 'friendships', 'pack_openings', 'blindtest_games',
    'ratings', 'cat_artists', 'cat_albums', 'cat_tracks', 'cat_search', 'import_artists', 'kv', 'covers', 'previews', 'dev_emails',
    'external_ids', 'search_docs', 'search_fts', 'search_tri', 'search_tri_vocab', 'rating_stats', 'user_album_progress',
    'user_stats_cache', 'album_similar', 'user_favorites', 'taste_matches', 'posts', 'comments', 'likes', 'notifications', 'activity',
    'blocks', 'reports', 'moderation_actions', 'admin_audit', 'lists', 'list_items', 'battle_votes', 'battle_ratings', 'user_quests',
    'user_boosters', 'user_cosmetics', 'sets', 'set_albums']) {
    assert.ok(tables.has(t), `table ${t} absente`);
  }
  for (const [table, column] of COLUMNS) {
    assert.ok(db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column), `colonne ${table}.${column} absente`);
  }
  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name));
  for (const [, name] of INDEXES.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)) assert.ok(indexes.has(name), `index ${name} absent`);
  // Notes v2 : identifiant stable, le triplet reste unique (ON CONFLICT du code existant).
  const ratingCols = db.prepare('PRAGMA table_info(ratings)').all().map((c) => c.name);
  assert.deepEqual(ratingCols.slice(0, 2), ['id', 'user_id']);
  db.exec("INSERT INTO users (id, email, username, password_hash, packs_at, created_at) VALUES (1, 'a@x.fr', 'a', 'x', 0, 0)");
  db.exec("INSERT INTO ratings (user_id, item_type, item_id, score, created_at, updated_at) VALUES (1, 'album', 'x', 5, 0, 0)");
  db.exec(`INSERT INTO ratings (user_id, item_type, item_id, score, created_at, updated_at) VALUES (1, 'album', 'x', 7, 1, 1)
    ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET score = excluded.score`);
  assert.equal(db.prepare('SELECT score FROM ratings').get().score, 7);
  assert.throws(() => db.exec("INSERT INTO ratings (user_id, item_type, item_id, score, created_at, updated_at) VALUES (1, 'disque', 'y', 5, 0, 0)"));
  db.close();
});

test('base de l’ancienne version : migrée jusqu’à v9, même sqlite_master qu’une base neuve, données recalculées', () => {
  const file = tmpFile('legacy.db');
  legacyDb(file).close();
  const db = openDb(file);
  assert.equal(version(db), 9);
  const fresh = openDb(':memory:');
  assertSameMaster(db, fresh, 'base migrée / base neuve');
  fresh.close();
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'clés étrangères rallumées après l’étape v1');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  // v1 : identifiants dans l'ordre de création, date du texte de la critique.
  assert.deepEqual(db.prepare('SELECT id, user_id, item_type, item_id, score, review, review_at FROM ratings ORDER BY id').all().map((r) => ({ ...r })), [
    { id: 1, user_id: 2, item_type: 'album', item_id: 'al1', score: 6, review: null, review_at: null },
    { id: 2, user_id: 1, item_type: 'album', item_id: 'al1', score: 8, review: 'Top', review_at: 20 },
    { id: 3, user_id: 1, item_type: 'track', item_id: 'al1:01', score: 9, review: null, review_at: null },
  ]);
  // v2 : agrégats des notes.
  const stats = db.prepare("SELECT * FROM rating_stats WHERE item_type = 'album' AND item_id = 'al1'").get();
  assert.equal(stats.count, 2);
  assert.equal(stats.sum, 14);
  assert.equal(stats.review_count, 1);
  assert.equal(stats.last_rated_at, 20);
  assert.deepEqual(JSON.parse(stats.dist), [0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0]);
  // v3 : progression par album (holo = morceaux possédés en holo).
  const uap = db.prepare('SELECT user_id, album_id, owned, holo, total, first_at, updated_at FROM user_album_progress ORDER BY user_id, album_id').all().map((r) => ({ ...r }));
  assert.deepEqual(uap, [
    { user_id: 1, album_id: 'al-seed', owned: 1, holo: 0, total: 2, first_at: 330, updated_at: 330 },
    { user_id: 1, album_id: 'al1', owned: 2, holo: 1, total: 2, first_at: 300, updated_at: 320 },
    { user_id: 2, album_id: 'al1', owned: 2, holo: 1, total: 2, first_at: 250, updated_at: 270 },
  ]);
  // v4 : compteur de cartes distinctes ; v7 : couleur par défaut → auto ; v8 : comptes existants déjà accueillis.
  assert.deepEqual(db.prepare('SELECT id, unique_cards, avatar_color, onboarded_at FROM users ORDER BY id').all().map((r) => ({ ...r })), [
    { id: 1, unique_cards: 3, avatar_color: 'auto', onboarded_at: 100 },
    { id: 2, unique_cards: 2, avatar_color: '#3fd6c4', onboarded_at: 200 },
  ]);
  // v5 : « Pressage n° » dans l'ordre des complétions ; rien pour un artiste.
  assert.deepEqual(db.prepare('SELECT user_id, key, rank FROM achievements ORDER BY key, rank').all().map((r) => ({ ...r })), [
    { user_id: 2, key: 'album:al1', rank: 1 },
    { user_id: 1, key: 'album:al1', rank: 2 },
    { user_id: 1, key: 'artist:ar1', rank: null },
  ]);
  // v6 : identifiants Deezer des colonnes et des pochettes Deezer de la graine (pas celles d'un autre fournisseur).
  assert.deepEqual(db.prepare('SELECT entity_type, entity_id, source, source_id, matched_by FROM external_ids ORDER BY entity_type, entity_id').all().map((r) => ({ ...r })), [
    { entity_type: 'album', entity_id: 'al-seed', source: 'deezer', source_id: '333', matched_by: 'covers' },
    { entity_type: 'album', entity_id: 'al1', source: 'deezer', source_id: '222', matched_by: 'backfill' },
    { entity_type: 'artist', entity_id: 'ar1', source: 'deezer', source_id: '111', matched_by: 'backfill' },
    { entity_type: 'track', entity_id: 'al1:01', source: 'deezer', source_id: 't1', matched_by: 'backfill' },
    { entity_type: 'track', entity_id: 'al1:02', source: 'deezer', source_id: 't2', matched_by: 'backfill' },
    { entity_type: 'track', entity_id: 'promo:x', source: 'deezer', source_id: '444', matched_by: 'covers' },
  ]);
  // v9 : raretés figées, rareté au moment du tirage gardée sur chaque carte.
  assert.equal(count(db, 'cat_tracks', 'rarity_locked = 0'), 0);
  assert.equal(count(db, 'cards c JOIN cat_tracks t ON t.id = c.track_id', 'c.pulled_rarity IS NOT t.rarity'), 0);
  // Les anciennes données sont intactes.
  assert.equal(count(db, 'cards'), 7);
  assert.equal(db.prepare('SELECT SUM(count) AS n FROM cards').get().n, 8);
  assert.equal(count(db, 'friendships', "status = 'accepted'"), 1);
  db.close();
});

test('second démarrage : aucune étape rejouée, moins de 50 ms, schéma inchangé', () => {
  const file = tmpFile('second.db');
  legacyDb(file).close();
  const first = openDb(file);
  const before = master(first);
  const rows = count(first, 'ratings') + count(first, 'user_album_progress') + count(first, 'external_ids');
  first.close();
  const started = performance.now();
  const again = openDb(file);
  const ms = performance.now() - started;
  assert.ok(ms < 50, `second démarrage en ${ms.toFixed(1)} ms`);
  assert.equal(version(again), 9);
  assert.deepEqual(master(again), before);
  assert.equal(count(again, 'ratings') + count(again, 'user_album_progress') + count(again, 'external_ids'), rows);
  // Les étapes sont idempotentes : les relancer ne change rien.
  runSteps(again);
  assert.equal(version(again), 9);
  assert.equal(count(again, 'ratings') + count(again, 'user_album_progress') + count(again, 'external_ids'), rows);
  again.close();
  // Une base neuve rouverte ne change pas non plus.
  const freshFile = tmpFile('fresh.db');
  openDb(freshFile).close();
  const reopened = openDb(freshFile);
  assert.equal(reopened.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(reopened.prepare('PRAGMA synchronous').get().synchronous, 1, 'synchronous = NORMAL');
  assert.equal(version(reopened), 9);
  reopened.close();
});

test('étape en échec : annulée en entier, user_version inchangé, clés étrangères rallumées', () => {
  const db = openDb(':memory:');
  db.exec("INSERT INTO users (id, email, username, password_hash, packs_at, created_at, xp) VALUES (1, 'a@x.fr', 'a', 'x', 0, 0, 5)");
  for (const fkOff of [false, true]) {
    assert.throws(() => runSteps(db, [{
      v: 10, name: 'boom', fkOff,
      run(d) {
        d.exec('UPDATE users SET xp = 999');
        throw new Error('boom');
      },
    }]), /boom/);
    assert.equal(version(db), 9);
    assert.equal(db.prepare('SELECT xp FROM users').get().xp, 5);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(db.isTransaction, false);
  }
  // Une étape réussie fait monter user_version, une seconde passe ne la rejoue pas.
  let runs = 0;
  const step = { v: 10, name: 'ok', run: () => { runs += 1; } };
  runSteps(db, [step]);
  runSteps(db, [step]);
  assert.equal(runs, 1);
  assert.equal(version(db), 10);
  db.close();
});

test('suppression d’un compte : cascade SQL sur toutes ses données, SET NULL sur les traces de modération', () => {
  const db = openDb(':memory:');
  const now = 1_000;
  db.exec(`INSERT INTO users (id, email, username, password_hash, email_verified_at, packs_at, created_at) VALUES
    (1, 'u@x.fr', 'parti', 'x', 1, 0, 0), (2, 'v@x.fr', 'reste', 'x', 1, 0, 0)`);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  for (const [a, b] of [[1, 2], [2, 1]]) {
    run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', `s${a}`, a, now, now + 1);
    run('INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)', `t${a}`, a, 'verify', now, now);
    run("INSERT INTO cards (user_id, track_id, variant, count, first_at) VALUES (?, 'x:01', 'std', 1, ?)", a, now);
    run("INSERT INTO achievements (user_id, key, created_at) VALUES (?, 'album:x', ?)", a, now);
    run("INSERT INTO pack_openings (user_id, source, cards, created_at) VALUES (?, 'pack', '[]', ?)", a, now);
    run("INSERT INTO blindtest_games (id, user_id, genre, questions, created_at) VALUES (?, ?, 'all', '[]', ?)", `g${a}`, a, now);
    run("INSERT INTO ratings (user_id, item_type, item_id, score, created_at, updated_at) VALUES (?, 'album', 'x', 5, ?, ?)", a, now, now);
    run("INSERT INTO user_album_progress (user_id, album_id, owned, total, first_at, updated_at) VALUES (?, 'x', 1, 2, ?, ?)", a, now, now);
    run("INSERT INTO user_stats_cache (user_id, key, data, computed_at) VALUES (?, 'passport', '{}', ?)", a, now);
    run("INSERT INTO user_favorites (user_id, kind, item_id, created_at) VALUES (?, 'artist', 'ar', ?)", a, now);
    run("INSERT INTO posts (id, user_id, body, created_at) VALUES (?, ?, 'Salut', ?)", a, a, now);
    run("INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, 'post', ?, ?)", a, b, now);
    run("INSERT INTO notifications (user_id, kind, actor_id, created_at) VALUES (?, 'friend_request', ?, ?)", a, b, now);
    run("INSERT INTO activity (actor_id, verb, object_type, object_id, created_at, updated_at) VALUES (?, 'post', 'post', ?, ?, ?)", a, String(a), now, now);
    run('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)', a, b, now);
    run("INSERT INTO lists (id, user_id, title, created_at, updated_at) VALUES (?, ?, 'Ma liste', ?, ?)", a, a, now, now);
    run("INSERT INTO list_items (list_id, position, item_type, item_id, added_at) VALUES (?, 0, 'album', 'x', ?)", a, now);
    run("INSERT INTO battle_votes (user_id, item_type, a_id, b_id, context, created_at) VALUES (?, 'album', 'a', 'b', 'global', ?)", a, now);
    run("INSERT INTO user_quests (user_id, period_key, slot, quest_id, created_at) VALUES (?, 'd:2026-10-09', 0, 'q', ?)", a, now);
    run("INSERT INTO user_boosters (user_id, kind, theme, source, created_at) VALUES (?, 'theme', 'jazz', 'quest', ?)", a, now);
    run("INSERT INTO user_cosmetics (user_id, cosmetic_id, source, created_at) VALUES (?, 'frame:gold', 'level', ?)", a, now);
  }
  run("INSERT INTO friendships (requester_id, addressee_id, status, created_at) VALUES (1, 2, 'accepted', ?)", now);
  run("INSERT INTO taste_matches (user_a, user_b, score, confidence, data, computed_at) VALUES (1, 2, 70, 'high', '{}', ?)", now);
  // Commentaires : celui du compte supprimé (et la réponse qui lui est faite) partent ; une réponse adressée à lui reste.
  run("INSERT INTO comments (id, target_type, target_id, user_id, body, created_at) VALUES (10, 'post', 2, 1, 'Moi', ?)", now);
  run("INSERT INTO comments (id, target_type, target_id, parent_id, user_id, body, created_at) VALUES (11, 'post', 2, 10, 2, 'Réponse', ?)", now);
  run("INSERT INTO comments (id, target_type, target_id, user_id, reply_to_user_id, body, created_at) VALUES (12, 'post', 2, 2, 1, '@parti', ?)", now);
  run("INSERT INTO reports (id, reporter_id, target_type, target_id, target_user_id, reason, created_at, handled_by) VALUES (1, 1, 'user', '2', 1, 'spam', ?, 1)", now);
  run("INSERT INTO moderation_actions (id, admin_id, target_type, target_id, author_id, action, ground, statement, created_at) VALUES (1, 1, 'post', '1', 1, 'hide', 'rules:1', 'Masqué', ?)", now);
  run("INSERT INTO admin_audit (admin_id, action, created_at) VALUES (1, 'grant', ?)", now);
  run("INSERT INTO battle_ratings (category, item_type, item_id, updated_at) VALUES ('global', 'album', 'a', ?)", now);

  run('DELETE FROM users WHERE id = 1');

  const owned = {
    sessions: 'user_id', email_tokens: 'user_id', cards: 'user_id', achievements: 'user_id', pack_openings: 'user_id',
    blindtest_games: 'user_id', ratings: 'user_id', user_album_progress: 'user_id', user_stats_cache: 'user_id',
    user_favorites: 'user_id', posts: 'user_id', comments: 'user_id', likes: 'user_id', notifications: 'user_id',
    activity: 'actor_id', lists: 'user_id', battle_votes: 'user_id', user_quests: 'user_id', user_boosters: 'user_id',
    user_cosmetics: 'user_id',
  };
  for (const [table, column] of Object.entries(owned)) {
    assert.equal(count(db, table, `${column} = 1`), 0, `${table} : lignes du compte supprimé restantes`);
  }
  // L'autre joueur garde ses propres lignes (sauf celles qui le liaient au compte supprimé).
  for (const table of ['sessions', 'cards', 'ratings', 'posts', 'lists', 'user_cosmetics']) assert.equal(count(db, table), 1, table);
  assert.equal(count(db, 'notifications'), 0, 'notification dont le compte supprimé était l’auteur');
  assert.equal(count(db, 'friendships'), 0);
  assert.equal(count(db, 'blocks'), 0);
  assert.equal(count(db, 'taste_matches'), 0);
  assert.equal(count(db, 'list_items', 'list_id = 1'), 0);
  assert.equal(count(db, 'comments', 'id IN (10, 11)'), 0, 'commentaire supprimé avec sa réponse');
  assert.equal(db.prepare('SELECT reply_to_user_id FROM comments WHERE id = 12').get().reply_to_user_id, null);
  assert.deepEqual({ ...db.prepare('SELECT reporter_id, target_user_id, handled_by FROM reports WHERE id = 1').get() },
    { reporter_id: null, target_user_id: null, handled_by: null });
  assert.deepEqual({ ...db.prepare('SELECT admin_id, author_id FROM moderation_actions WHERE id = 1').get() }, { admin_id: null, author_id: null });
  assert.equal(db.prepare('SELECT admin_id FROM admin_audit').get().admin_id, null);
  assert.equal(count(db, 'battle_ratings'), 1, 'classements agrégés et anonymes gardés');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('copie du grand catalogue (FIXTURE) : migrée, même sqlite_master qu’une base neuve', { skip: !process.env.FIXTURE && 'FIXTURE non défini' }, () => {
  const file = tmpFile('fixture.db');
  fs.copyFileSync(process.env.FIXTURE, file);
  const started = performance.now();
  const db = openDb(file);
  const ms = performance.now() - started;
  assert.equal(version(db), 9);
  const fresh = openDb(':memory:');
  assertSameMaster(db, fresh, 'copie migrée / base neuve');
  fresh.close();
  assert.ok(count(db, 'external_ids') > 0);
  assert.equal(count(db, 'cat_tracks', 'rarity_locked = 0'), 0);
  db.close();
  const again = performance.now();
  openDb(file).close();
  const second = performance.now() - again;
  assert.ok(second < 50, `second démarrage en ${second.toFixed(1)} ms (migration : ${ms.toFixed(0)} ms)`);
});
