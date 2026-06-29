"""Coordination SubApp (P1): the swarm layer. A manager agent posts subtasks to
a shared queue; a background dispatcher fires each through an injected launcher
that spawns a worker agent, and the worker writes its result back.

The launcher is a seam (`set_launcher`) so this leaf never imports the heavy
agent_manager; the agent stack wires the real spawner at boot (launcher.py),
exactly like automation. Default just records the worker as a stub so the queue
is functional + testable without the agent manager present.

Routes (prefix /api/coordination):
  GET/POST   /agents                       capability registry (list / register)
  POST       /delegate {parent_session_id,subtask,required_tools?}  enqueue a subtask
  POST       /should-delegate {subtasks,confidence?}   consensus check (pure)
  GET        /tasks?status=&parent=        list delegations
  POST       /tasks/{id}/complete {result} worker reports success
  POST       /tasks/{id}/fail {error}      worker reports failure
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any, Awaitable, Callable, Optional

from fastapi import HTTPException
from pydantic import BaseModel
from typeguard import typechecked

from backend.config.Apps import SubApp
from backend.apps.coordination import queue as q, registry as reg, consensus

logger = logging.getLogger(__name__)

_TICK_SEC = 5.0


async def _default_launcher(task: dict) -> None:
    logger.info("delegation ready (no launcher wired): %s %r", task.get("id"), task.get("subtask"))


_launcher: Callable[[dict], Awaitable[None]] = _default_launcher


def set_launcher(fn: Callable[[dict], Awaitable[None]]) -> None:
    global _launcher
    _launcher = fn


async def _dispatch_once(now: float) -> int:
    """Spawn workers for pending tasks. Returns how many were dispatched. Pulled
    out of the loop so a test can drive a single tick deterministically."""
    dispatched = 0
    while True:
        task = q.claim_next(now)
        if not task:
            break
        try:
            await _launcher(task)
        except Exception:
            logger.exception("delegation launcher failed: %s", task.get("id"))
            q.fail(task["id"], "launcher error", now)
        dispatched += 1
    return dispatched


@asynccontextmanager
async def coordination_lifespan():
    stop = asyncio.Event()

    async def _loop():
        while not stop.is_set():
            try:
                await _dispatch_once(time.time())
            except Exception:
                logger.exception("coordination dispatcher tick failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=_TICK_SEC)
            except asyncio.TimeoutError:
                pass

    task = asyncio.create_task(_loop())
    try:
        yield
    finally:
        stop.set()
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass


coordination = SubApp("coordination", coordination_lifespan)


class AgentBody(BaseModel):
    agent_type: str
    capabilities: Optional[list] = None
    description: Optional[str] = None


class DelegateBody(BaseModel):
    parent_session_id: str = ""
    subtask: str
    required_tools: Optional[list] = None


class ConsensusBody(BaseModel):
    subtasks: list
    confidence: Optional[float] = None


class CompleteBody(BaseModel):
    result: Any = None


class FailBody(BaseModel):
    error: str = ""


@coordination.router.get("/agents")
@typechecked
async def list_agents() -> dict:
    return {"agents": reg.list_agents()}


@coordination.router.post("/agents")
@typechecked
async def register_agent(body: AgentBody) -> dict:
    return {"agent": reg.register(body.agent_type, body.capabilities or [], body.description or "")}


@coordination.router.post("/should-delegate")
@typechecked
async def should_delegate(body: ConsensusBody) -> dict:
    conf = 1.0 if body.confidence is None else float(body.confidence)
    return consensus.should_delegate([str(s) for s in body.subtasks], conf)


@coordination.router.post("/delegate")
@typechecked
async def delegate(body: DelegateBody) -> dict:
    if not body.subtask.strip():
        raise HTTPException(status_code=400, detail="subtask is required")
    required = [str(t) for t in (body.required_tools or [])]
    match = reg.best_for(required)
    data = {
        "parent_session_id": body.parent_session_id,
        "subtask": body.subtask,
        "required_tools": required,
        "agent_type": match.get("agent_type") if match else None,
    }
    return {"task": q.enqueue(data, time.time()), "matched_agent": match}


@coordination.router.get("/tasks")
@typechecked
async def tasks(status: Optional[str] = None, parent: Optional[str] = None) -> dict:
    return {"tasks": q.list_tasks(status=status, parent_session_id=parent)}


@coordination.router.post("/tasks/{task_id}/complete")
@typechecked
async def complete_task(task_id: str, body: CompleteBody) -> dict:
    updated = q.complete(task_id, body.result, time.time())
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task": updated}


@coordination.router.post("/tasks/{task_id}/fail")
@typechecked
async def fail_task(task_id: str, body: FailBody) -> dict:
    updated = q.fail(task_id, body.error, time.time())
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task": updated}
