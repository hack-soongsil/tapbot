"""User-defined macro function boundary and invocation nodes."""

from __future__ import annotations

from tapbot.macro.graph_models import GraphExecutionContext, JsonObject, JsonValue, NodeResult
from tapbot.macro.errors import MacroExecutionError
from tapbot.macro.node_registry import required_text
from tapbot.macro.nodes.variable import default_matches_type, value_matches_type


def _ports(config: JsonObject, key: str) -> tuple[JsonObject, ...]:
    raw = config.get(key, [])
    if not isinstance(raw, list):
        return ()
    ports: list[JsonObject] = []
    for item in raw:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("id"), str)
            or not isinstance(item.get("type"), str)
        ):
            continue
        required = item.get("required")
        optional = item.get("optional")
        ports.append({
            "id": item["id"],
            "type": item["type"],
            **({
                "required": required
                if isinstance(required, bool)
                else not optional
            } if isinstance(required, bool) or isinstance(optional, bool) else {}),
            **({"default": item["default"]} if "default" in item else {}),
        })
    return tuple(ports)


def _type_default(port_type: str) -> JsonValue:
    if port_type == "bool":
        return False
    if port_type == "int":
        return 0
    if port_type == "float":
        return 0.0
    if port_type == "string":
        return ""
    return None


def _matches_return_type(value: object, port_type: str) -> bool:
    if port_type == "any":
        return True
    if value is None:
        return port_type in {"position", "rect", "element"}
    return value_matches_type(value, port_type) or (
        port_type == "float" and default_matches_type(value, port_type)
    )


class FunctionEntryNode:
    output_handles = frozenset({"exec_out"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return ()

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        outputs: dict[str, object] = {}
        for port in _ports(config, "inputs"):
            port_id = port["id"]
            if port_id not in context.function_inputs:
                raise MacroExecutionError(
                    f"function input {port_id!r} was not provided", code="FUNCTION_INPUT_MISSING",
                    port=port_id, expected=port["type"], actual="missing",
                    hint="호출 노드의 입력 핀에 값을 연결하세요.",
                )
            outputs[port_id] = context.function_inputs[port_id]
        return NodeResult.success(next_handle="exec_out", data_outputs=outputs)


class FunctionReturnNode:
    output_handles = frozenset()

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return ()

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        outputs: dict[str, object] = {}
        for port in _ports(config, "outputs"):
            port_id = port["id"]
            assert isinstance(port_id, str)
            port_type = port["type"]
            assert isinstance(port_type, str)
            if port_id in context.input_values:
                value = context.input_values[port_id]
            elif port.get("required") is True:
                raise MacroExecutionError(
                    f"function output {port_id!r} was not provided", code="FUNCTION_OUTPUT_REQUIRED",
                    port=port_id, expected=port_type, actual="missing",
                    hint="필수 반환 핀에 값을 연결하거나 Required 설정을 해제하세요.",
                )
            else:
                value = port.get("default", _type_default(port_type))
            if not _matches_return_type(value, port_type):
                raise MacroExecutionError(
                    f"function output {port_id!r} expected {port_type}, "
                    f"got {type(value).__name__}", code="PORT_TYPE_MISMATCH",
                    port=port_id, expected=port_type, value=value,
                    hint="반환 핀 타입과 연결된 값의 타입을 일치시키세요.",
                )
            outputs[port_id] = (
                float(value)
                if port_type == "float" and isinstance(value, int) and not isinstance(value, bool)
                else value
            )
        return NodeResult.success(data_outputs=outputs)


class CallFunctionNode:
    output_handles = frozenset({"exec_out"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return required_text(config, "function_id")

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        function_id = config["function_id"]
        assert isinstance(function_id, str)
        if context.function_invoker is None:
            raise RuntimeError("function invocation is unavailable")
        arguments: dict[str, object] = {}
        for port in _ports(config, "inputs"):
            port_id = port["id"]
            if port_id not in context.input_values:
                raise MacroExecutionError(
                    f"call input {port_id!r} is not connected", code="FUNCTION_INPUT_MISSING",
                    port=port_id, expected=port["type"], actual="missing",
                    hint="함수 호출 입력 핀에 값을 연결하세요.",
                )
            arguments[port_id] = context.input_values[port_id]
        outputs = context.function_invoker(function_id, arguments)
        return NodeResult.success(
            {"function_id": function_id},
            next_handle="exec_out",
            data_outputs=outputs,
        )
