"""A 15-minute access-token expiry must self-heal via the refresh token, not
sign a paying user out.

subscription/status calls the cloud /api/me with the stored access bearer. When
that bearer has expired (cloud returns 401) but a valid 30d refresh token is on
disk, the backend must silently re-mint a fresh access token and retry once
before reverting to own_key. Only a failed refresh (no/expired refresh token)
drops the subscription.
"""

from __future__ import annotations

import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from backend.main import app


@pytest.fixture
def client():
    import backend.auth as auth_mod
    if not auth_mod._TOKEN:
        import secrets
        auth_mod._TOKEN = secrets.token_urlsafe(32)
    return TestClient(app, headers={"Authorization": f"Bearer {auth_mod._TOKEN}"})


@pytest.fixture
def reset_settings():
    from backend.apps.settings.settings import load_settings, _save_settings
    original = load_settings().model_copy(deep=True)
    yield
    _save_settings(original)


def _seed_pro(refresh_token="refresh-0123456789abcdef-valid"):
    """Put the settings into a connected freeswarm-pro state with a refresh token."""
    from backend.apps.settings.settings import load_settings, _save_settings
    s = load_settings()
    s.connection_mode = "freeswarm-pro"
    s.freeswarm_bearer_token = "expired-access-0123456789abcdef"
    s.freeswarm_refresh_token = refresh_token
    s.freeswarm_subscription_plan = "pro"
    s.freeswarm_subscription_expires = "2099-01-01T00:00:00+00:00"
    _save_settings(s)


def _make_me_response(status_code, payload=None):
    resp = AsyncMock()
    resp.status_code = status_code
    resp.json = lambda: payload or {}
    return resp


def test_expired_access_token_refreshes_and_stays_connected(client, reset_settings):
    """Cloud 401 + valid refresh token => silently re-mint, retry, stay connected."""
    _seed_pro()

    # Route GET by the bearer in the auth header: the expired token 401s, the
    # freshly-minted token 200s. URL-agnostic so unrelated httpx calls (9Router
    # sync) don't disturb the assertion. Anything else (9Router, etc.) -> 200.
    def get_side_effect(url, *args, **kwargs):
        auth = (kwargs.get("headers") or {}).get("Authorization", "")
        if "/api/me" in str(url):
            if "expired-access" in auth:
                return _make_me_response(401)
            return _make_me_response(200, {"status": "active", "usage": {"utilization": 0.1}})
        return _make_me_response(200, {})

    def post_side_effect(url, *args, **kwargs):
        if "/api/auth/refresh" in str(url):
            return _make_me_response(200, {"access_token": "fresh-access-fedcba9876543210"})
        return _make_me_response(200, {})

    with patch("httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(side_effect=get_side_effect)
        instance.post = AsyncMock(side_effect=post_side_effect)
        r = client.get("/api/subscription/status")

    assert r.status_code == 200
    body = r.json()
    assert body["connected"] is True, "expired access token should refresh, not disconnect"
    assert body["connection_mode"] == "freeswarm-pro"

    from backend.apps.settings.settings import load_settings
    s = load_settings()
    assert s.freeswarm_bearer_token == "fresh-access-fedcba9876543210", "bearer not re-minted"


def test_dead_refresh_token_disconnects(client, reset_settings):
    """Cloud 401 + a refresh token the cloud also rejects => disconnect to own_key."""
    _seed_pro()

    def get_side_effect(url, *args, **kwargs):
        if "/api/me" in str(url):
            return _make_me_response(401)
        return _make_me_response(200, {})

    def post_side_effect(url, *args, **kwargs):
        if "/api/auth/refresh" in str(url):
            return _make_me_response(401)  # refresh token also dead
        return _make_me_response(200, {})

    with patch("httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(side_effect=get_side_effect)
        instance.post = AsyncMock(side_effect=post_side_effect)
        r = client.get("/api/subscription/status")

    assert r.status_code == 200
    body = r.json()
    assert body["connected"] is False
    assert body["connection_mode"] == "own_key"
    assert body["reason"] == "revoked"

    from backend.apps.settings.settings import load_settings
    s = load_settings()
    assert s.freeswarm_bearer_token is None, "dead session should clear the bearer"


def test_no_refresh_token_disconnects(client, reset_settings):
    """Cloud 401 + no refresh token at all => disconnect (legacy behavior)."""
    _seed_pro(refresh_token=None)

    refresh_called = {"hit": False}

    def get_side_effect(url, *args, **kwargs):
        if "/api/me" in str(url):
            return _make_me_response(401)
        return _make_me_response(200, {})

    def post_side_effect(url, *args, **kwargs):
        if "/api/auth/refresh" in str(url):
            refresh_called["hit"] = True
        return _make_me_response(200, {})

    with patch("httpx.AsyncClient") as MockClient:
        instance = MockClient.return_value.__aenter__.return_value
        instance.get = AsyncMock(side_effect=get_side_effect)
        instance.post = AsyncMock(side_effect=post_side_effect)
        r = client.get("/api/subscription/status")

    assert r.status_code == 200
    assert r.json()["connected"] is False
    # No refresh token means we never even call /api/auth/refresh.
    assert refresh_called["hit"] is False
