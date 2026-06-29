"""Benchmark scoring (Tier 1). Pure + unit-tested.

P12 answers "did this case pass." A benchmark answers "how good is this agent
config overall" by scoring a whole suite run: pass rate, cost/turn efficiency, a
composite 0-100 and a letter grade, plus an A/B comparison so two configs (or
two prompt versions) can be ranked. All pure: feed it per-case records, get a
report. No I/O, no agent stack.

A case record: {name, passed: bool, cost_usd: float, turns: int}.
"""

from __future__ import annotations


def _avg(xs: list[float]) -> float:
    return round(sum(xs) / len(xs), 4) if xs else 0.0


def _grade_letter(pass_rate: float) -> str:
    if pass_rate >= 0.9:
        return "A"
    if pass_rate >= 0.75:
        return "B"
    if pass_rate >= 0.6:
        return "C"
    if pass_rate >= 0.4:
        return "D"
    return "F"


def grade_run(case_records: list[dict], cost_weight: float = 0.2) -> dict:
    """Score a suite run. The composite is pass-rate dominant (the point is
    correctness) with a small efficiency bonus so that, among equally-correct
    configs, the cheaper one ranks higher. cost_weight in [0,1] is the slice of
    the score governed by efficiency."""
    records = [r for r in (case_records or []) if isinstance(r, dict)]
    total = len(records)
    passed = sum(1 for r in records if r.get("passed"))
    pass_rate = passed / total if total else 0.0

    costs = [float(r.get("cost_usd") or 0.0) for r in records]
    turns = [int(r.get("turns") or 0) for r in records]
    total_cost = round(sum(costs), 4)

    # Efficiency: cost spent per passing case (lower is better). Mapped to a 0..1
    # score with a soft reference of $0.10/pass, so cheap suites score near 1.
    cost_per_pass = (total_cost / passed) if passed else None
    if cost_per_pass is None:
        efficiency = 0.0
    else:
        efficiency = max(0.0, min(1.0, 0.10 / cost_per_pass)) if cost_per_pass > 0 else 1.0

    cw = max(0.0, min(1.0, cost_weight))
    composite = round(100 * ((1 - cw) * pass_rate + cw * efficiency), 1)

    return {
        "total": total,
        "passed": passed,
        "pass_rate": round(pass_rate, 4),
        "grade": _grade_letter(pass_rate),
        "avg_cost_usd": _avg(costs),
        "total_cost_usd": total_cost,
        "avg_turns": _avg([float(t) for t in turns]),
        "cost_per_pass_usd": round(cost_per_pass, 4) if cost_per_pass is not None else None,
        "efficiency": round(efficiency, 4),
        "composite_score": composite,
    }


def compare(run_a: dict, run_b: dict, label_a: str = "A", label_b: str = "B") -> dict:
    """Rank two graded runs. Correctness wins first (higher pass_rate); ties break
    on the composite (which folds in cost). Returns the winner + the deltas."""
    a_rate, b_rate = run_a.get("pass_rate", 0.0), run_b.get("pass_rate", 0.0)
    if a_rate != b_rate:
        winner = label_a if a_rate > b_rate else label_b
    else:
        a_c, b_c = run_a.get("composite_score", 0.0), run_b.get("composite_score", 0.0)
        winner = label_a if a_c >= b_c else label_b
    return {
        "winner": winner,
        "pass_rate_delta": round(a_rate - b_rate, 4),
        "cost_delta_usd": round((run_a.get("total_cost_usd") or 0.0) - (run_b.get("total_cost_usd") or 0.0), 4),
        "composite_delta": round((run_a.get("composite_score") or 0.0) - (run_b.get("composite_score") or 0.0), 1),
    }
