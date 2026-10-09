// Base SQLite d'AlbumMania : schéma global de P0 à P3 (PLAN.md section 3), posé une fois pour toutes en P0.
// L'ouverture suit quatre étapes ordonnées :
//   1. SCHEMA  : CREATE TABLE IF NOT EXISTS seulement (anciennes tables, ratings dans sa forme v2, toutes les nouvelles) ;
//   2. COLUMNS : ALTER TABLE … ADD COLUMN idempotents (valeurs par défaut constantes, jamais de CHECK) ;
//   3. STEPS   : étapes ponctuelles de données ou de structure, numérotées ; PRAGMA user_version = step.v après chacune ;
//   4. INDEXES : tous les CREATE [UNIQUE] INDEX IF NOT EXISTS, une fois les colonnes qu'ils utilisent présentes.
// Une base neuve et une base migrée finissent au même user_version avec le même sqlite_master
// (server/test/schema.test.js). Les étapes sont « ajout seulement » : un niveau suivant qui a vraiment besoin
// d'un changement ajoute v10+ par le propriétaire du schéma de ce niveau ; une étape publiée ne se modifie jamais.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/** Notes et critiques v2 : identifiant stable (j'aime, réponses, liens permanents), le triplet reste unique. */
export const RATINGS_V2 = `
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('album','track')),
  item_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
  review TEXT,
  review_at INTEGER,
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  hidden_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, item_type, item_id)
);`;

// Tables d'avant la refonte (même texte qu'avant : une base existante et une base neuve restent identiques).
const BASE_TABLES = `
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

${RATINGS_V2}

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

`;

// Tables ajoutées par la refonte (P0 à P3), créées dès P0 même si un niveau suivant est le premier à s'en servir.
const NEW_TABLES = `
-- ===== Provenance du catalogue et recherche =====
CREATE TABLE IF NOT EXISTS external_ids (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('artist','album','track')),
  entity_id   TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('deezer','spotify','apple','musicbrainz','wikidata','discogs','upc','isrc')),
  source_id   TEXT NOT NULL,
  url         TEXT,
  confidence  REAL NOT NULL DEFAULT 1,
  matched_by  TEXT NOT NULL DEFAULT 'import',
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (entity_type, entity_id, source, source_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS search_docs (
  id         INTEGER PRIMARY KEY,               -- = rowid dans search_fts et search_tri
  kind       TEXT NOT NULL CHECK (kind IN ('album','track','artist','user','list')),
  ref_id     TEXT NOT NULL,                     -- id du catalogue, ou id de membre ou de liste en texte
  folded     TEXT NOT NULL,                     -- nom normalisé (normalize de shared/search.js) pour le reclassement en JS
  weight     REAL NOT NULL DEFAULT 0,           -- popularité a priori, dans [0,1]
  updated_at INTEGER NOT NULL,
  UNIQUE (kind, ref_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  name, context, k, content='', contentless_delete=1,
  tokenize='unicode61 remove_diacritics 2', prefix='2 3'
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_tri USING fts5(
  name, content='', contentless_delete=1,
  tokenize='trigram remove_diacritics 1'
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_tri_vocab USING fts5vocab(search_tri, 'row');

-- ===== Agrégats =====
CREATE TABLE IF NOT EXISTS rating_stats (
  item_type     TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  sum           INTEGER NOT NULL DEFAULT 0,
  review_count  INTEGER NOT NULL DEFAULT 0,
  dist          TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0]',
  last_rated_at INTEGER,
  PRIMARY KEY (item_type, item_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_album_progress (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  album_id   TEXT NOT NULL,
  owned      INTEGER NOT NULL,
  holo       INTEGER NOT NULL DEFAULT 0,
  total      INTEGER NOT NULL,
  first_at   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, album_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_stats_cache (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  data        TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS album_similar (
  album_id    TEXT NOT NULL,
  similar_id  TEXT NOT NULL,
  score       REAL NOT NULL,
  reason      TEXT NOT NULL CHECK (reason IN ('corated','artist','genre_decade')),
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (album_id, similar_id)
) WITHOUT ROWID;

-- ===== Profil et goûts =====
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('artist','track','genre')),
  item_id    TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, item_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS taste_matches (
  user_a      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence  TEXT NOT NULL CHECK (confidence IN ('low','medium','high')),
  data        TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
) WITHOUT ROWID;

-- ===== Social =====
CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 1000),
  item_type     TEXT CHECK (item_type IN ('album','track','artist','list','review')),
  item_id       TEXT,
  visibility    TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','friends')),
  like_count    INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  edited_at     INTEGER,
  hidden_at     INTEGER,
  created_ip    TEXT,
  CHECK ((item_type IS NULL) = (item_id IS NULL)),
  CHECK (length(body) > 0 OR item_type IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS comments (
  id               INTEGER PRIMARY KEY,
  target_type      TEXT NOT NULL CHECK (target_type IN ('post','review','list')),
  target_id        INTEGER NOT NULL,
  parent_id        INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reply_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body             TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  like_count       INTEGER NOT NULL DEFAULT 0,
  reply_count      INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  edited_at        INTEGER,
  deleted_at       INTEGER,
  hidden_at        INTEGER,
  created_ip       TEXT
);

CREATE TABLE IF NOT EXISTS likes (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('post','review','comment','list')),
  target_id   INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  actor_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT,
  target_id   TEXT,
  group_key   TEXT,
  data        TEXT,
  created_at  INTEGER NOT NULL,
  read_at     INTEGER
);

CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verb        TEXT NOT NULL CHECK (verb IN ('post','review','rate','complete','deluxe','master','badge','pull','list','grid','friend','set')),
  object_type TEXT NOT NULL,
  object_id   TEXT NOT NULL,
  item_type   TEXT,
  item_id     TEXT,
  group_key   TEXT,
  data        TEXT,
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','friends','private')),
  engagement  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
) WITHOUT ROWID;

-- ===== Modération, juridique, journal admin =====
CREATE TABLE IF NOT EXISTS reports (
  id             INTEGER PRIMARY KEY,
  reporter_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_email TEXT,
  reporter_name  TEXT,
  target_type    TEXT NOT NULL CHECK (target_type IN ('post','review','comment','list','user','url')),
  target_id      TEXT NOT NULL,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason         TEXT NOT NULL CHECK (reason IN ('illegal_hate','harassment','threat','copyright','personal_data','spam','sexual','other')),
  details        TEXT CHECK (details IS NULL OR length(details) <= 2000),
  good_faith     INTEGER NOT NULL DEFAULT 0,
  snapshot       TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  created_at     INTEGER NOT NULL,
  created_ip     TEXT,
  handled_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  handled_at     INTEGER,
  decision       TEXT
);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id               INTEGER PRIMARY KEY,
  admin_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  report_id        INTEGER REFERENCES reports(id) ON DELETE SET NULL,
  target_type      TEXT NOT NULL,
  target_id        TEXT NOT NULL,
  author_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action           TEXT NOT NULL CHECK (action IN ('hide','restore','delete','warn','suspend','unsuspend','dismiss','cover_block','cover_unblock')),
  ground           TEXT NOT NULL,
  statement        TEXT NOT NULL,
  snapshot         TEXT,
  created_at       INTEGER NOT NULL,
  appealed_at      INTEGER,
  appeal_text      TEXT,
  appeal_decision  TEXT CHECK (appeal_decision IS NULL OR appeal_decision IN ('upheld','reversed')),
  appeal_decided_at INTEGER
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id         INTEGER PRIMARY KEY,
  admin_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  target     TEXT,
  payload    TEXT,
  created_at INTEGER NOT NULL
);

-- ===== Listes (dont Mes 9 albums et les albums recherchés) =====
CREATE TABLE IF NOT EXISTS lists (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'list' CHECK (kind IN ('list','grid9','wishlist')),
  title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  description   TEXT CHECK (description IS NULL OR length(description) <= 1000),
  ranked        INTEGER NOT NULL DEFAULT 0 CHECK (ranked IN (0,1)),
  item_type     TEXT NOT NULL DEFAULT 'album' CHECK (item_type IN ('album','track','mixed')),
  visibility    TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','friends','private')),
  item_count    INTEGER NOT NULL DEFAULT 0,
  like_count    INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  hidden_at     INTEGER
);

CREATE TABLE IF NOT EXISTS list_items (
  list_id   INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL CHECK (position >= 0),
  item_type TEXT NOT NULL CHECK (item_type IN ('album','track')),
  item_id   TEXT NOT NULL,
  note      TEXT CHECK (note IS NULL OR length(note) <= 280),
  added_at  INTEGER NOT NULL,
  PRIMARY KEY (list_id, position),
  UNIQUE (list_id, item_type, item_id)
) WITHOUT ROWID;

-- ===== Battles =====
CREATE TABLE IF NOT EXISTS battle_votes (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type  TEXT NOT NULL CHECK (item_type IN ('album','track')),
  a_id       TEXT NOT NULL,
  b_id       TEXT NOT NULL,
  winner_id  TEXT,
  context    TEXT NOT NULL,
  categories TEXT NOT NULL DEFAULT '[]',
  counted    INTEGER NOT NULL DEFAULT 1 CHECK (counted IN (0,1)),
  event_slug TEXT,
  created_at INTEGER NOT NULL,
  CHECK (a_id < b_id),
  CHECK (winner_id IS NULL OR winner_id = a_id OR winner_id = b_id),
  UNIQUE (user_id, item_type, a_id, b_id)
);

CREATE TABLE IF NOT EXISTS battle_ratings (
  category   TEXT NOT NULL,
  item_type  TEXT NOT NULL CHECK (item_type IN ('album','track')),
  item_id    TEXT NOT NULL,
  rating     REAL NOT NULL DEFAULT 1500,
  votes      INTEGER NOT NULL DEFAULT 0,
  wins       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (category, item_type, item_id)
) WITHOUT ROWID;

-- ===== Quêtes, boosters, cosmétiques, coffrets =====
CREATE TABLE IF NOT EXISTS user_quests (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  slot       INTEGER NOT NULL,
  quest_id   TEXT NOT NULL,
  rerolled   INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  reward     TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, period_key, slot)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS user_boosters (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('theme','album')),
  theme      TEXT NOT NULL,
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  opened_at  INTEGER
);

CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cosmetic_id TEXT NOT NULL,
  source      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, cosmetic_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sets (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('editorial','generated','event')),
  title_fr    TEXT NOT NULL,
  title_en    TEXT NOT NULL,
  rule        TEXT,
  event_slug  TEXT,
  reward      TEXT,
  album_count INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  retired_at  INTEGER
);

CREATE TABLE IF NOT EXISTS set_albums (
  set_id   TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  album_id TEXT NOT NULL REFERENCES cat_albums(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (set_id, album_id)
) WITHOUT ROWID;
`;

export const SCHEMA = BASE_TABLES + NEW_TABLES;

/** Colonnes ajoutées après la première version : [table, colonne, ALTER TABLE …] (les deux premières viennent d'avant). */
export const COLUMNS = [
  ['users', 'rating_scale', "ALTER TABLE users ADD COLUMN rating_scale TEXT NOT NULL DEFAULT 'stars'"],
  ['users', 'signup_secret', 'ALTER TABLE users ADD COLUMN signup_secret TEXT'],
  ['users', 'bio', 'ALTER TABLE users ADD COLUMN bio TEXT'],
  ['users', 'onboarded_at', 'ALTER TABLE users ADD COLUMN onboarded_at INTEGER'],
  ['users', 'terms_accepted_at', 'ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER'],
  ['users', 'terms_version', 'ALTER TABLE users ADD COLUMN terms_version TEXT'],
  ['users', 'profile_visibility', "ALTER TABLE users ADD COLUMN profile_visibility TEXT NOT NULL DEFAULT 'public'"],
  ['users', 'studio', "ALTER TABLE users ADD COLUMN studio TEXT NOT NULL DEFAULT '{}'"],
  ['users', 'cosmetics', "ALTER TABLE users ADD COLUMN cosmetics TEXT NOT NULL DEFAULT '{}'"],
  ['users', 'prefs', "ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}'"],
  ['users', 'suspended_until', 'ALTER TABLE users ADD COLUMN suspended_until INTEGER'],
  ['users', 'suspension_reason', 'ALTER TABLE users ADD COLUMN suspension_reason TEXT'],
  ['users', 'pity', 'ALTER TABLE users ADD COLUMN pity INTEGER NOT NULL DEFAULT 0'],
  ['users', 'unique_cards', 'ALTER TABLE users ADD COLUMN unique_cards INTEGER NOT NULL DEFAULT 0'],
  ['achievements', 'rank', 'ALTER TABLE achievements ADD COLUMN rank INTEGER'],
  ['achievements', 'data', 'ALTER TABLE achievements ADD COLUMN data TEXT'],
  ['cards', 'pulled_rarity', 'ALTER TABLE cards ADD COLUMN pulled_rarity TEXT'],
  ['cat_artists', 'status', "ALTER TABLE cat_artists ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
  ['cat_artists', 'country_source', 'ALTER TABLE cat_artists ADD COLUMN country_source TEXT'],
  ['cat_albums', 'status', "ALTER TABLE cat_albums ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
  ['cat_albums', 'cover_blocked', 'ALTER TABLE cat_albums ADD COLUMN cover_blocked INTEGER NOT NULL DEFAULT 0'],
  ['cat_tracks', 'status', "ALTER TABLE cat_tracks ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"],
  ['cat_tracks', 'rarity_locked', 'ALTER TABLE cat_tracks ADD COLUMN rarity_locked INTEGER NOT NULL DEFAULT 0'],
  ['cat_tracks', 'rarity_edition', 'ALTER TABLE cat_tracks ADD COLUMN rarity_edition INTEGER'],
  ['cat_tracks', 'pop_source', 'ALTER TABLE cat_tracks ADD COLUMN pop_source TEXT'],
];

const DIST = Array.from({ length: 11 }, (_, i) => `SUM(score = ${i})`).join(', ');

/**
 * Étapes ponctuelles, dans l'ordre. Chacune détecte son propre état et ne fait rien sur une base neuve (qui a déjà
 * les formes v2), mais fait quand même monter user_version : le numéro est le même sur une base neuve et migrée.
 * Une étape qui a besoin d'un index le crée elle-même (INDEXES passe après les étapes).
 */
export const STEPS = [
  {
    v: 1, name: 'ratings-surrogate-id', fkOff: true,
    run(db) {
      const cols = db.prepare('PRAGMA table_info(ratings)').all().map((c) => c.name);
      if (cols.includes('id')) return;
      // L'ancienne table est renommée et la nouvelle créée avec le texte exact de RATINGS_V2 : sqlite_master reste
      // identique à celui d'une base neuve. Les index de l'ancienne table partent avec elle (INDEXES les recrée).
      db.exec('ALTER TABLE ratings RENAME TO ratings_v1');
      db.exec(RATINGS_V2);
      db.exec(`INSERT INTO ratings (user_id, item_type, item_id, score, review, review_at, created_at, updated_at)
        SELECT user_id, item_type, item_id, score, review, CASE WHEN review IS NOT NULL THEN updated_at END, created_at, updated_at
        FROM ratings_v1 ORDER BY created_at, user_id`);
      db.exec('DROP TABLE ratings_v1');
    },
  },
  {
    v: 2, name: 'rating-stats-backfill',
    run(db) {
      db.exec(`INSERT OR REPLACE INTO rating_stats (item_type, item_id, count, sum, review_count, dist, last_rated_at)
        SELECT item_type, item_id, COUNT(*), SUM(score), SUM(review IS NOT NULL), json_array(${DIST}), MAX(updated_at)
        FROM ratings GROUP BY item_type, item_id`);
    },
  },
  {
    v: 3, name: 'user-album-progress-backfill',
    run(db) {
      db.exec(`INSERT OR REPLACE INTO user_album_progress (user_id, album_id, owned, holo, total, first_at, updated_at)
        SELECT c.user_id, t.album_id, COUNT(DISTINCT c.track_id),
               COUNT(DISTINCT CASE WHEN c.variant = 'holo' THEN c.track_id END), al.track_count, MIN(c.first_at), MAX(c.first_at)
        FROM cards c JOIN cat_tracks t ON t.id = c.track_id JOIN cat_albums al ON al.id = t.album_id
        GROUP BY c.user_id, t.album_id`);
    },
  },
  {
    v: 4, name: 'unique-cards-counter',
    run(db) {
      db.exec(`UPDATE users SET unique_cards = COALESCE((SELECT COUNT(DISTINCT track_id) FROM cards WHERE cards.user_id = users.id), 0)`);
    },
  },
  {
    v: 5, name: 'achievements-rank',
    run(db) {
      db.exec(`UPDATE achievements SET rank = r.n FROM (
          SELECT user_id, key, ROW_NUMBER() OVER (PARTITION BY key ORDER BY created_at, user_id) AS n
          FROM achievements WHERE key LIKE 'album:%') AS r
        WHERE achievements.user_id = r.user_id AND achievements.key = r.key AND achievements.rank IS NULL`);
    },
  },
  {
    v: 6, name: 'external-ids-from-deezer-columns',
    run(db) {
      db.exec(`INSERT OR IGNORE INTO external_ids (entity_type, entity_id, source, source_id, url, matched_by, fetched_at)
        SELECT 'artist', id, 'deezer', deezer_id, NULL, 'backfill', created_at
        FROM cat_artists WHERE deezer_id IS NOT NULL`);
      db.exec(`INSERT OR IGNORE INTO external_ids (entity_type, entity_id, source, source_id, url, matched_by, fetched_at)
        SELECT 'album', id, 'deezer', deezer_id, NULL, 'backfill', created_at FROM cat_albums WHERE deezer_id IS NOT NULL`);
      db.exec(`INSERT OR IGNORE INTO external_ids (entity_type, entity_id, source, source_id, url, matched_by, fetched_at)
        SELECT 'track', id, 'deezer', deezer_id, NULL, 'backfill', created_at FROM cat_tracks WHERE deezer_id IS NOT NULL`);
      // Albums de la graine : l'identifiant Deezer est dans covers.url (https://www.deezer.com/album/<id>) quand la
      // pochette vient de Deezer.
      const rows = db.prepare("SELECT item_key, url, fetched_at FROM covers WHERE provider = 'deezer' AND url IS NOT NULL").all();
      const ins = db.prepare(`INSERT OR IGNORE INTO external_ids (entity_type, entity_id, source, source_id, url, matched_by, fetched_at)
        VALUES (?, ?, 'deezer', ?, NULL, 'covers', ?)`);
      for (const r of rows) {
        const m = /deezer\.com\/(?:[a-z]{2}\/)?(album|track)\/(\d+)/.exec(r.url);
        if (m) ins.run(r.item_key.startsWith('promo:') ? 'track' : 'album', r.item_key, m[2], r.fetched_at);
      }
    },
  },
  {
    v: 7, name: 'avatar-color-auto',
    run(db) { db.exec("UPDATE users SET avatar_color = 'auto' WHERE avatar_color = '#ff4f7e'"); },
  },
  {
    v: 8, name: 'existing-users-onboarded',
    run(db) { db.exec('UPDATE users SET onboarded_at = created_at WHERE onboarded_at IS NULL'); },
  },
  {
    v: 9, name: 'rarity-freeze',
    run(db) {
      db.exec('UPDATE cat_tracks SET rarity_locked = 1 WHERE rarity_locked = 0');
      db.exec(`UPDATE cards SET pulled_rarity = t.rarity FROM cat_tracks t WHERE t.id = cards.track_id AND cards.pulled_rarity IS NULL`);
    },
  },
];

/** Dernière étape : le user_version d'une base à jour. */
export const SCHEMA_VERSION = STEPS[STEPS.length - 1].v;

// Index du catalogue d'avant la refonte (même texte), puis ceux de la section 3.5.
export const INDEXES = `
CREATE INDEX IF NOT EXISTS cat_albums_artist ON cat_albums(artist_id);
CREATE INDEX IF NOT EXISTS cat_albums_genre ON cat_albums(genre, fans);
CREATE INDEX IF NOT EXISTS cat_albums_year ON cat_albums(year);
CREATE INDEX IF NOT EXISTS cat_albums_fans ON cat_albums(fans);
CREATE INDEX IF NOT EXISTS cat_tracks_album ON cat_tracks(album_id, n);
CREATE INDEX IF NOT EXISTS cat_tracks_artist ON cat_tracks(artist_id);
CREATE INDEX IF NOT EXISTS cat_tracks_rarity ON cat_tracks(rarity);
CREATE INDEX IF NOT EXISTS cat_tracks_pop ON cat_tracks(pop);
CREATE INDEX IF NOT EXISTS cat_tracks_kind ON cat_tracks(kind, n);
CREATE INDEX IF NOT EXISTS import_artists_queue ON import_artists(status, depth, priority, fans);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON email_tokens(user_id, purpose);
CREATE INDEX IF NOT EXISTS tokens_expires ON email_tokens(expires_at);
CREATE INDEX IF NOT EXISTS users_created ON users(created_at);
CREATE INDEX IF NOT EXISTS users_seen ON users(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_friend_addressee ON friendships(addressee_id, status);
CREATE INDEX IF NOT EXISTS friend_requester ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS idx_openings_user ON pack_openings(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_blindtest_user ON blindtest_games(user_id, created_at);
CREATE INDEX IF NOT EXISTS blindtest_finished ON blindtest_games(user_id, finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS cards_track ON cards(track_id);
CREATE INDEX IF NOT EXISTS cards_user_first ON cards(user_id, first_at);
CREATE INDEX IF NOT EXISTS ach_key ON achievements(key, created_at);
CREATE INDEX IF NOT EXISTS ach_user_time ON achievements(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ratings_item ON ratings(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_ratings_recent ON ratings(updated_at);
CREATE INDEX IF NOT EXISTS ratings_user_time ON ratings(user_id, created_at);
CREATE INDEX IF NOT EXISTS ratings_user_updated ON ratings(user_id, updated_at);
CREATE INDEX IF NOT EXISTS ratings_item_time ON ratings(item_type, created_at);
CREATE INDEX IF NOT EXISTS ratings_item_reviews ON ratings(item_type, item_id, updated_at) WHERE review IS NOT NULL AND hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS ratings_user_review ON ratings(user_id, review_at) WHERE review_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS cat_albums_created ON cat_albums(created_at);
CREATE INDEX IF NOT EXISTS cat_albums_title ON cat_albums(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS cat_albums_year_title ON cat_albums(year, title);
CREATE INDEX IF NOT EXISTS cat_artists_country ON cat_artists(country) WHERE country IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ext_source_unique ON external_ids(source, entity_type, source_id) WHERE source <> 'isrc';
CREATE INDEX IF NOT EXISTS ext_isrc ON external_ids(source_id) WHERE source = 'isrc';
CREATE INDEX IF NOT EXISTS search_docs_kind_weight ON search_docs(kind, weight);
CREATE INDEX IF NOT EXISTS rating_stats_top ON rating_stats(item_type, count);
CREATE INDEX IF NOT EXISTS uap_user_recent ON user_album_progress(user_id, updated_at);
CREATE INDEX IF NOT EXISTS album_similar_top ON album_similar(album_id, score);
CREATE INDEX IF NOT EXISTS favorites_item ON user_favorites(kind, item_id);
CREATE INDEX IF NOT EXISTS taste_b ON taste_matches(user_b);
CREATE INDEX IF NOT EXISTS posts_user ON posts(user_id, created_at);
CREATE INDEX IF NOT EXISTS posts_item ON posts(item_type, item_id, created_at) WHERE item_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_recent ON posts(created_at) WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS comments_target ON comments(target_type, target_id, parent_id, created_at);
CREATE INDEX IF NOT EXISTS comments_user ON comments(user_id, created_at);
CREATE INDEX IF NOT EXISTS likes_target ON likes(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS notif_unread ON notifications(user_id, group_key) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS activity_actor ON activity(actor_id, created_at);
CREATE INDEX IF NOT EXISTS activity_recent ON activity(created_at);
CREATE INDEX IF NOT EXISTS activity_object ON activity(object_type, object_id);
CREATE INDEX IF NOT EXISTS activity_item ON activity(item_type, item_id, created_at) WHERE item_type IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS activity_group ON activity(actor_id, group_key) WHERE group_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS blocks_blocked ON blocks(blocked_id);
CREATE INDEX IF NOT EXISTS reports_open ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS reports_target ON reports(target_type, target_id);
CREATE UNIQUE INDEX IF NOT EXISTS reports_once ON reports(reporter_id, target_type, target_id) WHERE reporter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS modact_author ON moderation_actions(author_id, created_at);
CREATE INDEX IF NOT EXISTS modact_target ON moderation_actions(target_type, target_id);
CREATE INDEX IF NOT EXISTS admin_audit_recent ON admin_audit(created_at);
CREATE INDEX IF NOT EXISTS lists_user ON lists(user_id, updated_at);
CREATE INDEX IF NOT EXISTS lists_popular ON lists(like_count) WHERE visibility = 'public' AND hidden_at IS NULL AND kind = 'list';
CREATE UNIQUE INDEX IF NOT EXISTS lists_singleton ON lists(user_id, kind) WHERE kind IN ('grid9','wishlist');
CREATE INDEX IF NOT EXISTS list_items_item ON list_items(item_type, item_id);
CREATE INDEX IF NOT EXISTS battle_votes_user ON battle_votes(user_id, created_at);
CREATE INDEX IF NOT EXISTS battle_votes_pair ON battle_votes(item_type, a_id, b_id);
CREATE INDEX IF NOT EXISTS battle_ratings_rank ON battle_ratings(category, item_type, rating);
CREATE INDEX IF NOT EXISTS user_quests_claimed ON user_quests(user_id, claimed_at) WHERE claimed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_boosters_open ON user_boosters(user_id) WHERE opened_at IS NULL;
CREATE INDEX IF NOT EXISTS set_albums_album ON set_albums(album_id);
-- Colonnes de clé étrangère sans autre index utilisable (ajout à la section 3.5) : sans elles, chaque suppression de
-- compte (purge nocturne des comptes non vérifiés, « Supprimer mon compte ») ou de commentaire, de signalement
-- parcourrait toute la table enfant pour ses ON DELETE CASCADE / SET NULL.
CREATE INDEX IF NOT EXISTS user_boosters_user ON user_boosters(user_id);
CREATE INDEX IF NOT EXISTS notif_actor ON notifications(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS comments_parent ON comments(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS comments_reply_to ON comments(reply_to_user_id) WHERE reply_to_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reports_target_user ON reports(target_user_id) WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reports_handled_by ON reports(handled_by) WHERE handled_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS modact_admin ON moderation_actions(admin_id) WHERE admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS modact_report ON moderation_actions(report_id) WHERE report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS admin_audit_admin ON admin_audit(admin_id) WHERE admin_id IS NOT NULL;
`;

/** ALTER TABLE … ADD COLUMN pour chaque colonne absente (PRAGMA table_info). */
export function addColumns(db, columns = COLUMNS) {
  const known = new Map();
  for (const [table, column, sql] of columns) {
    if (!known.has(table)) known.set(table, new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)));
    if (known.get(table).has(column)) continue;
    db.exec(sql);
    known.get(table).add(column);
  }
}

/** Étapes pas encore appliquées, chacune dans sa transaction ; user_version = step.v après chacune. */
export function runSteps(db, steps = STEPS, { log = null } = {}) {
  for (const step of steps) {
    if (db.prepare('PRAGMA user_version').get().user_version >= step.v) continue;
    const started = Date.now();
    // Les clés étrangères se coupent hors transaction ; leur cohérence est vérifiée avant de les rallumer.
    if (step.fkOff) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      step.run(db);
      db.exec(`PRAGMA user_version = ${step.v}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      if (step.fkOff) {
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        db.exec('PRAGMA foreign_keys = ON');
        if (broken.length) throw new Error(`foreign_key_check en échec après l'étape ${step.name} (${broken.length} lignes)`);
      }
    }
    log?.(`  Base : étape v${step.v} ${step.name} appliquée (${Date.now() - started} ms)`);
  }
}

export function openDb(file = config.dbFile, { log = config.isTest ? null : console.log } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
           PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY; PRAGMA mmap_size = 268435456; PRAGMA cache_size = -32000;`);
  // Base existante (et pas encore à jour) : chaque étape appliquée est annoncée dans le journal du serveur.
  const existing = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  db.exec(SCHEMA);
  addColumns(db, COLUMNS);
  runSteps(db, STEPS, { log: existing ? log : null });
  db.exec(INDEXES);
  db.exec('PRAGMA optimize = 0x10002');
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
