"""Shared 1080x2280 layout geometry for pixels, hit testing, and UI Tree."""

from __future__ import annotations

from .fixtures import HEIGHT, SLOT_COUNT, WIDTH


Rect = tuple[int, int, int, int]

STATUS_HEIGHT = 82
BOTTOM_NAV_TOP = 1984
HOME_VIEW_BOTTOM = BOTTOM_NAV_TOP
HOME_MAX_SCROLL = 420
DETAIL_MAX_SCROLL = 1260

HOME_LOGO: Rect = (55, 107, 175, 228)
HOME_TITLE: Rect = (196, 133, 520, 205)
HISTORY_BUTTON: Rect = (910, 110, 1023, 225)
HOME_HERO_TITLE: Rect = (55, 294, 1023, 393)
HOME_HERO_DESCRIPTION: Rect = (55, 399, 1023, 454)
DATE_CHIP_TOP = 483
DATE_CHIP_HEIGHT = 186
DATE_CHIP_LEFTS = (55, 254, 448, 648, 847)
DATE_CHIP_WIDTHS = (178, 176, 182, 178, 176)
SELECTED_DATE: Rect = (55, 695, 610, 770)
HOME_LIVE_STATUS: Rect = (830, 695, 1023, 770)

ROOM_CARD_LEFT = 50
ROOM_CARD_RIGHT = 1030
ROOM_CARD_TOP = 790
ROOM_CARD_HEIGHT = 420
ROOM_CARD_GAP = 45
ROOM_THUMB_SIZE = 170

DETAIL_HERO: Rect = (0, 0, WIDTH, 735)
DETAIL_BACK: Rect = (55, 107, 168, 223)
DETAIL_TITLE: Rect = (55, 585, 800, 700)
DETAIL_AMENITIES_TOP = 735
DETAIL_DATE_BUTTON: Rect = (55, 858, 610, 935)
DETAIL_LIVE_STATUS: Rect = (875, 860, 1023, 930)
DETAIL_GUIDANCE: Rect = (55, 935, 1023, 1000)
DETAIL_TIMELINE_VIEW: Rect = (0, 995, WIDTH, 1330)
DETAIL_SLOT_LEFT = 55
DETAIL_SLOT_WIDTH = 145
DETAIL_SLOT_GAP = 10
DETAIL_SLOT_BOTTOM = 1248
DETAIL_TICK_TOP = 1265
DETAIL_TRACK_WIDTH = SLOT_COUNT * DETAIL_SLOT_WIDTH + (SLOT_COUNT - 1) * DETAIL_SLOT_GAP
DETAIL_DEFAULT_TIME_SCROLL = 540
DETAIL_MAX_TIME_SCROLL = DETAIL_TRACK_WIDTH - WIDTH + 55
DETAIL_LEGEND: Rect = (55, 1360, 800, 1430)
DETAIL_SUMMARY: Rect = (55, 1450, 790, 1655)
DETAIL_RESET: Rect = (815, 1450, 1023, 1655)
DETAIL_RULES: Rect = (55, 1710, 1023, 2920)
DETAIL_CTA: Rect = (55, 2070, 1023, 2205)

CONFIRM_DIALOG: Rect = (130, 650, 950, 1660)
CONFIRM_CANCEL: Rect = (185, 1450, 515, 1580)
CONFIRM_SUBMIT: Rect = (565, 1450, 895, 1580)


def home_card_rect(index: int) -> Rect:
    top = ROOM_CARD_TOP + index * (ROOM_CARD_HEIGHT + ROOM_CARD_GAP)
    return (ROOM_CARD_LEFT, top, ROOM_CARD_RIGHT, top + ROOM_CARD_HEIGHT)


def home_date_chip_rect(index: int, selected_index: int | None = None) -> Rect:
    left = DATE_CHIP_LEFTS[index]
    top = DATE_CHIP_TOP
    bottom = DATE_CHIP_TOP + DATE_CHIP_HEIGHT
    if index == selected_index:
        top -= 6
        bottom -= 3
    return (left, top, left + DATE_CHIP_WIDTHS[index], bottom)


def detail_slot_rect(
    index: int,
    time_scroll: int,
    state: str = "available",
) -> Rect:
    left = DETAIL_SLOT_LEFT + index * (DETAIL_SLOT_WIDTH + DETAIL_SLOT_GAP) - time_scroll
    height = 222 if state == "selected" else 176 if state in {"booked", "mine"} else 112
    return (left, DETAIL_SLOT_BOTTOM - height, left + DETAIL_SLOT_WIDTH, DETAIL_SLOT_BOTTOM)


def translate_y(bounds: Rect, offset: int) -> Rect:
    left, top, right, bottom = bounds
    return (left, top + offset, right, bottom + offset)


def contains(bounds: Rect, x: float, y: float) -> bool:
    left, top, right, bottom = bounds
    return left <= x <= right and top <= y <= bottom


def intersects(bounds: Rect, viewport: Rect) -> bool:
    left, top, right, bottom = bounds
    view_left, view_top, view_right, view_bottom = viewport
    return right > view_left and left < view_right and bottom > view_top and top < view_bottom


SCREEN_VIEWPORT: Rect = (0, 0, WIDTH, HEIGHT)
HOME_CONTENT_VIEWPORT: Rect = (0, STATUS_HEIGHT, WIDTH, HOME_VIEW_BOTTOM)
DETAIL_CONTENT_VIEWPORT: Rect = (0, 0, WIDTH, HEIGHT)
