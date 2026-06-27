"""Tests for the observability/tracing span core (Tier 1)."""

from backend.apps.tracing import spans


def _session(**kw):
    base = {
        "agent_active_ms": 10000,
        "cost_usd": 0.05,
        "tokens": {"input": 1200, "output": 800},
        "time_per_model": {"sonnet": 7000, "haiku": 3000},
        "tool_latencies": {
            "Read": {"count": 5, "total_ms": 500, "max_ms": 200},
            "Bash": {"count": 2, "total_ms": 4000, "max_ms": 3000},
        },
    }
    base.update(kw)
    return base


def test_summary_aggregates():
    t = spans.build_trace(_session())
    s = t["summary"]
    assert s["active_ms"] == 10000
    assert s["cost_usd"] == 0.05
    assert s["tool_calls"] == 7  # 5 + 2
    assert s["distinct_tools"] == 2
    assert s["input_tokens"] == 1200 and s["output_tokens"] == 800
    assert s["models_used"] == 2


def test_tools_sorted_by_total_time_desc():
    t = spans.build_trace(_session())
    assert [x["tool"] for x in t["tools"]] == ["Bash", "Read"]
    bash = t["tools"][0]
    assert bash["avg_ms"] == 2000.0  # 4000 / 2
    assert bash["pct_of_active"] == 40.0  # 4000 / 10000


def test_models_sorted_and_pct():
    t = spans.build_trace(_session())
    assert t["models"][0]["model"] == "sonnet"
    assert t["models"][0]["pct_of_active"] == 70.0


def test_hotspots_are_top_three_slowest():
    sess = _session(tool_latencies={
        "A": {"count": 1, "total_ms": 100, "max_ms": 100},
        "B": {"count": 1, "total_ms": 900, "max_ms": 900},
        "C": {"count": 1, "total_ms": 500, "max_ms": 500},
        "D": {"count": 1, "total_ms": 50, "max_ms": 50},
    })
    t = spans.build_trace(sess)
    assert [x["tool"] for x in t["hotspots"]] == ["B", "C", "A"]
    assert len(t["hotspots"]) == 3


def test_empty_session_is_safe():
    t = spans.build_trace({})
    assert t["summary"]["active_ms"] == 0
    assert t["tools"] == [] and t["models"] == [] and t["hotspots"] == []


def test_zero_active_ms_no_divide_by_zero():
    sess = _session(agent_active_ms=0)
    t = spans.build_trace(sess)
    assert t["tools"][0]["pct_of_active"] == 0.0


def test_malformed_tool_stat_skipped():
    sess = _session(tool_latencies={"Read": "not a dict", "Bash": {"count": 1, "total_ms": 10, "max_ms": 10}})
    t = spans.build_trace(sess)
    assert [x["tool"] for x in t["tools"]] == ["Bash"]
