<div align="center">

<img src="logo.png" alt="AgentAlpha" width="120" />

# AgentAlpha

### Build a stock-trading agent by typing one sentence. No code.

Describe a strategy in plain English → get a real, **backtestable** trading agent.

<!-- 🎥 TODO: drop a 15-second demo GIF here (record building an agent in the chat) — it's the #1 driver of stars. -->

[**agentalpha.app**](https://agentalpha.app) &nbsp;·&nbsp;
[![Stars](https://img.shields.io/github/stars/YashSarwaiya/agentalpha?style=social)](https://github.com/YashSarwaiya/agentalpha/stargazers)
&nbsp; ![MIT](https://img.shields.io/badge/license-MIT-15a553)
![Python](https://img.shields.io/badge/python-3.11+-3776AB)
![paper trading](https://img.shields.io/badge/paper-not%20advice-999)

</div>

---

## ⚡ The 10-second demo

**You type:**

> *"Buy strong tech stocks breaking out to new highs. Sell if they drop below the 50-day average."*

**AgentAlpha builds a real, deterministic strategy:**

```jsonc
screen: [
  { field: "sector",       op: "==", value: "Technology" },
  { field: "rs_rating",    op: ">=", value: 80 },        // market leaders
  { field: "any_breakout", op: "==", value: true }       // fresh breakout
],
sell_when: "price < 50-day moving average"
```

…then **backtests it on 5 years of real market history** and paper-trades it live. No code, ever.

## 🧠 Not "another AI wrapper"

The trick most LLM tools miss: **the AI only _writes_ the strategy once — plain, deterministic code _runs_ it.**

```
your words → Claude (Haiku) → a {field, op, value} screen → the screener runs it, no LLM
```

So every agent is **reproducible, free at runtime, backtestable, and explainable** — not a black box hallucinating trades.

## 🚀 Run it (60 seconds)

```bash
# backend — Python 3.11+
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add ANTHROPIC_API_KEY
uvicorn main:app --reload --port 8000

# frontend — Node 20+
cd frontend && npm install && npm run dev      # → localhost:5173
```

**No API key?** Type **"make a Minervini agent"** — famous strategies run from built-in checklists, zero cost.

## ✨ Build · Backtest · Share

- 🛠️ **Build** — describe your strategy in plain English. No code, no forms.
- 🔬 **Backtest** — replay it over **5 years of real market history**, point-in-time (no look-ahead).
- 🌐 **Share** — publish your agent, grow a public track record, climb the community leaderboard.

*This repo is the open **builder**. The hosted app ([agentalpha.app](https://agentalpha.app)) adds real market data, the full 5-year backtest, and live paper-trading with public track records.*

## ⭐ Help it grow

If this is useful, **[star the repo](https://github.com/YashSarwaiya/agentalpha)** — we're building the largest open community of AI trading agents, and stars are how other builders find it. PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

<sub>🧪 Paper trading, educational only. [MIT](LICENSE) licensed. Not affiliated with any named investor or method. **Not investment advice.**</sub>
