import { describe, it, expect } from "vitest";
import { buildPulseOrchestratorConfig } from "./config";

describe("pulse orchestrator config", () => {
  it("registers 3 MCP servers and all 4 subagents", () => {
    const cfg = buildPulseOrchestratorConfig({
      preferencesPath: "/tmp/preferences.json",
      maxBudgetUsd: 2,
      maxTurns: 40,
    });
    expect(Object.keys(cfg.mcpServers ?? {}).sort()).toEqual([
      "exa-search",
      "github-trending",
      "x-trending",
    ]);
    expect(Object.keys(cfg.agents ?? {}).sort()).toEqual([
      "gh-curator",
      "news-curator",
      "paper-curator",
      "x-curator",
    ]);
    expect(cfg.allowedTools).toEqual(expect.arrayContaining(["Task", "Read"]));
    expect(cfg.maxBudgetUsd).toBe(2);
  });

  it("system prompt mentions preferences.json path", () => {
    const cfg = buildPulseOrchestratorConfig({
      preferencesPath: "/tmp/X/preferences.json",
      maxBudgetUsd: 1,
      maxTurns: 20,
    });
    const append =
      typeof cfg.systemPrompt === "object" && "append" in cfg.systemPrompt
        ? cfg.systemPrompt.append ?? ""
        : "";
    expect(append).toContain("/tmp/X/preferences.json");
  });
});
