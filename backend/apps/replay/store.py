"""Replay-log persistence (P9). One append-only JSONL file per session under
REPLAY_DIR: live recording is a true file append (cheap), and export bundles the
whole log delta-compressed. Leaf module, no agent imports.
"""

from __future__ import annotations

import json
import os
import threading

from backend.config.paths import REPLAY_DIR

_lock = threading.Lock()


def _path(session_id: str) -> str:
    # Guard against path traversal from a caller-supplied id.
    safe = "".join(c for c in session_id if c.isalnum() or c in "-_")
    return os.path.join(REPLAY_DIR, f"{safe}.jsonl")


def append_record(session_id: str, record: dict) -> None:
    path = _path(session_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with _lock:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")


def read_records(session_id: str) -> list[dict]:
    path = _path(session_id)
    rows: list[dict] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    except FileNotFoundError:
        return []
    return rows


def write_records(session_id: str, records: list[dict]) -> None:
    """Replace a session's log wholesale (used when storing a fork)."""
    path = _path(session_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with _lock:
        with open(path, "w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r) + "\n")


def delete_log(session_id: str) -> bool:
    path = _path(session_id)
    with _lock:
        if os.path.exists(path):
            os.remove(path)
            return True
        return False


def list_logs() -> list[dict]:
    try:
        names = [n for n in os.listdir(REPLAY_DIR) if n.endswith(".jsonl")]
    except FileNotFoundError:
        return []
    out: list[dict] = []
    for n in names:
        sid = n[:-len(".jsonl")]
        out.append({"session_id": sid, "records": len(read_records(sid))})
    return out
