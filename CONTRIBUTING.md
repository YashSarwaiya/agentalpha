# Contributing

Thanks for helping improve the agent-builder chat. Small, focused PRs merge fast.

## Dev setup

Follow the Quickstart in [README.md](README.md). You need Python 3.11+, Node 20+,
and (optionally) an Anthropic API key — without one, playbook turns
("make a Minervini agent") still exercise the full stack for free.

## Where things live

- **Conversation behavior** → the `_SYSTEM` prompt in `backend/agent_builder.py`.
  This is the product. Small wording changes have big effects — test a few chats
  before and after, and paste transcripts in your PR.
- **The `respond` tool schema** → `_TOOL` in the same file. The frontend types in
  `frontend/src/types/arena.ts` must stay in sync with it.
- **Screen fields** → `FIELD_MAP` in `backend/screen.py` + the FIELDS section of
  the system prompt. Both must change together.
- **Investor playbooks** → `backend/playbooks.py`. New playbooks need a source
  (book/interview/letter) cited in the entry and honest fidelity notes for any
  rule that can't be expressed in available fields.
- **Chat UI** → `frontend/src/components/arena/AgentInterview.tsx`.

## Ground rules

1. **The AI builds, code runs.** Don't add LLM calls to the trade/screen path.
   Judgment belongs in the builder (or a subagent spec) — execution stays
   deterministic.
2. **Never invent capabilities in the prompt.** If the platform can't do a thing,
   the chat must say so in one honest line. That's a hard product rule.
3. **Simple words.** The chat's audience is not traders. Explain any term in ≤6
   words the first time it appears.
4. **Keep turns cheap.** The builder runs on a small model with prompt caching.
   Anything that grows the per-turn token count needs a reason.
5. **Type-checked + parseable.** `npm run build` (tsc + vite) and
   `python -m py_compile backend/*.py` must pass.

## Testing a change

```bash
# backend, no key needed:
cd backend && python - <<'EOF'
import asyncio
from agent_builder import build_turn
print(asyncio.run(build_turn([{"role": "user", "content": "make a minervini agent"}]))["reply"])
EOF

# frontend:
cd frontend && npm run build
```

For prompt changes, run a handful of real chats (an API key + a few cents) and
include before/after transcripts in the PR description.

## Reporting bugs

Open an issue with: what you typed, what the chat replied, what you expected.
The sample universe is seeded, so screen counts are reproducible — include them.
