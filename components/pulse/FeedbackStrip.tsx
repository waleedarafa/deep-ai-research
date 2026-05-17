"use client";

import { useState } from "react";
import type { ClientPulseItem } from "./types";

interface Props {
  item: ClientPulseItem;
}

type Action = "like" | "dislike" | "bookmark";

async function postFeedback(item_id: number, action: Action) {
  await fetch("/api/pulse/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item_id, action }),
  });
}

export function FeedbackStrip({ item }: Props) {
  const [reaction, setReaction] = useState<"like" | "dislike" | null>(null);
  const [bookmarked, setBookmarked] = useState(false);

  function set(action: Action) {
    if (action === "bookmark") {
      setBookmarked(true);
      postFeedback(item.id, "bookmark");
      return;
    }
    setReaction(action);
    postFeedback(item.id, action);
  }

  return (
    <div className="pulse-mono text-sm flex gap-4 mt-4">
      <button onClick={() => set("bookmark")} aria-pressed={bookmarked} className={bookmarked ? "text-brick" : ""}>
        🔖 Bookmark
      </button>
      <button onClick={() => set("like")} aria-pressed={reaction === "like"} className={reaction === "like" ? "text-brick" : ""}>
        ❤ Like
      </button>
      <button onClick={() => set("dislike")} aria-pressed={reaction === "dislike"} className={reaction === "dislike" ? "text-brick" : ""}>
        👎 Dislike
      </button>
    </div>
  );
}
