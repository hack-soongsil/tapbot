"""Primitive action nodes for macro graphs."""

from __future__ import annotations

import json
import math
import time

from tapbot.macro.graph_models import (
    GraphElement,
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
from tapbot.macro.area_sampling import (
    AreaPointSampler,
    SamplingArea,
    validate_sampling,
)


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


class ClickPointNode:
    output_handles = frozenset({"exec_out"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return collect_errors(
            _coordinate_errors(config, "x", "coordinate_space"),
            _coordinate_errors(config, "y", "coordinate_space"),
            _coordinate_space_errors(config),
            optional_positive_int(config, "duration_ms", default=70),
        )

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        x, y = _resolve_point(
            context,
            _number(config, "x"),
            _number(config, "y"),
            _text(config, "coordinate_space", "pixel"),
        )
        result = _action_result(_require_actions(context).tap_screen(
            x, y, duration_ms=_integer(config, "duration_ms", 70)
        ))
        context.last_action_result = result
        return NodeResult.success(
            {"tap_point": [x, y], "action_result": result},
            next_handle="exec_out",
        )


class DragPointNode:
    output_handles = frozenset({"exec_out"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return collect_errors(
            _point_object_errors(config.get("start"), "start", config),
            _point_object_errors(config.get("end"), "end", config),
            _coordinate_space_errors(config),
            optional_positive_int(config, "duration_ms", default=450),
        )

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        start = _point(config, "start")
        end = _point(config, "end")
        space = _text(config, "coordinate_space", "pixel")
        x1, y1 = _resolve_point(context, *start, space)
        x2, y2 = _resolve_point(context, *end, space)
        result = _action_result(_require_actions(context).swipe(
            x1, y1, x2, y2, duration_ms=_integer(config, "duration_ms", 450)
        ))
        context.last_action_result = result
        return NodeResult.success(
            {"start": [x1, y1], "end": [x2, y2], "action_result": result},
            next_handle="exec_out",
        )


class RandomClickAreaNode:
    output_handles = frozenset({"exec_out"})

    def __init__(self, sampler: AreaPointSampler) -> None:
        self.sampler = sampler

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return collect_errors(
            _area_errors(config.get("area"), "area", config),
            _coordinate_space_errors(config),
            validate_sampling(config.get("sampling", {"type": "uniform"})),
            optional_positive_int(config, "duration_ms", default=70),
        )

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        point = self.sampler.sample(_area(config, "area"), _object(config, "sampling", {"type": "uniform"}))
        x, y = _resolve_point(
            context, point.x, point.y, _text(config, "coordinate_space", "pixel")
        )
        result = _action_result(_require_actions(context).tap_screen(
            x, y, duration_ms=_integer(config, "duration_ms", 70)
        ))
        context.last_action_result = result
        return NodeResult.success(
            {"tap_point": [x, y], "sampling": config.get("sampling", {"type": "uniform"}), "action_result": result},
            next_handle="exec_out",
            data_outputs={"sampled_position": {"x": x, "y": y}},
        )


class RandomDragAreaNode:
    output_handles = frozenset({"exec_out"})

    def __init__(self, sampler: AreaPointSampler) -> None:
        self.sampler = sampler

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return collect_errors(
            _area_errors(config.get("start_area"), "start_area", config),
            _area_errors(config.get("end_area"), "end_area", config),
            _coordinate_space_errors(config),
            validate_sampling(config.get("start_sampling", {"type": "uniform"}), name="start_sampling"),
            validate_sampling(config.get("end_sampling", {"type": "uniform"}), name="end_sampling"),
            optional_positive_int(config, "duration_ms", default=450),
        )

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        start = self.sampler.sample(_area(config, "start_area"), _object(config, "start_sampling", {"type": "uniform"}))
        end = self.sampler.sample(_area(config, "end_area"), _object(config, "end_sampling", {"type": "uniform"}))
        space = _text(config, "coordinate_space", "pixel")
        x1, y1 = _resolve_point(context, start.x, start.y, space)
        x2, y2 = _resolve_point(context, end.x, end.y, space)
        result = _action_result(_require_actions(context).swipe(
            x1, y1, x2, y2, duration_ms=_integer(config, "duration_ms", 450)
        ))
        context.last_action_result = result
        return NodeResult.success(
            {"start": [x1, y1], "end": [x2, y2], "action_result": result},
            next_handle="exec_out",
            data_outputs={
                "sampled_start": {"x": x1, "y": y1},
                "sampled_end": {"x": x2, "y": y2},
            },
        )


class ClickElementNode:
    output_handles = frozenset({"exec_out"})

    def __init__(self, sampler: AreaPointSampler) -> None:
        self.sampler = sampler

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        errors = list(selector_errors(config)) if config.get("selector") else []
        selector = config.get("selector")
        if isinstance(selector, dict) and not any(
            isinstance(selector.get(key), str) and bool(selector[key].strip())
            for key in (
                "text", "text_contains", "text_regex", "content_description",
                "content_description_regex", "view_id", "class_name",
                "semantic_id", "semantic_family",
            )
        ):
            errors.append("click element selector requires text or another stable field")
        resolve = config.get("resolve", {})
        if not isinstance(resolve, dict) or resolve.get("strategy", "best_match") not in {"first", "best_match", "unique"}:
            errors.append("resolve.strategy must be first, best_match, or unique")
        click = config.get("click", {})
        if not isinstance(click, dict):
            errors.append("click must be an object")
        else:
            errors.extend(optional_positive_int(click, "duration_ms", default=70))
            sampling_mode = config.get("sampling_mode", click.get("mode", "center"))
            if sampling_mode not in {"center", "uniform", "normal"}:
                errors.append("sampling_mode must be center, uniform, or normal")
        return tuple(errors)

    def execute(self, context: GraphExecutionContext, config: JsonObject) -> NodeResult:
        supplied = context.input_values.get("element")
        if supplied is not None:
            if not isinstance(supplied, GraphElement):
                raise RuntimeError("click element data input must be an element")
            element = supplied
        else:
            ui = _require_ui(context)
            if not config.get("selector"):
                raise RuntimeError("click element requires element input or selector fallback")
            resolve = _object(config, "resolve", {})
            finder = ui.find_element
            selector = dict(_selector(config))
            selector.setdefault("clickable", True)
            selector.setdefault("enabled", True)
            selector.setdefault("visible_to_user", True)
            try:
                element = finder(
                    selector,
                    strategy=_text(resolve, "strategy", "best_match"),
                    require_enabled=resolve.get("require_enabled", True) is True,
                    require_visible=resolve.get("require_visible", True) is True,
                )
            except TypeError:
                # Compatibility with older/test GraphUiPort implementations.
                element = finder(selector)
        if element is None:
            raise RuntimeError("click element target was not found or was ambiguous")
        context.last_resolved_element = element
        click = _object(config, "click", {})
        mode_value = config.get("sampling_mode", click.get("mode", "center"))
        mode = mode_value if isinstance(mode_value, str) else "center"
        point = (
            element.bounds.center
            if mode == "center"
            else self.sampler.sample(
                SamplingArea(
                    element.bounds.left,
                    element.bounds.top,
                    element.bounds.right,
                    element.bounds.bottom,
                ),
                {"type": mode},
            )
        )
        result = _action_result(_require_actions(context).tap_screen(
            point.x, point.y, duration_ms=_integer(click, "duration_ms", 70)
        ))
        context.last_action_result = result
        return NodeResult.success(
            {
                "element_id": element.id,
                "bounds": element.bounds.to_list(),
                "tap_point": [point.x, point.y],
                "sampling": mode,
                "action_result": result,
            },
            next_handle="exec_out",
        )


class BackNode:
    output_handles = frozenset({"exec_out"})

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
        return NodeResult.success(
            {"action_result": result},
            next_handle="exec_out",
        )


class HomeNode:
    output_handles = frozenset({"exec_out"})

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
        return NodeResult.success(
            {"action_result": result},
            next_handle="exec_out",
        )


class WaitNode:
    output_handles = frozenset({"exec_out"})

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
        return NodeResult.success(next_handle="exec_out")


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


def _text(config: JsonObject, key: str, default: str) -> str:
    value = config.get(key, default)
    assert isinstance(value, str)
    return value


def _object(
    config: JsonObject,
    key: str,
    default: dict[str, object],
) -> dict[str, object]:
    value = config.get(key, default)
    assert isinstance(value, dict)
    return value


def _point(config: JsonObject, key: str) -> tuple[float, float]:
    value = config[key]
    assert isinstance(value, dict)
    x = value["x"]
    y = value["y"]
    assert isinstance(x, int | float) and not isinstance(x, bool)
    assert isinstance(y, int | float) and not isinstance(y, bool)
    return float(x), float(y)


def _area(config: JsonObject, key: str) -> SamplingArea:
    value = config[key]
    assert isinstance(value, dict)
    coordinates = []
    for name in ("left", "top", "right", "bottom"):
        item = value[name]
        assert isinstance(item, int | float) and not isinstance(item, bool)
        coordinates.append(float(item))
    return SamplingArea(*coordinates)


def _coordinate_space_errors(config: JsonObject) -> tuple[str, ...]:
    return () if config.get("coordinate_space", "pixel") in {"pixel", "normalized"} else (
        "coordinate_space must be pixel or normalized",
    )


def _coordinate_errors(
    config: JsonObject,
    key: str,
    space_key: str,
) -> tuple[str, ...]:
    errors = _finite_number_errors(config, key)
    if errors:
        return errors
    value = config[key]
    assert isinstance(value, int | float) and not isinstance(value, bool)
    if config.get(space_key, "pixel") == "normalized" and not 0 <= value <= 1:
        return (f"{key} must be between 0 and 1 for normalized coordinates",)
    if config.get(space_key, "pixel") == "pixel" and value < 0:
        return (f"{key} must not be negative",)
    return ()


def _point_object_errors(
    value: object,
    name: str,
    parent: JsonObject,
) -> tuple[str, ...]:
    if not isinstance(value, dict):
        return (f"{name} must be an object",)
    proxy: JsonObject = {
        "x": value.get("x"),
        "y": value.get("y"),
        "coordinate_space": parent.get("coordinate_space", "pixel"),
    }
    return collect_errors(
        _coordinate_errors(proxy, "x", "coordinate_space"),
        _coordinate_errors(proxy, "y", "coordinate_space"),
    )


def _area_errors(
    value: object,
    name: str,
    parent: JsonObject,
) -> tuple[str, ...]:
    if not isinstance(value, dict):
        return (f"{name} must be an object",)
    errors: list[str] = []
    numbers: dict[str, float] = {}
    for key in ("left", "top", "right", "bottom"):
        item = value.get(key)
        if isinstance(item, bool) or not isinstance(item, int | float) or not math.isfinite(item):
            errors.append(f"{name}.{key} must be a finite number")
        else:
            numbers[key] = float(item)
    if len(numbers) == 4:
        if numbers["left"] >= numbers["right"]:
            errors.append(f"{name}.left must be less than right")
        if numbers["top"] >= numbers["bottom"]:
            errors.append(f"{name}.top must be less than bottom")
        if parent.get("coordinate_space", "pixel") == "normalized" and any(
            not 0 <= item <= 1 for item in numbers.values()
        ):
            errors.append(f"{name} values must be between 0 and 1 for normalized coordinates")
        if parent.get("coordinate_space", "pixel") == "pixel" and any(
            item < 0 for item in numbers.values()
        ):
            errors.append(f"{name} values must not be negative")
    return tuple(errors)


def _resolve_point(
    context: GraphExecutionContext,
    x: float,
    y: float,
    coordinate_space: str,
) -> tuple[float, float]:
    dimensions = _screen_size(context)
    if coordinate_space == "normalized":
        if not 0 <= x <= 1 or not 0 <= y <= 1:
            raise ValueError("normalized coordinates must be between 0 and 1")
        if dimensions is None:
            raise RuntimeError("normalized coordinates require current screen dimensions")
        return x * dimensions[0], y * dimensions[1]
    if coordinate_space != "pixel":
        raise ValueError("coordinate_space must be pixel or normalized")
    if x < 0 or y < 0:
        raise ValueError("pixel coordinates must not be negative")
    if dimensions is not None and (x > dimensions[0] or y > dimensions[1]):
        raise ValueError("pixel coordinates are outside the current screen")
    return x, y


def _screen_size(context: GraphExecutionContext) -> tuple[float, float] | None:
    ui = context.ui
    if ui is not None:
        provider = getattr(ui, "screen_size", None)
        if callable(provider):
            size = provider()
            if size is not None:
                return float(size[0]), float(size[1])
    observation = context.last_observation
    if isinstance(observation, dict):
        width = observation.get("screen_width")
        height = observation.get("screen_height")
        if isinstance(width, int | float) and isinstance(height, int | float):
            return float(width), float(height)
    return None


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
