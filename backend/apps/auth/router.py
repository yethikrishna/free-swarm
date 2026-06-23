"""Desktop-side sign-in endpoints. Mirrors freeswarm-cloud/src/routes/auth/*.

The cloud handles the actual OAuth / magic-link flows. The desktop's role is
narrow: when the bearer-handoff page POSTs the token to localhost, we
validate it with the cloud (returns user_id + email + plan) and persist it
to the local settings store so subsequent requests carry the bearer.

POST /api/auth/signin-activate {token, signin_method, email?}
  Validates the bearer at cloud /api/auth/signin-activate.
  Persists user_id, user_email, signin_method, and (if a paid plan was
  returned) bearer + plan + expires.

POST /api/auth/signout
  Calls cloud /api/auth/signout to revoke the bearer, then clears local
  identity fields.
"""

from __future__ import annotations

import logging
import secrets
import time
from contextlib import asynccontextmanager
from typing import Optional, Literal

import httpx
from fastapi import HTTPException
from pydantic import BaseModel

from backend.config.Apps import SubApp
from backend.apps.settings.credentials import FREESWARM_DEFAULT_PROXY_URL
from backend.apps.settings.settings import load_settings, save_settings_async

logger = logging.getLogger(__name__)

# In-memory sign-in nonces. The renderer calls /begin-signin to mint one before
# opening the OAuth browser; the cloud handoff page echoes it back in the
# signin-activate POST. Validating it proves THIS install started the flow, so a
# stray POST from any other source can't re-identify the install (closes Gap A).
# {nonce: minted_at_epoch}; entries expire after _NONCE_TTL_SEC.
_signin_nonces: dict[str, float] = {}
_NONCE_TTL_SEC = 300.0


def _mint_signin_nonce() -> str:
    now = time.time()
    # Opportunistic cleanup so the dict can't grow without bound.
    for n, ts in list(_signin_nonces.items()):
        if now - ts > _NONCE_TTL_SEC:
            _signin_nonces.pop(n, None)
    nonce = secrets.token_urlsafe(24)
    _signin_nonces[nonce] = now
    return nonce


def _consume_signin_nonce(nonce: str) -> bool:
    """True if the nonce was valid + unexpired; consumes it either way (single-use)."""
    ts = _signin_nonces.pop(nonce, None)
    if ts is None:
        return False
    return (time.time() - ts) <= _NONCE_TTL_SEC


@asynccontextmanager
async def auth_lifespan():
    yield


auth = SubApp("auth", auth_lifespan)


@auth.router.post("/begin-signin")
async def begin_signin():
    """Mint a single-use nonce for a desktop sign-in attempt.

    The renderer calls this immediately before opening the OAuth browser and
    passes the nonce to the cloud /start endpoint. The cloud carries it through
    the flow and echoes it back in the signin-activate POST, where we validate
    it. This binds the eventual token handoff to the install that initiated it.
    """
    return {"nonce": _mint_signin_nonce()}


def _proxy_url() -> str:
    settings_obj = load_settings()
    url = (getattr(settings_obj, "freeswarm_proxy_url", None)
           or FREESWARM_DEFAULT_PROXY_URL)
    return url.rstrip("/")


async def _sync_pro_routing(settings_obj) -> None:
    """Mirror connection state into 9Router's Claude lane; sign-in can flip a
    paying user into pro mode and sign-out must tear the lane down so a
    revoked bearer doesn't linger in the router."""
    try:
        from backend.apps.nine_router import sync_pro_routing
        await sync_pro_routing(settings_obj)
    except Exception as e:
        logger.debug("pro routing sync skipped: %s", e)


def _sync_identity_to_service(settings_obj) -> None:
    """Push user_id + email + signin_method into the service-sync identify
    pipeline so every event from this user has the right Person properties."""
    try:
        from backend.apps.service.client import identify as _identify
    except Exception:
        return
    props = {
        "signin_method": getattr(settings_obj, "signin_method", None),
        "is_signed_in": bool(getattr(settings_obj, "user_id", None)),
    }
    email = getattr(settings_obj, "user_email", None)
    if email:
        props["email"] = email
    try:
        _identify(props)
    except Exception as e:
        logger.debug("identify sync failed: %s", e)


# ---------------------------------------------------------------------------
# POST /api/auth/signin-activate
# ---------------------------------------------------------------------------

class SigninActivateRequest(BaseModel):
    token: str
    signin_method: Literal["google", "github", "email"]
    email: Optional[str] = None
    # Phase 1: refresh token (30d) issued alongside the 15m access token.
    refresh_token: Optional[str] = None
    # Phase 1: nonce minted by /begin-signin; proves this install started the flow.
    nonce: Optional[str] = None


@auth.router.post("/signin-activate")
async def signin_activate(body: SigninActivateRequest):
    """Validate a freshly-minted sign-in bearer and persist it locally.

    The bearer-handoff page POSTs to this endpoint after a Google/GitHub OAuth
    flow. We validate the install nonce (proving this install started the flow),
    re-validate the bearer with the cloud (never trusting whatever arrives at the
    localhost endpoint), then write user_id + email + signin_method to settings
    so the renderer flips to signed-in.
    """
    if not body.token or len(body.token) < 16:
        raise HTTPException(status_code=400, detail="Invalid token")

    # Validate the install nonce when present. A handoff that carries a nonce must
    # carry a VALID one (rejects replayed/forged POSTs). Absence is tolerated only
    # for the migration window where an older cloud build sends no nonce; once the
    # cloud always sends one, flip this to a hard requirement.
    if body.nonce is not None and not _consume_signin_nonce(body.nonce):
        raise HTTPException(status_code=401, detail="Sign-in request expired or invalid")

    proxy = _proxy_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{proxy}/api/auth/signin-activate",
                json={
                    "token": body.token,
                    "signin_method": body.signin_method,
                    "email": body.email,
                },
            )
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach sign-in service: {e}",
        )

    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Token rejected by service")
    if r.status_code >= 400:
        raise HTTPException(
            status_code=r.status_code,
            detail=r.text[:200] or "Service error",
        )

    me = r.json()
    user_id = me.get("user_id")
    email = me.get("email")
    plan = me.get("plan")
    expires = me.get("expires")
    method = me.get("signin_method") or body.signin_method

    settings_obj = load_settings()
    settings_obj.user_id = user_id
    settings_obj.user_email = email
    settings_obj.signin_method = method
    # If the user happens to be a paying customer too (Stripe + sign-in
    # share a user row by email), surface plan/expires so the chat picker
    # exposes Pro models. Free-tier signups land here with plan="free"
    # and expires=null; connection_mode stays own_key.
    if isinstance(plan, str) and plan != "free":
        settings_obj.connection_mode = "freeswarm-pro"
        settings_obj.freeswarm_bearer_token = body.token
        settings_obj.freeswarm_refresh_token = body.refresh_token
        settings_obj.freeswarm_proxy_url = proxy
        settings_obj.freeswarm_subscription_plan = plan
        if isinstance(expires, str):
            settings_obj.freeswarm_subscription_expires = expires
    else:
        # Free-tier: still store the bearer so future API calls can identify
        # the user (used by /api/me/profile, /api/auth/signout). Do NOT flip
        # connection_mode; that's reserved for paid plans only so chat
        # routing keeps using own_key/BYO.
        settings_obj.freeswarm_bearer_token = body.token
        settings_obj.freeswarm_refresh_token = body.refresh_token
        settings_obj.freeswarm_proxy_url = proxy

    await save_settings_async(settings_obj)
    _sync_identity_to_service(settings_obj)
    await _sync_pro_routing(settings_obj)

    return {
        "ok": True,
        "user_id": user_id,
        "email": email,
        "plan": plan or "free",
        "signin_method": method,
    }


# ---------------------------------------------------------------------------
# POST /api/auth/refresh
# ---------------------------------------------------------------------------

@auth.router.post("/refresh")
async def refresh_token():
    """Silently re-mint the access bearer from the stored 30d refresh token.

    Called when an access token has expired (the cloud returned 401). Avoids
    forcing the user to sign in again. Returns {ok, refreshed} so the renderer
    can decide whether to retry or fall back to sign-out. Routing mirrors back
    into 9Router so any pro lane picks up the fresh bearer.
    """
    settings_obj = load_settings()
    refresh = getattr(settings_obj, "freeswarm_refresh_token", None)
    if not refresh:
        raise HTTPException(status_code=401, detail="No refresh token; sign in again")

    proxy = _proxy_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                f"{proxy}/api/auth/refresh",
                json={"refresh_token": refresh, "aud": "desktop"},
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach sign-in service: {e}")

    if r.status_code == 401:
        # Refresh token itself is dead; the renderer should sign the user out.
        raise HTTPException(status_code=401, detail="Session expired; sign in again")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=r.text[:200] or "Refresh failed")

    data = r.json()
    access_token = data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail="No access token returned")

    settings_obj.freeswarm_bearer_token = access_token
    await save_settings_async(settings_obj)
    await _sync_pro_routing(settings_obj)
    return {"ok": True, "refreshed": True}


# ---------------------------------------------------------------------------
# POST /api/auth/signout
# ---------------------------------------------------------------------------

@auth.router.post("/signout")
async def signout():
    """Revoke the cloud-side bearer + clear local identity state.

    Also stops every in-flight agent session so any 9Router subprocess
    that captured the now-revoked bearer at spawn time can't keep using
    it. Without this, a signed-out user's old chat tabs would keep
    making /v1/messages calls with a token the cloud has revoked,
    surfacing as 401s in the agent UI ("Invalid bearer token").
    """
    settings_obj = load_settings()
    bearer = getattr(settings_obj, "freeswarm_bearer_token", None)
    proxy = _proxy_url()
    if bearer:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    f"{proxy}/api/auth/signout",
                    headers={"Authorization": f"Bearer {bearer}"},
                )
        except httpx.HTTPError as e:
            # Network failure shouldn't strand the user signed-in locally;
            # the cloud token is invalidated lazily on next use anyway.
            logger.warning("cloud signout failed (clearing local anyway): %s", e)

    # Stop every running agent session AND drop their cached SDK resume
    # state BEFORE clearing local settings. Two failure modes this prevents:
    #   1. A 9Router subprocess captured the now-revoked bearer at spawn
    #      time and would 401 on the next /v1/messages call.
    #   2. A session has an `sdk_session_id` from a conversation served by
    #      the previous identity's Claude account; resuming against the new
    #      bearer would 404 or 401 because the new account has no record
    #      of that thread. Wiping it forces the SDK to start a fresh thread
    #      on next send (transcript replay still works; only the SDK's
    #      server-side resume cache is reset).
    # Best-effort: failures here shouldn't block the sign-out itself.
    try:
        from backend.apps.agents.agent_manager import agent_manager
        from backend.apps.agents.agent_manager import _save_session

        running = list(agent_manager.tasks.keys())
        for session_id in running:
            try:
                await agent_manager.stop_agent(session_id)
            except Exception as e:
                logger.warning("signout: stop_agent(%s) failed: %s", session_id, e)

        # Walk every loaded session (running, stopped, persisted-but-resumed)
        # and clear the SDK resume id so the next send starts a fresh thread
        # under whichever identity the user re-signs-in with.
        for sess in list(agent_manager.sessions.values()):
            if sess.sdk_session_id:
                sess.sdk_session_id = None
                try:
                    _save_session(sess.id, sess.model_dump(mode="json"))
                except Exception as e:
                    logger.warning("signout: save_session(%s) failed: %s", sess.id, e)

        if running:
            logger.info("signout: stopped %d in-flight agent session(s)", len(running))
    except Exception as e:
        logger.warning("signout: agent shutdown skipped: %s", e)

    settings_obj.user_id = None
    settings_obj.user_email = None
    settings_obj.signin_method = None
    settings_obj.freeswarm_bearer_token = None
    settings_obj.freeswarm_refresh_token = None
    settings_obj.connection_mode = "own_key"
    settings_obj.freeswarm_subscription_plan = None
    settings_obj.freeswarm_subscription_expires = None
    settings_obj.freeswarm_usage_cached = None
    await save_settings_async(settings_obj)
    _sync_identity_to_service(settings_obj)
    await _sync_pro_routing(settings_obj)
    return {"ok": True}
