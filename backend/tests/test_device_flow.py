"""Device authorization grant (RFC 8628), desktop side.

/device/start asks the cloud for a code pair and hands the renderer an opaque
flow_id (never the secret device_code). /device/poll relays the cloud's status
and, on 'approved', persists the cloud-minted token pair through the same path
as the OAuth handoff so the user lands signed in.
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


@pytest.fixture(autouse=True)
def clear_flows():
    from backend.apps.auth import device
    device._device_flows.clear()
    yield
    device._device_flows.clear()


def _resp(status_code, payload):
    r = AsyncMock()
    r.status_code = status_code
    r.json = lambda: payload
    r.text = ""
    return r


def _post_router(routes):
    """Build a post side_effect that dispatches by URL path to a payload dict."""
    def side_effect(url, *args, **kwargs):
        for frag, (code, payload) in routes.items():
            if frag in str(url):
                return _resp(code, payload)
        return _resp(200, {})
    return side_effect


def test_start_returns_flow_and_user_code(client, reset_settings):
    routes = {
        "/api/auth/device/code": (200, {
            "device_code": "secret-device-code-xyz",
            "user_code": "ABCD-2345",
            "verification_uri": "https://freeswarm.example/device",
            "verification_uri_complete": "https://freeswarm.example/device?code=ABCD-2345",
            "expires_in": 900,
            "interval": 5,
        }),
    }
    with patch("httpx.AsyncClient") as MockClient:
        inst = MockClient.return_value.__aenter__.return_value
        inst.post = AsyncMock(side_effect=_post_router(routes))
        r = client.post("/api/auth/device/start")

    assert r.status_code == 200
    body = r.json()
    assert body["user_code"] == "ABCD-2345"
    assert body["flow_id"]
    # The secret device_code must never be handed to the renderer.
    assert "device_code" not in body
    assert body["verification_uri"].endswith("/device")

    from backend.apps.auth import device
    assert device._device_flows[body["flow_id"]]["device_code"] == "secret-device-code-xyz"


def test_poll_pending_then_approved_persists(client, reset_settings):
    # Seed a flow directly so the test controls the device_code.
    from backend.apps.auth import device
    import time
    device._device_flows["flow-1"] = {
        "device_code": "secret-1", "interval": 5, "exp": time.time() + 900,
    }

    pending = {"/api/auth/device/token": (200, {"status": "pending", "interval": 5})}
    with patch("httpx.AsyncClient") as MockClient:
        inst = MockClient.return_value.__aenter__.return_value
        inst.post = AsyncMock(side_effect=_post_router(pending))
        r = client.post("/api/auth/device/poll", json={"flow_id": "flow-1"})
    assert r.json()["status"] == "pending"

    approved = {"/api/auth/device/token": (200, {
        "status": "approved",
        "access_token": "access-abcdef0123456789",
        "refresh_token": "refresh-abcdef0123456789",
        "user_id": "user-42",
        "email": "pat@example.com",
        "signin_method": "google",
        "plan": "pro",
        "expires": "2099-01-01T00:00:00+00:00",
    })}
    with patch("httpx.AsyncClient") as MockClient:
        inst = MockClient.return_value.__aenter__.return_value
        inst.post = AsyncMock(side_effect=_post_router(approved))
        r = client.post("/api/auth/device/poll", json={"flow_id": "flow-1"})

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "approved"
    assert body["email"] == "pat@example.com"
    # Flow consumed.
    assert "flow-1" not in device._device_flows

    from backend.apps.settings.settings import load_settings
    s = load_settings()
    assert s.user_id == "user-42"
    assert s.user_email == "pat@example.com"
    assert s.freeswarm_bearer_token == "access-abcdef0123456789"
    assert s.freeswarm_refresh_token == "refresh-abcdef0123456789"
    # A paid plan flips into pro routing.
    assert s.connection_mode == "freeswarm-pro"
    assert s.freeswarm_subscription_plan == "pro"


def test_poll_free_plan_signs_in_without_pro_routing(client, reset_settings):
    from backend.apps.auth import device
    from backend.apps.settings.settings import load_settings, _save_settings
    import time
    s = load_settings()
    s.connection_mode = "own_key"
    _save_settings(s)
    device._device_flows["flow-free"] = {
        "device_code": "secret-f", "interval": 5, "exp": time.time() + 900,
    }

    approved = {"/api/auth/device/token": (200, {
        "status": "approved",
        "access_token": "access-free-0123456789",
        "refresh_token": "refresh-free-0123456789",
        "user_id": "user-free",
        "email": "free@example.com",
        "signin_method": "github",
        "plan": "free",
        "expires": None,
    })}
    with patch("httpx.AsyncClient") as MockClient:
        inst = MockClient.return_value.__aenter__.return_value
        inst.post = AsyncMock(side_effect=_post_router(approved))
        r = client.post("/api/auth/device/poll", json={"flow_id": "flow-free"})

    assert r.json()["status"] == "approved"
    s = load_settings()
    assert s.user_id == "user-free"
    # Bearer stored for identity, but free plan stays on own_key routing.
    assert s.freeswarm_bearer_token == "access-free-0123456789"
    assert s.connection_mode == "own_key"


def test_poll_denied_drops_flow(client, reset_settings):
    from backend.apps.auth import device
    import time
    device._device_flows["flow-d"] = {
        "device_code": "secret-d", "interval": 5, "exp": time.time() + 900,
    }
    denied = {"/api/auth/device/token": (200, {"status": "denied"})}
    with patch("httpx.AsyncClient") as MockClient:
        inst = MockClient.return_value.__aenter__.return_value
        inst.post = AsyncMock(side_effect=_post_router(denied))
        r = client.post("/api/auth/device/poll", json={"flow_id": "flow-d"})

    assert r.json()["status"] == "denied"
    assert "flow-d" not in device._device_flows


def test_poll_unknown_flow_is_expired(client, reset_settings):
    r = client.post("/api/auth/device/poll", json={"flow_id": "nope"})
    assert r.status_code == 200
    assert r.json()["status"] == "expired"


def test_cancel_drops_flow(client, reset_settings):
    from backend.apps.auth import device
    import time
    device._device_flows["flow-c"] = {
        "device_code": "secret-c", "interval": 5, "exp": time.time() + 900,
    }
    r = client.post("/api/auth/device/cancel", json={"flow_id": "flow-c"})
    assert r.json()["ok"] is True
    assert "flow-c" not in device._device_flows
