"""Delegation queue (P1): the blackboard a manager agent posts subtasks to and
workers complete. Leaf JSON store with a small, explicit state machine:

  pending -> running -> done | failed

`claim_next` hands the oldest pending task to the dispatcher (which spawns a
worker), `assign_worker` records the spawned session, and `complete`/`fail`
close it out. Pure-ish (I/O only), unit-tested.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from typing import Optional

from backend.config.paths import COORDINATION_DIR

_FILE = os.path.join(COORDINATION_DIR, "delegations.json")
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


def enqueue(data: dict, now: float) -> dict:
    task = {
        "id": uuid.uuid4().hex,
        "parent_session_id": data.get("parent_session_id", ""),
        "subtask": data.get("subtask", ""),
        "required_tools": list(data.get("required_tools", []) or []),
        "agent_type": data.get("agent_type"),
        "status": "pending",
        "worker_session_id": None,
        "result": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }
    with _lock:
        rows = _read()
        rows.append(task)
        _write(rows)
    return task


def claim_next(now: float) -> Optional[dict]:
    """Oldest pending task -> running. Returns it, or None if none pending."""
    with _lock:
        rows = _read()
        pending = [r for r in rows if r.get("status") == "pending"]
        if not pending:
            return None
        pending.sort(key=lambda r: r.get("created_at", 0))
        task = pending[0]
        task["status"] = "running"
        task["updated_at"] = now
        _write(rows)
        return task


def _update(task_id: str, patch: dict, now: float) -> Optional[dict]:
    with _lock:
        rows = _read()
        for r in rows:
            if r.get("id") == task_id:
                r.update(patch)
                r["updated_at"] = now
                _write(rows)
                return r
    return None


def assign_worker(task_id: str, worker_session_id: str, now: float) -> Optional[dict]:
    return _update(task_id, {"worker_session_id": worker_session_id}, now)


def complete(task_id: str, result, now: float) -> Optional[dict]:
    return _update(task_id, {"status": "done", "result": result}, now)


def fail(task_id: str, error: str, now: float) -> Optional[dict]:
    return _update(task_id, {"status": "failed", "error": error}, now)


def get(task_id: str) -> Optional[dict]:
    return next((r for r in _read() if r.get("id") == task_id), None)


def list_tasks(status: Optional[str] = None, parent_session_id: Optional[str] = None) -> list[dict]:
    rows = _read()
    if status:
        rows = [r for r in rows if r.get("status") == status]
    if parent_session_id:
        rows = [r for r in rows if r.get("parent_session_id") == parent_session_id]
    return rows
