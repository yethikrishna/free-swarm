"""Tests for the rewind timeline + approval-gate policy (P4)."""

from backend.apps.rewind import timeline as tl
from backend.apps.rewind import gates


def _u(mid, text, branch="main"):
    return {"id": mid, "role": "user", "content": text, "branch_id": branch}


def _a(text, branch="main"):
    return {"id": "a_" + text[:4], "role": "assistant", "content": text, "branch_id": branch}


def _tc(name, branch="main"):
    return {"id": "t_" + name, "role": "tool_call", "content": {"name": name}, "branch_id": branch}


# ---- timeline ----

def test_one_checkpoint_per_user_turn():
    msgs = [_u("m1", "first"), _a("reply"), _u("m2", "second"), _a("reply2")]
    out = tl.build_timeline(msgs)
    assert out["count"] == 2
    assert [c["message_id"] for c in out["checkpoints"]] == ["m1", "m2"]


def test_checkpoint_collects_following_tools_and_replies():
    msgs = [_u("m1", "do it"), _tc("Read"), _tc("Read"), _tc("Bash"), _a("done"), _u("m2", "next")]
    cp = tl.build_timeline(msgs)["checkpoints"][0]
    assert cp["tools"] == ["Read", "Bash"]  # deduped, in order
    assert cp["replies"] == 1


def test_rewindable_only_on_active_branch():
    msgs = [_u("m1", "main turn", "main"), _u("m2", "side turn", "side")]
    out = tl.build_timeline(msgs, active_branch_id="main")
    by_id = {c["message_id"]: c for c in out["checkpoints"]}
    assert by_id["m1"]["rewindable"]
    assert not by_id["m2"]["rewindable"]


def test_summary_truncates_long_text():
    cp = tl.build_timeline([_u("m1", "x" * 200)])["checkpoints"][0]
    assert len(cp["summary"]) <= 80 and cp["summary"].endswith("...")


def test_find_checkpoint():
    out = tl.build_timeline([_u("m1", "a"), _a("b"), _u("m2", "c")])
    assert tl.find_checkpoint(out, "m2")["turn"] == 1
    assert tl.find_checkpoint(out, "nope") is None


# ---- gates ----

def test_first_matching_rule_wins():
    rules = [
        {"pattern": "Read", "action": "allow"},
        {"pattern": "*", "action": "gate"},
    ]
    assert gates.decide("Read", None, rules)["action"] == "allow"
    assert gates.decide("Bash", None, rules)["action"] == "gate"


def test_default_action_when_no_rule_matches():
    d = gates.decide("Edit", None, [{"pattern": "Bash", "action": "deny"}], default_action="allow")
    assert d["action"] == "allow" and d["rule_index"] is None


def test_arg_contains_narrows_the_rule():
    rules = [{"pattern": "Bash", "action": "deny", "arg_contains": "rm -rf"}]
    assert gates.decide("Bash", {"command": "rm -rf /"}, rules)["action"] == "deny"
    # same tool, arg doesn't contain the needle -> rule skipped -> default
    assert gates.decide("Bash", {"command": "ls"}, rules)["action"] == "allow"


def test_glob_pattern_matches_mcp_tools():
    rules = [{"pattern": "mcp__*", "action": "gate"}]
    assert gates.decide("mcp__github__merge", None, rules)["action"] == "gate"
    assert gates.decide("Read", None, rules)["action"] == "allow"


def test_validate_rules_flags_bad_action():
    problems = gates.validate_rules([{"pattern": "Bash", "action": "nuke"}])
    assert problems and "action must be one of" in problems[0]


def test_decide_reports_which_rule():
    rules = [{"pattern": "Bash", "action": "gate", "reason": "shell is risky"}]
    d = gates.decide("Bash", None, rules)
    assert d["rule_index"] == 0 and d["reason"] == "shell is risky"
