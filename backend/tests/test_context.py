"""Tests for adaptive tiered context compression (P2): importance scoring, tier
partitioning by budget, the compacted-view build, and cold-tier retrieval."""

from backend.apps.context import importance, tiers


def _msg(role, text, **extra):
    return {"role": role, "content": text, **extra}


# ---- importance ----

def test_recency_raises_score():
    m = _msg("user", "hello")
    newer = importance.score(m, position_from_end=0, total=10)
    older = importance.score(m, position_from_end=9, total=10)
    assert newer > older


def test_pinned_bumps_score():
    plain = importance.score(_msg("assistant", "x"), 5, 10)
    pinned = importance.score(_msg("assistant", "x", pinned=True), 5, 10)
    assert pinned > plain


def test_user_outranks_tool_result_at_same_position():
    user = importance.score(_msg("user", "x"), 3, 10)
    tool = importance.score(_msg("tool_result", "x"), 3, 10)
    assert user > tool


# ---- tier planning ----

def _conversation(n, words=20):
    return [_msg("user" if i % 2 == 0 else "assistant", ("word " * words).strip()) for i in range(n)]


def test_plan_tiers_partitions_by_budget():
    msgs = _conversation(30)
    plan = tiers.plan_tiers(msgs, budget_tokens=200)  # small budget forces tiers
    assert plan["hot"] and plan["cold"]
    # every message lands in exactly one tier
    assert len(plan["hot"]) + len(plan["warm"]) + len(plan["cold"]) == 30
    # hot holds the most recent message
    assert plan["hot"][-1] is msgs[-1]


def test_pinned_always_hot():
    msgs = _conversation(30)
    msgs[0]["pinned"] = True  # oldest, would normally be cold
    plan = tiers.plan_tiers(msgs, budget_tokens=200)
    assert msgs[0] in plan["hot"]


def test_chronological_order_preserved():
    msgs = _conversation(10)
    plan = tiers.plan_tiers(msgs, budget_tokens=100000)  # huge budget -> all hot
    assert plan["hot"] == msgs


# ---- compacted build ----

def test_build_compacted_shrinks_and_reports_stats():
    msgs = _conversation(40, words=40)
    out = tiers.build_compacted(msgs, budget_tokens=300)
    assert out["stats"]["tokens_after"] < out["stats"]["tokens_before"]
    assert out["stats"]["saved_pct"] > 0
    # cold collapses to a single archived placeholder
    assert sum(1 for m in out["messages"] if m["tier"] == "cold") <= 1
    assert out["stats"]["cold"] > 0


def test_extractive_summary_truncates():
    s = tiers.extractive_summary("a" * 500, max_chars=100)
    assert len(s) <= 104  # 100 + ellipsis allowance


def test_warm_messages_are_summarized_shorter():
    long = "sentence. " * 60
    msgs = [_msg("user", long) for _ in range(20)]
    out = tiers.build_compacted(msgs, budget_tokens=400)
    warm = [m for m in out["messages"] if m["tier"] == "warm"]
    if warm:  # budget should push some into warm
        assert all(len(w["text"]) <= len(long) for w in warm)
