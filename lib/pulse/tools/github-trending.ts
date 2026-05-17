import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export interface TrendingRepo {
  title: string;
  url: string;
  summary: string;
  stars: number;
  language: string | null;
  created_at: string;
}

export interface FetchOptions {
  since: Date;
  limit: number;
}

const TOPICS = ["llm", "ai", "agents", "ml", "rag"];

function buildSearchUrl(opts: FetchOptions): string {
  const dateStr = opts.since.toISOString().slice(0, 10);
  const topicAlts = TOPICS.map((t) => `topic:${t}`).join(" OR ");
  const q = encodeURIComponent(`created:>${dateStr} (${topicAlts})`);
  return `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${opts.limit}`;
}

export async function fetchTrendingAIRepos(opts: FetchOptions): Promise<TrendingRepo[]> {
  const url = buildSearchUrl(opts);
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "deep-ai-research-pulse" },
  });
  if (!res.ok) {
    throw new Error(`GitHub search failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { items?: Array<Record<string, unknown>> };
  const items = json.items ?? [];
  return items.map((it) => ({
    title: String(it.full_name),
    url: String(it.html_url),
    summary: (it.description as string | null) ?? "",
    stars: Number(it.stargazers_count ?? 0),
    language: (it.language as string | null) ?? null,
    created_at: String(it.created_at),
  }));
}

export const githubTrendingTools = createSdkMcpServer({
  name: "github-trending",
  version: "1.0.0",
  tools: [
    tool(
      "list_trending",
      "List public GitHub repositories created in the last day that match AI/ML/agents/RAG topics, sorted by stars.",
      {
        since_hours: z
          .number()
          .min(1)
          .max(168)
          .default(36)
          .describe("Created within the last N hours."),
        limit: z.number().min(1).max(20).default(15).describe("Max number of repos."),
      },
      async (args) => {
        const since = new Date(Date.now() - args.since_hours * 3_600_000);
        const repos = await fetchTrendingAIRepos({ since, limit: args.limit });
        return {
          content: [
            { type: "text", text: JSON.stringify(repos, null, 2) },
          ],
        };
      }
    ),
  ],
});
