import type { AgentConfig } from "../types/agent";
import { githubTrendingTools } from "./tools/github-trending";
import { xTrendingTools } from "./tools/x-trending";
import { hnTrendingTools } from "./tools/hn-trending";
import { hfPapersTools } from "./tools/hf-papers";
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
   - gh-curator
   - x-curator
   - hn-curator
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

**CRITICAL — DO NOT VIOLATE:**
- Preserve EVERY field of each candidate verbatim. Do NOT omit, summarize, condense, or "clean up"
  any field. In particular: title, url, summary, outlet, source, topics, and source_meta must all
  pass through unchanged from the subagents' output.
- If a subagent's candidate has a non-empty "summary" or "outlet", that exact text must appear in
  your final JSON. Failing to preserve summary/outlet causes downstream rendering to show blank cards.
- Return ONLY the JSON object, no prose. The calling script handles ranking and DB writes.`.trim(),
    },
    settingSources: ["project"],
    mcpServers: {
      "hf-papers": hfPapersTools,
      "github-trending": githubTrendingTools,
      "x-trending": xTrendingTools,
      "hn-trending": hnTrendingTools,
    },
    agents: pulseSubagents,
    allowedTools: [
      "Task",
      "Read",
      "mcp__hf-papers__list_daily_papers",
      "mcp__github-trending__list_trending",
      "mcp__x-trending__list_recent_tweets",
      "mcp__hn-trending__list_trending",
    ],
    permissionMode: "default",
    maxBudgetUsd: input.maxBudgetUsd,
    maxTurns: input.maxTurns,
  };
}
