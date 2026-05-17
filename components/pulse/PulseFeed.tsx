"use client";

import type { ClientPulseItem } from "./types";
import { PulseCard } from "./PulseCard";
import { useFilterStore } from "@/lib/pulse/store";

interface Props {
  initialItems: ClientPulseItem[];
}

export function PulseFeed({ initialItems }: Props) {
  const { topic } = useFilterStore();
  const items = topic ? initialItems.filter((i) => i.topics.includes(topic)) : initialItems;
  if (items.length === 0) {
    return <p className="font-serif italic">No items match.</p>;
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
      {items.map((i) => (
        <PulseCard key={i.id} item={i} />
      ))}
    </div>
  );
}
