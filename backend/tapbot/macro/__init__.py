"""Transport-neutral macro orchestration and lifecycle domain."""

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
from tapbot.macro.state import (
    DetectionStateClassifier,
    DetectionStateRule,
    MacroLifecycleError,
    MacroRuntimeState,
    MacroStateMachine,
    StateClassification,
    StateClassifier,
)
from tapbot.macro.coordinator import MacroCoordinator
from tapbot.macro.engine import MacroEngine
from tapbot.macro.executor import (
    MacroExecutionContext,
    MacroExecutor,
    PrimitiveExecutor,
    default_screen_geometry,
)
from tapbot.macro.models import (
    MacroCommand,
    MacroEvent,
    MacroExecutionResult,
    MacroExecutionStatus,
    MacroStateSnapshot,
    MacroStatus,
    MacroStepResult,
)
from tapbot.macro.service import MacroService
from tapbot.macro.trace import MacroStepTrace, MacroTrace

__all__ = [
    "BackAction",
    "DetectionStateClassifier",
    "DetectionStateRule",
    "HomeAction",
    "MacroAction",
    "MacroCommand",
    "MacroCoordinator",
    "MacroEngine",
    "MacroEvent",
    "MacroExecutionContext",
    "MacroExecutionResult",
    "MacroExecutionStatus",
    "MacroExecutor",
    "MacroLifecycleError",
    "MacroRuntimeState",
    "MacroService",
    "MacroStateSnapshot",
    "MacroStateMachine",
    "MacroStatus",
    "MacroStepResult",
    "MacroStepTrace",
    "MacroTrace",
    "PrimitiveExecutor",
    "RequestHumanAction",
    "ScreenshotAction",
    "StateClassification",
    "StateClassifier",
    "SwipeAction",
    "TapTargetAction",
    "WaitAction",
    "default_screen_geometry",
]
