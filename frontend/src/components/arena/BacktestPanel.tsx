import type { BacktestResult } from '../../types/arena'

// The result of the "test" step — replaying the screen over 5 years of point-in-time history.
const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v}%`

function Spark({ curve }: { curve: [string, number][] }) {
  if (curve.length < 2) return null
  const vals = curve.map((p) => p[1])
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const W = 300
  const H = 64
  const pad = 4
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (curve.length - 1)
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad)
  const up = vals[vals.length - 1] >= vals[0]
  const col = up ? '#22e06a' : '#ff5a5f'
  const line = curve.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')
  const area = `${line} L${x(curve.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
      <path d={area} fill={up ? 'rgba(34,224,106,0.15)' : 'rgba(255,90,95,0.13)'} />
      <path d={line} fill="none" stroke={col} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function BacktestPanel({ result, loading, error }: { result: BacktestResult | null; loading: boolean; error: string }) {
  if (loading) return <div className="rounded-xl border border-[#1e1e22] bg-black px-3 py-3 text-[12.5px] text-text-secondary">Replaying 5 years of history across the market…</div>
  if (error) return <div className="rounded-xl border border-loss/30 bg-loss/5 px-3 py-3 text-[12.5px] text-loss">{error}</div>
  if (!result) return null

  const m = result.metrics
  const mkt = m.market_return_pct
  const yearly = m.yearly
  // Drawdown arrives as a positive magnitude — show it as the loss it is (−45%).
  const dd = m.max_drawdown_pct
  const up = m.total_return_pct >= 0
  const beat = mkt != null && m.total_return_pct >= mkt
  // Spell out what the headline % means: a $100k paper book grows to this, over
  // the ACTUAL span of the test (from the equity curve) — so "total" can never be
  // mistaken for a per-year number, which is what confused people.
  const START = 100000
  const endValue = Math.round(START * (1 + m.total_return_pct / 100))
  const money = (v: number) => '$' + v.toLocaleString('en-US')
  const c = result.equity_curve
  const yrs = c.length >= 2
    ? (new Date(c[c.length - 1][0]).getTime() - new Date(c[0][0]).getTime()) / 31557600000
    : 0
  const yearsTxt = yrs >= 0.9 ? `${yrs.toFixed(yrs >= 3 ? 0 : 1)} years` : 'the test period'
  // Secondary stats — plain labels, no finance jargon ("CAGR" / "Max DD" meant nothing to users).
  const cards: [string, string, boolean][] = [
    ['Per year', fmtPct(m.cagr_pct), true],
    ['Worst drop', `${dd > 0 ? '-' : ''}${dd}%`, dd > 0],
    ['Win rate', `${m.win_rate_pct}%`, false],
    ['Trades', String(m.num_trades), false],
  ]

  return (
    <div className="rounded-xl border border-[#1e1e22] bg-black p-3 space-y-3">
      <span className="font-mono text-[9px] uppercase tracking-wider text-[#a6acb6]">Backtest · {yearsTxt} of history · no look-ahead</span>
      {/* Headline: what the total % actually means, in plain words + real dollars */}
      <div className="rounded-lg border border-primary/20 bg-[#0b0c0e] px-3 py-2.5">
        <div className="font-mono text-[9px] uppercase tracking-wide text-[#a6acb6]">Total return · over {yearsTxt}</div>
        <div className="mt-1 flex items-baseline gap-2 flex-wrap">
          <span className={`font-mono text-[24px] font-bold tnum leading-none ${up ? 'text-primary' : 'text-loss'}`}>{fmtPct(m.total_return_pct)}</span>
          <span className="text-[12px] text-text-secondary tnum">{money(START)} → <span className="font-semibold text-foreground">{money(endValue)}</span></span>
        </div>
        <div className="mt-1.5 text-[11px] text-[#8b93a1] leading-snug">
          That&apos;s about <span className="font-semibold text-foreground">{fmtPct(m.cagr_pct)} a year</span>.
          {mkt != null && (
            <> Over the same {yearsTxt}, the S&amp;P 500 did <span className={`font-semibold ${mkt >= 0 ? 'text-foreground' : 'text-loss'}`}>{fmtPct(mkt)}</span> — your agent {beat ? <span className="text-primary font-semibold">beat the market</span> : <span className="text-loss font-semibold">trailed the market</span>}.</>
          )}
        </div>
      </div>
      {/* Year by year — S&P vs the agent, the comparison people actually want */}
      {yearly && yearly.length > 0 && (
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wide text-[#a6acb6] mb-1.5">Year by year</div>
          <div className="rounded-lg border border-[#1e1e22] overflow-hidden">
            <div className="grid grid-cols-3 px-3 py-1.5 bg-[#0b0c0e] border-b border-[#1e1e22] font-mono text-[9px] uppercase tracking-wide text-[#a6acb6]">
              <span>Year</span>
              <span className="text-right">S&amp;P 500</span>
              <span className="text-right">Your agent</span>
            </div>
            {yearly.map((y) => {
              const won = y.agent_pct != null && y.market_pct != null && y.agent_pct >= y.market_pct
              return (
                <div key={y.year} className="grid grid-cols-3 items-center px-3 py-1.5 border-b border-[#141416] last:border-0 font-mono text-[12px] tnum">
                  <span className="text-foreground">{y.year}{y.partial && <span className="ml-1 text-[9px] lowercase text-[#6b7280]">partial</span>}</span>
                  <span className={`text-right ${y.market_pct == null ? 'text-[#6b7280]' : y.market_pct >= 0 ? 'text-text-secondary' : 'text-loss'}`}>
                    {y.market_pct == null ? '—' : fmtPct(y.market_pct)}
                  </span>
                  <span className={`text-right font-bold ${y.agent_pct == null ? 'text-[#6b7280]' : won ? 'text-primary' : y.agent_pct >= 0 ? 'text-foreground' : 'text-loss'}`}>
                    {y.agent_pct == null ? '—' : fmtPct(y.agent_pct)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div className="grid grid-cols-4 gap-1.5">
        {cards.map(([k, v, colored]) => {
          const neg = colored && v.includes('-')
          return (
            <div key={k} className="rounded-lg border border-[#1e1e22] bg-[#0b0c0e] px-1.5 py-1.5 text-center">
              <div className={`font-mono text-[12.5px] font-bold tnum leading-none ${colored ? (neg ? 'text-loss' : 'text-primary') : 'text-foreground'}`}>{v}</div>
              <div className="font-mono text-[8px] uppercase tracking-wide text-[#a6acb6] mt-1">{k}</div>
            </div>
          )
        })}
      </div>
      <Spark curve={result.equity_curve} />
      {result.trades.length > 0 && (
        <div className="space-y-1.5">
          <div className="font-mono text-[9px] uppercase tracking-wide text-[#a6acb6]">
            {m.num_trades > result.trades.length
              ? `Trades · latest ${result.trades.length} shown of ${m.num_trades} (all count in the totals)`
              : `Trades · ${m.num_trades}`}
          </div>
          <div className="max-h-40 overflow-auto rounded-lg border border-[#1e1e22]">
          <table className="w-full text-[11px] font-mono">
            <tbody>
              {result.trades.slice().reverse().map((t, i) => (
                <tr key={i} className="border-b border-[#141416] last:border-0">
                  <td className="px-2 py-1 text-foreground">{t.ticker}</td>
                  <td className="px-2 py-1 text-[#a6acb6]">{t.exit_date}</td>
                  <td className={`px-2 py-1 text-right ${t.pnl_pct >= 0 ? 'text-primary' : 'text-loss'}`}>{fmtPct(t.pnl_pct)}</td>
                  <td className="px-2 py-1 text-[#a6acb6] truncate max-w-[150px]" title={t.reason}>{t.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      <div className="text-[10.5px] text-[#6b7280]">Simulated on past data — not a promise of future results.</div>
    </div>
  )
}
