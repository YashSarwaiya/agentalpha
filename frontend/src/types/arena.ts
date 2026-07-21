// Arena (agent trading-signals) types. Mirrors the backend /api/v1/* JSON.
// NOTE: all money/share/percent fields are STRINGS (Decimal serialized) — parse
// with toNum() from lib/arenaFormat only at render time, never do math on raw.

export interface ArenaPosition {
  ticker: string
  shares: string
  avg_cost: string
  updated_at: string
  // Live mark (from the stocks.last_price join) — present on subscriber views of
  // GET /v1/agents/{id} and on /v1/me. Absent ⇒ fall back to avg_cost (no live mark).
  last_price?: string
  market_value?: string
  // Protective stop level (agent-set, else a default −10% mark). Null/absent ⇒ none.
  stop_price?: string | null
}

// Declared "mandate" — what KIND of agent it is, written by the creator.
export interface AgentProfile {
  strategy_style?: string | null
  thesis?: string | null
  market_cap_focus?: string | null
  sectors?: string[] | null
  hold_horizon?: string | null
  stop_loss_policy?: string | null
  conviction?: string | null
}

export interface ArenaAgent {
  id: string
  name: string
  slug: string | null
  description: string | null
  avatar_url: string | null
  starting_cash: string
  cash_balance: string
  total_equity?: string
  positions_value?: string
  is_first_party: boolean
  created_at: string
  subscription_price_usd: string | null
  is_subscribed: boolean
  profile?: AgentProfile | null
  persona?: string | null
  watchlist?: string[]
  max_position_pct?: string
  stop_loss_pct?: string
  max_positions?: number | null
  run_interval_minutes?: number
  is_simulated?: boolean
  disclaimer?: string
  positions_locked: boolean
  positions: ArenaPosition[]
}

// One order the agent WOULD place (Preview) or did place (Deploy), from /v1/preview.
export interface PreviewOrder {
  ticker: string
  action: 'BUY' | 'SELL'
  quantity: number
  price: number | null
  stop_price: number | null
  reason: string
  capped: boolean
  status: string
  would_fill_price?: number
  would_notional?: number
  note?: string
}

// Result of POST /v1/preview — what the one-sentence agent would do right now.
export interface PreviewResult {
  reasoning_steps: string[]
  orders: PreviewOrder[]
  warnings: string[]
  summary: string
}

// Historical backtest of the screen (POST /v1/backtest) — the "test" step of build → test → deploy.
export interface BacktestTrade {
  ticker: string
  entry_date: string
  exit_date: string
  entry: number
  exit: number
  pnl_pct: number
  reason: string
}
export interface BacktestResult {
  metrics: {
    total_return_pct: number
    cagr_pct: number
    max_drawdown_pct: number
    win_rate_pct: number
    num_trades: number
    profit_factor: number | null
    market_return_pct?: number | null   // SPY buy-and-hold over the same window
    yearly?: { year: number; agent_pct: number | null; market_pct: number | null; partial?: boolean }[] | null
    universe_tested?: number | null
    universe_dropped_partial_data?: number | null
  }
  equity_curve: [string, number][]
  trades: BacktestTrade[]
}

// Conversational agent builder (POST /v1/agent-builder).
export interface ScreenCond {
  field: string
  op: string
  value?: number | string | boolean | (number | string)[] | null
}

// A Member judgment rule: an AI runs `instruction` at `checkpoint` on the few
// stocks the screen picks (news gate, holdings watch, …).
export interface SubagentSpec {
  checkpoint: 'before_buy' | 'while_holding' | 'before_sell'
  instruction: string
  data: ('news' | 'filings')[]
  output: 'allow_or_block' | 'alert_only'
  cadence_minutes?: number
}

export interface BuilderSpec {
  name?: string
  persona?: string
  filters?: string[]
  entry_rules?: string[]
  screen?: ScreenCond[]
  buy_rules?: string
  sell_rules?: string
  watchlist?: string[]
  max_position_pct?: number
  stop_loss_pct?: number
  max_positions?: number
  profit_target_pct?: number
  exit_on_screen_exit?: boolean
  run_interval_minutes?: number
  subagents?: SubagentSpec[]
}

export interface BuilderInput {
  kind: 'range'
  label: string
  min: number
  max: number
  step?: number
  default?: number
  defaultHi?: number
  unit?: string
  hint?: string
  // When set, the slider snaps between these labeled stops (index-based) instead
  // of a raw number — good for wide ranges like market cap ($100M … $1T+).
  stops?: string[]
  // Two thumbs (lower + upper bound) instead of one.
  dual?: boolean
}

export interface BuilderResponse {
  intent?: 'build' | 'question' | 'unsupported' | 'chitchat'
  reply: string
  options: string[]
  multi_select: boolean
  input: BuilderInput | null
  ready: boolean
  spec: BuilderSpec
  matches?: number | null
  universe?: number | null
  matched_tickers?: string[] | null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Observed "quality" half of the strategy profile — computed live from the
// agent's real simulated trades. Any field is null when data is insufficient.
export interface AgentStrategy {
  agent_id: string
  win_rate: string | null            // percentage 0-100
  max_drawdown: string | null        // negative %
  consistency: string | null         // 'Steady' | 'Moderate' | 'Swingy'
  trade_frequency: string | null     // '~9 / month'
  trade_frequency_bucket: string | null
  track_record_window: string | null // '3 months · 22 closed trades'
  cap_observed: string | null        // '92% large-cap'
  sector_observed: string | null     // '70% Technology'
  hold_observed: string | null       // 'median 11 days'
  stop_observed: string | null       // 'median 7.9%'
  conviction_observed: string | null // '7 holdings · top 24%'
}

export interface SignalFill {
  fill_price: string
  notional: string
  // Present on SELL fills in an agent's trade history: realized P&L on that exit
  // (average-cost), computed server-side by replaying fills.
  realized_pnl?: string
}

export interface Signal {
  id: string
  agent_id: string
  agent_name: string
  agent_slug: string | null
  agent_avatar_url: string | null
  ticker: string
  action: 'BUY' | 'SELL'
  size_pct: string
  reasoning: string | null
  received_at: string
  accepted: boolean
  rejected_reason: string | null
  fill: SignalFill | null
}

export interface SignalHistory {
  agent_id: string
  locked: boolean
  total: number
  signals: Signal[]
}

export interface LeaderboardEntry {
  id: string
  name: string
  slug: string | null
  avatar_url: string | null
  is_first_party: boolean
  total_equity: string
  cash: string
  positions_value: string
  return_pct: string
  return_today: string | null
  return_1m: string | null
  return_1y: string | null
  source: 'snapshot' | 'live'
  is_simulated?: boolean
  equity_spark: number[]
}

export interface CompetitionLeader {
  id: string
  name: string
  slug: string | null
  avatar_url: string | null
  return_pct: string
}

// What a competition awards. Every competition ranks the same board (agents by
// total return) and differs ONLY by this prize.
export type PrizeType = 'reputation' | 'cash' | 'spotlight'
export interface Prize {
  type: PrizeType
  label: string   // short badge text, e.g. "$5,000 prize pool"
  detail: string  // one sentence — what the winner actually gets
  distribution?: number[]  // cash payout by rank (index 0 = 1st); absent for non-cash prizes
}

// One competition in the list (GET /v1/competitions) — no standings, just its
// identity + prize + the shared leader/meta.
export interface CompetitionSummary {
  slug: string
  name: string
  tagline: string
  prize: Prize
  duration_months: number   // season length; the board refreshes every this-many months
  season_start?: string     // ISO date the season opens
  season_end?: string       // ISO date the season closes (start + duration_months)
  how_to_enter?: string
  status: 'live' | 'forming'
  participants: number
  started_at: string | null
  updated_at: string | null
  leader: CompetitionLeader | null
  is_simulated?: boolean
  disclaimer?: string
}

export interface CompetitionList {
  competitions: CompetitionSummary[]
  is_simulated?: boolean
  disclaimer?: string
}

// GET /v1/competitions/{slug}: one competition's meta + prize + the full board.
// (Back-compat GET /v1/competition returns the same shape with `season`.)
// participants = agents with a book; started_at/updated_at = MIN/MAX snapshot
// date across all agents (null before the first snapshot); leader = rank-1.
export interface Competition {
  season?: string
  slug?: string
  name?: string
  tagline?: string
  prize?: Prize
  duration_months?: number
  season_start?: string
  season_end?: string
  how_to_enter?: string
  status: 'live' | 'forming'
  participants: number
  started_at: string | null
  updated_at: string | null
  leader: CompetitionLeader | null
  standings: LeaderboardEntry[]
  is_simulated?: boolean
  disclaimer?: string
}

export interface EquityPoint {
  date: string
  equity: string
  cash: string
  positions_value: string
  return_pct: string
}

export interface EquitySeries {
  agent_id: string
  starting_cash: string
  points: EquityPoint[]
}

// Resting limit/stop order, not yet triggered.
export interface ArenaOrder {
  id: string
  ticker: string
  side: 'BUY' | 'SELL'
  order_type: 'LIMIT' | 'STOP'
  trigger_price: string
  quantity: string
  reasoning: string | null
  created_at: string
}

export interface AgentOrders {
  locked: boolean
  orders: ArenaOrder[]
}

export interface AgentStats {
  agent_id: string
  name: string
  starting_cash: string
  cash_balance: string
  positions_value: string
  total_equity: string
  return_pct: string
  return_1m: string | null
  return_6m: string | null
  return_1y: string | null
  signals_total: number
  signals_accepted: number
  win_rate: string | null
  open_positions: number
  first_snapshot_date: string | null
  latest_snapshot_date: string | null
}

// Returned by POST /v1/me/agents — includes the plaintext key shown ONCE.
export interface CreatedAgent {
  id: string
  name: string
  slug: string
  description: string | null
  avatar_url: string | null
  starting_cash: string
  cash_balance: string
  subscription_price_usd: string | null
  persona?: string | null
  watchlist?: string[]
  deployed?: boolean
  warnings?: string[]
  created_at: string
  api_key: string
  api_key_id: string
}

export interface MyAgent {
  id: string
  name: string
  slug: string | null
  description: string | null
  avatar_url: string | null
  starting_cash: string
  cash_balance: string
  positions_value: string
  total_equity: string
  return_pct: string
  subscription_price_usd: string | null
  subscriber_count: number
  mrr: string
  persona?: string | null
  watchlist?: string[]
  is_deployed?: boolean
  is_public?: boolean
  last_run_at?: string | null
  buy_rules?: string | null
  sell_rules?: string | null
  max_position_pct?: string
  stop_loss_pct?: string
  max_positions?: number | null
  run_interval_minutes?: number
  created_at: string
  key_prefix: string | null
  key_last_used_at: string | null
  key_revoked: boolean
}

export interface OwnerSignal {
  id: string
  ticker: string
  action: 'BUY' | 'SELL'
  size_pct: string
  reasoning: string | null
  received_at: string
  accepted: boolean
  rejected_reason: string | null
  fill_price: string | null
  notional: string | null
}

export interface MyAgentDetail {
  id: string
  name: string
  slug: string | null
  description: string | null
  avatar_url: string | null
  starting_cash: string
  cash_balance: string
  created_at: string
  key_prefix: string | null
  key_last_used_at: string | null
  key_revoked: boolean
  positions: ArenaPosition[]
  recent_signals: OwnerSignal[]
  gate_checks?: GateCheck[]
  // Full strategy — so the chat builder can load this agent to edit it.
  persona?: string | null
  watchlist?: string[]
  buy_rules?: string | null
  sell_rules?: string | null
  max_position_pct?: string | null
  stop_loss_pct?: string | null
  max_positions?: number | null
  run_interval_minutes?: number | null
  screen?: ScreenCond[]
  profit_target_pct?: string | null
  exit_on_screen_exit?: boolean
  subagents?: SubagentSpec[]
  is_deployed?: boolean
}

// One AI news-gate decision — the subagent "log".
export interface GateCheck {
  ticker: string
  checkpoint: 'before_buy' | 'while_holding' | 'before_sell'
  verdict: 'allow' | 'block'
  reason: string | null
  created_at: string
}

export interface KeyIssued {
  api_key: string
  api_key_id: string
}

export interface Follow {
  agent_id: string
  premium: boolean
  created_at: string
  payment?: string
}

export interface FollowSummary {
  agent_id: string
  name: string
  slug: string | null
  avatar_url: string | null
  premium: boolean
  created_at: string
}
