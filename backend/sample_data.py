"""Synthetic sample universe — ~40 FICTIONAL stocks so the screener works with
zero setup (no database, no market-data key, no license issues).

Every value here is invented. Tickers and company names are made up; any
resemblance to real securities is coincidental. To screen real stocks, point
DATABASE_URL at a Postgres with a `stocks` table (see README → Bring your own data).

The generator is seeded, so everyone gets the SAME universe — bug reports and
screenshots stay comparable across machines.

Shape: each row matches what screen.py expects —
    {ticker, name, sector, market_cap, last_price, _ctx: {nested context}}
and the _ctx paths mirror FIELD_MAP in screen.py exactly.
"""

from __future__ import annotations

import random
from typing import Any

# (ticker, name, sector, archetype)
_COMPANIES = [
    # Big quality growers — pass most "quality growth" screens
    ("NOVQ", "NovaQuark Systems", "Technology", "mega_grower"),
    ("HELIX", "Helix Compute", "Technology", "mega_grower"),
    ("SYNTH", "Synthetica Labs", "Technology", "mega_grower"),
    ("ARBOR", "Arbor Health Group", "Healthcare", "mega_grower"),
    ("PULSE", "PulseGen Medical", "Healthcare", "mega_grower"),
    # Momentum leaders — high RS, fresh breakouts (VCP / cup / flat base)
    ("ZEPHR", "Zephyr Dynamics", "Technology", "breakout_leader"),
    ("KITE", "KiteWave Robotics", "Industrials", "breakout_leader"),
    ("FLUX", "FluxDrive Motors", "Consumer Cyclical", "breakout_leader"),
    ("ORBIT", "Orbital Semiconductors", "Technology", "breakout_leader"),
    # Momentum names still coiling — setups, NOT yet broken out
    ("CRESN", "Crescendo Audio", "Technology", "setup_watch"),
    ("TIDAL", "Tidal Grid Energy", "Utilities", "setup_watch"),
    ("MOSA", "Mosaic Biotech", "Healthcare", "setup_watch"),
    ("VELUM", "Velum Aerospace", "Industrials", "setup_watch"),
    # Cheap value — low P/E, dividends, slow growth
    ("GRANT", "Granite Trust Bancorp", "Financial Services", "cheap_value"),
    ("IRON", "Ironline Insurance", "Financial Services", "cheap_value"),
    ("HARBR", "Harbor Freight Marine", "Industrials", "cheap_value"),
    ("BRICK", "BrickYard Materials", "Materials", "cheap_value"),
    ("PETRO", "Petrocore Resources", "Energy", "cheap_value"),
    # Dividend defensives — steady, high yield, low beta
    ("OATLY", "Oatfield Foods", "Consumer Defensive", "dividend_steady"),
    ("SUDS", "SudsCo Household", "Consumer Defensive", "dividend_steady"),
    ("WATT", "WattBridge Utilities", "Utilities", "dividend_steady"),
    ("CARE", "CarePoint Pharmacy", "Healthcare", "dividend_steady"),
    ("SIGNL", "Signal Bell Telecom", "Communication Services", "dividend_steady"),
    # Speculative small caps — unprofitable, volatile, mostly fail screens
    ("MYST", "Mystic Metaverse", "Technology", "spec_smallcap"),
    ("FOMO", "Fomotech Ventures", "Technology", "spec_smallcap"),
    ("LUNAR", "Lunar Hopper Mining", "Materials", "spec_smallcap"),
    ("DRIFT", "DriftShare Mobility", "Consumer Cyclical", "spec_smallcap"),
    ("HAZE", "HazeCloud Social", "Communication Services", "spec_smallcap"),
    # Fallen leaders — big names way off highs (test pct_from_52w_high / RSI logic)
    ("TITAN", "Titanware Enterprise", "Technology", "fallen_leader"),
    ("GLIDE", "GlidePath Logistics", "Industrials", "fallen_leader"),
    ("SPRIG", "Sprig & Loam Retail", "Consumer Cyclical", "fallen_leader"),
    # Steady compounders — decent everything, spectacular nothing
    ("ANVIL", "Anvil Tool Works", "Industrials", "steady_compounder"),
    ("LEDGE", "Ledgerstone Payments", "Financial Services", "steady_compounder"),
    ("CREST", "Crestline Water", "Utilities", "steady_compounder"),
    ("FABLE", "Fable Media Group", "Communication Services", "steady_compounder"),
    ("PLOT", "PlotPoint Real Estate", "Real Estate", "steady_compounder"),
    ("SAVOR", "Savor Brands", "Consumer Defensive", "steady_compounder"),
    ("BOLT", "BoltRail Freight", "Industrials", "steady_compounder"),
    ("QUILT", "Quilted Home Goods", "Consumer Cyclical", "steady_compounder"),
    ("VERDE", "Verde AgroScience", "Materials", "steady_compounder"),
]

# Archetype parameter ranges: (lo, hi) tuples fed by the seeded RNG below.
_ARCHETYPES: dict[str, dict[str, Any]] = {
    "mega_grower": dict(
        mcap=(200e9, 2500e9), pe=(28, 55), eps5=(18, 35), rev5=(14, 28), rs=(75, 95),
        trend=(6, 9), off_high=(-12, -2), r1y=(20, 60), margin=(18, 35), profitable=True,
        div=(0, 0.8), patterns="none", catalysts=(0.55, 0.7),
    ),
    "breakout_leader": dict(
        mcap=(8e9, 120e9), pe=(35, 90), eps5=(25, 60), rev5=(20, 45), rs=(88, 99),
        trend=(7, 9), off_high=(-4, 0), r1y=(60, 180), margin=(8, 22), profitable=True,
        div=(0, 0), patterns="breakout", catalysts=(0.6, 0.85),
    ),
    "setup_watch": dict(
        mcap=(3e9, 40e9), pe=(30, 70), eps5=(20, 45), rev5=(15, 35), rs=(80, 93),
        trend=(6, 9), off_high=(-15, -6), r1y=(35, 90), margin=(6, 18), profitable=True,
        div=(0, 0.5), patterns="setup", catalysts=(0.4, 0.6),
    ),
    "cheap_value": dict(
        mcap=(4e9, 60e9), pe=(6, 13), eps5=(2, 9), rev5=(1, 6), rs=(35, 60),
        trend=(2, 5), off_high=(-25, -8), r1y=(-5, 18), margin=(10, 25), profitable=True,
        div=(2.5, 5.5), patterns="none", catalysts=(0.15, 0.35),
    ),
    "dividend_steady": dict(
        mcap=(15e9, 180e9), pe=(14, 24), eps5=(4, 10), rev5=(2, 7), rs=(40, 65),
        trend=(3, 6), off_high=(-12, -3), r1y=(2, 16), margin=(10, 22), profitable=True,
        div=(2.8, 5.0), patterns="none", catalysts=(0.2, 0.4),
    ),
    "spec_smallcap": dict(
        mcap=(0.2e9, 2.5e9), pe=(0, 0), eps5=(-30, 5), rev5=(5, 60), rs=(15, 55),
        trend=(0, 3), off_high=(-70, -30), r1y=(-60, 30), margin=(-40, -5), profitable=False,
        div=(0, 0), patterns="none", catalysts=(0.05, 0.2),
    ),
    "fallen_leader": dict(
        mcap=(20e9, 300e9), pe=(15, 28), eps5=(5, 15), rev5=(3, 10), rs=(20, 45),
        trend=(1, 3), off_high=(-55, -30), r1y=(-40, -15), margin=(8, 20), profitable=True,
        div=(0.5, 2.0), patterns="double_bottom", catalysts=(0.1, 0.3),
    ),
    "steady_compounder": dict(
        mcap=(5e9, 90e9), pe=(16, 30), eps5=(8, 18), rev5=(5, 12), rs=(55, 80),
        trend=(4, 7), off_high=(-18, -5), r1y=(5, 30), margin=(8, 20), profitable=True,
        div=(1.0, 2.5), patterns="maybe_flat", catalysts=(0.3, 0.55),
    ),
}


def _round(v: float, nd: int = 1) -> float:
    return round(v, nd)


def _pattern_block(has: bool, status: str, breakout: bool) -> dict:
    return {"status": status if has else "none", "breakout": bool(breakout)}


def build_universe() -> list[dict]:
    """Deterministic synthetic universe in the row shape screen.py consumes."""
    rng = random.Random(42)
    rows: list[dict] = []
    for ticker, name, sector, kind in _COMPANIES:
        a = _ARCHETYPES[kind]
        u = rng.uniform
        mcap = u(*a["mcap"])
        price = _round(u(8, 480), 2)
        pe = _round(u(*a["pe"])) if a["pe"] != (0, 0) else None  # None = unprofitable, no P/E
        eps5 = _round(u(*a["eps5"]))
        rev5 = _round(u(*a["rev5"]))
        rs = int(u(*a["rs"]))
        trend = int(u(*a["trend"]))
        off_high = _round(u(*a["off_high"]))
        r1y = _round(u(*a["r1y"]))
        net_margin = _round(u(*a["margin"]))
        profitable = a["profitable"]
        div = _round(u(*a["div"]), 2)
        cat_p = u(*a["catalysts"])  # probability each catalyst flag is on

        # Pattern flags per archetype: breakout leaders just broke out of ONE base
        # pattern; setups are coiling; fallen leaders may be carving a double bottom.
        pat = {"vcp": (False, "none", False), "cup_handle": (False, "none", False),
               "flat_base": (False, "none", False), "double_bottom": (False, "none", False),
               "bull_flag": (False, "none", False)}
        if a["patterns"] == "breakout":
            which = rng.choice(["vcp", "cup_handle", "flat_base", "bull_flag"])
            pat[which] = (True, "breakout", True)
        elif a["patterns"] == "setup":
            which = rng.choice(["vcp", "cup_handle", "flat_base"])
            pat[which] = (True, "setup", False)
        elif a["patterns"] == "double_bottom":
            if rng.random() < 0.6:
                pat["double_bottom"] = (True, "setup", False)
        elif a["patterns"] == "maybe_flat":
            if rng.random() < 0.3:
                pat["flat_base"] = (True, "setup", False)
        any_breakout = any(b for (_h, _s, b) in pat.values())

        growth_ttm = _round(eps5 * u(0.7, 1.4))
        ctx: dict = {
            "price": {"last": price},
            "valuation": {
                "pe_ratio": pe,
                "forward_pe": _round(pe * u(0.8, 0.95)) if pe else None,
                "peg_ratio": _round(pe / eps5, 2) if pe and eps5 > 0 else None,
                "price_to_sales": _round(u(0.5, 15), 1),
                "price_to_book": _round(u(0.8, 20), 1),
                "ev_to_ebitda": _round(u(6, 40), 1) if profitable else None,
                "return_on_equity": _round(u(0.05, 0.45), 3) if profitable else _round(u(-0.3, 0.0), 3),
                "roic": _round(u(0.04, 0.35), 3) if profitable else _round(u(-0.25, 0.0), 3),
                "gross_margins_ttm": _round(u(0.2, 0.8), 3),
                "operating_margins_ttm": _round(net_margin / 100 * u(1.1, 1.5), 3),
                "debt_to_equity": _round(u(0, 180)),
            },
            "derived": {
                "net_margin_pct": net_margin,
                "eps_cagr_5y": eps5,
                "revenue_cagr_5y": rev5,
                "eps_growth_ttm_yoy": growth_ttm,
                "revenue_growth_ttm_yoy": _round(rev5 * u(0.7, 1.3)),
                "eps_growth_consistent": bool(eps5 >= 20 and profitable and rng.random() < 0.8),
                "eps_growth_recent_q": _round(growth_ttm * u(0.8, 1.5)),
                "eps_growth_min4_q": _round(growth_ttm * u(0.4, 0.9)),
                "cagr_3y": {"eps": _round(eps5 * u(0.8, 1.2)), "revenue": _round(rev5 * u(0.8, 1.2))},
                "profitable_last_4q": profitable,
                "current_ratio": _round(u(0.8, 3.5), 2),
                "quick_ratio": _round(u(0.5, 2.8), 2),
                "net_debt_to_ebitda": _round(u(-1.5, 4.0), 2) if profitable else None,
                "net_cash_positive": bool(rng.random() < (0.5 if profitable else 0.25)),
            },
            "shareholder_returns": {
                "dividend_yield": div if div > 0 else None,
                "dividend_growth_5y_pct": _round(u(3, 12)) if div > 0 else None,
                "payout_ratio": _round(u(0.15, 0.7), 2) if div > 0 else None,
                "is_buying_back": bool(rng.random() < (0.6 if profitable else 0.1)),
            },
            "ownership": {
                "held_percent_institutions": _round(u(0.35, 0.92), 3),
                "held_percent_insiders": _round(u(0.005, 0.2), 3),
                "short_percent_float": _round(u(0.005, 0.25), 3),
            },
            "signals": {
                "analyst_pct_buy": int(u(20, 95)),
                "analyst_count": int(u(3, 42)),
                "analyst_divergence_pct": _round(u(-0.1, 0.4), 3),
                "forward_eps_growth": _round(eps5 * u(0.7, 1.2)),
            },
            "rs_rating": rs,
            "trend_template": {"passed": trend, "total": 8},
            "technicals": {
                "rel_volume": _round(u(0.5, 3.5 if any_breakout else 1.8), 2),
                "new_high_breakout": bool(any_breakout or (off_high > -3 and rng.random() < 0.5)),
                "pct_from_52w_high": off_high,
                "volume_dryup": bool(a["patterns"] == "setup" and rng.random() < 0.7),
                "rsi": _round(u(25, 80)),
            },
            "returns": {
                "r_1m": _round(r1y * u(0.02, 0.15)),
                "r_3m": _round(r1y * u(0.15, 0.4)),
                "r_6m": _round(r1y * u(0.4, 0.7)),
                "r_1y": r1y,
                "mom_12_1": _round(r1y * u(0.8, 1.1)),
            },
            "vcp": {"is_vcp": pat["vcp"][0], **_pattern_block(*pat["vcp"])},
            "cup_handle": {"is_cup_handle": pat["cup_handle"][0], **_pattern_block(*pat["cup_handle"])},
            "flat_base": {"is_flat_base": pat["flat_base"][0], **_pattern_block(*pat["flat_base"])},
            "double_bottom": {"is_double_bottom": pat["double_bottom"][0], **_pattern_block(*pat["double_bottom"])},
            "bull_flag": {"is_bull_flag": pat["bull_flag"][0], **_pattern_block(*pat["bull_flag"])},
            "any_breakout": any_breakout,
            "catalysts": {
                "just_beat": rng.random() < cat_p,
                "earnings_accelerating": rng.random() < cat_p,
                "sales_accelerating": rng.random() < cat_p,
                "margin_expanding": rng.random() < cat_p,
                "estimates_rising": rng.random() < cat_p,
            },
        }
        rows.append({
            "ticker": ticker, "name": name, "sector": sector,
            "market_cap": round(mcap), "last_price": price, "_ctx": ctx,
        })
    return rows
