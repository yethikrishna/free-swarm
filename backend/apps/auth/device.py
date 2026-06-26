"""Desktop side of the device authorization grant (RFC 8628).

An alternative to the localhost OAuth handoff for installs that can't receive
the browser->localhost POST (WSL, remote desktops, locked-down sandboxes) or
when the user wants to approve from a different machine. The renderer:

  1. POST /api/auth/device/start  -> shows {user_code, verification_uri}
  2. user opens verification_uri in any signed-in browser, types user_code
  3. renderer polls POST /api/auth/device/poll until status='approved'

The secret device_code never leaves this backend; the renderer only holds an
opaque flow_id. On approval we persist the cloud-minted token pair through the
same path as the OAuth handoff (auth.router.persist_account_signin)."""

from __future__ import annotations

import logging
import secrets
import time
from typing import Optional

import httpx
from fastapi import HTTPException
from pydantic import BaseModel

from backend.apps.settings.settings import load_settings
from backend.apps.auth.router import auth, _proxy_url, persist_account_signin

logger = logging.getLogger(__name__)

# Active device flows, keyed by an opaque flow_id handed to the renderer. The
# secret cloud device_code lives only here. {flow_id: {device_code, interval, exp}}.
_device_flows: dict[str, dict] = {}


def _sweep_device_flows() -> None:
    now = time.time()
    for fid, data in list(_device_flows.items()):
        if data.get("exp", 0) <= now:
            _device_flows.pop(fid, None)


class DevicePollRequest(BaseModel):
    flow_id: str


@auth.router.post("/device/start")
async def device_start():
    """Begin a device-code sign-in: ask the cloud for a code pair and return the
    user-facing fields. The renderer shows user_code + verification_uri and then
    polls /device/poll."""
    _sweep_device_flows()
    settings_obj = load_settings()
    install_id = getattr(settings_obj, "installation_id", "") or ""
    proxy = _proxy_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{proxy}/api/auth/device/code",
                json={"aud": "desktop", "install_id": install_id},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach sign-in service: {e}")

    if r.status_code == 501:
        raise HTTPException(status_code=501, detail="Sign-in is not available right now")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=r.text[:200] or "Sign-in service error")

    data = r.json()
    device_code = data.get("device_code")
    user_code = data.get("user_code")
    if not device_code or not user_code:
        raise HTTPException(status_code=502, detail="Sign-in service returned an incomplete code")

    interval = int(data.get("interval") or 5)
    expires_in = int(data.get("expires_in") or 900)
    flow_id = secrets.token_urlsafe(18)
    _device_flows[flow_id] = {
        "device_code": device_code,
        "interval": interval,
        "exp": time.time() + expires_in,
    }
    return {
        "flow_id": flow_id,
        "user_code": user_code,
        "verification_uri": data.get("verification_uri"),
        "verification_uri_complete": data.get("verification_uri_complete"),
        "interval": interval,
        "expires_in": expires_in,
    }


@auth.router.post("/device/poll")
async def device_poll(body: DevicePollRequest):
    """Poll the cloud once for the flow's status. On 'approved' the cloud returns
    the token pair + profile, which we persist locally and report as signed in.
    Any terminal status (approved/denied/expired) drops the in-memory flow."""
    _sweep_device_flows()
    flow = _device_flows.get(body.flow_id)
    if not flow:
        return {"status": "expired"}

    proxy = _proxy_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{proxy}/api/auth/device/token",
                json={"device_code": flow["device_code"]},
            )
    except httpx.HTTPError as e:
        # Transient network error: keep the flow alive so the renderer retries.
        logger.debug("device poll network error: %s", e)
        return {"status": "pending", "interval": flow.get("interval", 5)}

    if r.status_code >= 400:
        return {"status": "pending", "interval": flow.get("interval", 5)}

    data = r.json()
    status = data.get("status")

    if status in ("denied", "expired"):
        _device_flows.pop(body.flow_id, None)
        return {"status": status}

    if status == "approved":
        _device_flows.pop(body.flow_id, None)
        access = data.get("access_token")
        if not access:
            return {"status": "expired"}
        settings_obj = load_settings()
        await persist_account_signin(
            settings_obj,
            access_token=access,
            refresh_token=data.get("refresh_token"),
            user_id=data.get("user_id"),
            email=data.get("email"),
            plan=data.get("plan"),
            expires=data.get("expires"),
            method=data.get("signin_method") or "device",
            proxy=proxy,
        )
        return {
            "status": "approved",
            "email": data.get("email"),
            "plan": data.get("plan") or "free",
        }

    # pending or slow_down: surface the interval so the renderer can back off.
    return {"status": status or "pending", "interval": data.get("interval") or flow.get("interval", 5)}


@auth.router.post("/device/cancel")
async def device_cancel(body: DevicePollRequest):
    """Drop a pending flow (user closed the dialog)."""
    _device_flows.pop(body.flow_id, None)
    return {"ok": True}
