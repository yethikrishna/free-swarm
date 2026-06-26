"""Tests for deterministic record/replay (P9): ordered replay, delta
compression round-trip, checkpoint fork, and the JSONL store."""

import pytest

from backend.apps.replay import log as L, store


# ---- pure log + player ----

def test_append_assigns_monotonic_seq():
    rl = L.ReplayLog()
    a = rl.append("model", "hello")
    b = rl.append("tool", {"ok": True})
    assert a["seq"] == 0 and b["seq"] == 1


def test_player_replays_in_order_deterministically():
    rl = L.ReplayLog()
    rl.append("model", "first")
    rl.append("tool", {"r": 1})
    rl.append("model", "second")

    p1 = L.Player(rl.records)
    assert p1.next("model")["value"] == "first"
    assert p1.next("model")["value"] == "second"
    assert p1.next("model") is None
    assert p1.next("tool")["value"] == {"r": 1}

    # A fresh player over the same log yields the identical sequence.
    p2 = L.Player(rl.records)
    assert [p2.next("model")["value"] for _ in range(2)] == ["first", "second"]


def test_compress_decompress_round_trip():
    rl = L.ReplayLog()
    rl.append("model", "a", key="turn1")
    rl.append("model", "b", key="turn1")  # only value changes vs prev
    rl.append("time", 123.0)
    original = rl.records
    assert L.decompress(L.compress(original)) == original


def test_compress_actually_shrinks_repeated_fields():
    rl = L.ReplayLog()
    for i in range(3):
        rl.append("model", "same", key="k")
    rows = L.compress(rl.records)
    # rows after the first only carry the changing seq, not kind/key/value/ts.
    assert set(rows[1].keys()) == {"seq"}


def test_fork_truncates_at_checkpoint():
    rl = L.ReplayLog()
    for i in range(5):
        rl.append("model", i)
    prefix = L.fork(rl.records, at_seq=2)
    assert [r["seq"] for r in prefix] == [0, 1, 2]


# ---- store ----

@pytest.fixture(autouse=True)
def isolate_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "REPLAY_DIR", str(tmp_path))
    # _path closes over the module-level REPLAY_DIR import, so patch there too.
    import backend.apps.replay.store as s
    monkeypatch.setattr(s, "REPLAY_DIR", str(tmp_path))
    yield


def test_append_read_round_trip():
    store.append_record("sess1", {"seq": 0, "kind": "model", "value": "x"})
    store.append_record("sess1", {"seq": 1, "kind": "tool", "value": "y"})
    rows = store.read_records("sess1")
    assert len(rows) == 2 and rows[1]["value"] == "y"


def test_path_traversal_is_neutralized():
    store.append_record("../etc/passwd", {"seq": 0, "kind": "model", "value": "z"})
    # The slashes/dots are stripped, so it never escapes the replay dir.
    assert store.read_records("../etc/passwd") == [{"seq": 0, "kind": "model", "value": "z"}]


def test_list_and_delete():
    store.append_record("a", {"seq": 0, "kind": "model", "value": 1})
    assert any(l["session_id"] == "a" for l in store.list_logs())
    assert store.delete_log("a") is True
    assert store.delete_log("a") is False
