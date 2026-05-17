import type { AgentConfig } from "../types/agent";
import { exaSearchTools } from "../agent/tools";
import { githubTrendingTools } from "./tools/github-trending";
import { xTrendingTools } from "./tools/x-trending";
import { pulseSubagents } from "./subagents";

export interface PulseConfigInput {
  preferencesPath: string;
  maxBudgetUsd: number;
  maxTurns: number;
  model?: AgentConfig["model"];
}

export function buildPulseOrchestratorConfig(input: PulseConfigInput): AgentConfig {
  const model = input.model ?? "claude-haiku-4-5-20251001";

  return {
    model,
    workingDirectory: process.cwd(),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: `
You are the Daily Pulse orchestrator. Your job: dispatch four curator subagents in parallel,
collect their JSON outputs, deduplicate by URL, and return the merged candidate set.

**Procedure:**
1. Use the Task tool to dispatch these subagents IN PARALLEL (single message, four tool calls):
   - paper-curator
   - news-curator
   - gh-curator
   - x-curator
2. Each subagent returns a JSON array of candidates. Concatenate.
3. Dedupe by 'url' (case-insensitive, strip trailing slash + utm params).
4. Read the user's preferences file at: ${input.preferencesPath}
5. Return the final JSON object:
\`\`\`json
{
  "candidates": [ ...deduped... ],
  "preferences": { ...verbatim content of preferences.json... }
}
\`\`\`
Return ONLY this JSON, no prose. The calling script handles ranking and DB writes.`.trim(),
    },
    settingSources: ["project"],
    mcpServers: {
      "exa-search": exaSearchTools,
      "github-trending": githubTrendingTools,
      "x-trending": xTrendingTools,
    },
    agents: pulseSubagents,
    allowedTools: [
      "Task",
      "Read",
      "mcp__exa-search__search",
      "mcp__exa-search__get_contents",
      "mcp__github-trending__list_trending",
      "mcp__x-trending__list_recent_tweets",
    ],
    permissionMode: "default",
    maxBudgetUsd: input.maxBudgetUsd,
    maxTurns: input.maxTurns,
  };
}
