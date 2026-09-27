"""Translate resolved macro actions into injected primitive execution calls."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import time
from typing import Any, Protocol

from tapbot.android.input import AndroidInputResult
from tapbot.macro.actions import (
    BackAction,
    HomeAction,
    MacroAction,
    RequestHumanAction,
    ScreenshotAction,
    SwipeAction,
    TapTargetAction,
    WaitAction,
)
from tapbot.macro.models import MacroExecutionResult, MacroExecutionStatus
from tapbot.ui_resolution.visual import ResolvedTarget
from tapbot.android.geometry import ScreenGeometry, ScreenInsets
from tapbot.android.screen import ScreenFrame


GeometryFactory = Callable[[ScreenFrame, dict[str, object]], ScreenGeometry]


class PrimitiveExecutor(Protocol):
    """High-level device contract; implementations may use Android or a robot."""

    def tap(
        self, x: float, y: float, *, duration_ms: int = 70
    ) -> AndroidInputResult: ...

    def swipe(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        *,
        duration_ms: int = 450,
    ) -> AndroidInputResult: ...

    def back(self) -> AndroidInputResult: ...

    def home(self) -> AndroidInputResult: ...


@dataclass(frozen=True, slots=True)
class MacroExecutionContext:
    frame: ScreenFrame
    source_metadata: dict[str, object]
    resolved_target: ResolvedTarget | None = None


class MacroExecutor:
    """Execute only constrained macro actions against an injected primitive API."""

    def __init__(
        self,
        primitives: PrimitiveExecutor,
        *,
        geometry_factory: GeometryFactory,
        sleep: Callable[[float], None] = time.sleep,
        after_execution: Callable[[], None] | None = None,
    ) -> None:
        self.primitives = primitives
        self.geometry_factory = geometry_factory
        self.sleep = sleep
        self.after_execution = after_execution

    def execute(
        self,
        action: MacroAction,
        context: MacroExecutionContext,
        *,
        enabled: bool = True,
    ) -> MacroExecutionResult:
        if isinstance(action, RequestHumanAction):
            return MacroExecutionResult(
                MacroExecutionStatus.HUMAN_REQUIRED,
                error=action.reason,
            )

        target = self._target_payload(context)
        if isinstance(action, TapTargetAction) and context.resolved_target is None:
            return MacroExecutionResult(
                MacroExecutionStatus.TARGET_NOT_FOUND,
                error=f"Target {action.target!r} was not resolved",
            )

        if not enabled:
            return MacroExecutionResult(
                MacroExecutionStatus.PLANNED,
                target=target,
            )

        try:
            controller_result = self._execute(action, context)
        except Exception as error:
            api_result = _error_result(error)
            return MacroExecutionResult(
                MacroExecutionStatus.EXECUTION_FAILED,
                api_result=api_result,
                target=target,
                error=str(error),
                outcome_unknown=bool(api_result.get("outcome_unknown", False)),
            )

        if controller_result is not None and self.after_execution is not None:
            self.after_execution()
        return MacroExecutionResult(
            MacroExecutionStatus.EXECUTED,
            controller_result=controller_result,
            api_result=(
                None if controller_result is None else controller_result.to_dict()
            ),
            target=target,
        )

    def _execute(
        self,
        action: MacroAction,
        context: MacroExecutionContext,
    ) -> AndroidInputResult | None:
        geometry = self.geometry_factory(context.frame, context.source_metadata)
        match action:
            case TapTargetAction(duration_ms=duration_ms):
                assert context.resolved_target is not None
                x, y = geometry.screen_to_device(
                    context.resolved_target.center.x,
                    context.resolved_target.center.y,
                )
                return self.primitives.tap(x, y, duration_ms=duration_ms)
            case SwipeAction(
                x1=x1,
                y1=y1,
                x2=x2,
                y2=y2,
                duration_ms=duration_ms,
            ):
                start = geometry.screen_to_device(x1, y1)
                end = geometry.screen_to_device(x2, y2)
                return self.primitives.swipe(
                    *start,
                    *end,
                    duration_ms=duration_ms,
                )
            case BackAction():
                return self.primitives.back()
            case HomeAction():
                return self.primitives.home()
            case WaitAction(duration_ms=duration_ms):
                self.sleep(duration_ms / 1000)
                return None
            case ScreenshotAction():
                return None
            case _:
                raise TypeError(f"Unsupported macro action: {type(action).__name__}")

    def _target_payload(
        self,
        context: MacroExecutionContext,
    ) -> dict[str, object] | None:
        resolved = context.resolved_target
        if resolved is None:
            return None
        geometry = self.geometry_factory(context.frame, context.source_metadata)
        device_x, device_y = geometry.screen_to_device(
            resolved.center.x,
            resolved.center.y,
        )
        target: dict[str, object] = {
            "name": resolved.name,
            "source": resolved.source,
            "screen": {"x": resolved.center.x, "y": resolved.center.y},
            "device": {"x": device_x, "y": device_y},
        }
        if resolved.metadata is not None:
            target["metadata"] = dict(resolved.metadata)
        return target


def _error_result(error: BaseException) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": False,
        "error_type": type(error).__name__,
        "message": str(error),
    }
    for name in ("code", "request_id", "action_id", "outcome_unknown", "status"):
        value = getattr(error, name, None)
        if value is not None:
            result[name] = value
    return result


def default_screen_geometry(
    frame: ScreenFrame,
    metadata: dict[str, object],
) -> ScreenGeometry:
    """Build Android screen geometry from source metadata without transport access."""

    agent = metadata.get("agent")
    device = agent.get("device") if isinstance(agent, dict) else None
    device = device if isinstance(device, dict) else {}
    width = _positive_int(device.get("width"), frame.width)
    height = _positive_int(device.get("height"), frame.height)
    rotation = _rotation(device.get("rotation"), frame.rotation)
    display = agent.get("display") if isinstance(agent, dict) else None
    display = display if isinstance(display, dict) else {}
    raw_insets = display.get("insets", device.get("insets"))
    raw_insets = raw_insets if isinstance(raw_insets, dict) else {}
    return ScreenGeometry(
        frame.width,
        frame.height,
        width,
        height,
        rotation,
        ScreenInsets(
            top=_non_negative_number(raw_insets.get("top")),
            bottom=_non_negative_number(raw_insets.get("bottom")),
            left=_non_negative_number(raw_insets.get("left")),
            right=_non_negative_number(raw_insets.get("right")),
        ),
    )


def _positive_int(value: object, fallback: int) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return fallback


def _rotation(value: object, fallback: int) -> int:
    if isinstance(value, int) and value in (0, 90, 180, 270):
        return value
    return fallback


def _non_negative_number(value: object) -> float:
    if isinstance(value, int | float) and not isinstance(value, bool) and value >= 0:
        return float(value)
    return 0.0
