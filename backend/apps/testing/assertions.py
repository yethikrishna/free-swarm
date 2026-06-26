"""Assertion core for agent-native testing (P12). Pure + unit-tested.

A test asserts something about a session's *outcome*, the normalized result of a
run: what the agent finally said, which tools it used, whether it errored, what
it cost, how many turns it took. Because P9 replay makes a run reproducible, the
same recorded session re-evaluated against new code is a regression test.

An assertion is `{type, value?, target?}`. `evaluate` is pure: outcome + one
assertion -> a verdict `{ok, detail}`. No I/O, no agent stack.
"""

from __future__ import annotations

import re
from typing import Any

# The normalized shape every runner must produce. Documented here so the seam
# and the assertions agree on field names.
OUTCOME_FIELDS = ("final_text", "tools_used", "status", "error", "cost_usd", "turns")

TYPES = (
    "final_contains", "final_not_contains", "final_equals", "final_regex",
    "tool_used", "tool_not_used",
    "status_is", "no_error",
    "cost_under", "turns_under",
)


def _final(outcome: dict) -> str:
    return str(outcome.get("final_text") or "")


def _tools(outcome: dict) -> list[str]:
    return [str(t) for t in (outcome.get("tools_used") or [])]


def _verdict(ok: bool, detail: str) -> dict:
    return {"ok": bool(ok), "detail": detail}


def evaluate(outcome: dict, assertion: dict) -> dict:
    """Evaluate one assertion against an outcome. Always returns a verdict; an
    unknown type or a malformed value fails closed (ok=False) rather than raising,
    so one bad assertion can't abort a suite run."""
    a_type = assertion.get("type")
    value = assertion.get("value")

    if a_type == "final_contains":
        ok = str(value or "").lower() in _final(outcome).lower()
        return _verdict(ok, f"final text {'contains' if ok else 'is missing'} {value!r}")
    if a_type == "final_not_contains":
        ok = str(value or "").lower() not in _final(outcome).lower()
        return _verdict(ok, f"final text {'omits' if ok else 'unexpectedly contains'} {value!r}")
    if a_type == "final_equals":
        ok = _final(outcome).strip() == str(value or "").strip()
        return _verdict(ok, "final text matches exactly" if ok else "final text differs")
    if a_type == "final_regex":
        try:
            ok = re.search(str(value or ""), _final(outcome)) is not None
        except re.error as e:
            return _verdict(False, f"bad regex: {e}")
        return _verdict(ok, f"pattern {value!r} {'matched' if ok else 'did not match'}")

    if a_type == "tool_used":
        ok = str(value) in _tools(outcome)
        return _verdict(ok, f"tool {value!r} {'was' if ok else 'was not'} used")
    if a_type == "tool_not_used":
        ok = str(value) not in _tools(outcome)
        return _verdict(ok, f"tool {value!r} {'avoided' if ok else 'unexpectedly used'}")

    if a_type == "status_is":
        ok = str(outcome.get("status") or "") == str(value)
        return _verdict(ok, f"status is {outcome.get('status')!r}, expected {value!r}")
    if a_type == "no_error":
        err = outcome.get("error")
        ok = not err and str(outcome.get("status") or "") != "error"
        return _verdict(ok, "no error" if ok else f"errored: {err or outcome.get('status')}")

    if a_type == "cost_under":
        try:
            ok = float(outcome.get("cost_usd") or 0.0) <= float(value)
        except (TypeError, ValueError):
            return _verdict(False, f"cost_under needs a number, got {value!r}")
        return _verdict(ok, f"cost ${outcome.get('cost_usd') or 0.0:.4f} vs cap ${float(value):.4f}")
    if a_type == "turns_under":
        try:
            ok = int(outcome.get("turns") or 0) <= int(value)
        except (TypeError, ValueError):
            return _verdict(False, f"turns_under needs an int, got {value!r}")
        return _verdict(ok, f"{outcome.get('turns') or 0} turns vs cap {value}")

    return _verdict(False, f"unknown assertion type {a_type!r}")


def evaluate_all(outcome: dict, assertions: list[dict]) -> dict:
    """Evaluate a case's assertions. A case passes only if every assertion does."""
    results = [{"assertion": a, **evaluate(outcome, a)} for a in (assertions or [])]
    passed = all(r["ok"] for r in results) if results else False
    return {
        "passed": passed,
        "results": results,
        "total": len(results),
        "failed": sum(1 for r in results if not r["ok"]),
    }


def extract_outcome(record: Any) -> dict:
    """Coerce a free-form session/replay snapshot into the normalized outcome
    shape, defaulting any missing field. Keeps assertion code total: every field
    is always present and the right type."""
    record = record if isinstance(record, dict) else {}
    return {
        "final_text": str(record.get("final_text") or ""),
        "tools_used": [str(t) for t in (record.get("tools_used") or [])],
        "status": str(record.get("status") or ""),
        "error": record.get("error"),
        "cost_usd": float(record.get("cost_usd") or 0.0),
        "turns": int(record.get("turns") or 0),
    }
