"use client";

import { useState } from "react";
import type { ClientPulseItem } from "./types";

interface Props {
  item: ClientPulseItem;
}

type ServerAction =
  | "like"
  | "dislike"
  | "bookmark"
  | "unbookmark"
  | "unlike"
  | "undislike";

async function postFeedback(item_id: number, action: ServerAction) {
  await fetch("/api/pulse/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item_id, action }),
  });
}

export function FeedbackStrip({ item }: Props) {
  const [reaction, setReaction] = useState<"like" | "dislike" | null>(null);
  const [bookmarked, setBookmarked] = useState(false);

  function toggleBookmark() {
    const next = !bookmarked;
    setBookmarked(next);
    postFeedback(item.id, next ? "bookmark" : "unbookmark");
  }

  function toggleReaction(target: "like" | "dislike") {
    if (reaction === target) {
      // clicking the active reaction clears it
      setReaction(null);
      postFeedback(item.id, target === "like" ? "unlike" : "undislike");
      return;
    }
    // switching from one to the other (or starting fresh)
    if (reaction !== null) {
      // record the clearing of the old one for an honest audit log
      postFeedback(item.id, reaction === "like" ? "unlike" : "undislike");
    }
    setReaction(target);
    postFeedback(item.id, target);
  }

  return (
    <div className="pulse-mono text-sm flex gap-4 mt-4">
      <button
        onClick={toggleBookmark}
        aria-pressed={bookmarked}
        className={`hover:text-brick ${bookmarked ? "text-brick" : ""}`}
        title={bookmarked ? "Bookmarked — click to remove" : "Bookmark"}
      >
        🔖 {bookmarked ? "Bookmarked" : "Bookmark"}
      </button>
      <button
        onClick={() => toggleReaction("like")}
        aria-pressed={reaction === "like"}
        className={`hover:text-brick ${reaction === "like" ? "text-brick" : ""}`}
        title={reaction === "like" ? "Liked — click to clear" : "Like"}
      >
        ❤ Like
      </button>
      <button
        onClick={() => toggleReaction("dislike")}
        aria-pressed={reaction === "dislike"}
        className={`hover:text-brick ${reaction === "dislike" ? "text-brick" : ""}`}
        title={reaction === "dislike" ? "Disliked — click to clear" : "Dislike"}
      >
        👎 Dislike
      </button>
    </div>
  );
}
