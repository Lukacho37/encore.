import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SCHEMA = `
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

// Colonnes ajoutées après la première version : ajoutées à la volée sur une base existante.
const MIGRATIONS = [
  ['users', 'rating_scale', "ALTER TABLE users ADD COLUMN rating_scale TEXT NOT NULL DEFAULT 'stars'"],
];

export function openDb(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  for (const [table, column, sql] of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) db.exec(sql);
  }
  return db;
}

/** Exécute `fn` dans une transaction (node:sqlite est synchrone). */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
