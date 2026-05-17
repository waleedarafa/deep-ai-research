import { NextResponse } from "next/server";
import path from "node:path";
import { openDb, migrate, getLatestPulse, getPulseItems } from "@/lib/pulse/db";

export const dynamic = "force-dynamic";

function dbPath() {
  return process.env.PULSE_DB_PATH ?? path.resolve(process.cwd(), "data", "pulse.db");
}

export async function GET() {
  const db = openDb(dbPath());
  try {
    migrate(db);
    const pulse = getLatestPulse(db);
    if (!pulse) {
      return NextResponse.json({ pulse: null, items: [] });
    }
    const items = getPulseItems(db, pulse.id);
    return NextResponse.json({ pulse, items });
  } catch (err) {
    console.error("[pulse/today] db error", err);
    return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  } finally {
    db.close();
  }
}
