"""Vision-derived state classification and declarative state-machine policy."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from tapbot.macro.actions import MacroAction, RequestHumanAction, ScreenshotAction
from tapbot.macro.models import (
    MacroStateSnapshot,
    MacroStatus,
    MacroStepResult,
    StateClassification,
)
from tapbot.android.screen import ScreenFrame
from tapbot.vision.detector import Detection


class StateClassifier(Protocol):
    def classify(
        self,
        frame: ScreenFrame,
        detections: Sequence[Detection],
    ) -> StateClassification: ...


@dataclass(frozen=True, slots=True)
class DetectionStateRule:
    state: str
    required_labels: frozenset[str]
    minimum_confidence: float = 0.5

    def __post_init__(self) -> None:
        if not self.state or not self.required_labels:
            raise ValueError("State rules require a state and at least one label")
        if not 0 <= self.minimum_confidence <= 1:
            raise ValueError("minimum_confidence must be between 0 and 1")


class DetectionStateClassifier:
    """Classify screens from trusted detector labels, without issuing actions."""

    def __init__(
        self,
        rules: Sequence[DetectionStateRule],
        *,
        unknown_state: str = "unknown",
    ) -> None:
        if not unknown_state:
            raise ValueError("unknown_state must not be empty")
        self.rules = tuple(rules)
        self.unknown_state = unknown_state

    def classify(
        self,
        frame: ScreenFrame,
        detections: Sequence[Detection],
    ) -> StateClassification:
        del frame
        label_confidence: dict[str, float] = {}
        for detection in detections:
            label_confidence[detection.label] = max(
                label_confidence.get(detection.label, 0.0),
                detection.confidence,
            )
        candidates: list[tuple[float, int, int, DetectionStateRule]] = []
        for index, rule in enumerate(self.rules):
            confidences = [
                label_confidence.get(label, 0.0) for label in rule.required_labels
            ]
            if all(value >= rule.minimum_confidence for value in confidences):
                candidates.append(
                    (min(confidences), len(rule.required_labels), -index, rule)
                )
        if not candidates:
            return StateClassification(self.unknown_state, 0.0)
        confidence, _, _, selected = max(candidates, key=lambda item: item[:3])
        return StateClassification(
            selected.state,
            confidence,
            tuple(sorted(selected.required_labels)),
        )


class MacroStateMachine:
    """Map classified state names to constrained primitive-level intentions."""

    def __init__(
        self,
        actions: Mapping[str, MacroAction],
        *,
        terminal_states: Sequence[str] = (),
    ) -> None:
        self._actions = dict(actions)
        self._terminal_states = frozenset(terminal_states)

    def decide(self, classification: StateClassification) -> MacroAction:
        if classification.state in self._terminal_states:
            return ScreenshotAction()
        return self._actions.get(
            classification.state,
            RequestHumanAction(
                f"No macro transition is configured for state {classification.state!r}"
            ),
        )

    def is_terminal(self, state: str) -> bool:
        return state in self._terminal_states


class MacroLifecycleError(RuntimeError):
    """Raised when a lifecycle command is invalid for the current state."""


@dataclass(slots=True)
class MacroRuntimeState:
    status: MacroStatus = MacroStatus.IDLE
    step_index: int = 0
    current_observation: object | None = None
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

    def start(self) -> None:
        if self.status is MacroStatus.RUNNING:
            return
        if self.status not in {MacroStatus.IDLE, MacroStatus.PAUSED}:
            raise MacroLifecycleError(f"Cannot start a {self.status.value} macro")
        self.status = MacroStatus.RUNNING
        self.error = None

    def pause(self) -> None:
        if self.status is MacroStatus.PAUSED:
            return
        if self.status is not MacroStatus.RUNNING:
            raise MacroLifecycleError(f"Cannot pause a {self.status.value} macro")
        self.status = MacroStatus.PAUSED

    def stop(self) -> None:
        if self.status is MacroStatus.STOPPED:
            return
        if self.status is MacroStatus.ERROR:
            raise MacroLifecycleError("Reset an errored macro before stopping it")
        self.status = MacroStatus.STOPPED

    def reset(self) -> None:
        self.status = MacroStatus.IDLE
        self.step_index = 0
        self.current_observation = None
        self.current_state = "unknown"
        self.previous_state = None
        self.state_confidence = 0.0
        self.last_decision = None
        self.last_resolved_target = None
        self.last_action = None
        self.last_result = None
        self.blocked_reason = None
        self.error = None
        self.terminal = False

    def assert_step_allowed(self) -> None:
        if self.status not in {
            MacroStatus.IDLE,
            MacroStatus.RUNNING,
            MacroStatus.PAUSED,
        }:
            raise MacroLifecycleError(f"Cannot step a {self.status.value} macro")

    def record_step(self, result: MacroStepResult) -> None:
        trace = result.trace
        if trace.state != self.current_state:
            self.previous_state = self.current_state
        self.current_observation = result.frame
        self.current_state = trace.state
        self.state_confidence = trace.state_confidence
        self.last_decision = dict(trace.decision)
        self.last_resolved_target = (
            None if trace.target is None else dict(trace.target)
        )
        self.last_action = None if trace.action is None else dict(trace.action)
        self.last_result = (
            None if trace.api_result is None else dict(trace.api_result)
        )
        self.blocked_reason = trace.error
        self.error = (
            trace.error if trace.status == "execution_failed" else None
        )
        self.terminal = result.terminal
        self.step_index += 1
        if trace.status == "execution_failed":
            self.status = MacroStatus.ERROR

    def fail(self, error: BaseException) -> None:
        self.status = MacroStatus.ERROR
        self.error = str(error)
        self.blocked_reason = str(error)

    def snapshot(self, macro_id: str) -> MacroStateSnapshot:
        return MacroStateSnapshot(
            macro_id=macro_id,
            status=self.status,
            step_index=self.step_index,
            current_state=self.current_state,
            previous_state=self.previous_state,
            state_confidence=self.state_confidence,
            last_decision=self.last_decision,
            last_resolved_target=self.last_resolved_target,
            last_action=self.last_action,
            last_result=self.last_result,
            blocked_reason=self.blocked_reason,
            error=self.error,
            terminal=self.terminal,
        )
