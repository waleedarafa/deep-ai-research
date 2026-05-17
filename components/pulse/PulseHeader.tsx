"use client";

import { useState } from "react";
import type { PulseRow } from "@/lib/pulse/db";

interface Props {
  pulse: PulseRow | null;
}

function formatDate(dateKey: string): string {
  const d = new Date(dateKey + "T12:00:00Z");
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function PulseHeader({ pulse }: Props) {
  const [busy, setBusy] = useState(false);

  async function trigger() {
    setBusy(true);
    await fetch("/api/pulse/generate", { method: "POST" }).catch(() => {});
    setTimeout(() => location.reload(), 2500);
  }

  return (
    <div className="flex items-center justify-between">
      <h1 className="font-serif text-2xl">
        Daily Pulse{pulse ? ` — ${formatDate(pulse.date_key)}` : ""}
      </h1>
      <button
        onClick={trigger}
        disabled={busy}
        className="pulse-mono text-xs uppercase border border-brick text-brick px-3 py-1 hover:bg-brick hover:text-parchment transition-colors disabled:opacity-40"
      >
        {busy ? "Generating…" : "Gen Now"}
      </button>
    </div>
  );
}
