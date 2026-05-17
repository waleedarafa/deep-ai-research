import Database, { type Database as Db } from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";

const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data", "pulse.db");

export function openDb(dbPath: string = DEFAULT_DB_PATH): Db {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pulses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_at  TEXT    NOT NULL,
  date_key      TEXT    NOT NULL UNIQUE,
  item_count    INTEGER NOT NULL,
  cost_usd      REAL,
  duration_ms   INTEGER,
  status        TEXT    NOT NULL DEFAULT 'ok'
);
CREATE INDEX IF NOT EXISTS idx_pulses_date ON pulses(date_key DESC);

CREATE TABLE IF NOT EXISTS pulse_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pulse_id      INTEGER NOT NULL REFERENCES pulses(id) ON DELETE CASCADE,
  rank          INTEGER NOT NULL,
  source        TEXT    NOT NULL,
  priority      TEXT    NOT NULL,
  match_score   INTEGER NOT NULL,
  complexity    TEXT    NOT NULL,
  read_minutes  INTEGER,
  title         TEXT    NOT NULL,
  url           TEXT    NOT NULL,
  outlet        TEXT,
  summary       TEXT    NOT NULL,
  topics        TEXT    NOT NULL,
  body_md       TEXT,
  source_meta   TEXT,
  created_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_pulse ON pulse_items(pulse_id, rank);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_url ON pulse_items(url);

CREATE TABLE IF NOT EXISTS feedback (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES pulse_items(id),
  action        TEXT    NOT NULL,
  created_at    TEXT    NOT NULL,
  meta          TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_action_date ON feedback(action, created_at DESC);

CREATE TABLE IF NOT EXISTS usage (
  date_key      TEXT PRIMARY KEY,
  cost_usd      REAL NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);
`;

export function migrate(db: Db): void {
  db.exec(SCHEMA);
}
