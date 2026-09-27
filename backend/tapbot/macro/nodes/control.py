"""Branching, bounded-loop, timeout, and stop nodes."""

from __future__ import annotations

import time

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
        return required_text(config, "variable")

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        name = config["variable"]
        assert isinstance(name, str)
        actual = context.variables.get(name)
        expected = config.get("equals", True)
        matches = actual == expected
        return NodeResult.success(
            {"value": matches},
            next_handle="true" if matches else "false",
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
