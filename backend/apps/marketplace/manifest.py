"""Template <-> marketplace-manifest conversion (P5). Pure + unit-tested.

A marketplace skill's installable payload is an F10 agent template: a
system_prompt, model, tools, skills, plus name/description. These helpers
normalize between the local template shape (what automation.store persists) and
the manifest the cloud stores, dropping local-only fields (ids, timestamps) on
publish and stamping provenance on install.
"""

from __future__ import annotations

from typing import Any

_MANIFEST_KEYS = ("name", "description", "system_prompt", "model", "tools", "skills")


def template_to_manifest(template: dict) -> dict:
    """Strip a local template to its portable fields for publishing."""
    manifest: dict[str, Any] = {}
    for k in _MANIFEST_KEYS:
        v = template.get(k)
        if v is not None:
            manifest[k] = v
    # Lists default to empty so the receiver never has to None-check.
    manifest.setdefault("tools", [])
    manifest.setdefault("skills", [])
    return manifest


def manifest_to_template(manifest: dict, *, slug: str = "", version: str = "") -> dict:
    """Turn an installed manifest into a local template payload, recording where
    it came from so an installed skill is distinguishable from a hand-made one."""
    manifest = manifest if isinstance(manifest, dict) else {}
    template: dict[str, Any] = {
        "name": str(manifest.get("name") or slug or "Installed skill"),
        "description": str(manifest.get("description") or ""),
        "system_prompt": manifest.get("system_prompt"),
        "model": manifest.get("model"),
        "tools": list(manifest.get("tools") or []),
        "skills": list(manifest.get("skills") or []),
    }
    if slug:
        template["source"] = {"marketplace_slug": slug, "version": version}
    # Drop keys that ended up None so the template store stays tidy.
    return {k: v for k, v in template.items() if v is not None}


def manifest_problems(manifest: Any) -> list[str]:
    """Validate a manifest before publish. Empty list == ok."""
    if not isinstance(manifest, dict):
        return ["manifest must be an object"]
    problems: list[str] = []
    if not str(manifest.get("name") or "").strip():
        problems.append("manifest.name is required")
    for list_key in ("tools", "skills"):
        if list_key in manifest and not isinstance(manifest[list_key], list):
            problems.append(f"manifest.{list_key} must be a list")
    return problems
