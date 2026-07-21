'use client'

import type { PreviewResult } from '../../types/arena'

const money = (n: number | undefined) =>
  n === undefined ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

export default function PreviewPanel({
  result,
  loading,
  error,
}: {
  result: PreviewResult | null
  loading: boolean
  error: string
}) {
  if (loading) {
    return (
      <div className="bg-card border border-border-subtle rounded-lg p-4 text-[13px] text-text-secondary">
        Running your agent against live market data… this takes a few seconds.
      </div>
    )
  }
  if (error) {
    return <div className="bg-card border border-loss/40 rounded-lg p-4 text-[13px] text-loss">{error}</div>
  }
  if (!result) return null

  const { reasoning_steps, orders, warnings, summary } = result

  return (
    <div className="bg-card border border-border-subtle rounded-lg p-4 space-y-3">
      <div className="text-[13px] font-semibold text-foreground">Preview — what it would do right now</div>

      {warnings.map((w, i) => (
        <div key={i} className="text-[12px] text-loss bg-loss/5 border border-loss/20 rounded-md px-2.5 py-1.5">{w}</div>
      ))}

      {orders.length === 0 ? (
        <div className="text-[13px] text-text-secondary">No trades — the agent decided to hold this cycle.</div>
      ) : (
        <div className="space-y-2">
          {orders.map((o, i) => (
            <div key={i} className="rounded-md border border-border bg-background px-3 py-2">
              <div className="flex items-center gap-2 text-[13px]">
                <span className={`font-bold ${o.action === 'BUY' ? 'text-gain' : 'text-loss'}`}>{o.action}</span>
                <span className="font-semibold text-foreground">{o.quantity} {o.ticker}</span>
                <span className="text-text-dim">·</span>
                <span className="text-text-secondary">est. {money(o.would_fill_price ?? o.price ?? undefined)}</span>
                {o.would_notional !== undefined && (
                  <span className="text-text-dim">({money(o.would_notional)})</span>
                )}
                {o.capped && (
                  <span className="ml-auto text-[10px] font-semibold text-text-dim border border-border rounded px-1.5 py-0.5">
                    capped to limit
                  </span>
                )}
              </div>
              {o.reason && <div className="text-[12px] text-text-secondary mt-1">{o.reason}</div>}
            </div>
          ))}
        </div>
      )}

      {summary && <div className="text-[12px] text-text-secondary">{summary}</div>}

      {reasoning_steps.length > 0 && (
        <details className="text-[12px] text-text-secondary">
          <summary className="cursor-pointer text-text-dim hover:text-foreground">Show reasoning</summary>
          <div className="mt-2 space-y-1.5">
            {reasoning_steps.map((s, i) => (
              <p key={i} className="leading-relaxed">{s}</p>
            ))}
          </div>
        </details>
      )}

      <div className="text-[11px] text-text-dim">
        Indicative only — live prices move, so a deployed run may differ. Nothing was traded or saved.
      </div>
    </div>
  )
}
