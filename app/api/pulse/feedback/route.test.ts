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
