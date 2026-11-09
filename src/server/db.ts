import { DatabaseSync, type StatementSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type DB = DatabaseSync;

const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    character_limit INTEGER,              -- NULL = use the default from settings
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- DiceCloud documents are stored as JSON, untouched, so import/export is lossless.
  CREATE TABLE libraries (
    id TEXT PRIMARY KEY,
    doc TEXT NOT NULL
  );
  CREATE TABLE library_collections (
    id TEXT PRIMARY KEY,
    doc TEXT NOT NULL
  );
  CREATE TABLE library_nodes (
    id TEXT PRIMARY KEY,
    library_id TEXT NOT NULL,
    lft INTEGER NOT NULL,
    rgt INTEGER NOT NULL,
    fill_slots INTEGER NOT NULL DEFAULT 0,
    removed INTEGER NOT NULL DEFAULT 0,
    doc TEXT NOT NULL
  );
  CREATE INDEX library_nodes_tree ON library_nodes(library_id, lft);
  CREATE INDEX library_nodes_fill ON library_nodes(fill_slots) WHERE fill_slots = 1;

  CREATE TABLE creatures (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc TEXT NOT NULL,
    variables TEXT,                       -- computed scope, for display
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX creatures_owner ON creatures(owner_id);
  CREATE TABLE creature_properties (
    id TEXT PRIMARY KEY,
    creature_id TEXT NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
    removed INTEGER NOT NULL DEFAULT 0,
    doc TEXT NOT NULL
  );
  CREATE INDEX creature_properties_creature ON creature_properties(creature_id, removed);
  CREATE TABLE creature_logs (
    id TEXT PRIMARY KEY,
    creature_id TEXT NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    doc TEXT NOT NULL
  );
  CREATE INDEX creature_logs_creature ON creature_logs(creature_id, created_at);
  CREATE TABLE experiences (
    id TEXT PRIMARY KEY,
    creature_id TEXT NOT NULL REFERENCES creatures(id) ON DELETE CASCADE,
    doc TEXT NOT NULL
  );
  CREATE INDEX experiences_creature ON experiences(creature_id);
  `,
  // 2: character folders (each user's own; only the owner's list uses them)
  `
  CREATE TABLE creature_folders (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    collapsed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX creature_folders_owner ON creature_folders(owner_id);
  ALTER TABLE creatures ADD COLUMN folder_id TEXT REFERENCES creature_folders(id) ON DELETE SET NULL;
  `,
  // 3: the species/race actually chosen (for the character list; not part of exports)
  `
  ALTER TABLE creatures ADD COLUMN species TEXT;
  `,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  const version = (db.prepare('PRAGMA user_version').get() as any).user_version as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
  return db;
}

/** Run fn inside a transaction (nested calls join the outer one). */
let depth = 0;
export function tx<T>(db: DB, fn: () => T): T {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

const cache = new WeakMap<DB, Map<string, StatementSync>>();
/** Cached prepared statement. */
export function q(db: DB, sql: string): StatementSync {
  let m = cache.get(db);
  if (!m) cache.set(db, m = new Map());
  let s = m.get(sql);
  if (!s) m.set(sql, s = db.prepare(sql));
  return s;
}

export const now = () => new Date().toISOString();
