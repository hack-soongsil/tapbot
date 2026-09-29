"""State machine and coordinate-accurate interactions for the SSUTODAY mock."""

from __future__ import annotations

from dataclasses import dataclass
from threading import RLock
import time

from .fixtures import (
    BOOKED_SLOTS_BY_ROOM,
    DEFAULT_DATE_INDEX,
    DEFAULT_ROOM_INDEX,
    MINE_SLOTS_BY_ROOM,
    ROOMS,
    SLOT_COUNT,
    slot_state,
)
from .layout import (
    BOTTOM_NAV_TOP,
    CONFIRM_CANCEL,
    CONFIRM_SUBMIT,
    DETAIL_BACK,
    DETAIL_CTA,
    DETAIL_DEFAULT_TIME_SCROLL,
    DETAIL_MAX_SCROLL,
    DETAIL_MAX_TIME_SCROLL,
    DETAIL_RESET,
    DETAIL_TIMELINE_VIEW,
    HOME_MAX_SCROLL,
    contains,
    detail_slot_rect,
    home_card_rect,
    home_date_chip_rect,
    translate_y,
)


SUBMIT_DELAY_SECONDS = 0.8
HOME_TIME_TRACK_WIDTH = SLOT_COUNT * 55 - 10
HOME_TIME_VIEW_WIDTH = 870
HOME_MAX_TIME_SCROLL = HOME_TIME_TRACK_WIDTH - HOME_TIME_VIEW_WIDTH


@dataclass(frozen=True, slots=True)
class MockSnapshot:
    screen: str
    selected_date_index: int
    selected_room_index: int
    home_scroll: int
    home_time_scroll: int
    detail_scroll: int
    detail_time_scroll: int
    selection: tuple[int, int] | None
    submitting: bool


class MockSsutodayState:
    def __init__(self) -> None:
        self._lock = RLock()
        self._screen = "home"
        self._selected_date_index = DEFAULT_DATE_INDEX
        self._selected_room_index = DEFAULT_ROOM_INDEX
        self._home_scroll = 0
        self._home_time_scroll = 0
        self._detail_scroll = 0
        self._detail_time_scroll = DETAIL_DEFAULT_TIME_SCROLL
        self._selection: tuple[int, int] | None = None
        self._submission_deadline: float | None = None

    @property
    def screen(self) -> str:
        with self._lock:
            self._advance_submission()
            return self._screen

    def snapshot(self) -> MockSnapshot:
        with self._lock:
            self._advance_submission()
            return MockSnapshot(
                screen=self._screen,
                selected_date_index=self._selected_date_index,
                selected_room_index=self._selected_room_index,
                home_scroll=self._home_scroll,
                home_time_scroll=self._home_time_scroll,
                detail_scroll=self._detail_scroll,
                detail_time_scroll=self._detail_time_scroll,
                selection=self._selection,
                submitting=self._submission_deadline is not None,
            )

    def tap(self, x: float, y: float) -> None:
        with self._lock:
            self._advance_submission()
            if self._screen == "home":
                self._tap_home(x, y)
            elif self._screen == "detail":
                self._tap_detail(x, y)
            elif self._screen == "confirm":
                self._tap_confirm(x, y)
            elif self._screen == "success" and y >= 1780:
                self._screen = "home"
                self._selection = None
                self._home_scroll = 0

    def swipe(self, x1: float, y1: float, x2: float, y2: float) -> None:
        with self._lock:
            self._advance_submission()
            delta_x = int(x1 - x2)
            delta_y = int(y1 - y2)
            horizontal = abs(delta_x) > abs(delta_y)
            if self._screen == "home":
                world_y = y1 + self._home_scroll
                if horizontal and any(
                    home_card_rect(index)[1] + 215 <= world_y <= home_card_rect(index)[1] + 380
                    for index in range(len(ROOMS))
                ):
                    self._home_time_scroll = _clamp(
                        self._home_time_scroll + delta_x, 0, HOME_MAX_TIME_SCROLL
                    )
                elif not horizontal:
                    self._home_scroll = _clamp(
                        self._home_scroll + delta_y, 0, HOME_MAX_SCROLL
                    )
            elif self._screen == "detail":
                world_y = y1 + self._detail_scroll
                if horizontal and DETAIL_TIMELINE_VIEW[1] <= world_y <= DETAIL_TIMELINE_VIEW[3]:
                    self._detail_time_scroll = _clamp(
                        self._detail_time_scroll + delta_x, 0, DETAIL_MAX_TIME_SCROLL
                    )
                elif not horizontal:
                    self._detail_scroll = _clamp(
                        self._detail_scroll + delta_y, 0, DETAIL_MAX_SCROLL
                    )

    def back(self) -> None:
        with self._lock:
            self._advance_submission()
            if self._screen == "success":
                self._screen = "detail"
            elif self._screen == "confirm":
                self._screen = "detail"
            elif self._screen == "detail":
                self._screen = "home"
                self._selection = None
                self._submission_deadline = None

    def home(self) -> None:
        with self._lock:
            self._screen = "home"
            self._selection = None
            self._home_scroll = 0
            self._home_time_scroll = 0
            self._detail_scroll = 0
            self._detail_time_scroll = DETAIL_DEFAULT_TIME_SCROLL
            self._submission_deadline = None

    def _tap_home(self, x: float, y: float) -> None:
        if y >= BOTTOM_NAV_TOP:
            return
        world_y = y + self._home_scroll
        for index in range(5):
            if contains(home_date_chip_rect(index), x, world_y):
                self._selected_date_index = index
                self._home_time_scroll = 0
                return
        for index in range(len(ROOMS)):
            if contains(home_card_rect(index), x, world_y):
                self._selected_room_index = index
                self._screen = "detail"
                self._selection = None
                self._detail_scroll = 0
                self._detail_time_scroll = DETAIL_DEFAULT_TIME_SCROLL
                return

    def _tap_detail(self, x: float, y: float) -> None:
        if contains(DETAIL_BACK, x, y):
            self._screen = "home"
            self._selection = None
            self._submission_deadline = None
            return
        world_y = y + self._detail_scroll
        if contains(DETAIL_RESET, x, world_y):
            self._selection = None
            return
        for index in range(SLOT_COUNT):
            state = slot_state(
                self._selected_room_index,
                self._selected_date_index,
                index,
                self._selection,
            )
            if contains(
                detail_slot_rect(index, self._detail_time_scroll, state),
                x,
                world_y,
            ):
                self._select_slot(index)
                return
        if contains(DETAIL_CTA, x, y) and self._selection is not None:
            self._screen = "confirm"

    def _tap_confirm(self, x: float, y: float) -> None:
        if contains(CONFIRM_CANCEL, x, y):
            self._screen = "detail"
        elif contains(CONFIRM_SUBMIT, x, y):
            self._screen = "detail"
            self._submission_deadline = time.monotonic() + SUBMIT_DELAY_SECONDS

    def _select_slot(self, index: int) -> None:
        state = slot_state(
            self._selected_room_index,
            self._selected_date_index,
            index,
            None,
        )
        if state in {"booked", "mine", "past"}:
            return
        if self._selection is None:
            self._selection = (index, index)
            return
        if self._selection == (index, index):
            self._selection = None
            return
        if self._selection[0] == self._selection[1]:
            start, end = sorted((self._selection[0], index))
            if end - start >= 4:
                return
            blocked = BOOKED_SLOTS_BY_ROOM[self._selected_room_index] | MINE_SLOTS_BY_ROOM[
                self._selected_room_index
            ]
            if any(slot in blocked for slot in range(start, end + 1)):
                return
            self._selection = (start, end)
            return
        self._selection = (index, index)

    def _advance_submission(self) -> None:
        if (
            self._screen == "detail"
            and self._submission_deadline is not None
            and time.monotonic() >= self._submission_deadline
        ):
            self._screen = "success"
            self._submission_deadline = None


def _clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, value))
