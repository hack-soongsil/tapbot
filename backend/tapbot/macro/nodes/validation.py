"""Bounded validation and wait nodes."""

from __future__ import annotations

import time

from tapbot.macro.graph_models import (
    GraphExecutionContext,
    JsonObject,
    NodeResult,
    NodeStatus,
)
from tapbot.macro.node_registry import (
    collect_errors,
    optional_positive_int,
    required_text,
    selector_errors,
)


class WaitForElementNode:
    output_handles = frozenset({"found", "timeout"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return collect_errors(selector_errors(config), _wait_errors(config))

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        ui = _require_ui(context)
        selector = config["selector"]
        assert isinstance(selector, dict)
        deadline = _clock(context)() + _integer(config, "timeout_ms", 5_000) / 1_000
        while True:
            context.check_active()
            element = ui.find_element(selector)
            if element is not None:
                context.last_resolved_element = element
                return NodeResult.success(
                    {
                        "found": True,
                        "element_id": element.id,
                        "bounds": element.bounds.to_list(),
                    },
                    next_handle="found",
                )
            if _clock(context)() >= deadline:
                context.last_resolved_element = None
                return NodeResult(
                    NodeStatus.FAILURE,
                    {"found": False},
                    next_handle="timeout",
                    error="timed out waiting for element",
                )
            _sleep(context, config)


class WaitForStateNode:
    output_handles = frozenset({"matched", "timeout"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return collect_errors(required_text(config, "state"), _wait_errors(config))

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        ui = _require_ui(context)
        expected = config["state"]
        assert isinstance(expected, str)
        deadline = _clock(context)() + _integer(config, "timeout_ms", 5_000) / 1_000
        while True:
            context.check_active()
            actual = ui.current_state()
            if actual == expected:
                return NodeResult.success(
                    {"matched": True, "actual": actual},
                    next_handle="matched",
                )
            if _clock(context)() >= deadline:
                return NodeResult(
                    NodeStatus.FAILURE,
                    {"matched": False, "actual": actual},
                    next_handle="timeout",
                    error="timed out waiting for state",
                )
            _sleep(context, config)


class AssertElementNode:
    output_handles = frozenset({"found", "missing"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return selector_errors(config)

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        selector = config["selector"]
        assert isinstance(selector, dict)
        element = _require_ui(context).find_element(selector)
        context.last_resolved_element = element
        if element is None:
            return NodeResult(
                NodeStatus.FAILURE,
                {"found": False},
                next_handle="missing",
                error="element assertion failed",
            )
        return NodeResult.success(
            {"found": True, "element_id": element.id},
            next_handle="found",
        )


def _wait_errors(config: JsonObject) -> tuple[str, ...]:
    return collect_errors(
        optional_positive_int(config, "timeout_ms", default=5_000),
        optional_positive_int(config, "poll_interval_ms", default=100),
    )


def _clock(context: GraphExecutionContext):
    return context.monotonic or time.monotonic


def _sleep(context: GraphExecutionContext, config: JsonObject) -> None:
    interval = _integer(config, "poll_interval_ms", 100) / 1_000
    (context.sleep or time.sleep)(interval)


def _require_ui(context: GraphExecutionContext):
    if context.ui is None:
        raise RuntimeError("this node requires a UI-resolution port")
    return context.ui


def _integer(config: JsonObject, key: str, default: int) -> int:
    value = config.get(key, default)
    assert isinstance(value, int) and not isinstance(value, bool)
    return value
