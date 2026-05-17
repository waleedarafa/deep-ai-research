import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchRecentTweets, isXAvailable, CURATED_X_ACCOUNTS } from "./x-trending";

describe("x trending", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("isXAvailable returns false without token", () => {
    vi.stubEnv("X_BEARER_TOKEN", "");
    expect(isXAvailable()).toBe(false);
  });

  it("isXAvailable returns true with token", () => {
    vi.stubEnv("X_BEARER_TOKEN", "AAAA");
    expect(isXAvailable()).toBe(true);
  });

  it("fetchRecentTweets returns [] when no token (graceful skip)", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "");
    expect(await fetchRecentTweets({ sinceHours: 24, limit: 5 })).toEqual([]);
  });

  it("queries with curated account list and maps results", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "AAAA");
    const fakeJson = {
      data: [
        {
          id: "1",
          text: "important paper",
          author_id: "u1",
          public_metrics: { reply_count: 12, like_count: 240, retweet_count: 35, quote_count: 4 },
        },
      ],
      includes: { users: [{ id: "u1", username: "elvis", name: "Elvis" }] },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => fakeJson } as unknown as Response)
    );
    const tweets = await fetchRecentTweets({ sinceHours: 24, limit: 5 });
    expect(tweets[0]).toMatchObject({ author: "elvis", url: "https://x.com/elvis/status/1" });
    expect(CURATED_X_ACCOUNTS.length).toBeGreaterThan(5);
  });

  it("returns [] on non-ok response (does not crash the pipeline)", async () => {
    vi.stubEnv("X_BEARER_TOKEN", "AAAA");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response));
    expect(await fetchRecentTweets({ sinceHours: 24, limit: 5 })).toEqual([]);
  });
});
