"""Deterministic stock screener — turns a structured filter set into a ranked
watchlist, entirely in code (no LLM). The AI builder produces the conditions; this
runs them against the pre-computed `stocks.context` snapshot.

A condition is {"field": <name>, "op": <op>, "value": <v>}. All conditions must
hold (AND). Fields are whitelisted in FIELD_MAP — anything else is ignored (the
builder is told the exact vocabulary, so this only guards against drift).

Reused by: the builder chat ("matches N of M"), Preview, and the deployed executor.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from config import settings

logger = logging.getLogger(__name__)

SCREEN_MAX = 50  # cap the watchlist a screen produces

# Screen field name -> where to read it. ("col", name) = a base stocks column;
# ("ctx", (k1, k2, ...)) = a path inside the stocks.context JSONB. Grounded in the
# fields written by financial_sync / signals_job (see stocks.context).
FIELD_MAP: dict[str, tuple[str, Any]] = {
    # size / price / sector
    "market_cap": ("col", "market_cap"),
    "sector": ("col", "sector"),
    "price": ("ctx", ("price", "last")),
    # valuation
    "pe_ratio": ("ctx", ("valuation", "pe_ratio")),
    "forward_pe": ("ctx", ("valuation", "forward_pe")),
    "peg_ratio": ("ctx", ("valuation", "peg_ratio")),
    "price_to_sales": ("ctx", ("valuation", "price_to_sales")),
    "price_to_book": ("ctx", ("valuation", "price_to_book")),
    "ev_to_ebitda": ("ctx", ("valuation", "ev_to_ebitda")),
    "roe": ("ctx", ("valuation", "return_on_equity")),
    "roic": ("ctx", ("valuation", "roic")),
    "gross_margin": ("ctx", ("valuation", "gross_margins_ttm")),
    "operating_margin": ("ctx", ("valuation", "operating_margins_ttm")),
    "debt_to_equity": ("ctx", ("valuation", "debt_to_equity")),
    # growth / health (derived)
    "net_margin": ("ctx", ("derived", "net_margin_pct")),
    "eps_growth_5y": ("ctx", ("derived", "eps_cagr_5y")),
    "revenue_growth_5y": ("ctx", ("derived", "revenue_cagr_5y")),
    "eps_growth_ttm": ("ctx", ("derived", "eps_growth_ttm_yoy")),
    "revenue_growth_ttm": ("ctx", ("derived", "revenue_growth_ttm_yoy")),
    "eps_growth_consistent": ("ctx", ("derived", "eps_growth_consistent")),  # lenient: ≥3/4 quarters ≥20%, recent strong
    "eps_growth_recent_q": ("ctx", ("derived", "eps_growth_recent_q")),      # most recent quarter's YoY %
    "eps_growth_min4_q": ("ctx", ("derived", "eps_growth_min4_q")),          # weakest of last 4 quarters (strict: all4 ≥ X)
    "eps_growth_3y": ("ctx", ("derived", "cagr_3y", "eps")),
    "revenue_growth_3y": ("ctx", ("derived", "cagr_3y", "revenue")),
    "profitable": ("ctx", ("derived", "profitable_last_4q")),
    "current_ratio": ("ctx", ("derived", "current_ratio")),
    "quick_ratio": ("ctx", ("derived", "quick_ratio")),
    "net_debt_to_ebitda": ("ctx", ("derived", "net_debt_to_ebitda")),
    "net_cash_positive": ("ctx", ("derived", "net_cash_positive")),
    # shareholder returns
    "dividend_yield": ("ctx", ("shareholder_returns", "dividend_yield")),
    "dividend_growth_5y": ("ctx", ("shareholder_returns", "dividend_growth_5y_pct")),
    "payout_ratio": ("ctx", ("shareholder_returns", "payout_ratio")),
    "buying_back": ("ctx", ("shareholder_returns", "is_buying_back")),
    # ownership
    "institutional_ownership": ("ctx", ("ownership", "held_percent_institutions")),
    "insider_ownership": ("ctx", ("ownership", "held_percent_insiders")),
    "short_percent_float": ("ctx", ("ownership", "short_percent_float")),
    # analyst
    "analyst_pct_buy": ("ctx", ("signals", "analyst_pct_buy")),
    "analyst_count": ("ctx", ("signals", "analyst_count")),
    "analyst_upside_pct": ("ctx", ("signals", "analyst_divergence_pct")),
    "forward_eps_growth": ("ctx", ("signals", "forward_eps_growth")),
    # technicals / momentum
    "rs_rating": ("ctx", ("rs_rating",)),
    "trend_template": ("ctx", ("trend_template", "passed")),  # 0–8 score (NOT .total, which is always 8)
    "rel_volume": ("ctx", ("technicals", "rel_volume")),
    "new_high_breakout": ("ctx", ("technicals", "new_high_breakout")),
    "pct_from_52w_high": ("ctx", ("technicals", "pct_from_52w_high")),
    "volume_dryup": ("ctx", ("technicals", "volume_dryup")),
    "rsi": ("ctx", ("technicals", "rsi")),
    "return_1m": ("ctx", ("returns", "r_1m")),
    "return_3m": ("ctx", ("returns", "r_3m")),
    "return_6m": ("ctx", ("returns", "r_6m")),
    "return_1y": ("ctx", ("returns", "r_1y")),
    "momentum_12_1": ("ctx", ("returns", "mom_12_1")),
    "vcp": ("ctx", ("vcp", "is_vcp")),                    # has a VCP base (setup or breakout)
    "cup_handle": ("ctx", ("cup_handle", "is_cup_handle")),  # has a cup-with-handle
    # --- pattern TIMING: selection (has a base) vs entry (just broke out). A watchlist filters on
    # vcp/cup_handle + *_status == "setup"; the buy TRIGGER filters on *_breakout is_true. ---
    "vcp_status": ("ctx", ("vcp", "status")),             # none | setup | breakout | extended
    "cup_status": ("ctx", ("cup_handle", "status")),      # none | cup | handle | breakout | extended
    "vcp_breakout": ("ctx", ("vcp", "breakout")),         # True ONLY on a fresh VCP breakout — the buy trigger
    "cup_breakout": ("ctx", ("cup_handle", "breakout")),  # True ONLY on a fresh cup breakout — the buy trigger
    # more breakout patterns — same is_/status/breakout convention (setup=watch, breakout=buy trigger)
    "flat_base": ("ctx", ("flat_base", "is_flat_base")),
    "flat_base_status": ("ctx", ("flat_base", "status")),
    "flat_base_breakout": ("ctx", ("flat_base", "breakout")),
    "double_bottom": ("ctx", ("double_bottom", "is_double_bottom")),
    "double_bottom_status": ("ctx", ("double_bottom", "status")),
    "double_bottom_breakout": ("ctx", ("double_bottom", "breakout")),
    "bull_flag": ("ctx", ("bull_flag", "is_bull_flag")),
    "bull_flag_status": ("ctx", ("bull_flag", "status")),
    "bull_flag_breakout": ("ctx", ("bull_flag", "breakout")),
    "any_breakout": ("ctx", ("any_breakout",)),                # fresh breakout from ANY of the 5 base patterns
    # catalysts — deterministic stand-ins for "news / earnings" intent. Paths must
    # match what detectors/catalysts.py::compute_catalysts actually writes (the old
    # last_earnings_beat/earnings_acceleration paths were never written by anything).
    "earnings_beat": ("ctx", ("catalysts", "just_beat")),
    "earnings_acceleration": ("ctx", ("catalysts", "earnings_accelerating")),
    "sales_acceleration": ("ctx", ("catalysts", "sales_accelerating")),
    "margin_expansion": ("ctx", ("catalysts", "margin_expanding")),
    "rising_estimates": ("ctx", ("catalysts", "estimates_rising")),
}

SCREEN_FIELDS = tuple(FIELD_MAP.keys())
_OPS = (">=", "<=", ">", "<", "==", "!=", "in", "is_true", "is_false")

# These fields are stored as ratios (0.478 = 47.8%) from the data provider, while
# our derived growth/margin/return fields are already percents. Scale ratios ×100 so
# EVERY rate field the screener exposes is a uniform percent (user types 15 for 15%).
_RATIO_TO_PCT = frozenset({
    "roe", "roic", "gross_margin", "operating_margin",
    "institutional_ownership", "insider_ownership", "short_percent_float", "payout_ratio",
    "analyst_upside_pct",  # stored as a ratio (0.25 = 25% upside to target)
})

# The stocks table mixes yfinance + GICS sector labels ("Technology"/"Information
# Technology", "Healthcare"/"Health Care"). Canonicalize both sides before comparing.
_SECTOR_CANON = {
    "information technology": "technology", "technology": "technology", "tech": "technology",
    "health care": "healthcare", "healthcare": "healthcare",
    "financials": "financial services", "financial services": "financial services",
    "consumer discretionary": "consumer cyclical", "consumer cyclical": "consumer cyclical",
    "consumer staples": "consumer defensive", "consumer defensive": "consumer defensive",
    "communication services": "communication services", "communications": "communication services",
    "basic materials": "materials", "materials": "materials",
    "energy": "energy", "industrials": "industrials", "utilities": "utilities", "real estate": "real estate",
}


def _canon_sector(s: Any) -> str:
    key = str(s).strip().lower() if s is not None else ""
    return _SECTOR_CANON.get(key, key)


def _dig(ctx: dict, path: tuple) -> Any:
    cur: Any = ctx
    for k in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _field_value(row: dict, ctx: dict, field: str) -> Any:
    spec = FIELD_MAP.get(field)
    if spec is None:
        return None
    kind, ref = spec
    val = row.get(ref) if kind == "col" else _dig(ctx, ref)
    if field in _RATIO_TO_PCT:
        f = _as_float(val)
        return f * 100 if f is not None else None
    return val


def _as_float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _passes_condition(row: dict, ctx: dict, cond: dict) -> bool:
    field = cond.get("field")
    op = cond.get("op")
    if field not in FIELD_MAP or op not in _OPS:
        logger.debug("screen: skipping unknown condition %r", cond)
        return True  # unknown/malformed condition is a no-op, never silently excludes everything
    val = _field_value(row, ctx, field)
    target = cond.get("value")

    if op == "is_true":
        return val is True
    if op == "is_false":
        return val is False
    if op == "in":
        opts = target if isinstance(target, list) else [target]
        if field == "sector":
            return _canon_sector(val) in {_canon_sector(o) for o in opts} if val is not None else False
        sval = str(val).strip().lower() if val is not None else None
        return sval is not None and sval in {str(o).strip().lower() for o in opts}
    if op in ("==", "!="):
        if field == "sector":
            eq = val is not None and _canon_sector(val) == _canon_sector(target)
        # string-aware equality, with numeric fallback
        elif isinstance(target, str) or isinstance(val, str):
            eq = val is not None and str(val).strip().lower() == str(target).strip().lower()
        else:
            fv, ft = _as_float(val), _as_float(target)
            eq = fv is not None and ft is not None and fv == ft
        return eq if op == "==" else not eq
    # numeric comparisons — missing data fails (strict; good stocks are rare)
    fv, ft = _as_float(val), _as_float(target)
    if fv is None or ft is None:
        return False
    if op == ">=":
        return fv >= ft
    if op == "<=":
        return fv <= ft
    if op == ">":
        return fv > ft
    if op == "<":
        return fv < ft
    return False


def passes(row: dict, ctx: dict, conditions: list[dict]) -> bool:
    """True when every condition holds (AND)."""
    return all(_passes_condition(row, ctx, c) for c in conditions if isinstance(c, dict))


def _rank_key(row: dict, ctx: dict) -> tuple:
    rs = _as_float(_dig(ctx, ("rs_rating",))) or 0.0
    mc = _as_float(row.get("market_cap")) or 0.0
    return (rs, mc)


# The whole-market universe is ~5,600 rows whose full context documents are multi-KB
# each — shipping them made every builder turn / preview take ~10s against a remote DB.
# Instead: extract ONLY the FIELD_MAP paths server-side (scalars, ~80 per row) and
# rebuild a slim ctx. Paths are code constants, so inlining them in SQL is safe.
_CTX_ALIASES: dict[tuple, str] = {}
_CTX_SELECT: str = ""


def _build_ctx_select() -> None:
    global _CTX_SELECT
    parts = []
    for kind, ref in FIELD_MAP.values():
        if kind != "ctx" or ref in _CTX_ALIASES:
            continue
        alias = f"c{len(_CTX_ALIASES)}"
        _CTX_ALIASES[ref] = alias
        parts.append("context #> '{" + ",".join(ref) + "}' AS " + alias)
    _CTX_SELECT = ", ".join(parts)


_build_ctx_select()

_UNIVERSE_TTL_S = 60.0  # chat turns + preview hit this back-to-back; data updates every few min
_universe_cache: list[dict] = []
_universe_at: float = 0.0


_pool = None


async def _get_pool():
    """Lazy asyncpg pool — only imported/created when DATABASE_URL is set."""
    global _pool
    if _pool is None:
        import asyncpg
        _pool = await asyncpg.create_pool(settings.DATABASE_URL, min_size=1, max_size=5)
    return _pool


async def _fetch_universe_db() -> list[dict]:
    """Real data: a `stocks` table with a `context` JSONB whose paths match
    FIELD_MAP (see README -> Bring your own data). Only the FIELD_MAP paths are
    extracted server-side, so rows stay slim even with a big context document."""
    pool = await _get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT ticker, name, sector, market_cap, last_price, {_CTX_SELECT} "
            "FROM stocks WHERE is_top_100 = TRUE"
        )
    out = []
    for r in rows:
        ctx: dict = {}
        for ref, alias in _CTX_ALIASES.items():
            raw = r[alias]
            if raw is None:
                continue
            val = json.loads(raw) if isinstance(raw, str) else raw
            d = ctx
            for key in ref[:-1]:
                d = d.setdefault(key, {})
            d[ref[-1]] = val
        out.append({
            "ticker": r["ticker"], "name": r["name"], "sector": r["sector"],
            "market_cap": r["market_cap"], "last_price": r["last_price"], "_ctx": ctx,
        })
    return out


async def fetch_universe() -> list[dict]:
    """The screenable universe: Postgres when DATABASE_URL is set, otherwise the
    bundled synthetic sample (sample_data.py) so everything runs with zero setup."""
    import time
    global _universe_cache, _universe_at
    if _universe_cache and (time.monotonic() - _universe_at) < _UNIVERSE_TTL_S:
        return _universe_cache
    if settings.DATABASE_URL:
        out = await _fetch_universe_db()
    else:
        from sample_data import build_universe
        out = build_universe()
    _universe_cache, _universe_at = out, time.monotonic()
    return out


def _screen_rows(universe: list[dict], conditions: list[dict]) -> list[dict]:
    hits = [row for row in universe if passes(row, row["_ctx"], conditions)]
    hits.sort(key=lambda row: _rank_key(row, row["_ctx"]), reverse=True)
    return hits


async def run_screen(conditions: list[dict], limit: int = SCREEN_MAX) -> list[str]:
    """Ranked tickers that pass the screen (best first), capped to `limit`."""
    if not conditions:
        return []
    universe = await fetch_universe()
    return [row["ticker"] for row in _screen_rows(universe, conditions)[:limit]]


async def count_screen(conditions: list[dict]) -> tuple[int, int]:
    """(matches, universe_size) — for the live "matches N of M" count."""
    universe = await fetch_universe()
    if not conditions:
        return 0, len(universe)
    return len(_screen_rows(universe, conditions)), len(universe)


def normalize_conditions(raw: Any) -> list[dict]:
    """Keep only well-formed conditions on known fields (defensive against LLM drift)."""
    if not isinstance(raw, list):
        return []
    out = []
    for c in raw:
        if isinstance(c, dict) and c.get("field") in FIELD_MAP and c.get("op") in _OPS:
            out.append({"field": c["field"], "op": c["op"], "value": c.get("value")})
    return out
