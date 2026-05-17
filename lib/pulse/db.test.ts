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
