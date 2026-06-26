"""Heuristic reflection (P8): distill a finished session into a playbook lesson
without an LLM call. Pure so it's unit-testable.

It reads what actually happened, the opening task, which tools were used, whether
errors showed up, and the final status, and produces a structured
{task, lesson, tags, outcome} draft. This is the seed; an aux-LLM reflection can
replace `summarize_session` later behind the same shape.
"""

from __future__ import annotations

from typing import Any

_ERROR_MARKERS = ("traceback", "exception", "error:", "failed", "could not", "denied")


def _text_of(content: Any) -> str:
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
        return " ".join(out)
    return str(content)


def _tool_names(messages: list[dict]) -> list[str]:
    names: list[str] = []
    for m in messages:
        content = m.get("content")
        if isinstance(content, list):
            for b in content:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    nm = b.get("name")
                    if nm and nm not in names:
                        names.append(str(nm))
    return names


def summarize_session(session: dict) -> dict:
    """Distill a session into a playbook draft. Returns {task, lesson, tags,
    outcome}; outcome is success|failure|unknown."""
    messages = session.get("messages", []) or []
    first_user = next(
        (_text_of(m.get("content")) for m in messages if m.get("role") == "user" and not m.get("hidden")),
        "",
    ).strip()
    task = (first_user[:200] + "...") if len(first_user) > 200 else first_user

    status = session.get("status")
    outcome = "success" if status in ("completed", "stopped") else "failure" if status == "error" else "unknown"

    tools = _tool_names(messages)
    blob = " ".join(_text_of(m.get("content")) for m in messages).lower()
    hit_errors = any(mk in blob for mk in _ERROR_MARKERS)

    bits: list[str] = []
    if tools:
        bits.append("Effective tools: " + ", ".join(tools[:8]) + ".")
    if hit_errors and outcome == "success":
        bits.append("Recovered from errors mid-run, retrying past the first failure paid off.")
    elif hit_errors:
        bits.append("Hit errors, watch this path next time.")
    if not bits:
        bits.append("Completed without notable tool use or errors.")
    lesson = " ".join(bits)

    tags = list(tools[:8])
    if session.get("model"):
        tags.append(str(session["model"]))

    return {"task": task, "lesson": lesson, "tags": tags, "outcome": outcome}
