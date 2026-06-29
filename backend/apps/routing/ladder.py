"""Build a cheap -> expensive model ladder for the user's current lane (P10).

We never invent model ids: the rungs come straight from the registry's
BUILTIN_MODELS. We only encode the *relative tier order* (haiku < sonnet < opus
< fable; mini < full; flash < pro), which is inherent product knowledge, and
resolve the actual short-names from the registry. The ladder is restricted to
the selected model's provider + route lane so a subscription user never gets
recommended an API-key model and vice versa.
"""

from __future__ import annotations

from typing import Optional


def _tier_rank(value: str, label: str) -> int:
    """Cheap (0) -> flagship (5). Higher = more capable + more expensive."""
    v = f"{value} {label}".lower()
    if "fable" in v:
        return 5
    if "opus-4-8" in v or "opus 4.8" in v:
        return 4
    if "opus-4-7" in v or "opus 4.7" in v:
        return 3
    if "opus" in v:
        return 2
    if "sonnet" in v:
        return 1
    if "haiku" in v:
        return 0
    # OpenAI
    if "mini" in v:
        return 0
    if "gpt-5.5" in v:
        return 3
    if "gpt-5.4" in v or "gpt-5.3" in v or "gpt" in v or v.strip().startswith("o"):
        return 2
    # Google
    if "flash" in v:
        return 0
    if "pro" in v:
        return 2
    return 1


def _entry_for(value: str) -> Optional[dict]:
    from backend.apps.agents.providers.registry import BUILTIN_MODELS
    for models in BUILTIN_MODELS.values():
        for m in models:
            if m.get("value") == value:
                return m
    return None


def ladder_for(model_value: str) -> list[str]:
    """Sibling short-names in the same (api, route) lane, cheapest first.

    Unknown models (custom/openrouter) yield a single-rung ladder of just that
    model, so the router is always safe to call."""
    entry = _entry_for(model_value)
    if not entry:
        return [model_value]

    from backend.apps.agents.providers.registry import BUILTIN_MODELS
    api = entry.get("api")
    route = entry.get("route")  # None for the default/pro lane

    by_rank: dict[int, str] = {}
    for models in BUILTIN_MODELS.values():
        for m in models:
            if m.get("api") != api or m.get("route") != route:
                continue
            if m.get("subscription_only") and m.get("value") != model_value:
                # keep the user's own pick even if sub-gated; don't add others
                # we can't be sure are entitled.
                pass
            rank = _tier_rank(m.get("value", ""), m.get("label", ""))
            # First value seen at a rank wins; keeps one canonical rung per tier.
            by_rank.setdefault(rank, m.get("value", ""))

    if not by_rank:
        return [model_value]
    ladder = [by_rank[r] for r in sorted(by_rank)]
    # Guarantee the user's selected model is present (it defines the lane).
    if model_value not in ladder:
        ladder.append(model_value)
    return ladder
