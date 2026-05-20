# Deep AI Research Agent

A Claude-powered application with two surfaces:

- **Daily Pulse** at `/pulse` — a scheduled job that wakes up each morning, dispatches four curator subagents in parallel, and assembles a deduplicated feed of the day's AI/ML papers, GitHub repos, tweets, and Hacker News stories into a SQLite-backed history.
- **Research Agent** at `/` — an interactive one-shot research interface. Type a query, watch the agent's tool calls stream live via SSE, get a citation-rich markdown report when it finishes.

![Next.js](https://img.shields.io/badge/Next.js-16.2.6-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Claude Agent SDK](https://img.shields.io/badge/Claude%20Agent%20SDK-0.1.37-orange)

## How the Daily Pulse works

```
  scripts/generate-pulse.ts (cron via launchd)
              │
              ▼
  Orchestrator agent  (claude-haiku-4-5-20251001)
              │  dispatches 4 subagents in parallel via Task
              │
   ┌──────────┼──────────┬──────────┐
   ▼          ▼          ▼          ▼
 paper      gh-       x-         hn-
 curator    curator   curator    curator
 (Exa →     (GitHub   (X recent  (HN
  arXiv)    Search)    search)    firebase)
   │          │          │          │
   └──────────┼──────────┼──────────┘
              ▼
       dedupe by URL
              │
              ▼
    URL-pattern source normalizer
    (x.com→x, arxiv.org→paper, github.com→github)
              │
              ▼
   ┌──────────┴──────────┐
   │                      │
   ▼                      ▼
 LLM ranker          passthroughRank
 (preferences on)    (preferences off)
   │                      │
   └──────────┬───────────┘
              ▼
        SQLite (data/pulse.db)
              │
              ▼
       Web UI at /pulse/<date>
```

### Sources

| Curator | Source | Tool |
|---|---|---|
| `paper-curator` | arXiv via Exa neural search (last 24h) | `mcp__exa-search__search` |
| `gh-curator` | GitHub Search API — repos created in last 36h with AI keywords + stars > 3 | `mcp__github-trending__list_trending` |
| `x-curator` | X/Twitter recent-search filtered to a curated list of ~20 AI accounts (requires `X_BEARER_TOKEN`) | `mcp__x-trending__list_recent_tweets` |
| `hn-curator` | Hacker News firebase API — top stories filtered by AI keywords in title, min 30 points | `mcp__hn-trending__list_trending` |

A fifth curator (`news-curator`, Exa-based) for curated AI lab blogs exists in the codebase but is **currently unregistered from the dispatch list** because Exa's host-only domain filter pulled in too much noise. See `lib/pulse/subagents/news-curator.ts` to re-enable.

### Ranking

The orchestrator's deduplicated candidate set goes through one of two paths:

- **`PULSE_USE_PREFERENCES=true`** — calls Claude Haiku once with the candidates + your liked/disliked history + recent-30-day URLs and produces a top-10 ranking with `priority`, `match_score`, `complexity`, `read_minutes`.
- **`PULSE_USE_PREFERENCES=false`** *(default in `.env.local`)* — skips the ranker LLM entirely, dedupes against the recent 30-day URL window, and inserts every remaining candidate with neutral defaults. Used while collecting feedback signal.

## How the Research Agent works

The home page (`/`) accepts a single research query, posts it to `app/api/agent/query/route.ts`, and streams the Claude Agent SDK message events back via Server-Sent Events. The `ProgressTracker` component renders live tool calls; when the agent emits a `result` message, `FinalReport` shows the synthesized markdown.

## Quick Start

### Prerequisites

- Node.js 20+
- Anthropic API key — <https://console.anthropic.com/>
- Exa API key — <https://exa.ai/>
- *(Optional)* X/Twitter API bearer token — <https://developer.x.com/> (requires API credits)

### Install

```bash
git clone <repo-url>
cd deep-ai-research
npm install
cp .env.example .env.local  # then edit with your keys
npm run dev
```

Open <http://localhost:3000>.

### `.env.local`

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...
EXA_API_KEY=...

# Optional
X_BEARER_TOKEN=...                    # x-curator returns [] without this
DEFAULT_MODEL=claude-haiku-4-5-20251001
MAX_BUDGET_USD=2.0                    # per-pulse-run budget cap
MAX_TURNS=20                          # orchestrator turn cap
PULSE_USE_PREFERENCES=false           # skip LLM ranker, insert all candidates
```

## Daily Pulse — generation & scheduling

### Generate a pulse now

```bash
npm run pulse:generate
```

Writes one row to `pulses` and N rows to `pulse_items` in `data/pulse.db`. The date-key (`YYYY-MM-DD`) is unique per day — re-running for the same day aborts unless you delete the existing row.

### Schedule via launchd (macOS)

```bash
./scripts/install-launchd.sh         # installs com.user.daily-pulse.plist
./scripts/uninstall-launchd.sh       # removes it
```

## Storage

SQLite at `data/pulse.db`:

| Table | What it holds |
|---|---|
| `pulses` | one row per day (id, date_key, item_count, status, cost_usd, duration_ms) |
| `pulse_items` | individual items (rank, source, title, url, summary, outlet, topics, source_meta JSON) |
| `feedback` | retained for historical signal (write surface was removed; preferences.ts still reads from it if you re-enable preferences) |
| `usage` | per-day cost accumulator |

## Project structure

```
deep-ai-research/
├── app/
│   ├── page.tsx                       # Research Agent home (/)
│   ├── layout.tsx
│   ├── pulse/
│   │   ├── page.tsx                   # Latest pulse view (/pulse)
│   │   └── [date]/page.tsx            # Historical pulse view (/pulse/YYYY-MM-DD)
│   └── api/
│       ├── agent/query/route.ts       # SSE research-query endpoint
│       ├── agent/session/route.ts
│       └── pulse/
│           ├── today/route.ts         # JSON of today's pulse
│           ├── history/route.ts       # Last 30 pulses
│           ├── expand/route.ts        # Lazy-fetch body_md via Exa for a given item
│           ├── ask/route.ts           # "Ask agent about this item" endpoint
│           └── generate/route.ts      # HTTP trigger to run pulse:generate
│
├── components/
│   ├── pulse/                         # PulseCard, PulseFeed, PulseShell,
│   │                                  # PulseHeader, HistoryList, AskAgentBox,
│   │                                  # QuickActions, types.ts
│   ├── ui/                            # shadcn-style Radix primitives
│   ├── ProgressTracker.tsx            # Research Agent tool-call timeline
│   ├── FinalReport.tsx                # Research Agent markdown renderer
│   └── ToolCallSummary.tsx
│
├── lib/
│   ├── agent/
│   │   ├── config.ts                  # Research Agent config (single-agent)
│   │   ├── tools.ts                   # Exa MCP tools (search, contents, similar)
│   │   └── agents.ts                  # Optional subagent definitions
│   ├── pulse/
│   │   ├── config.ts                  # Pulse orchestrator config (4-curator)
│   │   ├── db.ts                      # SQLite migrations + repository
│   │   ├── preferences.ts             # Build preferences from feedback rows
│   │   ├── ranker.ts                  # rankCandidates + passthroughRank
│   │   ├── tools/
│   │   │   ├── github-trending.ts     # GitHub Search MCP tool
│   │   │   ├── x-trending.ts          # X recent-search MCP tool
│   │   │   └── hn-trending.ts         # HN firebase API MCP tool
│   │   └── subagents/
│   │       ├── index.ts               # Registered: paper, gh, x, hn
│   │       ├── paper-curator.ts
│   │       ├── gh-curator.ts
│   │       ├── x-curator.ts
│   │       ├── hn-curator.ts
│   │       └── news-curator.ts        # Unregistered (Exa noise issues)
│   ├── types/agent.ts
│   └── utils.ts
│
├── scripts/
│   ├── generate-pulse.ts              # Main pulse runner
│   ├── install-launchd.sh             # macOS schedule install
│   ├── uninstall-launchd.sh
│   └── com.user.daily-pulse.plist.template
│
├── data/                              # SQLite + preferences.json (gitignored)
├── .claude/                           # Claude Code config
├── CLAUDE.md
├── next.config.ts                     # turbopack.root pinned to project dir
└── package.json
```

## Tech stack

| Layer | Tech |
|---|---|
| Framework | [Next.js 16.2.6](https://nextjs.org/) (App Router + Turbopack) |
| Language | TypeScript 5 |
| Agent runtime | [@anthropic-ai/claude-agent-sdk](https://github.com/anthropics/anthropic-sdk-typescript) v0.1.37 |
| Models | `claude-haiku-4-5-20251001` by default (orchestrator + ranker + Research Agent — driven by the `DEFAULT_MODEL` env) |
| Search | [Exa](https://exa.ai/) (`exa-js`), GitHub Search API, X recent-search v2, HN firebase API |
| Storage | SQLite via `better-sqlite3` |
| UI | Tailwind CSS + Radix primitives, `react-markdown` + `remark-gfm` + `rehype-highlight` |
| Testing | Vitest + happy-dom |

## Available scripts

```bash
npm run dev                # Next.js dev server (Turbopack)
npm run build              # Production build
npm start                  # Run production build
npm run lint
npm test                   # vitest run
npm run test:watch
npm run test:coverage
npm run pulse:generate     # One-shot pulse generation
npm run test:agent         # Research Agent integration test
```

## Troubleshooting

**"pulse for YYYY-MM-DD already exists; aborting"**
A pulse for today's date_key already landed. Delete the row (and its items) from `data/pulse.db` to allow a re-run, or wait until tomorrow.

**`x-curator` returns 0 items**
Either `X_BEARER_TOKEN` is unset, or your X API account is out of credits (HTTP 402). The tool silently returns `[]` on any non-2xx X API response (`lib/pulse/tools/x-trending.ts`).

**Module-not-found after `npm install` / `npm audit fix`**
Clear Next.js cache and restart the dev server:
```bash
rm -rf .next && npm run dev
```

**Build / Turbopack workspace root error**
Make sure `next.config.ts` is present and sets `turbopack.root` to the project directory.

## License

MIT
