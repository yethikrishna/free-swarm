"""Per-turn difficulty classifier (P10). Pure + deterministic so a turn's
routing decision is cheap (~no model call) and unit-testable.

This is a transparent heuristic, not an LLM: prompt length, code/stack-trace
presence, "hard" vocabulary (architecture, debug, optimize...), multi-step
markers, and trivial markers (rename, typo, what is...) combine into a 0..1
score, bucketed into trivial / easy / medium / hard. An embedding-distance
scorer can later replace `score_prompt` without touching the router.
"""

from __future__ import annotations

import re
from typing import Optional

LEVELS = ("trivial", "easy", "medium", "hard")

_HARD_HINTS = (
    "architect", "design", "refactor", "debug", "optimize", "optimise",
    "algorithm", "concurren", "race condition", "deadlock", "security",
    "migrate", "trade-off", "tradeoff", "analyze", "analyse", "prove",
    "derive", "root cause", "why does", "why is", "explain why",
    "performance", "scalab", "distributed", "thread", "async",
)
_STEP_HINTS = ("then ", "step", "first,", "after that", "finally", "plan",
               "each of", "for every", "as well as")
_TRIVIAL_HINTS = ("rename", "typo", "format ", "lowercase", "uppercase",
                  "add a comment", "bump", "what is the", "capital of",
                  "define ", "spelling", "list the", "how do you spell")

_CODE_RE = re.compile(r"```|\bTraceback\b|\bException\b|\bError:|\bundefined\b")
_NUMBERED_RE = re.compile(r"(^|\n)\s*\d+[.)]\s")


def score_prompt(prompt: str, signals: Optional[dict] = None) -> float:
    """0.0 (trivial) .. 1.0 (hard). Deterministic."""
    text = (prompt or "").strip()
    low = text.lower()
    n = len(text)
    s = 0.0

    # Longer asks skew harder (caps so a pasted file doesn't peg it).
    s += min(0.35, n / 4000.0)
    if _CODE_RE.search(text):
        s += 0.2
    hard_hits = sum(1 for k in _HARD_HINTS if k in low)
    s += min(0.45, hard_hits * 0.12)
    if hard_hits >= 4:
        # A prompt dense with engineering vocabulary is genuinely hard, not just
        # "medium with keywords"; this density bonus lets it clear the bar.
        s += 0.2
    s += min(0.20, sum(1 for k in _STEP_HINTS if k in low) * 0.07)
    if _NUMBERED_RE.search(text):
        s += 0.1

    if sum(1 for k in _TRIVIAL_HINTS if k in low) and n < 200:
        s -= 0.25
    if n < 40:
        s -= 0.15

    sig = signals or {}
    if sig.get("has_images"):
        s += 0.1
    # A large already-accumulated context implies a meatier task.
    ctx = int(sig.get("context_tokens", 0) or 0)
    if ctx > 50_000:
        s += 0.1

    return max(0.0, min(1.0, s))


def level_for_score(score: float) -> str:
    if score < 0.15:
        return "trivial"
    if score < 0.40:
        return "easy"
    if score < 0.65:
        return "medium"
    return "hard"


def classify(prompt: str, signals: Optional[dict] = None) -> dict:
    score = score_prompt(prompt, signals)
    return {"level": level_for_score(score), "score": round(score, 4)}
