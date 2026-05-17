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
  try {
    migrate(db);
    addFeedback(db, {
      item_id: parsed.data.item_id,
      action: parsed.data.action,
      created_at: new Date().toISOString(),
      meta: parsed.data.meta,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[pulse/feedback] db error", err);
    return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  } finally {
    db.close();
  }
}
