"""Tests for the cost/audit telemetry producer (F4/F6). Covers the delta math,
idempotent submission ids, payload shape, and the signed-out no-op path."""

import pytest

from backend.apps.telemetry import emitter as tel


@pytest.fixture(autouse=True)
def reset_state():
    tel._last_cost.clear()
    tel._seq.clear()
    yield
    tel._last_cost.clear()
    tel._seq.clear()


# ---- delta math ----

def test_cost_delta_first_turn_is_full_value():
    assert tel.cost_delta("s", 0.5) == 0.5


def test_cost_delta_subtracts_previous():
    tel.cost_delta("s", 0.5)
    assert tel.cost_delta("s", 0.8) == pytest.approx(0.3)


def test_cost_delta_clamps_reset_to_zero():
    tel.cost_delta("s", 0.8)
    # session.cost_usd reset to 0 by /clear -> never emit a negative row
    assert tel.cost_delta("s", 0.0) == 0.0


def test_forget_session_resets_baseline():
    tel.cost_delta("s", 0.8)
    tel.forget_session("s")
    assert tel.cost_delta("s", 0.2) == 0.2


# ---- submission ids ----

def test_next_seq_is_monotonic_per_session():
    assert tel._next_seq("s") == 1
    assert tel._next_seq("s") == 2
    assert tel._next_seq("t") == 1  # independent per session


# ---- payload shape ----

def test_build_cost_body_shape():
    body = tel.build_cost_body("inst", "s:1", "anthropic", "opus", 100, 20, 0.0123)
    assert body == {
        "install_id": "inst",
        "submission_id": "s:1",
        "provider": "anthropic",
        "model": "opus",
        "input_tokens": 100,
        "output_tokens": 20,
        "cost_usd": 0.0123,
    }


def test_build_cost_body_defaults_provider():
    body = tel.build_cost_body(None, "s:1", "", "", 0, 0, 0.0)
    assert body["provider"] == "anthropic"


# ---- signed-out no-op ----

def test_emit_turn_cost_noop_when_signed_out(monkeypatch):
    posted = []
    monkeypatch.setattr(tel, "_account", lambda: (None, tel.FREESWARM_DEFAULT_PROXY_URL, None))
    monkeypatch.setattr(tel, "_schedule", lambda coro: posted.append(coro))
    tel.emit_turn_cost("s", "opus", "anthropic", 0.5, 100, 20)
    assert posted == []  # nothing scheduled without an account bearer


def test_emit_turn_cost_skips_zero_cost_zero_tokens(monkeypatch):
    called = []
    monkeypatch.setattr(tel, "_account", lambda: ("tok", "http://x", "inst"))
    monkeypatch.setattr(tel, "_schedule", lambda coro: called.append(coro) or coro.close())
    tel.emit_turn_cost("s", "opus", "anthropic", 0.0, 0, 0)
    assert called == []


def test_emit_turn_cost_emits_on_free_route_with_tokens(monkeypatch):
    bodies = []

    def fake_schedule(coro):
        coro.close()

    monkeypatch.setattr(tel, "_account", lambda: ("tok", "http://x", "inst"))
    monkeypatch.setattr(tel, "_schedule", fake_schedule)
    monkeypatch.setattr(tel, "build_cost_body", lambda *a: bodies.append(a) or {})
    tel.emit_turn_cost("s", "opus", "anthropic", 0.0, 500, 100)
    assert len(bodies) == 1  # zero cost but real token volume still recorded
