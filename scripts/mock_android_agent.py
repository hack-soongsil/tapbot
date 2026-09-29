"""Local three-screen Android Agent mock for dashboard development.

The detail screen intentionally mirrors the SSUTODAY study-room reservation
flow closely enough for both visual and semantic automation tests.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterator
from datetime import datetime, timezone
from functools import lru_cache
import os
from pathlib import Path
from threading import RLock
import time
from typing import Annotated, Any
from uuid import uuid4

import cv2
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response, StreamingResponse
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pydantic import BaseModel
import uvicorn


WIDTH = 432
HEIGHT = 768
PACKAGE_NAME = "com.tapbot.mock"
DEFAULT_TOKEN = "tapbot-local-mock"
DATES: tuple[dict[str, str], ...] = (
    {"top": "일", "bottom": "27", "full_date": "2026-09-27", "label": "2026년 9월 27일(일)"},
    {"top": "월", "bottom": "28", "full_date": "2026-09-28", "label": "2026년 9월 28일(월)"},
    {"top": "화", "bottom": "29", "full_date": "2026-09-29", "label": "2026년 9월 29일(화)"},
    {"top": "수", "bottom": "30", "full_date": "2026-09-30", "label": "2026년 9월 30일(수)"},
    {"top": "10월", "bottom": "1", "full_date": "2026-10-01", "label": "2026년 10월 1일(목)"},
)
ROOMS: tuple[dict[str, str], ...] = (
    {"id": "room_2a", "name": "스터디룸 2A", "capacity": "10인실", "location": "2층 교수연구실 옆", "status": "보통"},
    {"id": "room_2b", "name": "스터디룸 2B", "capacity": "10인실", "location": "2층 중앙", "status": "여유"},
    {"id": "room_2c", "name": "스터디룸 2C", "capacity": "10인실", "location": "2층 중앙계단 옆", "status": "여유"},
)
DEFAULT_DATE_INDEX = 2
DEFAULT_ROOM_INDEX = 2
SLOT_TIMES = (
    "08:00", "08:30", "09:00", "09:30",
    "10:00", "10:30", "11:00", "11:30",
)
RESERVED_SLOTS = frozenset({4, 5})
SUBMIT_DELAY_SECONDS = 0.4
DETAIL_MAX_SCROLL = 230
LIST_MAX_SCROLL = 330


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
        self._selected_date_index = DEFAULT_DATE_INDEX
        self._selected_room_index = DEFAULT_ROOM_INDEX
        self._list_scroll = 0
        self._selected_slot: int | None = None
        self._detail_scroll = 0
        self._submission_deadline: float | None = None
        self._frame_id = 0

    @property
    def screen(self) -> str:
        with self._lock:
            self._advance_submission()
            return self._screen

    def tap(self, x: float, y: float) -> None:
        with self._lock:
            self._advance_submission()
            if self._screen == "home":
                if y >= 700:
                    return
                world_y = y + self._list_scroll
                date_index = _date_chip_at(x, world_y)
                if date_index is not None:
                    self._selected_date_index = date_index
                    return
                room_index = _room_card_at(x, world_y)
                if room_index is not None:
                    self._selected_room_index = room_index
                    self._screen = "detail"
                    self._selected_slot = None
                    self._detail_scroll = 0
                return

            if self._screen == "detail":
                world_y = y + self._detail_scroll
                if x <= 82 and 36 <= world_y <= 102:
                    self._screen = "home"
                    self._selected_slot = None
                    self._submission_deadline = None
                    return
                if 312 <= x <= 414 and 502 <= world_y <= 552:
                    self._selected_slot = None
                    return
                slot = _slot_at(x, world_y)
                if slot is not None:
                    if slot not in RESERVED_SLOTS:
                        self._selected_slot = slot
                    return
                if (
                    688 <= y <= 752
                    and self._selected_slot is not None
                    and self._submission_deadline is None
                ):
                    self._submission_deadline = time.monotonic() + SUBMIT_DELAY_SECONDS
                return

            if self._screen == "complete" and 600 <= y <= 710:
                self._screen = "home"
                self._selected_slot = None

    def back(self) -> None:
        with self._lock:
            self._advance_submission()
            if self._screen == "complete":
                self._screen = "detail"
            elif self._screen == "detail":
                self._screen = "home"
                self._selected_slot = None
                self._submission_deadline = None

    def home(self) -> None:
        with self._lock:
            self._screen = "home"
            self._selected_slot = None
            self._list_scroll = 0
            self._detail_scroll = 0
            self._submission_deadline = None

    def swipe(self, x1: float, y1: float, x2: float, y2: float) -> None:
        del x1, x2
        with self._lock:
            self._advance_submission()
            delta = int(y1 - y2)
            if self._screen == "detail":
                self._detail_scroll = max(
                    0,
                    min(DETAIL_MAX_SCROLL, self._detail_scroll + delta),
                )
            elif self._screen == "home":
                self._list_scroll = max(
                    0,
                    min(LIST_MAX_SCROLL, self._list_scroll + delta),
                )

    def _advance_submission(self) -> None:
        if (
            self._screen == "detail"
            and self._submission_deadline is not None
            and time.monotonic() >= self._submission_deadline
        ):
            self._screen = "complete"
            self._submission_deadline = None

    def jpeg(self) -> tuple[bytes, int, str]:
        with self._lock:
            self._advance_submission()
            self._frame_id += 1
            frame_id = self._frame_id
            screen = self._screen
            selected_slot = self._selected_slot
            selected_date_index = self._selected_date_index
            selected_room_index = self._selected_room_index
            list_scroll = self._list_scroll
            detail_scroll = self._detail_scroll
            submitting = self._submission_deadline is not None
        image = _render(
            screen,
            selected_slot,
            selected_date_index,
            selected_room_index,
            list_scroll,
            detail_scroll,
            submitting,
        )
        ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            raise RuntimeError("Could not encode the mock Android frame")
        return encoded.tobytes(), frame_id, _now()

    def ui_tree(self) -> dict[str, Any]:
        with self._lock:
            self._advance_submission()
            screen = self._screen
            selected_slot = self._selected_slot
            selected_date_index = self._selected_date_index
            selected_room_index = self._selected_room_index
            list_scroll = self._list_scroll
            detail_scroll = self._detail_scroll
            submitting = self._submission_deadline is not None
        nodes = _screen_nodes(
            screen,
            selected_slot,
            selected_date_index,
            selected_room_index,
            list_scroll,
            detail_scroll,
            submitting,
        )
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
        device.swipe(payload.x1, payload.y1, payload.x2, payload.y2)
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


def _screen_nodes(
    screen: str,
    selected_slot: int | None,
    selected_date_index: int,
    selected_room_index: int,
    list_scroll: int,
    detail_scroll: int,
    submitting: bool,
) -> list[dict[str, Any]]:
    selected_date = DATES[selected_date_index]
    selected_room = ROOMS[selected_room_index]
    if screen == "home":
        def list_bounds(bounds: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
            left, top, right, bottom = bounds
            return left, top - list_scroll, right, bottom - list_scroll

        nodes = [
            _node("list-scroll", bounds=(0, 24, WIDTH, 700), class_name="android.widget.ScrollView", clickable=False, scrollable=True),
            _node("app-icon", description="SSUTODAY 앱 아이콘", bounds=list_bounds((24, 42, 70, 88)), class_name="android.widget.ImageView", clickable=False, visible=_list_visible(list_bounds((24, 42, 70, 88)))),
            _node("header-title", text="스터디룸 예약", bounds=list_bounds((82, 42, 270, 88)), class_name="android.widget.TextView", clickable=False, visible=_list_visible(list_bounds((82, 42, 270, 88)))),
            _node("history-button", description="예약 내역", bounds=list_bounds((358, 42, 408, 92)), visible=_list_visible(list_bounds((358, 42, 408, 92)))),
            _node("hero-headline", text="성준님, 어디서 공부할까요?", bounds=list_bounds((24, 116, 408, 154)), class_name="android.widget.TextView", clickable=False, visible=_list_visible(list_bounds((24, 116, 408, 154)))),
            _node("hero-description", text="실시간으로 빈 시간을 확인하고 바로 예약할 수 있어요", bounds=list_bounds((24, 160, 408, 188)), class_name="android.widget.TextView", clickable=False, visible=_list_visible(list_bounds((24, 160, 408, 188)))),
        ]
        for index, date in enumerate(DATES):
            left = 24 + index * 78
            bounds = list_bounds((left, 206, left + 68, 276))
            nodes.append(_node(
                f"date-chip-{index}",
                text=f"{date['top']} {date['bottom']}",
                bounds=bounds,
                selected=index == selected_date_index,
                visible=_list_visible(bounds),
                metadata={
                    "index": index,
                    "day_label": date["top"],
                    "day_number": date["bottom"],
                    "is_selected": index == selected_date_index,
                    "full_date": date["full_date"],
                },
            ))
        date_bounds = list_bounds((44, 294, 272, 332))
        live_bounds = list_bounds((322, 294, 408, 332))
        nodes.extend((
            _node("selected-date", text=selected_date["label"], bounds=date_bounds, visible=_list_visible(date_bounds)),
            _node("live-status", text="실시간 현황", bounds=live_bounds, class_name="android.widget.TextView", clickable=False, visible=_list_visible(live_bounds)),
        ))
        for index, room in enumerate(ROOMS):
            top = 350 + index * 218
            card_bounds = list_bounds((24, top, 408, top + 200))
            room_metadata = {
                "index": index,
                "room_id": room["id"],
                "room_name": room["name"],
                "status": room["status"],
                "capacity": room["capacity"],
                "location": room["location"],
            }
            nodes.extend((
                _node(
                    f"room-card-{index}",
                    description="|".join((room["name"], room["capacity"], room["location"], room["status"])),
                    bounds=card_bounds,
                    visible=_list_visible(card_bounds),
                    metadata=room_metadata,
                ),
                _node(f"room-card-{index}-thumbnail", description=f"{room['name']} 사진", bounds=list_bounds((38, top + 18, 116, top + 94)), class_name="android.widget.ImageView", clickable=False, visible=_list_visible(list_bounds((38, top + 18, 116, top + 94)))),
                _node(f"room-card-{index}-capacity", text=room["capacity"], bounds=list_bounds((130, top + 18, 194, top + 46)), class_name="android.widget.TextView", clickable=False, visible=_list_visible(list_bounds((130, top + 18, 194, top + 46)))),
                _node(f"room-card-{index}-location", text=room["location"], bounds=list_bounds((200, top + 18, 330, top + 46)), class_name="android.widget.TextView", clickable=False, visible=_list_visible(list_bounds((200, top + 18, 330, top + 46)))),
                _node(f"room-card-{index}-status", text=room["status"], bounds=list_bounds((338, top + 18, 392, top + 46)), class_name="android.widget.TextView", clickable=False, visible=_list_visible(list_bounds((338, top + 18, 392, top + 46)))),
                _node(f"room-card-{index}-name", text=room["name"], bounds=list_bounds((130, top + 58, 330, top + 92)), class_name="android.widget.TextView", clickable=False, visible=_list_visible(list_bounds((130, top + 58, 330, top + 92)))),
                _node(f"room-card-{index}-availability", description=f"{room['name']} 시간대별 예약 현황", bounds=list_bounds((38, top + 116, 394, top + 174)), class_name="android.view.View", clickable=False, visible=_list_visible(list_bounds((38, top + 116, 394, top + 174)))),
            ))
        nodes.extend((
            _node("bottom-home", text="Home", description="홈", bounds=(0, 700, 144, 768)),
            _node("bottom-booking", text="Booking", description="예약", bounds=(144, 700, 288, 768), selected=True),
            _node("bottom-me", text="Me", description="마이", bounds=(288, 700, 432, 768)),
        ))
        return nodes

    if screen == "detail":
        offset = detail_scroll

        def detail_bounds(bounds: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
            left, top, right, bottom = bounds
            return left, top - offset, right, bottom - offset

        nodes = [
            _node("detail-scroll", bounds=(0, 24, WIDTH, 768), class_name="android.widget.ScrollView", clickable=False, scrollable=True),
            _node("room-hero-image", description="스터디룸 내부 사진", bounds=detail_bounds((0, 24, WIDTH, 242)), class_name="android.widget.ImageView", clickable=False, visible=_visible(detail_bounds((0, 24, WIDTH, 242)))),
            _node("back-button", bounds=detail_bounds((16, 42, 68, 94)), visible=_visible(detail_bounds((16, 42, 68, 94)))),
            _node("room-name", text=selected_room["name"], bounds=detail_bounds((24, 184, 360, 232)), class_name="android.widget.TextView", clickable=False, visible=_visible(detail_bounds((24, 184, 360, 232)))),
            _node("feature-0", text="콘센트 6구", bounds=detail_bounds((24, 254, 119, 286)), class_name="android.widget.TextView", clickable=False, visible=_visible(detail_bounds((24, 254, 119, 286)))),
            _node("feature-1", text="칠판", bounds=detail_bounds((128, 254, 188, 286)), class_name="android.widget.TextView", clickable=False, visible=_visible(detail_bounds((128, 254, 188, 286)))),
            _node("selected-date", text=selected_date["label"], bounds=detail_bounds((44, 300, 250, 334)), visible=_visible(detail_bounds((44, 300, 250, 334)))),
            _node("live-status", text="실시간", bounds=detail_bounds((338, 300, 408, 334)), class_name="android.widget.TextView", clickable=False, visible=_visible(detail_bounds((338, 300, 408, 334)))),
            _node(
                "slot-guidance",
                text="한 칸은 30분입니다. 예약된 시간은 선택할 수 없어요",
                bounds=detail_bounds((24, 344, 408, 376)),
                class_name="android.widget.TextView",
                clickable=False,
                visible=_visible(detail_bounds((24, 344, 408, 376))),
            ),
            _node("current-time-marker", bounds=detail_bounds((118, 386, 122, 450)), class_name="android.view.View", clickable=False, visible=_visible(detail_bounds((118, 386, 122, 450)))),
        ]
        for index, slot_time in enumerate(SLOT_TIMES):
            left = 24 + index * 48
            bounds = detail_bounds((left, 394, left + 43, 442))
            state = (
                "reserved" if index in RESERVED_SLOTS
                else "selected" if index == selected_slot
                else "available"
            )
            nodes.append(
                _node(
                    f"slot-{index}",
                    bounds=bounds,
                    text="",
                    enabled=index not in RESERVED_SLOTS,
                    selected=index == selected_slot,
                    visible=_visible(bounds),
                    metadata={
                        "index": index,
                        "time": slot_time,
                        "state": state,
                        "enabled": index not in RESERVED_SLOTS,
                        "selected": index == selected_slot,
                        "visible": _visible(bounds),
                    },
                )
            )
        for index, label in enumerate(("08:00", "09:00", "10:00", "11:00")):
            bounds = detail_bounds((24 + index * 96, 448, 80 + index * 96, 470))
            nodes.append(_node(f"time-axis-{index}", text=label, bounds=bounds, class_name="android.widget.TextView", clickable=False, visible=_visible(bounds)))
        summary = (
            f"{SLOT_TIMES[selected_slot]} - {_slot_end_time(selected_slot)}"
            if selected_slot is not None
            else "시간대를 선택하세요"
        )
        nodes.extend((
            _node("legend-reserved", text="예약됨", bounds=detail_bounds((24, 474, 98, 498)), class_name="android.widget.TextView", clickable=False, visible=_visible(detail_bounds((24, 474, 98, 498)))),
            _node("legend-available", text="빈 시간", bounds=detail_bounds((120, 474, 202, 498)), class_name="android.widget.TextView", clickable=False, visible=_visible(detail_bounds((120, 474, 202, 498)))),
            _node("legend-selected", text="선택", bounds=detail_bounds((226, 474, 292, 498)), class_name="android.widget.TextView", clickable=False, visible=_visible(detail_bounds((226, 474, 292, 498)))),
            _node("selection-label", text="시간 선택", bounds=detail_bounds((36, 512, 130, 532)), class_name="android.widget.TextView", clickable=False, visible=_visible(detail_bounds((36, 512, 130, 532)))),
            _node("selection-summary", text=summary, bounds=detail_bounds((36, 534, 304, 570)), class_name="android.widget.TextView", clickable=False, visible=_visible(detail_bounds((36, 534, 304, 570))), metadata={"selected_slot_index": selected_slot, "selected_time": None if selected_slot is None else SLOT_TIMES[selected_slot]}),
            _node("reset-selection", text="초기화", bounds=detail_bounds((312, 514, 408, 566)), visible=_visible(detail_bounds((312, 514, 408, 566)))),
            _node("usage-rules-title", text="이용 규칙", bounds=detail_bounds((24, 604, 180, 636)), class_name="android.widget.TextView", clickable=False, visible=_visible(detail_bounds((24, 604, 180, 636)))),
            _node("usage-rules", text="스터디룸 이용 인원은 최소 3명이에요\n교수연구실 옆에서는 소음에 유의해 주세요\n타 학부 학생과 함께 이용할 수 없어요", bounds=detail_bounds((24, 644, 408, 788)), class_name="android.widget.TextView", clickable=False, visible=_visible(detail_bounds((24, 644, 408, 788)))),
        ))
        if submitting:
            cta_text, cta_state, cta_enabled = "예약 처리 중", "SUBMITTING", False
        elif selected_slot is not None:
            cta_text, cta_state, cta_enabled = "이 시간으로 예약하기", "SELECTED", True
        else:
            cta_text, cta_state, cta_enabled = "시간을 선택하세요", "NO_SELECTION", False
        nodes.append(
            _node(
                "reserve-cta",
                text=cta_text,
                bounds=(24, 688, 408, 752),
                enabled=cta_enabled,
                metadata={
                    "state": cta_state,
                    "enabled": cta_enabled,
                    "selected_slot_index": selected_slot,
                    "selected_time": None if selected_slot is None else SLOT_TIMES[selected_slot],
                },
            )
        )
        return nodes

    selected_time = SLOT_TIMES[selected_slot] if selected_slot is not None else "--:--"
    return [
        _node("complete-title", text="예약이 완료되었습니다", bounds=(48, 250, 384, 310), class_name="android.widget.TextView"),
        _node("complete-detail", text=f"{selected_room['name']} · {selected_date['full_date']} · {selected_time}", bounds=(44, 332, 388, 382), class_name="android.widget.TextView"),
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
    clickable: bool | None = None,
    scrollable: bool = False,
    visible: bool = True,
    metadata: dict[str, Any] | None = None,
    children: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    children = children or []
    is_clickable = class_name == "android.widget.Button" if clickable is None else clickable
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
        "clickable": is_clickable,
        "enabled": enabled,
        "focusable": is_clickable,
        "focused": False,
        "selected": selected,
        "checked": False,
        "checkable": False,
        "scrollable": scrollable,
        "editable": False,
        "visible_to_user": visible,
        "password": False,
        "child_count": len(children),
        "metadata": metadata or {},
        "children": children,
    }


def _without_children(node: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in node.items() if key != "children"}


def _slot_at(x: float, y: float) -> int | None:
    for index in range(8):
        left = 24 + index * 48
        if left <= x <= left + 43 and 394 <= y <= 442:
            return index
    return None


def _date_chip_at(x: float, y: float) -> int | None:
    for index in range(len(DATES)):
        left = 24 + index * 78
        if left <= x <= left + 68 and 206 <= y <= 276:
            return index
    return None


def _room_card_at(x: float, y: float) -> int | None:
    if not 24 <= x <= 408:
        return None
    for index in range(len(ROOMS)):
        top = 350 + index * 218
        if top <= y <= top + 200:
            return index
    return None


def _slot_end_time(index: int) -> str:
    hour, minute = (int(part) for part in SLOT_TIMES[index].split(":"))
    minute += 30
    if minute == 60:
        hour += 1
        minute = 0
    return f"{hour:02d}:{minute:02d}"


def _visible(bounds: tuple[int, int, int, int]) -> bool:
    _, top, _, bottom = bounds
    return bottom > 24 and top < 688


def _list_visible(bounds: tuple[int, int, int, int]) -> bool:
    _, top, _, bottom = bounds
    return bottom > 24 and top < 700


def _render(
    screen: str,
    selected_slot: int | None,
    selected_date_index: int,
    selected_room_index: int,
    list_scroll: int,
    detail_scroll: int,
    submitting: bool,
) -> np.ndarray:
    image = np.full((HEIGHT, WIDTH, 3), (250, 250, 250), dtype=np.uint8)
    _rect(image, (0, 0), (WIDTH, 24), (25, 25, 28))
    cv2.putText(image, "09:41", (18, 17), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (245, 245, 245), 1, cv2.LINE_AA)
    if screen == "home":
        _render_home(image, selected_date_index, list_scroll)
    elif screen == "detail":
        _render_detail(
            image,
            selected_slot,
            selected_date_index,
            selected_room_index,
            detail_scroll,
            submitting,
        )
    else:
        _render_complete(
            image,
            selected_slot,
            selected_date_index,
            selected_room_index,
        )
    return image


def _render_home(
    image: np.ndarray,
    selected_date_index: int,
    scroll: int,
) -> None:
    selected_date = DATES[selected_date_index]
    canvas = np.full((1020, WIDTH, 3), (249, 249, 251), dtype=np.uint8)

    _rounded_rect(canvas, (24, 18, 70, 64), (150, 80, 240), radius=13)
    _text(canvas, "S", (39, 51), 0.72, (255, 255, 255), thickness=2)
    _rounded_rect(canvas, (358, 18, 408, 68), (238, 237, 241), radius=15)
    cv2.circle(canvas, (383, 43), 10, (113, 107, 121), 2, cv2.LINE_AA)
    cv2.line(canvas, (383, 43), (383, 35), (113, 107, 121), 2, cv2.LINE_AA)
    cv2.line(canvas, (383, 43), (390, 47), (113, 107, 121), 2, cv2.LINE_AA)

    for index, date in enumerate(DATES):
        left = 24 + index * 78
        color = (235, 93, 119) if index == selected_date_index else (239, 238, 242)
        _rounded_rect(canvas, (left, 182, left + 68, 252), color, radius=18)

    cv2.circle(canvas, (326, 288), 4, (118, 74, 239), -1, cv2.LINE_AA)
    cv2.line(canvas, (268, 282), (273, 287), (91, 85, 101), 1, cv2.LINE_AA)
    cv2.line(canvas, (273, 287), (278, 282), (91, 85, 101), 1, cv2.LINE_AA)

    for index, room in enumerate(ROOMS):
        _render_room_list_card(canvas, index, room)

    labels: list[tuple[str, tuple[int, int], int, tuple[int, int, int], bool]] = [
        ("스터디룸 예약", (82, 27), 21, (36, 34, 44), True),
        ("성준님, 어디서 공부할까요?", (24, 92), 25, (35, 33, 43), True),
        ("실시간으로 빈 시간을 확인하고 바로 예약할 수 있어요", (24, 136), 13, (115, 110, 124), False),
        (selected_date["label"], (44, 276), 14, (46, 44, 54), True),
        ("실시간 현황", (338, 278), 11, (91, 85, 101), False),
    ]
    for index, date in enumerate(DATES):
        left = 24 + index * 78
        color = (255, 255, 255) if index == selected_date_index else (92, 87, 101)
        labels.extend((
            (date["top"], (left + 23, 191), 11, color, False),
            (date["bottom"], (left + 22, 214), 22, color, True),
        ))
    _draw_unicode_labels(canvas, tuple(labels))

    visible = canvas[scroll:scroll + 676]
    image[24:700] = visible
    _render_list_bottom_nav(image)


def _render_detail(
    image: np.ndarray,
    selected_slot: int | None,
    selected_date_index: int,
    selected_room_index: int,
    scroll: int,
    submitting: bool,
) -> None:
    selected_date = DATES[selected_date_index]
    selected_room = ROOMS[selected_room_index]
    canvas = np.full((930, WIDTH, 3), (255, 255, 255), dtype=np.uint8)
    _render_room_photo(canvas, (0, 0, WIDTH, 218))
    # Back button and hero title.
    cv2.rectangle(canvas, (16, 18), (68, 70), (255, 255, 255), -1, cv2.LINE_AA)
    _text(canvas, "<", (33, 55), 0.8, (45, 42, 52), thickness=2)

    _pill(canvas, (24, 230, 119, 262), "")
    _pill(canvas, (128, 230, 188, 262), "")
    cv2.circle(canvas, (338, 294), 4, (118, 74, 239), -1, cv2.LINE_AA)

    for index in range(8):
        left = 24 + index * 48
        bounds = (left, 370, left + 43, 418)
        if index in RESERVED_SLOTS:
            _striped_slot(canvas, bounds)
        elif index == selected_slot:
            _gradient_slot(canvas, bounds)
        else:
            _rounded_rect(canvas, bounds, (238, 237, 241), radius=8)
    marker_x = 24 + 2 * 48
    cv2.line(canvas, (marker_x, 362), (marker_x, 425), (122, 72, 246), 2, cv2.LINE_AA)
    cv2.circle(canvas, (marker_x, 362), 4, (122, 72, 246), -1, cv2.LINE_AA)
    for index, label in enumerate(("08:00", "09:00", "10:00", "11:00")):
        _text(canvas, label, (22 + index * 96, 444), 0.34, (102, 97, 110))

    for x, color, label in (
        (24, (239, 210, 224), ""),
        (130, (238, 237, 241), ""),
        (246, (122, 72, 246), ""),
    ):
        _rounded_rect(canvas, (x, 456, x + 14, 470), color, radius=3)

    _rounded_rect(canvas, (24, 486, 408, 552), (249, 245, 255), radius=12)
    summary = (
        f"{SLOT_TIMES[selected_slot]} - {_slot_end_time(selected_slot)}"
        if selected_slot is not None else "시간대를 선택하세요"
    )
    _draw_unicode_labels(canvas, (
        (selected_room["name"], (24, 168), 28, (255, 255, 255), True),
        ("콘센트 6구", (42, 239), 11, (76, 73, 83), False),
        ("칠판", (146, 239), 11, (76, 73, 83), False),
        (selected_date["label"], (44, 278), 14, (50, 49, 60), True),
        ("실시간", (350, 284), 11, (81, 75, 91), False),
        ("한 칸은 30분입니다. 예약된 시간은 선택할 수 없어요", (24, 316), 11, (120, 115, 128), False),
        ("예약됨", (43, 454), 9, (92, 87, 101), False),
        ("빈 시간", (149, 454), 9, (92, 87, 101), False),
        ("선택", (265, 454), 9, (92, 87, 101), False),
        ("시간 선택", (36, 492), 11, (122, 72, 246), True),
        (summary, (36, 516), 20, (43, 41, 51), True),
        ("초기화", (346, 510), 11, (93, 78, 174), True),
        ("이용 규칙", (24, 580), 18, (42, 119, 232), True),
        ("• 스터디룸 이용 인원은 최소 3명이에요", (32, 622), 11, (79, 75, 85), False),
        ("• 교수연구실 옆에서는 소음에 유의해 주세요", (32, 652), 11, (79, 75, 85), False),
        ("• 타 학부 학생과 함께 이용할 수 없어요", (32, 682), 11, (79, 75, 85), False),
    ))

    visible = canvas[scroll:scroll + HEIGHT - 24]
    image[24:24 + visible.shape[0]] = visible
    _rect(image, (0, 680), (WIDTH, HEIGHT), (255, 255, 255))
    if submitting:
        label, disabled = "예약 처리 중", True
    elif selected_slot is None:
        label, disabled = "시간을 선택하세요", True
    else:
        label, disabled = "이 시간으로 예약하기", False
    _primary_button(image, (24, 688, 408, 752), "", disabled=disabled)
    _draw_centered_unicode(
        image,
        label,
        (24, 688, 408, 752),
        16,
        (143, 139, 151) if disabled else (255, 255, 255),
        bold=True,
    )


def _render_complete(
    image: np.ndarray,
    selected_slot: int | None,
    selected_date_index: int,
    selected_room_index: int,
) -> None:
    selected_date = DATES[selected_date_index]
    selected_room = ROOMS[selected_room_index]
    cv2.circle(image, (216, 188), 62, (66, 151, 108), -1, cv2.LINE_AA)
    cv2.line(image, (184, 188), (207, 211), (255, 255, 255), 7, cv2.LINE_AA)
    cv2.line(image, (207, 211), (251, 165), (255, 255, 255), 7, cv2.LINE_AA)
    selected_time = SLOT_TIMES[selected_slot] if selected_slot is not None else "--:--"
    _primary_button(image, (24, 620, 408, 694), "", disabled=False)
    _draw_unicode_labels(image, (
        ("예약이 완료되었습니다", (91, 264), 24, (35, 32, 29), True),
        (selected_room["name"], (148, 330), 18, (92, 83, 72), False),
        (f"{selected_date['label']} · {selected_time}", (92, 368), 14, (117, 108, 96), False),
    ))
    _draw_centered_unicode(
        image,
        "예약 화면으로 돌아가기",
        (24, 620, 408, 694),
        16,
        (255, 255, 255),
        bold=True,
    )


def _render_room_list_card(
    canvas: np.ndarray,
    index: int,
    room: dict[str, str],
) -> None:
    top = 326 + index * 218
    _rounded_rect(canvas, (27, top + 3, 411, top + 203), (229, 228, 233), radius=24)
    _rounded_rect(canvas, (24, top, 408, top + 200), (255, 255, 255), radius=24)

    thumbnail_colors = (
        ((210, 205, 199), (115, 133, 153)),
        ((205, 213, 210), (105, 138, 131)),
        ((212, 204, 198), (123, 111, 104)),
    )
    wall, table = thumbnail_colors[index]
    _rounded_rect(canvas, (38, top + 18, 116, top + 94), wall, radius=14)
    cv2.rectangle(canvas, (47, top + 27), (78, top + 59), (231, 234, 231), -1, cv2.LINE_AA)
    cv2.line(canvas, (63, top + 27), (63, top + 59), (151, 155, 157), 1, cv2.LINE_AA)
    cv2.fillConvexPoly(
        canvas,
        np.array([
            [46, top + 68], [105, top + 68],
            [112, top + 83], [40, top + 83],
        ], dtype=np.int32),
        table,
        cv2.LINE_AA,
    )

    _rounded_rect(canvas, (130, top + 18, 194, top + 46), (242, 241, 245), radius=12)
    location_right = 329 if len(room["location"]) > 6 else 274
    _rounded_rect(canvas, (200, top + 18, location_right, top + 46), (242, 241, 245), radius=12)
    status_color = (218, 244, 233) if room["status"] == "여유" else (225, 235, 253)
    _rounded_rect(canvas, (338, top + 18, 392, top + 46), status_color, radius=12)

    reserved_by_room = (
        {3, 4, 8, 9, 10, 14},
        {5, 6, 11},
        {4, 5, 6, 12, 13},
    )
    for slot in range(16):
        left = 38 + slot * 22
        color = (190, 125, 241) if slot in reserved_by_room[index] else (235, 234, 239)
        _rounded_rect(canvas, (left, top + 116, left + 18, top + 140), color, radius=5)
    marker_x = 38 + 6 * 22
    cv2.line(canvas, (marker_x, top + 108), (marker_x, top + 146), (122, 72, 246), 2, cv2.LINE_AA)
    cv2.circle(canvas, (marker_x, top + 108), 3, (122, 72, 246), -1, cv2.LINE_AA)
    for offset, label in ((0, "06:00"), (88, "08:00"), (176, "10:00"), (264, "12:00"), (330, "13:00")):
        _text(canvas, label, (38 + offset, top + 164), 0.25, (119, 114, 127))

    _draw_unicode_labels(canvas, (
        (room["capacity"], (142, top + 25), 10, (91, 86, 100), False),
        (room["location"], (210, top + 25), 10, (91, 86, 100), False),
        (room["status"], (352, top + 25), 10, (65, 117, 91) if room["status"] == "여유" else (164, 91, 43), True),
        (room["name"], (130, top + 59), 20, (40, 38, 47), True),
    ))


def _render_list_bottom_nav(image: np.ndarray) -> None:
    _rect(image, (0, 700), (WIDTH, HEIGHT), (255, 255, 255))
    cv2.line(image, (0, 700), (WIDTH, 700), (232, 231, 235), 1, cv2.LINE_AA)
    _rounded_rect(image, (173, 708, 259, 750), (235, 93, 119), radius=20)
    cv2.circle(image, (72, 721), 8, (135, 130, 142), 2, cv2.LINE_AA)
    cv2.rectangle(image, (350, 713), (370, 731), (135, 130, 142), 2, cv2.LINE_AA)
    _text(image, "H", (67, 728), 0.34, (135, 130, 142), thickness=1)
    cv2.rectangle(image, (184, 719), (198, 732), (255, 255, 255), 1, cv2.LINE_AA)
    cv2.line(image, (184, 723), (198, 723), (255, 255, 255), 1, cv2.LINE_AA)
    _text(image, "Booking", (202, 732), 0.3, (255, 255, 255), thickness=1)
    _text(image, "M", (353, 728), 0.34, (135, 130, 142), thickness=1)
    _text(image, "Home", (55, 758), 0.32, (135, 130, 142))
    _text(image, "Me", (353, 758), 0.32, (135, 130, 142))


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


def _render_room_photo(
    image: np.ndarray,
    bounds: tuple[int, int, int, int],
) -> None:
    """Draw a deterministic photo-like study room without external assets."""

    left, top, right, bottom = bounds
    height = bottom - top
    width = right - left
    for row in range(height):
        blend = row / max(1, height - 1)
        color = tuple(int(a * (1 - blend) + b * blend) for a, b in zip((185, 201, 214), (81, 93, 111), strict=True))
        image[top + row, left:right] = color
    # Window, wall panels, table, chairs and warm pendant lights.
    _rect(image, (36, 26), (170, 138), (203, 218, 225))
    cv2.line(image, (103, 26), (103, 138), (124, 139, 151), 3, cv2.LINE_AA)
    cv2.line(image, (36, 82), (170, 82), (124, 139, 151), 3, cv2.LINE_AA)
    _rect(image, (286, 32), (402, 145), (105, 115, 128))
    for x in (228, 330):
        cv2.line(image, (x, 0), (x, 42), (55, 60, 69), 2, cv2.LINE_AA)
        cv2.circle(image, (x, 47), 11, (96, 205, 255), -1, cv2.LINE_AA)
    points = np.array([[88, 142], [349, 142], [409, 196], [23, 196]], dtype=np.int32)
    cv2.fillConvexPoly(image, points, (117, 153, 181), cv2.LINE_AA)
    cv2.line(image, (73, 194), (58, 218), (53, 61, 72), 5, cv2.LINE_AA)
    cv2.line(image, (363, 194), (381, 218), (53, 61, 72), 5, cv2.LINE_AA)
    for x in (90, 170, 264, 344):
        cv2.ellipse(image, (x, 184), (25, 18), 0, 0, 360, (49, 57, 70), -1, cv2.LINE_AA)
    overlay = np.zeros((height, width, 3), dtype=np.uint8)
    overlay[:] = (31, 25, 38)
    image[top:bottom, left:right] = cv2.addWeighted(image[top:bottom, left:right], 0.78, overlay, 0.22, 0)


def _rounded_rect(
    image: np.ndarray,
    bounds: tuple[int, int, int, int],
    color: tuple[int, int, int],
    *,
    radius: int,
) -> None:
    left, top, right, bottom = bounds
    radius = min(radius, max(1, (right - left) // 2), max(1, (bottom - top) // 2))
    cv2.rectangle(image, (left + radius, top), (right - radius, bottom), color, -1, cv2.LINE_AA)
    cv2.rectangle(image, (left, top + radius), (right, bottom - radius), color, -1, cv2.LINE_AA)
    for center in ((left + radius, top + radius), (right - radius, top + radius), (left + radius, bottom - radius), (right - radius, bottom - radius)):
        cv2.circle(image, center, radius, color, -1, cv2.LINE_AA)


def _pill(
    image: np.ndarray,
    bounds: tuple[int, int, int, int],
    label: str,
    *,
    font_scale: float = 0.28,
) -> None:
    _rounded_rect(image, bounds, (242, 242, 245), radius=14)
    left, top, right, bottom = bounds
    size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, 1)[0]
    _text(image, label, (left + (right - left - size[0]) // 2, top + (bottom - top + size[1]) // 2), font_scale, (76, 73, 83))


def _gradient_slot(image: np.ndarray, bounds: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = bounds
    for x in range(left, right + 1):
        ratio = (x - left) / max(1, right - left)
        color = tuple(int(a * (1 - ratio) + b * ratio) for a, b in zip((192, 86, 222), (125, 78, 245), strict=True))
        cv2.line(image, (x, top), (x, bottom), color, 1, cv2.LINE_AA)


def _striped_slot(image: np.ndarray, bounds: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = bounds
    _rounded_rect(image, bounds, (244, 220, 231), radius=8)
    region = image[top:bottom + 1, left:right + 1]
    height, width = region.shape[:2]
    for start in range(-height, width + height, 9):
        cv2.line(region, (start, height), (start + height, 0), (220, 151, 182), 1, cv2.LINE_AA)
    cv2.rectangle(image, (left, top), (right, bottom), (224, 164, 192), 1, cv2.LINE_AA)


def _primary_button(
    image: np.ndarray,
    bounds: tuple[int, int, int, int],
    label: str,
    *,
    disabled: bool,
) -> None:
    background = (228, 226, 232) if disabled else (132, 76, 241)
    foreground = (143, 139, 151) if disabled else (255, 255, 255)
    _rounded_rect(image, bounds, background, radius=16)
    left, top, right, bottom = bounds
    scale = 0.47
    size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, scale, 1)[0]
    _text(image, label, (left + (right - left - size[0]) // 2, top + (bottom - top + size[1]) // 2), scale, foreground, thickness=2)


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


@lru_cache(maxsize=32)
def _unicode_font(size: int, bold: bool) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    windows_fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    candidates = (
        windows_fonts / ("malgunbd.ttf" if bold else "malgun.ttf"),
        Path("/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf" if bold else "/usr/share/fonts/truetype/nanum/NanumGothic.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    )
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def _draw_unicode_labels(
    image: np.ndarray,
    labels: tuple[tuple[str, tuple[int, int], int, tuple[int, int, int], bool], ...],
) -> None:
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    pil_image = Image.fromarray(rgb)
    draw = ImageDraw.Draw(pil_image)
    for value, origin, size, bgr_color, bold in labels:
        draw.text(
            origin,
            value,
            font=_unicode_font(size, bold),
            fill=tuple(reversed(bgr_color)),
        )
    image[:] = cv2.cvtColor(np.asarray(pil_image), cv2.COLOR_RGB2BGR)


def _draw_centered_unicode(
    image: np.ndarray,
    value: str,
    bounds: tuple[int, int, int, int],
    size: int,
    color: tuple[int, int, int],
    *,
    bold: bool,
) -> None:
    font = _unicode_font(size, bold)
    scratch = Image.new("RGB", (1, 1))
    text_bounds = ImageDraw.Draw(scratch).textbbox((0, 0), value, font=font)
    width = text_bounds[2] - text_bounds[0]
    height = text_bounds[3] - text_bounds[1]
    left, top, right, bottom = bounds
    origin = (
        left + (right - left - width) // 2,
        top + (bottom - top - height) // 2 - text_bounds[1],
    )
    _draw_unicode_labels(image, ((value, origin, size, color, bold),))


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
