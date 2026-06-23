"""In-memory secret store for provider API keys.

The renderer keeps API keys in the OS keychain (Electron safeStorage: Keychain on
macOS, DPAPI on Windows, libsecret on Linux) and pushes them here on boot and on
change, so the live keys never have to sit in plaintext settings.json. This store
is RAM-only and is rebuilt from the keychain every launch.

Strictly additive: when nothing has been pushed (dev, headless Linux without a
Secret Service, or a fresh migration) every resolver falls straight back to the
settings.json value, so behavior is unchanged until the keychain path is active.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.apps.settings.models import AppSettings

# Provider key fields that can be sourced from the keychain instead of disk.
SECRET_FIELDS = (
    "anthropic_api_key",
    "openai_api_key",
    "google_api_key",
    "openrouter_api_key",
)

_secrets: dict[str, str] = {}


def push_secrets(values: dict[str, str | None]) -> None:
    """Upsert keychain-backed secrets. A falsy value deletes that entry."""
    for name, value in values.items():
        if name not in SECRET_FIELDS:
            continue
        if value:
            _secrets[name] = value
        else:
            _secrets.pop(name, None)


def clear_secrets() -> None:
    """Drop every in-memory secret (sign-out / lock)."""
    _secrets.clear()


def get_secret(name: str) -> str | None:
    return _secrets.get(name)


def has(name: str) -> bool:
    return bool(_secrets.get(name))


def has_any() -> bool:
    return bool(_secrets)


def present_map() -> dict[str, bool]:
    """Which keychain-backed secrets are currently loaded (for the UI presence UX)."""
    return {field: bool(_secrets.get(field)) for field in SECRET_FIELDS}


def resolve(settings: "AppSettings", attr: str) -> str | None:
    """Keychain-backed value first, then the settings.json fallback."""
    value = _secrets.get(attr)
    if value:
        return value
    return getattr(settings, attr, None)
