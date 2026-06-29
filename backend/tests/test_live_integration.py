"""Tests for Tier 0 live activation (apps/agents/live_integration). The contract
is safety-by-construction: off by default = unchanged, on = tighten-only, never
raises."""

import importlib

from backend.apps.agents import live_integration as li
from backend.apps.rewind import store as gate_store
from backend.apps.routing import policy as routing_policy


# ---- P10 routed_model ----

def test_routed_model_noop_when_routing_disabled(tmp_path, monkeypatch):
    # Default routing policy is disabled -> pick_for_turn returns the input model.
    monkeypatch.setattr(routing_policy, "ROUTING_DIR", str(tmp_path), raising=False)
    assert li.routed_model("hello world", "sonnet") == "sonnet"


def test_routed_model_never_raises(monkeypatch):
    # Force the engine import to blow up; we must still get the default back.
    def boom(*a, **k):
        raise RuntimeError("engine down")
    monkeypatch.setattr("backend.apps.routing.routing.pick_for_turn", boom)
    assert li.routed_model("x", "opus") == "opus"


def test_routed_model_empty_choice_falls_back(monkeypatch):
    monkeypatch.setattr("backend.apps.routing.routing.pick_for_turn", lambda *a, **k: "")
    assert li.routed_model("x", "sonnet") == "sonnet"


# ---- P4 gated_policy ----

def _set_gate(monkeypatch, policy):
    monkeypatch.setattr(gate_store, "load_policy", lambda: policy)


def test_gate_noop_when_not_enforcing(monkeypatch):
    _set_gate(monkeypatch, {"enforce": False, "default_action": "deny",
                            "rules": [{"pattern": "*", "action": "deny"}]})
    # Not enforcing: existing policy passes through untouched even with a deny-all rule.
    assert li.gated_policy("always_allow", "Bash", {}) == "always_allow"


def test_gate_deny_blocks(monkeypatch):
    _set_gate(monkeypatch, {"enforce": True, "default_action": "allow",
                            "rules": [{"pattern": "Bash", "action": "deny"}]})
    assert li.gated_policy("always_allow", "Bash", {"command": "rm"}) == "deny"


def test_gate_escalates_allow_to_ask(monkeypatch):
    _set_gate(monkeypatch, {"enforce": True, "default_action": "allow",
                            "rules": [{"pattern": "Edit", "action": "gate"}]})
    assert li.gated_policy("always_allow", "Edit", {}) == "ask"


def test_gate_never_downgrades_existing_deny(monkeypatch):
    _set_gate(monkeypatch, {"enforce": True, "default_action": "allow",
                            "rules": [{"pattern": "*", "action": "gate"}]})
    # An existing hard deny must survive a 'gate' rule (tighten-only, never loosen).
    assert li.gated_policy("deny", "Bash", {}) == "deny"


def test_gate_allow_action_keeps_existing_policy(monkeypatch):
    # A gate 'allow' is "no opinion": it must not loosen an existing 'ask'.
    _set_gate(monkeypatch, {"enforce": True, "default_action": "allow",
                            "rules": [{"pattern": "Read", "action": "allow"}]})
    assert li.gated_policy("ask", "Read", {}) == "ask"


def test_gate_never_raises(monkeypatch):
    def boom():
        raise RuntimeError("store down")
    monkeypatch.setattr(gate_store, "load_policy", boom)
    assert li.gated_policy("ask", "Bash", {}) == "ask"
