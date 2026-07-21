"""In-memory daily LLM spend guard + KILLSWITCH for all platform AI.

Bounds what the platform's AI keys can spend per UTC day — a GLOBAL killswitch
(stop everything at $X/day) plus a per-scope ceiling (per user for Preview, per
agent for Deploy). Every AI call site records its cost here and checks the
killswitch before spending, so no AI call — builder chat included — can run past
the cap. Best-effort + in-memory (resets on restart);
a durable meter can replace it later. Configure via env:

    AGENT_LLM_DAILY_BUDGET_USD        THE KILLSWITCH — stop all AI/day (default 10)
    AGENT_LLM_SCOPE_DAILY_BUDGET_USD  per user/agent/day (default 0.50)
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Defaults tuned for tight cost control: a real user spends pennies/day (build a
# few agents ≈ $0.05 each; backtests/previews are free), so these sit just above
# real use — they stop abuse, never a real tester.
GLOBAL_DAILY_USD = float(os.getenv("AGENT_LLM_DAILY_BUDGET_USD", "10"))
SCOPE_DAILY_USD = float(os.getenv("AGENT_LLM_SCOPE_DAILY_BUDGET_USD", "0.50"))
# Agent creation gets its OWN, more generous per-user budget — building an agent is
# the core first action and must never be starved by other AI use. ~$0.05/build → $1 ≈ 20 builds/day.
BUILD_DAILY_USD = float(os.getenv("AGENT_BUILD_DAILY_BUDGET_USD", "1.00"))

# (input, output) USD per 1M tokens — keep in sync with the models the runtime uses.
_PRICES = {
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5-20251001": (1.0, 5.0),
    "claude-opus-4-8": (5.0, 25.0),
}
_DEFAULT_PRICE = (3.0, 15.0)   # unknown model → price high (killswitch trips sooner = safe)

_day = ""
_global_spent = 0.0
_scope_spent: dict[str, float] = {}


class BudgetExceeded(Exception):
    """Raised when the global or per-scope daily budget is already spent."""


def _roll() -> None:
    global _day, _global_spent, _scope_spent
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if today != _day:
        _day, _global_spent, _scope_spent = today, 0.0, {}


def cost_usd(model: str, in_tok: int, out_tok: int) -> float:
    pin, pout = _PRICES.get(model, _DEFAULT_PRICE)
    return in_tok / 1_000_000 * pin + out_tok / 1_000_000 * pout


def check(scope: str | None, limit: float | None = None) -> None:
    """Raise BudgetExceeded if the global killswitch or scope budget is already spent.
    `limit` overrides the default per-scope budget (e.g. the higher agent-creation
    budget). Call once before starting a run."""
    _roll()
    if _global_spent >= GLOBAL_DAILY_USD:
        logger.warning("AI KILLSWITCH tripped: $%.2f >= $%.2f/day — all AI paused until tomorrow",
                       _global_spent, GLOBAL_DAILY_USD)
        raise BudgetExceeded("You've hit today's limit for everyone — your work is saved. Please try again tomorrow.")
    if scope and _scope_spent.get(scope, 0.0) >= (limit if limit is not None else SCOPE_DAILY_USD):
        logger.info("AI daily budget reached for scope %s: $%.3f", scope, _scope_spent.get(scope, 0.0))
        raise BudgetExceeded("You've reached today's limit — your progress is saved. Come back tomorrow to pick up where you left off.")


def is_over_budget() -> bool:
    """True once the global killswitch is spent. For callers that skip gracefully
    (fail OPEN) instead of raising."""
    _roll()
    return _global_spent >= GLOBAL_DAILY_USD


def spent_today() -> float:
    _roll()
    return _global_spent


def record(model: str, in_tok: int, out_tok: int, scope: str | None) -> None:
    """Add the cost of one model call to today's running totals."""
    global _global_spent
    _roll()
    c = cost_usd(model, in_tok, out_tok)
    _global_spent += c
    if scope:
        _scope_spent[scope] = _scope_spent.get(scope, 0.0) + c
