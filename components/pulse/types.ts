import type { PulseItemRow, PulseRow } from "@/lib/pulse/db";

export type ClientPulseItem = Omit<PulseItemRow, "topics" | "source_meta"> & {
  topics: string[];
  source_meta: Record<string, unknown>;
};

export interface PulsePayload {
  pulse: PulseRow | null;
  items: ClientPulseItem[];
}

export interface HistoryEntry {
  id: number;
  date_key: string;
  item_count: number;
  generated_at: string;
  status: PulseRow["status"];
}
