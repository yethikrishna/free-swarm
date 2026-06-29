"""Tests for the automation SubApp: scheduled-task scheduling math, CRUD, the
single-tick fire path, and agent-template CRUD (F5 + F10)."""

import time

import pytest

from backend.apps.automation import store
from backend.apps.automation import automation as auto


@pytest.fixture(autouse=True)
def isolate_store(tmp_path, monkeypatch):
    # Point the store's JSON files at a temp dir so tests never touch real data.
    tasks = tmp_path / "scheduled_tasks.json"
    templates = tmp_path / "agent_templates.json"
    monkeypatch.setattr(store, "_TASKS_FILE", str(tasks))
    monkeypatch.setattr(store, "_TEMPLATES_FILE", str(templates))
    yield


# ---- pure scheduling math ----

def test_compute_next_run_interval():
    now = 1_000_000.0
    nxt = store.compute_next_run({"schedule_kind": "interval", "interval_minutes": 15}, now)
    assert nxt == now + 15 * 60


def test_compute_next_run_interval_floor_one_minute():
    now = 1_000_000.0
    nxt = store.compute_next_run({"schedule_kind": "interval", "interval_minutes": 0}, now)
    assert nxt == now + 60  # clamped to >= 1 minute


def test_compute_next_run_daily_is_future():
    now = time.time()
    nxt = store.compute_next_run({"schedule_kind": "daily", "daily_time": "09:00"}, now)
    assert nxt > now
    assert nxt <= now + store._DAY_SECONDS


def test_due_tasks_filters_disabled_and_future():
    now = 100.0
    tasks = [
        {"id": "a", "enabled": True, "next_run_at": 50},    # due
        {"id": "b", "enabled": False, "next_run_at": 10},   # disabled
        {"id": "c", "enabled": True, "next_run_at": 200},   # future
    ]
    due = store.due_tasks(tasks, now)
    assert [t["id"] for t in due] == ["a"]


# ---- task CRUD ----

def test_create_and_list_task():
    t = store.create_task({"prompt": "do x", "schedule_kind": "interval", "interval_minutes": 30}, time.time())
    assert t["id"]
    assert t["next_run_at"] > 0
    rows = store.list_tasks()
    assert len(rows) == 1 and rows[0]["id"] == t["id"]


def test_update_task_reschedules():
    t = store.create_task({"prompt": "x", "interval_minutes": 60}, 1000.0)
    updated = store.update_task(t["id"], {"interval_minutes": 5}, 2000.0)
    assert updated["interval_minutes"] == 5
    assert updated["next_run_at"] == 2000.0 + 5 * 60


def test_delete_task():
    t = store.create_task({"prompt": "x"}, time.time())
    assert store.delete_task(t["id"]) is True
    assert store.delete_task(t["id"]) is False
    assert store.list_tasks() == []


def test_advance_sets_last_run_and_next():
    t = store.create_task({"prompt": "x", "interval_minutes": 10}, 1000.0)
    store.advance(t["id"], 5000.0)
    got = store.get_task(t["id"])
    assert got["last_run_at"] == 5000.0
    assert got["next_run_at"] == 5000.0 + 10 * 60


# ---- the fire path ----

@pytest.mark.asyncio
async def test_run_due_once_fires_and_reschedules(monkeypatch):
    fired = []

    async def fake_launcher(task):
        fired.append(task["id"])

    monkeypatch.setattr(auto, "_launcher", fake_launcher)
    t = store.create_task({"prompt": "x", "interval_minutes": 10}, 0.0)
    # next_run is at +600s; drive a tick after that.
    n = await auto._run_due_once(10_000.0)
    assert n == 1
    assert fired == [t["id"]]
    # rescheduled into the future relative to the tick time
    assert store.get_task(t["id"])["next_run_at"] == 10_000.0 + 600


@pytest.mark.asyncio
async def test_run_due_once_survives_launcher_error(monkeypatch):
    async def boom(task):
        raise RuntimeError("nope")

    monkeypatch.setattr(auto, "_launcher", boom)
    t = store.create_task({"prompt": "x", "interval_minutes": 10}, 0.0)
    n = await auto._run_due_once(10_000.0)
    assert n == 1  # still advanced past the failure
    assert store.get_task(t["id"])["last_run_at"] == 10_000.0


# ---- template CRUD ----

def test_template_crud():
    tpl = store.create_template({"name": "Researcher", "system_prompt": "be thorough"}, time.time())
    assert tpl["id"] and tpl["name"] == "Researcher"
    upd = store.update_template(tpl["id"], {"model": "claude-opus-4-8"}, time.time())
    assert upd["model"] == "claude-opus-4-8"
    assert store.delete_template(tpl["id"]) is True
    assert store.list_templates() == []


# ---- transcript export (F3) ----

def _sample_session():
    return {
        "name": "My session", "model": "sonnet",
        "messages": [
            {"role": "user", "content": "hello", "hidden": False},
            {"role": "assistant", "content": [{"type": "text", "text": "hi there"}], "hidden": False},
            {"role": "assistant", "content": "secret", "hidden": True},  # dropped
            {"role": "tool_call", "content": [{"type": "tool_use", "name": "Bash"}], "hidden": False},
        ],
    }


def test_render_markdown_skips_hidden_and_labels_roles():
    from backend.apps.automation import export as ex
    md = ex.render_markdown(_sample_session())
    assert "# My session" in md
    assert "## User" in md and "hello" in md
    assert "## Assistant" in md and "hi there" in md
    assert "secret" not in md  # hidden message dropped
    assert "[tool: Bash]" in md


def test_render_json_trims_to_display_fields():
    from backend.apps.automation import export as ex
    out = ex.render_json(_sample_session())
    assert out["name"] == "My session"
    # 3 visible messages (hidden one dropped)
    assert len(out["messages"]) == 3
    assert out["messages"][0] == {"role": "user", "text": "hello", "timestamp": None}
