import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { z } from "zod";
import { openDb, migrate, getPulseItems, getUsageForDate, addUsageCost } from "@/lib/pulse/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  item_id: z.number().int().positive(),
  message: z.string().min(1).max(4000),
});

function dbPath() {
  return process.env.PULSE_DB_PATH ?? path.resolve(process.cwd(), "data", "pulse.db");
}

function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function findItem(item_id: number) {
  const db = openDb(dbPath());
  migrate(db);
  const stmt = db.prepare("SELECT pulse_id FROM pulse_items WHERE id = ?");
  const row = stmt.get(item_id) as { pulse_id: number } | undefined;
  if (!row) {
    db.close();
    return null;
  }
  const items = getPulseItems(db, row.pulse_id);
  const item = items.find((i) => i.id === item_id) ?? null;
  db.close();
  return item;
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.flatten() }), { status: 400 });
  }
  const { item_id, message } = parsed.data;

  const date_key = localDateKey();
  const dbCheck = openDb(dbPath());
  migrate(dbCheck);
  const used = getUsageForDate(dbCheck, date_key);
  dbCheck.close();
  const budget = parseFloat(process.env.MAX_BUDGET_USD ?? "2.0");
  if (used >= budget) {
    return new Response(JSON.stringify({ error: "daily budget reached" }), { status: 402 });
  }

  const item = findItem(item_id);
  if (!item) return new Response(JSON.stringify({ error: "item not found" }), { status: 404 });

  const heavyKeywords = /(explain in depth|compare to|deep dive)/i;
  const model = heavyKeywords.test(message)
    ? "claude-sonnet-4-5-20251001"
    : "claude-haiku-4-5-20251001";

  const system = `You are the Daily Pulse per-item agent. The user is asking about ONE specific item.

Item:
- Title: ${item.title}
- Source: ${item.source} (${item.outlet ?? "n/a"})
- URL: ${item.url}
- Summary: ${item.summary}
${item.body_md ? `- Body:\n${item.body_md.slice(0, 4000)}` : ""}

Be concise. Use markdown. If the user asks for a diagram, use ASCII or mermaid. Cite the source URL where relevant.`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let totalCost = 0;
      try {
        const it = query({
          prompt: message,
          options: {
            model,
            systemPrompt: system,
            maxTurns: 3,
            allowedTools: ["mcp__exa-search__find_similar", "mcp__exa-search__get_contents"],
          },
        });
        for await (const msg of it) {
          if (msg.type === "assistant") {
            for (const block of msg.message.content) {
              if (block.type === "text") {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: block.text })}\n\n`));
              }
            }
          }
          if (msg.type === "result") {
            totalCost = msg.total_cost_usd ?? 0;
          }
        }
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ cost_usd: totalCost })}\n\n`));
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`
          )
        );
      } finally {
        if (totalCost > 0) {
          const db = openDb(dbPath());
          migrate(db);
          addUsageCost(db, date_key, totalCost, new Date().toISOString());
          db.close();
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
