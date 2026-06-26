"""Importance weighting for context messages (P2). Pure + testable.

A 200K window is useless if turn 5 fills it, so when we must shed history we
keep what matters: recent messages, user intent, pinned notes, over bulky tool
dumps. `score` blends role weight, recency, pinned, and a mild length penalty
into a 0..1 keepability score that the tiering + cold retrieval use.
"""

from __future__ import annotations

from typing import Any

_ROLE_WEIGHT = {
    "user": 1.0, "assistant": 0.9, "system": 0.7,
    "tool_call": 0.6, "thinking": 0.4, "tool_result": 0.5,
}


def text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out: list[str] = []
        for b in content:
            if isinstance(b, dict):
                if b.get("type") == "text" or "text" in b:
                    out.append(str(b.get("text", "")))
                elif b.get("type") == "tool_use":
                    out.append(f"[tool:{b.get('name', 'tool')}]")
                elif b.get("type") == "tool_result":
                    out.append("[tool result]")
        return " ".join(out)
    return str(content)


def score(message: dict, position_from_end: int, total: int) -> float:
    """Keepability 0..1. position_from_end: 0 = newest. total: message count."""
    role = message.get("role", "")
    base = _ROLE_WEIGHT.get(role, 0.6)
    recency = 1.0 - (position_from_end / max(1, total))
    pinned = 0.5 if message.get("pinned") else 0.0
    length_pen = min(0.2, len(text_of(message.get("content"))) / 20000.0)
    return round(max(0.0, min(1.5, base * 0.4 + recency * 0.5 + pinned - length_pen)), 4)
