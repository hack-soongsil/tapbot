"""User-defined macro function boundary and invocation nodes."""

from __future__ import annotations

from tapbot.macro.graph_models import GraphExecutionContext, JsonObject, NodeResult
from tapbot.macro.node_registry import required_text


def _ports(config: JsonObject, key: str) -> tuple[dict[str, str], ...]:
    raw = config.get(key, [])
    if not isinstance(raw, list):
        return ()
    return tuple(
        {"id": item["id"], "type": item["type"]}
        for item in raw
        if isinstance(item, dict)
        and isinstance(item.get("id"), str)
        and isinstance(item.get("type"), str)
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
                raise RuntimeError(f"function input {port_id!r} was not provided")
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
            if port_id not in context.input_values:
                raise RuntimeError(f"function output {port_id!r} was not provided")
            outputs[port_id] = context.input_values[port_id]
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
                raise RuntimeError(f"call input {port_id!r} is not connected")
            arguments[port_id] = context.input_values[port_id]
        outputs = context.function_invoker(function_id, arguments)
        return NodeResult.success(
            {"function_id": function_id},
            next_handle="exec_out",
            data_outputs=outputs,
        )
