import cv2
import numpy as np

from tapbot.android.client import AndroidActionResult, AndroidScreenshot
from tapbot.android.controller import AndroidRemoteController
from tapbot.android.gesture import PointerGesture
from tapbot.macro import (
    DetectionStateClassifier,
    DetectionStateRule,
    MacroCoordinator,
    MacroEngine,
    MacroExecutor,
    MacroStateMachine,
    TapTargetAction,
    default_screen_geometry,
)
from tapbot.ui_resolution.visual import TargetResolver
from tapbot.android.screen_source import AndroidRemoteScreenSource
from tapbot.vision import CanonicalVisionPipeline
from tapbot.vision.detector import (
    BoundingBox,
    ColorButtonConfig,
    ColorButtonDetector,
    Detection,
)


class MacroAndroidClient:
    base_url = "http://android.test:8765"

    def __init__(self) -> None:
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        image[30:70, 80:140] = (0, 255, 0)
        ok, encoded = cv2.imencode(".png", image)
        assert ok
        self.encoded = encoded.tobytes()
        self.taps: list[tuple[float, float, int]] = []

    def status(self) -> dict[str, object]:
        return {
            "ok": True,
            "device": {"width": 200, "height": 100, "rotation": 0},
        }

    def screenshot(self) -> AndroidScreenshot:
        return AndroidScreenshot(
            self.encoded,
            "image/png",
            7,
            200,
            100,
            0,
            "2026-09-25T00:00:00Z",
        )

    def tap(self, x: float, y: float, *, duration_ms: int) -> AndroidActionResult:
        self.taps.append((x, y, duration_ms))
        return AndroidActionResult("req-7", "action-7", "tap", "completed")

    def gesture(self, gesture: PointerGesture) -> AndroidActionResult:
        first = gesture.points[0]
        self.taps.append((first.x, first.y, gesture.duration_ms))
        return AndroidActionResult("req-7", "action-7", "gesture", "completed")

    def swipe(self, *args: object, **kwargs: object) -> AndroidActionResult:
        raise AssertionError("swipe should not be called")

    def back(self) -> AndroidActionResult:
        raise AssertionError("back should not be called")

    def home(self) -> AndroidActionResult:
        raise AssertionError("home should not be called")


def test_android_screenshot_runs_vision_and_calls_remote_tap() -> None:
    client = MacroAndroidClient()
    source = AndroidRemoteScreenSource(client)  # type: ignore[arg-type]
    controller = AndroidRemoteController(client)  # type: ignore[arg-type]
    engine = MacroEngine(
        MacroCoordinator(
            source,
            CanonicalVisionPipeline(
                [
                    ColorButtonDetector(
                        ColorButtonConfig(
                            label="confirm_button",
                            min_area=100,
                            morphology_kernel_size=1,
                        )
                    )
                ]
            ),
            DetectionStateClassifier(
                [DetectionStateRule("confirmation", frozenset({"confirm_button"}))]
            ),
            MacroStateMachine(
                {"confirmation": TapTargetAction("confirm_button")}
            ),
            TargetResolver(minimum_detection_confidence=0.5),
            MacroExecutor(
                controller,
                geometry_factory=default_screen_geometry,
            ),
        ),
    )

    result = engine.step()

    assert result.trace.status == "executed"
    assert result.trace.frame_id == "7"
    assert result.trace.api_result is not None
    assert result.trace.api_result["metadata"]["backend"] == "android_remote"
    assert len(client.taps) == 1
    tap_x, tap_y, duration = client.taps[0]
    assert 108 <= tap_x <= 111
    assert 48 <= tap_y <= 51
    assert duration == 70
