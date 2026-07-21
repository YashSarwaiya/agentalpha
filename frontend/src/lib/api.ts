import type {
  BuilderResponse, ChatMessage, ScreenCond, SubagentSpec,
  CreatedAgent, MyAgentDetail, PreviewResult, BacktestResult,
} from '../types/arena'

// Relative by default — the Vite dev server proxies /api to the FastAPI backend
// (see vite.config.ts). Set VITE_API_BASE to hit a remote backend directly.
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

// Auth token singleton. The standalone backend needs no auth, so this stays
// null; kept so the components match production (which sends a user JWT).
let _authToken: string | null = null
export function setAuthToken(token: string | null) { _authToken = token }
export function getAuthToken() { return _authToken }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (_authToken) headers['Authorization'] = `Bearer ${_authToken}`

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  })
  if (!res.ok) {
    if (res.status === 404) throw new Error('Not found')
    if (res.status === 429) {
      let detail = ''
      try { detail = (await res.json())?.detail || '' } catch { /* no body */ }
      throw new Error(detail || 'Too many requests. Please wait.')
    }
    if (res.status >= 500) {
      let detail = ''
      try { detail = (await res.json())?.detail || '' } catch { /* no body */ }
      throw new Error(detail || 'Server error. Please try again.')
    }
    let detail = ''
    try { detail = (await res.json())?.detail || '' } catch { /* no body */ }
    throw new Error(detail || 'Something went wrong')
  }
  return res.json()
}

// The 8 endpoints the chat builder uses — the full client is in the main app.
export const arena = {
  builderChat: (messages: ChatMessage[], screen?: ScreenCond[], backtest?: BacktestResult['metrics']) =>
    request<BuilderResponse>('/v1/agent-builder', { method: 'POST', body: JSON.stringify({ messages, screen, backtest }) }),

  preview: (body: {
    persona?: string; watchlist?: string[]; buy_rules?: string; sell_rules?: string
    max_position_pct?: number; stop_loss_pct?: number; max_positions?: number | null
    screen?: ScreenCond[]; profit_target_pct?: number; exit_on_screen_exit?: boolean
    subagents?: SubagentSpec[]
  }) =>
    request<PreviewResult>('/v1/preview', { method: 'POST', body: JSON.stringify(body) }),

  startBacktest: (body: {
    screen: ScreenCond[]
    max_position_pct?: number; stop_loss_pct?: number; max_positions?: number | null
    profit_target_pct?: number; exit_on_screen_exit?: boolean
  }) => request<{ job_id: string; status: string }>('/v1/backtest', { method: 'POST', body: JSON.stringify(body) }),
  pollBacktest: (jobId: string) =>
    request<{ status: 'queued' | 'running' | 'done' | 'error'; error?: string } & Partial<BacktestResult>>(`/v1/backtest-status/${jobId}`),

  createAgent: (body: {
    name: string; description?: string; avatar_url?: string; subscription_price_usd?: number
    persona?: string; watchlist?: string[]; is_deployed?: boolean; buy_rules?: string; sell_rules?: string
    max_position_pct?: number; stop_loss_pct?: number; max_positions?: number | null; run_interval_minutes?: number
    screen?: ScreenCond[]; profit_target_pct?: number; exit_on_screen_exit?: boolean
    subagents?: SubagentSpec[]
  }) =>
    request<CreatedAgent>('/v1/me/agents', { method: 'POST', body: JSON.stringify(body) }),
  updateAgent: (id: string, body: {
    name?: string
    description?: string; persona?: string; watchlist?: string[]; buy_rules?: string; sell_rules?: string
    avatar_url?: string; subscription_price_usd?: number | null; is_deployed?: boolean; is_public?: boolean
    max_position_pct?: number; stop_loss_pct?: number; max_positions?: number | null; run_interval_minutes?: number
    screen?: ScreenCond[]; profit_target_pct?: number; exit_on_screen_exit?: boolean; subagents?: SubagentSpec[]
  }) =>
    request<{ ok: true; warnings: string[] }>(`/v1/me/agents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  getMyAgent: (id: string) =>
    request<MyAgentDetail>(`/v1/me/agents/${id}`),

  sendFeedback: (message: string, context?: string) =>
    request<{ ok: true }>(`/v1/feedback`, { method: 'POST', body: JSON.stringify({ message, context }) }),
}
