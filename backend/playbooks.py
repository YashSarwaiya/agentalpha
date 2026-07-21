"""Curated investor playbooks — checklists mapped to the screener FIELD_MAP.

When a user names a strategy ("make a Minervini agent"), the builder loads the EXACT
checklist here — no LLM, no cost, no drift — then the normal chat handles edits.

`fidelity`: 'faithful' (maps cleanly) | 'approx' (close, our thresholds) | 'proxy'
(missing a core mechanic — `caveat` explains). Show the caveat when it isn't faithful.

NOTICE — third-party names & methods: The strategy names and methodologies referenced
here (e.g. CAN SLIM, SEPA / Trend Template, Magic Formula, Dividend Aristocrats) and the
investor names (Minervini, O'Neil, Lynch, Buffett, Greenblatt, Wood/ARK, etc.) are the
property of their respective owners and are used here only descriptively, to identify a
publicly-documented method. These playbooks are our own interpretations for educational
use. AgentAlpha is NOT affiliated with, endorsed by, or sponsored by any of them, and
nothing here is investment advice.
"""

import difflib
import re
from typing import Any

PLAYBOOKS: list[dict[str, Any]] = [{'slug': 'minervini',
  'name': 'Minervini',
  'aliases': ['minervini', 'sepa', 'trend template'],
  'fidelity': 'faithful',
  'caveat': "the rising-estimates and proper-base checks are approximated",
  'persona': 'Minervini SEPA: high relative-strength growth leaders in confirmed Stage-2 uptrends, bought as they '
             'clear a base.',
  'ranking_field': 'rs_rating',
  'filters': ['Passes all 8 Trend Template checks (Stage-2 uptrend)',
              'RS rating ≥ 70 (a market leader)',
              'Within 25% of its 52-week high',
              'EPS growth ≥ 25% (latest quarter, YoY)',
              'Revenue growth ≥ 20% (TTM)',
              'Earnings growth accelerating quarter-over-quarter',
              'Profit margins expanding'],
  # rising_estimates omitted: analyst-revision coverage is too sparse to screen on reliably.
  'screen': [{'field': 'trend_template', 'op': '==', 'value': 8},
             {'field': 'rs_rating', 'op': '>=', 'value': 70},
             {'field': 'pct_from_52w_high', 'op': '>=', 'value': -25},
             {'field': 'eps_growth_recent_q', 'op': '>=', 'value': 25},
             {'field': 'revenue_growth_ttm', 'op': '>=', 'value': 20},
             {'field': 'earnings_acceleration', 'op': 'is_true'},
             {'field': 'margin_expansion', 'op': 'is_true'}]},
 {'slug': 'canslim',
  'name': 'CAN SLIM',
  'aliases': ['can slim', 'canslim', 'can-slim', "o'neil", 'oneil', 'o neil'],
  'fidelity': 'faithful',
  'caveat': '',
  'persona': "William O'Neil's CAN SLIM: high-growth market leaders breaking to new highs on heavy volume with "
             'institutional support.',
  'ranking_field': 'rs_rating',
  'filters': ['C — Current-quarter EPS growth ≥ 25% YoY',
              'C — Earnings growth accelerating in recent quarters',
              'C — Positive current earnings (from continuing operations)',
              'A — 5-year annual EPS growth ≥ 25% (AAII Rev. 3rd Ed.)',
              "A — 3-year annual EPS growth ≥ 25% (O'Neil)",
              'A — ROE ≥ 17%',
              'N — Making new price highs / breakout from base',
              'S — Breakout volume ≥ ~40% above average',
              'S — Company buying back shares (reduces supply)',
              'L — RS rating ≥ 80',
              'L — Within 10% of 52-week high',
              'I — Some institutional sponsorship present',
              'I — Not over-owned by institutions'],
  'screen': [{'field': 'eps_growth_recent_q', 'op': '>=', 'value': 25},
             {'field': 'earnings_acceleration', 'op': 'is_true'},
             {'field': 'profitable', 'op': 'is_true'},
             {'field': 'eps_growth_5y', 'op': '>=', 'value': 25},
             {'field': 'eps_growth_3y', 'op': '>=', 'value': 25},
             {'field': 'roe', 'op': '>=', 'value': 17},
             {'field': 'new_high_breakout', 'op': 'is_true'},
             {'field': 'rel_volume', 'op': '>=', 'value': 1.4},
             {'field': 'buying_back', 'op': 'is_true'},
             {'field': 'rs_rating', 'op': '>=', 'value': 80},
             {'field': 'pct_from_52w_high', 'op': '>=', 'value': -10},
             {'field': 'institutional_ownership', 'op': '>=', 'value': 5},
             {'field': 'institutional_ownership', 'op': '<=', 'value': 90}]},
 {'slug': 'buffett',
  'name': 'Buffett',
  'aliases': ['buffett', 'berkshire'],
  'fidelity': 'faithful',
  'caveat': "Note: Buffett's deeper method — owner earnings, intrinsic value and the qualitative moat — can't be "
            'screened, so this captures the quality and low-debt filters.',
  'persona': 'Buffett-style quality: durable, highly profitable, low-debt compounders with fat margins.',
  'ranking_field': 'roic',
  'filters': ['ROE ≥ 15% (sustained high profitability)',
              'ROIC ≥ 12% (efficient capital use / moat)',
              '5-yr EPS growth ≥ 10% (strong long-term earnings)',
              'Earnings growth accelerating (recent > long-term)',
              'Consistently profitable (positive earnings, no losses)',
              'Debt-to-equity ≤ 0.5 (conservative financing)',
              'Net debt ≤ 3× EBITDA (low long-term debt)',
              'Operating margin ≥ 15% (pricing power)',
              'Net profit margin ≥ 10% (moat)'],
  'screen': [{'field': 'roe', 'op': '>=', 'value': 15},
             {'field': 'roic', 'op': '>=', 'value': 12},
             {'field': 'eps_growth_5y', 'op': '>=', 'value': 10},
             {'field': 'earnings_acceleration', 'op': 'is_true'},
             {'field': 'profitable', 'op': 'is_true'},
             {'field': 'debt_to_equity', 'op': '<=', 'value': 0.5},
             {'field': 'net_debt_to_ebitda', 'op': '<=', 'value': 3},
             {'field': 'operating_margin', 'op': '>=', 'value': 15},
             {'field': 'net_margin', 'op': '>=', 'value': 10}]},
 {'slug': 'lynch',
  'name': 'Lynch (GARP)',
  'aliases': ['lynch', 'garp'],
  'fidelity': 'faithful',
  'caveat': "Note: uses standard PEG (Lynch's real metric is the dividend-adjusted PEGY).",
  'persona': 'Peter Lynch GARP: reasonably-priced steady growers (PEG ≤ 1) with clean balance sheets.',
  'ranking_field': 'eps_growth_5y',
  'filters': ['PEG ratio ≤ 1.0 (P/E in line with growth)',
              '5-yr EPS growth ≥ 15%',
              '5-yr EPS growth ≤ 50% (exclude unsustainable growers)',
              'Debt-to-equity ≤ 0.6 (strong balance sheet)',
              'Net cash positive (cash > long-term debt)',
              'Current ratio ≥ 1',
              'ROE ≥ 15%',
              'Profitable (positive earnings)',
              'Institutional ownership ≤ 50% (under-followed)',
              'Sector is not Financials (excluded)'],
  'screen': [{'field': 'peg_ratio', 'op': '<=', 'value': 1},
             {'field': 'eps_growth_5y', 'op': '>=', 'value': 15},
             {'field': 'eps_growth_5y', 'op': '<=', 'value': 50},
             {'field': 'debt_to_equity', 'op': '<=', 'value': 0.6},
             {'field': 'net_cash_positive', 'op': 'is_true'},
             {'field': 'current_ratio', 'op': '>=', 'value': 1},
             {'field': 'roe', 'op': '>=', 'value': 15},
             {'field': 'profitable', 'op': 'is_true'},
             {'field': 'institutional_ownership', 'op': '<=', 'value': 50},
             {'field': 'sector',
              'op': 'in',
              'value': ['Energy',
                        'Materials',
                        'Industrials',
                        'Consumer Discretionary',
                        'Consumer Staples',
                        'Health Care',
                        'Information Technology',
                        'Communication Services',
                        'Utilities',
                        'Real Estate']}]},
 {'slug': 'graham',
  'name': 'Graham (Defensive Value)',
  'aliases': ['graham', 'benjamin graham', 'ben graham'],
  'fidelity': 'faithful',
  'caveat': '',
  'persona': "Benjamin Graham's defensive value: large, financially strong, cheap, dividend-paying stocks with "
             'stable earnings.',
  'ranking_field': 'roic',
  'filters': ['Market cap ≥ $2B (adequate size)',
              'Current ratio ≥ 2 (strong financial condition)',
              'Debt-to-equity ≤ 1 (conservative leverage)',
              'P/E ≤ 15 (moderate earnings multiple)',
              'P/B ≤ 1.5 (moderate price-to-book)',
              'Currently profitable (earnings stability)',
              'Pays a current dividend',
              'EPS higher than 5 years ago (positive 5-year growth)'],
  'screen': [{'field': 'market_cap', 'op': '>=', 'value': 2000000000},
             {'field': 'current_ratio', 'op': '>=', 'value': 2},
             {'field': 'debt_to_equity', 'op': '<=', 'value': 1},
             {'field': 'pe_ratio', 'op': '<=', 'value': 15},
             {'field': 'price_to_book', 'op': '<=', 'value': 1.5},
             {'field': 'profitable', 'op': 'is_true'},
             {'field': 'dividend_yield', 'op': '>=', 'value': 0.01},
             {'field': 'eps_growth_5y', 'op': '>=', 'value': 0}]},
 {'slug': 'magic-formula',
  'name': 'Magic Formula',
  'aliases': ['magic formula', 'greenblatt'],
  'fidelity': 'proxy',
  'caveat': 'Heads-up: rough proxy — Greenblatt ranks on return-on-capital AND earnings-yield together; we can only '
            'rank on ROIC here.',
  'persona': "Greenblatt's Magic Formula: good businesses (high ROIC) at cheap prices.",
  'ranking_field': 'roic',
  'filters': ['Market cap ≥ $50M',
              'Sector is not Financials or Utilities (banks/insurers and regulated utilities excluded)'],
  'screen': [{'field': 'market_cap', 'op': '>=', 'value': 50000000},
             {'field': 'sector',
              'op': 'in',
              'value': ['Technology',
                        'Healthcare',
                        'Consumer Cyclical',
                        'Consumer Defensive',
                        'Communication Services',
                        'Energy',
                        'Industrials',
                        'Materials',
                        'Real Estate']}]},
 {'slug': 'piotroski',
  'name': 'Piotroski F-Score',
  'aliases': ['piotroski', 'f-score', 'fscore', 'f score'],
  'fidelity': 'proxy',
  'caveat': 'Heads-up: rough proxy — only 3 of the 9 F-Score signals map (no cash-flow or year-over-year data yet).',
  'persona': 'Piotroski F-Score: financially improving, profitable value stocks.',
  'ranking_field': 'roic',
  'filters': ['Profitable (positive ROA proxy — test #1)',
              'No new shares issued (buying back stock — test #7)',
              'Gross/operating margin rising YoY (test #8)'],
  'screen': [{'field': 'profitable', 'op': 'is_true'},
             {'field': 'buying_back', 'op': 'is_true'},
             {'field': 'margin_expansion', 'op': 'is_true'}]},
 {'slug': 'fisher',
  'name': 'Fisher',
  'aliases': ['fisher', 'scuttlebutt'],
  'fidelity': 'approx',
  'caveat': 'Note: Fisher gives no exact numbers — these thresholds are sensible defaults.',
  'persona': 'Phil Fisher: durable, innovative growers with strong, expanding margins funded without dilution.',
  'ranking_field': 'roic',
  'filters': ['5yr revenue growth ≥ 10% (Pt 1: sizable multi-year sales increase)',
              'Net margin ≥ 10% (Pt 5: worthwhile profit margin)',
              'Margins expanding (Pt 6: maintaining/improving profit margins)',
              'Buying back shares (Pt 13: growth not funded by dilutive equity)'],
  'screen': [{'field': 'revenue_growth_5y', 'op': '>=', 'value': 10},
             {'field': 'net_margin', 'op': '>=', 'value': 10},
             {'field': 'margin_expansion', 'op': 'is_true'},
             {'field': 'buying_back', 'op': 'is_true'}]},
 {'slug': 'ark',
  'name': 'ARK / Cathie Wood',
  'aliases': ['ark', 'cathie wood', 'cathy wood', 'disruptive innovation'],
  'fidelity': 'approx',
  'caveat': "Note: captures the high-growth side; ARK's disruption/TAM thesis can't be screened.",
  'persona': 'Cathie Wood / ARK: high, accelerating-revenue disruptive innovators.',
  'ranking_field': 'revenue_growth_3y',
  'filters': ['TTM revenue growth ≥ 20% (disruptive-innovation growth)',
              '3-yr revenue growth ≥ 20% (sustained disruptive growth)',
              "Accelerating sales (Wright's Law demand waves)"],
  'screen': [{'field': 'revenue_growth_ttm', 'op': '>=', 'value': 20},
             {'field': 'revenue_growth_3y', 'op': '>=', 'value': 20},
             {'field': 'sales_acceleration', 'op': 'is_true'}]},
 {'slug': 'dreman',
  'name': 'Dreman (Contrarian Value)',
  'aliases': ['dreman'],
  'fidelity': 'faithful',
  'caveat': '',
  'persona': 'David Dreman contrarian value: large, cheap, financially strong, dividend-paying stocks the market has '
             'given up on.',
  'ranking_field': 'roe',
  'filters': ['Market cap ≥ $2B (proxy for largest ~1,500 U.S. stocks)',
              'P/E ≤ 15 (low P/E; bottom ~40% of market proxy)',
              'Positive earnings',
              'Recent-quarter EPS growth ≥ 0 (rising earnings trend)',
              '5-yr EPS growth ≥ 8% (above S&P 500 proxy)',
              'Projected EPS growth ≥ 8% (above S&P 500 proxy)',
              'TTM EPS growth ≥ 8% (near-term above-median proxy)',
              'Analyst earnings estimates rising (next-2-FY revisions up)',
              'Current ratio ≥ 2.0',
              'Debt-to-equity < 20% (0.20)',
              'ROE ≥ 15% (top-third-of-market proxy)',
              'Operating margin ≥ 8% (pre-tax profit margin proxy)',
              'Dividend yield ≥ 2.5% (≈1 pt above market average)'],
  'screen': [{'field': 'market_cap', 'op': '>=', 'value': 2000000000},
             {'field': 'pe_ratio', 'op': '<=', 'value': 15},
             {'field': 'profitable', 'op': 'is_true'},
             {'field': 'eps_growth_recent_q', 'op': '>=', 'value': 0},
             {'field': 'eps_growth_5y', 'op': '>=', 'value': 8},
             {'field': 'forward_eps_growth', 'op': '>=', 'value': 8},
             {'field': 'eps_growth_ttm', 'op': '>=', 'value': 8},
             {'field': 'rising_estimates', 'op': 'is_true'},
             {'field': 'current_ratio', 'op': '>=', 'value': 2},
             {'field': 'debt_to_equity', 'op': '<=', 'value': 0.2},
             {'field': 'roe', 'op': '>=', 'value': 15},
             {'field': 'operating_margin', 'op': '>=', 'value': 8},
             {'field': 'dividend_yield', 'op': '>=', 'value': 2.5}]},
 {'slug': 'neff',
  'name': 'Neff',
  'aliases': ['neff'],
  'fidelity': 'faithful',
  'caveat': "Note: uses standard PEG, not Neff's dividend-adjusted total-return ratio.",
  'persona': 'John Neff: cheap, steady 7–20% growers held for total return, with a dividend cushion.',
  'ranking_field': 'peg_ratio',
  'filters': ['P/E ≤ 12 (≈40-60% of the market-average multiple)',
              'P/E ≥ 5 (screen out weak/distressed companies)',
              '3-yr EPS growth ≥ 7%',
              '3-yr EPS growth ≤ 20% (not unsustainably fast)',
              '5-yr EPS growth ≥ 7%',
              '5-yr EPS growth ≤ 20% (steady, sustainable)',
              'Estimated forward EPS growth ≥ 6%',
              'Meaningful dividend yield ≥ 1% (yield protection)',
              "PEG ≤ 1.4 (Neff's accepted valuation ceiling)",
              'Recent quarterly EPS not declining YoY (earnings persistence)'],
  'screen': [{'field': 'pe_ratio', 'op': '<=', 'value': 12},
             {'field': 'pe_ratio', 'op': '>=', 'value': 5},
             {'field': 'eps_growth_3y', 'op': '>=', 'value': 7},
             {'field': 'eps_growth_3y', 'op': '<=', 'value': 20},
             {'field': 'eps_growth_5y', 'op': '>=', 'value': 7},
             {'field': 'eps_growth_5y', 'op': '<=', 'value': 20},
             {'field': 'forward_eps_growth', 'op': '>=', 'value': 6},
             {'field': 'dividend_yield', 'op': '>=', 'value': 1},
             {'field': 'peg_ratio', 'op': '<=', 'value': 1.4},
             {'field': 'eps_growth_recent_q', 'op': '>=', 'value': 0}]},
 {'slug': 'momentum',
  'name': 'Momentum (12-1)',
  'aliases': ['momentum', 'jegadeesh', 'titman'],
  'fidelity': 'approx',
  'caveat': 'Note: RS rating ≥ 90 approximates the academic top-decile 12-month momentum.',
  'persona': 'Academic momentum: the strongest 12-month (skip last month) price winners.',
  'ranking_field': 'momentum_12_1',
  'filters': ['12-1 momentum positive (winner leg: past 12m return, skip most recent month)',
              'Relative strength in top decile (RS ≥ 90 ≈ top 10% winners)'],
  'screen': [{'field': 'momentum_12_1', 'op': '>=', 'value': 0}, {'field': 'rs_rating', 'op': '>=', 'value': 90}]},
 {'slug': 'dividend-growth',
  'name': 'Dividend Aristocrats',
  'aliases': ['dividend aristocrat', 'aristocrat', 'dividend growth', 'dividend growers'],
  'fidelity': 'proxy',
  'caveat': "Heads-up: rough proxy — we can't yet verify the 25-year dividend-increase streak, so this uses a "
            'dividend-growth filter instead.',
  'persona': 'Dividend Aristocrats: large, established companies that steadily grow their dividend.',
  'ranking_field': 'dividend_growth_5y',
  'filters': ['Market cap ≥ $3B (proxy for float-adjusted size)',
              'Pays a dividend (yield > 0%)',
              '5-yr dividend growth ≥ 1% (proxy for consistent annual increases)'],
  'screen': [{'field': 'market_cap', 'op': '>=', 'value': 3000000000},
             {'field': 'dividend_yield', 'op': '>=', 'value': 0.01},
             {'field': 'dividend_growth_5y', 'op': '>=', 'value': 1}]},
 {'slug': 'quality',
  'name': 'Quality',
  'aliases': ['quality investing',
              'quality factor',
              'gross profitability',
              'novy-marx',
              'novy marx',
              'grantham',
              'gmo'],
  'fidelity': 'faithful',
  'caveat': '',
  'persona': 'Quality investing: high-margin, high-return, low-leverage compounders.',
  'ranking_field': 'roic',
  'filters': ['Gross margin ≥ 40% (gross-profitability proxy)',
              'Return on equity ≥ 15% (high profitability)',
              'Return on invested capital ≥ 12% (high return on capital)',
              'Debt-to-equity ≤ 0.5 (low leverage)',
              'Net debt / EBITDA ≤ 2 (clean balance sheet)',
              'Profitable (has positive reported earnings)',
              'Market cap ≥ $30M'],
  'screen': [{'field': 'gross_margin', 'op': '>=', 'value': 40},
             {'field': 'roe', 'op': '>=', 'value': 15},
             {'field': 'roic', 'op': '>=', 'value': 12},
             {'field': 'debt_to_equity', 'op': '<=', 'value': 0.5},
             {'field': 'net_debt_to_ebitda', 'op': '<=', 'value': 2},
             {'field': 'profitable', 'op': 'is_true'},
             {'field': 'market_cap', 'op': '>=', 'value': 30000000}]}]


_BY_SLUG = {p["slug"]: p for p in PLAYBOOKS}

# Distinctive single-word aliases (>=5 chars) used for typo-tolerant fuzzy matching.
_FUZZY = [(a, p) for p in PLAYBOOKS for a in p["aliases"] if " " not in a and len(a) >= 5]


def match_playbook(text: str) -> dict | None:
    """The playbook the user named, or None. First an exact whole-word alias match
    (longest wins so 'can slim' beats a short token); then a fuzzy fallback that
    tolerates typos on distinctive names ('mivervini' -> minervini)."""
    if not text:
        return None
    t = text.lower()
    best, best_len = None, 0
    for p in PLAYBOOKS:
        for a in p["aliases"]:
            if len(a) > best_len and re.search(r"\b" + re.escape(a) + r"s?\b", t):
                best, best_len = p, len(a)
    if best:
        return best
    for w in re.findall(r"[a-z']{5,}", t):
        for a, p in _FUZZY:
            if difflib.SequenceMatcher(None, w, a).ratio() >= 0.85:
                return p
    return None


def _key(conds: list[dict] | None) -> set:
    out = set()
    for c in conds or []:
        v = c.get("value")
        out.add((c.get("field"), c.get("op"), tuple(v) if isinstance(v, list) else v))
    return out


def same_conditions(a: list[dict] | None, b: list[dict] | None) -> bool:
    return _key(a) == _key(b)


def playbook_spec(pb: dict) -> dict:
    return {
        "name": pb["name"],
        "persona": pb["persona"],
        "filters": list(pb["filters"]),
        "screen": [dict(c) for c in pb["screen"]],
    }


def playbook_turn(pb: dict) -> dict:
    """A full builder turn that loads the playbook's checklist — deterministic, no LLM."""
    # HONESTY: built from the investor's PUBLISHED rules \u2014 close, not a clone \u2014
    # and the known gaps are named, so users can judge and refine it.
    tail = f" (though {pb['caveat']})" if pb.get("caveat") else ""
    reply = (
        f"Here\u2019s the {pb['name']} checklist \u2014 faithful to the published rules{tail}. "
        f"Say \u201ctest it\u201d to backtest, or tweak any rule."
    )
    return {
        "intent": "build",
        "reply": reply,
        "options": [],
        "multi_select": False,
        "input": None,
        "ready": True,
        "spec": playbook_spec(pb),
        "matches": None,
        "universe": None,
    }
