import cv2
import numpy as np
from tapbot.android.client import AndroidScreenshot
from tapbot.android.geometry import ScreenGeometry
from tapbot.android.screen_source import AndroidRemoteScreenSource


class StubAndroidClient:
    base_url = "http://phone.local:8765"

    def __init__(self, encoded: bytes) -> None:
        self.encoded = encoded

    def status(self) -> dict[str, object]:
        return {
            "ok": True,
            "device": {"width": 4, "height": 3, "rotation": 0, "density": 3.0},
            "stream_running": True,
        }

    def screenshot(self) -> AndroidScreenshot:
        return AndroidScreenshot(
            self.encoded,
            "image/png",
            42,
            4,
            3,
            0,
            "2026-09-25T00:00:00Z",
        )


def test_android_source_decodes_canonical_screenshot_and_status() -> None:
    image = np.full((3, 4, 3), (10, 20, 30), dtype=np.uint8)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    source = AndroidRemoteScreenSource(StubAndroidClient(encoded.tobytes()))  # type: ignore[arg-type]

    status = source.refresh_status()
    frame = source.screenshot()

    assert status["stream_running"] is True
    assert frame.frame_id == "42"
    assert frame.source_id == "android:phone.local:8765"
    assert frame.metadata["already_canonical"] is True
    assert (source.width, source.height, source.rotation) == (4, 3, 0)
    assert source.metadata["already_canonical"] is True
    assert np.array_equal(frame.image, image)
    assert source.latest_frame() is frame


def test_screen_geometry_is_identity_at_matching_resolution_and_scales() -> None:
    identity = ScreenGeometry(1080, 2400, 1080, 2400)
    assert identity.screen_to_device(520, 1170) == (520, 1170)

    scaled = ScreenGeometry(540, 1200, 1080, 2400)
    x, y = scaled.screen_to_device(539, 1199)
    assert (x, y) == (1079, 2399)
    try:
        scaled.screen_to_device(540, 0)
    except ValueError as error:
        assert "x must be within" in str(error)
    else:
        raise AssertionError("out-of-bounds screen coordinate was accepted")
