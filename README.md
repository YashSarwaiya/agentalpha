<div align="center">

<img src="logo.png" alt="AgentAlpha" width="120" />

# AgentAlpha

**Describe a trading strategy in plain English — the chat turns it into a working agent.**

[**agentalpha.app**](https://agentalpha.app) &nbsp;·&nbsp;
![MIT](https://img.shields.io/badge/license-MIT-15a553)
![Python](https://img.shields.io/badge/python-3.11+-3776AB)
![paper trading](https://img.shields.io/badge/paper%20trading-not%20advice-999)

</div>

---

The open-source **chat builder** behind [AgentAlpha](https://agentalpha.app): say *"growth stocks with strong momentum"* and get a **deterministic stock screen + risk rules** you can run. Standalone — one API key (or zero) and a 40-stock sample universe, no database.

> 🧪 Paper trading only. Not investment advice.

## How it works

**The AI builds the spec; plain code runs it.**

```
your words → Claude (Haiku) → a {field, op, value} screen → the screener runs it → stocks that pass are the buys
```

No LLM at run time, so it's reproducible, free, and explainable.

## Run it

```bash
# backend — Python 3.11+
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add ANTHROPIC_API_KEY
uvicorn main:app --reload --port 8000

# frontend — Node 20+
cd frontend && npm install && npm run dev      # → localhost:5173
```

**No API key?** Try **"make a Minervini agent"** — famous strategies run from built-in checklists, zero cost.

## Open vs. hosted

This repo is the **builder**. The hosted app ([agentalpha.app](https://agentalpha.app)) adds real market data, a 5-year backtest, and a live paper-trading engine with public track records.

## License

[MIT](LICENSE) · Not affiliated with any named investor or method · Not investment advice.
