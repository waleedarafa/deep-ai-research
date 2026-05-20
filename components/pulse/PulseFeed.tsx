"use client";

import type { ClientPulseItem } from "./types";
import { PulseCard } from "./PulseCard";

interface Props {
  initialItems: ClientPulseItem[];
}

export function PulseFeed({ initialItems }: Props) {
  if (initialItems.length === 0) {
    return <p className="font-serif italic">No items yet.</p>;
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
      {initialItems.map((i) => (
        <PulseCard key={i.id} item={i} />
      ))}
    </div>
  );
}
