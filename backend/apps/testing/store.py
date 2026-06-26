"""Suite/case persistence for P12. One JSON file per suite under TESTING_DIR.
Leaf module, no agent imports. Atomic writes so a crash can't truncate a suite.

A suite: {id, name, created_at, updated_at, cases: [case]}
A case:  {id, name, replay_session_id?, assertions: [assertion], golden?: outcome}
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from typing import Optional

from backend.config.paths import TESTING_DIR

_lock = threading.Lock()


def _safe(suite_id: str) -> str:
    return "".join(c for c in suite_id if c.isalnum() or c in "-_")


def _path(suite_id: str) -> str:
    return os.path.join(TESTING_DIR, f"{_safe(suite_id)}.json")


def _write(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _read(path: str) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def list_suites() -> list[dict]:
    try:
        names = [n for n in os.listdir(TESTING_DIR) if n.endswith(".json")]
    except FileNotFoundError:
        return []
    out: list[dict] = []
    for n in names:
        s = _read(os.path.join(TESTING_DIR, n))
        if s:
            out.append({"id": s.get("id"), "name": s.get("name"), "cases": len(s.get("cases") or [])})
    return out


def get_suite(suite_id: str) -> Optional[dict]:
    return _read(_path(suite_id))


def create_suite(name: str, now: float) -> dict:
    sid = uuid.uuid4().hex[:12]
    suite = {"id": sid, "name": name or sid, "created_at": now, "updated_at": now, "cases": []}
    with _lock:
        _write(_path(sid), suite)
    return suite


def delete_suite(suite_id: str) -> bool:
    path = _path(suite_id)
    with _lock:
        if os.path.exists(path):
            os.remove(path)
            return True
        return False


def add_case(suite_id: str, case: dict, now: float) -> Optional[dict]:
    with _lock:
        suite = _read(_path(suite_id))
        if not suite:
            return None
        cid = uuid.uuid4().hex[:12]
        new_case = {
            "id": cid,
            "name": case.get("name") or cid,
            "replay_session_id": case.get("replay_session_id"),
            "assertions": case.get("assertions") or [],
            "golden": case.get("golden"),
        }
        suite.setdefault("cases", []).append(new_case)
        suite["updated_at"] = now
        _write(_path(suite_id), suite)
        return new_case


def remove_case(suite_id: str, case_id: str, now: float) -> bool:
    with _lock:
        suite = _read(_path(suite_id))
        if not suite:
            return False
        cases = suite.get("cases") or []
        kept = [c for c in cases if c.get("id") != case_id]
        if len(kept) == len(cases):
            return False
        suite["cases"] = kept
        suite["updated_at"] = now
        _write(_path(suite_id), suite)
        return True


def set_golden(suite_id: str, case_id: str, golden: dict, now: float) -> bool:
    """Record a passing run's outcome as the new baseline for future diffs."""
    with _lock:
        suite = _read(_path(suite_id))
        if not suite:
            return False
        for c in suite.get("cases") or []:
            if c.get("id") == case_id:
                c["golden"] = golden
                suite["updated_at"] = now
                _write(_path(suite_id), suite)
                return True
        return False
