"""Tests for the worker-placement core (P6, Tier 2)."""

from backend.apps.cluster import placement as p


def test_normalize_defaults():
    c = p.normalize_config({})
    assert c["mode"] == "local" and c["local_capacity"] == 4 and c["remote_url"] == ""


def test_normalize_rejects_bad_mode_and_capacity():
    c = p.normalize_config({"mode": "nonsense", "local_capacity": 0})
    assert c["mode"] == "local" and c["local_capacity"] == 1


def test_local_mode_always_local():
    d = p.decide_placement({"mode": "local", "local_capacity": 2}, local_running=5)
    assert d["target"] == "local" and d["would_queue"] is True


def test_auto_stays_local_until_full():
    cfg = {"mode": "auto", "local_capacity": 3, "remote_url": "https://workers.example"}
    assert p.decide_placement(cfg, local_running=2)["target"] == "local"
    # full -> burst to remote
    assert p.decide_placement(cfg, local_running=3)["target"] == "remote"


def test_auto_full_no_remote_queues_locally():
    cfg = {"mode": "auto", "local_capacity": 2}  # no remote_url
    d = p.decide_placement(cfg, local_running=2)
    assert d["target"] == "local" and d["would_queue"] is True


def test_remote_mode_without_url_falls_back_to_local():
    d = p.decide_placement({"mode": "remote"}, local_running=0)
    assert d["target"] == "local" and "falling back" in d["reason"]


def test_remote_mode_with_url():
    d = p.decide_placement({"mode": "remote", "remote_url": "https://w.example"}, local_running=0)
    assert d["target"] == "remote"


def test_remote_available():
    assert not p.remote_available({"mode": "auto"})
    assert p.remote_available({"mode": "auto", "remote_url": "https://w.example"})


def test_cluster_status_summary():
    cfg = {"mode": "auto", "local_capacity": 4, "remote_url": "https://w.example"}
    s = p.cluster_status(cfg, local_running=4, queue_depth=2)
    assert s["mode"] == "auto" and s["remote_configured"] is True
    assert s["local_running"] == 4 and s["queue_depth"] == 2
    assert s["next_placement"] == "remote"  # local full + remote configured
