"""Context SubApp (P2): preview adaptive tiered compression + retrieve from the
cold tier. Advisory, the proven compaction path in agent_manager is untouched;
this exposes the engine so a UI (or a future opt-in seam) can show what a
budget-aware compaction would keep, summarize, and archive.

Routes (prefix /api/context):
  POST /plan      {messages, budget_tokens?, hot_frac?, warm_frac?}  tier plan + compacted view
  POST /retrieve  {messages, query, k?}   pull the most relevant cold-tier messages back
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Optional

from pydantic import BaseModel
from typeguard import typechecked

from backend.config.Apps import SubApp
from backend.apps.context import tiers
from backend.apps.context.importance import text_of
from backend.apps.memory import similarity


@asynccontextmanager
async def context_lifespan():
    yield


context = SubApp("context", context_lifespan)


class PlanBody(BaseModel):
    messages: list
    budget_tokens: Optional[int] = None
    hot_frac: Optional[float] = None
    warm_frac: Optional[float] = None


class RetrieveBody(BaseModel):
    messages: list
    query: str
    budget_tokens: Optional[int] = None
    k: Optional[int] = None


@context.router.post("/plan")
@typechecked
async def plan(body: PlanBody) -> dict:
    budget = max(1000, int(body.budget_tokens or 8000))
    return tiers.build_compacted(
        [m for m in body.messages if isinstance(m, dict)],
        budget,
        hot_frac=body.hot_frac if body.hot_frac is not None else 0.5,
        warm_frac=body.warm_frac if body.warm_frac is not None else 0.35,
    )


@context.router.post("/retrieve")
@typechecked
async def retrieve(body: RetrieveBody) -> dict:
    """Semantic pull from the cold tier: given the same messages + budget, find
    the archived (cold) messages most relevant to a query and surface them."""
    budget = max(1000, int(body.budget_tokens or 8000))
    msgs = [m for m in body.messages if isinstance(m, dict)]
    plan_out = tiers.plan_tiers(msgs, budget)
    cold = [{"role": m.get("role", ""), "text": text_of(m.get("content"))} for m in plan_out["cold"]]
    k = max(1, min(10, body.k or 3))
    hits = similarity.retrieve(cold, body.query, k=k, text_of=lambda e: e["text"])
    return {"matches": hits, "cold_count": len(cold)}
