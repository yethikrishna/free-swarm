"""Multi-tier context model (P2). Pure + unit-tested.

Three tiers, newest to oldest:
  hot  - the working set, kept verbatim (fills ~hot_frac of the budget)
  warm - recent-but-not-current, summarized to a fraction of their size
  cold - everything older, archived to a single placeholder + a retrievable index

`plan_tiers` partitions by a token budget; `build_compacted` renders the
compacted view (cold placeholder -> warm summaries -> hot verbatim) using an
injectable summarizer (default extractive, so it's testable without an LLM).
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from backend.apps.context.importance import text_of


def estimate_tokens(text: str) -> int:
    # ~4 chars/token is the standard rough heuristic.
    return max(1, len(text or "") // 4)


def extractive_summary(text: str, max_chars: int = 200) -> str:
    text = (text or "").strip()
    if len(text) <= max_chars:
        return text
    head = text[:max_chars]
    # Prefer to cut on a sentence boundary if one is near the end of the window.
    dot = head.rfind(". ")
    if dot > max_chars * 0.5:
        return head[: dot + 1]
    return head.rstrip() + "..."


def plan_tiers(messages: list[dict], budget_tokens: int,
               hot_frac: float = 0.5, warm_frac: float = 0.35,
               est: Optional[Callable[[str], int]] = None) -> dict:
    """Assign each message to hot/warm/cold by walking newest-first against the
    budget. Pinned messages are always hot. Returns chronological lists."""
    est = est or estimate_tokens
    hot_budget = budget_tokens * hot_frac
    warm_budget = budget_tokens * warm_frac
    used_hot = used_warm = 0.0
    hot: list[dict] = []
    warm: list[dict] = []
    cold: list[dict] = []

    for m in reversed(messages):
        t = est(text_of(m.get("content")))
        if m.get("pinned"):
            hot.append(m)
            used_hot += t
            continue
        if used_hot + t <= hot_budget:
            hot.append(m)
            used_hot += t
        elif used_warm + t <= warm_budget:
            warm.append(m)
            used_warm += t
        else:
            cold.append(m)

    return {
        "hot": list(reversed(hot)),
        "warm": list(reversed(warm)),
        "cold": list(reversed(cold)),
    }


def build_compacted(messages: list[dict], budget_tokens: int,
                    summarize: Optional[Callable[[str], str]] = None,
                    hot_frac: float = 0.5, warm_frac: float = 0.35,
                    est: Optional[Callable[[str], int]] = None) -> dict:
    """Render the compacted view + stats. Cold collapses to one placeholder,
    warm is summarized, hot is verbatim."""
    est = est or estimate_tokens
    summarize = summarize or extractive_summary
    plan = plan_tiers(messages, budget_tokens, hot_frac, warm_frac, est)

    out: list[dict] = []
    if plan["cold"]:
        out.append({
            "role": "system",
            "text": f"[{len(plan['cold'])} earlier messages archived; retrievable on demand]",
            "tier": "cold",
        })
    for m in plan["warm"]:
        out.append({
            "role": m.get("role", ""),
            "text": summarize(text_of(m.get("content"))),
            "tier": "warm",
        })
    for m in plan["hot"]:
        out.append({
            "role": m.get("role", ""),
            "text": text_of(m.get("content")),
            "tier": "hot",
        })

    before = sum(est(text_of(m.get("content"))) for m in messages)
    after = sum(est(o["text"]) for o in out)
    return {
        "messages": out,
        "stats": {
            "hot": len(plan["hot"]), "warm": len(plan["warm"]), "cold": len(plan["cold"]),
            "tokens_before": before, "tokens_after": after,
            "saved_pct": round(1 - (after / before), 4) if before else 0.0,
        },
    }
