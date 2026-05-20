import type { Preferences } from "./preferences";
import type { ItemPriority, ItemComplexity, ItemSource } from "./db";

export interface Candidate {
  title: string;
  url: string;
  summary: string;
  outlet: string;
  source: ItemSource;
  topics: string[];
  source_meta: Record<string, unknown>;
}

export interface RankedItem extends Candidate {
  rank: number;
  priority: ItemPriority;
  match_score: number;
  complexity: ItemComplexity;
  read_minutes: number;
}

export interface RankerLLMResponse {
  picks: Array<{
    url: string;
    priority: ItemPriority;
    match_score: number;
    complexity: ItemComplexity;
    read_minutes: number;
  }>;
}

export interface RankInput {
  candidates: Candidate[];
  preferences: Preferences;
  recentPulseUrls: string[];
  queryLLM: (prompt: string) => Promise<RankerLLMResponse>;
}

const TOP_N = 10;
const MAX_PER_SOURCE = 5;

function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (k.toLowerCase().startsWith("utm_")) u.searchParams.delete(k);
    }
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function buildRankerPrompt(input: Omit<RankInput, "queryLLM">): string {
  const liked = input.preferences.samples.liked
    .slice(0, 10)
    .map((s, i) => `  ${i + 1}. [${s.source}] ${s.title} — ${s.summary.slice(0, 140)}`)
    .join("\n");
  const disliked = input.preferences.samples.disliked
    .slice(0, 10)
    .map((s, i) => `  ${i + 1}. [${s.source}] ${s.title} — ${s.summary.slice(0, 140)}`)
    .join("\n");
  const cands = input.candidates
    .map(
      (c, i) =>
        `  ${i}. [${c.source}] ${c.title}\n    url: ${c.url}\n    topics: ${c.topics.join(",")}\n    summary: ${c.summary.slice(0, 200)}`
    )
    .join("\n");
  const recent = input.recentPulseUrls.slice(0, 100).join(", ");

  return `You are ranking AI/ML items for a single user's morning feed.

cold_start: ${input.preferences.cold_start}
source_weights: ${JSON.stringify(input.preferences.source_weights)}
loved_topics: ${input.preferences.topic_signals.loved.join(", ")}
avoided_topics: ${input.preferences.topic_signals.avoided.join(", ")}

LIKED EXAMPLES:
${liked || "  (none)"}

DISLIKED EXAMPLES:
${disliked || "  (none)"}

CANDIDATES:
${cands}

RECENT URLS (do not pick): ${recent || "(none)"}

Pick up to 10 items in display order. Rules:
- At most ${MAX_PER_SOURCE} from any one source.
- Up to 2 items should be 'medium' priority from topics user has NOT engaged with (exploration). If fewer such candidates exist, fill with next-best familiar items.
- If cold_start is true, ignore liked/disliked and rank by recency × source diversity × novelty.

Output ONLY this JSON (no prose):
\`\`\`json
{
  "picks": [
    {"url": "...", "priority": "high"|"medium", "match_score": 1..5, "complexity": "beginner"|"intermediate"|"advanced", "read_minutes": number}
  ]
}
\`\`\``;
}

function dedupeAndDrop(candidates: Candidate[], recentUrls: string[]): Candidate[] {
  const blocked = new Set(recentUrls.map(normalize));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of candidates) {
    const key = normalize(c.url);
    if (blocked.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function fallbackRank(candidates: Candidate[]): RankedItem[] {
  const sourceCounts: Record<string, number> = {};
  const ranked: RankedItem[] = [];
  for (const c of candidates) {
    const used = sourceCounts[c.source] ?? 0;
    if (used >= MAX_PER_SOURCE) continue;
    sourceCounts[c.source] = used + 1;
    ranked.push({
      ...c,
      rank: ranked.length + 1,
      priority: ranked.length < 3 ? "high" : "medium",
      match_score: 3,
      complexity: "intermediate",
      read_minutes: 5,
    });
    if (ranked.length >= TOP_N) break;
  }
  return ranked;
}

function enforceSourceFloor(items: RankedItem[]): RankedItem[] {
  const out: RankedItem[] = [];
  const sourceCounts: Record<string, number> = {};
  for (const it of items) {
    const used = sourceCounts[it.source] ?? 0;
    if (used >= MAX_PER_SOURCE) continue;
    sourceCounts[it.source] = used + 1;
    out.push({ ...it, rank: out.length + 1 });
    if (out.length >= TOP_N) break;
  }
  return out;
}

function topUpFromRemainder(
  current: RankedItem[],
  pool: Candidate[],
  alreadyPicked: Set<string>
): RankedItem[] {
  const sourceCounts: Record<string, number> = {};
  for (const it of current) sourceCounts[it.source] = (sourceCounts[it.source] ?? 0) + 1;

  const out = [...current];
  for (const cand of pool) {
    if (out.length >= TOP_N) break;
    const key = normalize(cand.url);
    if (alreadyPicked.has(key)) continue;
    const used = sourceCounts[cand.source] ?? 0;
    if (used >= MAX_PER_SOURCE) continue;
    sourceCounts[cand.source] = used + 1;
    alreadyPicked.add(key);
    out.push({
      ...cand,
      rank: out.length + 1,
      priority: "medium",
      match_score: 2,
      complexity: "intermediate",
      read_minutes: 5,
    });
  }
  return out;
}

export function passthroughRank(
  candidates: Candidate[],
  recentPulseUrls: string[]
): RankedItem[] {
  const filtered = dedupeAndDrop(candidates, recentPulseUrls);
  return filtered.map((c, i) => ({
    ...c,
    rank: i + 1,
    priority: "medium",
    match_score: 3,
    complexity: "intermediate",
    read_minutes: 5,
  }));
}

export async function rankCandidates(input: RankInput): Promise<RankedItem[]> {
  const filtered = dedupeAndDrop(input.candidates, input.recentPulseUrls);
  if (filtered.length === 0) return [];

  let response: RankerLLMResponse;
  try {
    response = await input.queryLLM(
      buildRankerPrompt({
        candidates: filtered,
        preferences: input.preferences,
        recentPulseUrls: input.recentPulseUrls,
      })
    );
  } catch {
    return fallbackRank(filtered);
  }

  const byUrl = new Map(filtered.map((c) => [normalize(c.url), c]));
  const ordered: RankedItem[] = [];
  const seen = new Set<string>();
  for (const pick of response.picks) {
    const key = normalize(pick.url);
    if (seen.has(key)) continue;
    const cand = byUrl.get(key);
    if (!cand) continue;
    seen.add(key);
    ordered.push({
      ...cand,
      rank: ordered.length + 1,
      priority: pick.priority,
      match_score: Math.max(1, Math.min(5, Math.round(pick.match_score))),
      complexity: pick.complexity,
      read_minutes: Math.max(1, Math.round(pick.read_minutes)),
    });
  }

  const floored = enforceSourceFloor(ordered);
  if (floored.length >= TOP_N) return floored;
  return topUpFromRemainder(floored, filtered, seen);
}
