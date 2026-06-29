"""Outcome resolution for P12: turn a recorded session into a comparable outcome.

Two paths, both behind one `resolve_outcome(case)` seam:

  - Default (no agent stack): reconstruct the outcome from the case's recorded
    P9 replay log. This is pure data, so a suite runs out of the box against any
    recorded session, and `outcome_from_records` is unit-testable.
  - Injected (`set_runner`): the agent stack wires a real re-runner that replays
    the log through the live model+tools against current code. THAT is a true
    regression test (recorded inputs, fresh behavior). Wired at boot via a
    launcher, lazy-importing agent_manager, exactly like the other phases.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

from backend.apps.replay import store as replay_store
from backend.apps.testing.assertions import extract_outcome

logger = logging.getLogger(__name__)


def _text_of(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for k in ("text", "content", "output", "final_text"):
            if isinstance(value.get(k), str):
                return value[k]
    return "" if value is None else str(value)


def outcome_from_records(records: list[dict]) -> dict:
    """Reconstruct a normalized outcome from a P9 replay stream. Pure.

    The last `model` record is the final answer; `tool` record keys are the
    tools the run used; turn count is the number of model records. Cost isn't in
    the replay stream, so it stays 0.0 (a cost assertion needs the live runner)."""
    ordered = sorted(records or [], key=lambda r: r.get("seq", 0))
    model_recs = [r for r in ordered if r.get("kind") == "model"]
    tool_recs = [r for r in ordered if r.get("kind") == "tool"]

    final_text = _text_of(model_recs[-1].get("value")) if model_recs else ""
    tools_used: list[str] = []
    for r in tool_recs:
        name = r.get("key") or _text_of(r.get("value"))
        if name and name not in tools_used:
            tools_used.append(name)

    return extract_outcome({
        "final_text": final_text,
        "tools_used": tools_used,
        "status": "completed" if ordered else "empty",
        "error": None,
        "cost_usd": 0.0,
        "turns": len(model_recs),
    })


def _default_runner(case: dict) -> dict:
    """Reconstruct from the recorded log when no live runner is wired."""
    sid = case.get("replay_session_id")
    if not sid:
        raise ValueError("case has no replay_session_id and no live runner is wired")
    records = replay_store.read_records(sid)
    if not records:
        raise ValueError(f"no replay log for session {sid!r}")
    return outcome_from_records(records)


_runner: Callable[[dict], dict] = _default_runner


def set_runner(fn: Callable[[dict], dict]) -> None:
    """Agent stack injects a live replay-and-rerun resolver here."""
    global _runner
    _runner = fn


def resolve_outcome(case: dict) -> dict:
    return _runner(case)
