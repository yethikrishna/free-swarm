"""The in-memory secret store backs keychain-sourced API keys. These tests pin
the two invariants credential resolution depends on: keychain values win over
settings.json, and an empty store is transparent (falls straight back to disk)."""

from __future__ import annotations

import pytest

from backend.apps.settings import secret_store


@pytest.fixture(autouse=True)
def _clear_store():
    secret_store.clear_secrets()
    yield
    secret_store.clear_secrets()


class _FakeSettings:
    def __init__(self, **kw):
        self.anthropic_api_key = kw.get("anthropic_api_key")
        self.openai_api_key = kw.get("openai_api_key")
        self.google_api_key = kw.get("google_api_key")
        self.openrouter_api_key = kw.get("openrouter_api_key")


def test_empty_store_falls_back_to_settings():
    s = _FakeSettings(anthropic_api_key="disk-key")
    assert secret_store.resolve(s, "anthropic_api_key") == "disk-key"
    assert not secret_store.has_any()


def test_keychain_value_wins_over_settings():
    s = _FakeSettings(anthropic_api_key="disk-key")
    secret_store.push_secrets({"anthropic_api_key": "keychain-key"})
    assert secret_store.resolve(s, "anthropic_api_key") == "keychain-key"


def test_falsy_push_deletes_entry():
    s = _FakeSettings(anthropic_api_key="disk-key")
    secret_store.push_secrets({"anthropic_api_key": "keychain-key"})
    secret_store.push_secrets({"anthropic_api_key": None})
    assert secret_store.resolve(s, "anthropic_api_key") == "disk-key"


def test_unknown_field_ignored():
    secret_store.push_secrets({"evil_field": "x", "openai_api_key": "ok"})
    assert secret_store.get_secret("evil_field") is None
    assert secret_store.get_secret("openai_api_key") == "ok"


def test_present_map_shape():
    secret_store.push_secrets({"google_api_key": "g"})
    pm = secret_store.present_map()
    assert pm == {
        "anthropic_api_key": False,
        "openai_api_key": False,
        "google_api_key": True,
        "openrouter_api_key": False,
    }


def test_clear_wipes_everything():
    secret_store.push_secrets({"openai_api_key": "k", "google_api_key": "g"})
    secret_store.clear_secrets()
    assert not secret_store.has_any()
    assert secret_store.present_map() == {
        "anthropic_api_key": False,
        "openai_api_key": False,
        "google_api_key": False,
        "openrouter_api_key": False,
    }
