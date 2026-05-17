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

import { updatePulseStatus } from "./db";

describe("updatePulseStatus hardening", () => {
  it("ignores unknown fields and updates only allowlisted columns", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pulse-up-"));
    const db = openDb(path.join(dir, "pulse.db"));
    migrate(db);
    const pid = createPulse(db, {
      generated_at: "2026-05-18T07:00:00Z",
      date_key: "2026-05-18",
      item_count: 0,
      status: "running",
    });
    // Cast to bypass TS — simulate a widened object reaching the function
    updatePulseStatus(db, pid, {
      status: "ok",
      item_count: 5,
      // @ts-expect-error injecting an unknown field at runtime
      "id; DROP TABLE pulses; --": "x",
    });
    const row = getPulseByDate(db, "2026-05-18");
    expect(row?.status).toBe("ok");
    expect(row?.item_count).toBe(5);
    // pulses table still exists
    const cnt = db.prepare("SELECT COUNT(*) AS n FROM pulses").get() as { n: number };
    expect(cnt.n).toBe(1);
    db.close();
  });
});
