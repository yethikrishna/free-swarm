"""Keychain-managed API keys must never persist to settings.json.

Once a provider key is held in the in-memory keychain store (pushed from the OS
keychain by the renderer), it has to be stripped from disk: both on /secrets/push
and on any subsequent full-object settings PUT that still carries the old value.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.apps.settings import secret_store


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
    secret_store.clear_secrets()


def test_push_blanks_key_on_disk(client, reset_settings):
    """A key the renderer pushes from the keychain is removed from settings.json."""
    from backend.apps.settings.settings import load_settings, _save_settings

    s = load_settings()
    s.anthropic_api_key = "sk-ant-on-disk-000000000000"
    _save_settings(s)

    r = client.post("/api/settings/secrets/push", json={"secrets": {"anthropic_api_key": "sk-ant-keychain-1111"}})
    assert r.status_code == 200
    assert r.json()["present"]["anthropic_api_key"] is True

    # Disk no longer holds the plaintext key; the store does.
    assert load_settings().anthropic_api_key is None
    assert secret_store.get_secret("anthropic_api_key") == "sk-ant-keychain-1111"


def test_settings_put_cannot_readd_keychained_key(client, reset_settings):
    """A stale full-form PUT carrying the old key value can't re-write it to disk
    once that key is keychain-managed."""
    from backend.apps.settings.settings import load_settings

    secret_store.push_secrets({"openai_api_key": "sk-keychain-only-2222"})

    snapshot = client.get("/api/settings").json()
    stale = dict(snapshot)
    stale["openai_api_key"] = "sk-stale-plaintext-3333"  # renderer snapshot still has a value
    stale["user_name"] = "Edit Alongside"

    r = client.put("/api/settings", json=stale)
    assert r.status_code == 200

    s = load_settings()
    assert s.openai_api_key is None, "keychained key leaked back to disk via PUT"
    assert s.user_name == "Edit Alongside", "unrelated edit must still apply"
    # The store value is untouched, so resolution still works.
    assert secret_store.get_secret("openai_api_key") == "sk-keychain-only-2222"


def test_present_endpoint_reflects_store(client, reset_settings):
    secret_store.clear_secrets()
    r = client.get("/api/settings/secrets/present")
    assert r.status_code == 200
    assert r.json()["present"] == {
        "anthropic_api_key": False,
        "openai_api_key": False,
        "google_api_key": False,
        "openrouter_api_key": False,
    }


def test_clear_endpoint_empties_store(client, reset_settings):
    secret_store.push_secrets({"google_api_key": "g-key"})
    r = client.post("/api/settings/secrets/clear")
    assert r.status_code == 200
    assert not secret_store.has_any()
