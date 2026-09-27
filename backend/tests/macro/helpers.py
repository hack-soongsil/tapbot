from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from tapbot.macro import (
    MacroExecutionResult,
    MacroExecutionStatus,
    MacroStepResult,
    StateClassification,
    TapTargetAction,
)
from tapbot.macro.actions import action_to_dict
from tapbot.macro.trace import MacroStepTrace
from tapbot.android.screen import ScreenFrame
from tapbot.vision.canonical import CanonicalVisionResult


def frame(frame_id: str = "frame-1") -> ScreenFrame:
    return ScreenFrame(
        image=np.zeros((100, 200, 3), dtype=np.uint8),
        frame_id=frame_id,
        source_id="test-screen",
        captured_at="2026-09-27T00:00:00+00:00",
        width=200,
        height=100,
    )


def step_result(
    step: int = 1,
    *,
    status: MacroExecutionStatus = MacroExecutionStatus.EXECUTED,
    error: str | None = None,
    terminal: bool = False,
) -> MacroStepResult:
    current_frame = frame(f"frame-{step}")
    classification = StateClassification("ready", 0.9, ("button",))
    decision = TapTargetAction("button")
    action = action_to_dict(decision)
    trace = MacroStepTrace(
        step=step,
        captured_at=current_frame.captured_at,
        source_id=current_frame.source_id,
        frame_id=current_frame.frame_id,
        screenshot_path=None,
        state=classification.state,
        state_confidence=classification.confidence,
        detections=(),
        decision=action,
        action=action,
        target={"name": "button"},
        api_result={"ok": status is MacroExecutionStatus.EXECUTED},
        status=status.value,
        error=error,
    )
    execution = MacroExecutionResult(
        status,
        api_result=trace.api_result,
        target=trace.target,
        error=error,
    )
    return MacroStepResult(
        frame=current_frame,
        vision=CanonicalVisionResult(current_frame, (), 0.1),
        classification=classification,
        decision=decision,
        resolved_target=None,
        controller_result=None,
        trace=trace,
        execution=execution,
        terminal=terminal,
    )


@dataclass
class StubCoordinator:
    fail_with: Exception | None = None

    def step(self, step_number: int, *, execute: bool = True) -> MacroStepResult:
        del execute
        if self.fail_with is not None:
            raise self.fail_with
        return step_result(step_number)
