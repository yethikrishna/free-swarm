"""Persistence + pure scheduling logic for automation (F5 scheduled tasks,
F10 agent templates).

A leaf module: JSON files under automation/, no imports from the agent stack, so
the scheduling math is unit-testable in isolation. Two files:

  scheduled_tasks.json  -> list[ScheduledTask]
  agent_templates.json  -> list[AgentTemplate]

`compute_next_run` is the load-bearing pure function; the SubApp's loop just
fires whatever `due_tasks` returns and calls `advance` to reschedule.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import uuid
from typing import Optional

from backend.config.paths import AUTOMATION_DIR

_TASKS_FILE = os.path.join(AUTOMATION_DIR, "scheduled_tasks.json")
_TEMPLATES_FILE = os.path.join(AUTOMATION_DIR, "agent_templates.json")
_lock = threading.Lock()

_DAY_SECONDS = 86400.0


def _read(path: str) -> list[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _write(path: str, rows: list[dict]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # Atomic replace so a crash mid-write can't truncate the file.
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


# ---------------------------------------------------------------------------
# Pure scheduling math (no I/O; unit-tested)
# ---------------------------------------------------------------------------

def compute_next_run(task: dict, now: float) -> float:
    """Next epoch-seconds this task should fire, given its schedule.

    - kind 'interval': now + interval_minutes*60
    - kind 'daily':    the next occurrence of daily_time (HH:MM, local) at or
      after `now`. We work in local time so "09:00" means the user's 9am.
    """
    kind = task.get("schedule_kind", "interval")
    if kind == "interval":
        minutes = max(1, int(task.get("interval_minutes", 60)))
        return now + minutes * 60
    # daily
    hhmm = str(task.get("daily_time", "09:00"))
    try:
        hh, mm = (int(p) for p in hhmm.split(":", 1))
    except ValueError:
        hh, mm = 9, 0
    lt = time.localtime(now)
    midnight = now - (lt.tm_hour * 3600 + lt.tm_min * 60 + lt.tm_sec)
    target = midnight + hh * 3600 + mm * 60
    if target <= now:
        target += _DAY_SECONDS
    return target


def due_tasks(tasks: list[dict], now: float) -> list[dict]:
    """Enabled tasks whose next_run_at has arrived."""
    return [
        t for t in tasks
        if t.get("enabled", True) and float(t.get("next_run_at", 0)) <= now
    ]


# ---------------------------------------------------------------------------
# Scheduled tasks CRUD
# ---------------------------------------------------------------------------

def list_tasks() -> list[dict]:
    with _lock:
        return _read(_TASKS_FILE)


def get_task(task_id: str) -> Optional[dict]:
    return next((t for t in list_tasks() if t.get("id") == task_id), None)


def create_task(data: dict, now: float) -> dict:
    task = {
        "id": uuid.uuid4().hex,
        "name": data.get("name", "Scheduled task"),
        "prompt": data.get("prompt", ""),
        "schedule_kind": data.get("schedule_kind", "interval"),
        "interval_minutes": int(data.get("interval_minutes", 60)),
        "daily_time": data.get("daily_time", "09:00"),
        "template_id": data.get("template_id"),
        "enabled": bool(data.get("enabled", True)),
        "last_run_at": None,
        "created_at": now,
    }
    task["next_run_at"] = compute_next_run(task, now)
    with _lock:
        rows = _read(_TASKS_FILE)
        rows.append(task)
        _write(_TASKS_FILE, rows)
    return task


def update_task(task_id: str, patch: dict, now: float) -> Optional[dict]:
    with _lock:
        rows = _read(_TASKS_FILE)
        for t in rows:
            if t.get("id") == task_id:
                for k in ("name", "prompt", "schedule_kind", "interval_minutes",
                          "daily_time", "template_id", "enabled"):
                    if k in patch:
                        t[k] = patch[k]
                # Reschedule when the cadence or enabled-state changed.
                t["next_run_at"] = compute_next_run(t, now)
                _write(_TASKS_FILE, rows)
                return t
    return None


def delete_task(task_id: str) -> bool:
    with _lock:
        rows = _read(_TASKS_FILE)
        new = [t for t in rows if t.get("id") != task_id]
        if len(new) == len(rows):
            return False
        _write(_TASKS_FILE, new)
        return True


def advance(task_id: str, now: float) -> None:
    """Mark a task as just-run and compute its next fire time."""
    with _lock:
        rows = _read(_TASKS_FILE)
        for t in rows:
            if t.get("id") == task_id:
                t["last_run_at"] = now
                t["next_run_at"] = compute_next_run(t, now)
                _write(_TASKS_FILE, rows)
                return


# ---------------------------------------------------------------------------
# Agent templates CRUD (F10)
# ---------------------------------------------------------------------------

def list_templates() -> list[dict]:
    with _lock:
        return _read(_TEMPLATES_FILE)


def get_template(template_id: str) -> Optional[dict]:
    return next((t for t in list_templates() if t.get("id") == template_id), None)


def create_template(data: dict, now: float) -> dict:
    tpl = {
        "id": uuid.uuid4().hex,
        "name": data.get("name", "Untitled template"),
        "description": data.get("description", ""),
        "system_prompt": data.get("system_prompt", ""),
        "model": data.get("model", ""),
        "tools": list(data.get("tools", [])),
        "skills": list(data.get("skills", [])),
        "created_at": now,
        "updated_at": now,
    }
    with _lock:
        rows = _read(_TEMPLATES_FILE)
        rows.append(tpl)
        _write(_TEMPLATES_FILE, rows)
    return tpl


def update_template(template_id: str, patch: dict, now: float) -> Optional[dict]:
    with _lock:
        rows = _read(_TEMPLATES_FILE)
        for t in rows:
            if t.get("id") == template_id:
                for k in ("name", "description", "system_prompt", "model", "tools", "skills"):
                    if k in patch:
                        t[k] = patch[k]
                t["updated_at"] = now
                _write(_TEMPLATES_FILE, rows)
                return t
    return None


def delete_template(template_id: str) -> bool:
    with _lock:
        rows = _read(_TEMPLATES_FILE)
        new = [t for t in rows if t.get("id") != template_id]
        if len(new) == len(rows):
            return False
        _write(_TEMPLATES_FILE, new)
        return True
