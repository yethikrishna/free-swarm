"""Outcome diffing for P12. Pure + unit-tested.

When a case has a recorded *golden* outcome (captured when it last passed), a
regression run diffs the fresh outcome against it: which fields drifted, did a
tool appear or vanish, did the final text change. This is the signal a human
reviews when an assertion suite is too coarse to catch a subtle behavior change.
"""

from __future__ import annotations

from backend.apps.testing.assertions import extract_outcome


def _short(text: str, n: int = 160) -> str:
    text = text or ""
    return text if len(text) <= n else text[:n] + "..."


def diff_outcomes(golden: dict, actual: dict) -> dict:
    """Field-level diff between two normalized outcomes. Returns a stable, JSON-
    friendly structure: per-field {changed, golden, actual} plus tool set deltas."""
    g = extract_outcome(golden)
    a = extract_outcome(actual)

    fields: dict[str, dict] = {}
    for key in ("status", "error", "turns"):
        fields[key] = {"changed": g[key] != a[key], "golden": g[key], "actual": a[key]}

    # Cost compared with tolerance: float noise shouldn't read as a regression.
    cost_changed = abs(g["cost_usd"] - a["cost_usd"]) > 1e-6
    fields["cost_usd"] = {"changed": cost_changed, "golden": g["cost_usd"], "actual": a["cost_usd"]}

    text_changed = g["final_text"].strip() != a["final_text"].strip()
    fields["final_text"] = {
        "changed": text_changed,
        "golden": _short(g["final_text"]),
        "actual": _short(a["final_text"]),
    }

    g_tools, a_tools = set(g["tools_used"]), set(a["tools_used"])
    tools = {
        "added": sorted(a_tools - g_tools),
        "removed": sorted(g_tools - a_tools),
        "changed": g_tools != a_tools,
    }

    any_changed = tools["changed"] or any(f["changed"] for f in fields.values())
    return {"changed": any_changed, "fields": fields, "tools": tools}
