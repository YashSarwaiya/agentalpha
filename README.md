# Agent Builder Chat — open source

The conversational builder from [AgentAlpha](https://agentalpha.app): **describe a
trading strategy in plain English, and the chat turns it into a real, working
agent spec** — a deterministic stock screen + risk settings — no code, no forms.

This folder is fully standalone. It runs with **one API key** (or zero — see
playbooks mode) and ships a synthetic sample universe, so you can hack on the
chat experience without any database or market-data subscription.

> Everything here paper-trades ($100k simulated book in the production app).
> Nothing is investment advice.

## What's in the box

```
backend/                       FastAPI server (Python 3.11+)
  main.py                      the whole API surface (~8 endpoints)
  agent_builder.py             ★ the heart — one LLM chat turn → spec (system prompt lives here)
  screen.py                    deterministic screener: {field, op, value} conditions → ranked tickers
  playbooks.py                 13 curated famous-investor checklists ("make a Minervini agent")
  cost_guard.py                daily LLM spend killswitch
  sample_data.py               40 FICTIONAL stocks so screens work with zero setup
frontend/                      Vite + React 19 + Tailwind v4
  src/components/arena/
    AgentInterview.tsx         ★ the chat UI — chat loop, option chips, sliders, spec panel
    PreviewPanel.tsx           renders "what it would buy right now"
    BacktestPanel.tsx          renders backtest results (engine not included — see below)
  src/lib/api.ts               typed fetch client (8 endpoints)
  src/lib/builderStore.ts      localStorage drafts, version history, backtest-run memory
  src/types/arena.ts           all shared types
```

## Quickstart

**Backend** (Python 3.11+):

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # add your ANTHROPIC_API_KEY
uvicorn main:app --reload --port 8000
```

**Frontend** (Node 20+):

```bash
cd frontend
npm install
npm run dev                      # → http://localhost:5173
```

Type "growth stocks with strong momentum" and watch the spec build itself.

### No API key? Playbooks mode

Without `ANTHROPIC_API_KEY`, the chat still answers requests that name a famous
investor strategy — try **"make a Minervini agent"**. Those turns are fully
deterministic (a curated checklist in `playbooks.py`), cost nothing, and
exercise the whole UI.

## How it works

```
user message
   │
   ▼
POST /api/v1/agent-builder
   │
   ├─ names a known strategy? → playbooks.py (deterministic, no LLM)
   │
   └─ else → Claude (Haiku) with a forced `respond` tool call
        · system prompt = the builder's rules + field vocabulary (agent_builder.py)
        · returns {reply, options, slider?, spec} — the spec carries the SCREEN:
          a list of {field, op, value} conditions
   │
   ▼
screen.py runs the conditions against the universe → "matches N of M" + tickers
   │
   ▼
the UI renders the reply + updates the live agent-anatomy panel
```

Key design choice: **the AI only BUILDS the spec — deterministic code runs it.**
A buy rule that's a number becomes a screen condition; the stocks that pass the
screen are the buys. That keeps the runtime reproducible, free, and explainable.

## The screen field vocabulary

The model may only emit fields whitelisted in `screen.py` → `FIELD_MAP` (~75
fields: valuation, growth, health, dividends, ownership, momentum, chart
patterns with setup/breakout timing, and catalyst booleans). Unknown fields are
dropped defensively (`normalize_conditions`). To add a field: add it to
`FIELD_MAP`, describe it in the system prompt in `agent_builder.py`, and make
sure your data provides it.

## Sample data — read this

The bundled universe (`sample_data.py`) is **synthetic and fictional** — made-up
tickers, made-up values, seeded so everyone sees the same 40 stocks. It exists
so the screener demo works with no market-data license. Don't read anything
into the numbers.

### Bring your own data

Point `DATABASE_URL` at a Postgres with a `stocks` table:

```sql
CREATE TABLE stocks (
  ticker TEXT PRIMARY KEY,
  name TEXT, sector TEXT,
  market_cap BIGINT, last_price DECIMAL,
  is_top_100 BOOLEAN DEFAULT FALSE,   -- the screenable subset
  context JSONB                        -- nested doc; paths must match FIELD_MAP
);
```

`screen.py` extracts only the `FIELD_MAP` paths server-side, so a large
`context` document stays cheap to query.

## Integration points (not included)

| Seam | In this repo | In production |
|---|---|---|
| Auth | none (local dev server) | JWT per user, rate limits, per-user LLM budgets |
| Deploy | writes `local_agents.json` | deploys to a live paper-trading engine |
| Backtest | returns a friendly 400 | 5-year point-in-time replay over real history |
| Preview | deterministic screen + sizing | same, plus live prices |

The UI already handles all of these seams gracefully, so wiring in your own
engine is additive — implement the endpoint, keep the response shape.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Good first areas: better conversation
flows in the system prompt, new playbooks, new screen fields, UI polish,
non-Anthropic model support.

## License

[MIT](LICENSE)
