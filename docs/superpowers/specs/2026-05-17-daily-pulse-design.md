# Daily Pulse — Proactive Research Agent

**Status:** Approved design, ready for implementation plan
**Date:** 2026-05-17
**Owner:** Waleed Arafa (single-user, local)
**Parent project:** `deep-ai-research` (multi-agent Claude SDK app, already running on `localhost:3003`)

## 1. Problem & Goal

The interactive research agent in `deep-ai-research` is reactive: you type a query, it searches. The user wants the inverse — a **proactive** morning briefing that runs unattended, pulls fresh AI research and news from multiple sources, ranks it against the user's evolving interests, and presents it as an editorial card feed. Inspired by ChatGPT Pulse and the speaker's teaser branch shown at t≈59:00–1:02:00 of the lesson.

**Success criteria for v1**

- A pulse is generated automatically at 07:00 local every day with zero manual intervention.
- The feed converges to the user's actual interests within ~7 days of Like/Dislike feedback (cold start is tolerated by design).
- Each card supports per-item agent conversation ("Ask agent") with 6 preset quick actions.
- Daily cost stays under $2.
- Failure of any single source (e.g. X API outage) does not break the pulse.

## 2. Scope

### In scope (v1)

- Local-only single-user deployment on macOS
- 4 source curators: arXiv papers, AI news, GitHub trending, X trending
- Pure-discovery personalization (no upfront topic config)
- Cold-start tolerated (week 1 is generic)
- macOS launchd at 07:00 daily
- Editorial-card UI matching the user-supplied reference screenshot (cream parchment + brick red + serif body + mono UI)
- Per-card Ask agent with 6 preset quick actions
- SQLite storage for pulses, items, feedback
- Cost guardrails via `MAX_BUDGET_USD` daily cap

### Out of scope (v2+)

- Multi-user / auth
- Mobile UI / responsive below 1024px
- Push notifications
- Conversation persistence for Ask agent (ephemeral in v1)
- Semantic embedding ranker (LLM ranker reads raw samples in v1)
- "Share this pulse" links

## 3. Architecture

### High-level flow

```
launchd 07:00 ──▶ scripts/generate-pulse.ts ──▶ Pulse orchestrator (Claude Agent SDK)
                                                  │
                                                  ├──▶ Task: paper-curator    ─┐
                                                  ├──▶ Task: news-curator     ─┤  parallel
                                                  ├──▶ Task: gh-curator       ─┤
                                                  └──▶ Task: x-curator        ─┘
                                                  │
                                                  ├──▶ merge + dedupe by URL
                                                  ├──▶ read data/preferences.json
                                                  └──▶ ranker.ts (single Haiku call) ──▶ top 10

scripts/generate-pulse.ts writes results ──▶ SQLite (data/pulse.db)

User opens localhost:3003/pulse  ──▶ /api/pulse/today + /api/pulse/history
                              click ❤/👎/🔖 ──▶ /api/pulse/feedback ──▶ feedback table
                              click 💬 Ask    ──▶ /api/pulse/ask    ──▶ streamed SSE
                              click quick action ──▶ pre-filled Ask call
```

### File layout

```
deep-ai-research/
├── lib/
│   ├── agent/                          # existing — /research orchestrator
│   └── pulse/                          # NEW
│       ├── config.ts                   # Pulse orchestrator + 4 subagent defs
│       ├── subagents/
│       │   ├── paper-curator.ts
│       │   ├── news-curator.ts
│       │   ├── gh-curator.ts
│       │   └── x-curator.ts            # gracefully skipped if X_BEARER_TOKEN missing
│       ├── tools/
│       │   ├── github-trending.ts      # MCP-style tool wrapping GitHub search API
│       │   └── x-trending.ts           # MCP-style tool wrapping X API v2
│       ├── db.ts                       # better-sqlite3 wrapper + migrations
│       ├── preferences.ts              # derives preferences.json from feedback rows
│       └── ranker.ts                   # single Haiku call to rank candidates
├── scripts/
│   ├── generate-pulse.ts               # launchd entry point
│   └── install-launchd.sh              # writes & loads the .plist
├── app/
│   ├── pulse/
│   │   ├── page.tsx                    # /pulse — today
│   │   └── [date]/page.tsx             # /pulse/YYYY-MM-DD — historical
│   └── api/pulse/
│       ├── today/route.ts              # GET latest pulse
│       ├── history/route.ts            # GET pulse list
│       ├── feedback/route.ts           # POST one feedback row
│       ├── ask/route.ts                # POST → SSE stream
│       └── generate/route.ts           # POST → manual Gen Now
├── components/pulse/
│   ├── PulseShell.tsx                  # sidebar + content layout
│   ├── TopicFilter.tsx                 # sidebar top: FILTER BY TOPIC
│   ├── HistoryList.tsx                 # sidebar bottom: past pulses
│   ├── PulseHeader.tsx                 # top bar: date + Gen Now + budget meter
│   ├── PulseCard.tsx                   # one editorial card
│   ├── QuickActions.tsx                # 6-button preset grid inside a card
│   ├── AskAgentBox.tsx                 # input + send + streamed response
│   └── FeedbackStrip.tsx               # 🔖 ❤ 👎 row at card bottom
└── data/                               # gitignored
    ├── pulse.db                        # SQLite
    ├── preferences.json                # rebuilt each morning
    ├── pulse.log                       # launchd stdout
    └── pulse.err                       # launchd stderr
```

## 4. Storage

### SQLite schema (`data/pulse.db`)

```sql
CREATE TABLE pulses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_at  TEXT    NOT NULL,                   -- ISO 8601 UTC
  date_key      TEXT    NOT NULL UNIQUE,            -- 'YYYY-MM-DD' local
  item_count    INTEGER NOT NULL,
  cost_usd      REAL,
  duration_ms   INTEGER,
  status        TEXT    NOT NULL DEFAULT 'ok'       -- ok | partial | failed | running
);
CREATE INDEX idx_pulses_date ON pulses(date_key DESC);

CREATE TABLE pulse_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pulse_id      INTEGER NOT NULL REFERENCES pulses(id) ON DELETE CASCADE,
  rank          INTEGER NOT NULL,                   -- 1..10
  source        TEXT    NOT NULL,                   -- paper | news | x | github
  priority      TEXT    NOT NULL,                   -- high | medium | low
  match_score   INTEGER NOT NULL,                   -- 1..5, drives the dots UI
  complexity    TEXT    NOT NULL,                   -- beginner | intermediate | advanced
  read_minutes  INTEGER,                            -- estimated from body_md word count
  title         TEXT    NOT NULL,
  url           TEXT    NOT NULL,
  outlet        TEXT,                               -- 'arXiv' | 'Anthropic' | etc. for the metadata strip
  summary       TEXT    NOT NULL,                   -- 2-4 sentences, agent-written pull-quote
  topics        TEXT    NOT NULL,                   -- JSON array of tag strings
  body_md       TEXT,                               -- lazy-fetched on first Expand
  source_meta   TEXT,                               -- JSON: authors, date, stars, etc.
  created_at    TEXT    NOT NULL
);
CREATE INDEX idx_items_pulse ON pulse_items(pulse_id, rank);
CREATE UNIQUE INDEX idx_items_url ON pulse_items(url);

CREATE TABLE feedback (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL REFERENCES pulse_items(id),
  action        TEXT    NOT NULL,                   -- like | dislike | bookmark | expand | dwell
  created_at    TEXT    NOT NULL,
  meta          TEXT                                -- JSON, e.g. {"dwell_ms": 12400}
);
CREATE INDEX idx_feedback_action_date ON feedback(action, created_at DESC);

CREATE TABLE usage (
  date_key      TEXT PRIMARY KEY,                   -- 'YYYY-MM-DD'
  cost_usd      REAL NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);
```

**Notes**

- `idx_items_url UNIQUE` prevents the same URL re-surfacing across days. Important for a daily feed.
- `feedback` is append-only; the agent's "memory" is derived from it on each morning run, never stored separately.
- `usage` row keyed by `date_key` tracks combined morning-gen + Ask-agent cost for the budget cap.

## 5. Personalization

### `data/preferences.json` (rebuilt each morning by `lib/pulse/preferences.ts`)

```json
{
  "generated_at": "2026-05-17T07:00:01Z",
  "window_days": 30,
  "samples": {
    "liked":     [{"title": "...", "summary": "...", "source": "paper"}],
    "disliked":  [{"title": "...", "summary": "...", "source": "news"}],
    "bookmarked":[],
    "expanded_but_no_signal": []
  },
  "counts": {"liked": 47, "disliked": 12, "bookmarked": 8},
  "source_weights": {"paper": 0.42, "news": 0.31, "github": 0.20, "x": 0.07},
  "topic_signals": {
    "loved":   ["mixture of experts", "agent harnesses", "Claude SDK"],
    "avoided": ["RLHF survey", "AI safety governance"]
  }
}
```

- `samples` carries **raw titles + summaries** (not topics) — the ranker uses them as in-context preference examples.
- `source_weights` = `(likes - dislikes) / max(items_shown, 1)` per source. Influences candidate count per curator.
- `topic_signals` is a one-shot LLM extraction during preferences rebuild ("Read these N liked + N disliked items, return arrays of recurring themes"). Used for the topic-filter sidebar and as ranker instruction.

### Cold start (when `counts.liked < 5`)

- `source_weights` defaults to `{paper: 0.4, news: 0.3, github: 0.2, x: 0.1}`.
- Ranker prompt swaps to "no preference signal yet, pick by recency × source diversity × novelty."
- Pulses generated during cold start are still useful as Like/Dislike training surface.

### Ranker safeguards (always on, including post-cold-start)

1. **Exploration quota** — up to 2 of 10 items should be `medium` priority from topics the user has not engaged with. Best-effort: if fewer than 2 unfamiliar-topic candidates exist, fill the slots with the next-best familiar items. Prevents filter-bubble collapse without breaking on thin candidate pools.
2. **Source diversity floor** — at most 5 items from any one source.

## 6. Subagents

All curators are `Task`-callable subagents registered in `lib/pulse/config.ts`. Pattern matches the existing `lib/agent/agents.ts` style.

### `paper-curator`
- Model: `claude-haiku-4-5-20251001`
- Tools: `mcp__exa-search__search`, `mcp__exa-search__get_contents`
- Prompt: find 10–15 AI/ML papers published in the last 24h via Exa neural search with `arxiv.org` domain filter. Return JSON `{title, url, summary, outlet:"arXiv", source_meta:{authors, published_date, arxiv_id}, topics:[...]}`. Skip survey papers unless they cite ≥3 results from this week.

### `news-curator`
- Model: `claude-haiku-4-5-20251001`
- Tools: `mcp__exa-search__search`, `mcp__exa-search__get_contents`
- Prompt: find 8–12 AI lab announcements / research blog posts in the last 36h. Domain filter: `anthropic.com,openai.com,deepmind.google,research.google,ai.meta.com,huggingface.co,nvidia.com,blog.langchain.dev,simonwillison.net`. Skip product marketing; prefer technical posts. Same JSON shape.

### `gh-curator`
- Model: `claude-haiku-4-5-20251001` (very light usage)
- Tools: `mcp__github-trending__list_trending` (custom)
- Tool implementation: `fetch('https://api.github.com/search/repositories?q=created:>{yesterday}+topic:llm+topic:ai+topic:agents&sort=stars')` → top 15. Unauthenticated public search; 60 req/h is ample.
- Prompt: write 2-sentence summaries from description + readme excerpt. Return same JSON shape with `source_meta:{stars_today, language, repo}`.

### `x-curator` (gracefully skipped if `X_BEARER_TOKEN` env missing)
- Model: `claude-haiku-4-5-20251001`
- Tools: `mcp__x__list_recent_tweets` (custom)
- Tool implementation: X API v2 `/2/tweets/search/recent` with a curated list of ~20 high-signal AI accounts hardcoded for v1, `max_results=50`, `start_time=24h_ago`.
- Prompt: pick the 5 with strongest signal (engagement / not just announcements). Return JSON with `source_meta:{author, reply_count, like_count, tweet_id}`.
- **Failure mode:** if env is missing or API errors, the subagent returns `[]` and the orchestrator continues with the remaining 3 sources. The pulse never fails because of X.

### Orchestrator
- Model: `claude-haiku-4-5-20251001`
- Tools: `Task`, `Read` (to read `preferences.json`)
- Prompt: dispatch all four curator subagents in parallel via `Task`. Wait for all results. Concatenate JSON arrays. Dedupe by URL. Read `data/preferences.json`. Call `ranker.ts` with candidates + preferences. Return the final top-10 JSON to the calling script. **The orchestrator does not write to the DB** — `scripts/generate-pulse.ts` does that, so the agent's tool surface stays minimal and writes are auditable in code.

## 7. Ranker (`lib/pulse/ranker.ts`)

Single Haiku call. Input = up to 50 deduped candidates + `preferences.json`. Output = 10 items with `{candidate_idx, priority, match_score}`.

Prompt sketch:

> You are ranking AI/ML items for a single user's morning feed. Use the user's liked/disliked samples as in-context preference examples. Surface items similar to liked ones; suppress items similar to disliked ones. Return JSON `[{candidate_idx, priority, match_score}]` ordered by display rank. `priority`: `high` = strong match; `medium` = adjacent / exploratory. `match_score`: 1–5 = how strongly the item matches liked patterns. Constraints:
> - Exactly 2 items must be `medium` priority from topics the user has not engaged with.
> - At most 5 items from any one source.
> - Never repeat URLs from `recent_pulse_urls` (last 30 days).
> - During cold start (passed as flag), rank by recency × source diversity × novelty instead.

## 8. UI

### Visual language (matches user-supplied reference screenshot)

- Background: parchment cream `#f5f1e8`
- Card: same cream, ~1px border, soft shadow
- Body serif: Charter / Iowan Old Style / Source Serif Pro fallback chain
- Mono UI text: JetBrains Mono / IBM Plex Mono fallback chain
- Accent: deep brick red `#8b1a1a` for active state + pull-quote left bar + ASK AGENT dot
- Source pill colors (matching screenshot pill style):
  - `PAPER` — forest green
  - `NEWS` — teal blue
  - `GITHUB` — purple
  - `X` — cyan
- `ESSENTIAL` (priority high) — gold star pill

### Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│  Daily Pulse — Thursday, May 17, 2026          [Today ▼]  [Gen Now] │
├────────────┬───────────────────────────────────────────────────────────┤
│ FILTER BY  │   ┌── card 1 ──┐  ┌── card 2 ──┐  ┌── card 3 ──┐  ...    │
│   TOPIC    │   │            │  │            │  │            │          │
│  ALL    9  │   │  see card  │  │            │  │            │          │
│  MoE    3  │   │  structure │  │            │  │            │          │
│  agents 2  │   │  below     │  │            │  │            │          │
│  ...       │   └────────────┘  └────────────┘  └────────────┘          │
│  CLEAR x   │                                                            │
├────────────┤                                                            │
│ HISTORY    │                                                            │
│ • Today    │                                                            │
│ • Yest  7  │                                                            │
│ • 2d ago 9 │                                                            │
└────────────┴───────────────────────────────────────────────────────────┘
```

### Per-card structure (top to bottom)

1. **Pill strip**: `[SOURCE]` + `[COMPLEXITY]` + (if `priority==='high'`) `★ ESSENTIAL`
2. **Title** — large serif
3. **Metadata strip** — `SOURCE · OUTLET · N MIN READ`, uppercase mono
4. **Pull-quote** — italic serif, red left border, agent-written summary (2–4 sentences)
5. **▶ READ FULL** — toggle that loads/shows `body_md` (lazy on first click)
6. **Stats row** — `MATCH ■■■■□` (5 dots, `match_score` filled) · `COMPLEXITY <text>` · `READ TIME <n> min`
7. **Topic chips** — clickable, filter the sidebar
8. **`PART II` quick actions** — 6 buttons:
   - ◆ KEY CONCEPTS
   - ◆ MENTAL MODELS
   - ○ DIAGRAM
   - (/) CODE PATTERN
   - ○ TAKEAWAYS / IMPLICATIONS
   - ※ FLASHCARDS

   Each pre-fills the Ask agent box with a preset prompt and auto-sends.
9. **● ASK AGENT** label + input box + SEND → button
   - Free-form question, streams response below
   - Conversation lives in component state, ephemeral
   - Per-item conversation, soft cap at 6 turns: after turn 6, a system note appears inline ("Long thread — consider starting fresh for focus") but the input stays enabled
10. **Feedback strip** — 🔖 Bookmark / ❤ Like / 👎 Dislike (Like/Dislike are mutually exclusive)
11. **Dwell tracking** — client-side timer on expanded card, posted as `{action:'dwell', meta:{dwell_ms}}` on collapse/unmount

### Quick action preset prompts

| Button | Prompt template |
|---|---|
| ◆ KEY CONCEPTS | "List the 5 most important concepts this introduces, one line each." |
| ◆ MENTAL MODELS | "What analogies or frameworks would help someone understand this?" |
| ○ DIAGRAM | "Draw an ASCII or mermaid diagram of the method/system." |
| (/) CODE PATTERN | "Sketch the simplest working code example of the core idea." |
| ○ TAKEAWAYS / IMPLICATIONS | "What are the 3 most important practical implications for an AI engineer?" |
| ※ FLASHCARDS | "Make 5 spaced-repetition flashcards (Q on one line, A on next)." |

### Sidebar

- **FILTER BY TOPIC** (top): derived from union of `topics` chips across today's cards. Counts shown. `ALL` is default. `CLEAR x` resets.
- **HISTORY** (bottom): past pulse list. Today gets `●` badge. Click navigates to `/pulse/[date]`.

### API routes

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/pulse` | Server component. Loads latest pulse + history, renders shell. |
| `GET` | `/pulse/[date]` | Same shell for a specific date. 404 if no pulse exists. |
| `GET` | `/api/pulse/today` | `{pulse, items}` for most recent row |
| `GET` | `/api/pulse/history` | `[{id, date_key, item_count, generated_at}]` DESC |
| `POST` | `/api/pulse/feedback` | Body `{item_id, action, meta?}` → inserts into `feedback`. Returns 200 or 400. |
| `POST` | `/api/pulse/ask` | Body `{item_id, message, conversation_id?}` → SSE stream. Pre-loads item context, calls Haiku (Sonnet for "explain in depth" / "compare to" keywords). |
| `POST` | `/api/pulse/generate` | Manual trigger for the orchestrator pipeline. Returns the new pulse_id. |

### Server vs client boundaries

- `/pulse` page = server component, reads SQLite directly for initial render
- `<PulseFeed>` = client component, handles interactions
- `data/pulse.db` is server-only; client always goes through `/api/pulse/*`
- Agent never reads `feedback` directly — only `data/preferences.json`. The derived view is the single thing the agent sees.

## 9. Scheduling & ops

### launchd

`~/Library/LaunchAgents/com.user.daily-pulse.plist`, installed by `scripts/install-launchd.sh`:

- `StartCalendarInterval` `Hour=7 Minute=0` — exactly once per day
- `WorkingDirectory` set to repo root
- `StandardOutPath` / `StandardErrorPath` → `data/pulse.log` / `data/pulse.err`
- If Mac is asleep at 07:00, launchd fires at next wake (OS default)

### Error handling

| Failure | Behavior |
|---|---|
| Single subagent throws | Continue with others; `pulses.status='partial'` |
| All subagents fail | Write `status='failed'`; UI shows yesterday's pulse + "couldn't generate today" banner |
| Exa quota exhausted | Curator returns `[]`; `status='partial'`; banner on UI |
| Ranker call fails | Fall back to recency × source_weight; `status='partial'` |
| `MAX_BUDGET_USD` exceeded mid-run | Stop new dispatches; write what's collected; `status='partial'` |
| `body_md` lazy fetch fails | Show summary + footer "Couldn't fetch full text"; Ask agent still works |
| Ask agent stream errors | Reset conversation, surface error inline, no DB write |

### Cost guardrails

- `MAX_BUDGET_USD` checked **before each agent dispatch** (orchestrator + each subagent + ranker + each ask).
- Tracked across morning gen + all Ask agent calls combined in the `usage` row keyed by `date_key`.
- At 80% used: `<PulseHeader>` shows remaining budget.
- At 100% used: Ask agent disables itself with tooltip "Daily budget reached — resets at midnight."
- Default: `MAX_BUDGET_USD=2.0` (already in `.env.local`).

### Logging

- `data/pulse.log` — one structured JSON line per pulse run: `{timestamp, duration_ms, items_count, cost_usd, status, errors[]}`
- `data/pulse.err` — stack traces only
- No external observability for v1

## 10. Testing

Stack: **Vitest** for unit + integration. No Playwright in v1.

| Layer | Test type | Notes |
|---|---|---|
| `lib/pulse/db.ts` | unit | open/migrate empty DB, insert pulse + items, query, dedupe URL conflict |
| `lib/pulse/preferences.ts` | unit | fixture `feedback` rows → assert derived `preferences.json` shape & source_weights |
| `lib/pulse/tools/github-trending.ts` | integration | live GitHub API; passes if ≥5 repos returned |
| `lib/pulse/tools/x-trending.ts` | integration | skipped if `X_BEARER_TOKEN` unset |
| `lib/pulse/ranker.ts` | unit | mock SDK; assert prompt contains liked/disliked samples; assert output schema |
| Orchestrator end-to-end | smoke | `scripts/generate-pulse.ts` against fresh DB; assert one `pulses` row + 10 `pulse_items` |
| `/api/pulse/feedback` | unit | `{action:'like'}` writes a row; invalid action → 400 |
| `/api/pulse/ask` | unit | mocked SDK stream; assert SSE format; budget check denies over cap |
| UI | manual checklist | filter narrows cards; expand fills body; quick action pre-fills prompt; like → tomorrow's preferences picks it up |

Coverage target: **80%** for `lib/pulse/*` per the global testing rule. API routes get smoke coverage only.

## 11. Build order (high-level — detailed plan comes from writing-plans)

1. **Storage + preferences** (`lib/pulse/db.ts`, `preferences.ts`, migrations) — unit-tested, isolated.
2. **Tools** (`github-trending.ts`, `x-trending.ts`) — testable independently.
3. **Subagents** (`paper-curator.ts`, `news-curator.ts`, `gh-curator.ts`, `x-curator.ts`) + pulse `config.ts`.
4. **Ranker** (`lib/pulse/ranker.ts`).
5. **Entry script** (`scripts/generate-pulse.ts`) — wires it all, writes to SQLite.
6. **Smoke run** end-to-end against real APIs; verify pulse row + 10 items + ~$0.05–0.20 cost.
7. **API routes** (`today`, `history`, `feedback`, `generate`).
8. **UI components** (`PulseShell`, `TopicFilter`, `HistoryList`, `PulseHeader`, `PulseCard`, `QuickActions`, `FeedbackStrip`).
9. **Ask agent route** + `<AskAgentBox>` streaming.
10. **launchd setup** (`scripts/install-launchd.sh`) + first scheduled run.

Steps 1–6 can ship without UI — verify backend first by querying SQLite directly. Then build UI on a known-good data substrate.

## 12. Open questions

None — all six design sections approved 2026-05-17. Any change after this point goes through writing-plans as a plan revision.
