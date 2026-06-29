"""Benchmark SubApp (Tier 1): grade an agent config by scoring a P12 suite run.

Builds on P12: a suite of cases is run (outcomes reconstructed from replay logs or
read live), each case's pass/cost/turns feeds the pure scorer, and the result is
a graded report (pass rate, efficiency, composite, letter grade). /compare ranks
two graded runs so prompt/model A/B tests are quantitative.

Routes (prefix /api/benchmark):
  POST /grade   {case_records, cost_weight?}      pure: score per-case records
  POST /compare {run_a, run_b, label_a?, label_b?}  pure: rank two graded runs
  POST /run/{suite_id}                            run a P12 suite, then grade it
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel
from typeguard import typechecked

from backend.config.Apps import SubApp
from backend.apps.benchmark import score
from backend.apps.testing import store as testing_store
from backend.apps.testing import runner as testing_runner
from backend.apps.testing.assertions import extract_outcome
from backend.apps.testing.suite import run_case


@asynccontextmanager
async def benchmark_lifespan():
    yield


benchmark = SubApp("benchmark", benchmark_lifespan)


class GradeBody(BaseModel):
    case_records: list
    cost_weight: Optional[float] = None


class CompareBody(BaseModel):
    run_a: dict
    run_b: dict
    label_a: Optional[str] = None
    label_b: Optional[str] = None


@benchmark.router.post("/grade")
@typechecked
async def grade(body: GradeBody) -> dict:
    records = [r for r in body.case_records if isinstance(r, dict)]
    cw = body.cost_weight if body.cost_weight is not None else 0.2
    return score.grade_run(records, cost_weight=cw)


@benchmark.router.post("/compare")
@typechecked
async def compare(body: CompareBody) -> dict:
    return score.compare(body.run_a, body.run_b, body.label_a or "A", body.label_b or "B")


@benchmark.router.post("/run/{suite_id}")
@typechecked
async def run_and_grade(suite_id: str) -> dict:
    suite = testing_store.get_suite(suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")

    records: list[dict] = []
    case_details: list[dict] = []
    for case in suite.get("cases") or []:
        try:
            outcome = extract_outcome(testing_runner.resolve_outcome(case))
        except Exception as e:
            records.append({"name": case.get("name"), "passed": False, "cost_usd": 0.0, "turns": 0})
            case_details.append({"name": case.get("name"), "passed": False, "error": str(e)})
            continue
        result = run_case(case, outcome)
        records.append({
            "name": result.get("name"),
            "passed": result.get("passed", False),
            "cost_usd": outcome.get("cost_usd", 0.0),
            "turns": outcome.get("turns", 0),
        })
        case_details.append(result)

    return {"report": score.grade_run(records), "cases": case_details}
