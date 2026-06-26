"""Delegation consensus (P1). Pure: before a manager agent spends tokens forking
workers, decide whether the decomposition is worth delegating. A weak split
(one vague subtask, or low confidence) should be attacked directly instead.
"""

from __future__ import annotations


def coherence_score(subtasks: list[str]) -> float:
    """0..1: how delegate-worthy a decomposition looks. Rewards 2+ distinct,
    non-trivial subtasks; penalizes empties and near-duplicates."""
    cleaned = [s.strip() for s in (subtasks or []) if s and s.strip()]
    if len(cleaned) < 2:
        return 0.0
    distinct = {s.lower() for s in cleaned}
    if len(distinct) < 2:
        return 0.0
    # Subtasks that are a few words each (real units of work) beat one-word stubs.
    substantial = sum(1 for s in cleaned if len(s.split()) >= 3)
    base = min(1.0, len(distinct) / 4.0)            # saturates around 4 subtasks
    quality = substantial / len(cleaned)
    return round(0.5 * base + 0.5 * quality, 4)


def should_delegate(subtasks: list[str], confidence: float, threshold: float = 0.5) -> dict:
    """Decide delegate vs go-direct. Returns {delegate, score, reason}."""
    score = coherence_score(subtasks)
    combined = round(score * max(0.0, min(1.0, confidence)), 4)
    if combined >= threshold:
        return {"delegate": True, "score": combined, "reason": "coherent decomposition"}
    if score == 0.0:
        return {"delegate": False, "score": combined, "reason": "not enough distinct subtasks"}
    return {"delegate": False, "score": combined, "reason": "below confidence threshold"}
