"""Transport-neutral macro lifecycle, result, and event models."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any

from tapbot.android.input import AndroidInputResult
from tapbot.macro.actions import MacroAction
from tapbot.macro.trace import MacroStepTrace
from tapbot.ui_resolution.visual import ResolvedTarget
from tapbot.android.screen import ScreenFrame
from tapbot.vision.canonical import CanonicalVisionResult


class MacroStatus(StrEnum):
    IDLE = "IDLE"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    STOPPED = "STOPPED"
    ERROR = "ERROR"


class MacroCommand(StrEnum):
    START = "start"
    PAUSE = "pause"
    STOP = "stop"
    RESET = "reset"
    STEP = "step"


class MacroExecutionStatus(StrEnum):
    PLANNED = "planned"
    EXECUTED = "executed"
    TARGET_NOT_FOUND = "target_not_found"
    HUMAN_REQUIRED = "human_required"
    EXECUTION_FAILED = "execution_failed"


@dataclass(frozen=True, slots=True)
class StateClassification:
    state: str
    confidence: float
    evidence: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class MacroExecutionResult:
    status: MacroExecutionStatus
    controller_result: AndroidInputResult | None = None
    api_result: dict[str, Any] | None = None
    target: dict[str, object] | None = None
    error: str | None = None
    outcome_unknown: bool = False


@dataclass(frozen=True, slots=True)
class MacroStepResult:
    frame: ScreenFrame
    vision: CanonicalVisionResult
    classification: StateClassification
    decision: MacroAction
    resolved_target: ResolvedTarget | None
    controller_result: AndroidInputResult | None
    trace: MacroStepTrace
    ui_tree: object | None = None
    execution: MacroExecutionResult | None = None
    terminal: bool = False


@dataclass(frozen=True, slots=True)
class MacroStateSnapshot:
    macro_id: str
    status: MacroStatus
    step_index: int
    current_state: str = "unknown"
    previous_state: str | None = None
    state_confidence: float = 0.0
    last_decision: dict[str, object] | None = None
    last_resolved_target: dict[str, object] | None = None
    last_action: dict[str, object] | None = None
    last_result: dict[str, Any] | None = None
    blocked_reason: str | None = None
    error: str | None = None
    terminal: bool = False


@dataclass(frozen=True, slots=True)
class MacroEvent:
    macro_id: str
    name: str
    status: str = "success"
    payload: dict[str, object] = field(default_factory=dict)
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
