"""Tracing SubApp (Tier 1): agent observability over a session's recorded timings.

Routes (prefix /api/tracing):
  GET  /session/{session_id}   tool + model spans, summary, hotspots
  POST /trace {session}        build a trace from a session dict (pure; no load)

The /session route loads the live (or resumed) session and runs the pure
span-builder; /trace lets a caller pass a session snapshot directly (used by the
UI when it already holds the session in Redux, and by tests).
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import HTTPException
from pydantic import BaseModel
from typeguard import typechecked

from backend.config.Apps import SubApp
from backend.apps.tracing import spans


@asynccontextmanager
async def tracing_lifespan():
    yield


tracing = SubApp("tracing", tracing_lifespan)


class TraceBody(BaseModel):
    session: dict


@tracing.router.get("/session/{session_id}")
@typechecked
async def trace_session(session_id: str) -> dict:
    # Lazy import keeps tracing a leaf with no agent imports at load.
    from backend.apps.agents.agent_manager import agent_manager
    session = agent_manager.get_session(session_id)
    if not session:
        try:
            session = await agent_manager.resume_session(session_id)
        except Exception:
            session = None
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return spans.build_trace(session.model_dump(mode="json"))


@tracing.router.post("/trace")
@typechecked
async def trace(body: TraceBody) -> dict:
    return spans.build_trace(body.session)
