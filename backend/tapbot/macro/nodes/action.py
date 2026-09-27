"""Primitive action nodes for macro graphs."""

from __future__ import annotations

import json
import math
import time

from tapbot.macro.graph_models import (
    GraphExecutionContext,
    JsonObject,
    NodeResult,
    assert_json_value,
)
from tapbot.macro.node_registry import (
    collect_errors,
    optional_positive_int,
    required_number,
    selector_errors,
)
from tapbot.macro.tap_point import TapPointSampler


class TapElementNode:
    output_handles = frozenset()

    def __init__(self, sampler: TapPointSampler) -> None:
        self.sampler = sampler

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return collect_errors(
            selector_errors(config),
            optional_positive_int(config, "duration_ms", default=70),
        )

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        ui = _require_ui(context)
        actions = _require_actions(context)
        selector = _selector(config)
        element = ui.find_element(selector)
        if element is None:
            return NodeResult.failure("element was not found")
        context.last_resolved_element = element
        sample = self.sampler.sample_with_trace(element.bounds)
        duration_ms = _integer(config, "duration_ms", 70)
        action_result = _action_result(
            actions.tap_screen(
                sample.point.x,
                sample.point.y,
                duration_ms=duration_ms,
            )
        )
        context.last_action_result = action_result
        return NodeResult.success(
            {
                "element_id": element.id,
                **sample.to_trace(),
                "action_result": action_result,
            }
        )


class TapPointNode:
    output_handles = frozenset()

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return collect_errors(
            _finite_number_errors(config, "x"),
            _finite_number_errors(config, "y"),
            optional_positive_int(config, "duration_ms", default=70),
        )

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        actions = _require_actions(context)
        x = _number(config, "x")
        y = _number(config, "y")
        action_result = _action_result(
            actions.tap_screen(
                x,
                y,
                duration_ms=_integer(config, "duration_ms", 70),
            )
        )
        context.last_action_result = action_result
        return NodeResult.success(
            {"tap_point": [x, y], "action_result": action_result}
        )


class SwipeNode:
    output_handles = frozenset()

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return collect_errors(
            *(_finite_number_errors(config, key) for key in ("x1", "y1", "x2", "y2")),
            optional_positive_int(config, "duration_ms", default=450),
        )

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        actions = _require_actions(context)
        action_result = _action_result(
            actions.swipe(
                _number(config, "x1"),
                _number(config, "y1"),
                _number(config, "x2"),
                _number(config, "y2"),
                duration_ms=_integer(config, "duration_ms", 450),
            )
        )
        context.last_action_result = action_result
        return NodeResult.success({"action_result": action_result})


class BackNode:
    output_handles = frozenset()

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return ()

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        del config
        result = _action_result(_require_actions(context).back())
        context.last_action_result = result
        return NodeResult.success({"action_result": result})


class HomeNode:
    output_handles = frozenset()

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return ()

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        del config
        result = _action_result(_require_actions(context).home())
        context.last_action_result = result
        return NodeResult.success({"action_result": result})


class WaitNode:
    output_handles = frozenset()

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return optional_positive_int(
            config,
            "duration_ms",
            default=0,
            allow_zero=True,
        )

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        remaining = _integer(config, "duration_ms", 0) / 1_000
        sleeper = context.sleep or time.sleep
        while remaining > 0:
            context.check_active()
            interval = min(remaining, 0.1)
            sleeper(interval)
            remaining -= interval
        context.check_active()
        return NodeResult.success()


def _require_actions(context: GraphExecutionContext):
    if context.actions is None:
        raise RuntimeError("this node requires an action execution port")
    return context.actions


def _require_ui(context: GraphExecutionContext):
    if context.ui is None:
        raise RuntimeError("this node requires a UI-resolution port")
    return context.ui


def _selector(config: JsonObject) -> JsonObject:
    selector = config["selector"]
    assert isinstance(selector, dict)
    return selector


def _number(config: JsonObject, key: str) -> float:
    value = config[key]
    assert isinstance(value, int | float) and not isinstance(value, bool)
    return float(value)


def _integer(config: JsonObject, key: str, default: int) -> int:
    value = config.get(key, default)
    assert isinstance(value, int) and not isinstance(value, bool)
    return value


def _finite_number_errors(config: JsonObject, key: str) -> tuple[str, ...]:
    errors = required_number(config, key)
    if errors:
        return errors
    value = config[key]
    assert isinstance(value, int | float) and not isinstance(value, bool)
    if not math.isfinite(value):
        return (f"{key} must be finite",)
    return ()


def _action_result(value: object) -> JsonObject:
    if value is None:
        return {}
    if not isinstance(value, dict):
        value = dict(value)  # type: ignore[arg-type]
    assert_json_value(value, name="action result")
    return json.loads(json.dumps(value, allow_nan=False))
