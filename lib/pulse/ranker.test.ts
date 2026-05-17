import { describe, it, expect, vi } from "vitest";
import { rankCandidates, buildRankerPrompt, type Candidate } from "./ranker";
import type { Preferences } from "./preferences";

const SAMPLE_PREFS: Preferences = {
  generated_at: "2026-05-18T07:00:00Z",
  window_days: 30,
  samples: {
    liked: [{ title: "MoE folding", summary: "...", source: "paper" }],
    disliked: [{ title: "RLHF survey", summary: "...", source: "paper" }],
    bookmarked: [],
    expanded_but_no_signal: [],
  },
  counts: { liked: 8, disliked: 3, bookmarked: 1 },
  source_weights: { paper: 0.4, news: 0.3, github: 0.2, x: 0.1 },
  topic_signals: { loved: ["moe"], avoided: ["rlhf survey"] },
  cold_start: false,
};

function fakeCandidate(idx: number, source: Candidate["source"], extra: Partial<Candidate> = {}): Candidate {
  return {
    title: `c${idx}`,
    url: `https://example.com/${idx}`,
    summary: `summary ${idx}`,
    outlet: "x",
    source,
    topics: ["moe"],
    source_meta: {},
    ...extra,
  };
}

describe("ranker prompt", () => {
  it("includes liked + disliked samples + cold-start flag", () => {
    const prompt = buildRankerPrompt({
      candidates: [fakeCandidate(1, "paper")],
      preferences: SAMPLE_PREFS,
      recentPulseUrls: ["https://old.example/x"],
    });
    expect(prompt).toContain("MoE folding");
    expect(prompt).toContain("RLHF survey");
    expect(prompt).toContain("cold_start: false");
    expect(prompt).toContain("https://old.example/x");
  });
});

describe("rankCandidates", () => {
  it("returns top 10 with priority + match_score; respects source diversity floor", async () => {
    const candidates = Array.from({ length: 30 }, (_, i) =>
      fakeCandidate(i, (["paper", "news", "github", "x"] as const)[i % 4])
    );
    const queryLLM = vi.fn().mockResolvedValue({
      picks: candidates.slice(0, 10).map((c, idx) => ({
        url: c.url,
        priority: idx < 5 ? "high" : "medium",
        match_score: 5 - Math.floor(idx / 2),
        complexity: "intermediate",
        read_minutes: 6,
      })),
    });
    const ranked = await rankCandidates({
      candidates,
      preferences: SAMPLE_PREFS,
      recentPulseUrls: [],
      queryLLM,
    });
    expect(ranked.length).toBe(10);
    expect(queryLLM).toHaveBeenCalledOnce();
    const sourceCounts: Record<string, number> = {};
    for (const r of ranked) sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
    for (const c of Object.values(sourceCounts)) expect(c).toBeLessThanOrEqual(5);
  });

  it("falls back to recency-weighted order when queryLLM throws", async () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      fakeCandidate(i, (["paper", "news", "github", "x"] as const)[i % 4])
    );
    const queryLLM = vi.fn().mockRejectedValue(new Error("boom"));
    const ranked = await rankCandidates({
      candidates,
      preferences: SAMPLE_PREFS,
      recentPulseUrls: [],
      queryLLM,
    });
    expect(ranked.length).toBeLessThanOrEqual(10);
    // No item from a single source exceeds 5
    const sourceCounts: Record<string, number> = {};
    for (const r of ranked) sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
    for (const c of Object.values(sourceCounts)) expect(c).toBeLessThanOrEqual(5);
  });

  it("drops candidates whose URLs appear in recentPulseUrls", async () => {
    const candidates = [
      fakeCandidate(1, "paper", { url: "https://dup.example/a" }),
      fakeCandidate(2, "paper", { url: "https://fresh.example/b" }),
    ];
    const queryLLM = vi.fn().mockResolvedValue({
      picks: [
        { url: "https://fresh.example/b", priority: "high", match_score: 5, complexity: "intermediate", read_minutes: 5 },
      ],
    });
    const ranked = await rankCandidates({
      candidates,
      preferences: SAMPLE_PREFS,
      recentPulseUrls: ["https://dup.example/a"],
      queryLLM,
    });
    expect(ranked.map((r) => r.url)).toEqual(["https://fresh.example/b"]);
  });

  it("deduplicates URLs even if LLM repeats them in picks", async () => {
    const candidates = [
      fakeCandidate(1, "paper", { url: "https://example.com/a" }),
      fakeCandidate(2, "paper", { url: "https://example.com/b" }),
    ];
    const queryLLM = vi.fn().mockResolvedValue({
      picks: [
        { url: "https://example.com/a", priority: "high", match_score: 5, complexity: "intermediate", read_minutes: 5 },
        { url: "https://example.com/a", priority: "medium", match_score: 3, complexity: "intermediate", read_minutes: 5 },
        { url: "https://example.com/b", priority: "high", match_score: 4, complexity: "intermediate", read_minutes: 5 },
      ],
    });
    const ranked = await rankCandidates({
      candidates,
      preferences: SAMPLE_PREFS,
      recentPulseUrls: [],
      queryLLM,
    });
    expect(ranked.length).toBe(2);
    expect(ranked.map((r) => r.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("tops up from remainder when source floor caps LLM picks short", async () => {
    // 10 LLM picks all from 'paper' -> floor caps at 5 -> top-up adds from other sources
    const candidates: Candidate[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        fakeCandidate(i, "paper", { url: `https://example.com/p${i}` })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        fakeCandidate(100 + i, "news", { url: `https://example.com/n${i}` })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        fakeCandidate(200 + i, "github", { url: `https://example.com/g${i}` })
      ),
    ];
    const queryLLM = vi.fn().mockResolvedValue({
      picks: candidates.slice(0, 10).map((c) => ({
        url: c.url,
        priority: "high",
        match_score: 5,
        complexity: "intermediate",
        read_minutes: 5,
      })),
    });
    const ranked = await rankCandidates({
      candidates,
      preferences: SAMPLE_PREFS,
      recentPulseUrls: [],
      queryLLM,
    });
    expect(ranked.length).toBe(10);
    const paperCount = ranked.filter((r) => r.source === "paper").length;
    expect(paperCount).toBeLessThanOrEqual(5);
    const otherSources = ranked.filter((r) => r.source !== "paper").length;
    expect(otherSources).toBeGreaterThanOrEqual(5);
  });
});
