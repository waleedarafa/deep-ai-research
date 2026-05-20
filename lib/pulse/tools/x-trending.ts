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
  "emollick",
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

const DISCOVERY_KEYWORDS = ["LLM", "Anthropic", "Claude", "GPT", "OpenAI"];

export function isXAvailable(): boolean {
  return Boolean(process.env.X_BEARER_TOKEN && process.env.X_BEARER_TOKEN.trim());
}

export interface FetchTweetOptions {
  sinceHours: number;
  limit: number;
  minEngagement?: number;
}

function engagementScore(m: TrendingTweet["metrics"]): number {
  return m.like_count + m.retweet_count * 2 + m.reply_count * 1.5 + m.quote_count;
}

async function runXSearch(
  query: string,
  sinceHours: number,
  maxResults: number
): Promise<TrendingTweet[]> {
  const token = process.env.X_BEARER_TOKEN?.trim();
  if (!token) return [];

  const start = new Date(Date.now() - sinceHours * 3_600_000).toISOString();
  const params = new URLSearchParams({
    query,
    max_results: String(Math.min(100, Math.max(10, maxResults))),
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
    return (json.data ?? []).map((t) => {
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
  } catch {
    return [];
  }
}

export async function fetchRecentTweets(opts: FetchTweetOptions): Promise<TrendingTweet[]> {
  const minEngagement = opts.minEngagement ?? 200;

  const whitelistQuery = `(${CURATED_X_ACCOUNTS.map((u) => `from:${u}`).join(" OR ")}) -is:retweet lang:en`;
  const discoveryQuery = `(${DISCOVERY_KEYWORDS.join(" OR ")}) lang:en -is:retweet -is:reply has:links`;

  const [whitelist, discovery] = await Promise.all([
    runXSearch(whitelistQuery, opts.sinceHours, opts.limit * 4),
    runXSearch(discoveryQuery, opts.sinceHours, 50),
  ]);

  const deduped = new Map<string, TrendingTweet>();
  for (const t of [...whitelist, ...discovery]) {
    if (!deduped.has(t.tweet_id)) deduped.set(t.tweet_id, t);
  }

  const filtered = Array.from(deduped.values()).filter(
    (t) => engagementScore(t.metrics) >= minEngagement
  );

  return filtered
    .sort((a, b) => engagementScore(b.metrics) - engagementScore(a.metrics))
    .slice(0, opts.limit);
}

export const xTrendingTools = createSdkMcpServer({
  name: "x-trending",
  version: "1.0.0",
  tools: [
    tool(
      "list_recent_tweets",
      "Fetch high-signal AI/ML tweets from a curated whitelist PLUS open-discovery search, deduped and ranked by engagement (likes + retweets*2 + replies*1.5 + quotes). Drops anything below min_engagement. Returns [] when X_BEARER_TOKEN is unset.",
      {
        since_hours: z.number().min(1).max(72).default(24),
        limit: z.number().min(1).max(20).default(5),
        min_engagement: z
          .number()
          .min(0)
          .max(100000)
          .default(200)
          .describe("Minimum engagement score (likes + retweets*2 + replies*1.5 + quotes). Drops weak tweets."),
      },
      async (args) => {
        const tweets = await fetchRecentTweets({
          sinceHours: args.since_hours,
          limit: args.limit,
          minEngagement: args.min_engagement,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(tweets, null, 2) }],
        };
      }
    ),
  ],
});
