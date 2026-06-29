"""Agent observability core (Tier 1). Pure + unit-tested.

Turns the per-turn timing the agent loop already records on a session
(`tool_latencies`, `time_per_model`, `agent_active_ms`, cost, tokens) into a
span/timeline view + hotspot ranking, so "why was this run slow or expensive"
is answerable without new instrumentation. No agent imports, no I/O.
"""

from __future__ import annotations


def _pct(part: float, whole: float) -> float:
    return round(100.0 * part / whole, 1) if whole else 0.0


def build_trace(session: dict) -> dict:
    """Aggregate a session's recorded timings into tool + model spans, a summary,
    and the slowest tools. `session` is a model_dump-style dict."""
    tool_latencies = session.get("tool_latencies") or {}
    time_per_model = session.get("time_per_model") or {}
    active_ms = int(session.get("agent_active_ms") or 0)

    tools: list[dict] = []
    total_calls = 0
    for name, stat in tool_latencies.items():
        if not isinstance(stat, dict):
            continue
        count = int(stat.get("count") or 0)
        total = int(stat.get("total_ms") or 0)
        mx = int(stat.get("max_ms") or 0)
        total_calls += count
        tools.append({
            "tool": name,
            "calls": count,
            "total_ms": total,
            "avg_ms": round(total / count, 1) if count else 0.0,
            "max_ms": mx,
            "pct_of_active": _pct(total, active_ms),
        })
    tools.sort(key=lambda t: t["total_ms"], reverse=True)

    models: list[dict] = []
    for name, ms in time_per_model.items():
        ms = int(ms or 0)
        models.append({"model": name, "ms": ms, "pct_of_active": _pct(ms, active_ms)})
    models.sort(key=lambda m: m["ms"], reverse=True)

    tokens = session.get("tokens") or {}
    summary = {
        "active_ms": active_ms,
        "cost_usd": float(session.get("cost_usd") or 0.0),
        "tool_calls": total_calls,
        "distinct_tools": len(tools),
        "input_tokens": int(tokens.get("input") or 0),
        "output_tokens": int(tokens.get("output") or 0),
        "models_used": len(models),
    }

    return {
        "summary": summary,
        "tools": tools,
        "models": models,
        "hotspots": tools[:3],
    }
