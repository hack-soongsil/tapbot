import pytest

from tapbot.android.client import AndroidAgentTransportError
from tapbot.android.input import AndroidInputResult
from tapbot.macro import (
    MacroExecutionContext,
    MacroExecutionStatus,
    MacroExecutor,
    TapPointSampler,
    TapTargetAction,
    default_screen_geometry,
)
from tapbot.ui_resolution.visual import ResolvedTarget
from tapbot.vision.calibration import Point2D
from tapbot.vision.detector import BoundingBox
from tests.macro.helpers import frame


class RecordingPrimitives:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.taps: list[tuple[float, float, int]] = []
        self.tap_attempts = 0

    def tap(
        self, x: float, y: float, *, duration_ms: int = 70
    ) -> AndroidInputResult:
        self.tap_attempts += 1
        if self.error is not None:
            raise self.error
        self.taps.append((x, y, duration_ms))
        return AndroidInputResult("tap", "completed")

    def swipe(self, *args: object, **kwargs: object) -> AndroidInputResult:
        raise AssertionError("swipe should not be called")

    def back(self) -> AndroidInputResult:
        raise AssertionError("back should not be called")

    def home(self) -> AndroidInputResult:
        raise AssertionError("home should not be called")


def context() -> MacroExecutionContext:
    return MacroExecutionContext(
        frame(),
        {"agent": {"device": {"width": 400, "height": 200, "rotation": 0}}},
        ResolvedTarget("button", Point2D(50, 25), "test"),
    )


def bounded_context() -> MacroExecutionContext:
    return MacroExecutionContext(
        frame(),
        {"agent": {"device": {"width": 400, "height": 200, "rotation": 0}}},
        ResolvedTarget(
            "button",
            Point2D(50, 25),
            "test",
            bbox=BoundingBox(20, 10, 60, 30),
        ),
    )


def test_executor_maps_resolved_screen_target_to_primitive() -> None:
    primitives = RecordingPrimitives()
    executor = MacroExecutor(
        primitives,
        geometry_factory=default_screen_geometry,
    )

    result = executor.execute(TapTargetAction("button", 90), context())

    assert result.status is MacroExecutionStatus.EXECUTED
    assert len(primitives.taps) == 1
    assert primitives.taps[0][0] == pytest.approx(100.25, abs=0.01)
    assert primitives.taps[0][1] == pytest.approx(50.25, abs=0.01)
    assert primitives.taps[0][2] == 90
    assert result.target is not None
    device = result.target["device"]
    assert isinstance(device, dict)
    assert device["x"] == pytest.approx(100.25, abs=0.01)
    assert device["y"] == pytest.approx(50.25, abs=0.01)


def test_executor_samples_once_and_executes_the_traced_point() -> None:
    primitives = RecordingPrimitives()
    sampler = TapPointSampler(seed=42)
    calls = 0
    original_sample = sampler.sample_with_trace

    def count_sample(*args: object, **kwargs: object):
        nonlocal calls
        calls += 1
        return original_sample(*args, **kwargs)

    sampler.sample_with_trace = count_sample  # type: ignore[method-assign]
    executor = MacroExecutor(
        primitives,
        geometry_factory=default_screen_geometry,
        tap_point_sampler=sampler,
    )

    result = executor.execute(TapTargetAction("button", 90), bounded_context())

    assert result.status is MacroExecutionStatus.EXECUTED
    assert calls == 1
    assert primitives.tap_attempts == 1
    assert result.target is not None
    screen = result.target["screen"]
    device = result.target["device"]
    safe_bounds = result.target["safe_bounds"]
    tap_point = result.target["tap_point"]
    assert isinstance(screen, dict)
    assert isinstance(device, dict)
    assert isinstance(safe_bounds, list)
    assert isinstance(tap_point, list)
    assert tap_point == [screen["x"], screen["y"]]
    assert safe_bounds[0] <= screen["x"] <= safe_bounds[2]
    assert safe_bounds[1] <= screen["y"] <= safe_bounds[3]
    assert (screen["x"], screen["y"]) != (50, 25)
    assert primitives.taps[0][0] == pytest.approx(device["x"])
    assert primitives.taps[0][1] == pytest.approx(device["y"])
    assert result.target["sampling"] == "small-element-jitter"
    assert result.target["randomization_enabled"] is True


def test_network_timeout_preserves_outcome_unknown() -> None:
    primitives = RecordingPrimitives(
        AndroidAgentTransportError("timed out", outcome_unknown=True)
    )
    executor = MacroExecutor(
        primitives,
        geometry_factory=default_screen_geometry,
        tap_point_sampler=TapPointSampler(seed=42),
    )

    result = executor.execute(TapTargetAction("button"), bounded_context())

    assert result.status is MacroExecutionStatus.EXECUTION_FAILED
    assert result.outcome_unknown is True
    assert result.api_result is not None
    assert result.api_result["outcome_unknown"] is True
    assert result.error == "timed out"
    assert primitives.tap_attempts == 1
