"""Typed macro variable read/write nodes."""

from __future__ import annotations

import math
from collections.abc import Mapping

from tapbot.macro.graph_models import GraphExecutionContext, JsonObject, NodeResult
from tapbot.macro.node_registry import required_text


VARIABLE_TYPES = frozenset({
    "bool", "int", "float", "string", "position", "rect", "element"
})


def value_matches_type(value: object, variable_type: str) -> bool:
    if variable_type == "bool":
        return isinstance(value, bool)
    if variable_type == "int":
        return isinstance(value, int) and not isinstance(value, bool)
    if variable_type == "float":
        return isinstance(value, float) and math.isfinite(value)
    if variable_type == "string":
        return isinstance(value, str)
    if variable_type == "position":
        return _numeric_mapping(value, ("x", "y"))
    if variable_type == "rect":
        return _numeric_mapping(value, ("left", "top", "right", "bottom"))
    if variable_type == "element":
        return value is not None and hasattr(value, "bounds")
    return False


def default_matches_type(value: object, variable_type: str) -> bool:
    if variable_type == "float":
        return (
            isinstance(value, int | float)
            and not isinstance(value, bool)
            and math.isfinite(float(value))
        )
    return value_matches_type(value, variable_type)


class SetVariableNode:
    output_handles = frozenset({"exec_out"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        errors = list(required_text(config, "name"))
        variable_type = config.get("type")
        if variable_type not in VARIABLE_TYPES:
            errors.append("type must be a supported variable type")
        default = config.get("default")
        if default is not None and isinstance(variable_type, str) and not default_matches_type(
            default,
            variable_type,
        ):
            errors.append(f"default must match variable type {variable_type}")
        return tuple(errors)

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        name, variable_type = _identity(config)
        from_input = "value" in context.input_values
        value = context.input_values.get("value", config.get("default"))
        if value is None:
            raise RuntimeError(f"variable {name!r} has no input value or default")
        if variable_type == "float" and not from_input and isinstance(value, int):
            value = float(value)
        if not value_matches_type(value, variable_type):
            raise RuntimeError(
                f"variable {name!r} expected {variable_type}, got {type(value).__name__}"
            )
        context.variables[name] = value  # runtime values may include element references
        return NodeResult.success(
            {"name": name, "type": variable_type},
            next_handle="exec_out",
            data_outputs={"value": value},
        )


class GetVariableNode:
    output_handles = frozenset()

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        errors = list(required_text(config, "name"))
        if config.get("type") not in VARIABLE_TYPES:
            errors.append("type must be a supported variable type")
        return tuple(errors)

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        name, variable_type = _identity(config)
        if name not in context.variables:
            raise RuntimeError(f"variable {name!r} is undefined")
        value = context.variables[name]
        if not value_matches_type(value, variable_type):
            raise RuntimeError(
                f"variable {name!r} expected {variable_type}, got {type(value).__name__}"
            )
        return NodeResult.success(
            {"name": name, "type": variable_type},
            data_outputs={"value": value},
        )


def _identity(config: JsonObject) -> tuple[str, str]:
    name = config.get("name")
    variable_type = config.get("type")
    if not isinstance(name, str) or not name:
        raise RuntimeError("variable name is required")
    if not isinstance(variable_type, str) or variable_type not in VARIABLE_TYPES:
        raise RuntimeError("variable type is invalid")
    return name, variable_type


def _numeric_mapping(value: object, keys: tuple[str, ...]) -> bool:
    if not isinstance(value, Mapping):
        return False
    return all(
        isinstance(value.get(key), int | float)
        and not isinstance(value.get(key), bool)
        and math.isfinite(float(value[key]))
        for key in keys
    )
