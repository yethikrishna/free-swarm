"""Automation SubApp: scheduled tasks (F5) + agent templates (F10).

Routes (prefix /api/automation):
  GET/POST           /tasks            list / create a scheduled task
  PUT/DELETE         /tasks/{id}       edit / remove
  POST               /tasks/{id}/run   fire it now (manual trigger)
  GET/POST           /templates        list / create an agent template
  PUT/DELETE         /templates/{id}   edit / remove

The lifespan runs a background scheduler that wakes every _TICK_SEC, fires any
due task through the injected launcher, and reschedules it. The launcher is a
seam (`set_launcher`) so the agent stack wires the real "start an agent with this
prompt" without this leaf importing the heavy agent_manager. Default logs.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Awaitable, Callable, Optional

from fastapi import HTTPException
from pydantic import BaseModel
from typeguard import typechecked

import httpx

from backend.config.Apps import SubApp
from backend.apps.automation import store
from backend.apps.automation import export as export_mod

logger = logging.getLogger(__name__)

_TICK_SEC = 30.0

# Injected by the agent stack to actually launch an agent from a scheduled task.
# Default just logs so the scheduler is functional + testable without the agent
# manager present (e.g. in unit tests).
async def _default_launcher(task: dict) -> None:
    logger.info("scheduled task fired (no launcher wired): %s %r", task.get("id"), task.get("name"))


_launcher: Callable[[dict], Awaitable[None]] = _default_launcher


def set_launcher(fn: Callable[[dict], Awaitable[None]]) -> None:
    global _launcher
    _launcher = fn


async def _run_due_once(now: float) -> int:
    """Fire every due task once; returns how many fired. Pulled out of the loop
    so a test can drive a single tick deterministically."""
    fired = 0
    for task in store.due_tasks(store.list_tasks(), now):
        try:
            await _launcher(task)
        except Exception:  # a bad task must not kill the scheduler
            logger.exception("scheduled task launcher failed: %s", task.get("id"))
        finally:
            store.advance(task["id"], now)
            fired += 1
    return fired


@asynccontextmanager
async def automation_lifespan():
    stop = asyncio.Event()

    async def _loop():
        while not stop.is_set():
            try:
                await _run_due_once(time.time())
            except Exception:
                logger.exception("automation scheduler tick failed")
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


automation = SubApp("automation", automation_lifespan)


# ---- Scheduled tasks ----

class ScheduledTaskBody(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    schedule_kind: Optional[str] = None  # 'interval' | 'daily'
    interval_minutes: Optional[int] = None
    daily_time: Optional[str] = None  # 'HH:MM'
    template_id: Optional[str] = None
    enabled: Optional[bool] = None


@automation.router.get("/tasks")
@typechecked
async def list_tasks() -> dict:
    return {"tasks": store.list_tasks()}


@automation.router.post("/tasks")
@typechecked
async def create_task(body: ScheduledTaskBody) -> dict:
    data = body.model_dump(exclude_none=True)
    if not data.get("prompt"):
        raise HTTPException(status_code=400, detail="prompt is required")
    kind = data.get("schedule_kind", "interval")
    if kind not in ("interval", "daily"):
        raise HTTPException(status_code=400, detail="schedule_kind must be interval|daily")
    return {"task": store.create_task(data, time.time())}


@automation.router.put("/tasks/{task_id}")
@typechecked
async def update_task(task_id: str, body: ScheduledTaskBody) -> dict:
    updated = store.update_task(task_id, body.model_dump(exclude_none=True), time.time())
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task": updated}


@automation.router.delete("/tasks/{task_id}")
@typechecked
async def delete_task(task_id: str) -> dict:
    if not store.delete_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"ok": True}


@automation.router.post("/tasks/{task_id}/run")
@typechecked
async def run_task_now(task_id: str) -> dict:
    task = store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    try:
        await _launcher(task)
    except Exception:
        logger.exception("manual run failed: %s", task_id)
        raise HTTPException(status_code=500, detail="Could not run the task")
    store.advance(task_id, time.time())
    return {"ok": True}


# ---- Agent templates ----

class TemplateBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    tools: Optional[list] = None
    skills: Optional[list] = None


@automation.router.get("/templates")
@typechecked
async def list_templates() -> dict:
    return {"templates": store.list_templates()}


@automation.router.post("/templates")
@typechecked
async def create_template(body: TemplateBody) -> dict:
    data = body.model_dump(exclude_none=True)
    if not data.get("name"):
        raise HTTPException(status_code=400, detail="name is required")
    return {"template": store.create_template(data, time.time())}


@automation.router.put("/templates/{template_id}")
@typechecked
async def update_template(template_id: str, body: TemplateBody) -> dict:
    updated = store.update_template(template_id, body.model_dump(exclude_none=True), time.time())
    if not updated:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"template": updated}


@automation.router.delete("/templates/{template_id}")
@typechecked
async def delete_template(template_id: str) -> dict:
    if not store.delete_template(template_id):
        raise HTTPException(status_code=404, detail="Template not found")
    return {"ok": True}


# ---- Transcript export + share (F3) ----

class ExportBody(BaseModel):
    session_id: str
    format: Optional[str] = None  # 'markdown' | 'json'


class ShareBody(BaseModel):
    session_id: str
    title: Optional[str] = None
    ttl_days: Optional[int] = None


async def _load_session_dict(session_id: str) -> dict:
    # Lazy import keeps automation a leaf at module load.
    from backend.apps.agents.agent_manager import agent_manager
    session = agent_manager.get_session(session_id)
    if not session:
        try:
            session = await agent_manager.resume_session(session_id)
        except Exception:
            session = None
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.model_dump(mode="json")


@automation.router.post("/export")
@typechecked
async def export_session(body: ExportBody) -> dict:
    """Render a session transcript as Markdown (default) or structured JSON."""
    session = await _load_session_dict(body.session_id)
    if body.format == "json":
        return {"format": "json", "transcript": export_mod.render_json(session)}
    return {"format": "markdown", "transcript": export_mod.render_markdown(session)}


@automation.router.post("/share")
@typechecked
async def share_session(body: ShareBody) -> dict:
    """Create a public share link for a session transcript via the cloud. Requires
    the user to be signed in (a FreeSwarm account bearer in settings)."""
    from backend.apps.auth.router import _proxy_url
    from backend.apps.settings.settings import load_settings

    settings_obj = load_settings()
    bearer = getattr(settings_obj, "freeswarm_bearer_token", None)
    if not bearer:
        raise HTTPException(status_code=401, detail="Sign in to your FreeSwarm account to share")

    session = await _load_session_dict(body.session_id)
    payload = export_mod.render_json(session)
    title = body.title or session.get("name") or "Shared transcript"
    proxy = _proxy_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{proxy}/api/share",
                headers={"Authorization": f"Bearer {bearer}"},
                json={"kind": "transcript", "title": title, "payload": payload, "ttl_days": body.ttl_days or 0},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach the sharing service: {e}")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail="The sharing service rejected the request")
    token = r.json().get("token")
    return {"token": token}
