"""Tests for the self-improving agent playbook (P8): lexical retrieval, the
heuristic reflection, and the store CRUD + hit-ranking."""

import pytest

from backend.apps.memory import similarity, reflect, store


# ---- similarity (pure) ----

def test_tokenize_drops_stopwords_and_short():
    toks = similarity.tokenize("The agent should refactor the scheduler")
    assert "refactor" in toks and "scheduler" in toks
    assert "the" not in toks and "should" not in toks


def test_jaccard_identical_is_one():
    a = similarity.tokenize("refactor the scheduler concurrency")
    assert similarity.jaccard(a, a) == 1.0


def test_retrieve_ranks_and_drops_unrelated():
    entries = [
        {"task": "fix the scheduler race condition", "lesson": "", "tags": []},
        {"task": "write a poem about cats", "lesson": "", "tags": []},
    ]
    out = similarity.retrieve(entries, "scheduler race condition bug", k=2)
    assert len(out) == 1  # the cat poem scores 0 and is dropped
    assert "scheduler" in out[0]["task"]
    assert out[0]["_score"] > 0


# ---- reflection (pure) ----

def _session(status="completed"):
    return {
        "status": status, "model": "sonnet",
        "messages": [
            {"role": "user", "content": "Add a dark mode toggle to settings", "hidden": False},
            {"role": "tool_call", "content": [{"type": "tool_use", "name": "Edit"}]},
            {"role": "assistant", "content": [{"type": "text", "text": "Done, all good."}]},
        ],
    }


def test_summarize_success():
    out = reflect.summarize_session(_session("completed"))
    assert out["outcome"] == "success"
    assert "dark mode toggle" in out["task"]
    assert "Edit" in out["tags"]


def test_summarize_failure_flags_errors():
    s = _session("error")
    s["messages"].append({"role": "assistant", "content": "Traceback: it failed"})
    out = reflect.summarize_session(s)
    assert out["outcome"] == "failure"
    assert "errors" in out["lesson"].lower()


# ---- store ----

@pytest.fixture(autouse=True)
def isolate_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "_FILE", str(tmp_path / "playbooks.json"))
    yield


def test_add_list_filter_by_agent_type():
    store.add_lesson({"agent_type": "coder", "task": "x", "lesson": "y"}, 1.0)
    store.add_lesson({"agent_type": "writer", "task": "z", "lesson": "w"}, 2.0)
    assert len(store.list_lessons()) == 2
    assert len(store.list_lessons("coder")) == 1


def test_retrieve_bumps_hits():
    store.add_lesson({"agent_type": "coder", "task": "fix scheduler deadlock", "lesson": "use a lock"}, 1.0)
    out = store.retrieve_lessons("scheduler deadlock", "coder", k=3, bump=True)
    assert len(out) == 1
    again = store.list_lessons("coder")[0]
    assert again["hits"] == 1


def test_delete_lesson():
    e = store.add_lesson({"task": "x", "lesson": "y"}, 1.0)
    assert store.delete_lesson(e["id"]) is True
    assert store.delete_lesson(e["id"]) is False
    assert store.list_lessons() == []
