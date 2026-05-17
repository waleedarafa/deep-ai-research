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
