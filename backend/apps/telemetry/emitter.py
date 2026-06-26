"""Cost + audit producers (F4 / F6): emit per-turn spend and run events to the
FreeSwarm cloud so the account portal's Cost and Activity tabs have data.

Leaf module: no agent-stack imports at module load. The agent loop calls
`emit_turn_cost()` at the turn boundary as fire-and-forget; settings + httpx are
the only deps. Two correctness rules earn their keep:

  1. Cost is emitted as a per-turn DELTA. The SDK reports *cumulative* session
     cost, but the cloud SUMs cost_events, so we subtract the last value we sent
     and only post the difference. Deltas are clamped to >= 0 so a `/clear`
     (which resets session.cost_usd to 0) can never emit a negative row.
  2. submission_id = "<session>:<n>" makes every post idempotent. The cloud
     dedups on (install_id, submission_id), so a retried or restart-replayed
     post is ignored instead of double-counting. The tradeoff is that after a
     process restart the in-memory baseline resets and the first few turns
     collide-and-drop; we under-report rather than ever over-report.

Every failure is swallowed. Telemetry must never break or slow a turn.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

FREESWARM_DEFAULT_PROXY_URL = "https://api.freeswarm.myndlabs.tech"

# Per-session last cumulative cost we emitted, so we can post deltas.
_last_cost: dict[str, float] = {}
# Per-session monotonic counter backing idempotent submission_ids.
_seq: dict[str, int] = {}


def cost_delta(session_id: str, cumulative: float) -> float:
    """This turn's spend = cumulative - last-emitted, clamped to >= 0."""
    prev = _last_cost.get(session_id, 0.0)
    delta = cumulative - prev
    _last_cost[session_id] = cumulative
    return delta if delta > 0 else 0.0


def forget_session(session_id: str) -> None:
    """Drop a session's delta baseline (call on close/clear)."""
    _last_cost.pop(session_id, None)
    _seq.pop(session_id, None)


def _next_seq(session_id: str) -> int:
    n = _seq.get(session_id, 0) + 1
    _seq[session_id] = n
    return n


def _account() -> tuple[Optional[str], str, Optional[str]]:
    """(account_bearer, base_url, install_id). Bearer is None when the user has
    not signed in to a FreeSwarm account, in which case callers no-op.

    Uses the account bearer directly (not proxy_auth) so cost/audit flow for any
    signed-in user regardless of which inference provider they run locally."""
    try:
        from backend.apps.settings.store import load_settings
        s = load_settings()
        tok = getattr(s, "freeswarm_bearer_token", None)
        base = (getattr(s, "freeswarm_proxy_url", None) or FREESWARM_DEFAULT_PROXY_URL).rstrip("/")
        install_id = getattr(s, "installation_id", None)
        return tok, base, install_id
    except Exception:
        return None, FREESWARM_DEFAULT_PROXY_URL, None


async def _post(base: str, path: str, bearer: str, body: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            await client.post(
                f"{base}{path}",
                headers={"Authorization": f"Bearer {bearer}"},
                json=body,
            )
    except Exception:
        logger.debug("telemetry POST %s failed (ignored)", path, exc_info=True)


def _schedule(coro) -> None:
    """Fire-and-forget on the running loop; a no-op if none is running."""
    try:
        asyncio.create_task(coro)
    except RuntimeError:
        coro.close()


def build_cost_body(
    install_id: Optional[str], submission_id: str, provider: str, model: str,
    input_tokens: int, output_tokens: int, delta_usd: float,
) -> dict:
    return {
        "install_id": install_id,
        "submission_id": submission_id,
        "provider": provider or "anthropic",
        "model": model or "",
        "input_tokens": int(input_tokens or 0),
        "output_tokens": int(output_tokens or 0),
        "cost_usd": round(float(delta_usd), 8),
    }


def emit_turn_cost(
    session_id: str, model: str, provider: str,
    cumulative_cost_usd: float, input_tokens: int, output_tokens: int,
) -> None:
    """Record this turn's cost delta + token counts to the cloud. Safe to call
    from inside the agent loop: fire-and-forget, never raises, never blocks."""
    delta = cost_delta(session_id, float(cumulative_cost_usd or 0.0))
    # Free routes legitimately cost 0; still record token volume for analytics.
    if delta <= 0 and not (input_tokens or output_tokens):
        return
    bearer, base, install_id = _account()
    if not bearer:
        return
    body = build_cost_body(
        install_id, f"{session_id}:{_next_seq(session_id)}",
        provider, model, input_tokens, output_tokens, delta,
    )
    _schedule(_post(base, "/api/cost/ingest", bearer, body))


def emit_audit(action: str, target: str = "", metadata: Optional[dict] = None) -> None:
    """Record an account activity event (e.g. 'agent.run_completed'). Fire-and-
    forget; no-op when signed out."""
    bearer, base, install_id = _account()
    if not bearer:
        return
    body = {
        "action": action,
        "target": target,
        "metadata": metadata or {},
        "install_id": install_id,
    }
    _schedule(_post(base, "/api/audit", bearer, body))
