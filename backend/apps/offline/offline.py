"""Offline SubApp (P11, Tier 2): detect + select a user-run local model.

Probes loopback OpenAI-compatible servers (LM Studio / Ollama / llama.cpp / Jan)
and persists an offline preference. Selecting a detected endpoint as a custom
provider is the existing router path; this just makes it discoverable + one-click.
Bundling a model into the build is NOT here (that's packaging).

Routes (prefix /api/offline):
  GET  /catalog                 known local endpoints
  GET  /detect                  probe each; report reachable + the chosen one
  GET  /config                  offline preference
  PUT  /config {offline_enabled?, preferred_id?}
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from pydantic import BaseModel
from typeguard import typechecked

from backend.config.Apps import SubApp
from backend.config.paths import DATA_ROOT
from backend.apps.offline import endpoints as ep

_CONFIG_FILE = os.path.join(DATA_ROOT, "offline", "config.json")
_lock = threading.Lock()
_PROBE_TIMEOUT = 1.5


@asynccontextmanager
async def offline_lifespan():
    yield


offline = SubApp("offline", offline_lifespan)


def _load_config() -> dict:
    try:
        with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
            return ep.normalize_pref(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        return ep.normalize_pref({})


def _save_config(cfg: dict) -> dict:
    clean = ep.normalize_pref(cfg)
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


async def _reachable(base_url: str) -> bool:
    # A reachable OpenAI-compatible server answers GET /models (or at least the
    # socket is open). Loopback-only, so no SSRF surface.
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT) as client:
            r = await client.get(f"{base_url.rstrip('/')}/models")
            return r.status_code < 500
    except httpx.HTTPError:
        return False


class PrefBody(BaseModel):
    offline_enabled: Optional[bool] = None
    preferred_id: Optional[str] = None


@offline.router.get("/catalog")
@typechecked
async def catalog() -> dict:
    return {"endpoints": ep.catalog()}


@offline.router.get("/detect")
@typechecked
async def detect() -> dict:
    # Probe each catalog entry concurrently.
    import asyncio
    results = await asyncio.gather(*[_reachable(e["base_url"]) for e in ep.CATALOG])
    probed = [{**dict(e), "reachable": bool(ok)} for e, ok in zip(ep.CATALOG, results)]
    pref = _load_config()
    chosen = ep.choose_offline(probed, pref.get("preferred_id"))
    return {"endpoints": probed, "chosen": chosen}


@offline.router.get("/config")
@typechecked
async def get_config() -> dict:
    return {"config": _load_config()}


@offline.router.put("/config")
@typechecked
async def put_config(body: PrefBody) -> dict:
    current = _load_config()
    merged = {
        "offline_enabled": body.offline_enabled if body.offline_enabled is not None else current["offline_enabled"],
        "preferred_id": body.preferred_id if body.preferred_id is not None else current["preferred_id"],
    }
    return {"config": _save_config(merged)}
