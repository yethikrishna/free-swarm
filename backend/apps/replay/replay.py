"""Replay SubApp (P9): record a session's non-deterministic inputs, inspect the
log, export a compressed bundle, and fork at a checkpoint.

Routes (prefix /api/replay):
  GET    /logs                          list recorded sessions + counts
  GET    /logs/{session_id}             the full (decompressed) record stream
  POST   /record {session_id,kind,value,key?,ts?}  append one record
  GET    /export/{session_id}           delta-compressed bundle (ship a repro)
  POST   /fork {session_id,at_seq,new_session_id}  store the prefix as a new log
  DELETE /logs/{session_id}             discard a log
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import HTTPException
from pydantic import BaseModel
from typeguard import typechecked

from backend.config.Apps import SubApp
from backend.apps.replay import store, log as log_mod


@asynccontextmanager
async def replay_lifespan():
    yield


replay = SubApp("replay", replay_lifespan)


class RecordBody(BaseModel):
    session_id: str
    kind: str
    value: Any = None
    key: Optional[str] = None
    ts: Optional[float] = None


class ForkBody(BaseModel):
    session_id: str
    at_seq: int
    new_session_id: str


@replay.router.get("/logs")
@typechecked
async def logs() -> dict:
    return {"logs": store.list_logs()}


@replay.router.get("/logs/{session_id}")
@typechecked
async def get_log(session_id: str) -> dict:
    return {"records": store.read_records(session_id)}


@replay.router.post("/record")
@typechecked
async def record(body: RecordBody) -> dict:
    if body.kind not in log_mod.KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {log_mod.KINDS}")
    existing = store.read_records(body.session_id)
    rl = log_mod.ReplayLog(existing)
    rec = rl.append(body.kind, body.value, key=body.key, ts=body.ts)
    store.append_record(body.session_id, rec)
    return {"record": rec}


@replay.router.get("/export/{session_id}")
@typechecked
async def export(session_id: str) -> dict:
    records = store.read_records(session_id)
    if not records:
        raise HTTPException(status_code=404, detail="No log for this session")
    return {"session_id": session_id, "format": "delta", "rows": log_mod.compress(records)}


@replay.router.post("/fork")
@typechecked
async def fork(body: ForkBody) -> dict:
    records = store.read_records(body.session_id)
    if not records:
        raise HTTPException(status_code=404, detail="No log for this session")
    prefix = log_mod.fork(records, body.at_seq)
    store.write_records(body.new_session_id, prefix)
    return {"session_id": body.new_session_id, "records": len(prefix)}


@replay.router.delete("/logs/{session_id}")
@typechecked
async def delete(session_id: str) -> dict:
    if not store.delete_log(session_id):
        raise HTTPException(status_code=404, detail="No log for this session")
    return {"ok": True}
