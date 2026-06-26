"""Memory SubApp (P8): the self-improving agent playbook.

Routes (prefix /api/memory):
  GET    /playbook?agent_type=        list lessons
  POST   /remember {agent_type,task,lesson,tags?,outcome?}  store a lesson
  POST   /retrieve {query,agent_type?,k?}                   top-k relevant lessons
  POST   /reflect  {session_id,agent_type?}                 distill a finished run into a lesson
  DELETE /playbook/{lesson_id}        forget a lesson

`reflect` lazily loads the session via agent_manager (kept out of module load so
this stays a leaf) and stores a heuristic lesson. An aux-LLM reflection can later
replace summarize_session behind the same shape.
"""

from __future__ import annotations

import time
from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel
from typeguard import typechecked

from contextlib import asynccontextmanager

from backend.config.Apps import SubApp
from backend.apps.memory import store, reflect


@asynccontextmanager
async def memory_lifespan():
    yield


memory = SubApp("memory", memory_lifespan)


class RememberBody(BaseModel):
    agent_type: Optional[str] = None
    task: str = ""
    lesson: str = ""
    tags: Optional[list] = None
    outcome: Optional[str] = None


class RetrieveBody(BaseModel):
    query: str
    agent_type: Optional[str] = None
    k: Optional[int] = None


class ReflectBody(BaseModel):
    session_id: str
    agent_type: Optional[str] = None


@memory.router.get("/playbook")
@typechecked
async def playbook(agent_type: Optional[str] = None) -> dict:
    return {"lessons": store.list_lessons(agent_type)}


@memory.router.post("/remember")
@typechecked
async def remember(body: RememberBody) -> dict:
    if not (body.task or body.lesson):
        raise HTTPException(status_code=400, detail="task or lesson is required")
    return {"lesson": store.add_lesson(body.model_dump(exclude_none=True), time.time())}


@memory.router.post("/retrieve")
@typechecked
async def retrieve(body: RetrieveBody) -> dict:
    k = max(1, min(10, body.k or 3))
    return {"lessons": store.retrieve_lessons(body.query, body.agent_type, k=k, bump=True)}


@memory.router.delete("/playbook/{lesson_id}")
@typechecked
async def forget(lesson_id: str) -> dict:
    if not store.delete_lesson(lesson_id):
        raise HTTPException(status_code=404, detail="Lesson not found")
    return {"ok": True}


@memory.router.post("/reflect")
@typechecked
async def reflect_on_session(body: ReflectBody) -> dict:
    # Lazy import keeps memory a leaf at module load.
    from backend.apps.agents.agent_manager import agent_manager
    session = agent_manager.sessions.get(body.session_id)
    if not session:
        try:
            session = await agent_manager.resume_session(body.session_id)
        except Exception:
            session = None
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    draft = reflect.summarize_session(session.model_dump(mode="json"))
    draft["agent_type"] = body.agent_type or getattr(session, "mode", None) or "default"
    return {"lesson": store.add_lesson(draft, time.time()), "draft": draft}
