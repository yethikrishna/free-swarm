"""Capability registry (P1): which agent types can do what, so a manager agent
can route a subtask to the best-matching worker. Leaf JSON store; the match
function is pure + unit-tested.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from typing import Optional

from backend.config.paths import COORDINATION_DIR

_FILE = os.path.join(COORDINATION_DIR, "registry.json")
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


def match_score(capabilities: list[str], required: list[str]) -> float:
    """Fraction of required tools the agent type covers. 1.0 when `required` is
    empty (any agent qualifies). Pure."""
    req = {r.lower() for r in (required or [])}
    if not req:
        return 1.0
    caps = {c.lower() for c in (capabilities or [])}
    return len(req & caps) / len(req)


def register(agent_type: str, capabilities: list[str], description: str = "") -> dict:
    entry = {
        "agent_type": agent_type,
        "capabilities": list(capabilities or []),
        "description": description,
    }
    with _lock:
        rows = [r for r in _read() if r.get("agent_type") != agent_type]
        rows.append(entry)
        _write(rows)
    return entry


def list_agents() -> list[dict]:
    return _read()


def best_for(required: list[str]) -> Optional[dict]:
    """Agent type with the highest capability coverage for `required`. Ties go
    to the one registered first. None when the registry is empty."""
    rows = _read()
    if not rows:
        return None
    scored = [(match_score(r.get("capabilities", []), required), i, r) for i, r in enumerate(rows)]
    scored.sort(key=lambda t: (-t[0], t[1]))
    best_s, _, best = scored[0]
    return {**best, "_score": round(best_s, 4)}
