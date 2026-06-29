"""Routing policy + budget governor state (P10). A tiny JSON store, same shape
as the automation store. Holds whether routing is enabled and a daily spend
cap; the governor reads `budget_fraction` to degrade toward cheaper rungs as the
day's budget depletes. Spend is tracked per local day and auto-resets.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time

from backend.config.paths import ROUTING_DIR

_POLICY_FILE = os.path.join(ROUTING_DIR, "policy.json")
_lock = threading.Lock()

_DEFAULT = {"enabled": False, "daily_budget_usd": 0.0, "spent_today_usd": 0.0, "day": ""}


def _day_key(now: float) -> str:
    lt = time.localtime(now)
    return f"{lt.tm_year:04d}-{lt.tm_mon:02d}-{lt.tm_mday:02d}"


def _read() -> dict:
    try:
        with open(_POLICY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {**_DEFAULT, **data} if isinstance(data, dict) else dict(_DEFAULT)
    except (FileNotFoundError, json.JSONDecodeError):
        return dict(_DEFAULT)


def _write(data: dict) -> None:
    os.makedirs(os.path.dirname(_POLICY_FILE), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(_POLICY_FILE), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, _POLICY_FILE)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def load_policy(now: float | None = None) -> dict:
    now = time.time() if now is None else now
    with _lock:
        p = _read()
        # Roll the day over: a new local day zeroes spend.
        today = _day_key(now)
        if p.get("day") != today:
            p["day"] = today
            p["spent_today_usd"] = 0.0
            _write(p)
        return p


def set_policy(patch: dict, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    with _lock:
        p = _read()
        if "enabled" in patch:
            p["enabled"] = bool(patch["enabled"])
        if "daily_budget_usd" in patch:
            p["daily_budget_usd"] = max(0.0, float(patch["daily_budget_usd"]))
        if p.get("day") != _day_key(now):
            p["day"] = _day_key(now)
            p["spent_today_usd"] = 0.0
        _write(p)
        return p


def record_spend(usd: float, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    with _lock:
        p = _read()
        today = _day_key(now)
        if p.get("day") != today:
            p["day"] = today
            p["spent_today_usd"] = 0.0
        p["spent_today_usd"] = round(float(p.get("spent_today_usd", 0.0)) + max(0.0, float(usd)), 8)
        _write(p)
        return p


def budget_fraction(policy: dict) -> float | None:
    """Remaining fraction of today's budget in [0,1], or None when no cap set."""
    cap = float(policy.get("daily_budget_usd", 0.0) or 0.0)
    if cap <= 0:
        return None
    spent = float(policy.get("spent_today_usd", 0.0) or 0.0)
    return max(0.0, min(1.0, (cap - spent) / cap))
