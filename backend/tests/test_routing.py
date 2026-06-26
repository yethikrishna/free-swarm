"""Tests for per-turn model routing (P10): difficulty classifier, ladder build,
the pure rung chooser + budget governor, and the policy store."""

import pytest

from backend.apps.routing import classifier, ladder as ladder_mod, router, policy as policy_mod


# ---- classifier ----

def test_trivial_short_prompt():
    assert classifier.classify("rename the variable foo to bar")["level"] in ("trivial", "easy")


def test_hard_architectural_prompt():
    p = ("Refactor the concurrency model to remove the race condition in the "
         "scheduler, analyze the deadlock, and optimize the async dispatch path. "
         "Explain why the current design does not scale.")
    assert classifier.classify(p)["level"] == "hard"


def test_code_block_bumps_difficulty():
    plain = classifier.score_prompt("fix this")
    withcode = classifier.score_prompt("fix this\n```\nTraceback (most recent call last):\n```")
    assert withcode > plain


def test_score_is_bounded():
    assert 0.0 <= classifier.score_prompt("x" * 10000) <= 1.0


def test_signals_images_bump():
    prompt = "Describe what you see in the attached screenshot in detail."
    base = classifier.score_prompt(prompt)
    withimg = classifier.score_prompt(prompt, {"has_images": True})
    assert withimg > base


# ---- ladder ----

def test_ladder_anthropic_default_lane_cheap_first():
    rungs = ladder_mod.ladder_for("sonnet")
    assert rungs[0] == "haiku"          # cheapest rung first
    assert "sonnet" in rungs
    assert rungs.index("haiku") < rungs.index("sonnet")


def test_ladder_unknown_model_is_single_rung():
    assert ladder_mod.ladder_for("custom/foo/bar-1") == ["custom/foo/bar-1"]


def test_ladder_keeps_lane_separate():
    # API-key lane shouldn't be mixed into the default/pro lane.
    rungs = ladder_mod.ladder_for("sonnet")
    assert all(not r.endswith("-api") for r in rungs)


# ---- pure chooser + governor ----

def test_target_rung_scales_with_level():
    n = 5
    assert router.target_rung("trivial", n, None) == 0
    assert router.target_rung("hard", n, None) == n - 1
    assert 0 < router.target_rung("medium", n, None) < n - 1


def test_budget_governor_caps_top_rung():
    n = 5
    # Hard turn would pick rung 4, but an almost-empty budget shaves it down.
    full = router.target_rung("hard", n, 1.0)
    low = router.target_rung("hard", n, 0.1)
    assert full == 4
    assert low < full


def test_empty_budget_pins_cheapest():
    assert router.target_rung("hard", 5, 0.0) == 0


def test_choose_returns_ladder_member():
    rungs = ["haiku", "sonnet", "opus"]
    assert router.choose(rungs, "trivial") == "haiku"
    assert router.choose(rungs, "hard") == "opus"
    assert router.choose([], "hard") is None


# ---- policy store ----

@pytest.fixture(autouse=True)
def isolate_policy(tmp_path, monkeypatch):
    monkeypatch.setattr(policy_mod, "_POLICY_FILE", str(tmp_path / "policy.json"))
    yield


def test_policy_defaults_disabled():
    p = policy_mod.load_policy(now=1_000_000.0)
    assert p["enabled"] is False
    assert policy_mod.budget_fraction(p) is None


def test_set_and_budget_fraction():
    policy_mod.set_policy({"enabled": True, "daily_budget_usd": 10.0}, now=1_000_000.0)
    p = policy_mod.record_spend(4.0, now=1_000_000.0)
    assert policy_mod.budget_fraction(p) == pytest.approx(0.6)


def test_spend_resets_on_new_day():
    policy_mod.set_policy({"daily_budget_usd": 10.0}, now=1_000_000.0)
    policy_mod.record_spend(8.0, now=1_000_000.0)
    # ~2 days later the per-day spend should have rolled back to 0.
    p = policy_mod.load_policy(now=1_000_000.0 + 2 * 86400)
    assert p["spent_today_usd"] == 0.0


def test_pick_disabled_keeps_selected_model():
    policy_mod.set_policy({"enabled": False}, now=1_000_000.0)
    d = router.pick("rename foo", "opus", now=1_000_000.0)
    assert d["enabled"] is False
    # decision still computed for preview, but a hard-coded model stays selected
    assert d["selected_model"] == "opus"
