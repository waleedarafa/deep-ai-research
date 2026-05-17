import type { Database as Db } from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { getRecentFeedback, type ItemSource, type RecentFeedbackRow } from "./db";

export interface PreferenceSample {
  title: string;
  summary: string;
  source: ItemSource;
}

export interface Preferences {
  generated_at: string;
  window_days: number;
  samples: {
    liked: PreferenceSample[];
    disliked: PreferenceSample[];
    bookmarked: PreferenceSample[];
    expanded_but_no_signal: PreferenceSample[];
  };
  counts: {
    liked: number;
    disliked: number;
    bookmarked: number;
  };
  source_weights: Record<ItemSource, number>;
  topic_signals: {
    loved: string[];
    avoided: string[];
  };
  cold_start: boolean;
}

export interface BuildOptions {
  now: Date;
  windowDays?: number;
  llmTopicExtractor?: (samples: {
    liked: PreferenceSample[];
    disliked: PreferenceSample[];
  }) => Promise<{ loved: string[]; avoided: string[] }> | { loved: string[]; avoided: string[] };
  maxSamplesPerBucket?: number;
}

const DEFAULT_WEIGHTS: Record<ItemSource, number> = {
  paper: 0.4,
  news: 0.3,
  github: 0.2,
  x: 0.1,
};

function rowToSample(r: RecentFeedbackRow): PreferenceSample {
  return { title: r.item.title, summary: r.item.summary, source: r.item.source };
}

function computeSourceWeights(rows: RecentFeedbackRow[]): Record<ItemSource, number> {
  const tally: Record<ItemSource, { likes: number; dislikes: number; shown: number }> = {
    paper: { likes: 0, dislikes: 0, shown: 0 },
    news: { likes: 0, dislikes: 0, shown: 0 },
    github: { likes: 0, dislikes: 0, shown: 0 },
    x: { likes: 0, dislikes: 0, shown: 0 },
  };
  for (const r of rows) {
    tally[r.item.source].shown += 1;
    if (r.action === "like") tally[r.item.source].likes += 1;
    if (r.action === "dislike") tally[r.item.source].dislikes += 1;
  }
  const raw: Record<ItemSource, number> = {
    paper: (tally.paper.likes - tally.paper.dislikes) / Math.max(tally.paper.shown, 1),
    news: (tally.news.likes - tally.news.dislikes) / Math.max(tally.news.shown, 1),
    github: (tally.github.likes - tally.github.dislikes) / Math.max(tally.github.shown, 1),
    x: (tally.x.likes - tally.x.dislikes) / Math.max(tally.x.shown, 1),
  };
  const offset = Math.min(0, raw.paper, raw.news, raw.github, raw.x);
  const shifted = {
    paper: raw.paper - offset + 0.05,
    news: raw.news - offset + 0.05,
    github: raw.github - offset + 0.05,
    x: raw.x - offset + 0.05,
  };
  const total = shifted.paper + shifted.news + shifted.github + shifted.x;
  return {
    paper: shifted.paper / total,
    news: shifted.news / total,
    github: shifted.github / total,
    x: shifted.x / total,
  };
}

export function buildPreferences(db: Db, opts: BuildOptions): Preferences {
  const windowDays = opts.windowDays ?? 30;
  const cap = opts.maxSamplesPerBucket ?? 30;
  const rows = getRecentFeedback(db, windowDays, opts.now);

  const liked = rows.filter((r) => r.action === "like").slice(0, cap).map(rowToSample);
  const disliked = rows.filter((r) => r.action === "dislike").slice(0, cap).map(rowToSample);
  const bookmarked = rows.filter((r) => r.action === "bookmark").slice(0, cap).map(rowToSample);
  const expandedNoSignal = rows
    .filter(
      (r) =>
        r.action === "expand" &&
        !rows.some(
          (other) =>
            other.item.id === r.item.id && (other.action === "like" || other.action === "dislike")
        )
    )
    .slice(0, cap)
    .map(rowToSample);

  const cold_start = liked.length < 5;
  const source_weights = cold_start ? DEFAULT_WEIGHTS : computeSourceWeights(rows);

  return {
    generated_at: opts.now.toISOString(),
    window_days: windowDays,
    samples: { liked, disliked, bookmarked, expanded_but_no_signal: expandedNoSignal },
    counts: { liked: liked.length, disliked: disliked.length, bookmarked: bookmarked.length },
    source_weights,
    topic_signals: { loved: [], avoided: [] },
    cold_start,
  };
}

export function writePreferencesFile(filePath: string, prefs: Preferences): void {
  writeFileSync(filePath, JSON.stringify(prefs, null, 2), "utf8");
}
