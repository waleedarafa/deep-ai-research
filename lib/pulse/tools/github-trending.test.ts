import { describe, it, expect, beforeEach, vi } from "vitest";
import { fetchTrendingAIRepos } from "./github-trending";

describe("github trending", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the search API with topic + date filters and maps results", async () => {
    const fakeJson = {
      total_count: 2,
      items: [
        {
          full_name: "acme/llm-tool",
          html_url: "https://github.com/acme/llm-tool",
          description: "a thing",
          stargazers_count: 412,
          language: "Python",
          created_at: "2026-05-17T20:00:00Z",
        },
        {
          full_name: "beta/agents",
          html_url: "https://github.com/beta/agents",
          description: null,
          stargazers_count: 88,
          language: "TypeScript",
          created_at: "2026-05-17T22:00:00Z",
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeJson,
      headers: new Headers(),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const repos = await fetchTrendingAIRepos({
      since: new Date("2026-05-17T00:00:00Z"),
      limit: 15,
    });
    expect(repos.length).toBe(2);
    expect(repos[0]).toMatchObject({
      title: "acme/llm-tool",
      url: "https://github.com/acme/llm-tool",
      summary: "a thing",
      stars: 412,
      language: "Python",
    });
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("created%3A%3E2026-05-17");
    expect(calledUrl).toContain("topic%3Allm");
    expect(calledUrl).toContain("("); // opening paren proves topic grouping
    expect(calledUrl).toContain(")"); // closing paren
  });

  it("throws on non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: "rate-limited" })
    );
    await expect(
      fetchTrendingAIRepos({ since: new Date("2026-05-17T00:00:00Z"), limit: 10 })
    ).rejects.toThrow(/403/);
  });
});
