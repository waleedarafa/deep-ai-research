"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import type { ClientPulseItem } from "./types";

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
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string | null>(item.body_md ?? null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const src = SOURCE_LABEL[item.source] ?? { text: item.source.toUpperCase(), cls: "" };

  async function loadBody(force: boolean) {
    setLoadingBody(true);
    setBodyError(null);
    try {
      const res = await fetch("/api/pulse/expand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: item.id, force }),
      });
      const json = await res.json();
      if (!res.ok) {
        setBodyError(typeof json.error === "string" ? json.error : "could not fetch");
      } else {
        setBody(json.body_md as string);
      }
    } catch (e) {
      setBodyError((e as Error).message);
    } finally {
      setLoadingBody(false);
    }
  }

  async function openModal() {
    setOpen(true);
    if (!body && !loadingBody) await loadBody(false);
  }

  function closeModal() {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeModal();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <article className="bg-parchment border border-parchment-dark shadow-sm p-6 mb-6">
        <div className="flex gap-2 mb-3">
          <span className={`pulse-pill ${src.cls}`}>{src.text}</span>
          {item.priority === "high" && (
            <span className="pulse-pill text-goldpill border-goldpill">★ Essential</span>
          )}
        </div>

        <h2 className="font-serif text-2xl leading-tight mb-2">{item.title}</h2>

        <div className="pulse-mono text-xs uppercase tracking-wider mb-4 text-zinc-600">
          {item.source.toUpperCase()} · {item.outlet ?? "—"}
        </div>

        <blockquote className="pulse-pullquote my-4 text-base">› {item.summary}</blockquote>

        <button
          onClick={openModal}
          className="pulse-mono text-xs text-brick uppercase tracking-wider mb-4 hover:underline"
        >
          ▶ Read full
        </button>
      </article>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:p-8 overflow-y-auto"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bg-parchment border border-parchment-dark shadow-xl max-w-3xl w-full my-8 p-8 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-4 flex gap-3">
              <button
                onClick={() => loadBody(true)}
                disabled={loadingBody}
                className="pulse-mono text-xs text-zinc-600 hover:text-brick disabled:opacity-40"
                aria-label="Re-fetch full content"
              >
                {loadingBody ? "FETCHING…" : "↻ RE-FETCH"}
              </button>
              <button
                onClick={closeModal}
                className="pulse-mono text-sm text-zinc-600 hover:text-brick"
                aria-label="Close"
              >
                ✕ CLOSE
              </button>
            </div>

            <div className="flex gap-2 mb-3 pr-16">
              <span className={`pulse-pill ${src.cls}`}>{src.text}</span>
              {item.priority === "high" && (
                <span className="pulse-pill text-goldpill border-goldpill">★ Essential</span>
              )}
            </div>

            <h2 className="font-serif text-3xl leading-tight mb-2">{item.title}</h2>

            <div className="pulse-mono text-xs uppercase tracking-wider mb-4 text-zinc-600">
              {item.source.toUpperCase()} · {item.outlet ?? "—"} ·{" "}
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-brick"
              >
                Source ↗
              </a>
            </div>

            <blockquote className="pulse-pullquote my-4 text-base">› {item.summary}</blockquote>

            <div className="prose prose-zinc max-w-none my-6 font-serif text-base prose-headings:font-serif prose-headings:text-zinc-900 prose-p:text-zinc-800 prose-a:text-brick prose-strong:text-zinc-900 prose-code:text-brick prose-pre:bg-zinc-900 prose-pre:text-parchment">
              {loadingBody && <em>Fetching full content…</em>}
              {!loadingBody && bodyError && (
                <em className="text-brick">Couldn&apos;t fetch full text ({bodyError}).</em>
              )}
              {!loadingBody && !bodyError && body && (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, rehypeHighlight]}
                >
                  {body}
                </ReactMarkdown>
              )}
              {!loadingBody && !bodyError && !body && <em>No content available.</em>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
