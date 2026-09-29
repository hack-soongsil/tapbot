"""High-fidelity local Android Agent mock for the SSUTODAY reservation flow.

Rendering, UI Tree generation, layout, fixtures, and interactions live in
``scripts.mock_ssutoday``. This module only exposes the Android Agent HTTP
surface and owns frame/session bookkeeping.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterator
from datetime import datetime, timezone
import os
from threading import RLock
import time
from typing import Annotated, Any
from uuid import uuid4

import cv2
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
import uvicorn

from scripts.mock_ssutoday import (
    HEIGHT,
    WIDTH,
    MockSsutodayState,
    build_ui_tree,
    render_screen,
)
from scripts.mock_ssutoday.fixtures import PACKAGE_NAME


DEFAULT_TOKEN = "tapbot-local-mock"


class TapRequest(BaseModel):
    x: float
    y: float
    duration_ms: int = 70


class SwipeRequest(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float
    duration_ms: int = 450


class GesturePoint(BaseModel):
    x: float
    y: float
    t_ms: int


class GestureRequest(BaseModel):
    points: list[GesturePoint]


class MockAndroidDevice:
    """Android Agent facade around the deterministic SSUTODAY state machine."""

    def __init__(self) -> None:
        self.state = MockSsutodayState()
        self._frame_lock = RLock()
        self._frame_id = 0

    @property
    def screen(self) -> str:
        return self.state.screen

    def tap(self, x: float, y: float) -> None:
        self.state.tap(x, y)

    def swipe(self, x1: float, y1: float, x2: float, y2: float) -> None:
        self.state.swipe(x1, y1, x2, y2)

    def back(self) -> None:
        self.state.back()

    def home(self) -> None:
        self.state.home()

    def jpeg(self) -> tuple[bytes, int, str]:
        image = render_screen(self.state.snapshot())
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            raise RuntimeError("Could not encode the mock Android frame")
        with self._frame_lock:
            self._frame_id += 1
            frame_id = self._frame_id
        return encoded.tobytes(), frame_id, _now()

    def ui_tree(self) -> dict[str, Any]:
        snapshot = self.state.snapshot()
        root, flat_nodes = build_ui_tree(snapshot)
        return {
            "ok": True,
            "request_id": _request_id(),
            "captured_at": _now(),
            "package_name": PACKAGE_NAME,
            "window_title": f"SSUTODAY Mock - {snapshot.screen}",
            "rotation": 0,
            "screen_width": WIDTH,
            "screen_height": HEIGHT,
            "node_count": len(flat_nodes),
            "truncated": False,
            "root": root,
            "nodes": flat_nodes,
        }


def create_app(*, token: str = DEFAULT_TOKEN) -> FastAPI:
    app = FastAPI(title="TapBot SSUTODAY Mock Android Agent", version="2.0.0")
    device = MockAndroidDevice()
    app.state.device = device

    def authorize(
        authorization: Annotated[str | None, Header()] = None,
    ) -> None:
        if authorization != f"Bearer {token}":
            raise HTTPException(status_code=401, detail="Invalid mock agent token")

    authorized = [Depends(authorize)]

    @app.get("/api/status", dependencies=authorized)
    def status() -> dict[str, Any]:
        return {
            "ok": True,
            "request_id": _request_id(),
            "remote_control_enabled": True,
            "accessibility_enabled": True,
            "capture_ready": True,
            "stream_running": True,
            "server_running": True,
            "server_port": 0,
            "connected_clients": 1,
            "frame_id": None,
            "captured_at_ms": int(time.time() * 1000),
            "last_error": None,
            "coordinate_mapping": "screenshot_px_equals_logical_screen_px",
            "agent_version": "ssutoday-mock-2.0.0",
            "display": {
                "physical_width": WIDTH,
                "physical_height": HEIGHT,
                "logical_width": WIDTH,
                "logical_height": HEIGHT,
                "density": 3.0,
                "density_dpi": 480,
                "rotation": 0,
                "insets": {"top": 82, "bottom": 90, "left": 0, "right": 0},
            },
            "device": {
                "width": WIDTH,
                "height": HEIGHT,
                "rotation": 0,
                "density": 3.0,
                "manufacturer": "TapBot",
                "model": "SSUTODAY Capture Mock",
                "android_version": "16",
                "sdk_int": 36,
                "local_ipv4_addresses": ["127.0.0.1"],
            },
            "mock": {"screen": device.screen, "screens": 4},
        }

    @app.get("/api/stream/status", dependencies=authorized)
    def stream_status() -> dict[str, Any]:
        return {
            "ok": True,
            "request_id": _request_id(),
            "running": True,
            "codec": "mjpeg",
            "transport": "http_multipart",
            "width": WIDTH,
            "height": HEIGHT,
            "rotation": 0,
            "fps": 5.0,
            "target_fps": 5.0,
            "bitrate": 0,
            "clients": 1,
            "last_frame_id": None,
            "capture_latency_ms": 2.0,
            "encode_latency_ms": 3.0,
            "frame_age_ms": 0,
            "screen_interactive": True,
            "device_locked": False,
            "coordinate_system": "logical_display_pixels",
        }

    @app.get("/api/screenshot", dependencies=authorized)
    def screenshot() -> Response:
        content, frame_id, captured_at = device.jpeg()
        return Response(
            content=content,
            media_type="image/jpeg",
            headers={
                "X-Request-Id": _request_id(),
                "X-Frame-Id": str(frame_id),
                "X-Screen-Width": str(WIDTH),
                "X-Screen-Height": str(HEIGHT),
                "X-Rotation": "0",
                "X-Captured-At": captured_at,
                "Cache-Control": "no-store",
            },
        )

    @app.get("/api/stream", dependencies=authorized)
    def stream() -> StreamingResponse:
        return StreamingResponse(
            _mjpeg_frames(device),
            media_type="multipart/x-mixed-replace; boundary=tapbotframe",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/ui-tree", dependencies=authorized)
    def ui_tree() -> dict[str, Any]:
        return device.ui_tree()

    @app.post("/api/tap", dependencies=authorized)
    def tap(payload: TapRequest) -> dict[str, Any]:
        device.tap(payload.x, payload.y)
        return _action("tap")

    @app.post("/api/swipe", dependencies=authorized)
    def swipe(payload: SwipeRequest) -> dict[str, Any]:
        device.swipe(payload.x1, payload.y1, payload.x2, payload.y2)
        return _action("swipe")

    @app.post("/api/gesture", dependencies=authorized)
    def gesture(payload: GestureRequest) -> dict[str, Any]:
        if not payload.points:
            raise HTTPException(status_code=422, detail="Gesture requires a point")
        first = payload.points[0]
        last = payload.points[-1]
        if len(payload.points) > 1 and (
            abs(last.x - first.x) > 8 or abs(last.y - first.y) > 8
        ):
            device.swipe(first.x, first.y, last.x, last.y)
        else:
            device.tap(last.x, last.y)
        return _action("gesture")

    @app.post("/api/back", dependencies=authorized)
    def back() -> dict[str, Any]:
        device.back()
        return _action("back")

    @app.post("/api/home", dependencies=authorized)
    def home() -> dict[str, Any]:
        device.home()
        return _action("home")

    return app


def _mjpeg_frames(device: MockAndroidDevice) -> Iterator[bytes]:
    while True:
        content, _, _ = device.jpeg()
        yield (
            b"--tapbotframe\r\n"
            b"Content-Type: image/jpeg\r\n"
            + f"Content-Length: {len(content)}\r\n\r\n".encode()
            + content
            + b"\r\n"
        )
        time.sleep(0.2)


def _action(command: str) -> dict[str, Any]:
    return {
        "ok": True,
        "request_id": _request_id(),
        "action_id": f"mock-action-{uuid4().hex[:12]}",
        "command": command,
        "state": "completed",
    }


def _request_id() -> str:
    return f"mock-request-{uuid4().hex[:12]}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=28765)
    parser.add_argument("--token", default=os.getenv("TAPBOT_MOCK_ANDROID_TOKEN", DEFAULT_TOKEN))
    args = parser.parse_args()
    uvicorn.run(
        create_app(token=args.token),
        host=args.host,
        port=args.port,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
