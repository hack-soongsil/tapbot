from tapbot.android.input import AndroidInputResult
from tapbot.macro import (
    MacroCoordinator,
    MacroExecutor,
    MacroStateMachine,
    StateClassification,
    TapTargetAction,
    default_screen_geometry,
)
from tapbot.ui_resolution.visual import TargetResolver
from tapbot.vision.canonical import CanonicalVisionResult
from tapbot.vision.detector import BoundingBox, Detection
from tests.macro.helpers import frame


class Source:
    def __init__(self, calls: list[str]) -> None:
        self.calls = calls
        self.source_id = "test-screen"

    def screenshot(self):
        self.calls.append("observe")
        return frame()

    def get_metadata(self) -> dict[str, object]:
        return {}


class Vision:
    def __init__(self, calls: list[str], detection: Detection) -> None:
        self.calls = calls
        self.detection = detection

    def run(self, current_frame):
        self.calls.append("vision")
        return CanonicalVisionResult(current_frame, (self.detection,), 0.2)


class Classifier:
    def __init__(self, calls: list[str]) -> None:
        self.calls = calls

    def classify(self, current_frame, detections):
        del current_frame, detections
        self.calls.append("classify")
        return StateClassification("ready", 0.9)


class DecisionPolicy(MacroStateMachine):
    def __init__(self, calls: list[str]) -> None:
        super().__init__({"ready": TapTargetAction("button")})
        self.calls = calls

    def decide(self, classification):
        self.calls.append("decide")
        return super().decide(classification)


class Resolver:
    def __init__(self, calls: list[str]) -> None:
        self.calls = calls
        self.delegate = TargetResolver()

    def resolve(self, *args, **kwargs):
        self.calls.append("resolve")
        return self.delegate.resolve(*args, **kwargs)


class Primitives:
    def __init__(self, calls: list[str]) -> None:
        self.calls = calls

    def tap(self, x, y, *, duration_ms=70):
        self.calls.append("execute")
        return AndroidInputResult(
            "tap",
            "completed",
            metadata={"x": x, "y": y, "duration_ms": duration_ms},
        )

    def swipe(self, *args, **kwargs):
        raise AssertionError("not expected")

    def back(self):
        raise AssertionError("not expected")

    def home(self):
        raise AssertionError("not expected")


def test_one_step_order_is_deterministic() -> None:
    calls: list[str] = []
    detection = Detection(
        "button",
        BoundingBox(80, 30, 40, 20),
        0.95,
        "test",
    )
    resolver = Resolver(calls)
    coordinator = MacroCoordinator(
        Source(calls),
        Vision(calls, detection),
        Classifier(calls),
        DecisionPolicy(calls),
        resolver,
        MacroExecutor(
            Primitives(calls),
            geometry_factory=default_screen_geometry,
        ),
    )

    result = coordinator.step(1)

    assert calls == [
        "observe",
        "vision",
        "classify",
        "decide",
        "resolve",
        "execute",
    ]
    assert result.trace.status == "executed"
    assert result.trace.step == 1
    assert result.trace.target is not None
    assert result.trace.target["source"] == "detection"
