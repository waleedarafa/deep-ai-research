"use client";

import { useEffect, useRef, useState } from "react";
import type { ClientPulseItem } from "./types";

interface Props {
  item: ClientPulseItem;
  seed: string | null;
  onConsumeSeed: () => void;
}

interface Turn {
  role: "user" | "agent";
  text: string;
}

export function AskAgentBox({ item, seed, onConsumeSeed }: Props) {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (seed) {
      setInput(seed);
      void send(seed);
      onConsumeSeed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  async function send(message: string) {
    setStreaming(true);
    setError(null);
    setTurns((prev) => [...prev, { role: "user", text: message }, { role: "agent", text: "" }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/pulse/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: item.id, message }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          if (!ev.trim()) continue;
          const dataLine = ev.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const j = JSON.parse(dataLine.slice(5).trim());
            if (j.delta) {
              setTurns((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: "agent", text: next[next.length - 1].text + j.delta };
                return next;
              });
            }
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = input.trim();
    if (!t || streaming) return;
    setInput("");
    void send(t);
  }

  const tooLong = turns.filter((t) => t.role === "user").length >= 6;

  return (
    <div className="mt-6">
      <div className="pulse-mono text-xs uppercase tracking-wider mb-2 text-brick">● Ask agent about this item</div>

      {turns.length > 0 && (
        <div className="space-y-3 mb-3 font-serif text-base">
          {turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "text-zinc-700" : "text-zinc-900"}>
              <span className="pulse-mono text-xs uppercase mr-2">{t.role === "user" ? "You:" : "Agent:"}</span>
              <span className="whitespace-pre-wrap">{t.text}</span>
            </div>
          ))}
        </div>
      )}

      {tooLong && (
        <div className="pulse-mono text-xs text-zinc-500 mb-2">
          Long thread — consider starting fresh for focus.
        </div>
      )}
      {error && <div className="pulse-mono text-xs text-brick mb-2">Error: {error}</div>}

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about this item..."
          className="flex-1 bg-zinc-900 text-parchment px-3 py-2 pulse-mono text-sm"
          disabled={streaming}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="pulse-mono text-xs uppercase border border-zinc-900 px-3 py-2 hover:bg-zinc-900 hover:text-parchment transition-colors disabled:opacity-40"
        >
          Send →
        </button>
      </form>
      <div className="pulse-mono text-xs text-zinc-500 mt-1">
        Enter to send · Shift+Enter for new line
      </div>
    </div>
  );
}
