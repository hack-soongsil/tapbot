"""Local three-screen Android Agent mock for dashboard development."""

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
import numpy as np
from pydantic import BaseModel
import uvicorn


WIDTH = 432
HEIGHT = 768
PACKAGE_NAME = "com.tapbot.mock"
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
    """Small deterministic state machine that behaves like an Android Agent."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._screen = "home"
        self._selected_slot: int | None = None
        self._frame_id = 0

    @property
    def screen(self) -> str:
        with self._lock:
            return self._screen

    def tap(self, x: float, y: float) -> None:
        with self._lock:
            if self._screen == "home":
                if 105 <= y <= 610:
                    self._screen = "detail"
                    self._selected_slot = None
                return

            if self._screen == "detail":
                if x <= 82 and y <= 112:
                    self._screen = "home"
                    self._selected_slot = None
                    return
                slot = _slot_at(x, y)
                if slot is not None:
                    self._selected_slot = slot
                    return
                if 648 <= y <= 738 and self._selected_slot is not None:
                    self._screen = "complete"
                return

            if self._screen == "complete" and 600 <= y <= 710:
                self._screen = "home"
                self._selected_slot = None

    def back(self) -> None:
        with self._lock:
            if self._screen == "complete":
                self._screen = "detail"
            elif self._screen == "detail":
                self._screen = "home"
                self._selected_slot = None

    def home(self) -> None:
        with self._lock:
            self._screen = "home"
            self._selected_slot = None

    def jpeg(self) -> tuple[bytes, int, str]:
        with self._lock:
            self._frame_id += 1
            frame_id = self._frame_id
            screen = self._screen
            selected_slot = self._selected_slot
        image = _render(screen, selected_slot)
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            raise RuntimeError("Could not encode the mock Android frame")
        return encoded.tobytes(), frame_id, _now()

    def ui_tree(self) -> dict[str, Any]:
        with self._lock:
            screen = self._screen
            selected_slot = self._selected_slot
        nodes = _screen_nodes(screen, selected_slot)
        root = _node(
            "root",
            bounds=(0, 0, WIDTH, HEIGHT),
            class_name="android.widget.FrameLayout",
            children=nodes,
        )
        flat_nodes = [_without_children(root), *[_without_children(item) for item in nodes]]
        return {
            "ok": True,
            "request_id": _request_id(),
            "captured_at": _now(),
            "package_name": PACKAGE_NAME,
            "window_title": f"TapBot Mock - {screen}",
            "rotation": 0,
            "screen_width": WIDTH,
            "screen_height": HEIGHT,
            "node_count": len(flat_nodes),
            "truncated": False,
            "root": root,
            "nodes": flat_nodes,
        }


def create_app(*, token: str = DEFAULT_TOKEN) -> FastAPI:
    app = FastAPI(title="TapBot Mock Android Agent", version="1.0.0")
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
            "agent_version": "mock-1.0.0",
            "display": {
                "physical_width": WIDTH,
                "physical_height": HEIGHT,
                "logical_width": WIDTH,
                "logical_height": HEIGHT,
                "density": 1.0,
                "density_dpi": 160,
                "rotation": 0,
                "insets": {"top": 24, "bottom": 0, "left": 0, "right": 0},
            },
            "device": {
                "width": WIDTH,
                "height": HEIGHT,
                "rotation": 0,
                "density": 1.0,
                "manufacturer": "TapBot",
                "model": "Three Screen Mock",
                "android_version": "16",
                "sdk_int": 36,
                "local_ipv4_addresses": ["127.0.0.1"],
            },
            "mock": {"screen": device.screen, "screens": 3},
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
            "capture_latency_ms": 1.0,
            "encode_latency_ms": 1.0,
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
        device.tap(payload.x2, payload.y2)
        return _action("swipe")

    @app.post("/api/gesture", dependencies=authorized)
    def gesture(payload: GestureRequest) -> dict[str, Any]:
        if not payload.points:
            raise HTTPException(status_code=422, detail="Gesture requires a point")
        last = payload.points[-1]
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


def _screen_nodes(screen: str, selected_slot: int | None) -> list[dict[str, Any]]:
    if screen == "home":
        nodes = [
            _node("title", text="스터디룸 예약", bounds=(24, 40, 250, 92), class_name="android.widget.TextView"),
            _node("history", description="예약 내역", bounds=(318, 42, 414, 92)),
            _node("picker", text="2026년 9월 28일(월)", bounds=(24, 102, 408, 148)),
        ]
        for index, label in enumerate(("월 28", "화 29", "수 30")):
            left = 24 + index * 132
            nodes.append(_node(f"quick-{index}", text=label, bounds=(left, 160, left + 112, 210)))
        nodes.extend(
            (
                _node("room-a", text="스터디룸 A", description="스터디룸 A 예약", bounds=(24, 238, 408, 390)),
                _node("notice", description="공지", bounds=(0, 700, 144, 768)),
                _node("reservation", description="예약", bounds=(144, 700, 288, 768), selected=True),
                _node("my", description="마이", bounds=(288, 700, 432, 768)),
            )
        )
        return nodes

    if screen == "detail":
        nodes = [
            _node("back", bounds=(18, 40, 74, 100)),
            _node("detail-title", text="스터디룸 A", bounds=(92, 42, 340, 96), class_name="android.widget.TextView"),
            _node("picker", text="2026년 9월 28일(월)", bounds=(24, 112, 408, 160)),
            _node(
                "guidance",
                text="한 칸은 30분입니다. 예약된 시간은 선택할 수 없어요",
                bounds=(24, 174, 408, 218),
                class_name="android.widget.TextView",
            ),
            _node("reset", text="초기화", bounds=(322, 222, 408, 260)),
        ]
        for index in range(8):
            left = 24 + (index % 2) * 204
            top = 278 + (index // 2) * 72
            nodes.append(
                _node(
                    f"slot-{index}",
                    bounds=(left, top, left + 180, top + 54),
                    selected=index == selected_slot,
                )
            )
        cta_text = "이 시간으로 예약하기" if selected_slot is not None else "시간을 선택하세요"
        nodes.append(
            _node(
                "reserve",
                text=cta_text,
                bounds=(24, 660, 408, 730),
                enabled=selected_slot is not None,
            )
        )
        return nodes

    return [
        _node("complete-title", text="예약이 완료되었습니다", bounds=(48, 250, 384, 310), class_name="android.widget.TextView"),
        _node("complete-detail", text="스터디룸 A · 09:00", bounds=(72, 332, 360, 382), class_name="android.widget.TextView"),
        _node("complete-home", text="예약 화면으로 돌아가기", bounds=(24, 620, 408, 694)),
    ]


def _node(
    node_id: str,
    *,
    bounds: tuple[int, int, int, int],
    text: str | None = None,
    description: str | None = None,
    class_name: str = "android.widget.Button",
    enabled: bool = True,
    selected: bool = False,
    children: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    children = children or []
    return {
        "node_id": node_id,
        "parent_id": None if node_id == "root" else "root",
        "depth": 0 if node_id == "root" else 1,
        "class_name": class_name,
        "text": text,
        "content_description": description,
        "view_id_resource_name": f"{PACKAGE_NAME}:id/{node_id}",
        "package_name": PACKAGE_NAME,
        "bounds": dict(zip(("left", "top", "right", "bottom"), bounds, strict=True)),
        "clickable": class_name == "android.widget.Button",
        "enabled": enabled,
        "focusable": class_name == "android.widget.Button",
        "focused": False,
        "selected": selected,
        "checked": False,
        "checkable": False,
        "scrollable": False,
        "editable": False,
        "visible_to_user": True,
        "password": False,
        "child_count": len(children),
        "children": children,
    }


def _without_children(node: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in node.items() if key != "children"}


def _slot_at(x: float, y: float) -> int | None:
    for index in range(8):
        left = 24 + (index % 2) * 204
        top = 278 + (index // 2) * 72
        if left <= x <= left + 180 and top <= y <= top + 54:
            return index
    return None


def _render(screen: str, selected_slot: int | None) -> np.ndarray:
    image = np.full((HEIGHT, WIDTH, 3), (248, 246, 242), dtype=np.uint8)
    _rect(image, (0, 0), (WIDTH, 24), (30, 28, 26))
    cv2.putText(image, "09:41", (18, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (245, 245, 245), 1, cv2.LINE_AA)
    if screen == "home":
        _render_home(image)
    elif screen == "detail":
        _render_detail(image, selected_slot)
    else:
        _render_complete(image)
    return image


def _render_home(image: np.ndarray) -> None:
    _title(image, "Study room booking", 38)
    _button(image, (318, 44, 408, 86), "HISTORY", outline=True, font_scale=0.36)
    _text(image, "SEP 28, 2026", (24, 126), 0.47, (92, 83, 72))
    for index, label in enumerate(("MON 28", "TUE 29", "WED 30")):
        left = 24 + index * 132
        _button(image, (left, 158, left + 112, 208), label, selected=index == 0, font_scale=0.42)
    _card(image, (24, 238, 408, 390))
    _text(image, "STUDY ROOM A", (46, 278), 0.64, (35, 32, 29), thickness=2)
    _text(image, "Quiet room  |  4 seats", (46, 312), 0.46, (105, 96, 84))
    _text(image, "Available today", (46, 354), 0.45, (37, 130, 92), thickness=2)
    _button(image, (275, 330, 386, 374), "BOOK", selected=True, font_scale=0.45)
    _text(image, "Tap a date or room card to continue", (38, 444), 0.46, (117, 108, 96))
    _bottom_nav(image, "BOOK")


def _render_detail(image: np.ndarray, selected_slot: int | None) -> None:
    _text(image, "<", (25, 78), 1.0, (38, 35, 32), thickness=2)
    _title(image, "Study room A", 42, x=92)
    _text(image, "MONDAY, SEP 28", (24, 138), 0.5, (92, 83, 72))
    _text(image, "Each slot is 30 minutes", (24, 190), 0.45, (117, 108, 96))
    _text(image, "RESET", (335, 244), 0.4, (50, 105, 190), thickness=2)
    for index in range(8):
        hour = 9 + index // 2
        minute = "00" if index % 2 == 0 else "30"
        left = 24 + (index % 2) * 204
        top = 278 + (index // 2) * 72
        _button(
            image,
            (left, top, left + 180, top + 54),
            f"{hour:02d}:{minute}",
            selected=index == selected_slot,
            outline=index != selected_slot,
            font_scale=0.55,
        )
    label = "CONFIRM RESERVATION" if selected_slot is not None else "SELECT A TIME"
    _button(image, (24, 660, 408, 730), label, selected=selected_slot is not None, disabled=selected_slot is None, font_scale=0.55)


def _render_complete(image: np.ndarray) -> None:
    cv2.circle(image, (216, 188), 62, (66, 151, 108), -1, cv2.LINE_AA)
    cv2.line(image, (184, 188), (207, 211), (255, 255, 255), 7, cv2.LINE_AA)
    cv2.line(image, (207, 211), (251, 165), (255, 255, 255), 7, cv2.LINE_AA)
    _text(image, "RESERVATION CONFIRMED", (66, 292), 0.66, (35, 32, 29), thickness=2)
    _text(image, "Study room A", (138, 350), 0.58, (92, 83, 72))
    _text(image, "Monday, Sep 28  |  09:00", (93, 386), 0.46, (117, 108, 96))
    _button(image, (24, 620, 408, 694), "BACK TO RESERVATIONS", selected=True, font_scale=0.54)


def _bottom_nav(image: np.ndarray, selected: str) -> None:
    _rect(image, (0, 700), (WIDTH, HEIGHT), (255, 255, 255))
    for x, label in ((72, "NEWS"), (216, "BOOK"), (360, "ME")):
        color = (50, 105, 190) if label == selected else (126, 119, 109)
        _text(image, label, (x - 25, 742), 0.4, color, thickness=2 if label == selected else 1)


def _title(image: np.ndarray, value: str, y: int, *, x: int = 24) -> None:
    _text(image, value, (x, y + 36), 0.72, (35, 32, 29), thickness=2)


def _card(image: np.ndarray, bounds: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = bounds
    _rect(image, (left + 3, top + 4), (right + 3, bottom + 4), (222, 218, 210))
    _rect(image, (left, top), (right, bottom), (255, 255, 255))


def _button(
    image: np.ndarray,
    bounds: tuple[int, int, int, int],
    label: str,
    *,
    selected: bool = False,
    outline: bool = False,
    disabled: bool = False,
    font_scale: float = 0.5,
) -> None:
    left, top, right, bottom = bounds
    if disabled:
        background, foreground = (219, 216, 210), (145, 139, 130)
    elif selected:
        background, foreground = (190, 105, 50), (255, 255, 255)
    else:
        background, foreground = (255, 255, 255), (62, 57, 52)
    _rect(image, (left, top), (right, bottom), background)
    if outline:
        cv2.rectangle(image, (left, top), (right, bottom), (196, 187, 175), 1, cv2.LINE_AA)
    size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)[0]
    x = left + max(4, (right - left - size[0]) // 2)
    y = top + (bottom - top + size[1]) // 2
    _text(image, label, (x, y), font_scale, foreground, thickness=1)


def _text(
    image: np.ndarray,
    value: str,
    origin: tuple[int, int],
    scale: float,
    color: tuple[int, int, int],
    *,
    thickness: int = 1,
) -> None:
    cv2.putText(image, value, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)


def _rect(
    image: np.ndarray,
    top_left: tuple[int, int],
    bottom_right: tuple[int, int],
    color: tuple[int, int, int],
) -> None:
    cv2.rectangle(image, top_left, bottom_right, color, -1, cv2.LINE_AA)


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
    uvicorn.run(create_app(token=args.token), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
