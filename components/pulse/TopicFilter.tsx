"use client";

import type { ClientPulseItem } from "./types";
import { useFilterStore } from "@/lib/pulse/store";

interface Props {
  topics: string[];
  items: ClientPulseItem[];
}

export function TopicFilter({ topics, items }: Props) {
  const { topic, setTopic } = useFilterStore();
  const counts = topics.map((t) => ({
    name: t,
    count: items.filter((i) => i.topics.includes(t)).length,
  }));

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <span className="pulse-mono text-xs uppercase tracking-wider">Filter by topic</span>
        {topic && (
          <button
            className="pulse-mono text-xs text-brick"
            onClick={() => setTopic(null)}
            aria-label="Clear topic filter"
          >
            Clear ×
          </button>
        )}
      </div>
      <ul>
        <li>
          <button
            className={`flex w-full justify-between py-1 text-left pulse-mono text-sm ${
              topic === null ? "text-brick font-bold" : ""
            }`}
            onClick={() => setTopic(null)}
          >
            <span>ALL</span>
            <span>{items.length}</span>
          </button>
        </li>
        {counts.map(({ name, count }) => (
          <li key={name}>
            <button
              className={`flex w-full justify-between py-1 text-left pulse-mono text-sm ${
                topic === name ? "text-brick font-bold" : ""
              }`}
              onClick={() => setTopic(name)}
            >
              <span>{name}</span>
              <span>{count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
