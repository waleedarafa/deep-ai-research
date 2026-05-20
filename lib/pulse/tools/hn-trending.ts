import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export interface HNStory {
  id: number;
  title: string;
  url: string;
  hn_url: string;
  score: number;
  descendants: number;
  by: string;
  time: number;
  age_hours: number;
}

const HN_API = "https://hacker-news.firebaseio.com/v0";

// Word-boundary patterns: each entry is matched as a whole token (with \b) so
// "ai" does not match "rain"/"Spain"/"explain". Multi-word phrases are matched
// literally with surrounding word boundaries.
const AI_KEYWORD_PATTERNS = [
  "llm",
  "llms",
  "gpt",
  "claude",
  "anthropic",
  "openai",
  "deepmind",
  "gemini",
  "mistral",
  "llama",
  "qwen",
  "agent",
  "agents",
  "rag",
  "transformer",
  "transformers",
  "diffusion",
  "huggingface",
  "ai safety",
  "ai model",
  "ai models",
  "ai agent",
  "ai agents",
  "machine learning",
  "deep learning",
  "neural network",
  "neural networks",
  "fine-tuning",
  "ai-generated",
  // standalone "ai" handled with strict word boundaries below
  "\\bai\\b",
];

const AI_TITLE_REGEX = new RegExp(
  `\\b(?:${AI_KEYWORD_PATTERNS.map((p) => (p.startsWith("\\b") ? p.slice(2, -2) : p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("|")})\\b`,
  "i"
);

function titleMatchesAI(title: string): boolean {
  return AI_TITLE_REGEX.test(title);
}

export interface FetchHNOptions {
  sinceHours: number;
  limit: number;
  minScore: number;
}

export async function fetchTrendingAIStories(opts: FetchHNOptions): Promise<HNStory[]> {
  const idsRes = await fetch(`${HN_API}/topstories.json`);
  if (!idsRes.ok) {
    throw new Error(`HN topstories failed: ${idsRes.status} ${idsRes.statusText}`);
  }
  const ids = (await idsRes.json()) as number[];
  const sliced = ids.slice(0, 200);

  const stories: HNStory[] = [];
  const cutoffSec = Math.floor((Date.now() - opts.sinceHours * 3_600_000) / 1000);

  const BATCH = 20;
  for (let i = 0; i < sliced.length; i += BATCH) {
    const batch = sliced.slice(i, i + BATCH);
    const fetched = await Promise.all(
      batch.map(async (id) => {
        try {
          const res = await fetch(`${HN_API}/item/${id}.json`);
          if (!res.ok) return null;
          return (await res.json()) as Record<string, unknown> | null;
        } catch {
          return null;
        }
      })
    );
    for (const item of fetched) {
      if (!item) continue;
      if (item.type !== "story") continue;
      if (item.dead || item.deleted) continue;
      const title = String(item.title ?? "");
      const score = Number(item.score ?? 0);
      const time = Number(item.time ?? 0);
      if (time < cutoffSec) continue;
      if (score < opts.minScore) continue;
      if (!titleMatchesAI(title)) continue;
      const id = Number(item.id);
      stories.push({
        id,
        title,
        url: (item.url as string | undefined) ?? `https://news.ycombinator.com/item?id=${id}`,
        hn_url: `https://news.ycombinator.com/item?id=${id}`,
        score,
        descendants: Number(item.descendants ?? 0),
        by: String(item.by ?? "unknown"),
        time,
        age_hours: Math.round((Date.now() / 1000 - time) / 3600),
      });
    }
    if (stories.length >= opts.limit * 2) break;
  }

  return stories.sort((a, b) => b.score - a.score).slice(0, opts.limit);
}

export const hnTrendingTools = createSdkMcpServer({
  name: "hn-trending",
  version: "1.0.0",
  tools: [
    tool(
      "list_trending",
      "List Hacker News top stories from the last N hours whose titles match AI/ML keywords, sorted by score.",
      {
        since_hours: z.number().min(1).max(168).default(36),
        limit: z.number().min(1).max(20).default(8),
        min_score: z.number().min(0).max(2000).default(50),
      },
      async (args) => {
        const stories = await fetchTrendingAIStories({
          sinceHours: args.since_hours,
          limit: args.limit,
          minScore: args.min_score,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(stories, null, 2) }],
        };
      }
    ),
  ],
});
