"""Shared canonical semantic-screen contract loaded from the package manifest."""

from __future__ import annotations

from importlib.resources import files
import json
from typing import Any


JsonObject = dict[str, Any]


def _load_manifest() -> JsonObject:
    resource = files(__package__).joinpath("semantic_screens.json")
    parsed = json.loads(resource.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise RuntimeError("semantic screen manifest must be an object")
    return parsed


SEMANTIC_SCREEN_MANIFEST = _load_manifest()
SCREEN_ID_ALIASES: dict[str, str] = dict(
    SEMANTIC_SCREEN_MANIFEST.get("aliases", {})
)
ELEMENT_ID_ALIASES: dict[str, dict[str, str]] = {
    screen_id: dict(aliases)
    for screen_id, aliases in SEMANTIC_SCREEN_MANIFEST.get(
        "element_aliases", {}
    ).items()
}
CANONICAL_SCREEN_IDS = tuple(
    screen["id"] for screen in SEMANTIC_SCREEN_MANIFEST.get("screens", [])
)
LIFECYCLE_SCREEN_IDS = tuple(
    screen["id"]
    for screen in SEMANTIC_SCREEN_MANIFEST.get("screens", [])
    if screen.get("lifecycle") is True
)


def canonical_screen_id(screen_id: str) -> str:
    return SCREEN_ID_ALIASES.get(screen_id, screen_id)


def canonical_element_id(screen_id: str, element_id: str) -> str:
    canonical_screen = canonical_screen_id(screen_id)
    return ELEMENT_ID_ALIASES.get(canonical_screen, {}).get(
        element_id, element_id
    )


def screen_element_templates() -> dict[str, dict[str, JsonObject]]:
    templates: dict[str, dict[str, JsonObject]] = {}
    for screen in SEMANTIC_SCREEN_MANIFEST.get("screens", []):
        elements: dict[str, JsonObject] = {}
        for element in screen.get("elements", []):
            param = element.get("param")
            template: JsonObject = {
                "label": element["label"],
                "kind": "collection" if param else "element",
            }
            if param:
                template["required_params"] = [param]
            if "max_index" in element:
                template["max_index"] = element["max_index"]
            elements[element["id"]] = template
        templates[screen["id"]] = elements
    return templates
