"""Minimal semver for the skill marketplace (P5). Pure + unit-tested.

Just MAJOR.MINOR.PATCH, which is all a template version needs. Used to validate a
publish, compare versions, and compute the next patch/minor/major bump the
publish UI suggests.
"""

from __future__ import annotations

import re

_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def is_valid(version: str) -> bool:
    return bool(_RE.match(str(version or "").strip()))


def parse(version: str) -> tuple[int, int, int]:
    m = _RE.match(str(version or "").strip())
    if not m:
        raise ValueError(f"not a MAJOR.MINOR.PATCH version: {version!r}")
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def compare(a: str, b: str) -> int:
    """-1 if a<b, 0 if equal, 1 if a>b."""
    pa, pb = parse(a), parse(b)
    return (pa > pb) - (pa < pb)


def is_newer(candidate: str, current: str) -> bool:
    return compare(candidate, current) > 0


def bump(version: str, part: str = "patch") -> str:
    major, minor, patch = parse(version)
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"
