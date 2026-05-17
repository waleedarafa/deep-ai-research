"use client";

import type { ClientPulseItem } from "./types";

interface Props {
  item: ClientPulseItem;
  seed: string | null;
  onConsumeSeed: () => void;
}

export function AskAgentBox({ item, seed, onConsumeSeed }: Props) {
  return (
    <div className="mt-4 pulse-mono text-xs text-zinc-500">
      ● Ask agent input lands in Task 24. Item: {item.id}.
      {seed && <span> (pending: “{seed.slice(0, 40)}…”)</span>}
      {seed && (
        <button className="ml-2 underline" onClick={onConsumeSeed}>
          dismiss
        </button>
      )}
    </div>
  );
}
