"""Branching, bounded-loop, timeout, and stop nodes."""

from __future__ import annotations

import time

from tapbot.macro.errors import MacroExecutionError

from tapbot.macro.graph_models import (
    GraphExecutionContext,
    JsonObject,
    NodeResult,
    NodeStatus,
)
from tapbot.macro.node_registry import optional_positive_int, required_text


class BranchNode:
    output_handles = frozenset({"true", "false"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        condition = config.get("condition")
        if condition is None:
            return () if not config.get("variable") else required_text(config, "variable")
        if not isinstance(condition, dict):
            return ("condition must be an object",)
        condition_type = condition.get("type", "variable_equals")
        if condition_type not in {
            "variable_equals", "variable_not_equals", "variable_truthy"
        }:
            return ("condition.type is not supported",)
        return () if not condition.get("variable") else required_text(condition, "variable")

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        if "condition" in context.input_values:
            actual = context.input_values["condition"]
            if not isinstance(actual, bool):
                raise MacroExecutionError(
                    "branch condition data input must be bool",
                    code="PORT_TYPE_MISMATCH",
                    port="condition",
                    expected="bool",
                    value=actual,
                    hint="condition 입력에는 bool 데이터 핀을 연결하세요.",
                )
            matches = actual
        else:
            condition = config.get("condition")
            source = condition if isinstance(condition, dict) else config
            name = source.get("variable")
            if not isinstance(name, str) or not name:
                raise RuntimeError("branch requires condition input or variable fallback")
            actual = context.variables.get(name)
            condition_type = source.get("type", "variable_equals")
            expected = source.get("value", source.get("equals", True))
            if condition_type == "variable_truthy":
                matches = bool(actual)
            elif condition_type == "variable_not_equals":
                matches = actual != expected
            else:
                matches = actual == expected
        return NodeResult.success(
            {"value": matches},
            next_handle="true" if matches else "false",
        )


class ForLoopNode:
    output_handles = frozenset({"loop", "completed"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        errors: list[str] = []
        for key, default in (("start", 0), ("end", 0), ("step", 1)):
            value = config.get(key, default)
            if isinstance(value, bool) or not isinstance(value, int):
                errors.append(f"{key} must be an integer")
        if config.get("step", 1) == 0:
            errors.append("step must not be zero")
        errors.extend(required_text(config, "index_variable"))
        if not isinstance(config.get("inclusive_end", False), bool):
            errors.append("inclusive_end must be a boolean")
        return tuple(errors)

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        start = _integer(config, "start", 0)
        end = _integer(config, "end", 0)
        step = _integer(config, "step", 1)
        inclusive = config.get("inclusive_end", False)
        assert isinstance(inclusive, bool)
        key = _control_key(context, "for")
        current = context.control_state.get(key, start)
        within = current <= end if step > 0 and inclusive else (
            current < end if step > 0 else current >= end if inclusive else current > end
        )
        if not within:
            context.control_state.pop(key, None)
            return NodeResult.success(
                {"completed": True, "iterations_finished": True},
                next_handle="completed",
            )
        variable = config["index_variable"]
        assert isinstance(variable, str)
        context.variables[variable] = current
        context.control_state[key] = current + step
        return NodeResult.success(
            {"index": current, "variable": variable, "completed": False},
            next_handle="loop",
            data_outputs={"index": current},
        )


class SequenceNode:
    output_handles = frozenset({f"then_{index}" for index in range(16)})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        outputs = config.get("outputs", 2)
        if isinstance(outputs, bool) or not isinstance(outputs, int) or not 2 <= outputs <= 16:
            return ("outputs must be an integer between 2 and 16",)
        return ()

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        outputs = _integer(config, "outputs", 2)
        return NodeResult.success(
            {"outputs": outputs},
            next_handle="then_0",
        )


class RetryNode:
    output_handles = frozenset({"retry", "exhausted"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return optional_positive_int(config, "max_attempts", default=3)

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        key = _control_key(context, "retry")
        attempts = context.control_state.get(key, 0)
        maximum = _integer(config, "max_attempts", 3)
        if attempts >= maximum:
            return NodeResult.success(
                {"attempt": attempts, "exhausted": True},
                next_handle="exhausted",
            )
        attempts += 1
        context.control_state[key] = attempts
        return NodeResult.success(
            {"attempt": attempts, "exhausted": False},
            next_handle="retry",
        )


class RepeatNode:
    output_handles = frozenset({"repeat", "done"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return optional_positive_int(config, "count", default=1, allow_zero=True)

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        key = _control_key(context, "repeat")
        completed = context.control_state.get(key, 0)
        count = _integer(config, "count", 1)
        if completed >= count:
            return NodeResult.success(
                {"iteration": completed, "done": True},
                next_handle="done",
            )
        completed += 1
        context.control_state[key] = completed
        return NodeResult.success(
            {"iteration": completed, "done": False},
            next_handle="repeat",
        )


class TimeoutNode:
    output_handles = frozenset({"within", "expired"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return optional_positive_int(config, "timeout_ms", default=1)

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        clock = context.monotonic or time.monotonic
        elapsed_ms = max(0.0, (clock() - context.started_monotonic) * 1_000)
        expired = elapsed_ms >= _integer(config, "timeout_ms", 1)
        return NodeResult.success(
            {"elapsed_ms": elapsed_ms, "expired": expired},
            next_handle="expired" if expired else "within",
        )


class StopNode:
    output_handles = frozenset()

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return ()

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        del context, config
        return NodeResult(NodeStatus.STOPPED)


def _control_key(context: GraphExecutionContext, kind: str) -> str:
    if context.current_node_id is None:
        raise RuntimeError("control node has no current node id")
    return f"{kind}:{context.current_node_id}"


def _integer(config: JsonObject, key: str, default: int) -> int:
    value = config.get(key, default)
    assert isinstance(value, int) and not isinstance(value, bool)
    return value
