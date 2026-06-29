"""Tests for the offline local-model endpoint logic (P11, Tier 2)."""

from backend.apps.offline import endpoints as ep


def test_catalog_has_known_servers():
    ids = {e["id"] for e in ep.catalog()}
    assert {"lmstudio", "ollama"} <= ids
    assert all(e["base_url"].startswith("http://127.0.0.1") for e in ep.catalog())


def test_probe_all_annotates_reachable():
    # Injected checker: only LM Studio's url is "up".
    up = "http://127.0.0.1:1234/v1"
    probed = ep.probe_all(lambda url: url == up)
    by_id = {e["id"]: e for e in probed}
    assert by_id["lmstudio"]["reachable"] is True
    assert by_id["ollama"]["reachable"] is False


def test_probe_all_swallows_checker_errors():
    def boom(url):
        raise RuntimeError("socket error")
    probed = ep.probe_all(boom)
    assert all(e["reachable"] is False for e in probed)


def test_choose_prefers_reachable_preferred():
    probed = ep.probe_all(lambda url: True)  # all up
    chosen = ep.choose_offline(probed, preferred_id="ollama")
    assert chosen["id"] == "ollama"


def test_choose_falls_back_to_first_reachable():
    # preferred is down; first reachable in catalog order wins.
    probed = ep.probe_all(lambda url: "11434" in url)  # only ollama up
    chosen = ep.choose_offline(probed, preferred_id="lmstudio")
    assert chosen["id"] == "ollama"


def test_choose_none_when_nothing_reachable():
    probed = ep.probe_all(lambda url: False)
    assert ep.choose_offline(probed) is None


def test_normalize_pref():
    assert ep.normalize_pref({})["offline_enabled"] is False
    n = ep.normalize_pref({"offline_enabled": True, "preferred_id": "ollama"})
    assert n["offline_enabled"] is True and n["preferred_id"] == "ollama"
    assert ep.normalize_pref({"preferred_id": ""})["preferred_id"] is None
