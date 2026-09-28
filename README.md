# Agentic Workflow Assistant

A Slack assistant that actually *does* things: it runs a real agentic loop
(Claude `tool_use` → execute → feed result back → repeat) with web search, a
safe calculator, and persistent personal notes. Conversation memory lives in
Postgres, with automatic summarisation of old history so context stays bounded.

Why it exists: a portfolio project demonstrating production-flavoured agentic
patterns — multi-step tool use with a guardrail, durable conversation memory,
and graceful degradation — in a small, readable Node.js codebase. Built by
[Kirtan Patel](https://github.com/kirtan95) while job-hunting for AI Engineer /
Software Engineer roles.

## Architecture

```
                        ┌────────────────────────────┐
                        │  Slack (Socket Mode)       │  src/slack.js
                        │  or terminal REPL          │  src/dev.js
                        └─────────────┬──────────────┘
                                      │ user message
                                      ▼
                        ┌────────────────────────────┐
                        │  runAgent()                │  src/agent.js
                        │  1. save user msg          │
                        │  2. load summary + last    │
                        │     ~20 messages           │
                        │  3. agentic loop (max 8)   │
                        └──────┬───────────────┬─────┘
                               │               │
              ┌────────────────▼───┐   ┌───────▼────────────────┐
              │  Claude API        │   │  Tools                 │
              │  (tool_use)        │   │  • web_search (DDG)    │
              └────────────────┬───┘   │  • calculator (own     │
                               │       │    shunting-yard impl) │
                               │       │  • notes (Postgres /   │
                               │       │    JSON fallback)      │
                               │       └───────┬────────────────┘
                               │               │
                        ┌──────▼───────────────▼─────┐
                        │  Postgres                  │
                        │  • messages (memory)       │  src/memory.js
                        │  • summaries (auto-fold    │
                        │     older history in)      │
                        │  • notes                   │
                        └────────────────────────────┘
```

The same `runAgent()` loop drives both the Slack app and the dev REPL, so
everything is testable without Slack credentials.

## Prerequisites

- Node.js 18+ (ES modules)
- An Anthropic API key (`ANTHROPIC_API_KEY`)
- Postgres (optional but recommended) — via Docker or local install
- Slack app tokens (`SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) — only for `npm start`

## Setup

```bash
npm install
cp .env.example .env   # then fill in your keys
```

Postgres via Docker:

```bash
docker run --name assistant-pg -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=assistant -p 5432:5432 -d postgres:16
# .env: DATABASE_URL=postgresql://postgres:secret@localhost:5432/assistant
```

Tables (`messages`, `summaries`, `notes`) are created automatically on first
run — no migrations to manage.

## Usage

**Dev REPL** (no Slack tokens needed, same agent loop):

```bash
npm run dev
# > what is (15 * 1.2) ^ 2?
# > remember that my flight is on Friday
# > what did I ask you to remember?
```

Requires `ANTHROPIC_API_KEY`; exits with a clear error if it is missing. The
assistant never fakes responses.

**Slack** (Socket Mode — no public HTTP endpoint needed):

```bash
npm start
```

DM the bot or @-mention it in a channel. Replies go in a thread.

**Tests** (fully offline):

```bash
npm test
```

## How the tool loop works

`runAgent()` (`src/agent.js`) repeats this cycle, capped at `MAX_ITERATIONS`
(default 8):

1. Send the conversation (system prompt + stored summary + recent messages)
   and the tool definitions to Claude.
2. If Claude returns `tool_use` blocks, execute each tool:
   - unknown tool → error result, loop continues
   - tool throws → `is_error` result fed back so Claude can recover
3. Append the `tool_result`s as a user message and go again.
4. Stop when Claude answers in plain text (or the cap is hit, in which case the
   user gets an honest "ran out of steps" message).

## Tools

| Tool | Implementation |
|---|---|
| `web_search` | DuckDuckGo Instant Answer API over HTTPS — no API key needed. Returns the instant-answer abstract plus related topics with URLs. Network failures become failed tool results, not crashes. |
| `calculator` | Hand-written tokenizer + shunting-yard + RPN evaluator (`src/tools/calculator.js`). No `eval`. Supports `+ - * / % ^`, parentheses, unary minus, decimals; raises on division by zero and malformed input. |
| `notes_save` / `notes_list` / `notes_search` | Per-user notes. Postgres when `DATABASE_URL` is set, otherwise a local JSON file (`~/.agentic-workflow-assistant/notes.json`) with a one-time logged warning. |

## Design decisions

- **Slack Socket Mode** (`@slack/bolt`): no public URL, tunneling, or webhook
  verification needed — the app opens an outbound WebSocket. Ideal for a
  personal assistant and far simpler to deploy than Events API webhooks.
- **Postgres-backed memory + summarisation**: every turn persists
  `(user_id, role, content, created_at)`. Each turn loads the last ~20
  messages; once history passes ~40 messages, the older half is summarised by
  Claude into a stored summary that is prepended to the system prompt and the
  summarised rows are deleted. Bounded context, durable recall — the classic
  long-running-agent pattern.
- **Tool guardrails**: max-iterations cap, unknown-tool rejection, and
  per-tool try/catch so one bad tool call degrades to an error result instead
  of killing the turn. The calculator is a real parser (never `eval`) because
  it evaluates untrusted model-generated strings.
- **Graceful degradation**: no `DATABASE_URL` → notes fall back to a JSON file
  and memory becomes in-process, each with a clear logged warning. No
  `ANTHROPIC_API_KEY` → dev mode exits with an explicit error instead of
  hallucinating replies; summarisation is skipped gracefully when there is no
  key. The assistant always tells you what it is missing.
- **`node:test` for tests**: zero extra dependencies; the whole suite
  (`npm test`) runs offline with stubbed Claude clients and fixture data.

## Project structure

```
src/
  config.js        env loading + requireEnv()
  assistant.js     shared wiring (client, store, memory, dispatch)
  agent.js         the agentic loop
  memory.js        Postgres conversation memory + summarisation
  dev.js           terminal REPL
  slack.js         Bolt Socket Mode app
  tools/
    index.js       Claude tool definitions + dispatch table
    calculator.js  shunting-yard arithmetic evaluator
    webSearch.js   DuckDuckGo Instant Answer client
    notes.js       notes store (Postgres with JSON fallback)
tests/             offline node:test suite
```

## License

MIT — see [LICENSE](LICENSE).
