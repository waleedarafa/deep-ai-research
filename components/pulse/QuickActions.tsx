"use client";

interface Props {
  onAction: (prompt: string) => void;
}

const PRESETS: Array<{ label: string; icon: string; prompt: string }> = [
  { label: "Key Concepts", icon: "◆", prompt: "List the 5 most important concepts this introduces, one line each." },
  { label: "Mental Models", icon: "◆", prompt: "What analogies or frameworks would help someone understand this?" },
  { label: "Diagram", icon: "○", prompt: "Draw an ASCII or mermaid diagram of the method/system." },
  { label: "Code Pattern", icon: "(/)", prompt: "Sketch the simplest working code example of the core idea." },
  { label: "Implications", icon: "○", prompt: "What are the 3 most important practical implications for an AI engineer?" },
  { label: "Flashcards", icon: "※", prompt: "Make 5 spaced-repetition flashcards (Q on one line, A on next)." },
];

export function QuickActions({ onAction }: Props) {
  return (
    <div className="mt-6">
      <div className="pulse-mono text-xs uppercase tracking-wider mb-2">Part II</div>
      <div className="grid grid-cols-3 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onAction(p.prompt)}
            className="pulse-mono text-xs uppercase border border-zinc-400 hover:border-brick hover:text-brick px-3 py-2 text-left transition-colors"
          >
            {p.icon} {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
