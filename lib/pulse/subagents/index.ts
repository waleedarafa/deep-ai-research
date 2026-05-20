import type { AgentDefinition } from "../../types/agent";
import { paperCurator } from "./paper-curator";
import { ghCurator } from "./gh-curator";
import { xCurator } from "./x-curator";
import { hnCurator } from "./hn-curator";

export const pulseSubagents: Record<string, AgentDefinition> = {
  "paper-curator": paperCurator,
  "gh-curator": ghCurator,
  "x-curator": xCurator,
  "hn-curator": hnCurator,
};
