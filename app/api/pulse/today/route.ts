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
