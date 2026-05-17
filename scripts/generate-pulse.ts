#!/usr/bin/env tsx
import { query } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { openDb, migrate, createPulse, insertPulseItem, getPulseItems, updatePulseStatus, listPulses, addUsageCost } from "../lib/pulse/db";
import { buildPreferences, writePreferencesFile, type Preferences } from "../lib/pulse/preferences";
import { rankCandidates, type Candidate, type RankerLLMResponse } from "../lib/pulse/ranker";
import { buildPulseOrchestratorConfig } from "../lib/pulse/config";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local") });

const REPO_ROOT = process.cwd();
const DATA_DIR = path.resolve(REPO_ROOT, "data");
const DB_PATH = path.resolve(DATA_DIR, "pulse.db");
const PREFS_PATH = path.resolve(DATA_DIR, "preferences.json");
const MAX_BUDGET = parseFloat(process.env.MAX_BUDGET_USD ?? "2.0");
const MAX_TURNS = parseInt(process.env.MAX_TURNS ?? "40", 10);

function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function callRankerLLM(prompt: string): Promise<RankerLLMResponse> {
  let collected = "";
  const it = query({
    prompt,
    options: {
      model: "claude-haiku-4-5-20251001",
      systemPrompt: "Return only the JSON requested in the user prompt. No prose.",
      maxTurns: 2,
    },
  });
  for await (const msg of it) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") collected += block.text;
      }
    }
  }
  const match = collected.match(/```json\s*([\s\S]+?)\s*```/) ?? collected.match(/(\{[\s\S]+\})/);
  if (!match) throw new Error(`Ranker returned no parseable JSON: ${collected.slice(0, 300)}`);
  return JSON.parse(match[1]) as RankerLLMResponse;
}

function extractCandidatesFromAgentOutput(raw: string): { candidates: Candidate[]; preferences: Preferences | null } {
  const block = raw.match(/```json\s*([\s\S]+?)\s*```/);
  const parsed = block ? JSON.parse(block[1]) : JSON.parse(raw);
  return { candidates: parsed.candidates ?? [], preferences: parsed.preferences ?? null };
}

async function main() {
  const start = Date.now();
  const db = openDb(DB_PATH);
  migrate(db);

  const date_key = localDateKey();
  const generated_at = new Date().toISOString();

  console.log(`[pulse] generating for ${date_key}`);
  const prefs = buildPreferences(db, { now: new Date(), windowDays: 30 });
  writePreferencesFile(PREFS_PATH, prefs);
  console.log(`[pulse] preferences written (cold_start=${prefs.cold_start}, liked=${prefs.counts.liked})`);

  let pulse_id: number;
  try {
    pulse_id = createPulse(db, { generated_at, date_key, item_count: 0, status: "running" });
  } catch (e) {
    console.error(`[pulse] pulse for ${date_key} already exists; aborting.`);
    process.exit(0);
  }

  const cfg = buildPulseOrchestratorConfig({
    preferencesPath: PREFS_PATH,
    maxBudgetUsd: MAX_BUDGET,
    maxTurns: MAX_TURNS,
  });

  let agentText = "";
  let costUsd = 0;
  let status: "ok" | "partial" | "failed" = "ok";

  try {
    const it = query({
      prompt: `Generate the candidate set for ${date_key}. Dispatch all four curators in parallel via Task. Output the JSON in the format the system prompt requires.`,
      options: cfg,
    });
    for await (const msg of it) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") agentText += block.text;
        }
      }
      if (msg.type === "result") {
        costUsd = msg.total_cost_usd ?? 0;
      }
    }
  } catch (e) {
    console.error("[pulse] orchestrator failed:", e);
    status = "failed";
  }

  if (status !== "failed") {
    let candidates: Candidate[] = [];
    try {
      const parsed = extractCandidatesFromAgentOutput(agentText);
      candidates = parsed.candidates ?? [];
      if (candidates.length === 0) status = "partial";
    } catch (e) {
      console.error("[pulse] could not parse orchestrator JSON:", e);
      status = "partial";
    }

    const recentUrls = listPulses(db, 30)
      .flatMap((p) => getPulseItems(db, p.id))
      .map((i) => i.url);

    const ranked = await rankCandidates({
      candidates,
      preferences: prefs,
      recentPulseUrls: recentUrls,
      queryLLM: callRankerLLM,
    });

    for (const item of ranked) {
      try {
        insertPulseItem(db, {
          pulse_id,
          rank: item.rank,
          source: item.source,
          priority: item.priority,
          match_score: item.match_score,
          complexity: item.complexity,
          read_minutes: item.read_minutes,
          title: item.title,
          url: item.url,
          outlet: item.outlet ?? "",
          summary: item.summary ?? "",
          topics: Array.isArray(item.topics) ? item.topics : [],
          source_meta: item.source_meta ?? {},
          created_at: new Date().toISOString(),
        });
      } catch (e) {
        // dedupe collision or insert error; surface details so it isn't silently swallowed
        const reason = e instanceof Error ? e.message : String(e);
        console.warn(`[pulse] skipping item url=${item.url} reason=${reason}`);
      }
    }

    if (ranked.length === 0) status = "partial";
    updatePulseStatus(db, pulse_id, {
      status,
      item_count: ranked.length,
      cost_usd: costUsd,
      duration_ms: Date.now() - start,
    });
    addUsageCost(db, date_key, costUsd, new Date().toISOString());
  } else {
    updatePulseStatus(db, pulse_id, {
      status: "failed",
      item_count: 0,
      cost_usd: costUsd,
      duration_ms: Date.now() - start,
    });
  }

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      date_key,
      status,
      cost_usd: costUsd,
      duration_ms: Date.now() - start,
    })
  );

  db.close();
}

main().catch((err) => {
  console.error("[pulse] fatal:", err);
  process.exit(1);
});
