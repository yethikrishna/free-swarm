"""Lightweight lexical retrieval for the agent playbook (P8). Pure + testable.

No embedding service: we tokenize, drop stopwords, and rank by Jaccard overlap.
That is a 50-microsecond retrieval that's good enough to surface "you've seen a
task like this" without a model call. The interface (`retrieve`) is stable so a
vector/ANN backend can replace the scorer later without touching callers.
"""

from __future__ import annotations

import re
from typing import Callable

_WORD = re.compile(r"[a-z0-9]+")
_STOP = {
    "the", "and", "for", "with", "this", "that", "you", "are", "was", "but",
    "not", "have", "has", "from", "your", "all", "can", "use", "using", "into",
    "out", "get", "got", "set", "add", "any", "its", "it's", "they", "them",
    "then", "than", "what", "when", "where", "which", "will", "would", "should",
    "could", "about", "there", "here", "some", "more", "make", "made",
}


def tokenize(text: str) -> set[str]:
    return {w for w in _WORD.findall((text or "").lower()) if len(w) > 2 and w not in _STOP}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / len(a | b)


def retrieve(entries: list[dict], query: str, k: int = 3,
             text_of: Callable[[dict], str] | None = None) -> list[dict]:
    """Top-k entries most similar to `query`, each annotated with `_score`.
    Entries scoring 0 are dropped, so an unrelated query returns nothing."""
    text_of = text_of or (lambda e: f"{e.get('task', '')} {e.get('lesson', '')} {' '.join(e.get('tags', []))}")
    qt = tokenize(query)
    scored: list[tuple[float, dict]] = []
    for e in entries:
        s = jaccard(qt, tokenize(text_of(e)))
        if s > 0:
            scored.append((s, e))
    scored.sort(key=lambda t: (-t[0], -float(t[1].get("hits", 0) or 0)))
    return [{**e, "_score": round(s, 4)} for s, e in scored[:k]]
