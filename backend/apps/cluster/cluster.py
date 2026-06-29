"""Cluster SubApp (P6, Tier 2): worker placement + cluster status.

Decides where delegated work runs (local in-process via P1, or burst to a remote
worker tier) and reports cluster state. Local execution is fully functional today
through P1's queue; the remote tier is a configured HTTP seam: when placement
picks 'remote', the job is POSTed to remote_url. Deploying the autoscaling
compute that answers that POST is operator infrastructure, out of scope here, so
'remote' degrades gracefully to local when no url is set (never fails a job).

Config persists in cluster/config.json (one global doc).

Routes (prefix /api/cluster):
  GET  /status                      mode, capacity, live local load, placement
  GET  /config                      current config
  PUT  /config {mode?,remote_url?,local_capacity?}  update
  POST /placement {local_running?}  preview where the next job would land
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import HTTPException
from pydantic import BaseModel
from typeguard import typechecked

from backend.config.Apps import SubApp
from backend.config.paths import DATA_ROOT
from backend.apps.cluster import placement

_CONFIG_FILE = os.path.join(DATA_ROOT, "cluster", "config.json")
_lock = threading.Lock()


@asynccontextmanager
async def cluster_lifespan():
    yield


cluster = SubApp("cluster", cluster_lifespan)


def _load_config() -> dict:
    try:
        with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
            return placement.normalize_config(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        return placement.normalize_config({})


def _save_config(cfg: dict) -> dict:
    clean = placement.normalize_config(cfg)
    os.makedirs(os.path.dirname(_CONFIG_FILE), exist_ok=True)
    with _lock:
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(_CONFIG_FILE), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(clean, f, indent=2)
            os.replace(tmp, _CONFIG_FILE)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    return clean


def _live_counts() -> tuple[int, int]:
    """(local_running, queue_depth) from P1's queue. Leaf-safe lazy import."""
    try:
        from backend.apps.coordination import queue as q
        running = len(q.list_tasks(status="running"))
        pending = len(q.list_tasks(status="pending"))
        return running, pending
    except Exception:
        return 0, 0


class ConfigBody(BaseModel):
    mode: Optional[str] = None
    remote_url: Optional[str] = None
    local_capacity: Optional[int] = None


class PlacementBody(BaseModel):
    local_running: Optional[int] = None


@cluster.router.get("/status")
@typechecked
async def status() -> dict:
    running, pending = _live_counts()
    return placement.cluster_status(_load_config(), running, pending)


@cluster.router.get("/config")
@typechecked
async def get_config() -> dict:
    return {"config": _load_config()}


@cluster.router.put("/config")
@typechecked
async def put_config(body: ConfigBody) -> dict:
    current = _load_config()
    merged = {
        "mode": body.mode if body.mode is not None else current["mode"],
        "remote_url": body.remote_url if body.remote_url is not None else current["remote_url"],
        "local_capacity": body.local_capacity if body.local_capacity is not None else current["local_capacity"],
    }
    if merged["mode"] not in placement.MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of {placement.MODES}")
    return {"config": _save_config(merged)}


@cluster.router.post("/placement")
@typechecked
async def preview_placement(body: PlacementBody) -> dict:
    running, pending = _live_counts()
    if body.local_running is not None:
        running = body.local_running
    return placement.decide_placement(_load_config(), running, pending)
