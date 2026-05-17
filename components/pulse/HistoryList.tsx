"use client";

import Link from "next/link";
import type { HistoryEntry } from "./types";

interface Props {
  entries: HistoryEntry[];
  activeId: number | null;
}

export function HistoryList({ entries, activeId }: Props) {
  return (
    <div>
      <div className="pulse-mono text-xs uppercase tracking-wider mb-3">History</div>
      <ul>
        {entries.map((e) => {
          const isActive = e.id === activeId;
          return (
            <li key={e.id} className="py-1">
              <Link
                href={`/pulse/${e.date_key}`}
                className={`flex justify-between pulse-mono text-xs ${
                  isActive ? "text-brick font-bold" : ""
                }`}
              >
                <span>
                  {isActive ? "●" : "○"} {e.date_key}
                </span>
                <span>{e.item_count}t</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
