"""Typed execution/data port declarations shared by validation and runtime."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from tapbot.macro.graph_models import JsonObject
from tapbot.ui_resolution.semantic_manifest import screen_element_template


class PortType(StrEnum):
    EXEC = "exec"
    ANY = "any"
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
    "debug_print": NodePorts(
        {"exec_in": PortType.EXEC, "value": PortType.ANY},
        {"exec_out": PortType.EXEC},
    ),
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
}


def ports_for(
    node_type: str,
    config: JsonObject,
    *,
    legacy_output_handles: frozenset[str] = frozenset(),
) -> NodePorts:
    if node_type == "find_screen_element":
        inputs = {"exec_in": PortType.EXEC}
        template = screen_element_template(
            config.get("screen_id"), config.get("element_id")
        )
        if template is not None:
            schemas = template.get("params", {})
            for key in template.get("required_params", []):
                schema = schemas.get(key, {}) if isinstance(schemas, dict) else {}
                inputs[key] = _screen_param_port_type(schema)
        return NodePorts(
            inputs,
            {
                "exec_out": PortType.EXEC,
                "found": PortType.BOOL,
                "element": PortType.ELEMENT,
            },
        )
    if node_type in {"set_variable", "get_variable"}:
        variable_type = _variable_port_type(config)
        if node_type == "get_variable":
            return NodePorts({}, {"value": variable_type})
        return NodePorts(
            {"exec_in": PortType.EXEC, "value": variable_type},
            {"exec_out": PortType.EXEC, "value": variable_type},
        )
    if node_type in {"function_entry", "function_return", "call_function"}:
        function_inputs = _function_ports(config, "inputs")
        function_outputs = _function_ports(config, "outputs")
        if node_type == "function_entry":
            return NodePorts({}, {"exec_out": PortType.EXEC, **function_inputs})
        if node_type == "function_return":
            return NodePorts({"exec_in": PortType.EXEC, **function_outputs}, {})
        return NodePorts(
            {"exec_in": PortType.EXEC, **function_inputs},
            {"exec_out": PortType.EXEC, **function_outputs},
        )
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


def _function_ports(config: JsonObject, key: str) -> dict[str, PortType]:
    raw = config.get(key, [])
    if not isinstance(raw, list):
        return {}
    result: dict[str, PortType] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        port_id = item.get("id")
        port_type = item.get("type")
        if not isinstance(port_id, str) or not port_id or not isinstance(port_type, str):
            continue
        try:
            parsed = PortType(port_type)
        except ValueError:
            continue
        if parsed is not PortType.EXEC:
            result[port_id] = parsed
    return result


def _variable_port_type(config: JsonObject) -> PortType:
    value = config.get("type")
    try:
        parsed = PortType(value) if isinstance(value, str) else PortType.ANY
    except ValueError:
        return PortType.ANY
    return parsed if parsed not in {PortType.EXEC, PortType.ANY} else PortType.ANY


def _screen_param_port_type(schema: object) -> PortType:
    param_type = schema.get("type") if isinstance(schema, dict) else None
    return {
        "int": PortType.INT,
        "string": PortType.STRING,
        "bool": PortType.BOOL,
        "select": PortType.STRING,
    }.get(param_type, PortType.ANY)
