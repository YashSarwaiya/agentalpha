// Local persistence for the agent builder — so a refresh (or accidental close)
// never loses an in-progress build, past versions can be recovered, and recent
// backtest results are there when you come back.
// Browser-local (localStorage): survives refresh + reopen on this device.
import type { BuilderSpec, BuilderInput, ChatMessage, BacktestResult } from '../types/arena'

const DRAFT_KEY = 'agentBuilder.draft.v1'
const VERSIONS_KEY = 'agentBuilder.versions.v1'
const BACKTESTS_KEY = 'agentBuilder.backtests.v1'
const PENDING_BT_KEY = 'agentBuilder.pendingBacktest.v1'
const MAX_VERSIONS = 25
const MAX_BACKTESTS = 15

export interface BuilderDraft {
  messages: ChatMessage[]
  spec: BuilderSpec | null
  name: string
  ready: boolean
  // Match state + any pending input widget — without these a refresh claims the
  // watchlist is empty and drops the slider/chips the last message points at.
  matches?: number | null
  universe?: number | null
  matchedTickers?: string[] | null
  options?: string[]
  multiSelect?: boolean
  range?: BuilderInput | null
  savedAt: number
}

export interface BuilderVersion {
  id: string
  spec: BuilderSpec
  name: string
  at: number
  note: string // one-line summary of the strategy at this point
  messages?: ChatMessage[] // the full chat at this point — Restore brings the whole conversation back
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota / private mode — persistence is best-effort */
  }
}

// ── live draft (the current in-progress session) ──
export function saveDraft(d: Omit<BuilderDraft, 'savedAt'>): void {
  write(DRAFT_KEY, { ...d, savedAt: Date.now() })
}
export function loadDraft(): BuilderDraft | null {
  return read<BuilderDraft | null>(DRAFT_KEY, null)
}
export function clearDraft(): void {
  try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
}

// ── version history (recoverable snapshots of the strategy) ──
// One-line summary shown under each saved version. Include the risk params —
// most edits to a legend's screen only change sizing/stop/target, so a note of
// just "7 rules" made every version look identical and impossible to tell apart.
function summarize(spec: BuilderSpec): string {
  const parts: string[] = []
  if (spec.filters?.length) parts.push(`${spec.filters.length} rule${spec.filters.length === 1 ? '' : 's'}`)
  if (spec.subagents?.length) parts.push(`${spec.subagents.length} AI check${spec.subagents.length === 1 ? '' : 's'}`)
  if (spec.max_position_pct) parts.push(`${spec.max_position_pct}% size`)
  if (spec.stop_loss_pct) parts.push(`stop ${spec.stop_loss_pct}%`)
  if (spec.profit_target_pct) parts.push(`target ${spec.profit_target_pct}%`)
  return parts.length ? parts.join(' · ') : 'draft'
}

export function loadVersions(): BuilderVersion[] {
  return read<BuilderVersion[]>(VERSIONS_KEY, [])
}

// Append a snapshot ONLY when the strategy actually changed from the last one.
// Deduped against the newest entry so restores/rephrasings never pile up
// duplicates (duplicates made the list shift under the user's clicks).
export function pushVersion(spec: BuilderSpec, name: string, messages: ChatMessage[] = []): BuilderVersion[] {
  const versions = loadVersions()
  if (versions.length && JSON.stringify(versions[0].spec) === JSON.stringify(spec)) {
    return versions
  }
  const v: BuilderVersion = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    spec, name: name || spec.name || 'Agent', at: Date.now(), note: summarize(spec),
    messages: messages.slice(-80), // the conversation that produced this version (bounded so storage stays small)
  }
  const next = [v, ...versions].slice(0, MAX_VERSIONS)
  write(VERSIONS_KEY, next)
  return next
}

export function clearVersions(): void {
  try { localStorage.removeItem(VERSIONS_KEY) } catch { /* ignore */ }
}

// ── recent backtest runs (recoverable after leaving the site) ──
export interface BacktestRun {
  id: string
  at: number
  name: string
  note: string           // one-line strategy summary
  jobId?: string         // server job id — dedupes double-saves of the same run
  result: BacktestResult // full result, so it re-displays exactly
}

export function loadBacktestRuns(): BacktestRun[] {
  return read<BacktestRun[]>(BACKTESTS_KEY, [])
}

export function saveBacktestRun(name: string, spec: BuilderSpec | null, result: BacktestResult, jobId?: string): BacktestRun[] {
  const runs = loadBacktestRuns()
  // Two poll loops can finish the same job (zombie loop from a previous mount +
  // the resumed one) — one entry per job, not one per loop.
  if (jobId && runs[0]?.jobId === jobId) return runs
  const run: BacktestRun = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    at: Date.now(),
    name: name || spec?.name || 'Agent',
    note: spec ? summarize(spec) : 'backtest',
    jobId,
    result,
  }
  const next = [run, ...runs].slice(0, MAX_BACKTESTS)
  write(BACKTESTS_KEY, next)
  return next
}

// A backtest is a server JOB (runs for minutes) — remember its id so a run that
// finishes while the user is away can be picked back up on return.
export interface PendingBacktest { jobId: string; at: number; name: string }
export function savePendingBacktest(p: PendingBacktest): void { write(PENDING_BT_KEY, p) }
export function loadPendingBacktest(): PendingBacktest | null { return read<PendingBacktest | null>(PENDING_BT_KEY, null) }
export function clearPendingBacktest(): void { try { localStorage.removeItem(PENDING_BT_KEY) } catch { /* ignore */ } }
