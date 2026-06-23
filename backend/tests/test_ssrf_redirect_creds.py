"""Regression: safe_fetch must not forward credentials across a redirect to a
different host. A malicious/compromised endpoint that 302s to a host it controls
could otherwise harvest the user's bearer token / API key."""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import httpx

from backend.apps.agents.tools import ssrf_guard


def _run(headers, script):
    """Drive safe_fetch with a fake client; return the per-hop headers seen."""
    seen: list[tuple[str, dict]] = []

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None):
            seen.append((url, dict(headers or {})))
            return script(url)

    async def _fake_assert(url):
        return url

    with patch.object(ssrf_guard, "assert_safe_url", _fake_assert), \
         patch.object(ssrf_guard.httpx, "AsyncClient", FakeClient):
        resp = asyncio.run(ssrf_guard.safe_fetch("https://a.example/start", headers=headers))
    return resp, seen


def test_auth_stripped_on_cross_host_redirect():
    def script(url):
        if url == "https://a.example/start":
            return httpx.Response(302, headers={"location": "https://evil.example/next"})
        return httpx.Response(200, text="ok")

    resp, seen = _run({"Authorization": "Bearer secret", "X-Keep": "1"}, script)

    assert resp.status_code == 200
    assert len(seen) == 2
    # First hop (same host) keeps the bearer; the cross-host hop must not.
    assert seen[0][1].get("Authorization") == "Bearer secret"
    assert "Authorization" not in seen[1][1]
    # Non-sensitive headers still ride along.
    assert seen[1][1].get("X-Keep") == "1"


def test_auth_preserved_on_same_host_redirect():
    def script(url):
        if url == "https://a.example/start":
            return httpx.Response(302, headers={"location": "https://a.example/next"})
        return httpx.Response(200, text="ok")

    resp, seen = _run({"Authorization": "Bearer secret"}, script)

    assert resp.status_code == 200
    assert seen[1][1].get("Authorization") == "Bearer secret"
