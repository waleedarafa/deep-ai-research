import { NextResponse } from "next/server";
import path from "node:path";
import { z } from "zod";
import Exa from "exa-js";
import {
  openDb,
  migrate,
  getPulseItemById,
  setItemBodyMd,
} from "@/lib/pulse/db";

export const dynamic = "force-dynamic";

const Body = z.object({ item_id: z.number().int().positive() });

function dbPath() {
  return process.env.PULSE_DB_PATH ?? path.resolve(process.cwd(), "data", "pulse.db");
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = openDb(dbPath());
  try {
    migrate(db);
    const item = getPulseItemById(db, parsed.data.item_id);
    if (!item) {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }
    if (item.body_md) {
      return NextResponse.json({ body_md: item.body_md, cached: true });
    }

    const apiKey = process.env.EXA_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "EXA_API_KEY not configured" }, { status: 500 });
    }

    const exa = new Exa(apiKey);
    let bodyMd: string;
    try {
      const result = await exa.getContents([item.url], {
        text: { maxCharacters: 8000 } as { maxCharacters: number },
      });
      const first = result.results?.[0] as { text?: string } | undefined;
      bodyMd = first?.text ?? "";
      if (!bodyMd.trim()) {
        return NextResponse.json({ error: "no content returned" }, { status: 502 });
      }
    } catch (err) {
      console.error("[pulse/expand] exa error", err);
      return NextResponse.json({ error: "fetch failed" }, { status: 502 });
    }

    setItemBodyMd(db, item.id, bodyMd);
    return NextResponse.json({ body_md: bodyMd, cached: false });
  } catch (err) {
    console.error("[pulse/expand] db error", err);
    return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  } finally {
    db.close();
  }
}
