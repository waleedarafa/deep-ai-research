import type { AgentDefinition } from "../../types/agent";
import { paperCurator } from "./paper-curator";
import { newsCurator } from "./news-curator";
import { ghCurator } from "./gh-curator";
import { xCurator } from "./x-curator";

export const pulseSubagents: Record<string, AgentDefinition> = {
  "paper-curator": paperCurator,
  "news-curator": newsCurator,
  "gh-curator": ghCurator,
  "x-curator": xCurator,
};
