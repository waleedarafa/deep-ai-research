# Daily Pulse v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a proactive morning research-briefing feature on top of the existing `deep-ai-research` Next.js app — scheduled daily generation at 07:00 via macOS launchd, 4 subagent curators (papers, news, GitHub, X), SQLite storage, editorial-card UI, and per-card Ask agent.

**Architecture:** Subagent-per-source pipeline using Claude Agent SDK `Task` tool. Pure-discovery personalization derived each morning from the `feedback` table. Backend ships first against SQLite; UI lands on a known-good data substrate. Ask agent reuses the SDK with a per-item system prompt for streaming SSE.

**Tech Stack:** Next.js 16 (Turbopack) · React 19 · TypeScript · `@anthropic-ai/claude-agent-sdk` 0.1.x · `better-sqlite3` · `exa-js` · Vitest · macOS `launchd`.

**Spec:** `/Users/waleedarafa/projects/deep-ai-research/docs/superpowers/specs/2026-05-17-daily-pulse-design.md` (commit `2eee086`).

**Pre-existing repo state (do NOT touch):** Two TS errors exist in `app/api/agent/query/route.ts` and `components/ProgressTracker.tsx` from the `/research` feature. They are out of scope; `next dev` runs through them.

**Conventions:**
- All paths absolute under `/Users/waleedarafa/projects/deep-ai-research/`.
- All commits land on the current working branch (no new branch unless the executor opts in).
- Every TDD step shows the actual code, not a placeholder.
- TZ assumption: local Mac time for `date_key`, UTC ISO 8601 for `generated_at` / `created_at`.

---

## Task 0: Dev dependencies, Vitest config, npm scripts

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `test/setup.ts`

- [ ] **Step 1: Install runtime + test deps**

```bash
cd /Users/waleedarafa/projects/deep-ai-research
npm install better-sqlite3
npm install -D @types/better-sqlite3 vitest @vitest/coverage-v8 happy-dom
```

Expected: `package.json` updated; `node_modules/better-sqlite3` present.

- [ ] **Step 2: Add Vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "lib/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["lib/pulse/**/*.ts"],
      exclude: ["lib/pulse/**/*.test.ts", "lib/pulse/subagents/**"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 3: Test setup file**

Create `test/setup.ts`:

```typescript
import { afterEach } from "vitest";

afterEach(() => {
  // Each test that opens a DB is responsible for closing it in its own teardown.
});
```

- [ ] **Step 4: Add npm scripts**

In `package.json` `"scripts"` block, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage",
"pulse:generate": "tsx scripts/generate-pulse.ts"
```

- [ ] **Step 5: Verify Vitest runs (no tests yet, exit code 0 = ok with no files matched)**

Run: `npx vitest run --reporter=verbose`
Expected: `No test files found` is OK at this point; just make sure Vitest is wired.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts test/setup.ts
git commit -m "chore: add better-sqlite3 + vitest for Daily Pulse"
```

---

## Task 1: SQLite schema + migrations (`lib/pulse/db.ts`)

**Files:**
- Create: `lib/pulse/db.ts`
- Create: `lib/pulse/db.test.ts`
- Create: `data/.gitkeep`
- Modify: `.gitignore` (add `data/*.db`, `data/preferences.json`, `data/pulse.log`, `data/pulse.err`)

- [ ] **Step 1: Write the failing test for schema creation**

Create `lib/pulse/db.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { unlinkSync, existsSync, mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { openDb, migrate } from "./db";

describe("db schema", () => {
  let dir: string;
  let dbPath: string;

  function freshPath() {
    dir = mkdtempSync(path.join(os.tmpdir(), "pulse-db-"));
    dbPath = path.join(dir, "pulse.db");
    return dbPath;
  }

  afterEach(() => {
    if (dbPath && existsSync(dbPath)) unlinkSync(dbPath);
  });

  it("creates all four tables on first open", () => {
    const db = openDb(freshPath());
    migrate(db);
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["pulses", "pulse_items", "feedback", "usage"]));
    db.close();
  });

  it("is idempotent across migrations", () => {
    const db = openDb(freshPath());
    migrate(db);
    migrate(db); // second call must not throw
    db.close();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run lib/pulse/db.test.ts`
Expected: FAIL — `Cannot find module './db'`.

- [ ] **Step 3: Implement `lib/pulse/db.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run lib/pulse/db.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Update `.gitignore`**

Append to `.gitignore`:

```
data/*.db
data/*.db-journal
data/*.db-wal
data/*.db-shm
data/preferences.json
data/pulse.log
data/pulse.err
```

- [ ] **Step 6: Track the data directory**

```bash
mkdir -p /Users/waleedarafa/projects/deep-ai-research/data
touch /Users/waleedarafa/projects/deep-ai-research/data/.gitkeep
```

- [ ] **Step 7: Commit**

```bash
git add lib/pulse/db.ts lib/pulse/db.test.ts data/.gitkeep .gitignore
git commit -m "feat(pulse): add SQLite schema + migrations"
```

---

## Task 2: Pulses & items CRUD (`lib/pulse/db.ts` continued)

**Files:**
- Modify: `lib/pulse/db.ts`
- Modify: `lib/pulse/db.test.ts`

- [ ] **Step 1: Write failing tests for pulse + item helpers**

Append to `lib/pulse/db.test.ts`:

```typescript
import {
  createPulse,
  insertPulseItem,
  getLatestPulse,
  getPulseByDate,
  listPulses,
  getPulseItems,
} from "./db";

describe("pulse + item CRUD", () => {
  let dir: string;
  let dbPath: string;

  function freshDb() {
    dir = mkdtempSync(path.join(os.tmpdir(), "pulse-crud-"));
    dbPath = path.join(dir, "pulse.db");
    const db = openDb(dbPath);
    migrate(db);
    return db;
  }

  it("inserts a pulse and retrieves it", () => {
    const db = freshDb();
    const id = createPulse(db, {
      generated_at: "2026-05-18T07:00:00Z",
      date_key: "2026-05-18",
      item_count: 0,
      status: "running",
    });
    expect(id).toBeGreaterThan(0);
    const fetched = getPulseByDate(db, "2026-05-18");
    expect(fetched?.id).toBe(id);
    expect(fetched?.status).toBe("running");
    db.close();
  });

  it("rejects duplicate date_key", () => {
    const db = freshDb();
    createPulse(db, {
      generated_at: "2026-05-18T07:00:00Z",
      date_key: "2026-05-18",
      item_count: 0,
      status: "ok",
    });
    expect(() =>
      createPulse(db, {
        generated_at: "2026-05-18T07:01:00Z",
        date_key: "2026-05-18",
        item_count: 0,
        status: "ok",
      })
    ).toThrow();
    db.close();
  });

  it("inserts items and lists by pulse_id ordered by rank", () => {
    const db = freshDb();
    const pid = createPulse(db, {
      generated_at: "2026-05-18T07:00:00Z",
      date_key: "2026-05-18",
      item_count: 2,
      status: "ok",
    });
    insertPulseItem(db, {
      pulse_id: pid,
      rank: 2,
      source: "paper",
      priority: "medium",
      match_score: 3,
      complexity: "intermediate",
      read_minutes: 8,
      title: "B paper",
      url: "https://arxiv.org/abs/2511.0002",
      outlet: "arXiv",
      summary: "summary B",
      topics: ["moe"],
      source_meta: { authors: ["A"] },
      created_at: "2026-05-18T07:00:01Z",
    });
    insertPulseItem(db, {
      pulse_id: pid,
      rank: 1,
      source: "paper",
      priority: "high",
      match_score: 5,
      complexity: "advanced",
      read_minutes: 12,
      title: "A paper",
      url: "https://arxiv.org/abs/2511.0001",
      outlet: "arXiv",
      summary: "summary A",
      topics: ["scaling"],
      source_meta: { authors: ["B"] },
      created_at: "2026-05-18T07:00:01Z",
    });
    const items = getPulseItems(db, pid);
    expect(items.map((i) => i.rank)).toEqual([1, 2]);
    expect(items[0].topics).toEqual(["scaling"]);
    db.close();
  });

  it("dedupes by url across pulses", () => {
    const db = freshDb();
    const p1 = createPulse(db, {
      generated_at: "2026-05-17T07:00:00Z",
      date_key: "2026-05-17",
      item_count: 0,
      status: "ok",
    });
    insertPulseItem(db, {
      pulse_id: p1,
      rank: 1,
      source: "paper",
      priority: "high",
      match_score: 5,
      complexity: "advanced",
      read_minutes: 12,
      title: "dup",
      url: "https://arxiv.org/abs/dup",
      outlet: "arXiv",
      summary: "x",
      topics: [],
      source_meta: {},
      created_at: "2026-05-17T07:00:01Z",
    });
    const p2 = createPulse(db, {
      generated_at: "2026-05-18T07:00:00Z",
      date_key: "2026-05-18",
      item_count: 0,
      status: "ok",
    });
    expect(() =>
      insertPulseItem(db, {
        pulse_id: p2,
        rank: 1,
        source: "paper",
        priority: "high",
        match_score: 5,
        complexity: "advanced",
        read_minutes: 12,
        title: "dup again",
        url: "https://arxiv.org/abs/dup",
        outlet: "arXiv",
        summary: "x",
        topics: [],
        source_meta: {},
        created_at: "2026-05-18T07:00:01Z",
      })
    ).toThrow();
    db.close();
  });

  it("getLatestPulse returns the newest by date_key", () => {
    const db = freshDb();
    createPulse(db, {
      generated_at: "2026-05-16T07:00:00Z",
      date_key: "2026-05-16",
      item_count: 0,
      status: "ok",
    });
    createPulse(db, {
      generated_at: "2026-05-18T07:00:00Z",
      date_key: "2026-05-18",
      item_count: 0,
      status: "ok",
    });
    createPulse(db, {
      generated_at: "2026-05-17T07:00:00Z",
      date_key: "2026-05-17",
      item_count: 0,
      status: "ok",
    });
    expect(getLatestPulse(db)?.date_key).toBe("2026-05-18");
    db.close();
  });

  it("listPulses returns newest first", () => {
    const db = freshDb();
    for (const d of ["2026-05-16", "2026-05-18", "2026-05-17"]) {
      createPulse(db, {
        generated_at: `${d}T07:00:00Z`,
        date_key: d,
        item_count: 0,
        status: "ok",
      });
    }
    expect(listPulses(db).map((p) => p.date_key)).toEqual([
      "2026-05-18",
      "2026-05-17",
      "2026-05-16",
    ]);
    db.close();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run lib/pulse/db.test.ts`
Expected: 6 new tests fail with missing exports.

- [ ] **Step 3: Implement CRUD in `lib/pulse/db.ts`**

Append to `lib/pulse/db.ts`:

```typescript
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

export function getPulseItems(db: Db, pulse_id: number): PulseItemRow[] {
  const rows = db
    .prepare("SELECT * FROM pulse_items WHERE pulse_id = ? ORDER BY rank ASC")
    .all(pulse_id) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

export function updatePulseStatus(
  db: Db,
  id: number,
  patch: { status?: PulseStatus; item_count?: number; cost_usd?: number; duration_ms?: number }
): void {
  const fields = Object.keys(patch);
  if (fields.length === 0) return;
  const setClause = fields.map((f) => `${f} = @${f}`).join(", ");
  db.prepare(`UPDATE pulses SET ${setClause} WHERE id = @id`).run({ id, ...patch });
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run lib/pulse/db.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/pulse/db.ts lib/pulse/db.test.ts
git commit -m "feat(pulse): pulses + items CRUD helpers"
```

---

## Task 3: Feedback CRUD + recent-feedback aggregation

**Files:**
- Modify: `lib/pulse/db.ts`
- Modify: `lib/pulse/db.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `lib/pulse/db.test.ts`:

```typescript
import { addFeedback, getRecentFeedback } from "./db";

describe("feedback", () => {
  function bootstrap() {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pulse-fb-"));
    const db = openDb(path.join(dir, "pulse.db"));
    migrate(db);
    const pid = createPulse(db, {
      generated_at: "2026-05-18T07:00:00Z",
      date_key: "2026-05-18",
      item_count: 0,
      status: "ok",
    });
    const iid = insertPulseItem(db, {
      pulse_id: pid,
      rank: 1,
      source: "paper",
      priority: "high",
      match_score: 5,
      complexity: "advanced",
      read_minutes: 8,
      title: "Item",
      url: "https://example.com/1",
      outlet: "arXiv",
      summary: "...",
      topics: ["moe"],
      source_meta: {},
      created_at: "2026-05-18T07:00:01Z",
    });
    return { db, iid };
  }

  it("inserts a feedback row", () => {
    const { db, iid } = bootstrap();
    const id = addFeedback(db, { item_id: iid, action: "like", created_at: "2026-05-18T08:00:00Z" });
    expect(id).toBeGreaterThan(0);
    db.close();
  });

  it("getRecentFeedback returns rows within window joined with items", () => {
    const { db, iid } = bootstrap();
    addFeedback(db, { item_id: iid, action: "like", created_at: "2026-05-18T08:00:00Z" });
    addFeedback(db, { item_id: iid, action: "dislike", created_at: "2026-04-01T08:00:00Z" });
    const rows = getRecentFeedback(db, 30, new Date("2026-05-18T09:00:00Z"));
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("like");
    expect(rows[0].item.title).toBe("Item");
    db.close();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run lib/pulse/db.test.ts`
Expected: 2 new tests fail with missing exports.

- [ ] **Step 3: Implement feedback helpers**

Append to `lib/pulse/db.ts`:

```typescript
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
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run lib/pulse/db.test.ts`
Expected: 10 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/pulse/db.ts lib/pulse/db.test.ts
git commit -m "feat(pulse): feedback CRUD with windowed retrieval"
```

---

## Task 4: Usage tracking helpers

**Files:**
- Modify: `lib/pulse/db.ts`
- Modify: `lib/pulse/db.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `lib/pulse/db.test.ts`:

```typescript
import { addUsageCost, getUsageForDate } from "./db";

describe("usage", () => {
  it("upserts cost for a date and returns the running total", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pulse-usage-"));
    const db = openDb(path.join(dir, "pulse.db"));
    migrate(db);
    addUsageCost(db, "2026-05-18", 0.04, "2026-05-18T07:00:01Z");
    addUsageCost(db, "2026-05-18", 0.06, "2026-05-18T07:01:00Z");
    addUsageCost(db, "2026-05-19", 0.02, "2026-05-19T07:00:00Z");
    expect(getUsageForDate(db, "2026-05-18")).toBeCloseTo(0.1, 6);
    expect(getUsageForDate(db, "2026-05-19")).toBeCloseTo(0.02, 6);
    expect(getUsageForDate(db, "2026-05-17")).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run lib/pulse/db.test.ts`
Expected: 1 new test fails with missing exports.

- [ ] **Step 3: Implement**

Append to `lib/pulse/db.ts`:

```typescript
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
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run lib/pulse/db.test.ts`
Expected: 11 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/pulse/db.ts lib/pulse/db.test.ts
git commit -m "feat(pulse): per-day usage cost tracking"
```

---

## Task 5: Preferences derivation (`lib/pulse/preferences.ts`)

**Files:**
- Create: `lib/pulse/preferences.ts`
- Create: `lib/pulse/preferences.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/pulse/preferences.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { openDb, migrate, createPulse, insertPulseItem, addFeedback } from "./db";
import { buildPreferences, writePreferencesFile, type Preferences } from "./preferences";

function bootstrapDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pulse-prefs-"));
  const dbPath = path.join(dir, "pulse.db");
  const db = openDb(dbPath);
  migrate(db);
  const pid = createPulse(db, {
    generated_at: "2026-05-18T07:00:00Z",
    date_key: "2026-05-18",
    item_count: 0,
    status: "ok",
  });
  return { db, pid, dir };
}

describe("buildPreferences", () => {
  it("returns cold-start when liked < 5", () => {
    const { db } = bootstrapDb();
    const prefs = buildPreferences(db, {
      now: new Date("2026-05-18T07:00:00Z"),
      llmTopicExtractor: vi.fn(),
    });
    expect(prefs.counts.liked).toBe(0);
    expect(prefs.source_weights).toEqual({ paper: 0.4, news: 0.3, github: 0.2, x: 0.1 });
    expect(prefs.topic_signals.loved).toEqual([]);
    expect(prefs.topic_signals.avoided).toEqual([]);
  });

  it("derives source_weights from likes minus dislikes per source", () => {
    const { db, pid } = bootstrapDb();
    const items = [
      { url: "u1", source: "paper" as const },
      { url: "u2", source: "paper" as const },
      { url: "u3", source: "news" as const },
      { url: "u4", source: "news" as const },
      { url: "u5", source: "github" as const },
    ];
    const ids = items.map((it, idx) =>
      insertPulseItem(db, {
        pulse_id: pid,
        rank: idx + 1,
        source: it.source,
        priority: "high",
        match_score: 5,
        complexity: "intermediate",
        read_minutes: 5,
        title: `t${idx}`,
        url: `https://x/${it.url}`,
        outlet: "x",
        summary: `s${idx}`,
        topics: ["moe"],
        source_meta: {},
        created_at: "2026-05-18T07:00:01Z",
      })
    );
    // 5 likes on paper, 0 on others -> paper dominates
    for (const id of ids.slice(0, 2))
      addFeedback(db, { item_id: id, action: "like", created_at: "2026-05-18T08:00:00Z" });
    addFeedback(db, { item_id: ids[2], action: "like", created_at: "2026-05-18T08:00:00Z" });
    addFeedback(db, { item_id: ids[3], action: "dislike", created_at: "2026-05-18T08:00:00Z" });
    addFeedback(db, { item_id: ids[4], action: "like", created_at: "2026-05-18T08:00:00Z" });
    // Force out of cold start with 2 more likes
    for (const id of ids.slice(0, 2))
      addFeedback(db, { item_id: id, action: "like", created_at: "2026-05-18T08:01:00Z" });

    const prefs = buildPreferences(db, {
      now: new Date("2026-05-18T09:00:00Z"),
      llmTopicExtractor: vi.fn().mockResolvedValue({ loved: ["moe"], avoided: [] }),
    });
    expect(prefs.counts.liked).toBeGreaterThanOrEqual(5);
    expect(prefs.source_weights.paper).toBeGreaterThan(prefs.source_weights.news);
  });

  it("writePreferencesFile produces a readable JSON file", async () => {
    const { db, dir } = bootstrapDb();
    const out = path.join(dir, "preferences.json");
    const prefs: Preferences = buildPreferences(db, {
      now: new Date(),
      llmTopicExtractor: vi.fn(),
    });
    writePreferencesFile(out, prefs);
    expect(existsSync(out)).toBe(true);
    const parsed = JSON.parse(readFileSync(out, "utf8"));
    expect(parsed.counts.liked).toBe(0);
    unlinkSync(out);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run lib/pulse/preferences.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `lib/pulse/preferences.ts`**

```typescript
import type { Database as Db } from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { getRecentFeedback, type ItemSource, type RecentFeedbackRow } from "./db";

export interface PreferenceSample {
  title: string;
  summary: string;
  source: ItemSource;
}

export interface Preferences {
  generated_at: string;
  window_days: number;
  samples: {
    liked: PreferenceSample[];
    disliked: PreferenceSample[];
    bookmarked: PreferenceSample[];
    expanded_but_no_signal: PreferenceSample[];
  };
  counts: {
    liked: number;
    disliked: number;
    bookmarked: number;
  };
  source_weights: Record<ItemSource, number>;
  topic_signals: {
    loved: string[];
    avoided: string[];
  };
  cold_start: boolean;
}

export interface BuildOptions {
  now: Date;
  windowDays?: number;
  llmTopicExtractor?: (samples: {
    liked: PreferenceSample[];
    disliked: PreferenceSample[];
  }) => Promise<{ loved: string[]; avoided: string[] }> | { loved: string[]; avoided: string[] };
  maxSamplesPerBucket?: number;
}

const DEFAULT_WEIGHTS: Record<ItemSource, number> = {
  paper: 0.4,
  news: 0.3,
  github: 0.2,
  x: 0.1,
};

function rowToSample(r: RecentFeedbackRow): PreferenceSample {
  return { title: r.item.title, summary: r.item.summary, source: r.item.source };
}

function computeSourceWeights(rows: RecentFeedbackRow[]): Record<ItemSource, number> {
  const tally: Record<ItemSource, { likes: number; dislikes: number; shown: number }> = {
    paper: { likes: 0, dislikes: 0, shown: 0 },
    news: { likes: 0, dislikes: 0, shown: 0 },
    github: { likes: 0, dislikes: 0, shown: 0 },
    x: { likes: 0, dislikes: 0, shown: 0 },
  };
  for (const r of rows) {
    tally[r.item.source].shown += 1;
    if (r.action === "like") tally[r.item.source].likes += 1;
    if (r.action === "dislike") tally[r.item.source].dislikes += 1;
  }
  const raw: Record<ItemSource, number> = {
    paper: (tally.paper.likes - tally.paper.dislikes) / Math.max(tally.paper.shown, 1),
    news: (tally.news.likes - tally.news.dislikes) / Math.max(tally.news.shown, 1),
    github: (tally.github.likes - tally.github.dislikes) / Math.max(tally.github.shown, 1),
    x: (tally.x.likes - tally.x.dislikes) / Math.max(tally.x.shown, 1),
  };
  const offset = Math.min(0, raw.paper, raw.news, raw.github, raw.x);
  const shifted = {
    paper: raw.paper - offset + 0.05,
    news: raw.news - offset + 0.05,
    github: raw.github - offset + 0.05,
    x: raw.x - offset + 0.05,
  };
  const total = shifted.paper + shifted.news + shifted.github + shifted.x;
  return {
    paper: shifted.paper / total,
    news: shifted.news / total,
    github: shifted.github / total,
    x: shifted.x / total,
  };
}

export function buildPreferences(db: Db, opts: BuildOptions): Preferences {
  const windowDays = opts.windowDays ?? 30;
  const cap = opts.maxSamplesPerBucket ?? 30;
  const rows = getRecentFeedback(db, windowDays, opts.now);

  const liked = rows.filter((r) => r.action === "like").slice(0, cap).map(rowToSample);
  const disliked = rows.filter((r) => r.action === "dislike").slice(0, cap).map(rowToSample);
  const bookmarked = rows.filter((r) => r.action === "bookmark").slice(0, cap).map(rowToSample);
  const expandedNoSignal = rows
    .filter(
      (r) =>
        r.action === "expand" &&
        !rows.some(
          (other) =>
            other.item.id === r.item.id && (other.action === "like" || other.action === "dislike")
        )
    )
    .slice(0, cap)
    .map(rowToSample);

  const cold_start = liked.length < 5;
  const source_weights = cold_start ? DEFAULT_WEIGHTS : computeSourceWeights(rows);

  return {
    generated_at: opts.now.toISOString(),
    window_days: windowDays,
    samples: { liked, disliked, bookmarked, expanded_but_no_signal: expandedNoSignal },
    counts: { liked: liked.length, disliked: disliked.length, bookmarked: bookmarked.length },
    source_weights,
    topic_signals: { loved: [], avoided: [] },
    cold_start,
  };
}

export function writePreferencesFile(filePath: string, prefs: Preferences): void {
  writeFileSync(filePath, JSON.stringify(prefs, null, 2), "utf8");
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run lib/pulse/preferences.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/pulse/preferences.ts lib/pulse/preferences.test.ts
git commit -m "feat(pulse): derive preferences from feedback rows"
```

**Note:** The async `llmTopicExtractor` is wired through `BuildOptions` but called by the orchestrator (Task 14), not here — this module stays synchronous and easily testable.

---

## Task 6: GitHub trending tool (`lib/pulse/tools/github-trending.ts`)

**Files:**
- Create: `lib/pulse/tools/github-trending.ts`
- Create: `lib/pulse/tools/github-trending.test.ts`

- [ ] **Step 1: Write failing test (mocked fetch)**

Create `lib/pulse/tools/github-trending.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchTrendingAIRepos } from "./github-trending";

describe("github trending", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the search API with topic + date filters and maps results", async () => {
    const fakeJson = {
      total_count: 2,
      items: [
        {
          full_name: "acme/llm-tool",
          html_url: "https://github.com/acme/llm-tool",
          description: "a thing",
          stargazers_count: 412,
          language: "Python",
          created_at: "2026-05-17T20:00:00Z",
        },
        {
          full_name: "beta/agents",
          html_url: "https://github.com/beta/agents",
          description: null,
          stargazers_count: 88,
          language: "TypeScript",
          created_at: "2026-05-17T22:00:00Z",
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeJson,
      headers: new Headers(),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const repos = await fetchTrendingAIRepos({
      since: new Date("2026-05-17T00:00:00Z"),
      limit: 15,
    });
    expect(repos.length).toBe(2);
    expect(repos[0]).toMatchObject({
      title: "acme/llm-tool",
      url: "https://github.com/acme/llm-tool",
      summary: "a thing",
      stars: 412,
      language: "Python",
    });
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("created:%3E2026-05-17");
    expect(calledUrl).toContain("topic:llm");
  });

  it("throws on non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: "rate-limited" })
    );
    await expect(
      fetchTrendingAIRepos({ since: new Date("2026-05-17T00:00:00Z"), limit: 10 })
    ).rejects.toThrow(/403/);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run lib/pulse/tools/github-trending.test.ts`
Expected: FAIL — missing module.

- [ ] **Step 3: Implement**

Create `lib/pulse/tools/github-trending.ts`:

```typescript
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export interface TrendingRepo {
  title: string;
  url: string;
  summary: string;
  stars: number;
  language: string | null;
  created_at: string;
}

export interface FetchOptions {
  since: Date;
  limit: number;
}

const TOPICS = ["llm", "ai", "agents", "ml", "rag"];

function buildSearchUrl(opts: FetchOptions): string {
  const dateStr = opts.since.toISOString().slice(0, 10);
  const topicQuery = TOPICS.map((t) => `topic:${t}`).join("+OR+");
  const q = encodeURI(`created:>${dateStr} ${topicQuery}`).replace(/%20/g, "+");
  return `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${opts.limit}`;
}

export async function fetchTrendingAIRepos(opts: FetchOptions): Promise<TrendingRepo[]> {
  const url = buildSearchUrl(opts);
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "deep-ai-research-pulse" },
  });
  if (!res.ok) {
    throw new Error(`GitHub search failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { items?: Array<Record<string, unknown>> };
  const items = json.items ?? [];
  return items.map((it) => ({
    title: String(it.full_name),
    url: String(it.html_url),
    summary: (it.description as string | null) ?? "",
    stars: Number(it.stargazers_count ?? 0),
    language: (it.language as string | null) ?? null,
    created_at: String(it.created_at),
  }));
}

export const githubTrendingTools = createSdkMcpServer({
  name: "github-trending",
  version: "1.0.0",
  tools: [
    tool(
      "list_trending",
      "List public GitHub repositories created in the last day that match AI/ML/agents/RAG topics, sorted by stars.",
      {
        since_hours: z
          .number()
          .min(1)
          .max(168)
          .default(36)
          .describe("Created within the last N hours."),
        limit: z.number().min(1).max(20).default(15).describe("Max number of repos."),
      },
      async (args) => {
        const since = new Date(Date.now() - args.since_hours * 3_600_000);
        const repos = await fetchTrendingAIRepos({ since, limit: args.limit });
        return {
          content: [
            { type: "text", text: JSON.stringify(repos, null, 2) },
          ],
        };
      }
    ),
  ],
});
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run lib/pulse/tools/github-trending.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/pulse/tools/github-trending.ts lib/pulse/tools/github-trending.test.ts
git commit -m "feat(pulse): github trending MCP tool"
```

---

## Task 7: X trending tool with graceful skip

**Files:**
- Create: `lib/pulse/tools/x-trending.ts`
- Create: `lib/pulse/tools/x-trending.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/pulse/tools/x-trending.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchRecentTweets, isXAvailable, CURATED_X_ACCOUNTS } from "./x-trending";

describe("x trending", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("isXAvailable returns false without token", () => {
    vi.stubEnv("X_BEARER_TOKEN", "");
    expect(isXAvailable()).toBe(false);
  });

  it("isXAvailable returns true with token", () => {
    vi.stubEnv("X_BEARER_TOKEN", "AAAA");
    expect(isXAvailable()).toBe(true);
  });

  it("fetchRecentTweets returns [] when no token (graceful skip)", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "");
    expect(await fetchRecentTweets({ sinceHours: 24, limit: 5 })).toEqual([]);
  });

  it("queries with curated account list and maps results", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "AAAA");
    const fakeJson = {
      data: [
        {
          id: "1",
          text: "important paper",
          author_id: "u1",
          public_metrics: { reply_count: 12, like_count: 240, retweet_count: 35, quote_count: 4 },
        },
      ],
      includes: { users: [{ id: "u1", username: "elvis", name: "Elvis" }] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => fakeJson } as unknown as Response)
    );
    const tweets = await fetchRecentTweets({ sinceHours: 24, limit: 5 });
    expect(tweets[0]).toMatchObject({ author: "elvis", url: "https://x.com/elvis/status/1" });
    expect(CURATED_X_ACCOUNTS.length).toBeGreaterThan(5);
  });

  it("returns [] on non-ok response (does not crash the pipeline)", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "AAAA");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response));
    expect(await fetchRecentTweets({ sinceHours: 24, limit: 5 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run lib/pulse/tools/x-trending.test.ts`
Expected: FAIL — missing module.

- [ ] **Step 3: Implement**

Create `lib/pulse/tools/x-trending.ts`:

```typescript
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export interface TrendingTweet {
  title: string;
  url: string;
  summary: string;
  author: string;
  metrics: {
    reply_count: number;
    like_count: number;
    retweet_count: number;
    quote_count: number;
  };
  tweet_id: string;
}

export const CURATED_X_ACCOUNTS: readonly string[] = [
  "AnthropicAI",
  "OpenAI",
  "GoogleDeepMind",
  "elvis_omarsar",
  "omarsar0",
  "karpathy",
  "ylecun",
  "simonw",
  "swyx",
  "_philschmid",
  "lateinteraction",
  "hwchase17",
  "_jasonwei",
  "lmsysorg",
  "AIatMeta",
  "huggingface",
  "alphasignalai",
  "rasbt",
  "jeremyphoward",
  "togethercompute",
];

export function isXAvailable(): boolean {
  return Boolean(process.env.X_BEARER_TOKEN && process.env.X_BEARER_TOKEN.trim());
}

export interface FetchTweetOptions {
  sinceHours: number;
  limit: number;
}

export async function fetchRecentTweets(opts: FetchTweetOptions): Promise<TrendingTweet[]> {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) return [];

  const from = CURATED_X_ACCOUNTS.map((u) => `from:${u}`).join(" OR ");
  const start = new Date(Date.now() - opts.sinceHours * 3_600_000).toISOString();
  const params = new URLSearchParams({
    query: `(${from}) -is:retweet lang:en`,
    max_results: String(Math.min(100, Math.max(10, opts.limit * 4))),
    start_time: start,
    "tweet.fields": "public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username,name",
  });
  const url = `https://api.x.com/2/tweets/search/recent?${params.toString()}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        text: string;
        author_id: string;
        public_metrics: TrendingTweet["metrics"];
      }>;
      includes?: { users?: Array<{ id: string; username: string; name: string }> };
    };
    const users = new Map((json.includes?.users ?? []).map((u) => [u.id, u]));
    const items = (json.data ?? []).map((t) => {
      const u = users.get(t.author_id);
      const username = u?.username ?? "unknown";
      return {
        title: t.text.split(/\s+/).slice(0, 14).join(" "),
        url: `https://x.com/${username}/status/${t.id}`,
        summary: t.text,
        author: username,
        metrics: t.public_metrics,
        tweet_id: t.id,
      } satisfies TrendingTweet;
    });
    const score = (m: TrendingTweet["metrics"]) =>
      m.like_count + m.retweet_count * 2 + m.reply_count * 1.5 + m.quote_count;
    return items.sort((a, b) => score(b.metrics) - score(a.metrics)).slice(0, opts.limit);
  } catch {
    return [];
  }
}

export const xTrendingTools = createSdkMcpServer({
  name: "x-trending",
  version: "1.0.0",
  tools: [
    tool(
      "list_recent_tweets",
      "Fetch high-signal tweets from a curated AI/ML account list in the last N hours. Returns [] when X_BEARER_TOKEN is unset.",
      {
        since_hours: z.number().min(1).max(72).default(24),
        limit: z.number().min(1).max(20).default(5),
      },
      async (args) => {
        const tweets = await fetchRecentTweets({
          sinceHours: args.since_hours,
          limit: args.limit,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(tweets, null, 2) }],
        };
      }
    ),
  ],
});
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run lib/pulse/tools/x-trending.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/pulse/tools/x-trending.ts lib/pulse/tools/x-trending.test.ts
git commit -m "feat(pulse): x trending MCP tool with graceful skip"
```

---

## Task 8: Subagent definitions

**Files:**
- Create: `lib/pulse/subagents/paper-curator.ts`
- Create: `lib/pulse/subagents/news-curator.ts`
- Create: `lib/pulse/subagents/gh-curator.ts`
- Create: `lib/pulse/subagents/x-curator.ts`
- Create: `lib/pulse/subagents/index.ts`
- Create: `lib/pulse/subagents/index.test.ts`

- [ ] **Step 1: Write failing test for shape**

Create `lib/pulse/subagents/index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { pulseSubagents } from "./index";

describe("pulseSubagents shape", () => {
  it("registers exactly 4 curators with required fields", () => {
    const names = Object.keys(pulseSubagents);
    expect(names.sort()).toEqual(["gh-curator", "news-curator", "paper-curator", "x-curator"]);
    for (const def of Object.values(pulseSubagents)) {
      expect(def.description.length).toBeGreaterThan(40);
      expect(def.prompt.length).toBeGreaterThan(100);
      expect(def.tools.length).toBeGreaterThan(0);
      expect(def.model).toBeTruthy();
    }
  });

  it("requires Exa tools on paper-curator and news-curator", () => {
    expect(pulseSubagents["paper-curator"].tools).toEqual(
      expect.arrayContaining(["mcp__exa-search__search", "mcp__exa-search__get_contents"])
    );
    expect(pulseSubagents["news-curator"].tools).toEqual(
      expect.arrayContaining(["mcp__exa-search__search", "mcp__exa-search__get_contents"])
    );
  });

  it("gh-curator uses github-trending tool", () => {
    expect(pulseSubagents["gh-curator"].tools).toEqual(
      expect.arrayContaining(["mcp__github-trending__list_trending"])
    );
  });

  it("x-curator uses x-trending tool", () => {
    expect(pulseSubagents["x-curator"].tools).toEqual(
      expect.arrayContaining(["mcp__x-trending__list_recent_tweets"])
    );
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run lib/pulse/subagents/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the four curator files**

Create `lib/pulse/subagents/paper-curator.ts`:

```typescript
import type { AgentDefinition } from "../../types/agent";

export const paperCurator: AgentDefinition = {
  description:
    "Finds recent AI/ML research papers from arXiv using Exa neural search. Returns structured JSON.",
  prompt: `You are the paper-curator subagent for the Daily Pulse pipeline.

**Goal:** Return 10-15 AI/ML papers published in the last 24 hours.

**Tools:**
- mcp__exa-search__search: neural search with start_published_date filter
- mcp__exa-search__get_contents: pull abstracts when needed

**Procedure:**
1. Call mcp__exa-search__search with:
   - type: "neural"
   - num_results: 20
   - include_domains: ["arxiv.org"]
   - start_published_date: today minus 1 day (YYYY-MM-DD)
   - use_autoprompt: true
   - query: "recent AI machine learning paper" (broad)
2. For each result, extract: title, url, abstract/summary, authors, published_date, arxiv_id.
3. Skip survey papers unless they reference >=3 results from this week.
4. Return a JSON array conforming to the CandidateItem schema below.

**Output schema (return ONLY this JSON, no prose):**
\`\`\`json
[
  {
    "title": "string",
    "url": "https://arxiv.org/abs/...",
    "summary": "2-4 sentence abstract digest",
    "outlet": "arXiv",
    "source": "paper",
    "topics": ["short", "kebab-case", "tags"],
    "source_meta": { "authors": ["..."], "published_date": "YYYY-MM-DD", "arxiv_id": "..." }
  }
]
\`\`\`
If no papers found, return [].`,
  tools: [
    "mcp__exa-search__search",
    "mcp__exa-search__get_contents",
  ],
  model: "haiku",
};
```

Create `lib/pulse/subagents/news-curator.ts`:

```typescript
import type { AgentDefinition } from "../../types/agent";

export const newsCurator: AgentDefinition = {
  description:
    "Finds AI lab announcements and research blog posts from a curated domain list using Exa.",
  prompt: `You are the news-curator subagent for the Daily Pulse pipeline.

**Goal:** Return 8-12 AI announcements / research-blog posts from the last 36 hours.

**Allowed outlets (use include_domains):**
anthropic.com, openai.com, deepmind.google, research.google, ai.meta.com, huggingface.co,
nvidia.com, blog.langchain.dev, simonwillison.net

**Procedure:**
1. Call mcp__exa-search__search with:
   - type: "neural"
   - num_results: 20
   - include_domains: <the list above>
   - start_published_date: today minus 2 days
   - use_autoprompt: true
   - query: "AI research announcement blog post"
2. Skip product marketing pages; prefer technical posts.
3. For each result, extract: title, url, summary, outlet (the domain), published_date, author if present.

**Output schema (return ONLY this JSON, no prose):**
\`\`\`json
[
  {
    "title": "string",
    "url": "https://...",
    "summary": "2-4 sentence digest",
    "outlet": "anthropic.com",
    "source": "news",
    "topics": ["..."],
    "source_meta": { "author": "...", "published_date": "YYYY-MM-DD" }
  }
]
\`\`\`
If nothing found, return [].`,
  tools: [
    "mcp__exa-search__search",
    "mcp__exa-search__get_contents",
  ],
  model: "haiku",
};
```

Create `lib/pulse/subagents/gh-curator.ts`:

```typescript
import type { AgentDefinition } from "../../types/agent";

export const ghCurator: AgentDefinition = {
  description:
    "Lists trending AI/ML/agents GitHub repos created in the last day and summarizes each.",
  prompt: `You are the gh-curator subagent for the Daily Pulse pipeline.

**Goal:** Return up to 8 trending AI/ML/agents repos from the last 36 hours.

**Tool:** mcp__github-trending__list_trending

**Procedure:**
1. Call mcp__github-trending__list_trending with since_hours=36, limit=12.
2. For each repo, write a 2-sentence summary based on description + (if helpful) general inference from the title/topics.
3. Skip repos with description length < 10 chars and stars < 30.

**Output schema (return ONLY this JSON, no prose):**
\`\`\`json
[
  {
    "title": "owner/repo",
    "url": "https://github.com/owner/repo",
    "summary": "2-sentence summary",
    "outlet": "GitHub",
    "source": "github",
    "topics": ["..."],
    "source_meta": { "stars_today": 0, "language": "Python", "repo": "owner/repo" }
  }
]
\`\`\`
If empty, return [].`,
  tools: ["mcp__github-trending__list_trending"],
  model: "haiku",
};
```

Create `lib/pulse/subagents/x-curator.ts`:

```typescript
import type { AgentDefinition } from "../../types/agent";

export const xCurator: AgentDefinition = {
  description:
    "Surfaces the highest-signal AI tweets from a curated account list in the last 24 hours.",
  prompt: `You are the x-curator subagent for the Daily Pulse pipeline.

**Goal:** Return up to 5 tweets with the strongest signal (engagement, not just announcements).

**Tool:** mcp__x-trending__list_recent_tweets (returns [] when X_BEARER_TOKEN is unset)

**Procedure:**
1. Call mcp__x-trending__list_recent_tweets with since_hours=24, limit=5.
2. If the tool returns [], return [] yourself.
3. Otherwise, for each tweet write a short, descriptive title (the first ~10 words) and copy the full text as summary.

**Output schema (return ONLY this JSON, no prose):**
\`\`\`json
[
  {
    "title": "short paraphrase",
    "url": "https://x.com/<handle>/status/<id>",
    "summary": "full tweet text",
    "outlet": "X",
    "source": "x",
    "topics": ["..."],
    "source_meta": { "author": "handle", "reply_count": 0, "like_count": 0, "tweet_id": "..." }
  }
]
\`\`\`
If empty, return [].`,
  tools: ["mcp__x-trending__list_recent_tweets"],
  model: "haiku",
};
```

Create `lib/pulse/subagents/index.ts`:

```typescript
import type { AgentDefinition } from "../../types/agent";
import { paperCurator } from "./paper-curator";
import { newsCurator } from "./news-curator";
import { ghCurator } from "./gh-curator";
import { xCurator } from "./x-curator";

export const pulseSubagents: Record<string, AgentDefinition> = {
  "paper-curator": paperCurator,
  "news-curator": newsCurator,
  "gh-curator": ghCurator,
  "x-curator": xCurator,
};
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run lib/pulse/subagents/index.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/pulse/subagents/
git commit -m "feat(pulse): paper / news / gh / x curator subagents"
```

---

## Task 9: Pulse orchestrator config (`lib/pulse/config.ts`)

**Files:**
- Create: `lib/pulse/config.ts`
- Create: `lib/pulse/config.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/pulse/config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildPulseOrchestratorConfig } from "./config";

describe("pulse orchestrator config", () => {
  it("registers 3 MCP servers and all 4 subagents", () => {
    const cfg = buildPulseOrchestratorConfig({
      preferencesPath: "/tmp/preferences.json",
      maxBudgetUsd: 2,
      maxTurns: 40,
    });
    expect(Object.keys(cfg.mcpServers ?? {}).sort()).toEqual([
      "exa-search",
      "github-trending",
      "x-trending",
    ]);
    expect(Object.keys(cfg.agents ?? {}).sort()).toEqual([
      "gh-curator",
      "news-curator",
      "paper-curator",
      "x-curator",
    ]);
    expect(cfg.allowedTools).toEqual(expect.arrayContaining(["Task", "Read"]));
    expect(cfg.maxBudgetUsd).toBe(2);
  });

  it("system prompt mentions preferences.json path", () => {
    const cfg = buildPulseOrchestratorConfig({
      preferencesPath: "/tmp/X/preferences.json",
      maxBudgetUsd: 1,
      maxTurns: 20,
    });
    const append =
      typeof cfg.systemPrompt === "object" && "append" in cfg.systemPrompt
        ? cfg.systemPrompt.append ?? ""
        : "";
    expect(append).toContain("/tmp/X/preferences.json");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run lib/pulse/config.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `lib/pulse/config.ts`:

```typescript
import type { AgentConfig } from "../types/agent";
import { exaSearchTools } from "../agent/tools";
import { githubTrendingTools } from "./tools/github-trending";
import { xTrendingTools } from "./tools/x-trending";
import { pulseSubagents } from "./subagents";

export interface PulseConfigInput {
  preferencesPath: string;
  maxBudgetUsd: number;
  maxTurns: number;
  model?: AgentConfig["model"];
}

export function buildPulseOrchestratorConfig(input: PulseConfigInput): AgentConfig {
  const model = input.model ?? "claude-haiku-4-5-20251001";

  return {
    model,
    workingDirectory: process.cwd(),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `
You are the Daily Pulse orchestrator. Your job: dispatch four curator subagents in parallel,
collect their JSON outputs, deduplicate by URL, and return the merged candidate set.

**Procedure:**
1. Use the Task tool to dispatch these subagents IN PARALLEL (single message, four tool calls):
   - paper-curator
   - news-curator
   - gh-curator
   - x-curator
2. Each subagent returns a JSON array of candidates. Concatenate.
3. Dedupe by 'url' (case-insensitive, strip trailing slash + utm params).
4. Read the user's preferences file at: ${input.preferencesPath}
5. Return the final JSON object:
\`\`\`json
{
  "candidates": [ ...deduped... ],
  "preferences": { ...verbatim content of preferences.json... }
}
\`\`\`
Return ONLY this JSON, no prose. The calling script handles ranking and DB writes.`.trim(),
    },
    settingSources: ["project"],
    mcpServers: {
      "exa-search": exaSearchTools,
      "github-trending": githubTrendingTools,
      "x-trending": xTrendingTools,
    },
    agents: pulseSubagents,
    allowedTools: [
      "Task",
      "Read",
      "mcp__exa-search__search",
      "mcp__exa-search__get_contents",
      "mcp__github-trending__list_trending",
      "mcp__x-trending__list_recent_tweets",
    ],
    permissionMode: "default",
    maxBudgetUsd: input.maxBudgetUsd,
    maxTurns: input.maxTurns,
  };
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run lib/pulse/config.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/pulse/config.ts lib/pulse/config.test.ts
git commit -m "feat(pulse): orchestrator config with 3 MCP servers + 4 subagents"
```

---

## Task 10: Ranker (`lib/pulse/ranker.ts`)

**Files:**
- Create: `lib/pulse/ranker.ts`
- Create: `lib/pulse/ranker.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/pulse/ranker.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { rankCandidates, buildRankerPrompt, type Candidate } from "./ranker";
import type { Preferences } from "./preferences";

const SAMPLE_PREFS: Preferences = {
  generated_at: "2026-05-18T07:00:00Z",
  window_days: 30,
  samples: {
    liked: [{ title: "MoE folding", summary: "...", source: "paper" }],
    disliked: [{ title: "RLHF survey", summary: "...", source: "paper" }],
    bookmarked: [],
    expanded_but_no_signal: [],
  },
  counts: { liked: 8, disliked: 3, bookmarked: 1 },
  source_weights: { paper: 0.4, news: 0.3, github: 0.2, x: 0.1 },
  topic_signals: { loved: ["moe"], avoided: ["rlhf survey"] },
  cold_start: false,
};

function fakeCandidate(idx: number, source: Candidate["source"], extra: Partial<Candidate> = {}): Candidate {
  return {
    title: `c${idx}`,
    url: `https://example.com/${idx}`,
    summary: `summary ${idx}`,
    outlet: "x",
    source,
    topics: ["moe"],
    source_meta: {},
    ...extra,
  };
}

describe("ranker prompt", () => {
  it("includes liked + disliked samples + cold-start flag", () => {
    const prompt = buildRankerPrompt({
      candidates: [fakeCandidate(1, "paper")],
      preferences: SAMPLE_PREFS,
      recentPulseUrls: ["https://old.example/x"],
    });
    expect(prompt).toContain("MoE folding");
    expect(prompt).toContain("RLHF survey");
    expect(prompt).toContain("cold_start: false");
    expect(prompt).toContain("https://old.example/x");
  });
});

describe("rankCandidates", () => {
  it("returns top 10 with priority + match_score; respects source diversity floor", async () => {
    const candidates = Array.from({ length: 30 }, (_, i) =>
      fakeCandidate(i, (["paper", "news", "github", "x"] as const)[i % 4])
    );
    const queryLLM = vi.fn().mockResolvedValue({
      picks: candidates.slice(0, 10).map((c, idx) => ({
        url: c.url,
        priority: idx < 5 ? "high" : "medium",
        match_score: 5 - Math.floor(idx / 2),
        complexity: "intermediate",
        read_minutes: 6,
      })),
    });
    const ranked = await rankCandidates({
      candidates,
      preferences: SAMPLE_PREFS,
      recentPulseUrls: [],
      queryLLM,
    });
    expect(ranked.length).toBe(10);
    expect(queryLLM).toHaveBeenCalledOnce();
    const sourceCounts: Record<string, number> = {};
    for (const r of ranked) sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
    for (const c of Object.values(sourceCounts)) expect(c).toBeLessThanOrEqual(5);
  });

  it("falls back to recency-weighted order when queryLLM throws", async () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      fakeCandidate(i, (["paper", "news", "github", "x"] as const)[i % 4])
    );
    const queryLLM = vi.fn().mockRejectedValue(new Error("boom"));
    const ranked = await rankCandidates({
      candidates,
      preferences: SAMPLE_PREFS,
      recentPulseUrls: [],
      queryLLM,
    });
    expect(ranked.length).toBeLessThanOrEqual(10);
    // No item from a single source exceeds 5
    const sourceCounts: Record<string, number> = {};
    for (const r of ranked) sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
    for (const c of Object.values(sourceCounts)) expect(c).toBeLessThanOrEqual(5);
  });

  it("drops candidates whose URLs appear in recentPulseUrls", async () => {
    const candidates = [
      fakeCandidate(1, "paper", { url: "https://dup.example/a" }),
      fakeCandidate(2, "paper", { url: "https://fresh.example/b" }),
    ];
    const queryLLM = vi.fn().mockResolvedValue({
      picks: [
        { url: "https://fresh.example/b", priority: "high", match_score: 5, complexity: "intermediate", read_minutes: 5 },
      ],
    });
    const ranked = await rankCandidates({
      candidates,
      preferences: SAMPLE_PREFS,
      recentPulseUrls: ["https://dup.example/a"],
      queryLLM,
    });
    expect(ranked.map((r) => r.url)).toEqual(["https://fresh.example/b"]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run lib/pulse/ranker.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `lib/pulse/ranker.ts`:

```typescript
import type { Preferences } from "./preferences";
import type { ItemPriority, ItemComplexity, ItemSource } from "./db";

export interface Candidate {
  title: string;
  url: string;
  summary: string;
  outlet: string;
  source: ItemSource;
  topics: string[];
  source_meta: Record<string, unknown>;
}

export interface RankedItem extends Candidate {
  rank: number;
  priority: ItemPriority;
  match_score: number;
  complexity: ItemComplexity;
  read_minutes: number;
}

export interface RankerLLMResponse {
  picks: Array<{
    url: string;
    priority: ItemPriority;
    match_score: number;
    complexity: ItemComplexity;
    read_minutes: number;
  }>;
}

export interface RankInput {
  candidates: Candidate[];
  preferences: Preferences;
  recentPulseUrls: string[];
  queryLLM: (prompt: string) => Promise<RankerLLMResponse>;
}

const TOP_N = 10;
const MAX_PER_SOURCE = 5;

function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (k.toLowerCase().startsWith("utm_")) u.searchParams.delete(k);
    }
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function buildRankerPrompt(input: Omit<RankInput, "queryLLM">): string {
  const liked = input.preferences.samples.liked
    .slice(0, 10)
    .map((s, i) => `  ${i + 1}. [${s.source}] ${s.title} — ${s.summary.slice(0, 140)}`)
    .join("\n");
  const disliked = input.preferences.samples.disliked
    .slice(0, 10)
    .map((s, i) => `  ${i + 1}. [${s.source}] ${s.title} — ${s.summary.slice(0, 140)}`)
    .join("\n");
  const cands = input.candidates
    .map(
      (c, i) =>
        `  ${i}. [${c.source}] ${c.title}\n    url: ${c.url}\n    topics: ${c.topics.join(",")}\n    summary: ${c.summary.slice(0, 200)}`
    )
    .join("\n");
  const recent = input.recentPulseUrls.slice(0, 100).join(", ");

  return `You are ranking AI/ML items for a single user's morning feed.

cold_start: ${input.preferences.cold_start}
source_weights: ${JSON.stringify(input.preferences.source_weights)}
loved_topics: ${input.preferences.topic_signals.loved.join(", ")}
avoided_topics: ${input.preferences.topic_signals.avoided.join(", ")}

LIKED EXAMPLES:
${liked || "  (none)"}

DISLIKED EXAMPLES:
${disliked || "  (none)"}

CANDIDATES:
${cands}

RECENT URLS (do not pick): ${recent || "(none)"}

Pick up to 10 items in display order. Rules:
- At most ${MAX_PER_SOURCE} from any one source.
- Up to 2 items should be 'medium' priority from topics user has NOT engaged with (exploration). If fewer such candidates exist, fill with next-best familiar items.
- If cold_start is true, ignore liked/disliked and rank by recency × source diversity × novelty.

Output ONLY this JSON (no prose):
\`\`\`json
{
  "picks": [
    {"url": "...", "priority": "high"|"medium", "match_score": 1..5, "complexity": "beginner"|"intermediate"|"advanced", "read_minutes": number}
  ]
}
\`\`\``;
}

function dedupeAndDrop(candidates: Candidate[], recentUrls: string[]): Candidate[] {
  const blocked = new Set(recentUrls.map(normalize));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    const key = normalize(c.url);
    if (blocked.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function fallbackRank(candidates: Candidate[]): RankedItem[] {
  const sourceCounts: Record<string, number> = {};
  const ranked: RankedItem[] = [];
  for (const c of candidates) {
    const used = sourceCounts[c.source] ?? 0;
    if (used >= MAX_PER_SOURCE) continue;
    sourceCounts[c.source] = used + 1;
    ranked.push({
      ...c,
      rank: ranked.length + 1,
      priority: ranked.length < 3 ? "high" : "medium",
      match_score: 3,
      complexity: "intermediate",
      read_minutes: 5,
    });
    if (ranked.length >= TOP_N) break;
  }
  return ranked;
}

function enforceSourceFloor(items: RankedItem[]): RankedItem[] {
  const out: RankedItem[] = [];
  const sourceCounts: Record<string, number> = {};
  for (const it of items) {
    const used = sourceCounts[it.source] ?? 0;
    if (used >= MAX_PER_SOURCE) continue;
    sourceCounts[it.source] = used + 1;
    out.push({ ...it, rank: out.length + 1 });
    if (out.length >= TOP_N) break;
  }
  return out;
}

export async function rankCandidates(input: RankInput): Promise<RankedItem[]> {
  const filtered = dedupeAndDrop(input.candidates, input.recentPulseUrls);
  if (filtered.length === 0) return [];

  let response: RankerLLMResponse;
  try {
    response = await input.queryLLM(
      buildRankerPrompt({
        candidates: filtered,
        preferences: input.preferences,
        recentPulseUrls: input.recentPulseUrls,
      })
    );
  } catch {
    return fallbackRank(filtered);
  }

  const byUrl = new Map(filtered.map((c) => [normalize(c.url), c]));
  const ordered: RankedItem[] = [];
  for (const pick of response.picks) {
    const cand = byUrl.get(normalize(pick.url));
    if (!cand) continue;
    ordered.push({
      ...cand,
      rank: ordered.length + 1,
      priority: pick.priority,
      match_score: Math.max(1, Math.min(5, Math.round(pick.match_score))),
      complexity: pick.complexity,
      read_minutes: Math.max(1, Math.round(pick.read_minutes)),
    });
  }

  return enforceSourceFloor(ordered);
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run lib/pulse/ranker.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/pulse/ranker.ts lib/pulse/ranker.test.ts
git commit -m "feat(pulse): LLM ranker with dedupe, source floor, fallback"
```

---

## Task 11: Entry script `scripts/generate-pulse.ts`

**Files:**
- Create: `scripts/generate-pulse.ts`

(This script is integration-tested manually in Task 12. Unit tests would mock too much to be useful.)

- [ ] **Step 1: Create the script**

```typescript
#!/usr/bin/env tsx
import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { openDb, migrate, createPulse, insertPulseItem, getPulseItems, updatePulseStatus, listPulses, addUsageCost } from "../lib/pulse/db";
import { buildPreferences, writePreferencesFile, type Preferences } from "../lib/pulse/preferences";
import { rankCandidates, type Candidate, type RankerLLMResponse } from "../lib/pulse/ranker";
import { buildPulseOrchestratorConfig } from "../lib/pulse/config";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local") });

const REPO_ROOT = process.cwd();
const DATA_DIR = path.resolve(REPO_ROOT, "data");
const DB_PATH = path.resolve(DATA_DIR, "pulse.db");
const PREFS_PATH = path.resolve(DATA_DIR, "preferences.json");
const MAX_BUDGET = parseFloat(process.env.MAX_BUDGET_USD ?? "2.0");
const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? "40", 10);

function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function callRankerLLM(prompt: string): Promise<RankerLLMResponse> {
  let collected = "";
  const it = query({
    prompt,
    options: {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "Return only the JSON requested in the user prompt. No prose.",
      maxTurns: 2,
    },
  });
  for await (const msg of it) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") collected += block.text;
      }
    }
  }
  const match = collected.match(/```json\s*([\s\S]+?)\s*```/) ?? collected.match(/(\{[\s\S]+\})/);
  if (!match) throw new Error(`Ranker returned no parseable JSON: ${collected.slice(0, 300)}`);
  return JSON.parse(match[1]) as RankerLLMResponse;
}

function extractCandidatesFromAgentOutput(raw: string): { candidates: Candidate[]; preferences: Preferences | null } {
  const block = raw.match(/```json\s*([\s\S]+?)\s*```/);
  const parsed = block ? JSON.parse(block[1]) : JSON.parse(raw);
  return { candidates: parsed.candidates ?? [], preferences: parsed.preferences ?? null };
}

async function main() {
  const start = Date.now();
  const db = openDb(DB_PATH);
  migrate(db);

  const date_key = localDateKey();
  const generated_at = new Date().toISOString();

  console.log(`[pulse] generating for ${date_key}`);
  const prefs = buildPreferences(db, { now: new Date(), windowDays: 30 });
  writePreferencesFile(PREFS_PATH, prefs);
  console.log(`[pulse] preferences written (cold_start=${prefs.cold_start}, liked=${prefs.counts.liked})`);

  let pulse_id: number;
  try {
    pulse_id = createPulse(db, { generated_at, date_key, item_count: 0, status: "running" });
  } catch (e) {
    console.error(`[pulse] pulse for ${date_key} already exists; aborting.`);
    process.exit(0);
  }

  const cfg = buildPulseOrchestratorConfig({
    preferencesPath: PREFS_PATH,
    maxBudgetUsd: MAX_BUDGET,
    maxTurns: MAX_TURNS,
  });

  let agentText = "";
  let costUsd = 0;
  let status: "ok" | "partial" | "failed" = "ok";

  try {
    const it = query({
      prompt: `Generate the candidate set for ${date_key}. Dispatch all four curators in parallel via Task. Output the JSON in the format the system prompt requires.`,
      options: cfg,
    });
    for await (const msg of it) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") agentText += block.text;
        }
      }
      if (msg.type === "result") {
        costUsd = msg.total_cost_usd ?? 0;
      }
    }
  } catch (e) {
    console.error("[pulse] orchestrator failed:", e);
    status = "failed";
  }

  if (status !== "failed") {
    let candidates: Candidate[] = [];
    try {
      const parsed = extractCandidatesFromAgentOutput(agentText);
      candidates = parsed.candidates ?? [];
      if (candidates.length === 0) status = "partial";
    } catch (e) {
      console.error("[pulse] could not parse orchestrator JSON:", e);
      status = "partial";
    }

    const recentUrls = listPulses(db, 30)
      .flatMap((p) => getPulseItems(db, p.id))
      .map((i) => i.url);

    const ranked = await rankCandidates({
      candidates,
      preferences: prefs,
      recentPulseUrls: recentUrls,
      queryLLM: callRankerLLM,
    });

    for (const item of ranked) {
      try {
        insertPulseItem(db, {
          pulse_id,
          rank: item.rank,
          source: item.source,
          priority: item.priority,
          match_score: item.match_score,
          complexity: item.complexity,
          read_minutes: item.read_minutes,
          title: item.title,
          url: item.url,
          outlet: item.outlet,
          summary: item.summary,
          topics: item.topics,
          source_meta: item.source_meta,
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        // dedupe collision; skip
        console.warn(`[pulse] skipping dup url ${item.url}`);
      }
    }

    if (ranked.length === 0) status = "partial";
    updatePulseStatus(db, pulse_id, {
      status,
      item_count: ranked.length,
      cost_usd: costUsd,
      duration_ms: Date.now() - start,
    });
    addUsageCost(db, date_key, costUsd, new Date().toISOString());
  } else {
    updatePulseStatus(db, pulse_id, {
      status: "failed",
      item_count: 0,
      cost_usd: costUsd,
      duration_ms: Date.now() - start,
    });
  }

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      date_key,
      status,
      cost_usd: costUsd,
      duration_ms: Date.now() - start,
    })
  );

  db.close();
}

main().catch((err) => {
  console.error("[pulse] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Install dotenv (already a transitive dep? confirm)**

Run: `npm ls dotenv 2>&1 | head -5`
If not present, run: `npm install dotenv`.

- [ ] **Step 3: Commit (no test yet; manual run is Task 12)**

```bash
git add scripts/generate-pulse.ts package.json package-lock.json
git commit -m "feat(pulse): generate-pulse entry script"
```

---

## Task 12: Smoke-run the pipeline end-to-end

**Files:** none changed; this is a verification task.

- [ ] **Step 1: Stop the running dev server (so writes don't race)**

```bash
ps aux | grep "next dev" | grep -v grep | awk '{print $2}' | xargs -r kill
```

- [ ] **Step 2: Run the pipeline once**

```bash
cd /Users/waleedarafa/projects/deep-ai-research
npm run pulse:generate
```

Expected: a JSON status line at the end such as
`{"timestamp":"...","date_key":"2026-05-18","status":"ok","cost_usd":0.04..0.20,"duration_ms":15000..90000}`

- [ ] **Step 3: Inspect DB**

```bash
sqlite3 data/pulse.db "SELECT id, date_key, status, item_count, cost_usd FROM pulses ORDER BY id DESC LIMIT 5"
sqlite3 data/pulse.db "SELECT rank, source, priority, title, url FROM pulse_items ORDER BY pulse_id DESC, rank ASC LIMIT 12"
```

Expected: one new `pulses` row with `status='ok'` or `'partial'`; 1–10 `pulse_items` rows with diverse sources.

- [ ] **Step 4: Inspect preferences.json**

```bash
jq '{cold_start, counts, source_weights}' data/preferences.json
```

Expected: `cold_start: true` on first run (no feedback yet).

- [ ] **Step 5: Commit nothing — this is a verification gate**

If status is `failed`, debug before continuing. Common failure: Exa rate limit, Anthropic key invalid, or a subagent returning malformed JSON. The orchestrator's text output should be in the agent log; surface and fix.

---

## Task 13: API route — `GET /api/pulse/today`

**Files:**
- Create: `app/api/pulse/today/route.ts`

- [ ] **Step 1: Implement the route**

```typescript
import { NextResponse } from "next/server";
import path from "node:path";
import { openDb, migrate, getLatestPulse, getPulseItems } from "@/lib/pulse/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = openDb(path.resolve(process.cwd(), "data", "pulse.db"));
  migrate(db);
  const pulse = getLatestPulse(db);
  if (!pulse) {
    db.close();
    return NextResponse.json({ pulse: null, items: [] }, { status: 200 });
  }
  const items = getPulseItems(db, pulse.id);
  db.close();
  return NextResponse.json({ pulse, items });
}
```

- [ ] **Step 2: Smoke test by hand**

```bash
npm run dev &
sleep 4
curl -s http://localhost:3003/api/pulse/today | jq '{pulse: .pulse.date_key, items: (.items | length)}'
kill %1
```

Expected: `{ "pulse": "2026-05-18", "items": <n>=1..10 }`.

- [ ] **Step 3: Commit**

```bash
git add app/api/pulse/today/route.ts
git commit -m "feat(pulse): GET /api/pulse/today"
```

---

## Task 14: API route — `GET /api/pulse/history`

**Files:**
- Create: `app/api/pulse/history/route.ts`

- [ ] **Step 1: Implement**

```typescript
import { NextResponse } from "next/server";
import path from "node:path";
import { openDb, migrate, listPulses } from "@/lib/pulse/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = openDb(path.resolve(process.cwd(), "data", "pulse.db"));
  migrate(db);
  const pulses = listPulses(db, 30);
  db.close();
  return NextResponse.json(
    pulses.map((p) => ({
      id: p.id,
      date_key: p.date_key,
      item_count: p.item_count,
      generated_at: p.generated_at,
      status: p.status,
    }))
  );
}
```

- [ ] **Step 2: Smoke**

```bash
npm run dev &
sleep 4
curl -s http://localhost:3003/api/pulse/history | jq 'length'
kill %1
```

Expected: a positive integer.

- [ ] **Step 3: Commit**

```bash
git add app/api/pulse/history/route.ts
git commit -m "feat(pulse): GET /api/pulse/history"
```

---

## Task 15: API route — `POST /api/pulse/feedback`

**Files:**
- Create: `app/api/pulse/feedback/route.ts`
- Create: `app/api/pulse/feedback/route.test.ts`

- [ ] **Step 1: Write failing test**

Create `app/api/pulse/feedback/route.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { POST } from "./route";
import { openDb, migrate, createPulse, insertPulseItem } from "@/lib/pulse/db";

let dbDir: string;

beforeEach(() => {
  dbDir = mkdtempSync(path.join(os.tmpdir(), "pulse-fb-route-"));
  process.env.PULSE_DB_PATH = path.join(dbDir, "pulse.db");
  const db = openDb(process.env.PULSE_DB_PATH);
  migrate(db);
  const pid = createPulse(db, {
    generated_at: "2026-05-18T07:00:00Z",
    date_key: "2026-05-18",
    item_count: 0,
    status: "ok",
  });
  insertPulseItem(db, {
    pulse_id: pid,
    rank: 1,
    source: "paper",
    priority: "high",
    match_score: 5,
    complexity: "intermediate",
    read_minutes: 5,
    title: "t",
    url: "https://example.com/a",
    outlet: "x",
    summary: "x",
    topics: [],
    source_meta: {},
    created_at: "2026-05-18T07:00:01Z",
  });
  db.close();
});

afterEach(() => {
  delete process.env.PULSE_DB_PATH;
});

describe("POST /api/pulse/feedback", () => {
  it("writes a like row", async () => {
    const req = new Request("http://localhost/api/pulse/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item_id: 1, action: "like" }),
    });
    const res = await POST(req as Request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects invalid action", async () => {
    const req = new Request("http://localhost/api/pulse/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item_id: 1, action: "love-it-please" }),
    });
    const res = await POST(req as Request);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `npx vitest run app/api/pulse/feedback`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/api/pulse/feedback/route.ts`:

```typescript
import { NextResponse } from "next/server";
import path from "node:path";
import { z } from "zod";
import { openDb, migrate, addFeedback } from "@/lib/pulse/db";

export const dynamic = "force-dynamic";

const Body = z.object({
  item_id: z.number().int().positive(),
  action: z.enum(["like", "dislike", "bookmark", "expand", "dwell"]),
  meta: z.record(z.string(), z.unknown()).optional(),
});

function dbPath() {
  return process.env.PULSE_DB_PATH ?? path.resolve(process.cwd(), "data", "pulse.db");
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const db = openDb(dbPath());
  migrate(db);
  addFeedback(db, {
    item_id: parsed.data.item_id,
    action: parsed.data.action,
    created_at: new Date().toISOString(),
    meta: parsed.data.meta,
  });
  db.close();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run, expect pass**

Run: `npx vitest run app/api/pulse/feedback`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/pulse/feedback/route.ts app/api/pulse/feedback/route.test.ts
git commit -m "feat(pulse): POST /api/pulse/feedback with Zod validation"
```

---

## Task 16: API route — `POST /api/pulse/generate`

**Files:**
- Create: `app/api/pulse/generate/route.ts`

- [ ] **Step 1: Implement (spawns the generate script asynchronously)**

```typescript
import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function POST() {
  const script = path.resolve(process.cwd(), "scripts", "generate-pulse.ts");
  const proc = spawn("npx", ["tsx", script], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  proc.unref();
  return NextResponse.json({ ok: true, pid: proc.pid });
}
```

- [ ] **Step 2: Smoke**

```bash
npm run dev &
sleep 4
curl -s -X POST http://localhost:3003/api/pulse/generate | jq .
# wait ~30-90 seconds for the generate-pulse script to land a row, then:
sqlite3 data/pulse.db "SELECT id, date_key, status FROM pulses ORDER BY id DESC LIMIT 3"
kill %1
```

Expected: a `running` row appears immediately, transitions to `ok`/`partial` within a couple of minutes.

- [ ] **Step 3: Commit**

```bash
git add app/api/pulse/generate/route.ts
git commit -m "feat(pulse): POST /api/pulse/generate (fire-and-forget)"
```

---

## Task 17: Global styles — typography + parchment palette

**Files:**
- Modify: `app/globals.css`
- Modify: `tailwind.config.ts` (font family + colors)

- [ ] **Step 1: Update `tailwind.config.ts`**

Replace the `theme.extend` block (read the file first to confirm structure; merge into existing one):

```typescript
fontFamily: {
  serif: ['"Iowan Old Style"', 'Charter', '"Source Serif Pro"', 'Georgia', 'serif'],
  mono: ['"JetBrains Mono"', '"IBM Plex Mono"', '"SF Mono"', 'ui-monospace', 'monospace'],
},
colors: {
  parchment: {
    DEFAULT: '#f5f1e8',
    dark: '#ece5d3',
  },
  brick: {
    DEFAULT: '#8b1a1a',
    soft: '#a73b3b',
  },
  forest: '#2f5d3a',
  goldpill: '#b89500',
  teal: '#1e6d7a',
  purplepill: '#5a3aa6',
  cyanpill: '#0f7d8f',
},
```

- [ ] **Step 2: Append pulse-specific base styles to `app/globals.css`**

```css
@layer base {
  .pulse-page {
    background: theme('colors.parchment.DEFAULT');
    color: #2b2b2b;
    font-family: theme('fontFamily.serif');
  }
  .pulse-mono {
    font-family: theme('fontFamily.mono');
    letter-spacing: 0.02em;
  }
  .pulse-pill {
    @apply inline-flex items-center px-2 py-0.5 text-xs uppercase pulse-mono;
    border: 1px solid currentColor;
  }
  .pulse-pullquote {
    border-left: 3px solid theme('colors.brick.DEFAULT');
    padding-left: 0.75rem;
    font-style: italic;
  }
}
```

- [ ] **Step 3: Visual check**

Run `npm run dev`, open `http://localhost:3003`, verify the existing `/research` page still renders normally (it doesn't use these classes).

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts app/globals.css
git commit -m "feat(pulse): parchment palette + serif/mono font stack"
```

---

## Task 18: Layout shell + page route `/pulse`

**Files:**
- Create: `app/pulse/page.tsx`
- Create: `app/pulse/[date]/page.tsx`
- Create: `components/pulse/PulseShell.tsx`
- Create: `components/pulse/types.ts`

- [ ] **Step 1: Shared client types**

Create `components/pulse/types.ts`:

```typescript
import type { PulseItemRow, PulseRow } from "@/lib/pulse/db";

export type ClientPulseItem = Omit<PulseItemRow, "topics" | "source_meta"> & {
  topics: string[];
  source_meta: Record<string, unknown>;
};

export interface PulsePayload {
  pulse: PulseRow | null;
  items: ClientPulseItem[];
}

export interface HistoryEntry {
  id: number;
  date_key: string;
  item_count: number;
  generated_at: string;
  status: PulseRow["status"];
}
```

- [ ] **Step 2: Shell component**

Create `components/pulse/PulseShell.tsx`:

```typescript
import type { ReactNode } from "react";

interface ShellProps {
  sidebar: ReactNode;
  header: ReactNode;
  children: ReactNode;
}

export function PulseShell({ sidebar, header, children }: ShellProps) {
  return (
    <div className="pulse-page min-h-screen">
      <div className="border-b border-parchment-dark px-6 py-4">{header}</div>
      <div className="flex">
        <aside className="w-56 shrink-0 border-r border-parchment-dark px-4 py-6 sticky top-0 h-[calc(100vh-4rem)] overflow-y-auto">
          {sidebar}
        </aside>
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Page entries**

Create `app/pulse/page.tsx`:

```typescript
import path from "node:path";
import { openDb, migrate, getLatestPulse, getPulseItems, listPulses } from "@/lib/pulse/db";
import { PulseShell } from "@/components/pulse/PulseShell";
import { PulseHeader } from "@/components/pulse/PulseHeader";
import { TopicFilter } from "@/components/pulse/TopicFilter";
import { HistoryList } from "@/components/pulse/HistoryList";
import { PulseFeed } from "@/components/pulse/PulseFeed";

export const dynamic = "force-dynamic";

export default async function PulsePage() {
  const db = openDb(path.resolve(process.cwd(), "data", "pulse.db"));
  migrate(db);
  const pulse = getLatestPulse(db);
  const items = pulse ? getPulseItems(db, pulse.id) : [];
  const history = listPulses(db, 30).map((p) => ({
    id: p.id,
    date_key: p.date_key,
    item_count: p.item_count,
    generated_at: p.generated_at,
    status: p.status,
  }));
  db.close();

  const allTopics = Array.from(new Set(items.flatMap((i) => i.topics)));

  return (
    <PulseShell
      header={<PulseHeader pulse={pulse} />}
      sidebar={
        <>
          <TopicFilter topics={allTopics} items={items} />
          <HistoryList entries={history} activeId={pulse?.id ?? null} />
        </>
      }
    >
      <PulseFeed initialItems={items} />
    </PulseShell>
  );
}
```

Create `app/pulse/[date]/page.tsx`:

```typescript
import path from "node:path";
import { notFound } from "next/navigation";
import { openDb, migrate, getPulseByDate, getPulseItems, listPulses } from "@/lib/pulse/db";
import { PulseShell } from "@/components/pulse/PulseShell";
import { PulseHeader } from "@/components/pulse/PulseHeader";
import { TopicFilter } from "@/components/pulse/TopicFilter";
import { HistoryList } from "@/components/pulse/HistoryList";
import { PulseFeed } from "@/components/pulse/PulseFeed";

export const dynamic = "force-dynamic";

export default async function PulseDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const db = openDb(path.resolve(process.cwd(), "data", "pulse.db"));
  migrate(db);
  const pulse = getPulseByDate(db, date);
  if (!pulse) {
    db.close();
    notFound();
  }
  const items = getPulseItems(db, pulse.id);
  const history = listPulses(db, 30).map((p) => ({
    id: p.id,
    date_key: p.date_key,
    item_count: p.item_count,
    generated_at: p.generated_at,
    status: p.status,
  }));
  db.close();
  const allTopics = Array.from(new Set(items.flatMap((i) => i.topics)));

  return (
    <PulseShell
      header={<PulseHeader pulse={pulse} />}
      sidebar={
        <>
          <TopicFilter topics={allTopics} items={items} />
          <HistoryList entries={history} activeId={pulse.id} />
        </>
      }
    >
      <PulseFeed initialItems={items} />
    </PulseShell>
  );
}
```

- [ ] **Step 4: Commit (cannot run yet — components below)**

```bash
git add app/pulse components/pulse/PulseShell.tsx components/pulse/types.ts
git commit -m "feat(pulse): /pulse and /pulse/[date] route shells"
```

---

## Task 19: `PulseHeader` component

**Files:**
- Create: `components/pulse/PulseHeader.tsx`

- [ ] **Step 1: Implement**

```typescript
"use client";

import { useState } from "react";
import type { PulseRow } from "@/lib/pulse/db";

interface Props {
  pulse: PulseRow | null;
}

function formatDate(dateKey: string): string {
  const d = new Date(dateKey + "T12:00:00Z");
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function PulseHeader({ pulse }: Props) {
  const [busy, setBusy] = useState(false);

  async function trigger() {
    setBusy(true);
    await fetch("/api/pulse/generate", { method: "POST" }).catch(() => {});
    setTimeout(() => location.reload(), 2500);
  }

  return (
    <div className="flex items-center justify-between">
      <h1 className="font-serif text-2xl">
        Daily Pulse{pulse ? ` — ${formatDate(pulse.date_key)}` : ""}
      </h1>
      <button
        onClick={trigger}
        disabled={busy}
        className="pulse-mono text-xs uppercase border border-brick text-brick px-3 py-1 hover:bg-brick hover:text-parchment transition-colors disabled:opacity-40"
      >
        {busy ? "Generating…" : "Gen Now"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pulse/PulseHeader.tsx
git commit -m "feat(pulse): PulseHeader with Gen Now"
```

---

## Task 20: `TopicFilter` (sidebar top half)

**Files:**
- Create: `components/pulse/TopicFilter.tsx`
- Create: `lib/pulse/store.ts` (small Zustand store)

- [ ] **Step 1: Install Zustand**

```bash
npm install zustand
```

- [ ] **Step 2: Topic filter store**

Create `lib/pulse/store.ts`:

```typescript
"use client";

import { create } from "zustand";

interface FilterState {
  topic: string | null;
  setTopic: (t: string | null) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  topic: null,
  setTopic: (t) => set({ topic: t }),
}));
```

- [ ] **Step 3: Component**

Create `components/pulse/TopicFilter.tsx`:

```typescript
"use client";

import type { ClientPulseItem } from "./types";
import { useFilterStore } from "@/lib/pulse/store";

interface Props {
  topics: string[];
  items: ClientPulseItem[];
}

export function TopicFilter({ topics, items }: Props) {
  const { topic, setTopic } = useFilterStore();
  const counts = topics.map((t) => ({
    name: t,
    count: items.filter((i) => i.topics.includes(t)).length,
  }));

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <span className="pulse-mono text-xs uppercase tracking-wider">Filter by topic</span>
        {topic && (
          <button
            className="pulse-mono text-xs text-brick"
            onClick={() => setTopic(null)}
            aria-label="Clear topic filter"
          >
            Clear ×
          </button>
        )}
      </div>
      <ul>
        <li>
          <button
            className={`flex w-full justify-between py-1 text-left pulse-mono text-sm ${
              topic === null ? "text-brick font-bold" : ""
            }`}
            onClick={() => setTopic(null)}
          >
            <span>ALL</span>
            <span>{items.length}</span>
          </button>
        </li>
        {counts.map(({ name, count }) => (
          <li key={name}>
            <button
              className={`flex w-full justify-between py-1 text-left pulse-mono text-sm ${
                topic === name ? "text-brick font-bold" : ""
              }`}
              onClick={() => setTopic(name)}
            >
              <span>{name}</span>
              <span>{count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/pulse/TopicFilter.tsx lib/pulse/store.ts package.json package-lock.json
git commit -m "feat(pulse): TopicFilter sidebar with Zustand store"
```

---

## Task 21: `HistoryList` (sidebar bottom half)

**Files:**
- Create: `components/pulse/HistoryList.tsx`

- [ ] **Step 1: Implement**

```typescript
"use client";

import Link from "next/link";
import type { HistoryEntry } from "./types";

interface Props {
  entries: HistoryEntry[];
  activeId: number | null;
}

export function HistoryList({ entries, activeId }: Props) {
  return (
    <div>
      <div className="pulse-mono text-xs uppercase tracking-wider mb-3">History</div>
      <ul>
        {entries.map((e) => {
          const isActive = e.id === activeId;
          return (
            <li key={e.id} className="py-1">
              <Link
                href={`/pulse/${e.date_key}`}
                className={`flex justify-between pulse-mono text-xs ${
                  isActive ? "text-brick font-bold" : ""
                }`}
              >
                <span>
                  {isActive ? "●" : "○"} {e.date_key}
                </span>
                <span>{e.item_count}t</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pulse/HistoryList.tsx
git commit -m "feat(pulse): HistoryList sidebar"
```

---

## Task 22: `PulseCard` (the editorial card)

**Files:**
- Create: `components/pulse/PulseCard.tsx`
- Create: `components/pulse/FeedbackStrip.tsx`
- Create: `components/pulse/QuickActions.tsx`
- Create: `components/pulse/PulseFeed.tsx`

- [ ] **Step 1: `FeedbackStrip`**

```typescript
"use client";

import { useState } from "react";
import type { ClientPulseItem } from "./types";

interface Props {
  item: ClientPulseItem;
}

type Action = "like" | "dislike" | "bookmark";

async function postFeedback(item_id: number, action: Action) {
  await fetch("/api/pulse/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item_id, action }),
  });
}

export function FeedbackStrip({ item }: Props) {
  const [reaction, setReaction] = useState<"like" | "dislike" | null>(null);
  const [bookmarked, setBookmarked] = useState(false);

  function set(action: Action) {
    if (action === "bookmark") {
      setBookmarked(true);
      postFeedback(item.id, "bookmark");
      return;
    }
    setReaction(action);
    postFeedback(item.id, action);
  }

  return (
    <div className="pulse-mono text-sm flex gap-4 mt-4">
      <button onClick={() => set("bookmark")} aria-pressed={bookmarked} className={bookmarked ? "text-brick" : ""}>
        🔖 Bookmark
      </button>
      <button onClick={() => set("like")} aria-pressed={reaction === "like"} className={reaction === "like" ? "text-brick" : ""}>
        ❤ Like
      </button>
      <button onClick={() => set("dislike")} aria-pressed={reaction === "dislike"} className={reaction === "dislike" ? "text-brick" : ""}>
        👎 Dislike
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `QuickActions`**

```typescript
"use client";

interface Props {
  onAction: (prompt: string) => void;
}

const PRESETS: Array<{ label: string; icon: string; prompt: string }> = [
  { label: "Key Concepts", icon: "◆", prompt: "List the 5 most important concepts this introduces, one line each." },
  { label: "Mental Models", icon: "◆", prompt: "What analogies or frameworks would help someone understand this?" },
  { label: "Diagram", icon: "○", prompt: "Draw an ASCII or mermaid diagram of the method/system." },
  { label: "Code Pattern", icon: "(/)", prompt: "Sketch the simplest working code example of the core idea." },
  { label: "Implications", icon: "○", prompt: "What are the 3 most important practical implications for an AI engineer?" },
  { label: "Flashcards", icon: "※", prompt: "Make 5 spaced-repetition flashcards (Q on one line, A on next)." },
];

export function QuickActions({ onAction }: Props) {
  return (
    <div className="mt-6">
      <div className="pulse-mono text-xs uppercase tracking-wider mb-2">Part II</div>
      <div className="grid grid-cols-3 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onAction(p.prompt)}
            className="pulse-mono text-xs uppercase border border-zinc-400 hover:border-brick hover:text-brick px-3 py-2 text-left transition-colors"
          >
            {p.icon} {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `PulseCard`**

```typescript
"use client";

import { useState } from "react";
import type { ClientPulseItem } from "./types";
import { FeedbackStrip } from "./FeedbackStrip";
import { QuickActions } from "./QuickActions";
import { AskAgentBox } from "./AskAgentBox";

interface Props {
  item: ClientPulseItem;
}

const SOURCE_LABEL: Record<string, { text: string; cls: string }> = {
  paper: { text: "PAPER", cls: "text-forest border-forest" },
  news: { text: "NEWS", cls: "text-teal border-teal" },
  github: { text: "GITHUB", cls: "text-purplepill border-purplepill" },
  x: { text: "X", cls: "text-cyanpill border-cyanpill" },
};

export function PulseCard({ item }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [askSeed, setAskSeed] = useState<string | null>(null);
  const src = SOURCE_LABEL[item.source] ?? { text: item.source.toUpperCase(), cls: "" };

  return (
    <article className="bg-parchment border border-parchment-dark shadow-sm p-6 mb-6">
      <div className="flex gap-2 mb-3">
        <span className={`pulse-pill ${src.cls}`}>{src.text}</span>
        <span className="pulse-pill text-zinc-700 border-zinc-400">{item.complexity.toUpperCase()}</span>
        {item.priority === "high" && (
          <span className="pulse-pill text-goldpill border-goldpill">★ Essential</span>
        )}
      </div>

      <h2 className="font-serif text-2xl leading-tight mb-2">{item.title}</h2>

      <div className="pulse-mono text-xs uppercase tracking-wider mb-4 text-zinc-600">
        {item.source.toUpperCase()} · {item.outlet ?? "—"} · {item.read_minutes ?? "?"} MIN READ
      </div>

      <blockquote className="pulse-pullquote my-4 text-base">› {item.summary}</blockquote>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="pulse-mono text-xs text-brick uppercase tracking-wider mb-4"
      >
        {expanded ? "▲ Hide full text" : "▶ Read full"}
      </button>

      {expanded && (
        <div className="prose max-w-none my-4 whitespace-pre-wrap font-serif text-base">
          {item.body_md ?? <em>Body not yet fetched. Click a quick action or Ask agent to load.</em>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6 my-4">
        <div>
          <div className="pulse-mono text-xs uppercase tracking-wider text-zinc-600">Match</div>
          <div className="pulse-mono text-base text-brick">
            {"■".repeat(item.match_score)}
            {"□".repeat(5 - item.match_score)}
          </div>
        </div>
        <div>
          <div className="pulse-mono text-xs uppercase tracking-wider text-zinc-600">Complexity</div>
          <div className="font-serif">{item.complexity}</div>
        </div>
        <div>
          <div className="pulse-mono text-xs uppercase tracking-wider text-zinc-600">Read Time</div>
          <div className="font-serif">{item.read_minutes ?? "?"} min</div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap mb-2">
        {item.topics.map((t) => (
          <span key={t} className="pulse-pill text-zinc-600 border-zinc-400">{t}</span>
        ))}
      </div>

      <QuickActions onAction={(prompt) => setAskSeed(prompt)} />
      <AskAgentBox item={item} seed={askSeed} onConsumeSeed={() => setAskSeed(null)} />
      <FeedbackStrip item={item} />
    </article>
  );
}
```

- [ ] **Step 4: `PulseFeed`**

```typescript
"use client";

import type { ClientPulseItem } from "./types";
import { PulseCard } from "./PulseCard";
import { useFilterStore } from "@/lib/pulse/store";

interface Props {
  initialItems: ClientPulseItem[];
}

export function PulseFeed({ initialItems }: Props) {
  const { topic } = useFilterStore();
  const items = topic ? initialItems.filter((i) => i.topics.includes(topic)) : initialItems;
  if (items.length === 0) {
    return <p className="font-serif italic">No items match.</p>;
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
      {items.map((i) => (
        <PulseCard key={i.id} item={i} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Commit (`AskAgentBox` is stubbed until Task 24; create a placeholder so the build compiles)**

Create `components/pulse/AskAgentBox.tsx` (placeholder):

```typescript
"use client";

import type { ClientPulseItem } from "./types";

interface Props {
  item: ClientPulseItem;
  seed: string | null;
  onConsumeSeed: () => void;
}

export function AskAgentBox({ item, seed, onConsumeSeed }: Props) {
  return (
    <div className="mt-4 pulse-mono text-xs text-zinc-500">
      ● Ask agent input lands in Task 24. Item: {item.id}.
      {seed && <span> (pending: “{seed.slice(0, 40)}…”)</span>}
      {seed && (
        <button className="ml-2 underline" onClick={onConsumeSeed}>
          dismiss
        </button>
      )}
    </div>
  );
}
```

```bash
git add components/pulse/PulseCard.tsx components/pulse/FeedbackStrip.tsx components/pulse/QuickActions.tsx components/pulse/PulseFeed.tsx components/pulse/AskAgentBox.tsx
git commit -m "feat(pulse): editorial card + feedback strip + quick actions"
```

- [ ] **Step 6: Visual check**

```bash
npm run dev
# open http://localhost:3003/pulse and verify cards render with the smoke-tested data from Task 12
```

If cards don't appear, run Task 16 (`POST /api/pulse/generate`) again or `npm run pulse:generate` to populate the DB.

---

## Task 23: Ask agent SSE route `/api/pulse/ask`

**Files:**
- Create: `app/api/pulse/ask/route.ts`

- [ ] **Step 1: Implement**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { z } from "zod";
import { openDb, migrate, getPulseItems, getUsageForDate, addUsageCost } from "@/lib/pulse/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  item_id: z.number().int().positive(),
  message: z.string().min(1).max(4000),
});

function dbPath() {
  return process.env.PULSE_DB_PATH ?? path.resolve(process.cwd(), "data", "pulse.db");
}

function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function findItem(item_id: number) {
  const db = openDb(dbPath());
  migrate(db);
  const stmt = db.prepare("SELECT pulse_id FROM pulse_items WHERE id = ?");
  const row = stmt.get(item_id) as { pulse_id: number } | undefined;
  if (!row) {
    db.close();
    return null;
  }
  const items = getPulseItems(db, row.pulse_id);
  const item = items.find((i) => i.id === item_id) ?? null;
  db.close();
  return item;
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400 });
  }
  const { item_id, message } = parsed.data;

  const date_key = localDateKey();
  const dbCheck = openDb(dbPath());
  migrate(dbCheck);
  const used = getUsageForDate(dbCheck, date_key);
  dbCheck.close();
  const budget = parseFloat(process.env.MAX_BUDGET_USD ?? "2.0");
  if (used >= budget) {
    return new Response(JSON.stringify({ error: "daily budget reached" }), { status: 402 });
  }

  const item = findItem(item_id);
  if (!item) return new Response(JSON.stringify({ error: "item not found" }), { status: 404 });

  const heavyKeywords = /(explain in depth|compare to|deep dive)/i;
  const model = heavyKeywords.test(message)
    ? "claude-sonnet-4-5-20251001"
    : "claude-haiku-4-5-20251001";

  const system = `You are the Daily Pulse per-item agent. The user is asking about ONE specific item.

Item:
- Title: ${item.title}
- Source: ${item.source} (${item.outlet ?? "n/a"})
- URL: ${item.url}
- Summary: ${item.summary}
${item.body_md ? `- Body:\n${item.body_md.slice(0, 4000)}` : ""}

Be concise. Use markdown. If the user asks for a diagram, use ASCII or mermaid. Cite the source URL where relevant.`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let totalCost = 0;
      try {
        const it = query({
          prompt: message,
          options: {
            model,
            systemPrompt: system,
            maxTurns: 3,
            allowedTools: ["mcp__exa-search__find_similar", "mcp__exa-search__get_contents"],
          },
        });
        for await (const msg of it) {
          if (msg.type === "assistant") {
            for (const block of msg.message.content) {
              if (block.type === "text") {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: block.text })}\n\n`));
              }
            }
          }
          if (msg.type === "result") {
            totalCost = msg.total_cost_usd ?? 0;
          }
        }
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ cost_usd: totalCost })}\n\n`));
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`
          )
        );
      } finally {
        if (totalCost > 0) {
          const db = openDb(dbPath());
          migrate(db);
          addUsageCost(db, date_key, totalCost, new Date().toISOString());
          db.close();
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/pulse/ask/route.ts
git commit -m "feat(pulse): /api/pulse/ask SSE route with item context + budget gate"
```

---

## Task 24: Replace `AskAgentBox` stub with real streaming UI

**Files:**
- Modify: `components/pulse/AskAgentBox.tsx`

- [ ] **Step 1: Replace placeholder**

Overwrite `components/pulse/AskAgentBox.tsx`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import type { ClientPulseItem } from "./types";

interface Props {
  item: ClientPulseItem;
  seed: string | null;
  onConsumeSeed: () => void;
}

interface Turn {
  role: "user" | "agent";
  text: string;
}

export function AskAgentBox({ item, seed, onConsumeSeed }: Props) {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (seed) {
      setInput(seed);
      void send(seed);
      onConsumeSeed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  async function send(message: string) {
    setStreaming(true);
    setError(null);
    setTurns((prev) => [...prev, { role: "user", text: message }, { role: "agent", text: "" }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/pulse/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: item.id, message }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          if (!ev.trim()) continue;
          const dataLine = ev.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const j = JSON.parse(dataLine.slice(5).trim());
            if (j.delta) {
              setTurns((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "agent", text: next[next.length - 1].text + j.delta };
                return next;
              });
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = input.trim();
    if (!t || streaming) return;
    setInput("");
    void send(t);
  }

  const tooLong = turns.filter((t) => t.role === "user").length >= 6;

  return (
    <div className="mt-6">
      <div className="pulse-mono text-xs uppercase tracking-wider mb-2 text-brick">● Ask agent about this item</div>

      {turns.length > 0 && (
        <div className="space-y-3 mb-3 font-serif text-base">
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "text-zinc-700" : "text-zinc-900"}>
              <span className="pulse-mono text-xs uppercase mr-2">{t.role === "user" ? "You:" : "Agent:"}</span>
              <span className="whitespace-pre-wrap">{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {tooLong && (
        <div className="pulse-mono text-xs text-zinc-500 mb-2">
          Long thread — consider starting fresh for focus.
        </div>
      )}
      {error && <div className="pulse-mono text-xs text-brick mb-2">Error: {error}</div>}

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about this item..."
          className="flex-1 bg-zinc-900 text-parchment px-3 py-2 pulse-mono text-sm"
          disabled={streaming}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="pulse-mono text-xs uppercase border border-zinc-900 px-3 py-2 hover:bg-zinc-900 hover:text-parchment transition-colors disabled:opacity-40"
        >
          Send →
        </button>
      </form>
      <div className="pulse-mono text-xs text-zinc-500 mt-1">
        Enter to send · Shift+Enter for new line
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pulse/AskAgentBox.tsx
git commit -m "feat(pulse): AskAgentBox with SSE streaming + 6-turn soft cap"
```

- [ ] **Step 3: Manual verification**

```bash
npm run dev
# open http://localhost:3003/pulse
# 1. Click a quick action on a card → response streams in
# 2. Type a follow-up → response streams in
# 3. Like a card → check sqlite3 data/pulse.db "SELECT * FROM feedback ORDER BY id DESC LIMIT 5"
# 4. Click a topic chip in sidebar → cards narrow
# 5. Click a past pulse in History → navigates to /pulse/<date>
```

---

## Task 25: launchd plist + installer

**Files:**
- Create: `scripts/install-launchd.sh`
- Create: `scripts/uninstall-launchd.sh`
- Create: `scripts/com.user.daily-pulse.plist.template`

- [ ] **Step 1: Plist template**

Create `scripts/com.user.daily-pulse.plist.template`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>           <string>com.user.daily-pulse</string>
  <key>ProgramArguments</key>
  <array>
    <string>__NPX_BIN__</string>
    <string>tsx</string>
    <string>__REPO__/scripts/generate-pulse.ts</string>
  </array>
  <key>WorkingDirectory</key><string>__REPO__</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>          <integer>7</integer>
    <key>Minute</key>        <integer>0</integer>
  </dict>
  <key>StandardOutPath</key> <string>__REPO__/data/pulse.log</string>
  <key>StandardErrorPath</key><string>__REPO__/data/pulse.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>          <string>__PATH__</string>
  </dict>
</dict>
</plist>
```

- [ ] **Step 2: Installer**

Create `scripts/install-launchd.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NPX_BIN="$(command -v npx)"
if [ -z "$NPX_BIN" ]; then
  echo "npx not found in PATH" >&2
  exit 1
fi
PATH_ENV="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$(dirname "$NPX_BIN")"

PLIST_DEST="$HOME/Library/LaunchAgents/com.user.daily-pulse.plist"
mkdir -p "$HOME/Library/LaunchAgents"

sed \
  -e "s|__REPO__|$REPO|g" \
  -e "s|__NPX_BIN__|$NPX_BIN|g" \
  -e "s|__PATH__|$PATH_ENV|g" \
  "$REPO/scripts/com.user.daily-pulse.plist.template" > "$PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "[install-launchd] loaded $PLIST_DEST"
echo "[install-launchd] next run: tomorrow 07:00 local"
echo "[install-launchd] to test now: launchctl start com.user.daily-pulse"
```

Make executable:

```bash
chmod +x /Users/waleedarafa/projects/deep-ai-research/scripts/install-launchd.sh
```

- [ ] **Step 3: Uninstaller**

Create `scripts/uninstall-launchd.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
PLIST="$HOME/Library/LaunchAgents/com.user.daily-pulse.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "[uninstall-launchd] removed $PLIST"
```

```bash
chmod +x /Users/waleedarafa/projects/deep-ai-research/scripts/uninstall-launchd.sh
```

- [ ] **Step 4: Test load + manual trigger**

```bash
bash /Users/waleedarafa/projects/deep-ai-research/scripts/install-launchd.sh
launchctl start com.user.daily-pulse
sleep 60
sqlite3 data/pulse.db "SELECT id, date_key, status FROM pulses ORDER BY id DESC LIMIT 3"
tail -20 data/pulse.log
```

Expected: a new pulse row was written (or the existing one for today is unchanged because `date_key` is unique — that's correct behavior).

- [ ] **Step 5: Commit**

```bash
git add scripts/install-launchd.sh scripts/uninstall-launchd.sh scripts/com.user.daily-pulse.plist.template
git commit -m "feat(pulse): launchd plist template + install/uninstall scripts"
```

---

## Task 26: Coverage gate + final verification

**Files:** none changed.

- [ ] **Step 1: Run full test suite with coverage**

```bash
cd /Users/waleedarafa/projects/deep-ai-research
npm run test:coverage 2>&1 | tail -40
```

Expected:
- All tests passing
- `lib/pulse/**` coverage ≥ 80% lines / 80% functions / 75% branches / 80% statements

If below threshold, find the file in the coverage report and add a focused unit test. Do not loosen the threshold to make it pass.

- [ ] **Step 2: End-to-end sanity checklist**

| Check | Pass criterion |
|---|---|
| `npm run pulse:generate` finishes with `status: ok` or `partial` | ✔ |
| `/api/pulse/today` returns ≥1 item | ✔ |
| `/api/pulse/history` returns ≥1 entry | ✔ |
| `/pulse` page renders cards in the cream + brick palette | ✔ |
| Topic filter narrows cards | ✔ |
| History link navigates to `/pulse/[date]` | ✔ |
| Like/Dislike/Bookmark writes a `feedback` row | ✔ |
| Click a quick action → text streams into AskAgentBox | ✔ |
| Manual follow-up question → streams a response | ✔ |
| Running pipeline a second time on the same day is a no-op (the `date_key UNIQUE` constraint catches it) | ✔ |
| `launchctl list | grep daily-pulse` shows the job loaded | ✔ |

- [ ] **Step 3: Final commit & summary**

If everything passes, no commit needed. If you fixed anything during verification, commit those fixes with descriptive messages.

```bash
git log --oneline ^main HEAD 2>/dev/null | head -30
```

Expected: ~26 commits forming a clean, reviewable history.

---

## Notes for the executor

- **Repo path:** Every `npm`, `npx`, `tsx`, `git` command in this plan runs from `/Users/waleedarafa/projects/deep-ai-research/`. Use absolute paths when calling node scripts.
- **Pre-existing TS errors:** `app/api/agent/query/route.ts` and `components/ProgressTracker.tsx` have type errors from the `/research` feature. Do NOT fix them in this plan — they are out of scope. `next dev` runs through them.
- **Stop the dev server before `pulse:generate`** to avoid SQLite WAL races during smoke tests.
- **Cost expectation:** each full pipeline run is ~$0.05–$0.20 with Haiku. Each Ask agent turn is ~$0.005–$0.03.
- **TZ:** all `date_key` values use **local Mac time** (`localDateKey()` in the script). All `generated_at` / `created_at` use UTC ISO 8601.
- **Failure budget:** if the orchestrator hangs, the SDK enforces `MAX_TURNS=40` and `MAX_BUDGET_USD=2.0`. Kill manually with `launchctl stop com.user.daily-pulse` or `kill <pid>` if needed.
