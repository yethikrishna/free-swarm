"""Gate-policy persistence for P4. One JSON file under REWIND_DIR. Leaf module,
atomic writes. The policy is global to the install (like a settings doc), not
per-session."""

from __future__ import annotations

import json
import os
import tempfile
import threading

from backend.config.paths import REWIND_DIR

_POLICY_FILE = os.path.join(REWIND_DIR, "gate_policy.json")
_lock = threading.Lock()

# enforce=false means the policy is advisory only (evaluable via /gates/decide
# but not applied to live tool dispatch). Tier 0 flips this on to activate it.
_DEFAULT = {"default_action": "allow", "rules": [], "enforce": False}


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


def load_policy() -> dict:
    try:
        with open(_POLICY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return {"default_action": data.get("default_action", "allow"),
                    "rules": data.get("rules") or [],
                    "enforce": bool(data.get("enforce", False))}
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    return dict(_DEFAULT)


def save_policy(policy: dict) -> dict:
    clean = {
        "default_action": policy.get("default_action", "allow"),
        "rules": [r for r in (policy.get("rules") or []) if isinstance(r, dict)],
        "enforce": bool(policy.get("enforce", False)),
    }
    with _lock:
        _write(_POLICY_FILE, clean)
    return clean
