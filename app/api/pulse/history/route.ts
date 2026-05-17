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
