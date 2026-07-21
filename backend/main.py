"""Standalone server for the open-source agent-builder chat.

Run:  uvicorn main:app --reload --port 8000

This is the whole backend the chat UI needs:
  POST /api/v1/agent-builder     the conversational builder (the heart of this repo)
  POST /api/v1/preview           deterministic "what would it buy right now" preview
  POST /api/v1/me/agents         save the finished spec to a local JSON file
  GET/PATCH /api/v1/me/agents/x  load / update a saved spec (edit-in-chat)
  POST /api/v1/feedback          append feedback to a local file
  POST /api/v1/backtest          NOT included — an integration point (see README)

No auth, no billing, no rate limits — this is a local dev server. The production
seams (JWT auth, per-user budgets, backtesting) are documented in the README.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import cost_guard
from agent_builder import build_turn
from config import settings
from screen import fetch_universe, normalize_conditions, run_screen

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s | %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Agent-builder chat (open source)", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STARTING_CASH = 100_000
_AGENTS_FILE = Path(__file__).parent / "local_agents.json"
_FEEDBACK_FILE = Path(__file__).parent / "local_feedback.jsonl"


# ── Request models (mirroring the production API shapes) ─────────────────────

class BuilderMsg(BaseModel):
    role: str
    content: str = Field(..., max_length=4000)


class ScreenCond(BaseModel):
    field: str = Field(..., max_length=40)
    op: str = Field(..., max_length=10)
    value: Any = None


class BuilderIn(BaseModel):
    messages: list[BuilderMsg] = Field(..., max_length=100)
    screen: list[ScreenCond] | None = Field(None, max_length=40)
    backtest: dict | None = None  # last backtest metrics, so the chat can discuss them


class PreviewIn(BaseModel):
    screen: list[ScreenCond] | None = None
    max_position_pct: float | None = None
    stop_loss_pct: float | None = None
    max_positions: int | None = None
    profit_target_pct: float | None = None
    exit_on_screen_exit: bool | None = None
    # accepted-and-ignored extras the UI may send
    persona: str | None = None
    watchlist: list[str] | None = None
    subagents: list[dict] | None = None


class AgentBody(BaseModel):
    """Create/update body — a superset of the spec the builder produces.
    Every field is bounded: an unauthenticated create endpoint writing to
    local_agents.json must never let one request store megabytes of persona text
    or a 10k-ticker watchlist."""
    name: str | None = Field(None, max_length=80)
    description: str | None = Field(None, max_length=2000)
    persona: str | None = Field(None, max_length=8000)
    watchlist: list[str] | None = Field(None, max_length=50)
    screen: list[ScreenCond] | None = Field(None, max_length=40)
    max_position_pct: float | None = Field(None, ge=0, le=100)
    stop_loss_pct: float | None = Field(None, ge=0, le=100)
    max_positions: int | None = Field(None, ge=1, le=100)
    profit_target_pct: float | None = Field(None, ge=0, le=10000)
    exit_on_screen_exit: bool | None = None
    run_interval_minutes: int | None = Field(None, ge=1, le=100000)
    subagents: list[dict] | None = Field(None, max_length=20)
    is_deployed: bool | None = None
    is_public: bool | None = None
    avatar_url: str | None = Field(None, max_length=500)
    subscription_price_usd: float | None = Field(None, ge=0, le=100000)
    buy_rules: str | None = Field(None, max_length=4000)
    sell_rules: str | None = Field(None, max_length=4000)


class FeedbackIn(BaseModel):
    message: str = Field(..., max_length=4000)
    context: str | None = None


# ── Local agent store (a JSON file, not a database) ──────────────────────────

def _load_agents() -> dict[str, dict]:
    if _AGENTS_FILE.exists():
        return json.loads(_AGENTS_FILE.read_text())
    return {}


def _save_agents(agents: dict[str, dict]) -> None:
    _AGENTS_FILE.write_text(json.dumps(agents, indent=2, default=str))


def _pct_str(v: Any) -> str | None:
    return None if v is None else str(v)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service": "agent-builder chat (open source)",
        "llm": bool(settings.ANTHROPIC_API_KEY) or "playbooks-only mode (no ANTHROPIC_API_KEY)",
        "universe": "postgres" if settings.DATABASE_URL else "bundled synthetic sample",
    }


@app.post("/api/v1/agent-builder")
async def agent_builder(body: BuilderIn):
    """One chat turn: send the conversation so far, get back the reply + spec."""
    try:
        return await build_turn(
            [m.model_dump() for m in body.messages],
            cost_scope="build:local",
            current_screen=[c.model_dump() for c in body.screen] if body.screen else None,
            user_tier="member" if settings.BETA_MODE else "free",
            backtest=body.backtest,
        )
    except cost_guard.BudgetExceeded as e:
        raise HTTPException(429, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))


@app.post("/api/v1/preview")
async def preview(body: PreviewIn):
    """What the agent would buy RIGHT NOW — fully deterministic (screen + sizing),
    run against the active universe. No LLM involved."""
    conditions = normalize_conditions([c.model_dump() for c in (body.screen or [])])
    if not conditions:
        return {
            "reasoning_steps": ["No screen conditions yet — nothing to preview."],
            "orders": [], "warnings": ["Build at least one screen condition first."],
            "summary": "The agent has no screen yet, so it would buy nothing.",
        }
    universe = await fetch_universe()
    prices = {row["ticker"]: float(row["last_price"] or 0) for row in universe}
    tickers = await run_screen(conditions)

    max_positions = body.max_positions or 5
    pos_pct = float(body.max_position_pct or 20)
    stop_pct = body.stop_loss_pct
    cash = float(STARTING_CASH)
    per_position = STARTING_CASH * pos_pct / 100

    steps = [
        f"Screen matched {len(tickers)} of {len(universe)} stocks.",
        f"Taking the top {min(max_positions, len(tickers))} by relative strength.",
        f"Sizing each position at {pos_pct:.0f}% of the ${STARTING_CASH:,} book.",
    ]
    orders = []
    for ticker in tickers[:max_positions]:
        price = prices.get(ticker) or 0
        if price <= 0:
            continue
        notional = min(per_position, cash)
        if notional < 100:
            break
        quantity = round(notional / price, 4)
        cash -= notional
        orders.append({
            "ticker": ticker, "action": "BUY", "quantity": quantity,
            "price": price, "stop_price": round(price * (1 - stop_pct / 100), 2) if stop_pct else None,
            "reason": "Passes the screen (ranked by RS rating, then size)",
            "capped": False, "status": "would_fill",
            "would_fill_price": price, "would_notional": round(notional, 2),
        })
    warnings = []
    if not settings.DATABASE_URL:
        warnings.append("Running on the bundled SYNTHETIC sample universe — fictional tickers, fictional data.")
    if not orders:
        warnings.append("No stock passed the screen — loosen a condition to see orders.")
    return {
        "reasoning_steps": steps,
        "orders": orders,
        "warnings": warnings,
        "summary": (
            f"Would open {len(orders)} position(s) using ${STARTING_CASH - cash:,.0f} "
            f"of the ${STARTING_CASH:,} book." if orders else "No buys right now."
        ),
    }


@app.post("/api/v1/backtest")
async def backtest_start():
    """Integration point — the historical backtest engine is NOT part of this
    extract (it needs years of point-in-time price + fundamentals data)."""
    raise HTTPException(400, (
        "Backtesting isn't included in the open-source extract — it needs a "
        "historical market-data store. See README → Integration points."
    ))


@app.get("/api/v1/backtest-status/{job_id}")
async def backtest_status(job_id: str):
    raise HTTPException(404, "Backtest not found — it may have expired; run it again.")


@app.post("/api/v1/me/agents")
async def create_agent(body: AgentBody):
    """Save the finished spec locally (stand-in for the production deploy)."""
    agents = _load_agents()
    agent_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    record = body.model_dump(exclude_none=True)
    record.update({"id": agent_id, "created_at": now})
    agents[agent_id] = record
    _save_agents(agents)
    logger.info(f"Saved agent {record.get('name')!r} -> {_AGENTS_FILE.name}")
    name = record.get("name") or "My screener"
    return {
        "id": agent_id, "name": name,
        "slug": name.lower().replace(" ", "-")[:40],
        "description": record.get("description"), "avatar_url": record.get("avatar_url"),
        "starting_cash": str(STARTING_CASH), "cash_balance": str(STARTING_CASH),
        "subscription_price_usd": None, "persona": record.get("persona"),
        "watchlist": record.get("watchlist") or [], "deployed": bool(record.get("is_deployed")),
        "warnings": [], "created_at": now,
        # No key infrastructure in the local build — placeholder values.
        "api_key": "local-demo", "api_key_id": "local-demo",
    }


@app.get("/api/v1/me/agents/{agent_id}")
async def get_agent(agent_id: str):
    """Load a saved spec — this is what edit-in-chat pulls in."""
    record = _load_agents().get(agent_id)
    if record is None:
        raise HTTPException(404, "Agent not found")
    return {
        "id": record["id"], "name": record.get("name") or "My screener",
        "slug": None, "description": record.get("description"), "avatar_url": record.get("avatar_url"),
        "starting_cash": str(STARTING_CASH), "cash_balance": str(STARTING_CASH),
        "created_at": record.get("created_at"),
        "key_prefix": None, "key_last_used_at": None, "key_revoked": False,
        "positions": [], "recent_signals": [],
        "persona": record.get("persona"), "watchlist": record.get("watchlist") or [],
        "buy_rules": record.get("buy_rules"), "sell_rules": record.get("sell_rules"),
        "max_position_pct": _pct_str(record.get("max_position_pct")),
        "stop_loss_pct": _pct_str(record.get("stop_loss_pct")),
        "max_positions": record.get("max_positions"),
        "run_interval_minutes": record.get("run_interval_minutes"),
        "screen": record.get("screen") or [],
        "profit_target_pct": _pct_str(record.get("profit_target_pct")),
        "exit_on_screen_exit": record.get("exit_on_screen_exit"),
        "subagents": record.get("subagents") or [],
        "is_deployed": bool(record.get("is_deployed")),
    }


@app.patch("/api/v1/me/agents/{agent_id}")
async def update_agent(agent_id: str, body: AgentBody):
    agents = _load_agents()
    if agent_id not in agents:
        raise HTTPException(404, "Agent not found")
    agents[agent_id].update(body.model_dump(exclude_none=True))
    _save_agents(agents)
    return {"ok": True, "warnings": []}


@app.post("/api/v1/feedback")
async def feedback(body: FeedbackIn):
    entry = {"at": datetime.now(timezone.utc).isoformat(), "context": body.context, "message": body.message}
    with _FEEDBACK_FILE.open("a") as f:
        f.write(json.dumps(entry) + "\n")
    return {"ok": True}
