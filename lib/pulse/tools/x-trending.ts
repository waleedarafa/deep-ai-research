import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export interface TrendingTweet {
  title: string;
  url: string;
  summary: string;
  author: string;
  metrics: {
    reply_count: number;
    like_count: number;
    retweet_count: number;
    quote_count: number;
  };
  tweet_id: string;
}

export const CURATED_X_ACCOUNTS: readonly string[] = [
  "AnthropicAI",
  "OpenAI",
  "GoogleDeepMind",
  "elvis_omarsar",
  "omarsar0",
  "karpathy",
  "ylecun",
  "simonw",
  "swyx",
  "_philschmid",
  "lateinteraction",
  "hwchase17",
  "_jasonwei",
  "lmsysorg",
  "AIatMeta",
  "huggingface",
  "alphasignalai",
  "rasbt",
  "jeremyphoward",
  "togethercompute",
];

export function isXAvailable(): boolean {
  return Boolean(process.env.X_BEARER_TOKEN && process.env.X_BEARER_TOKEN.trim());
}

export interface FetchTweetOptions {
  sinceHours: number;
  limit: number;
}

export async function fetchRecentTweets(opts: FetchTweetOptions): Promise<TrendingTweet[]> {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) return [];

  const from = CURATED_X_ACCOUNTS.map((u) => `from:${u}`).join(" OR ");
  const start = new Date(Date.now() - opts.sinceHours * 3_600_000).toISOString();
  const params = new URLSearchParams({
    query: `(${from}) -is:retweet lang:en`,
    max_results: String(Math.min(100, Math.max(10, opts.limit * 4))),
    start_time: start,
    "tweet.fields": "public_metrics,author_id",
    expansions: "author_id",
    "user.fields": "username,name",
  });
  const url = `https://api.x.com/2/tweets/search/recent?${params.toString()}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        text: string;
        author_id: string;
        public_metrics: TrendingTweet["metrics"];
      }>;
      includes?: { users?: Array<{ id: string; username: string; name: string }> };
    };
    const users = new Map((json.includes?.users ?? []).map((u) => [u.id, u]));
    const items = (json.data ?? []).map((t) => {
      const u = users.get(t.author_id);
      const username = u?.username ?? "unknown";
      return {
        title: t.text.split(/\s+/).slice(0, 14).join(" "),
        url: `https://x.com/${username}/status/${t.id}`,
        summary: t.text,
        author: username,
        metrics: t.public_metrics,
        tweet_id: t.id,
      } satisfies TrendingTweet;
    });
    const score = (m: TrendingTweet["metrics"]) =>
      m.like_count + m.retweet_count * 2 + m.reply_count * 1.5 + m.quote_count;
    return items.sort((a, b) => score(b.metrics) - score(a.metrics)).slice(0, opts.limit);
  } catch {
    return [];
  }
}

export const xTrendingTools = createSdkMcpServer({
  name: "x-trending",
  version: "1.0.0",
  tools: [
    tool(
      "list_recent_tweets",
      "Fetch high-signal tweets from a curated AI/ML account list in the last N hours. Returns [] when X_BEARER_TOKEN is unset.",
      {
        since_hours: z.number().min(1).max(72).default(24),
        limit: z.number().min(1).max(20).default(5),
      },
      async (args) => {
        const tweets = await fetchRecentTweets({
          sinceHours: args.since_hours,
          limit: args.limit,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(tweets, null, 2) }],
        };
      }
    ),
  ],
});
