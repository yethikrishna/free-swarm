"""Offline local-model endpoint logic (P11, Tier 2). Pure + unit-tested.

True offline-first (a model bundled + quantized into the desktop build) is a
packaging effort, out of scope for app code. What IS app code, and what this
delivers, is the path that already works through the router's custom-provider
support: detect a *user-run* local OpenAI-compatible server (LM Studio, Ollama,
llama.cpp) and prefer it when offline.

This module holds the known-endpoint catalog and the pure selection logic; the
SubApp does the actual reachability probe (I/O) and persists the preference.
"""

from __future__ import annotations

from typing import Callable, Optional

# Common local OpenAI-compatible servers and their default base URLs. All
# loopback, so probing them is safe and never leaves the machine.
CATALOG = [
    {"id": "lmstudio", "name": "LM Studio", "base_url": "http://127.0.0.1:1234/v1"},
    {"id": "ollama", "name": "Ollama", "base_url": "http://127.0.0.1:11434/v1"},
    {"id": "llamacpp", "name": "llama.cpp server", "base_url": "http://127.0.0.1:8080/v1"},
    {"id": "jan", "name": "Jan", "base_url": "http://127.0.0.1:1337/v1"},
]


def catalog() -> list[dict]:
    return [dict(e) for e in CATALOG]


def probe_all(check: Callable[[str], bool]) -> list[dict]:
    """Run `check(base_url) -> reachable` over the catalog and annotate each
    entry. Pure given an injected checker, so the selection logic is testable
    without sockets."""
    out: list[dict] = []
    for entry in CATALOG:
        e = dict(entry)
        try:
            e["reachable"] = bool(check(entry["base_url"]))
        except Exception:
            e["reachable"] = False
        out.append(e)
    return out


def choose_offline(probed: list[dict], preferred_id: Optional[str] = None) -> Optional[dict]:
    """Pick the local provider to use: the preferred one if it's reachable, else
    the first reachable in catalog order. None if nothing is reachable."""
    reachable = [e for e in (probed or []) if e.get("reachable")]
    if not reachable:
        return None
    if preferred_id:
        for e in reachable:
            if e.get("id") == preferred_id:
                return e
    return reachable[0]


def normalize_pref(cfg: dict) -> dict:
    cfg = cfg if isinstance(cfg, dict) else {}
    return {
        "offline_enabled": bool(cfg.get("offline_enabled", False)),
        "preferred_id": str(cfg.get("preferred_id") or "") or None,
    }
