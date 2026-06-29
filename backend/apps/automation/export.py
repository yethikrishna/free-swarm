"""Transcript export (F3). Pure renderers (session dict -> Markdown / JSON) kept
separate so they're unit-testable without the agent stack. The automation SubApp
exposes routes that read a session via agent_manager and, for sharing, POST the
JSON transcript to the cloud's /api/share with the stored account bearer.
"""

from __future__ import annotations

from typing import Any


def _text_of(content: Any) -> str:
    """Flatten a message's content (str or list of blocks) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text" or "text" in block:
                    parts.append(str(block.get("text", "")))
                elif block.get("type") == "tool_use":
                    parts.append(f"[tool: {block.get('name', 'tool')}]")
                elif block.get("type") == "tool_result":
                    parts.append("[tool result]")
            else:
                parts.append(str(block))
        return "\n".join(p for p in parts if p)
    return str(content)


_ROLE_LABEL = {
    "user": "User", "assistant": "Assistant", "thinking": "Thinking",
    "tool_call": "Tool", "tool_result": "Result", "system": "System",
}


def render_markdown(session: dict) -> str:
    """A readable Markdown transcript. Skips hidden + empty messages."""
    lines = [f"# {session.get('name') or 'Agent session'}", ""]
    model = session.get("model")
    if model:
        lines.append(f"_Model: {model}_")
        lines.append("")
    for m in session.get("messages", []):
        if m.get("hidden"):
            continue
        text = _text_of(m.get("content")).strip()
        if not text:
            continue
        label = _ROLE_LABEL.get(m.get("role", ""), m.get("role", ""))
        lines.append(f"## {label}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def render_json(session: dict) -> dict:
    """A structured transcript: trimmed to display-relevant fields."""
    return {
        "name": session.get("name"),
        "model": session.get("model"),
        "created_at": session.get("created_at"),
        "cost_usd": session.get("cost_usd"),
        "messages": [
            {"role": m.get("role"), "text": _text_of(m.get("content")), "timestamp": m.get("timestamp")}
            for m in session.get("messages", [])
            if not m.get("hidden") and _text_of(m.get("content")).strip()
        ],
    }
