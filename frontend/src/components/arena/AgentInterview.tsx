
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { arena } from '../../lib/api'
import type { BuilderInput, BuilderSpec, ChatMessage, CreatedAgent, PreviewResult, BacktestResult } from '../../types/arena'
import PreviewPanel from './PreviewPanel'
import BacktestPanel from './BacktestPanel'
import {
  saveDraft, loadDraft, clearDraft, pushVersion, loadVersions, clearVersions, type BuilderVersion,
  loadBacktestRuns, saveBacktestRun, savePendingBacktest, loadPendingBacktest, clearPendingBacktest,
  type BacktestRun,
} from '../../lib/builderStore'

// AI-powered agent builder. Full-screen, pure-black, 50/50 split. Left = a calm
// ChatGPT-style chat driven by the /v1/agent-builder LLM (real reasoning, fresh
// examples, edge-case + safety handling). Right = a live "agent card" that fills
// in from the spec the model returns. First question (company size) is shown
// instantly client-side so the first paint is tactile; the LLM drives from there.

// News-reading AI agents are OFF for now — the builder stays a clean deterministic
// screener (no "AI checks" step, no news examples). Flip to true to bring it back
// (must also set NEWS_AGENTS_ENABLED=1 on the backend to match).
const NEWS_ENABLED = false

const MCAP_STOPS = ['Any', '$100M', '$300M', '$1B', '$2B', '$5B', '$10B', '$25B', '$100B', '$500B', '$1T+']
const GREETING = 'Do you want to build your own screener, or follow a legendary investor’s strategy? Tell me which (e.g. “build my own” or “follow Minervini”).'
const FIRST_RANGE: BuilderInput = {
  kind: 'range', label: 'Company size', min: 0, max: MCAP_STOPS.length - 1, step: 1,
  default: 4, defaultHi: MCAP_STOPS.length - 1, stops: MCAP_STOPS, dual: true,
  hint: 'Left handle = smallest, right = largest. Bigger is generally safer.',
}

const FREQ_LABEL: Record<number, string> = { 15: 'every 15 min', 60: 'hourly', 240: 'every 4 hours', 1440: 'daily' }
const ALLOWED_FREQ = [15, 60, 240, 1440]

// The windows the right panel can show, chosen from the header tabs.
const TABS = [['agent', 'Your agent'], ['screener', 'Screener'], ['sim', 'Simulation'], ['how', 'How to make']] as const

// Example prompts in the "How to make" window — click one to start building.
// Grouped so people see the RANGE: a famous playbook, a rules screen, a
// pattern/breakout play, and a Member news agent.
const EXAMPLE_GROUPS: { label: string; items: string[] }[] = [
  {
    label: 'Follow a legend',
    items: [
      'Make a Minervini trend-template agent',
      'Build a CAN SLIM agent like O’Neil',
      'Buy what Warren Buffett would — cheap, quality, low debt',
    ],
  },
  {
    label: 'Build your own rules',
    items: [
      'Small-cap tech breaking out to new highs on high volume',
      'Profitable dividend stocks with low debt and rising earnings',
      'Growth stocks with EPS up 25%+ and revenue up 20%+',
    ],
  },
  ...(NEWS_ENABLED ? [{
    label: 'Add an AI news check',
    items: [
      'Buy strong tech, but skip any stock with bad news',
      'Watch the news on my holdings and alert me if something breaks',
    ],
  }] : []),
]

// Percents keep one decimal (12.5% stays 12.5 — rounding it to 13 changed real sizing);
// counts (max holdings) use clampInt.
const clamp = (n: number | undefined, lo: number, hi: number, fallback: number) =>
  n == null || !Number.isFinite(n) ? fallback : Math.min(hi, Math.max(lo, Math.round(n * 10) / 10))
const clampInt = (n: number | undefined, lo: number, hi: number, fallback: number) =>
  n == null || !Number.isFinite(n) ? fallback : Math.min(hi, Math.max(lo, Math.round(n)))

function normalize(spec: BuilderSpec) {
  const freq = spec.run_interval_minutes ?? 240
  return {
    name: (spec.name || 'My agent').slice(0, 80),
    persona: spec.persona || '',
    buy_rules: (spec.buy_rules || '').trim(),
    sell_rules: (spec.sell_rules || '').trim(),
    watchlist: (spec.watchlist || []).map((t) => t.toUpperCase()),
    max_position_pct: clamp(spec.max_position_pct, 1, 100, 20),
    stop_loss_pct: clamp(spec.stop_loss_pct, 0, 50, 10),
    max_positions: spec.max_positions ? clampInt(spec.max_positions, 1, 50, 5) : 5,
    profit_target_pct: spec.profit_target_pct ? clamp(spec.profit_target_pct, 1, 500, 25) : 0,
    exit_on_screen_exit: !!spec.exit_on_screen_exit,
    screen: Array.isArray(spec.screen) ? spec.screen : [],
    run_interval_minutes: ALLOWED_FREQ.includes(freq) ? freq : 240,
    subagents: Array.isArray(spec.subagents) ? spec.subagents : [],
  }
}

// The builder is stateless server-side (it rebuilds the spec from history each turn),
// but the small model occasionally drops a field for one turn (e.g. filters=null).
// Merge each update over the last so accumulated selections never flicker away — only
// overwrite a field when the new value is actually present.
function mergeSpecs(prev: BuilderSpec | null, next: BuilderSpec | null | undefined): BuilderSpec {
  const out: BuilderSpec = { ...(prev || {}) }
  const nx = next || {}
  for (const key of Object.keys(nx) as (keyof BuilderSpec)[]) {
    const v = nx[key]
    if (v === null || v === undefined) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'string' && v.trim() === '') continue
    ;(out as Record<string, unknown>)[key] = v
  }
  return out
}

// Fingerprint of the parts of a spec that change what Preview/Backtest would
// return. Questions and chitchat leave this unchanged, so finished results
// survive — each wasted backtest re-run burns one of a free user's 30 lifetime runs.
function strategyKey(spec: BuilderSpec | null): string {
  if (!spec) return ''
  const n = normalize(spec)
  return JSON.stringify({
    persona: n.persona,
    watchlist: n.watchlist,
    buy_rules: n.buy_rules,
    sell_rules: n.sell_rules,
    screen: n.screen,
    max_position_pct: n.max_position_pct,
    stop_loss_pct: n.stop_loss_pct,
    max_positions: n.max_positions,
    profit_target_pct: n.profit_target_pct,
    exit_on_screen_exit: n.exit_on_screen_exit,
    subagents: n.subagents,
  })
}

// Turn a saved screen (machine conditions) into readable labels, so an agent LOADED
// for editing shows its rules right away — before the model rephrases them on the
// first edit. The LLM overwrites these with nicer labels as soon as you chat.
const _OP_SYM: Record<string, string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': '=', '!=': '≠', in: 'in', is_true: 'is true', is_false: 'is false' }
function screenToFilters(screen?: BuilderSpec['screen']): string[] {
  if (!screen?.length) return []
  return screen.map((c) => {
    const field = c.field.replace(/_/g, ' ')
    const op = _OP_SYM[c.op] ?? c.op
    if (c.op === 'is_true' || c.op === 'is_false') return `${field} ${op}`
    const val = Array.isArray(c.value) ? c.value.join(', ') : c.value
    return `${field} ${op} ${val ?? ''}`.trim()
  })
}

// A single condition row — green ✓ for buy/screen conditions, red ↓ for sell triggers.
function CheckRow({ text, tone = 'buy', delay = 0, animate = true }: { text: string; tone?: 'buy' | 'sell'; delay?: number; animate?: boolean }) {
  const buy = tone === 'buy'
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[#161618] bg-black/40 px-2.5 py-2 text-[13px] text-foreground leading-snug" style={animate ? { animation: 'aiCheck .34s ease both', animationDelay: `${delay}s` } : undefined}>
      <span className={`mt-px w-4.5 h-4.5 rounded-full grid place-items-center shrink-0 ${buy ? 'bg-primary/15 border border-primary/40' : 'bg-[#ff5000]/12 border border-[#ff5000]/40'}`}>
        {buy
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5 text-primary"><path d="M5 12l4 4L19 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="#ff5000" strokeWidth="3" className="w-2.5 h-2.5"><path d="M12 5v14M19 12l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      <span>{text}</span>
    </div>
  )
}

export default function AgentInterview({ onCreated, onBack, editAgentId, onSaved }: { onCreated: (a: CreatedAgent) => void; onBack?: () => void; editAgentId?: string | null; onSaved?: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: GREETING }])
  const [options, setOptions] = useState<string[]>([])
  const [multiSelect, setMultiSelect] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [range, setRange] = useState<BuilderInput | null>(null)
  const [rangeVal, setRangeVal] = useState(FIRST_RANGE.default ?? FIRST_RANGE.min)
  const [loVal, setLoVal] = useState(FIRST_RANGE.default ?? FIRST_RANGE.min)
  const [hiVal, setHiVal] = useState(FIRST_RANGE.defaultHi ?? FIRST_RANGE.max)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [spec, setSpec] = useState<BuilderSpec | null>(null)
  const [ready, setReady] = useState(false)
  const [matches, setMatches] = useState<number | null>(null)
  const [universe, setUniverse] = useState<number | null>(null)
  const [matchedTickers, setMatchedTickers] = useState<string[] | null>(null)

  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewErr, setPreviewErr] = useState('')
  const [backtest, setBacktest] = useState<BacktestResult | null>(null)
  const [backtesting, setBacktesting] = useState(false)
  const [backtestErr, setBacktestErr] = useState('')
  const [backtestRuns, setBacktestRuns] = useState<BacktestRun[]>([])
  const [deploying, setDeploying] = useState(false)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'screener' | 'agent' | 'sim' | 'how'>('agent')
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [feedbackErr, setFeedbackErr] = useState('')
  const [versions, setVersions] = useState<BuilderVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [restored, setRestored] = useState(false)   // a draft was recovered this session
  const restoredRef = useRef(false)
  // Bumped whenever the conversation is replaced (Restore / Start over) — an
  // in-flight reply captured before the bump belongs to the old conversation
  // and must be discarded, not merged over the new one.
  const turnGen = useRef(0)
  // Live spec for async work (poll loops, in-flight replies) — render closures go stale.
  const specRef = useRef<BuilderSpec | null>(null)
  // False once unmounted — the backtest poll loop must stop (no state writes,
  // no zombie network traffic); the pending marker stays so a remount resumes it.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => { specRef.current = spec }, [spec])

  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, preview, previewing, busy])

  // ── Restore an in-progress build on mount (survives refresh / accidental close) ──
  useEffect(() => {
    setVersions(loadVersions())
    if (editAgentId) return   // editing an existing agent — skip draft restore; the load effect below fills it
    const d = loadDraft()
    if (d && d.messages && d.messages.length > 1) {   // more than the greeting = real work
      setMessages(d.messages)
      if (d.spec) setSpec(d.spec)
      if (d.name) { setName(d.name); setNameTouched(true) }
      setReady(!!d.ready)
      if (d.matches != null) {
        setMatches(d.matches)
        setUniverse(d.universe ?? null)
        setMatchedTickers(d.matchedTickers ?? null)
      }
      if (d.options?.length) { setOptions(d.options); setMultiSelect(!!d.multiSelect) }
      if (d.range) {
        setRange(d.range)
        setRangeVal(d.range.default ?? d.range.min)
        setLoVal(d.range.default ?? d.range.min)
        setHiVal(d.range.defaultHi ?? d.range.max)
      }
      setRestored(true)
      restoredRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Autosave the live session on every change (debounced by React batching) ──
  const hasWork = messages.length > 1 || !!(spec && (spec.screen?.length || spec.persona))
  useEffect(() => {
    if (hasWork && !editAgentId) saveDraft({ messages, spec, name, ready, matches, universe, matchedTickers, options, multiSelect, range })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, spec, name, ready, matches, universe, matchedTickers, options, multiSelect, range])

  // ── Snapshot a recoverable version whenever the STRATEGY changes ──
  const lastVersionKey = useRef('')
  useEffect(() => {
    if (!spec || editAgentId) return   // no local version history while editing a saved agent
    const key = strategyKey(spec)
    if (key === '' || key === lastVersionKey.current) return
    // don't snapshot the empty starting spec
    if (!(spec.screen?.length || spec.persona)) return
    lastVersionKey.current = key
    setVersions(pushVersion(spec, name, messages))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec])

  // ── Editing an existing agent: load its saved strategy into the chat so it can be
  // changed by talking; Save then writes back to the SAME agent (not a new one). ──
  useEffect(() => {
    if (!editAgentId) return
    let alive = true
    arena.getMyAgent(editAgentId).then((a) => {
      if (!alive) return
      const loaded: BuilderSpec = {
        name: a.name,
        persona: a.persona || '',
        watchlist: a.watchlist || [],
        screen: a.screen || [],
        filters: screenToFilters(a.screen),
        buy_rules: a.buy_rules || '',
        sell_rules: a.sell_rules || '',
        max_position_pct: a.max_position_pct != null ? Number(a.max_position_pct) : undefined,
        stop_loss_pct: a.stop_loss_pct != null ? Number(a.stop_loss_pct) : undefined,
        max_positions: a.max_positions ?? undefined,
        profit_target_pct: a.profit_target_pct != null ? Number(a.profit_target_pct) : undefined,
        exit_on_screen_exit: !!a.exit_on_screen_exit,
        run_interval_minutes: a.run_interval_minutes ?? undefined,
        subagents: a.subagents || [],
      }
      setSpec(loaded)
      setName(a.name)
      setNameTouched(true)
      setReady(true)
      setMessages([{ role: 'assistant', content:
        `Editing “${a.name}”. Tell me what to change — e.g. “make the stop 8%”, “add a rule”, or “backtest it”. Hit Save changes when you're done.` }])
    }).catch(() => {
      if (alive) setMessages([{ role: 'assistant', content: 'Couldn’t load that agent to edit — go back and try again.' }])
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editAgentId])

  // ── Warn before leaving with unsaved in-progress work ──
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasWork && !deploying) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasWork, deploying])

  const restoreVersion = (v: BuilderVersion) => {
    // An in-flight reply belongs to the pre-restore conversation — void it.
    turnGen.current++
    // Mark the restored strategy as "already snapshotted" BEFORE setting it —
    // otherwise the snapshot effect re-pushes it as a NEW version, the list
    // shifts, and the next Restore click lands on a different entry.
    lastVersionKey.current = strategyKey(v.spec)
    setSpec(v.spec)
    if (v.name) { setName(v.name); setNameTouched(true) }
    setReady(true)
    setShowVersions(false)
    // Preview/backtest/match counts belong to the abandoned strategy — showing
    // them next to the restored rules presents the wrong results as this agent's.
    setPreview(null); setPreviewErr('')
    setBacktest(null); setBacktestErr('')
    setMatches(null); setUniverse(null); setMatchedTickers(null)
    // Restore REPLACES the chat — never appends — so clicking through versions can
    // never stack "Restored…" notes. New snapshots carry their whole conversation;
    // older ones (saved before we stored messages) restore to a single clean line.
    setMessages(
      v.messages && v.messages.length
        ? v.messages
        : [{ role: 'assistant', content: `Restored “${v.name}” — ${v.note}. Keep editing from here.` }],
    )
  }

  const submitFeedback = async () => {
    const t = feedbackText.trim()
    if (!t || feedbackBusy) return
    setFeedbackBusy(true)
    setFeedbackErr('')
    try {
      await arena.sendFeedback(t, 'builder')
      setFeedbackSent(true)
      setFeedbackText('')
      setTimeout(() => { setFeedbackOpen(false); setFeedbackSent(false) }, 1400)
    } catch {
      // keep the text so they can retry
      setFeedbackErr('Couldn’t send — check your connection and try again.')
    } finally {
      setFeedbackBusy(false)
    }
  }

  const startOver = () => {
    if (hasWork && !window.confirm('Start a new agent? Your current draft will be cleared (past versions stay in History).')) return
    // Void any in-flight reply — it would resurrect the old conversation + spec.
    turnGen.current++
    clearDraft()
    setMessages([{ role: 'assistant', content: GREETING }])
    setSpec(null); setName(''); setNameTouched(false); setReady(false)
    setMatches(null); setUniverse(null); setMatchedTickers(null)
    setPreview(null); setBacktest(null); setErr('')
    setPreviewErr(''); setBacktestErr('')
    setOptions([]); setMultiSelect(false); setSelected([]); setRange(null)
    setDraft('')
    setRestored(false)
  }

  const n = spec ? normalize(spec) : null
  const hasSpec = !!(spec && (spec.persona || spec.filters?.length || spec.screen?.length))
  // "Recent backtests" is one shared browser list across every agent. Show only the
  // runs for the agent you're on right now (matched by name) — not other agents'.
  const curName = (name.trim() || spec?.name || '').trim().toLowerCase()
  const shownRuns = curName ? backtestRuns.filter((r) => (r.name || '').trim().toLowerCase() === curName) : backtestRuns

  // Animate ONLY rows that are new or changed this turn. The model rephrases labels
  // freely, which used to remount every row and replay the whole panel's entrance
  // animation on any small edit — now unchanged lines stay perfectly still.
  const prevRowsRef = useRef<Set<string>>(new Set())
  const nextRows = new Set<string>()
  let newRowCount = 0
  const row = (text: string, tone: 'buy' | 'sell' = 'buy', key?: string | number) => {
    nextRows.add(text)
    const isNew = !prevRowsRef.current.has(text)
    return <CheckRow key={key ?? text} text={text} tone={tone} animate={isNew} delay={isNew ? Math.min(newRowCount++, 8) * 0.05 : 0} />
  }
  useEffect(() => { prevRowsRef.current = nextRows })
  const initials = ((name.trim() || spec?.name || 'New Agent').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join(''))

  // The right panel renders the agent as the 5-part ANATOMY of a trading system —
  // always all 5, so the person sees what a complete system needs:
  // 1 Pre-screen (rules) → 2 AI checks (post-screen) → 3 Watchlist → 4 Buy rules + sizing → 5 Sell rules.
  const sellItems: string[] = []
  if (n) {
    if (n.stop_loss_pct > 0) sellItems.push(`Stop loss at −${n.stop_loss_pct}%`)
    if (n.profit_target_pct > 0) sellItems.push(`Take profit at +${n.profit_target_pct}%`)
    if (n.exit_on_screen_exit) sellItems.push('Sell if it drops out of the screen')
  }
  const stages: { title: string; note?: string; body: ReactNode }[] = []
  if (n) {
    const preBuyChecks = n.subagents.filter((s) => s.checkpoint === 'before_buy')
    const holdWatches = n.subagents.filter((s) => s.checkpoint === 'while_holding')
    const preSellChecks = n.subagents.filter((s) => s.checkpoint === 'before_sell')
    const clip = (t: string) => (t.length > 110 ? `${t.slice(0, 110)}…` : t)

    // 1 — PRE-SCREEN: the rule-based quality checks (the strategy itself)
    stages.push({
      title: 'Pre-screen', note: spec?.filters?.length ? 'rules · all must pass' : undefined,
      body: spec?.filters?.length ? (
        <div className="space-y-1.5">
          {spec.filters.map((f, i) => row(f, 'buy', `${f}-${i}`))}
        </div>
      ) : (
        <div className="text-[13px] text-text-dim leading-snug">Without this I don&apos;t know which stocks to even look at — tell me your quality rules</div>
      ),
    })

    // 2 — POST-SCREEN: AI judgment on the few survivors (Member). Off for now.
    if (NEWS_ENABLED) stages.push({
      title: 'AI checks', note: 'Member',
      body: preBuyChecks.length ? (
        <div className="space-y-1.5">
          {preBuyChecks.map((s, i) => row(`Before every buy: ${clip(s.instruction)}`, 'buy', i))}
        </div>
      ) : (
        <div className="text-[13px] text-text-dim leading-snug">Without this I can&apos;t read the news — I may buy right into a bad headline (Member adds this)</div>
      ),
    })

    // 3 — WATCHLIST: what passes right now + any AI watch on holdings
    stages.push({
      title: 'Watchlist',
      note: matches != null ? `${matches} match${matches === 1 ? '' : 'es'} now${universe ? ` of ${universe}` : ''}` : undefined,
      body: (
        <div className="space-y-1.5">
          {n.watchlist.length ? (
            <div className="text-[13px] text-text-secondary leading-snug">Watches <span className="text-foreground font-medium">{n.watchlist.join(', ')}</span></div>
          ) : matchedTickers?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {matchedTickers.map((t) => (
                <span key={t} className="font-mono text-[11.5px] font-semibold text-foreground bg-muted/70 border border-border-subtle rounded-md px-1.5 py-0.5">{t}</span>
              ))}
              {matches != null && matches > matchedTickers.length && (
                <span className="text-[11.5px] text-text-dim self-center">+{matches - matchedTickers.length} more</span>
              )}
            </div>
          ) : (
            <div className="text-[13px] text-text-dim leading-snug">Empty — I have nothing to watch until the pre-screen picks stocks</div>
          )}
          {NEWS_ENABLED && holdWatches.map((s, i) => row(`While holding: ${clip(s.instruction)}`, 'buy', `w-${i}`))}
        </div>
      ),
    })

    // 4 — BUY RULES + SIZING: when to buy, and how much
    stages.push({
      title: 'Buy rules + sizing',
      body: (
        <div className="space-y-1.5">
          {spec?.entry_rules?.length
            ? spec.entry_rules.map((r, i) => row(r, 'buy', `${r}-${i}`))
            : <div className="text-[13px] text-text-secondary leading-snug">Buys the best-ranked passers first</div>}
          <div className="text-[13px] text-text-secondary leading-snug">
            Up to <span className="text-foreground font-medium">{n.max_position_pct}%</span> per stock · at most <span className="text-foreground font-medium">{n.max_positions}</span> holding{n.max_positions === 1 ? '' : 's'}
          </div>
        </div>
      ),
    })

    // 5 — SELL RULES: the exits
    stages.push({
      title: 'Sell rules',
      note: sellItems.length > 1 ? 'any one sells' : undefined,
      body: (sellItems.length || preSellChecks.length) ? (
        <div className="space-y-1.5">
          {sellItems.map((s, i) => row(s, 'sell', i))}
          {preSellChecks.map((s, i) => row(`Before selling: ${clip(s.instruction)}`, 'sell', `ps-${i}`))}
        </div>
      ) : (
        <div className="text-[13px] text-text-dim leading-snug">Without this I don&apos;t know when to sell — I&apos;d hold losers forever. Add a stop-loss or target</div>
      ),
    })

    if (n.persona) {
      stages.push({ title: 'Custom logic', body: <p className="text-[13px] text-text-secondary leading-relaxed">{n.persona}</p> })
    }
  }

  // "test it" / "backtest" in the chat → actually run it here + report back.
  // Anchored: only fires when the whole message IS the command — "add a P/E
  // filter before you test it" must go to the LLM, not start a run.
  const BACKTEST_RE = /^\s*(please\s+)?(run\s+(a\s+)?(back\s*test|test)|back\s*test(\s*(it|this))?|test\s+(it|this))\s*[.!]*\s*$/i
  const summarizeBacktest = (r: BacktestResult): string => {
    const m = r.metrics
    const ret = Number(m.total_return_pct)
    const dir = ret >= 0 ? 'gained' : 'lost'
    const vsMkt = m.market_return_pct != null
      ? ` The market (S&P 500) did ${m.market_return_pct >= 0 ? '+' : ''}${m.market_return_pct}% over the same period — your agent ${ret >= m.market_return_pct ? 'BEAT it' : 'trailed it'}.`
      : ''
    return `Backtest done — 5 years across the market. It ${dir} ${Math.abs(ret)}% total (${m.cagr_pct}%/yr), worst drawdown ${m.max_drawdown_pct}%, win rate ${m.win_rate_pct}%, over ${m.num_trades} trades.${vsMkt}`
  }

  const sendText = async (text: string) => {
    const t = text.trim()
    if (!t || busy) return
    // Capture the conversation generation — if Restore/New bumps it while we
    // await, the reply belongs to the old conversation and is discarded.
    const gen = turnGen.current
    const next: ChatMessage[] = [...messages, { role: 'user', content: t }]
    setMessages(next)
    setDraft('')
    setOptions([])
    setMultiSelect(false)
    setSelected([])
    setRange(null)
    setBusy(true)
    setErr('')

    // Backtest request → run it right here, show the result in the chat, then let
    // them ask "why is it bad?" (the metrics travel to the chat for suggestions).
    if (BACKTEST_RE.test(t) && !!spec?.screen?.length) {
      if (backtesting) {
        setMessages((m) => [...m, { role: 'assistant', content: 'A backtest is already running — one moment.' }])
        setBusy(false)
        return
      }
      setMessages((m) => [...m, { role: 'assistant', content: 'Running a 5-year backtest across the market — one moment…' }])
      setTab('sim')
      try {
        const result = await runBacktest()
        if (turnGen.current === gen) {
          setMessages((m) => [...m, {
            role: 'assistant',
            content: result
              ? `${summarizeBacktest(result)}\n\nWant to know why it performed this way, or how to improve it? Just ask.`
              : 'The backtest couldn’t finish just now — try again in a moment.',
          }])
        }
      } finally {
        setBusy(false)
      }
      return
    }

    const started = Date.now()
    try {
      const res = await arena.builderChat(next, spec?.screen, backtest?.metrics)
      // Playbook loads are instant (no LLM); hold a beat so it reads as real work.
      const remain = 2200 - (Date.now() - started)
      if (remain > 0) await new Promise((r) => setTimeout(r, remain))
      // The conversation was restored/reset while we waited — drop this reply.
      if (turnGen.current !== gen) return
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }])
      setOptions(res.options || [])
      setMultiSelect(!!res.multi_select)
      setRange(res.input || null)
      if (res.input) {
        setRangeVal(res.input.default ?? res.input.min)
        setLoVal(res.input.default ?? res.input.min)
        setHiVal(res.input.defaultHi ?? res.input.max)
      }
      const before = strategyKey(specRef.current)
      let merged = mergeSpecs(specRef.current, res.spec)
      // The backend rebuilds screen + subagents from scratch on every build turn,
      // so an empty array there is a real removal — it must REPLACE the old value,
      // not be skipped by the merge (otherwise "remove the news check" never sticks).
      if (res.intent === 'build') {
        merged = {
          ...merged,
          screen: res.spec?.screen ?? merged.screen,
          subagents: res.spec?.subagents ?? merged.subagents,
        }
      }
      setSpec(merged)
      // Invalidate Preview/Backtest only when the strategy actually changed.
      // res.intent ('question'/'chitchat') hints at no change, but the spec diff
      // is the source of truth — questions keep finished results on screen.
      if (before !== strategyKey(merged)) {
        setPreview(null)
        setPreviewErr('')
        setBacktest(null)
        setBacktestErr('')
      }
      if (res.matches != null) { setMatches(res.matches); setUniverse(res.universe ?? null); setMatchedTickers(res.matched_tickers ?? null) }
      // Gate readiness on the MERGED spec — a sparse turn (model dropped a field)
      // must not grey out Create & deploy while the panel still shows a full agent.
      setReady(!!res.ready && !!(merged.persona || merged.screen?.length))
    } catch (e) {
      if (turnGen.current !== gen) return
      setMessages((m) => [...m, { role: 'assistant', content: 'Sorry — something went wrong on my end. Try that again in a moment.' }])
      if (e instanceof Error && e.message) setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const submitMulti = () => { if (selected.length) sendText(selected.join(', ')) }

  const runPreview = async () => {
    if (!spec) return
    const s = normalize(spec)
    if (!s.persona && !s.screen.length) return
    setPreviewing(true)
    setPreviewErr('')
    setPreview(null)
    try {
      setPreview(await arena.preview({
        persona: s.persona || undefined, watchlist: s.watchlist.length ? s.watchlist : undefined,
        buy_rules: s.buy_rules || undefined, sell_rules: s.sell_rules || undefined,
        max_position_pct: s.max_position_pct, stop_loss_pct: s.stop_loss_pct, max_positions: s.max_positions,
        screen: s.screen.length ? s.screen : undefined,
        profit_target_pct: s.profit_target_pct || undefined, exit_on_screen_exit: s.exit_on_screen_exit,
        subagents: s.subagents.length ? s.subagents : undefined,
      }))
    } catch (e) {
      setPreviewErr(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setPreviewing(false)
    }
  }

  // Poll a running backtest job to completion; save the result to history so it's
  // there after leaving. Shared by a fresh run and by resume-on-mount.
  // Returns null if the component unmounted mid-run — the pending marker is kept
  // so the next mount resumes the same job.
  const pollToDone = async (jobId: string, label: string): Promise<BacktestResult | null> => {
    const POLL_MS = 4000
    const MAX_POLLS = 600 // ~40 min ceiling
    const MAX_MISSES = 5  // consecutive failed polls tolerated (wifi blip, 429, 500)
    let misses = 0
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      if (!aliveRef.current) return null // unmounted — stop quietly, resume on next mount
      let j
      try {
        j = await arena.pollBacktest(jobId)
        misses = 0
      } catch (e) {
        // Only a true 404 means the job is gone. Anything else (network blip,
        // 429, 500) is transient — keep polling, and keep the pending marker so
        // a reload can still reattach to the running job.
        if (e instanceof Error && e.message === 'Not found') {
          clearPendingBacktest()
          throw new Error('Backtest not found — it may have expired; run it again.')
        }
        misses++
        if (misses >= MAX_MISSES) throw new Error('Lost connection to the backtest — it’s still running; reload to pick it back up.')
        continue
      }
      if (!aliveRef.current) return null
      if (j.status === 'done') {
        const result = { metrics: j.metrics, equity_curve: j.equity_curve, trades: j.trades } as BacktestResult
        clearPendingBacktest()
        setBacktest(result)
        setBacktestRuns(saveBacktestRun(label, specRef.current, result, jobId))
        return result
      }
      if (j.status === 'error') { clearPendingBacktest(); throw new Error(j.error || 'Backtest failed — please try again.') }
    }
    throw new Error('Backtest is taking unusually long — check back later.')
  }

  const runBacktest = async (): Promise<BacktestResult | null> => {
    if (!spec || backtesting) return null
    const s = normalize(spec)
    if (!s.screen.length) { setBacktestErr('Backtest needs a screen — keep chatting to build one.'); return null }
    setBacktesting(true)
    setBacktestErr('')
    setBacktest(null)
    const label = name.trim() || s.name
    try {
      const { job_id } = await arena.startBacktest({
        screen: s.screen,
        max_position_pct: s.max_position_pct, stop_loss_pct: s.stop_loss_pct, max_positions: s.max_positions,
        profit_target_pct: s.profit_target_pct || undefined, exit_on_screen_exit: s.exit_on_screen_exit,
      })
      savePendingBacktest({ jobId: job_id, at: Date.now(), name: label })
      return await pollToDone(job_id, label)
    } catch (e) {
      setBacktestErr(e instanceof Error ? e.message : 'Backtest failed')
      return null
    } finally {
      setBacktesting(false)
    }
  }

  // Resume a backtest that was running when the user left, and load recent runs.
  useEffect(() => {
    setBacktestRuns(loadBacktestRuns())
    const p = loadPendingBacktest()
    if (p) {
      setBacktesting(true)
      pollToDone(p.jobId, p.name)
        .catch((e) => setBacktestErr(e instanceof Error ? e.message : 'Backtest failed'))
        .finally(() => setBacktesting(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const deploy = async () => {
    if (!spec) return
    const s = normalize(spec)
    if (!s.persona && !s.screen.length) { setErr('Keep chatting — the agent needs a screen first.'); return }
    setDeploying(true)
    setErr('')
    try {
      if (editAgentId) {
        // Save changes back to the SAME agent — keeps its deploy state, history & key.
        await arena.updateAgent(editAgentId, {
          name: name.trim() || s.name, persona: s.persona || undefined, watchlist: s.watchlist,
          buy_rules: s.buy_rules || undefined, sell_rules: s.sell_rules || undefined,
          max_position_pct: s.max_position_pct, stop_loss_pct: s.stop_loss_pct,
          max_positions: s.max_positions, run_interval_minutes: s.run_interval_minutes,
          screen: s.screen.length ? s.screen : undefined,
          profit_target_pct: s.profit_target_pct || undefined, exit_on_screen_exit: s.exit_on_screen_exit,
          subagents: s.subagents.length ? s.subagents : undefined,
        })
        onSaved?.()
        return
      }
      const agent = await arena.createAgent({
        name: name.trim() || s.name, persona: s.persona || undefined, watchlist: s.watchlist.length ? s.watchlist : undefined,
        is_deployed: true,
        buy_rules: s.buy_rules || undefined, sell_rules: s.sell_rules || undefined,
        max_position_pct: s.max_position_pct, stop_loss_pct: s.stop_loss_pct,
        max_positions: s.max_positions, run_interval_minutes: s.run_interval_minutes,
        screen: s.screen.length ? s.screen : undefined,
        profit_target_pct: s.profit_target_pct || undefined, exit_on_screen_exit: s.exit_on_screen_exit,
        subagents: s.subagents.length ? s.subagents : undefined,
      })
      clearDraft()   // it's saved on the server now — the local draft can go
      onCreated(agent)
    } catch (e) {
      setErr(e instanceof Error ? e.message : (editAgentId ? 'Failed to save changes' : 'Failed to create agent'))
    } finally {
      setDeploying(false)
    }
  }

  // ── slider helpers (labeled stops like market cap, or a raw number like P/E) ──
  const stops = range?.stops
  const last = stops ? stops.length - 1 : 0
  const sliderMax = range ? (stops ? last : range.max) : 0
  const sliderMin = range ? (stops ? 0 : range.min) : 0
  const sliderStep = stops ? 1 : (range?.step ?? 1)
  const fmtNum = (v: number) => (v === 0 && stops ? 'Any' : `${range?.unit ? '$' : ''}${v}${range?.unit ?? ''}`)
  const rangeDisp = !range ? '' : stops ? (stops[rangeVal] ?? '') : fmtNum(rangeVal)
  const minLabel = !range ? '' : stops ? stops[0] : fmtNum(range.min)
  const maxLabel = !range ? '' : stops ? `${stops[last]}` : fmtNum(range.max)
  const submitRange = () => {
    if (!range) return
    const picked = stops ? stops[rangeVal] : (rangeVal === 0 ? 'Any' : `${range.unit ? '$' : ''}${rangeVal}${range.unit ?? ''}`)
    sendText(/^any/i.test(picked) ? 'Any' : `${range.label}: ${picked}`)
  }
  const dualText = (lo: number, hi: number): string => {
    if (!stops) return ''
    if (lo <= 0 && hi >= last) return 'Any size'
    if (lo <= 0) return `Up to ${stops[hi]}`
    if (hi >= last) return `${stops[lo]} and up`
    return `${stops[lo]} – ${stops[hi]}`
  }
  const submitDual = () => {
    if (!range) return
    const txt = dualText(loVal, hiVal)
    sendText(txt === 'Any size' ? 'Any size' : `${range.label}: ${txt}`)
  }

  return (
    <div className="bg-black text-foreground">
      <style>{`@keyframes aiMsg{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes aiDot{0%,80%,100%{opacity:.25}40%{opacity:1}}@keyframes aiCheck{from{opacity:0;transform:translateX(-7px)}to{opacity:1;transform:none}}`}</style>

      {/* ── studio top bar ── */}
      <div className="flex items-center gap-3 h-14 pl-10 sm:pl-16 lg:pl-24 pr-4 sm:pr-6 border-b border-[#161618]">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="w-8 h-8 -ml-1 rounded-lg grid place-items-center text-[#a6acb6] hover:text-foreground hover:bg-white/5 transition-colors cursor-pointer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <input value={name || (nameTouched ? '' : spec?.name || '')} onChange={(e) => { setNameTouched(true); setName(e.target.value) }} placeholder="New agent" maxLength={80}
            className="min-w-0 max-w-65 bg-transparent font-display font-bold text-[16.5px] text-foreground placeholder:text-[#a6acb6] focus:outline-none truncate" />
          <span className="hidden md:inline text-[11px] text-[#5a6472]">· autosaved</span>
        </div>

        {/* History — recover an earlier version */}
        <div className="relative">
          <button onClick={() => setShowVersions((v) => !v)} disabled={!versions.length}
            className="px-2.5 py-1.5 rounded-lg text-[13px] font-semibold text-[#a6acb6] hover:text-foreground hover:bg-white/5 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4"><path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="9" /></svg>
            History{versions.length ? ` (${versions.length})` : ''}
          </button>
          {showVersions && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setShowVersions(false)} />
              <div className="absolute right-0 top-11 z-30 w-80 max-h-96 overflow-y-auto rounded-xl border border-[#26262a] bg-[#0d0d0f] shadow-2xl p-1.5">
                <div className="flex items-center justify-between px-2.5 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6b7280]">Version history</span>
                  {versions.length > 0 && (
                    <button
                      onClick={() => {
                        if (!window.confirm('Delete all saved versions? This can’t be undone.')) return
                        clearVersions()
                        setVersions([])
                        setShowVersions(false)
                      }}
                      className="text-[11px] font-semibold text-[#a6acb6] hover:text-loss cursor-pointer transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                {versions.map((v) => (
                  <button key={v.id} onClick={() => restoreVersion(v)}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors">
                    <div className="text-[13px] font-medium text-foreground truncate">{v.name}</div>
                    <div className="text-[11.5px] text-[#a6acb6]">{v.note}</div>
                    <div className="text-[10.5px] text-[#5a6472]">{new Date(v.at).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* New — start over (confirms if there's a draft) */}
        <button onClick={startOver}
          className="px-2.5 py-1.5 rounded-lg text-[13px] font-semibold text-[#a6acb6] hover:text-foreground hover:bg-white/5 cursor-pointer transition-colors">
          New
        </button>

        <button onClick={deploy} disabled={deploying || !ready}
          className="px-4 py-1.5 rounded-full bg-primary text-black text-[14px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-hover shadow-[0_0_26px_-8px_rgba(0,200,5,0.8)] transition-all">
          {deploying ? (editAgentId ? 'Saving…' : 'Creating…') : (editAgentId ? 'Save changes' : 'Create & deploy')}
        </button>
      </div>

      {/* recovered-draft banner */}
      {restored && (
        <div className="flex items-center justify-between gap-3 px-10 sm:px-16 lg:px-24 py-2 bg-primary/10 border-b border-primary/20 text-[12.5px] text-primary">
          <span>Recovered your last session — pick up where you left off.</span>
          <button onClick={() => setRestored(false)} className="text-[#a6acb6] hover:text-foreground cursor-pointer">Dismiss</button>
        </div>
      )}

      {/* ── 50/50 split ── */}
      <div className="grid lg:grid-cols-2 h-[calc(100vh-128px)] min-h-125">
        {/* LEFT — chat. Right-padding lives on the inner sections (not the column) so the
            scroll bar hugs the divider instead of floating mid-panel. */}
        <div className="flex flex-col h-full min-h-0 min-w-0 pl-10 sm:pl-16 lg:pl-24">
          <div className="flex-1 min-h-0 overflow-y-auto py-6 space-y-6 pr-10 sm:pr-16 lg:pr-24">
            {messages.map((m, i) => (
              <div key={i} style={{ animation: 'aiMsg .28s ease both' }}>
                {m.role === 'assistant' ? (
                  <div className="max-w-[92%] text-[16.5px] text-foreground leading-relaxed whitespace-pre-wrap">{m.content}</div>
                ) : (
                  <div className="flex justify-end">
                    <div className="rounded-3xl rounded-br-lg bg-[#1c1c20] px-4 py-2.5 text-[16.5px] text-foreground max-w-[80%] whitespace-pre-wrap">{m.content}</div>
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-1.5" aria-label="Thinking">
                {[0, 1, 2].map((d) => <span key={d} className="w-2 h-2 rounded-full bg-[#a6acb6]" style={{ animation: `aiDot 1.2s ${d * 0.16}s infinite ease-in-out` }} />)}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="pb-5 pt-2 space-y-2.5 shrink-0 pr-10 sm:pr-16 lg:pr-24">
            {/* dual-thumb range (e.g. company size) */}
            {!busy && range && range.dual && stops && (
              <div className="rounded-3xl border border-[#26262a] bg-[#0d0d0f] px-5 pt-4 pb-5">
                <div className="flex items-baseline justify-between mb-3">
                  <span className="text-[13.5px] font-semibold text-foreground">{range.label}</span>
                  <span className="font-mono font-bold text-[17px] text-primary tnum">{dualText(loVal, hiVal)}</span>
                </div>
                <div className="range-dual">
                  <div className="rt" />
                  <div className="rt-fill" style={{ left: `${(loVal / last) * 100}%`, width: `${((hiVal - loVal) / last) * 100}%` }} />
                  <input type="range" min={0} max={last} step={1} value={loVal} onChange={(e) => setLoVal(Math.min(Number(e.target.value), hiVal))} aria-label="Smallest company" />
                  <input type="range" min={0} max={last} step={1} value={hiVal} onChange={(e) => setHiVal(Math.max(Number(e.target.value), loVal))} aria-label="Largest company" />
                </div>
                <div className="flex justify-between mt-2 font-mono text-[10px] text-[#6b7280]"><span>{stops[0]}</span><span>{stops[last]}</span></div>
                {range.hint && <div className="mt-2 text-[12px] text-[#a6acb6] leading-snug">{range.hint}</div>}
                <button onClick={submitDual} className="mt-3 px-5 py-2 rounded-full bg-primary text-black text-[13.5px] font-bold cursor-pointer hover:bg-accent-hover transition-colors">Continue</button>
              </div>
            )}

            {/* single-thumb range (e.g. max P/E) */}
            {!busy && range && !range.dual && (
              <div className="rounded-3xl border border-[#26262a] bg-[#0d0d0f] px-5 pt-4 pb-5">
                <div className="flex items-baseline justify-between mb-3">
                  <span className="text-[13.5px] font-semibold text-foreground">{range.label}</span>
                  <span className="font-mono font-bold text-[17px] text-primary tnum">{rangeDisp}</span>
                </div>
                <input type="range" min={sliderMin} max={sliderMax} step={sliderStep} value={rangeVal} onChange={(e) => setRangeVal(Number(e.target.value))} className="w-full accent-primary cursor-pointer" />
                <div className="flex justify-between mt-2 font-mono text-[10px] text-[#6b7280]"><span>{minLabel}</span><span>{maxLabel}</span></div>
                {range.hint && <div className="mt-2 text-[12px] text-[#a6acb6] leading-snug">{range.hint}</div>}
                <button onClick={submitRange} className="mt-3 px-5 py-2 rounded-full bg-primary text-black text-[13.5px] font-bold cursor-pointer hover:bg-accent-hover transition-colors">Continue</button>
              </div>
            )}

            {/* single-select chips — tap to answer */}
            {!busy && !range && options.length > 0 && !multiSelect && (
              <div className="flex flex-wrap gap-2">
                {options.map((o) => (
                  <button key={o} onClick={() => sendText(o)}
                    className="inline-flex items-center px-3.5 py-2 rounded-full text-[13.5px] font-medium border border-[#2b2b30] bg-[#101013] text-[#dfe2e8] hover:border-primary/60 hover:text-white hover:bg-primary/10 transition-all cursor-pointer">
                    {o}
                  </button>
                ))}
              </div>
            )}

            {/* multi-select chips — toggle then Continue */}
            {!busy && !range && options.length > 0 && multiSelect && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap gap-2">
                  {options.map((o) => {
                    const on = selected.includes(o)
                    return (
                      <button key={o} onClick={() => setSelected(on ? selected.filter((x) => x !== o) : [...selected, o])}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13.5px] font-medium border transition-all cursor-pointer ${on ? 'border-primary bg-primary/15 text-white' : 'border-[#2b2b30] bg-[#101013] text-[#dfe2e8] hover:border-primary/60 hover:text-white hover:bg-primary/10'}`}>
                        {o}
                        {on && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" className="w-3.5 h-3.5 text-primary"><path d="M5 12l4 4L19 6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </button>
                    )
                  })}
                </div>
                <div className="text-[12.5px] text-[#a6acb6]">Pick as many as you like, then hit Continue.</div>
              </div>
            )}

            {/* composer — always available for free text / questions */}
            <div className="flex items-center gap-2 rounded-3xl border border-[#26262a] bg-[#0d0d0f] pl-4 pr-2 py-1.5 focus-within:border-primary/50 transition-colors">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); multiSelect && selected.length ? submitMulti() : sendText(draft) } }}
                placeholder={busy ? 'Thinking…' : 'Type your answer, or ask a question…'} disabled={busy}
                className="flex-1 bg-transparent py-2 text-[16.5px] text-foreground placeholder:text-[#a6acb6] focus:outline-none disabled:opacity-60" />
              <button onClick={() => (multiSelect && selected.length ? submitMulti() : sendText(draft))} disabled={busy || (multiSelect ? selected.length === 0 && !draft.trim() : !draft.trim())} aria-label="Send"
                className="w-9 h-9 rounded-full bg-primary text-black grid place-items-center cursor-pointer disabled:opacity-30 shrink-0 transition-opacity">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-4.5 h-4.5"><path d="M12 19V5M6 11l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT — tabbed live panel: Screener · Your agent · Simulation */}
        <aside className="hidden lg:flex flex-col h-full min-h-0 min-w-0 border-l border-white/20 px-6">
          {/* Chrome-style window tabs */}
          <div className="flex items-end justify-between gap-3 h-14 shrink-0 border-b border-[#1e1e22]">
            <div className="flex items-end gap-1 -mb-px">
              {TABS.map(([id, label]) => {
                const active = tab === id
                return (
                  <button key={id} onClick={() => setTab(id)}
                    className={`px-3.5 py-2 text-[12.5px] font-semibold transition-colors cursor-pointer ${active
                      ? 'rounded-t-lg border border-b-0 border-[#1e1e22] bg-[#0d0d0f] text-foreground'
                      : 'rounded-lg mb-1 text-[#a6acb6] hover:text-white hover:bg-white/5'}`}>
                    {label}
                  </button>
                )
              })}
            </div>
            <button onClick={() => { setFeedbackOpen(true); setFeedbackSent(false); setFeedbackErr('') }}
              className="shrink-0 mb-1.5 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/8 px-2.5 py-1.5 text-[12px] font-semibold text-primary hover:bg-primary/15 cursor-pointer transition-colors"
              title="Tell us what's confusing or missing — we're in beta">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Feedback
            </button>
          </div>

          {/* Feedback panel (beta) */}
          {feedbackOpen && (
            <>
              <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setFeedbackOpen(false)} />
              <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(440px,92vw)] rounded-2xl border border-[#26262a] bg-[#0d0d0f] p-5 shadow-2xl">
                <div className="flex items-center justify-between">
                  <div className="font-display font-bold text-[16px] text-foreground">Send feedback</div>
                  <button onClick={() => setFeedbackOpen(false)} className="text-[#a6acb6] hover:text-white cursor-pointer text-[18px] leading-none">×</button>
                </div>
                {feedbackSent ? (
                  <div className="mt-4 text-[14px] text-primary">Thank you — that helps us make it better. 🙏</div>
                ) : (
                  <>
                    <p className="mt-1 text-[12.5px] text-text-secondary">We&apos;re in beta — tell us what&apos;s confusing, broken, or missing. It goes straight to the team.</p>
                    <textarea value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} rows={4} maxLength={4000} autoFocus
                      placeholder="What would make this better?"
                      className="mt-3 w-full rounded-xl border border-[#26262a] bg-black/40 px-3 py-2.5 text-[13.5px] text-foreground placeholder:text-[#6b7280] focus:outline-none focus:border-primary/40 resize-none" />
                    {feedbackErr && <div className="mt-2 text-[12px] text-loss">{feedbackErr}</div>}
                    <div className="mt-3 flex justify-end gap-2">
                      <button onClick={() => setFeedbackOpen(false)} className="px-3.5 py-2 rounded-lg text-[13px] font-medium text-[#a6acb6] hover:text-white cursor-pointer">Cancel</button>
                      <button onClick={submitFeedback} disabled={!feedbackText.trim() || feedbackBusy}
                        className="px-4 py-2 rounded-lg text-[13px] font-bold bg-primary text-black hover:bg-accent-hover cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                        {feedbackBusy ? 'Sending…' : 'Send'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto pb-6 pr-1">
            {tab === 'how' ? (
              <div className="pt-1 space-y-7">
                {/* How to build */}
                <div>
                  <h3 className="font-display font-bold text-[16.5px] text-foreground">How to build an agent</h3>
                  <ol className="mt-3 space-y-2.5">
                    {[
                      ['Describe it', 'Tell me what your agent should do in plain English — no code.'],
                      ['Answer a few questions', 'I ask quick follow-ups, and it takes shape on the right.'],
                      ['Test it', 'Run it in Simulation — on today’s market or years of history.'],
                      ['Deploy', 'Go live on a simulated $100k book and watch it trade.'],
                    ].map(([t, d], i) => (
                      <li key={t} className="flex gap-3">
                        <span className="w-5.5 h-5.5 rounded-full bg-primary/12 border border-primary/30 grid place-items-center font-mono text-[10.5px] font-bold text-primary shrink-0">{i + 1}</span>
                        <span className="text-[13.5px] leading-snug"><span className="font-semibold text-foreground">{t}.</span> <span className="text-text-secondary">{d}</span></span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Try saying — click to start */}
                {EXAMPLE_GROUPS.map((g) => (
                  <div key={g.label}>
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a6acb6] mb-2.5">{g.label}</div>
                    <div className="space-y-2">
                      {g.items.map((e) => (
                        <button key={e} onClick={() => sendText(e)} disabled={busy}
                          className="block w-full text-left rounded-xl border border-[#26262a] bg-[#0d0d0f] px-3.5 py-2.5 text-[13px] text-text-secondary hover:border-primary/40 hover:text-white cursor-pointer disabled:opacity-50 transition-all">
                          “{e}”
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* What your agent can use — the data moat */}
                <div>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a6acb6] mb-2.5">Your agent can screen on</div>
                  <div className="flex flex-wrap gap-1.5">
                    {['Price & volume', 'Valuation (P/E, PEG…)', 'Growth', 'Margins', 'Chart patterns', 'RS rating', 'Trend template', 'Insider & 13F filings', 'Analyst targets', 'Catalysts', 'Dividends', 'Macro'].map((t) => (
                      <span key={t} className="rounded-md border border-[#26262a] bg-[#0d0d0f] px-2 py-1 text-[11px] text-text-secondary">{t}</span>
                    ))}
                  </div>
                  <p className="mt-2.5 text-[11.5px] text-text-dim leading-relaxed">80+ signals across ~5,600 US stocks. Just describe what you want — I map it to the right ones.</p>
                </div>

                {/* Tips */}
                <div className="rounded-xl border border-[#1e1e22] bg-[#0d0d0f] p-3.5">
                  <div className="text-[12px] font-semibold text-foreground mb-1.5">Tips</div>
                  <ul className="space-y-1 text-[12px] text-text-secondary leading-snug">
                    <li>· Be specific with numbers (“P/E under 20”, “EPS growth 25%+”).</li>
                    <li>· You can edit anytime — “make the stop tighter”, “add a news check”.</li>
                    <li>· Ask questions — “what’s RS rating?” — it won’t change your agent.</li>
                  </ul>
                </div>
              </div>
            ) : !hasSpec ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <span className="relative w-16 h-16 rounded-2xl border border-[#26262a] bg-[#0d0d0f] grid place-items-center text-primary mb-4">
                  <span aria-hidden className="absolute -inset-6 rounded-full" style={{ background: 'radial-gradient(circle, rgba(0,200,5,0.18), transparent 70%)', filter: 'blur(14px)' }} />
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="relative w-7 h-7"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" strokeLinejoin="round" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" strokeLinejoin="round" /></svg>
                </span>
                <p className="text-[13.5px] text-text-secondary max-w-56 leading-relaxed">Your agent takes shape here as you chat.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#1e1e22] bg-[#0d0d0f] overflow-hidden shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
                <div className="flex items-center gap-3 p-4 border-b border-[#161618]">
                  <span className="w-11 h-11 rounded-xl bg-primary/12 border border-primary/25 grid place-items-center font-display font-extrabold text-[16.5px] text-primary">{initials}</span>
                  <div className="min-w-0">
                    <div className="font-display font-bold text-[16.5px] text-foreground truncate">{name.trim() || spec?.name || 'New agent'}</div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[#a6acb6]">{ready ? 'Ready to deploy' : 'Building…'}</div>
                  </div>
                </div>

                <div className="p-4">
                  {/* ── SCREENER — what it scans + the conditions that must pass ── */}
                  {tab === 'screener' && n && (
                    <div className="space-y-4">
                      {matches != null && (
                        <div className="flex items-baseline gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
                          <span className="font-mono text-[18px] font-bold text-primary tnum leading-none">{matches}</span>
                          <span className="text-[12.5px] text-text-secondary">stock{matches === 1 ? '' : 's'} match right now{universe ? ` · of ${universe}` : ''}</span>
                        </div>
                      )}
                      <div>
                        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a6acb6] mb-2">Universe</div>
                        <div className="text-[13px] text-text-secondary leading-snug">
                          {n.watchlist.length ? <>Watches <span className="text-foreground font-medium">{n.watchlist.join(', ')}</span></> : n.screen.length ? 'All US stocks that pass the checklist below' : 'Auto-picks stocks to consider'}
                        </div>
                      </div>
                      {!!spec?.filters?.length && (
                        <div>
                          <div className="flex items-baseline gap-1.5 mb-2"><span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a6acb6]">Buy checklist</span><span className="text-[10px] text-[#6b7280]">· all must pass</span></div>
                          <div className="space-y-1.5">{spec.filters.map((f, i) => row(f, 'buy', `${f}-${i}`))}</div>
                        </div>
                      )}
                      {!spec?.filters?.length && !n.watchlist.length && (
                        <div className="text-[13px] text-text-dim leading-snug">This agent decides from its custom logic — see the <button onClick={() => setTab('agent')} className="text-primary hover:underline cursor-pointer">Your agent</button> tab.</div>
                      )}
                    </div>
                  )}

                  {/* ── YOUR AGENT — the full flow, top to bottom ── */}
                  {tab === 'agent' && (
                    <>
                      {n && FREQ_LABEL[n.run_interval_minutes] && (
                        <div className="font-mono text-[10.5px] text-[#a6acb6] mb-4">Runs {FREQ_LABEL[n.run_interval_minutes]}</div>
                      )}
                      <div className="relative">
                        <span className="absolute left-2.75 top-3 bottom-4 w-px bg-[#1e1e22]" aria-hidden />
                        <div className="space-y-5">
                          {stages.map((s, i) => (
                            <div key={s.title} className="relative pl-9">
                              <span className="absolute left-0 top-0 w-5.75 h-5.75 rounded-full bg-[#0d0d0f] border border-primary/35 grid place-items-center font-mono text-[10.5px] font-bold text-primary z-10">{i + 1}</span>
                              <div className="flex items-baseline gap-1.5 mb-2 pt-1">
                                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a6acb6] leading-none">{s.title}</span>
                                {s.note && <span className="text-[10px] text-[#6b7280]">· {s.note}</span>}
                              </div>
                              {s.body}
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* ── SIMULATION — run it on today's market or on history ── */}
                  {tab === 'sim' && (
                    <div className="space-y-4">
                      <div className="text-[13px] text-text-secondary leading-snug">Run it on today’s market (Preview) or on years of history (Backtest) — all simulated on a $100k paper book.</div>
                      {n && (n.persona || n.screen.length > 0) ? (
                        <div className="flex gap-2">
                          <button onClick={runPreview} disabled={previewing} className="flex-1 px-3 py-2.5 rounded-xl border border-[#26262a] text-[13px] font-semibold text-foreground hover:border-primary/40 hover:bg-white/5 cursor-pointer disabled:opacity-50 transition-all">{previewing ? 'Previewing…' : 'Preview trades'}</button>
                          {n.screen.length > 0 && (
                            <button onClick={runBacktest} disabled={backtesting} className="flex-1 px-3 py-2.5 rounded-xl border border-[#26262a] text-[13px] font-semibold text-foreground hover:border-primary/40 hover:bg-white/5 cursor-pointer disabled:opacity-50 transition-all">{backtesting ? 'Testing…' : '📈 Backtest'}</button>
                          )}
                        </div>
                      ) : (
                        <div className="text-[13px] text-text-dim">Keep chatting to build a screen — then you can simulate it.</div>
                      )}
                      {backtesting && (
                        <div className="text-[12px] text-text-dim">Running a 5-year backtest across the market — this takes a few minutes. You can leave; your result will be here when you’re back.</div>
                      )}
                      {(preview || previewing || previewErr) && <PreviewPanel result={preview} loading={previewing} error={previewErr} />}
                      {(backtest || backtesting || backtestErr) && <BacktestPanel result={backtest} loading={backtesting} error={backtestErr} />}

                      {/* Recent backtests — this agent's runs only (the store is shared across agents) */}
                      {shownRuns.length > 0 && (
                        <div className="pt-2">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#6b7280] mb-2">Recent backtests</div>
                          <div className="space-y-1.5">
                            {shownRuns.map((r) => {
                              const ret = r.result?.metrics?.total_return_pct
                              const mkt = r.result?.metrics?.market_return_pct
                              const tone = ret == null ? 'text-text-dim' : ret >= 0 ? 'text-primary' : 'text-loss'
                              const beat = ret != null && mkt != null && ret >= mkt
                              return (
                                <button key={r.id} onClick={() => { setBacktest(r.result); setBacktestErr('') }}
                                  className="w-full flex items-center gap-3 text-left px-3 py-2 rounded-lg border border-[#1e1e22] hover:border-primary/30 hover:bg-white/5 cursor-pointer transition-colors">
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-medium text-foreground truncate">{r.name}</div>
                                    <div className="text-[11px] text-[#6b7280]">{r.note} · {new Date(r.at).toLocaleString()}</div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className={`font-mono text-[13px] font-bold tnum ${tone}`}>
                                      {ret == null ? '—' : `${ret >= 0 ? '+' : ''}${ret}%`}
                                    </div>
                                    {mkt != null && (
                                      <div className="font-mono text-[10px] tnum text-[#6b7280]">
                                        S&amp;P {mkt >= 0 ? '+' : ''}{mkt}% · {beat ? <span className="text-primary">beat</span> : <span className="text-loss">trailed</span>}
                                      </div>
                                    )}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {err && <div className="text-[12px] text-loss mt-4">{err}</div>}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
