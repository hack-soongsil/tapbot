"""Typed execution/data port declarations shared by validation and runtime."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from tapbot.macro.graph_models import JsonObject


class PortType(StrEnum):
    EXEC = "exec"
    BOOL = "bool"
    INT = "int"
    FLOAT = "float"
    STRING = "string"
    POSITION = "position"
    RECT = "rect"
    ELEMENT = "element"


@dataclass(frozen=True, slots=True)
class NodePorts:
    inputs: dict[str, PortType]
    outputs: dict[str, PortType]


_TYPED: dict[str, NodePorts] = {
    "element_exists": NodePorts(
        {"exec_in": PortType.EXEC},
        {
            "exec_out": PortType.EXEC,
            "true": PortType.EXEC,
            "false": PortType.EXEC,
            "result": PortType.BOOL,
        },
    ),
    "branch": NodePorts(
        {"exec_in": PortType.EXEC, "condition": PortType.BOOL},
        {"true": PortType.EXEC, "false": PortType.EXEC},
    ),
    "for_loop": NodePorts(
        {"exec_in": PortType.EXEC},
        {"loop": PortType.EXEC, "completed": PortType.EXEC, "index": PortType.INT},
    ),
    "find_element": NodePorts(
        {"exec_in": PortType.EXEC},
        {
            "exec_out": PortType.EXEC,
            "missing": PortType.EXEC,
            "found": PortType.BOOL,
            "result": PortType.BOOL,
            "element": PortType.ELEMENT,
        },
    ),
    "click_element": NodePorts(
        {"exec_in": PortType.EXEC, "element": PortType.ELEMENT},
        {"exec_out": PortType.EXEC},
    ),
    "random_click_area": NodePorts(
        {"exec_in": PortType.EXEC},
        {"exec_out": PortType.EXEC, "sampled_position": PortType.POSITION},
    ),
    "random_drag_area": NodePorts(
        {"exec_in": PortType.EXEC},
        {
            "exec_out": PortType.EXEC,
            "sampled_start": PortType.POSITION,
            "sampled_end": PortType.POSITION,
        },
    ),
    "click_screen_element": NodePorts(
        {"exec_in": PortType.EXEC, "index": PortType.INT},
        {"exec_out": PortType.EXEC},
    ),
}


def ports_for(
    node_type: str,
    config: JsonObject,
    *,
    legacy_output_handles: frozenset[str] = frozenset(),
) -> NodePorts:
    typed = _TYPED.get(node_type)
    if typed is not None:
        return typed
    inputs = {} if node_type.startswith("screen_") else {"exec_in": PortType.EXEC}
    outputs = {handle: PortType.EXEC for handle in legacy_output_handles}
    if node_type == "sequence":
        count = config.get("outputs", 2)
        if isinstance(count, int) and not isinstance(count, bool):
            outputs = {f"then_{index}": PortType.EXEC for index in range(max(0, count))}
    return NodePorts(inputs, outputs)
