"""Routing SubApp (P10): per-turn model-routing preview + policy management.

Advisory by design. The engine recommends the cheapest capable model per turn;
the agent stack can opt in by calling `pick_for_turn` at launch, but routing is
disabled by default so existing behavior is unchanged until a user turns it on.

Routes (prefix /api/routing):
  POST /preview   {prompt, model, signals?}     -> full decision (works even when disabled)
  GET  /policy                                  -> {enabled, daily_budget_usd, spent_today_usd, ...}
  PUT  /policy    {enabled?, daily_budget_usd?}  -> updated policy
  POST /record    {cost_usd}                     -> add to today's spend (feeds the governor)
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Optional

from pydantic import BaseModel
from typeguard import typechecked

from backend.config.Apps import SubApp
from backend.apps.routing import router as router_mod
from backend.apps.routing import policy as policy_mod


@asynccontextmanager
async def routing_lifespan():
    yield


routing = SubApp("routing", routing_lifespan)


class PreviewBody(BaseModel):
    prompt: str = ""
    model: str = "sonnet"
    signals: Optional[dict] = None


class PolicyBody(BaseModel):
    enabled: Optional[bool] = None
    daily_budget_usd: Optional[float] = None


class RecordBody(BaseModel):
    cost_usd: float


@routing.router.post("/preview")
@typechecked
async def preview(body: PreviewBody) -> dict:
    return router_mod.pick(body.prompt, body.model, body.signals)


@routing.router.get("/policy")
@typechecked
async def get_policy() -> dict:
    return policy_mod.load_policy()


@routing.router.put("/policy")
@typechecked
async def put_policy(body: PolicyBody) -> dict:
    return policy_mod.set_policy(body.model_dump(exclude_none=True))


@routing.router.post("/record")
@typechecked
async def record(body: RecordBody) -> dict:
    return policy_mod.record_spend(body.cost_usd)


def pick_for_turn(prompt: str, model_value: str, signals: Optional[dict] = None) -> str:
    """Seam for the agent stack: returns the model to actually use for a turn.
    A no-op (returns the selected model) unless routing is enabled in policy."""
    decision = router_mod.pick(prompt, model_value, signals)
    return decision["chosen_model"] if decision.get("enabled") else model_value
