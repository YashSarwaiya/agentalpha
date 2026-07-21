"""Minimal settings for the open-source agent-builder chat.

Everything is optional except ANTHROPIC_API_KEY — and even without it the chat
still works in playbooks-only mode ("make a Minervini agent" loads a curated
checklist deterministically, no LLM call).
"""

import os
import logging

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)


class Settings:
    # The only key the chat needs. Get one at https://console.anthropic.com
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")

    # Optional Postgres with a `stocks` table (see README → "Bring your own data").
    # When unset, the screener runs against the bundled synthetic sample universe.
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")

    # The builder is guided form-filling with structured tool-use — a small, fast
    # model is the right fit. Override with BUILDER_MODEL if you want to experiment.
    MODEL_HAIKU: str = os.getenv("BUILDER_MODEL", "claude-haiku-4-5-20251001")

    # News-reading subagents (the "AI checks" part of the spec). Off by default —
    # the chat then never offers them. Must match NEWS_ENABLED in AgentInterview.tsx.
    NEWS_AGENTS_ENABLED: bool = os.getenv("NEWS_AGENTS_ENABLED", "0") in ("1", "true", "True")

    # Everyone is a "member" in the open-source build (no plans/billing here).
    BETA_MODE: bool = os.getenv("BETA_MODE", "1") not in ("0", "false", "False", "")

    def __init__(self):
        if not self.ANTHROPIC_API_KEY:
            logger.warning(
                "ANTHROPIC_API_KEY not set — the chat runs in playbooks-only mode "
                "(try: 'make a Minervini agent')."
            )


settings = Settings()
