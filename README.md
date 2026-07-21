<div align="center">

<img src="logo.png" alt="AgentAlpha" width="130" />

# AgentAlpha — Agent Builder

**Describe a trading strategy in plain English.**
**The chat turns it into a real, working agent — no code, no forms.**

[**agentalpha.app**](https://agentalpha.app) &nbsp;·&nbsp;
![MIT](https://img.shields.io/badge/license-MIT-15a553)
![Python](https://img.shields.io/badge/python-3.11+-3776AB)
![paper trading](https://img.shields.io/badge/paper%20trading-not%20advice-999)

</div>

---

This is the open-source **conversational builder** behind [AgentAlpha](https://agentalpha.app). You chat a strategy — *"growth stocks with strong momentum"* — and it builds a **deterministic stock screen + risk settings** you can run. Fully standalone: one API key (or zero — playbooks mode) and a synthetic 40-stock universe, no database needed.

> 🧪 Everything is **paper trading** (simulated). Nothing here is investment advice.

## ✨ The idea

**The AI only _builds_ the spec — plain code _runs_ it.**

```
"buy growth stocks with strong momentum, sell if they drop below the 50-day"
        │
        ▼   Claude (Haiku) → a structured screen:  {field, op, value} + risk
        ▼   a deterministic screener runs it → the stocks that pass are the buys
        ▼   reproducible, free, explainable — no LLM at run time
```

## 🚀 Quickstart

**Backend** (Python 3.11+)

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add your ANTHROPIC_API_KEY
uvicorn main:app --reload --port 8000
```

**Frontend** (Node 20+)

```bash
cd frontend
npm install
npm run dev                   # → http://localhost:5173
```

Type *"growth stocks with strong momentum"* and watch the spec build itself.

**No API key?** Try **"make a Minervini agent"** — famous-investor strategies are answered from curated checklists (`playbooks.py`): zero LLM, zero cost.

## 📦 What's inside

| File | |
|---|---|
| `backend/agent_builder.py` | ★ the heart — one chat turn → spec (the system prompt) |
| `backend/screen.py` | deterministic screener (~75 whitelisted fields) |
| `backend/playbooks.py` | 13 famous-investor checklists |
| `backend/sample_data.py` | 40 **fictional** stocks — runs with zero setup |
| `frontend/…/AgentInterview.tsx` | ★ the chat UI |

## 🔌 Open vs. hosted

This repo is the **builder**. The hosted app adds the closed pieces:

| | This repo | [agentalpha.app](https://agentalpha.app) |
|---|---|---|
| Market data | 40 fake stocks | thousands of real stocks |
| Backtest | stub | 5-year point-in-time replay |
| Deploy / paper-trade | local file | live paper engine + public track record |

Wiring in your own data/engine is additive — implement the endpoint, keep the response shape.

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first areas: conversation flows, new playbooks, screen fields, UI polish, non-Anthropic model support.

## Notice

Strategy/method names (CAN SLIM, Magic Formula, etc.) and investor names belong to their respective owners and are used here **descriptively only** — not affiliated, not endorsed, and **not investment advice**.

## License

[MIT](LICENSE) © 2026 AgentAlpha
