import { NextResponse } from "next/server";
import path from "node:path";
import { openDb, migrate, listPulses } from "@/lib/pulse/db";

export const dynamic = "force-dynamic";

function dbPath() {
  return process.env.PULSE_DB_PATH ?? path.resolve(process.cwd(), "data", "pulse.db");
}

export async function GET() {
  const db = openDb(dbPath());
  try {
    migrate(db);
    const pulses = listPulses(db, 30);
    return NextResponse.json(
      pulses.map((p) => ({
        id: p.id,
        date_key: p.date_key,
        item_count: p.item_count,
        generated_at: p.generated_at,
        status: p.status,
      }))
    );
  } catch (err) {
    console.error("[pulse/history] db error", err);
    return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  } finally {
    db.close();
  }
}
