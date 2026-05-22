"use client";

import { useEffect, useRef, useState } from "react";
import type { PulseRow } from "@/lib/pulse/db";

interface Props {
  pulse: PulseRow | null;
}

interface TodayResponse {
  pulse: PulseRow | null;
  items: unknown[];
}

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function formatDate(dateKey: string): string {
  const d = new Date(dateKey + "T12:00:00Z");
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function todayDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function PulseHeader({ pulse }: Props) {
  const [status, setStatus] = useState<"idle" | "starting" | "running" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollHandle = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadline = useRef<number>(0);
  const initialPulseId = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollHandle.current) clearInterval(pollHandle.current);
    };
  }, []);

  function stopPolling() {
    if (pollHandle.current) {
      clearInterval(pollHandle.current);
      pollHandle.current = null;
    }
  }

  async function pollOnce() {
    try {
      const res = await fetch("/api/pulse/today", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as TodayResponse;
      const latest = json.pulse;
      if (!latest) return;

      const isNewPulse =
        initialPulseId.current !== null && latest.id !== initialPulseId.current;
      const isToday = latest.date_key === todayDateKey();

      if (isNewPulse && isToday && latest.status === "ok") {
        stopPolling();
        location.assign(`/pulse/${latest.date_key}`);
        return;
      }
      if (isNewPulse && isToday && latest.status === "failed") {
        stopPolling();
        setStatus("error");
        setErrorMsg("generation failed — check server logs");
        return;
      }
      if (Date.now() > deadline.current) {
        stopPolling();
        setStatus("error");
        setErrorMsg("timed out after 5 minutes");
      }
    } catch {
      // transient network blip — keep polling until deadline
    }
  }

  async function trigger() {
    setStatus("starting");
    setErrorMsg(null);
    initialPulseId.current = pulse?.id ?? null;
    deadline.current = Date.now() + POLL_TIMEOUT_MS;

    try {
      const res = await fetch("/api/pulse/generate", { method: "POST" });
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(`gen request failed (HTTP ${res.status})`);
        return;
      }
    } catch (e) {
      setStatus("error");
      setErrorMsg((e as Error).message);
      return;
    }

    setStatus("running");
    pollHandle.current = setInterval(pollOnce, POLL_INTERVAL_MS);
    pollOnce();
  }

  const busy = status === "starting" || status === "running";
  const label =
    status === "starting"
      ? "Starting…"
      : status === "running"
      ? "Generating…"
      : "Gen Now";

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-baseline gap-3">
        <h1 className="font-serif text-2xl">
          Daily Pulse{pulse ? ` — ${formatDate(pulse.date_key)}` : ""}
        </h1>
        {status === "running" && (
          <span className="pulse-mono text-xs text-zinc-500">
            this can take ~2 minutes…
          </span>
        )}
        {status === "error" && errorMsg && (
          <span className="pulse-mono text-xs text-brick">⚠ {errorMsg}</span>
        )}
      </div>
      <button
        onClick={trigger}
        disabled={busy}
        className="pulse-mono text-xs uppercase border border-brick text-brick px-3 py-1 hover:bg-brick hover:text-parchment transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? `● ${label}` : label}
      </button>
    </div>
  );
}
