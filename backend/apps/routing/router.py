"""The routing decision (P10): map a difficulty level + budget state onto a rung
of the model ladder. Pure `choose`/`target_rung` (unit-tested), plus a thin
`pick` that wires classifier + ladder + policy together.
"""

from __future__ import annotations

import math
from typing import Optional

from backend.apps.routing import classifier, ladder as ladder_mod, policy as policy_mod

_LEVEL_IDX = {lvl: i for i, lvl in enumerate(classifier.LEVELS)}


def target_rung(level: str, n_rungs: int, budget_fraction: Optional[float]) -> int:
    """Which rung (0..n-1) to use. Difficulty scales the rung linearly; a low
    remaining budget caps the top so spend degrades gracefully."""
    if n_rungs <= 1:
        return 0
    idx = _LEVEL_IDX.get(level, 1)
    base = round(idx / (len(classifier.LEVELS) - 1) * (n_rungs - 1))
    if budget_fraction is not None and budget_fraction < 1.0:
        # ceil so a non-empty budget still allows at least rung 1; an empty
        # budget (0.0) pins to the cheapest rung.
        cap = 0 if budget_fraction <= 0 else math.ceil(budget_fraction * (n_rungs - 1))
        base = min(base, cap)
    return max(0, min(n_rungs - 1, base))


def choose(ladder: list[str], level: str, budget_fraction: Optional[float] = None) -> Optional[str]:
    if not ladder:
        return None
    return ladder[target_rung(level, len(ladder), budget_fraction)]


def pick(prompt: str, model_value: str, signals: Optional[dict] = None,
         now: float | None = None) -> dict:
    """Recommend a model for this turn. Always returns a decision; `routed` says
    whether it differs from the user's selection and `enabled` whether the
    policy would actually apply it."""
    cls = classifier.classify(prompt, signals)
    rungs = ladder_mod.ladder_for(model_value)
    pol = policy_mod.load_policy(now)
    frac = policy_mod.budget_fraction(pol)
    chosen = choose(rungs, cls["level"], frac) or model_value
    return {
        "enabled": bool(pol.get("enabled")),
        "level": cls["level"],
        "score": cls["score"],
        "ladder": rungs,
        "chosen_model": chosen,
        "selected_model": model_value,
        "routed": chosen != model_value,
        "budget_fraction": frac,
    }
