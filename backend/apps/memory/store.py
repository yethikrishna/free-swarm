"""Playbook persistence (P8): per-agent-type lessons learned across runs.

A leaf JSON store (memory/playbooks.json). Each entry:
  {id, agent_type, task, lesson, tags[], outcome, created_at, hits}
Retrieval goes through similarity.retrieve; `bump_hit` records when a lesson was
surfaced so popular lessons rank a touch higher on ties.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from typing import Optional

from backend.config.paths import MEMORY_DIR
from backend.apps.memory import similarity

_FILE = os.path.join(MEMORY_DIR, "playbooks.json")
_lock = threading.Lock()


def _read() -> list[dict]:
    try:
        with open(_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _write(rows: list[dict]) -> None:
    os.makedirs(os.path.dirname(_FILE), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(_FILE), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2)
        os.replace(tmp, _FILE)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def add_lesson(data: dict, now: float) -> dict:
    entry = {
        "id": uuid.uuid4().hex,
        "agent_type": (data.get("agent_type") or "default").strip() or "default",
        "task": data.get("task", ""),
        "lesson": data.get("lesson", ""),
        "tags": list(data.get("tags", []) or []),
        "outcome": data.get("outcome", "unknown"),
        "created_at": now,
        "hits": 0,
    }
    with _lock:
        rows = _read()
        rows.append(entry)
        _write(rows)
    return entry


def list_lessons(agent_type: Optional[str] = None) -> list[dict]:
    rows = _read()
    if agent_type:
        rows = [r for r in rows if r.get("agent_type") == agent_type]
    return rows


def delete_lesson(lesson_id: str) -> bool:
    with _lock:
        rows = _read()
        new = [r for r in rows if r.get("id") != lesson_id]
        if len(new) == len(rows):
            return False
        _write(new)
        return True


def bump_hit(lesson_id: str) -> None:
    with _lock:
        rows = _read()
        for r in rows:
            if r.get("id") == lesson_id:
                r["hits"] = int(r.get("hits", 0) or 0) + 1
                _write(rows)
                return


def retrieve_lessons(query: str, agent_type: Optional[str] = None, k: int = 3,
                     bump: bool = False) -> list[dict]:
    """Top-k relevant lessons for a task. When `bump`, records a hit on each
    returned lesson so frequently-useful lessons rank higher on ties."""
    hits = similarity.retrieve(list_lessons(agent_type), query, k=k)
    if bump:
        for h in hits:
            bump_hit(h["id"])
    return hits
