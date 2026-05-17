import { describe, it, expect } from "vitest";
import { pulseSubagents } from "./index";

describe("pulseSubagents shape", () => {
  it("registers exactly 4 curators with required fields", () => {
    const names = Object.keys(pulseSubagents);
    expect(names.sort()).toEqual(["gh-curator", "news-curator", "paper-curator", "x-curator"]);
    for (const def of Object.values(pulseSubagents)) {
      expect(def.description.length).toBeGreaterThan(40);
      expect(def.prompt.length).toBeGreaterThan(100);
      expect(def.tools.length).toBeGreaterThan(0);
      expect(def.model).toBeTruthy();
    }
  });

  it("requires Exa tools on paper-curator and news-curator", () => {
    expect(pulseSubagents["paper-curator"].tools).toEqual(
      expect.arrayContaining(["mcp__exa-search__search", "mcp__exa-search__get_contents"])
    );
    expect(pulseSubagents["news-curator"].tools).toEqual(
      expect.arrayContaining(["mcp__exa-search__search", "mcp__exa-search__get_contents"])
    );
  });

  it("gh-curator uses github-trending tool", () => {
    expect(pulseSubagents["gh-curator"].tools).toEqual(
      expect.arrayContaining(["mcp__github-trending__list_trending"])
    );
  });

  it("x-curator uses x-trending tool", () => {
    expect(pulseSubagents["x-curator"].tools).toEqual(
      expect.arrayContaining(["mcp__x-trending__list_recent_tweets"])
    );
  });
});
