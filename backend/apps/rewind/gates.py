"""Declarative approval-gate policy (P4). Pure + unit-tested.

The dispatch path already does per-call HITL ("ask before this tool runs"). This
adds the layer above it: a user-configured ruleset that decides, declaratively,
which tools to gate, auto-allow, or hard-deny, before a single request is raised.
A rule is `{pattern, action, reason?, arg_contains?}`:

  pattern       fnmatch over the tool name ("Bash", "mcp__*", "*")
  action        "gate" | "allow" | "deny"
  arg_contains  optional substring that must appear in the stringified tool input
                for the rule to apply (e.g. gate only `Bash` calls containing "rm")

Rules are evaluated in order; first match wins. No match -> default_action.
`decide` is pure, so the policy is verifiable without the dispatch loop. Wiring it
into dispatch is the opt-in seam (advisory by default, like the other phases).
"""

from __future__ import annotations

import fnmatch
from typing import Any

ACTIONS = ("gate", "allow", "deny")


def _input_str(tool_input: Any) -> str:
    if isinstance(tool_input, dict):
        return " ".join(str(v) for v in tool_input.values())
    return "" if tool_input is None else str(tool_input)


def rule_matches(rule: dict, tool_name: str, tool_input: Any) -> bool:
    pattern = rule.get("pattern") or "*"
    if not fnmatch.fnmatch(tool_name or "", pattern):
        return False
    needle = rule.get("arg_contains")
    if needle:
        return str(needle).lower() in _input_str(tool_input).lower()
    return True


def decide(tool_name: str, tool_input: Any, rules: list[dict],
           default_action: str = "allow") -> dict:
    """First matching rule wins; otherwise default. Returns the action plus the
    rule that produced it (or None for the default) so the UI can explain why."""
    for idx, rule in enumerate(rules or []):
        action = rule.get("action")
        if action in ACTIONS and rule_matches(rule, tool_name, tool_input):
            return {
                "action": action,
                "reason": rule.get("reason") or f"matched rule #{idx} ({rule.get('pattern')})",
                "rule_index": idx,
            }
    return {"action": default_action, "reason": "no rule matched; default", "rule_index": None}


def validate_rules(rules: list[dict]) -> list[str]:
    """Return a list of human-readable problems; empty == valid."""
    problems: list[str] = []
    for i, rule in enumerate(rules or []):
        if not isinstance(rule, dict):
            problems.append(f"rule #{i} is not an object")
            continue
        if rule.get("action") not in ACTIONS:
            problems.append(f"rule #{i}: action must be one of {ACTIONS}")
        if "pattern" in rule and not isinstance(rule["pattern"], str):
            problems.append(f"rule #{i}: pattern must be a string")
    return problems
