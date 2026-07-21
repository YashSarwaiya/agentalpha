import { useState } from 'react'
import AgentInterview from './components/arena/AgentInterview'
import type { CreatedAgent } from './types/arena'

/* Standalone mount for the chat builder. In the production app this lives on a
   route behind auth; here it IS the app. When a build finishes, the spec is
   saved by the local backend into local_agents.json and we offer an edit loop. */
export default function App() {
  // Support ?edit=<id> like production, plus in-app editing of a just-created agent.
  const [editId, setEditId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('edit'),
  )
  const [created, setCreated] = useState<CreatedAgent | null>(null)
  const [chatKey, setChatKey] = useState(0)

  if (created) {
    return (
      <div className="min-h-screen bg-black text-foreground flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-card border border-border-subtle rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">✓</div>
          <h1 className="text-xl font-bold font-display mb-2">{created.name} saved</h1>
          <p className="text-sm text-text-secondary mb-6">
            The spec is in <span className="font-mono">backend/local_agents.json</span>.
            In production this is where the agent deploys to a live paper-trading book.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => { setEditId(created.id); setCreated(null); setChatKey(k => k + 1) }}
              className="px-4 py-2 rounded-lg bg-primary text-black font-semibold text-sm hover:bg-accent-hover"
            >
              Edit it in chat
            </button>
            <button
              onClick={() => { setEditId(null); setCreated(null); setChatKey(k => k + 1) }}
              className="px-4 py-2 rounded-lg border border-border text-sm text-text-secondary hover:text-foreground"
            >
              Build another
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <AgentInterview
      key={chatKey}
      editAgentId={editId}
      onCreated={(a) => setCreated(a)}
      onSaved={() => { setEditId(null); setChatKey(k => k + 1) }}
      onBack={() => { setEditId(null); setChatKey(k => k + 1) }}
    />
  )
}
