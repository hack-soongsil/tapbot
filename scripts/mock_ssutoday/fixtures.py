"""Deterministic SSUTODAY fixture data derived from the captured app."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TypedDict


FALLBACK_LOGICAL_SIZE = (1080, 2280)
PACKAGE_NAME = "com.ssutoday"


def _fixture_logical_size() -> tuple[int, int]:
    """Use the checked-in UI Tree dimensions as the mock coordinate contract.

    The supplied PNG/JPEG captures use encoder-specific physical dimensions,
    while both Android UI Tree fixtures report a 1080x2280 logical display.
    Screenshot regression tests normalize capture pixels into this coordinate
    space before comparison.
    """

    fixture_dir = Path(__file__).resolve().parents[2] / "ssutoday"
    fixture_paths = (
        fixture_dir / "main.json",
        fixture_dir / "reservation.json",
    )
    if not all(path.is_file() for path in fixture_paths):
        return FALLBACK_LOGICAL_SIZE

    sizes: set[tuple[int, int]] = set()
    for path in fixture_paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        sizes.add((int(payload["screen_width"]), int(payload["screen_height"])))
    if len(sizes) != 1:
        raise RuntimeError(f"SSUTODAY UI Tree fixture sizes disagree: {sorted(sizes)}")
    return sizes.pop()


WIDTH, HEIGHT = _fixture_logical_size()


class DateFixture(TypedDict):
    top: str
    bottom: str
    full_date: str
    label: str


class RoomFixture(TypedDict):
    id: str
    name: str
    capacity: str
    location: str
    status: str
    amenities: tuple[str, ...]


DATES: tuple[DateFixture, ...] = (
    {"top": "일", "bottom": "27", "full_date": "2026-09-27", "label": "2026년 9월 27일(일)"},
    {"top": "월", "bottom": "28", "full_date": "2026-09-28", "label": "2026년 9월 28일(월)"},
    {"top": "화", "bottom": "29", "full_date": "2026-09-29", "label": "2026년 9월 29일(화)"},
    {"top": "수", "bottom": "30", "full_date": "2026-09-30", "label": "2026년 9월 30일(수)"},
    {"top": "10월", "bottom": "1", "full_date": "2026-10-01", "label": "2026년 10월 1일(목)"},
)

ROOMS: tuple[RoomFixture, ...] = (
    {
        "id": "room_2a",
        "name": "스터디룸 2A",
        "capacity": "10인실",
        "location": "2층 교수연구실 옆",
        "status": "보통",
        "amenities": ("콘센트 6구", "칠판"),
    },
    {
        "id": "room_2b",
        "name": "스터디룸 2B",
        "capacity": "10인실",
        "location": "2층 중앙",
        "status": "여유",
        "amenities": ("콘센트 6구", "칠판"),
    },
    {
        "id": "room_2c",
        "name": "스터디룸 2C",
        "capacity": "10인실",
        "location": "2층 중앙계단 옆",
        "status": "여유",
        "amenities": ("콘센트 6구", "칠판"),
    },
)

DEFAULT_DATE_INDEX = 2
DEFAULT_ROOM_INDEX = 2
START_HOUR = 6
END_HOUR = 22
SLOT_MINUTES = 30
SLOT_COUNT = (END_HOUR - START_HOUR) * 60 // SLOT_MINUTES
SLOT_TIMES = tuple(
    f"{minutes // 60:02d}:{minutes % 60:02d}"
    for minutes in (
        START_HOUR * 60 + index * SLOT_MINUTES for index in range(SLOT_COUNT)
    )
)
HOUR_TICKS = tuple(f"{hour:02d}:00" for hour in range(START_HOUR, END_HOUR))

# Captured at roughly 09:30. Keeping the clock fixed makes screenshots and
# semantic states stable across test runs.
CURRENT_SLOT = 7
CURRENT_MINUTE_FRACTION = 0.0

BOOKED_SLOTS_BY_ROOM: tuple[frozenset[int], ...] = (
    frozenset({14, 15}),
    frozenset({12, 13, 14}),
    frozenset({8, 9, 18, 19, 24}),
)
MINE_SLOTS_BY_ROOM: tuple[frozenset[int], ...] = (
    frozenset(),
    frozenset({24, 25}),
    frozenset({28, 29}),
)

USAGE_RULES = (
    "스터디룸 이용 인원은 최소 3명이에요",
    "교수연구실 옆에 위치한 스터디룸에서는 소음에 각별히 유의하여 주세요",
    "스터디룸을 타 학부 학생과 함께 이용하는 행위는 금지되어 있어요",
    "예약 취소는 이용 시작 전에만 가능해요",
    "예약한 시간에 스터디룸 이용이 불가능하다면, 이용 시작 전에 예약을 취소해주세요",
    "이용 종료 시각 전에 퇴실하실 경우, 예약 내역에서 해당 예약을 이용 종료 처리해주세요",
    "스터디룸 이용이 종료되기 5분 전부터 자리를 정리하고 퇴실을 준비해주세요",
    "예약자 본인은 예약하신 시간에 스터디룸에 재실해야 해요",
    "이용 규칙을 지키지 않으실 경우, 예약이 취소될 수 있으며 추후 예약 시 불이익이 있을 수 있어요",
    "예약을 진행하는 것은 위 이용 규칙의 모든 내용에 동의하는 것으로 간주돼요",
)


def slot_end_time(index: int) -> str:
    total = START_HOUR * 60 + (index + 1) * SLOT_MINUTES
    return f"{total // 60:02d}:{total % 60:02d}"


def slot_state(
    room_index: int,
    date_index: int,
    slot_index: int,
    selection: tuple[int, int] | None,
) -> str:
    if selection is not None and selection[0] <= slot_index <= selection[1]:
        return "selected"
    if slot_index in MINE_SLOTS_BY_ROOM[room_index]:
        return "mine"
    if slot_index in BOOKED_SLOTS_BY_ROOM[room_index]:
        return "booked"
    if date_index == DEFAULT_DATE_INDEX and slot_index < CURRENT_SLOT:
        return "past"
    if date_index == DEFAULT_DATE_INDEX and slot_index == CURRENT_SLOT:
        return "current"
    return "available"
