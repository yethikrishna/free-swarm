"""Tests for the benchmark scoring core (Tier 1)."""

from backend.apps.benchmark import score


def _rec(name, passed, cost, turns):
    return {"name": name, "passed": passed, "cost_usd": cost, "turns": turns}


def test_all_pass_is_grade_a():
    recs = [_rec("a", True, 0.01, 2), _rec("b", True, 0.02, 3)]
    g = score.grade_run(recs)
    assert g["pass_rate"] == 1.0 and g["grade"] == "A"
    assert g["passed"] == 2 and g["total"] == 2


def test_grade_thresholds():
    assert score.grade_run([_rec("x", i < 9, 0.01, 1) for i in range(10)])["grade"] == "A"  # 0.90
    assert score.grade_run([_rec("x", i < 8, 0.01, 1) for i in range(10)])["grade"] == "B"  # 0.80
    assert score.grade_run([_rec("x", i < 7, 0.01, 1) for i in range(10)])["grade"] == "C"  # 0.70
    assert score.grade_run([_rec("x", i < 5, 0.01, 1) for i in range(10)])["grade"] == "D"  # 0.50
    assert score.grade_run([_rec("x", False, 0.01, 1) for _ in range(5)])["grade"] == "F"


def test_efficiency_rewards_cheaper_runs():
    cheap = score.grade_run([_rec("a", True, 0.01, 1)])
    pricey = score.grade_run([_rec("a", True, 1.00, 1)])
    # Same pass rate, but the cheaper run scores higher via the efficiency term.
    assert cheap["composite_score"] > pricey["composite_score"]
    assert cheap["efficiency"] > pricey["efficiency"]


def test_cost_per_pass_and_averages():
    recs = [_rec("a", True, 0.10, 2), _rec("b", False, 0.30, 6)]
    g = score.grade_run(recs)
    assert g["total_cost_usd"] == 0.40
    assert g["avg_turns"] == 4.0
    assert g["cost_per_pass_usd"] == 0.40  # 0.40 spent / 1 pass


def test_zero_cases_is_safe():
    g = score.grade_run([])
    assert g["total"] == 0 and g["pass_rate"] == 0.0 and g["grade"] == "F"
    assert g["cost_per_pass_usd"] is None


def test_compare_prefers_correctness_then_cost():
    better = score.grade_run([_rec("a", True, 0.5, 1), _rec("b", True, 0.5, 1)])
    worse = score.grade_run([_rec("a", True, 0.01, 1), _rec("b", False, 0.01, 1)])
    cmp = score.compare(better, worse, "new", "old")
    assert cmp["winner"] == "new"  # higher pass rate wins despite higher cost
    assert cmp["pass_rate_delta"] == 0.5


def test_compare_ties_break_on_composite():
    a = score.grade_run([_rec("a", True, 0.01, 1)])   # cheap
    b = score.grade_run([_rec("a", True, 1.00, 1)])   # pricey, same pass rate
    cmp = score.compare(a, b, "cheap", "pricey")
    assert cmp["winner"] == "cheap"
