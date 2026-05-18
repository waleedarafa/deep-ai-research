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

export type PulseStatus = "ok" | "partial" | "failed" | "running";
export type ItemSource = "paper" | "news" | "github" | "x";
export type ItemPriority = "high" | "medium" | "low";
export type ItemComplexity = "beginner" | "intermediate" | "advanced";

export interface PulseRow {
  id: number;
  generated_at: string;
  date_key: string;
  item_count: number;
  cost_usd: number | null;
  duration_ms: number | null;
  status: PulseStatus;
}

export interface PulseItemRow {
  id: number;
  pulse_id: number;
  rank: number;
  source: ItemSource;
  priority: ItemPriority;
  match_score: number;
  complexity: ItemComplexity;
  read_minutes: number | null;
  title: string;
  url: string;
  outlet: string | null;
  summary: string;
  topics: string[];
  body_md: string | null;
  source_meta: Record<string, unknown>;
  created_at: string;
}

export interface CreatePulseInput {
  generated_at: string;
  date_key: string;
  item_count: number;
  status: PulseStatus;
  cost_usd?: number;
  duration_ms?: number;
}

export interface InsertItemInput {
  pulse_id: number;
  rank: number;
  source: ItemSource;
  priority: ItemPriority;
  match_score: number;
  complexity: ItemComplexity;
  read_minutes: number | null;
  title: string;
  url: string;
  outlet: string | null;
  summary: string;
  topics: string[];
  body_md?: string | null;
  source_meta: Record<string, unknown>;
  created_at: string;
}

function rowToPulse(row: Record<string, unknown>): PulseRow {
  return row as PulseRow;
}

function rowToItem(row: Record<string, unknown>): PulseItemRow {
  return {
    ...(row as Omit<PulseItemRow, "topics" | "source_meta">),
    topics: JSON.parse((row.topics as string) ?? "[]"),
    source_meta: JSON.parse((row.source_meta as string) ?? "{}"),
  } as PulseItemRow;
}

export function createPulse(db: Db, input: CreatePulseInput): number {
  const stmt = db.prepare(
    `INSERT INTO pulses (generated_at, date_key, item_count, status, cost_usd, duration_ms)
     VALUES (@generated_at, @date_key, @item_count, @status, @cost_usd, @duration_ms)`
  );
  const info = stmt.run({
    generated_at: input.generated_at,
    date_key: input.date_key,
    item_count: input.item_count,
    status: input.status,
    cost_usd: input.cost_usd ?? null,
    duration_ms: input.duration_ms ?? null,
  });
  return Number(info.lastInsertRowid);
}

export function insertPulseItem(db: Db, input: InsertItemInput): number {
  const stmt = db.prepare(
    `INSERT INTO pulse_items
       (pulse_id, rank, source, priority, match_score, complexity, read_minutes,
        title, url, outlet, summary, topics, body_md, source_meta, created_at)
     VALUES
       (@pulse_id, @rank, @source, @priority, @match_score, @complexity, @read_minutes,
        @title, @url, @outlet, @summary, @topics, @body_md, @source_meta, @created_at)`
  );
  const info = stmt.run({
    pulse_id: input.pulse_id,
    rank: input.rank,
    source: input.source,
    priority: input.priority,
    match_score: input.match_score,
    complexity: input.complexity,
    read_minutes: input.read_minutes,
    title: input.title,
    url: input.url,
    outlet: input.outlet,
    summary: input.summary,
    topics: JSON.stringify(input.topics),
    body_md: input.body_md ?? null,
    source_meta: JSON.stringify(input.source_meta),
    created_at: input.created_at,
  });
  return Number(info.lastInsertRowid);
}

export function getLatestPulse(db: Db): PulseRow | null {
  const row = db.prepare("SELECT * FROM pulses ORDER BY date_key DESC LIMIT 1").get();
  return row ? rowToPulse(row as Record<string, unknown>) : null;
}

export function getPulseByDate(db: Db, date_key: string): PulseRow | null {
  const row = db.prepare("SELECT * FROM pulses WHERE date_key = ?").get(date_key);
  return row ? rowToPulse(row as Record<string, unknown>) : null;
}

export function listPulses(db: Db, limit = 30): PulseRow[] {
  const rows = db
    .prepare("SELECT * FROM pulses ORDER BY date_key DESC LIMIT ?")
    .all(limit) as Record<string, unknown>[];
  return rows.map(rowToPulse);
}

export function getPulseItemById(db: Db, item_id: number): PulseItemRow | null {
  const row = db.prepare("SELECT * FROM pulse_items WHERE id = ?").get(item_id);
  return row ? rowToItem(row as Record<string, unknown>) : null;
}

export function setItemBodyMd(db: Db, item_id: number, body_md: string): void {
  db.prepare("UPDATE pulse_items SET body_md = ? WHERE id = ?").run(body_md, item_id);
}

export function getPulseItems(db: Db, pulse_id: number): PulseItemRow[] {
  const rows = db
    .prepare("SELECT * FROM pulse_items WHERE pulse_id = ? ORDER BY rank ASC")
    .all(pulse_id) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

const ALLOWED_PATCH_FIELDS: ReadonlySet<keyof PulseRow> = new Set([
  "status",
  "item_count",
  "cost_usd",
  "duration_ms",
]);

export function updatePulseStatus(
  db: Db,
  id: number,
  patch: { status?: PulseStatus; item_count?: number; cost_usd?: number; duration_ms?: number }
): void {
  const fields = Object.keys(patch).filter((f): f is keyof PulseRow =>
    ALLOWED_PATCH_FIELDS.has(f as keyof PulseRow)
  );
  if (fields.length === 0) return;
  const setClause = fields.map((f) => `${f} = @${f}`).join(", ");
  db.prepare(`UPDATE pulses SET ${setClause} WHERE id = @id`).run({ id, ...patch });
}

export type FeedbackAction = "like" | "dislike" | "bookmark" | "expand" | "dwell";

export interface FeedbackInput {
  item_id: number;
  action: FeedbackAction;
  created_at: string;
  meta?: Record<string, unknown>;
}

export interface RecentFeedbackRow {
  id: number;
  action: FeedbackAction;
  created_at: string;
  meta: Record<string, unknown> | null;
  item: {
    id: number;
    title: string;
    summary: string;
    source: ItemSource;
    url: string;
    topics: string[];
  };
}

export function addFeedback(db: Db, input: FeedbackInput): number {
  const info = db
    .prepare(
      `INSERT INTO feedback (item_id, action, created_at, meta)
       VALUES (@item_id, @action, @created_at, @meta)`
    )
    .run({
      item_id: input.item_id,
      action: input.action,
      created_at: input.created_at,
      meta: input.meta ? JSON.stringify(input.meta) : null,
    });
  return Number(info.lastInsertRowid);
}

export function getRecentFeedback(
  db: Db,
  windowDays: number,
  now: Date = new Date()
): RecentFeedbackRow[] {
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
  const rows = db
    .prepare(
      `SELECT f.id, f.action, f.created_at, f.meta,
              i.id AS i_id, i.title, i.summary, i.source, i.url, i.topics
         FROM feedback f
         JOIN pulse_items i ON i.id = f.item_id
        WHERE f.created_at >= ?
        ORDER BY f.created_at DESC`
    )
    .all(cutoff) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as number,
    action: r.action as FeedbackAction,
    created_at: r.created_at as string,
    meta: r.meta ? JSON.parse(r.meta as string) : null,
    item: {
      id: r.i_id as number,
      title: r.title as string,
      summary: r.summary as string,
      source: r.source as ItemSource,
      url: r.url as string,
      topics: JSON.parse((r.topics as string) ?? "[]"),
    },
  }));
}

export function addUsageCost(db: Db, date_key: string, cost_usd: number, updated_at: string): void {
  db.prepare(
    `INSERT INTO usage (date_key, cost_usd, updated_at)
     VALUES (@date_key, @cost_usd, @updated_at)
     ON CONFLICT(date_key) DO UPDATE SET
       cost_usd = cost_usd + excluded.cost_usd,
       updated_at = excluded.updated_at`
  ).run({ date_key, cost_usd, updated_at });
}

export function getUsageForDate(db: Db, date_key: string): number {
  const row = db.prepare("SELECT cost_usd FROM usage WHERE date_key = ?").get(date_key) as
    | { cost_usd: number }
    | undefined;
  return row?.cost_usd ?? 0;
}
