"""Suite aggregation for P12. Pure + unit-tested.

A suite is a named collection of cases. Each case pairs assertions with the
recorded session to replay (and, optionally, a golden outcome to diff against).
`run_suite` takes the cases and a resolver that yields each case's actual
outcome, evaluates assertions, diffs against golden, and aggregates a report.

The resolver is a parameter, not an import: in production it replays the P9 log
through the agent stack; in tests it's a dict lookup. So the aggregation logic is
verifiable with zero I/O.
"""

from __future__ import annotations

from typing import Callable

from backend.apps.testing import assertions as asserts
from backend.apps.testing.diff import diff_outcomes


def run_case(case: dict, outcome: dict) -> dict:
    """Evaluate one case against an already-resolved outcome. Pure."""
    normalized = asserts.extract_outcome(outcome)
    verdict = asserts.evaluate_all(normalized, case.get("assertions") or [])
    result = {
        "case_id": case.get("id"),
        "name": case.get("name") or case.get("id"),
        "passed": verdict["passed"],
        "assertions": verdict["results"],
        "failed": verdict["failed"],
        "total": verdict["total"],
    }
    golden = case.get("golden")
    if golden is not None:
        result["diff"] = diff_outcomes(golden, normalized)
    return result


def run_suite(suite: dict, resolve: Callable[[dict], dict]) -> dict:
    """Run every case in a suite. `resolve(case) -> outcome` produces the actual
    outcome (replay in prod, lookup in tests). A resolver that raises marks just
    that case errored; the rest of the suite still runs."""
    case_results: list[dict] = []
    for case in suite.get("cases") or []:
        try:
            outcome = resolve(case)
        except Exception as e:  # one un-runnable case must not sink the suite
            case_results.append({
                "case_id": case.get("id"),
                "name": case.get("name") or case.get("id"),
                "passed": False,
                "error": f"could not resolve outcome: {e}",
                "assertions": [], "failed": 0, "total": 0,
            })
            continue
        case_results.append(run_case(case, outcome))

    passed = sum(1 for r in case_results if r["passed"])
    total = len(case_results)
    return {
        "suite_id": suite.get("id"),
        "name": suite.get("name"),
        "passed": passed,
        "failed": total - passed,
        "total": total,
        "green": total > 0 and passed == total,
        "cases": case_results,
    }
