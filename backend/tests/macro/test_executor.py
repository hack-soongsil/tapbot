import pytest

from tapbot.android.client import AndroidAgentTransportError
from tapbot.android.input import AndroidInputResult
from tapbot.macro import (
    MacroExecutionContext,
    MacroExecutionStatus,
    MacroExecutor,
    TapTargetAction,
    default_screen_geometry,
)
from tapbot.ui_resolution.visual import ResolvedTarget
from tapbot.vision.calibration import Point2D
from tests.macro.helpers import frame


class RecordingPrimitives:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.taps: list[tuple[float, float, int]] = []

    def tap(
        self, x: float, y: float, *, duration_ms: int = 70
    ) -> AndroidInputResult:
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


def test_network_timeout_preserves_outcome_unknown() -> None:
    primitives = RecordingPrimitives(
        AndroidAgentTransportError("timed out", outcome_unknown=True)
    )
    executor = MacroExecutor(
        primitives,
        geometry_factory=default_screen_geometry,
    )

    result = executor.execute(TapTargetAction("button"), context())

    assert result.status is MacroExecutionStatus.EXECUTION_FAILED
    assert result.outcome_unknown is True
    assert result.api_result is not None
    assert result.api_result["outcome_unknown"] is True
    assert result.error == "timed out"
