"""Tests for multi-agent coordination (P1): capability matching, the consensus
gate, the delegation queue state machine, and the single-tick dispatch path."""

import pytest

from backend.apps.coordination import registry as reg, consensus, queue as q
from backend.apps.coordination import coordination as coord


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    monkeypatch.setattr(reg, "_FILE", str(tmp_path / "registry.json"))
    monkeypatch.setattr(q, "_FILE", str(tmp_path / "delegations.json"))
    yield


# ---- capability registry ----

def test_match_score_partial_and_empty():
    assert reg.match_score(["bash", "edit"], ["bash"]) == 1.0
    assert reg.match_score(["bash"], ["bash", "edit"]) == 0.5
    assert reg.match_score([], []) == 1.0  # no requirement -> anyone qualifies


def test_best_for_picks_highest_coverage():
    reg.register("coder", ["bash", "edit", "read"])
    reg.register("writer", ["read"])
    best = reg.best_for(["bash", "edit"])
    assert best["agent_type"] == "coder"
    assert best["_score"] == 1.0


def test_best_for_empty_registry_is_none():
    assert reg.best_for(["bash"]) is None


# ---- consensus (pure) ----

def test_should_delegate_accepts_coherent_split():
    out = consensus.should_delegate(
        ["research the API options", "draft the migration plan", "write the tests"], 1.0)
    assert out["delegate"] is True


def test_should_delegate_rejects_single_subtask():
    out = consensus.should_delegate(["do the whole thing"], 1.0)
    assert out["delegate"] is False
    assert "distinct" in out["reason"]


def test_should_delegate_rejects_low_confidence():
    out = consensus.should_delegate(
        ["analyze the schema design", "refactor the query layer"], 0.2)
    assert out["delegate"] is False


# ---- queue state machine ----

def test_enqueue_claim_complete_flow():
    t = q.enqueue({"parent_session_id": "p1", "subtask": "do x"}, 1.0)
    assert t["status"] == "pending"
    claimed = q.claim_next(2.0)
    assert claimed["id"] == t["id"] and claimed["status"] == "running"
    assert q.claim_next(3.0) is None  # nothing left pending
    done = q.complete(t["id"], {"answer": 42}, 4.0)
    assert done["status"] == "done" and done["result"] == {"answer": 42}


def test_claim_is_fifo():
    a = q.enqueue({"subtask": "a"}, 1.0)
    b = q.enqueue({"subtask": "b"}, 2.0)
    assert q.claim_next(3.0)["id"] == a["id"]
    assert q.claim_next(4.0)["id"] == b["id"]


def test_fail_records_error():
    t = q.enqueue({"subtask": "boom"}, 1.0)
    q.claim_next(2.0)
    failed = q.fail(t["id"], "nope", 3.0)
    assert failed["status"] == "failed" and failed["error"] == "nope"


def test_list_filters_by_status_and_parent():
    q.enqueue({"parent_session_id": "p1", "subtask": "x"}, 1.0)
    q.enqueue({"parent_session_id": "p2", "subtask": "y"}, 2.0)
    assert len(q.list_tasks(status="pending")) == 2
    assert len(q.list_tasks(parent_session_id="p1")) == 1


# ---- dispatch tick ----

@pytest.mark.asyncio
async def test_dispatch_once_fires_pending(monkeypatch):
    fired = []

    async def fake_launcher(task):
        fired.append(task["id"])
        q.assign_worker(task["id"], "worker-sess", 9.0)

    monkeypatch.setattr(coord, "_launcher", fake_launcher)
    t = q.enqueue({"subtask": "work"}, 1.0)
    n = await coord._dispatch_once(10.0)
    assert n == 1 and fired == [t["id"]]
    assert q.get(t["id"])["worker_session_id"] == "worker-sess"


@pytest.mark.asyncio
async def test_dispatch_once_survives_launcher_error(monkeypatch):
    async def boom(task):
        raise RuntimeError("nope")

    monkeypatch.setattr(coord, "_launcher", boom)
    t = q.enqueue({"subtask": "work"}, 1.0)
    n = await coord._dispatch_once(10.0)
    assert n == 1
    assert q.get(t["id"])["status"] == "failed"
