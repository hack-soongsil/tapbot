"""One deterministic observe/classify/decide/resolve/execute macro step."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

import cv2

from tapbot.macro.actions import MacroAction, TapTargetAction, action_to_dict
from tapbot.macro.executor import MacroExecutionContext, MacroExecutor
from tapbot.macro.models import (
    MacroExecutionStatus,
    MacroStepResult,
)
from tapbot.macro.state import (
    StateClassification,
    StateClassifier,
)
from tapbot.macro.trace import MacroStepTrace
from tapbot.ui_resolution.visual import ResolvedTarget
from tapbot.android.screen import ScreenFrame
from tapbot.vision.canonical import CanonicalVisionResult
from tapbot.vision.detector import Detection


class ObservationSource(Protocol):
    def screenshot(self) -> ScreenFrame: ...

    def get_metadata(self) -> dict[str, object]: ...


class VisionPipeline(Protocol):
    def run(self, frame: ScreenFrame) -> CanonicalVisionResult: ...


class TargetResolver(Protocol):
    def resolve(
        self,
        target_name: str,
        detections: Sequence[Detection],
        *,
        screen_width: int,
        screen_height: int,
    ) -> ResolvedTarget | None: ...


class DecisionPolicy(Protocol):
    def decide(self, classification: StateClassification) -> MacroAction: ...

    def is_terminal(self, state: str) -> bool: ...


class HybridTargetResolver(Protocol):
    def resolve(
        self,
        target_name: str,
        detections: Sequence[Detection],
        *,
        screen_width: int,
        screen_height: int,
        ui_tree: object | None = None,
    ) -> ResolvedTarget | None: ...


class UiTreeProvider(Protocol):
    def snapshot(self, *, max_age_ms: float = 0) -> object: ...


class UiTreeStateClassification(Protocol):
    state: str
    confidence: float
    evidence: tuple[str, ...]


class UiTreeStateClassifier(Protocol):
    def classify(self, tree: object) -> UiTreeStateClassification | None: ...


class MacroCoordinator:
    """Compose injected domain ports without knowing HTTP or serial transports."""

    def __init__(
        self,
        source: ObservationSource,
        vision: VisionPipeline,
        classifier: StateClassifier,
        decision_policy: DecisionPolicy,
        target_resolver: TargetResolver,
        executor: MacroExecutor,
        *,
        artifact_dir: str | Path | None = None,
        ui_tree_provider: UiTreeProvider | None = None,
        hybrid_target_resolver: HybridTargetResolver | None = None,
        ui_tree_state_classifier: UiTreeStateClassifier | None = None,
        ui_tree_max_age_ms: float = 500,
    ) -> None:
        if ui_tree_max_age_ms < 0:
            raise ValueError("ui_tree_max_age_ms must not be negative")
        self.source = source
        self.vision = vision
        self.classifier = classifier
        self.decision_policy = decision_policy
        self.target_resolver = target_resolver
        self.executor = executor
        self.artifact_dir = None if artifact_dir is None else Path(artifact_dir)
        self.ui_tree_provider = ui_tree_provider
        self.hybrid_target_resolver = hybrid_target_resolver
        self.ui_tree_state_classifier = ui_tree_state_classifier
        self.ui_tree_max_age_ms = ui_tree_max_age_ms

    def step(self, step_number: int, *, execute: bool = True) -> MacroStepResult:
        frame = self.source.screenshot()
        ui_tree, ui_tree_error = self._observe_ui_tree()
        vision = self.vision.run(frame)
        classification = self._classify(frame, vision, ui_tree)
        decision = self.decision_policy.decide(classification)
        resolved = self._resolve(decision, vision.detections, frame, ui_tree)
        execution = self.executor.execute(
            decision,
            MacroExecutionContext(
                frame=frame,
                source_metadata=self.source.get_metadata(),
                resolved_target=resolved,
            ),
            enabled=execute,
        )
        screenshot_path = self._save_screenshot(frame, step_number)
        action = action_to_dict(decision)
        trace = MacroStepTrace(
            step=step_number,
            captured_at=frame.captured_at,
            source_id=frame.source_id,
            frame_id=frame.frame_id,
            screenshot_path=screenshot_path,
            state=classification.state,
            state_confidence=classification.confidence,
            detections=tuple(item.to_dict() for item in vision.detections),
            decision=action,
            action=(
                action
                if execution.status
                in {
                    MacroExecutionStatus.PLANNED,
                    MacroExecutionStatus.EXECUTED,
                    MacroExecutionStatus.EXECUTION_FAILED,
                }
                else None
            ),
            target=execution.target,
            api_result=execution.api_result,
            status=execution.status.value,
            error=execution.error,
            ui_tree=_ui_tree_trace(ui_tree, ui_tree_error),
        )
        return MacroStepResult(
            frame=frame,
            vision=vision,
            classification=classification,
            decision=decision,
            resolved_target=resolved,
            controller_result=execution.controller_result,
            trace=trace,
            ui_tree=ui_tree,
            execution=execution,
            terminal=self.decision_policy.is_terminal(classification.state),
        )

    def _observe_ui_tree(self) -> tuple[object | None, str | None]:
        if self.ui_tree_provider is None:
            return None, None
        try:
            return (
                self.ui_tree_provider.snapshot(max_age_ms=self.ui_tree_max_age_ms),
                None,
            )
        except Exception as error:
            return None, str(error)

    def _classify(
        self,
        frame: ScreenFrame,
        vision: CanonicalVisionResult,
        ui_tree: object | None,
    ) -> StateClassification:
        classification = self.classifier.classify(frame, vision.detections)
        if ui_tree is None or self.ui_tree_state_classifier is None:
            return classification
        accessible = self.ui_tree_state_classifier.classify(ui_tree)
        if accessible is None:
            return classification
        return StateClassification(
            accessible.state,
            accessible.confidence,
            accessible.evidence,
        )

    def _resolve(
        self,
        decision: object,
        detections: Sequence[Detection],
        frame: ScreenFrame,
        ui_tree: object | None,
    ) -> ResolvedTarget | None:
        if not isinstance(decision, TapTargetAction):
            return None
        if self.hybrid_target_resolver is not None:
            return self.hybrid_target_resolver.resolve(
                decision.target,
                detections,
                screen_width=frame.width,
                screen_height=frame.height,
                ui_tree=ui_tree,
            )
        return self.target_resolver.resolve(
            decision.target,
            detections,
            screen_width=frame.width,
            screen_height=frame.height,
        )

    def _save_screenshot(self, frame: ScreenFrame, step: int) -> str | None:
        if self.artifact_dir is None:
            return None
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        destination = (
            self.artifact_dir / f"step-{step:04d}-{_safe_id(frame.frame_id)}.png"
        )
        if not cv2.imwrite(str(destination), frame.image):
            raise OSError(f"Could not save macro screenshot: {destination}")
        return str(destination)


def _ui_tree_trace(
    ui_tree: object | None,
    error: str | None,
) -> dict[str, object]:
    nodes = getattr(ui_tree, "nodes", ())
    return {
        "captured_at": getattr(ui_tree, "captured_at", None),
        "package_name": getattr(ui_tree, "package_name", None),
        "node_count": len(nodes) if isinstance(nodes, tuple | list) else 0,
        "truncated": bool(getattr(ui_tree, "truncated", False)),
        "error": error,
    }


def _safe_id(value: str) -> str:
    return "".join(
        character if character.isalnum() or character in "-_" else "_"
        for character in value
    )[:80]
