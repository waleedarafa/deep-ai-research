import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export interface HFPaper {
  arxiv_id: string;
  title: string;
  url: string;
  summary: string;
  upvotes: number;
  authors: string[];
  published_at: string;
  organization: string;
  ai_keywords: string[];
}

const HF_DAILY_API = "https://huggingface.co/api/daily_papers";

export async function fetchDailyPapers(limit: number, minUpvotes: number): Promise<HFPaper[]> {
  const res = await fetch(HF_DAILY_API);
  if (!res.ok) throw new Error(`HF Daily Papers failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as Array<Record<string, unknown>>;

  const papers: HFPaper[] = [];
  for (const entry of json) {
    const paper = (entry.paper ?? {}) as Record<string, unknown>;
    const arxivId = String(paper.id ?? "");
    if (!arxivId) continue;
    const upvotes = Number(paper.upvotes ?? 0);
    if (upvotes < minUpvotes) continue;
    const authorsRaw = (paper.authors as Array<Record<string, unknown>> | undefined) ?? [];
    const authors = authorsRaw.map((a) => String(a.name ?? "")).filter(Boolean);
    const keywordsRaw = (paper.ai_keywords as string[] | undefined) ?? [];
    papers.push({
      arxiv_id: arxivId,
      title: String(paper.title ?? entry.title ?? ""),
      url: `https://arxiv.org/abs/${arxivId}`,
      summary: String(paper.ai_summary ?? paper.summary ?? entry.summary ?? ""),
      upvotes,
      authors,
      published_at: String(paper.publishedAt ?? entry.publishedAt ?? ""),
      organization: String(entry.organization ?? ""),
      ai_keywords: keywordsRaw.filter((k): k is string => typeof k === "string"),
    });
  }

  return papers.sort((a, b) => b.upvotes - a.upvotes).slice(0, limit);
}

export const hfPapersTools = createSdkMcpServer({
  name: "hf-papers",
  version: "1.0.0",
  tools: [
    tool(
      "list_daily_papers",
      "List the day's most-upvoted AI/ML papers from HuggingFace Daily Papers (editorial curation + community votes).",
      {
        limit: z.number().min(1).max(30).default(15),
        min_upvotes: z.number().min(0).max(100).default(1),
      },
      async (args) => {
        const papers = await fetchDailyPapers(args.limit, args.min_upvotes);
        return {
          content: [{ type: "text", text: JSON.stringify(papers, null, 2) }],
        };
      }
    ),
  ],
});
