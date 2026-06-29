"""Deterministic record/replay core (P9). Pure + unit-tested.

An agent turn is non-deterministic only at its edges: the model's output, each
tool's result, timestamps, RNG. Record those in order and a session re-runs
bit-for-bit, no real model or tool calls. That makes agent behavior reproducible
(the prerequisite for regression tests and shippable bug reports) and enables
"what-if" forks: truncate the log at a checkpoint and let the next run diverge.

Records are `{seq, kind, key, value, ts}`. `kind` is one of model/tool/time/
random. `compress`/`decompress` delta-encode the stream (each record stores only
fields that changed from the previous one) so a long log ships small.
"""

from __future__ import annotations

from typing import Any, Optional

KINDS = ("model", "tool", "time", "random")


class ReplayLog:
    """An ordered, append-only record of a session's non-deterministic inputs."""

    def __init__(self, records: Optional[list[dict]] = None):
        self.records: list[dict] = list(records or [])

    def append(self, kind: str, value: Any, key: Optional[str] = None,
               ts: Optional[float] = None) -> dict:
        seq = (self.records[-1]["seq"] + 1) if self.records else 0
        rec = {"seq": seq, "kind": kind, "key": key, "value": value, "ts": ts}
        self.records.append(rec)
        return rec

    def of_kind(self, kind: str) -> list[dict]:
        return [r for r in self.records if r.get("kind") == kind]


class Player:
    """Replays a recorded log. `next(kind)` hands back the recorded outputs in
    order, so a replay driver substitutes these for live model/tool calls."""

    def __init__(self, records: list[dict]):
        ordered = sorted(records, key=lambda r: r.get("seq", 0))
        self._by_kind: dict[str, list[dict]] = {}
        for r in ordered:
            self._by_kind.setdefault(r.get("kind", ""), []).append(r)
        self._cursor: dict[str, int] = {}

    def next(self, kind: str) -> Optional[dict]:
        i = self._cursor.get(kind, 0)
        seq = self._by_kind.get(kind, [])
        if i >= len(seq):
            return None
        self._cursor[kind] = i + 1
        return seq[i]

    def remaining(self, kind: str) -> int:
        return len(self._by_kind.get(kind, [])) - self._cursor.get(kind, 0)


def fork(records: list[dict], at_seq: int) -> list[dict]:
    """The prefix up to and including `at_seq`, the checkpoint a what-if run
    replays before diverging."""
    return [dict(r) for r in records if r.get("seq", 0) <= at_seq]


def compress(records: list[dict]) -> list[dict]:
    """Delta-encode: each row keeps only fields that changed from the previous."""
    out: list[dict] = []
    prev: dict = {}
    for r in records:
        # `k not in prev` keeps the first record whole, even fields whose value
        # is None (None == prev.get(k) would otherwise silently drop them).
        diff = {k: v for k, v in r.items() if k not in prev or prev[k] != v}
        out.append(diff)
        prev = r
    return out


def decompress(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    cur: dict = {}
    for d in rows:
        cur = {**cur, **d}
        out.append(dict(cur))
    return out
