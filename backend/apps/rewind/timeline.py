"""Rewind timeline core (P4). Pure + unit-tested.

The agent stack already forks at a user turn (`agent_manager.edit_message`) and
switches branches. What it lacks is a clean, UI-ready *map* of where a run can be
rewound to. `build_timeline` walks a session's messages and emits one checkpoint
per user turn, each annotated with what happened after it (assistant replies,
tools used) and whether it's a valid rewind target.

Rewindable == a user message on the active branch: that mirrors edit_message's
"can only edit user messages" rule, so the UI never offers a rewind the stack
will reject.
"""

from __future__ import annotations

from typing import Any


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and isinstance(block.get("text"), str):
                return block["text"]
    return "" if content is None else str(content)


def _summary(content: Any, n: int = 80) -> str:
    text = " ".join(_text_of(content).split())
    return text if len(text) <= n else text[: n - 3] + "..."


def build_timeline(messages: list[dict], active_branch_id: str = "main") -> dict:
    """One checkpoint per user turn, in order. Each carries the assistant/tool
    activity that followed it (up to the next user turn) so the UI can label
    "rewind to here" with what would be discarded."""
    msgs = [m for m in (messages or []) if isinstance(m, dict)]
    user_idxs = [i for i, m in enumerate(msgs) if m.get("role") == "user"]

    checkpoints: list[dict] = []
    for n, i in enumerate(user_idxs):
        end = user_idxs[n + 1] if n + 1 < len(user_idxs) else len(msgs)
        following = msgs[i + 1:end]
        tools = []
        for m in following:
            if m.get("role") == "tool_call":
                name = _tool_name(m)
                if name and name not in tools:
                    tools.append(name)
        branch_id = msgs[i].get("branch_id") or "main"
        checkpoints.append({
            "turn": n,
            "index": i,
            "message_id": msgs[i].get("id"),
            "branch_id": branch_id,
            "summary": _summary(msgs[i].get("content")),
            "tools": tools,
            "replies": sum(1 for m in following if m.get("role") == "assistant"),
            # Only active-branch user turns are valid edit/fork targets.
            "rewindable": branch_id == active_branch_id,
        })

    return {"checkpoints": checkpoints, "count": len(checkpoints)}


def _tool_name(msg: dict) -> str:
    content = msg.get("content")
    if isinstance(content, dict):
        for k in ("name", "tool_name", "tool"):
            if isinstance(content.get(k), str):
                return content[k]
    return ""


def find_checkpoint(timeline: dict, message_id: str) -> dict | None:
    for cp in timeline.get("checkpoints") or []:
        if cp.get("message_id") == message_id:
            return cp
    return None
