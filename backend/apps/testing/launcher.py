"""Wires the live outcome resolver for P12 to the agent stack.

The default resolver reconstructs an outcome from the recorded P9 log (data
only). This wires a resolver that reads the *live* session object for a recorded
session id, so a case can assert against the session's real cost, status, tools,
and final text, not just the replay reconstruction. agent_manager is imported at
fire-time, never at module load, keeping testing a leaf.
"""

from __future__ import annotations

import logging
from typing import Any

from backend.apps.testing.runner import set_runner, outcome_from_records
from backend.apps.testing.assertions import extract_outcome
from backend.apps.replay import store as replay_store

logger = logging.getLogger(__name__)


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                parts.append(block["text"])
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts)
    return "" if content is None else str(content)


def _outcome_from_session(session) -> dict:
    msgs = list(getattr(session, "messages", []) or [])
    assistant = [m for m in msgs if getattr(m, "role", "") == "assistant"]
    final_text = _text_of(assistant[-1].content) if assistant else ""
    tools_used = list((getattr(session, "tool_latencies", {}) or {}).keys())
    return extract_outcome({
        "final_text": final_text,
        "tools_used": tools_used,
        "status": getattr(session, "status", "") or "",
        "error": None if getattr(session, "status", "") != "error" else "session ended in error",
        "cost_usd": float(getattr(session, "cost_usd", 0.0) or 0.0),
        "turns": len(assistant),
    })


def _live_runner(case: dict) -> dict:
    """Prefer the live session's real outcome; fall back to replay reconstruction
    if the session isn't resident (e.g. the recording outlived its session)."""
    from backend.apps.agents.agent_manager import agent_manager

    sid = case.get("replay_session_id")
    if sid:
        session = agent_manager.get_session(sid)
        if session is not None:
            return _outcome_from_session(session)
        records = replay_store.read_records(sid)
        if records:
            return outcome_from_records(records)
    raise ValueError("no live session and no replay log for this case")


def wire() -> None:
    set_runner(_live_runner)
