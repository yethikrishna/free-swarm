"""Live activation of the advisory engines (Tier 0). One thin, defensive seam the
turn loop calls so the engines can affect a real run, while keeping every change
safe-by-construction:

  - Off by default. Each engine carries its own opt-in flag (routing policy's
    `enabled`, gate policy's `enforce`), both default false, so an untouched
    install behaves exactly as before.
  - Never raises. Every entry point swallows errors and returns the unchanged
    input, so flipping a flag on can, at worst, have no effect, never break a turn.
  - Monotonic on safety. The gate may only ADD friction (allow -> ask -> deny),
    never remove it, so it can't downgrade an existing permission.

agent_manager calls these as pure pass-throughs; the engines stay leaf modules.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def routed_model(prompt: str, default_model: str) -> str:
    """P10: the model to actually use for this turn. Returns default_model unless
    routing is enabled in its policy (pick_for_turn is itself a no-op when off)."""
    try:
        from backend.apps.routing.routing import pick_for_turn
        chosen = pick_for_turn(prompt or "", default_model)
        return chosen or default_model
    except Exception:
        logger.debug("routed_model fell back to default", exc_info=True)
        return default_model


def gated_policy(policy: str, tool_name: str, tool_input) -> str:
    """P4: fold the declarative gate policy into the per-tool permission. Only
    tightens (never loosens) the existing `policy`. Returns `policy` unchanged
    when enforcement is off or anything goes wrong."""
    try:
        from backend.apps.rewind import store as gate_store
        from backend.apps.rewind import gates
        pol = gate_store.load_policy()
        if not pol.get("enforce"):
            return policy
        action = gates.decide(
            tool_name, tool_input, pol.get("rules") or [], pol.get("default_action") or "allow"
        )["action"]
        if action == "deny":
            return "deny"
        if action == "gate":
            # Escalate to a prompt, but never override an existing hard deny.
            return policy if policy == "deny" else "ask"
        return policy  # 'allow' == no opinion; keep whatever the user already set
    except Exception:
        logger.debug("gated_policy fell back to existing policy", exc_info=True)
        return policy
