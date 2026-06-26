"""Tests for agent-native testing/CI (P12): assertion evaluation, outcome diff,
suite aggregation, and replay-log outcome reconstruction."""

from backend.apps.testing import assertions as A
from backend.apps.testing.diff import diff_outcomes
from backend.apps.testing.suite import run_suite, run_case
from backend.apps.testing.runner import outcome_from_records


def _outcome(**kw):
    base = {"final_text": "", "tools_used": [], "status": "completed",
            "error": None, "cost_usd": 0.0, "turns": 1}
    base.update(kw)
    return base


# ---- assertions ----

def test_final_contains_is_case_insensitive():
    o = _outcome(final_text="The Answer is 42")
    assert A.evaluate(o, {"type": "final_contains", "value": "answer"})["ok"]
    assert not A.evaluate(o, {"type": "final_contains", "value": "wrong"})["ok"]


def test_tool_used_and_not_used():
    o = _outcome(tools_used=["Read", "Edit"])
    assert A.evaluate(o, {"type": "tool_used", "value": "Read"})["ok"]
    assert A.evaluate(o, {"type": "tool_not_used", "value": "Bash"})["ok"]
    assert not A.evaluate(o, {"type": "tool_not_used", "value": "Edit"})["ok"]


def test_no_error_reflects_status():
    assert A.evaluate(_outcome(status="completed"), {"type": "no_error"})["ok"]
    assert not A.evaluate(_outcome(status="error"), {"type": "no_error"})["ok"]
    assert not A.evaluate(_outcome(error="boom"), {"type": "no_error"})["ok"]


def test_cost_and_turns_bounds():
    o = _outcome(cost_usd=0.02, turns=3)
    assert A.evaluate(o, {"type": "cost_under", "value": 0.05})["ok"]
    assert not A.evaluate(o, {"type": "cost_under", "value": 0.01})["ok"]
    assert A.evaluate(o, {"type": "turns_under", "value": 5})["ok"]
    assert not A.evaluate(o, {"type": "turns_under", "value": 2})["ok"]


def test_regex_and_bad_regex_fails_closed():
    o = _outcome(final_text="order #12345 shipped")
    assert A.evaluate(o, {"type": "final_regex", "value": r"#\d+"})["ok"]
    assert not A.evaluate(o, {"type": "final_regex", "value": "["})["ok"]  # invalid regex


def test_unknown_type_fails_closed():
    assert not A.evaluate(_outcome(), {"type": "does_not_exist"})["ok"]


def test_evaluate_all_requires_every_assertion():
    o = _outcome(final_text="hello world", tools_used=["Read"])
    good = A.evaluate_all(o, [
        {"type": "final_contains", "value": "hello"},
        {"type": "tool_used", "value": "Read"},
    ])
    assert good["passed"] and good["failed"] == 0
    bad = A.evaluate_all(o, [
        {"type": "final_contains", "value": "hello"},
        {"type": "tool_used", "value": "Bash"},
    ])
    assert not bad["passed"] and bad["failed"] == 1


# ---- diff ----

def test_diff_flags_changed_fields_and_tools():
    g = _outcome(final_text="A", tools_used=["Read"], cost_usd=0.01)
    a = _outcome(final_text="B", tools_used=["Read", "Bash"], cost_usd=0.01)
    d = diff_outcomes(g, a)
    assert d["changed"]
    assert d["fields"]["final_text"]["changed"]
    assert d["tools"]["added"] == ["Bash"]
    assert not d["fields"]["cost_usd"]["changed"]  # within tolerance


def test_diff_identical_is_unchanged():
    o = _outcome(final_text="same", tools_used=["Read"])
    assert not diff_outcomes(o, dict(o))["changed"]


# ---- suite ----

def test_run_suite_aggregates_green():
    suite = {
        "id": "s1", "name": "smoke",
        "cases": [
            {"id": "c1", "assertions": [{"type": "final_contains", "value": "ok"}]},
            {"id": "c2", "assertions": [{"type": "no_error"}]},
        ],
    }
    outcomes = {"c1": _outcome(final_text="all ok"), "c2": _outcome(status="completed")}
    report = run_suite(suite, lambda case: outcomes[case["id"]])
    assert report["green"] and report["passed"] == 2 and report["failed"] == 0


def test_run_suite_marks_unresolvable_case_failed_but_continues():
    suite = {"id": "s2", "cases": [
        {"id": "bad", "assertions": [{"type": "no_error"}]},
        {"id": "good", "assertions": [{"type": "no_error"}]},
    ]}

    def resolve(case):
        if case["id"] == "bad":
            raise RuntimeError("no log")
        return _outcome()

    report = run_suite(suite, resolve)
    assert report["total"] == 2 and report["passed"] == 1
    assert not report["green"]


def test_run_case_attaches_diff_when_golden_present():
    case = {"id": "c", "assertions": [{"type": "no_error"}],
            "golden": _outcome(final_text="old")}
    res = run_case(case, _outcome(final_text="new"))
    assert res["passed"] and res["diff"]["fields"]["final_text"]["changed"]


# ---- replay reconstruction ----

def test_outcome_from_records_reconstructs():
    records = [
        {"seq": 0, "kind": "model", "value": "thinking..."},
        {"seq": 1, "kind": "tool", "key": "Read", "value": {"text": "file body"}},
        {"seq": 2, "kind": "tool", "key": "Read", "value": {"text": "again"}},
        {"seq": 3, "kind": "model", "value": "done, the answer is 42"},
    ]
    o = outcome_from_records(records)
    assert o["final_text"] == "done, the answer is 42"
    assert o["tools_used"] == ["Read"]  # deduped
    assert o["turns"] == 2 and o["status"] == "completed"


def test_outcome_from_empty_records():
    o = outcome_from_records([])
    assert o["status"] == "empty" and o["turns"] == 0
