"""Rewind/approval-gate SubApp (P4).

Two capabilities on top of the agent stack's existing fork machinery:

  - Timeline: map a session's user turns to rewind checkpoints (pure), and
    trigger a rewind (fork + re-run) at one of them via a seam onto
    agent_manager.edit_message.
  - Approval gates: a declarative, user-configured policy deciding which tools to
    gate/allow/deny before a per-call HITL request is even raised. /gates/decide
    is pure; persistence is a single global policy doc.

Routes (prefix /api/rewind):
  POST /timeline {messages, active_branch_id?}     checkpoints (pure)
  POST /to       {session_id, message_id, new_content?}  fork + re-run there
  GET  /gates                                      current gate policy
  PUT  /gates    {default_action?, rules?}         replace the policy
  POST /gates/decide {tool_name, tool_input?}      evaluate the policy (pure)
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Awaitable, Callable, Optional

from fastapi import HTTPException
from pydantic import BaseModel
from typeguard import typechecked

from backend.config.Apps import SubApp
from backend.apps.rewind import timeline as tl
from backend.apps.rewind import gates as gates_mod
from backend.apps.rewind import store


@asynccontextmanager
async def rewind_lifespan():
    yield


rewind = SubApp("rewind", rewind_lifespan)


# Seam: the agent stack injects the real "fork at this message and re-run".
# Default raises so the route returns a clean 503 when unwired (e.g. in tests).
async def _default_driver(session_id: str, message_id: str, new_content: str) -> None:
    raise RuntimeError("rewind driver not wired")


_driver: Callable[[str, str, str], Awaitable[None]] = _default_driver


def set_driver(fn: Callable[[str, str, str], Awaitable[None]]) -> None:
    global _driver
    _driver = fn


class TimelineBody(BaseModel):
    messages: list
    active_branch_id: Optional[str] = None


class RewindBody(BaseModel):
    session_id: str
    message_id: str
    new_content: Optional[str] = None


class GatePolicyBody(BaseModel):
    default_action: Optional[str] = None
    rules: Optional[list] = None
    enforce: Optional[bool] = None


class DecideBody(BaseModel):
    tool_name: str
    tool_input: Any = None


@rewind.router.post("/timeline")
@typechecked
async def timeline(body: TimelineBody) -> dict:
    msgs = [m for m in body.messages if isinstance(m, dict)]
    return tl.build_timeline(msgs, body.active_branch_id or "main")


@rewind.router.post("/to")
@typechecked
async def rewind_to(body: RewindBody) -> dict:
    """Fork at a checkpoint and re-run. With new_content it's edit-and-rerun;
    without, the agent stack re-runs the original message on a fresh branch."""
    content = body.new_content
    if content is None:
        # Resolve the original message text so a no-edit rewind still forks.
        from backend.apps.agents.agent_manager import agent_manager
        session = agent_manager.get_session(body.session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        target = next((m for m in session.messages if m.id == body.message_id), None)
        if not target or target.role != "user":
            raise HTTPException(status_code=400, detail="Can only rewind to a user turn")
        content = tl._text_of(target.content)
    try:
        await _driver(body.session_id, body.message_id, content)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "session_id": body.session_id, "message_id": body.message_id}


@rewind.router.get("/gates")
@typechecked
async def get_gates() -> dict:
    return {"policy": store.load_policy()}


@rewind.router.put("/gates")
@typechecked
async def put_gates(body: GatePolicyBody) -> dict:
    current = store.load_policy()
    default_action = body.default_action if body.default_action is not None else current["default_action"]
    if default_action not in gates_mod.ACTIONS:
        raise HTTPException(status_code=400, detail=f"default_action must be one of {gates_mod.ACTIONS}")
    rules = body.rules if body.rules is not None else current["rules"]
    problems = gates_mod.validate_rules(rules)
    if problems:
        raise HTTPException(status_code=400, detail="; ".join(problems))
    enforce = body.enforce if body.enforce is not None else current.get("enforce", False)
    return {"policy": store.save_policy(
        {"default_action": default_action, "rules": rules, "enforce": enforce})}


@rewind.router.post("/gates/decide")
@typechecked
async def decide(body: DecideBody) -> dict:
    policy = store.load_policy()
    return gates_mod.decide(body.tool_name, body.tool_input, policy["rules"], policy["default_action"])
