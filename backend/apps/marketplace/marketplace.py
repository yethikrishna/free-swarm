"""Skill marketplace SubApp (P5): browse/publish/install a versioned agent
template through the cloud, installing into the local F10 template library.

The cloud (cloud/api/marketplace) owns listings, versions, plan-gating, and the
download counter. This backend is the desktop bridge: it proxies discovery with
the user's bearer, publishes a local template as a new version, and installs a
fetched manifest into automation.store as a normal template (so an installed
skill shows up in the existing template picker).

Routes (prefix /api/marketplace):
  GET  /browse?q=&category=     discover public skills (plan-filtered by cloud)
  GET  /mine                    my published skills
  GET  /skill?slug=             one skill + version history
  POST /publish {template_id|manifest, slug, version, ...}  publish a version
  POST /install {slug, version?}   install into the local template library
  DELETE /unpublish {slug}      remove my listing
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import HTTPException
from pydantic import BaseModel
from typeguard import typechecked

from backend.config.Apps import SubApp
from backend.apps.marketplace import semver, manifest as manifest_mod
from backend.apps.automation import store as template_store


@asynccontextmanager
async def marketplace_lifespan():
    yield


marketplace = SubApp("marketplace", marketplace_lifespan)

_CLOUD_TIMEOUT = 12.0


def _bearer() -> str:
    from backend.apps.settings.settings import load_settings
    token = getattr(load_settings(), "freeswarm_bearer_token", None)
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to your FreeSwarm account to use the marketplace")
    return token


def _cloud_base() -> str:
    from backend.apps.auth.router import _proxy_url
    return _proxy_url()


async def _cloud(method: str, path: str, *, params: Optional[dict] = None, jsonbody: Optional[dict] = None) -> dict:
    bearer = _bearer()
    url = f"{_cloud_base()}{path}"
    try:
        async with httpx.AsyncClient(timeout=_CLOUD_TIMEOUT) as client:
            r = await client.request(
                method, url,
                headers={"Authorization": f"Bearer {bearer}"},
                params=params, json=jsonbody,
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach the marketplace: {e}")
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Your session expired; sign in again")
    if r.status_code == 403:
        raise HTTPException(status_code=403, detail=(r.json().get("error") if _is_json(r) else "Forbidden"))
    if r.status_code >= 400:
        detail = r.json().get("error") if _is_json(r) else "The marketplace rejected the request"
        raise HTTPException(status_code=r.status_code if r.status_code < 500 else 502, detail=detail)
    return r.json() if _is_json(r) else {}


def _is_json(r: httpx.Response) -> bool:
    return r.headers.get("content-type", "").startswith("application/json")


class PublishBody(BaseModel):
    slug: str
    version: str
    template_id: Optional[str] = None
    manifest: Optional[dict] = None
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    changelog: Optional[str] = None
    min_plan: Optional[str] = None
    visibility: Optional[str] = None


class InstallBody(BaseModel):
    slug: str
    version: Optional[str] = None


class UnpublishBody(BaseModel):
    slug: str


@marketplace.router.get("/browse")
@typechecked
async def browse(q: Optional[str] = None, category: Optional[str] = None) -> dict:
    params = {k: v for k, v in {"q": q, "category": category}.items() if v}
    return await _cloud("GET", "/api/marketplace", params=params or None)


@marketplace.router.get("/mine")
@typechecked
async def mine() -> dict:
    return await _cloud("GET", "/api/marketplace", params={"mine": "1"})


@marketplace.router.get("/skill")
@typechecked
async def skill(slug: str) -> dict:
    return await _cloud("GET", "/api/marketplace/get", params={"slug": slug})


@marketplace.router.post("/publish")
@typechecked
async def publish(body: PublishBody) -> dict:
    if not semver.is_valid(body.version):
        raise HTTPException(status_code=400, detail="version must be MAJOR.MINOR.PATCH")

    # Manifest comes either inline or from a local template by id.
    manifest = body.manifest
    if manifest is None:
        if not body.template_id:
            raise HTTPException(status_code=400, detail="Provide a template_id or an inline manifest")
        template = template_store.get_template(body.template_id)
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        manifest = manifest_mod.template_to_manifest(template)

    problems = manifest_mod.manifest_problems(manifest)
    if problems:
        raise HTTPException(status_code=400, detail="; ".join(problems))

    payload = {
        "slug": body.slug,
        "version": body.version,
        "manifest": manifest,
        "name": body.name or manifest.get("name"),
        "description": body.description if body.description is not None else manifest.get("description", ""),
        "category": body.category or "general",
        "changelog": body.changelog or "",
        "min_plan": body.min_plan or "free",
        "visibility": body.visibility or "public",
    }
    return await _cloud("POST", "/api/marketplace", jsonbody=payload)


@marketplace.router.post("/install")
@typechecked
async def install(body: InstallBody) -> dict:
    """Fetch the manifest from the cloud (plan-gated server-side) and create a
    local template from it so it appears in the normal template library."""
    fetched = await _cloud("POST", "/api/marketplace/install",
                           jsonbody={"slug": body.slug, "version": body.version})
    manifest = fetched.get("manifest") or {}
    template_payload = manifest_mod.manifest_to_template(
        manifest, slug=body.slug, version=str(fetched.get("version") or ""))
    created = template_store.create_template(template_payload, time.time())
    return {"installed": {"slug": body.slug, "version": fetched.get("version")}, "template": created}


@marketplace.router.delete("/unpublish")
@typechecked
async def unpublish(body: UnpublishBody) -> dict:
    return await _cloud("DELETE", "/api/marketplace", jsonbody={"slug": body.slug})
