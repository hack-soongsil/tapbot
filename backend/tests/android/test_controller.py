from tapbot.android.client import AndroidActionResult
from tapbot.android.controller import AndroidRemoteController
from tapbot.android.gesture import PointerGesture, PointerPoint


class StubAndroidClient:
    def tap(self, x: float, y: float, *, duration_ms: int) -> AndroidActionResult:
        assert (x, y, duration_ms) == (10, 20, 70)
        return AndroidActionResult("request-1", "action-1", "tap", "completed")

    def swipe(self, *args: object, **kwargs: object) -> AndroidActionResult:
        return AndroidActionResult("request-2", "action-2", "swipe", "completed")

    def gesture(self, gesture: PointerGesture) -> AndroidActionResult:
        assert gesture.points == (
            PointerPoint(10, 20, 0),
            PointerPoint(10, 20, 70),
        )
        return AndroidActionResult("request-1", "action-1", "gesture", "completed")

    def back(self) -> AndroidActionResult:
        return AndroidActionResult("request-3", "action-3", "back", "dispatched")

    def home(self) -> AndroidActionResult:
        return AndroidActionResult("request-4", "action-4", "home", "dispatched")


def test_android_controller_only_forwards_primitives() -> None:
    controller = AndroidRemoteController(StubAndroidClient())  # type: ignore[arg-type]

    result = controller.tap(10, 20)

    assert result.action_id == "action-1"
    assert result.metadata == {
        "request_id": "request-1",
        "backend": "android_remote",
    }
