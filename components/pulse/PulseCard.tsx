"use client";

import { useState } from "react";
import type { ClientPulseItem } from "./types";
import { FeedbackStrip } from "./FeedbackStrip";
import { QuickActions } from "./QuickActions";
import { AskAgentBox } from "./AskAgentBox";

interface Props {
  item: ClientPulseItem;
}

const SOURCE_LABEL: Record<string, { text: string; cls: string }> = {
  paper: { text: "PAPER", cls: "text-forest border-forest" },
  news: { text: "NEWS", cls: "text-teal border-teal" },
  github: { text: "GITHUB", cls: "text-purplepill border-purplepill" },
  x: { text: "X", cls: "text-cyanpill border-cyanpill" },
};

export function PulseCard({ item }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [askSeed, setAskSeed] = useState<string | null>(null);
  const src = SOURCE_LABEL[item.source] ?? { text: item.source.toUpperCase(), cls: "" };

  return (
    <article className="bg-parchment border border-parchment-dark shadow-sm p-6 mb-6">
      <div className="flex gap-2 mb-3">
        <span className={`pulse-pill ${src.cls}`}>{src.text}</span>
        <span className="pulse-pill text-zinc-700 border-zinc-400">{item.complexity.toUpperCase()}</span>
        {item.priority === "high" && (
          <span className="pulse-pill text-goldpill border-goldpill">★ Essential</span>
        )}
      </div>

      <h2 className="font-serif text-2xl leading-tight mb-2">{item.title}</h2>

      <div className="pulse-mono text-xs uppercase tracking-wider mb-4 text-zinc-600">
        {item.source.toUpperCase()} · {item.outlet ?? "—"} · {item.read_minutes ?? "?"} MIN READ
      </div>

      <blockquote className="pulse-pullquote my-4 text-base">› {item.summary}</blockquote>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="pulse-mono text-xs text-brick uppercase tracking-wider mb-4"
      >
        {expanded ? "▲ Hide full text" : "▶ Read full"}
      </button>

      {expanded && (
        <div className="prose max-w-none my-4 whitespace-pre-wrap font-serif text-base">
          {item.body_md ?? <em>Body not yet fetched. Click a quick action or Ask agent to load.</em>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6 my-4">
        <div>
          <div className="pulse-mono text-xs uppercase tracking-wider text-zinc-600">Match</div>
          <div className="pulse-mono text-base text-brick">
            {"■".repeat(item.match_score)}
            {"□".repeat(5 - item.match_score)}
          </div>
        </div>
        <div>
          <div className="pulse-mono text-xs uppercase tracking-wider text-zinc-600">Complexity</div>
          <div className="font-serif">{item.complexity}</div>
        </div>
        <div>
          <div className="pulse-mono text-xs uppercase tracking-wider text-zinc-600">Read Time</div>
          <div className="font-serif">{item.read_minutes ?? "?"} min</div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap mb-2">
        {item.topics.map((t) => (
          <span key={t} className="pulse-pill text-zinc-600 border-zinc-400">{t}</span>
        ))}
      </div>

      <QuickActions onAction={(prompt) => setAskSeed(prompt)} />
      <AskAgentBox item={item} seed={askSeed} onConsumeSeed={() => setAskSeed(null)} />
      <FeedbackStrip item={item} />
    </article>
  );
}
