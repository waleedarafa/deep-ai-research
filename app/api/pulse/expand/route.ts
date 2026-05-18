import { NextResponse } from "next/server";
import path from "node:path";
import { z } from "zod";
import Exa from "exa-js";
import {
  openDb,
  migrate,
  getPulseItemById,
  setItemBodyMd,
} from "@/lib/pulse/db";

export const dynamic = "force-dynamic";

const Body = z.object({
  item_id: z.number().int().positive(),
  force: z.boolean().optional(),
});

const MAX_BODY_CHARS = 40_000;

function dbPath() {
  return process.env.PULSE_DB_PATH ?? path.resolve(process.cwd(), "data", "pulse.db");
}

const ARXIV_ABS_RE = /^https?:\/\/(www\.)?arxiv\.org\/abs\/([^/?#]+)/i;

function extractArxivId(url: string): string | null {
  const m = url.match(ARXIV_ABS_RE);
  return m ? m[2] : null;
}

async function fetchArxivHtml(arxivId: string): Promise<string | null> {
  const url = `https://arxiv.org/html/${arxivId}v1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "deep-ai-research-pulse/1.0" },
    });
    if (!res.ok) return null;
    let html = await res.text();
    // Strip script/style tags entirely and the page header/nav
    html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<style[\s\S]*?<\/style>/gi, "");
    // Rewrite relative image paths to absolute arxiv URLs using browser-style URL resolution.
    // The page URL has NO trailing slash, so relative paths resolve against /html/ as the
    // containing directory — giving the correct single-ID image URLs.
    const pageUrl = `https://arxiv.org/html/${arxivId}v1`;
    html = html.replace(
      /<img([^>]*?)\ssrc="(?!https?:\/\/|data:)([^"]+)"/gi,
      (_m, attrs, src) => {
        try {
          const abs = new URL(src, pageUrl).toString();
          return `<img${attrs} src="${abs}"`;
        } catch {
          return _m;
        }
      }
    );
    // Extract the article body if present
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    const content = articleMatch ? articleMatch[1] : html;
    // Truncate
    return content.length > MAX_BODY_CHARS
      ? content.slice(0, MAX_BODY_CHARS) + "\n\n*…content truncated*"
      : content;
  } catch {
    return null;
  }
}

async function fetchViaExa(url: string): Promise<string | null> {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return null;
  const exa = new Exa(apiKey);
  try {
    const result = await exa.getContents([url], {
      text: { maxCharacters: MAX_BODY_CHARS, includeHtmlTags: true } as {
        maxCharacters: number;
        includeHtmlTags: boolean;
      },
    });
    const first = result.results?.[0] as { text?: string } | undefined;
    const text = first?.text ?? "";
    return text.trim() ? text : null;
  } catch (err) {
    console.error("[pulse/expand] exa error", err);
    return null;
  }
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = openDb(dbPath());
  try {
    migrate(db);
    const item = getPulseItemById(db, parsed.data.item_id);
    if (!item) {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }
    if (item.body_md && !parsed.data.force) {
      return NextResponse.json({ body_md: item.body_md, cached: true });
    }

    // For arXiv abs URLs, prefer arxiv HTML (has figures), fall back to Exa.
    let bodyMd: string | null = null;
    const arxivId = extractArxivId(item.url);
    if (arxivId) {
      bodyMd = await fetchArxivHtml(arxivId);
    }
    if (!bodyMd) {
      bodyMd = await fetchViaExa(item.url);
    }
    if (!bodyMd) {
      return NextResponse.json({ error: "no content available" }, { status: 502 });
    }

    setItemBodyMd(db, item.id, bodyMd);
    return NextResponse.json({ body_md: bodyMd, cached: false });
  } catch (err) {
    console.error("[pulse/expand] db error", err);
    return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  } finally {
    db.close();
  }
}
