"""Testing SubApp (P12): agent-native regression tests on top of P9 replay.

A suite holds cases; a case pairs assertions (and an optional golden outcome)
with a recorded session to replay. `POST /run` resolves each case's outcome
(reconstructed from the replay log by default, or re-run live through the wired
runner), evaluates the assertions, diffs against golden, and returns a red/green
report. `POST /evaluate` is the pure path: assert directly against an outcome you
pass in, no replay needed (handy for CI of agent prompts and for tests).

Routes (prefix /api/testing):
  GET    /suites                       list suites
  POST   /suites {name}                create a suite
  GET    /suites/{id}                  full suite (cases + assertions)
  DELETE /suites/{id}                  delete
  POST   /suites/{id}/cases {...}      add a case
  DELETE /suites/{id}/cases/{cid}      remove a case
  POST   /suites/{id}/run              run the suite -> report
  POST   /suites/{id}/cases/{cid}/bless  store a case's current outcome as golden
  POST   /evaluate {outcome,assertions}  pure: evaluate assertions, no replay
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import HTTPException
from pydantic import BaseModel
from typeguard import typechecked

from backend.config.Apps import SubApp
from backend.apps.testing import store, runner
from backend.apps.testing import assertions as asserts
from backend.apps.testing.suite import run_suite, run_case


@asynccontextmanager
async def testing_lifespan():
    yield


testing = SubApp("testing", testing_lifespan)


class SuiteBody(BaseModel):
    name: Optional[str] = None


class CaseBody(BaseModel):
    name: Optional[str] = None
    replay_session_id: Optional[str] = None
    assertions: list = []
    golden: Optional[dict] = None


class EvaluateBody(BaseModel):
    outcome: dict
    assertions: list = []


@testing.router.get("/suites")
@typechecked
async def list_suites() -> dict:
    return {"suites": store.list_suites()}


@testing.router.post("/suites")
@typechecked
async def create_suite(body: SuiteBody) -> dict:
    return {"suite": store.create_suite(body.name or "", time.time())}


@testing.router.get("/suites/{suite_id}")
@typechecked
async def get_suite(suite_id: str) -> dict:
    suite = store.get_suite(suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    return {"suite": suite}


@testing.router.delete("/suites/{suite_id}")
@typechecked
async def delete_suite(suite_id: str) -> dict:
    if not store.delete_suite(suite_id):
        raise HTTPException(status_code=404, detail="Suite not found")
    return {"ok": True}


@testing.router.post("/suites/{suite_id}/cases")
@typechecked
async def add_case(suite_id: str, body: CaseBody) -> dict:
    bad = [a for a in body.assertions if not (isinstance(a, dict) and a.get("type") in asserts.TYPES)]
    if bad:
        raise HTTPException(status_code=400, detail=f"assertion type must be one of {asserts.TYPES}")
    case = store.add_case(suite_id, body.model_dump(exclude_none=True), time.time())
    if not case:
        raise HTTPException(status_code=404, detail="Suite not found")
    return {"case": case}


@testing.router.delete("/suites/{suite_id}/cases/{case_id}")
@typechecked
async def remove_case(suite_id: str, case_id: str) -> dict:
    if not store.remove_case(suite_id, case_id, time.time()):
        raise HTTPException(status_code=404, detail="Suite or case not found")
    return {"ok": True}


@testing.router.post("/suites/{suite_id}/run")
@typechecked
async def run(suite_id: str) -> dict:
    suite = store.get_suite(suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    report = run_suite(suite, runner.resolve_outcome)
    return {"report": report}


@testing.router.post("/suites/{suite_id}/cases/{case_id}/bless")
@typechecked
async def bless(suite_id: str, case_id: str) -> dict:
    """Run one case, store its fresh outcome as the golden baseline for future
    diffs. The 'accept current behavior as correct' button."""
    suite = store.get_suite(suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    case = next((c for c in suite.get("cases") or [] if c.get("id") == case_id), None)
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    try:
        outcome = runner.resolve_outcome(case)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not resolve outcome: {e}")
    store.set_golden(suite_id, case_id, outcome, time.time())
    return {"golden": outcome, "result": run_case(case, outcome)}


@testing.router.post("/evaluate")
@typechecked
async def evaluate(body: EvaluateBody) -> dict:
    """Pure path: evaluate assertions against an outcome you supply directly."""
    outcome = asserts.extract_outcome(body.outcome)
    return {"outcome": outcome, **asserts.evaluate_all(outcome, body.assertions)}
