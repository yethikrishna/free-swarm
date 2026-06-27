"""Tests for the skill-marketplace pure cores (P5): semver + manifest conversion.
The SubApp itself is a thin cloud proxy; the logic worth testing is here."""

import pytest

from backend.apps.marketplace import semver
from backend.apps.marketplace import manifest as M


# ---- semver ----

def test_is_valid():
    assert semver.is_valid("1.0.0")
    assert semver.is_valid("12.34.56")
    assert not semver.is_valid("1.0")
    assert not semver.is_valid("v1.0.0")
    assert not semver.is_valid("1.0.0-beta")


def test_compare_and_is_newer():
    assert semver.compare("1.0.0", "1.0.1") == -1
    assert semver.compare("2.0.0", "1.9.9") == 1
    assert semver.compare("1.2.3", "1.2.3") == 0
    assert semver.is_newer("1.0.1", "1.0.0")
    assert not semver.is_newer("1.0.0", "1.0.0")


def test_bump():
    assert semver.bump("1.2.3", "patch") == "1.2.4"
    assert semver.bump("1.2.3", "minor") == "1.3.0"
    assert semver.bump("1.2.3", "major") == "2.0.0"


def test_parse_rejects_garbage():
    with pytest.raises(ValueError):
        semver.parse("nope")


# ---- manifest conversion ----

def test_template_to_manifest_strips_local_fields():
    template = {
        "id": "abc123", "created_at": 1.0, "updated_at": 2.0,
        "name": "Refactorer", "description": "cleans code",
        "system_prompt": "You refactor.", "model": "sonnet",
        "tools": ["Read", "Edit"], "skills": ["simplify"],
    }
    m = M.template_to_manifest(template)
    assert "id" not in m and "created_at" not in m
    assert m["name"] == "Refactorer" and m["tools"] == ["Read", "Edit"]


def test_template_to_manifest_defaults_lists():
    m = M.template_to_manifest({"name": "Bare"})
    assert m["tools"] == [] and m["skills"] == []


def test_manifest_to_template_round_trips_and_stamps_source():
    manifest = {"name": "Refactorer", "description": "d", "system_prompt": "p",
                "model": "sonnet", "tools": ["Read"], "skills": []}
    t = M.manifest_to_template(manifest, slug="refactorer", version="1.2.0")
    assert t["name"] == "Refactorer" and t["tools"] == ["Read"]
    assert t["source"] == {"marketplace_slug": "refactorer", "version": "1.2.0"}


def test_manifest_to_template_drops_none_fields():
    t = M.manifest_to_template({"name": "X"})  # no system_prompt/model
    assert "system_prompt" not in t and "model" not in t
    assert t["name"] == "X"


def test_manifest_problems():
    assert M.manifest_problems({"name": "ok"}) == []
    assert "manifest.name is required" in M.manifest_problems({"description": "no name"})
    assert any("tools must be a list" in p for p in M.manifest_problems({"name": "x", "tools": "nope"}))
    assert M.manifest_problems("not a dict") == ["manifest must be an object"]


def test_round_trip_preserves_portable_fields():
    original = {"id": "x", "name": "N", "description": "D", "system_prompt": "S",
               "model": "opus", "tools": ["A"], "skills": ["B"]}
    manifest = M.template_to_manifest(original)
    restored = M.manifest_to_template(manifest)
    for k in ("name", "description", "system_prompt", "model", "tools", "skills"):
        assert restored[k] == original[k]
