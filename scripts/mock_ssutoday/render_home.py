"""Pixel renderer for the SSUTODAY reservation home screen."""

from __future__ import annotations

import cv2
import numpy as np

from .fixtures import (
    BOOKED_SLOTS_BY_ROOM,
    CURRENT_MINUTE_FRACTION,
    CURRENT_SLOT,
    DATES,
    HOUR_TICKS,
    ROOMS,
)
from .interactions import MockSnapshot
from .layout import (
    BOTTOM_NAV_TOP,
    DATE_CHIP_HEIGHT,
    DATE_CHIP_TOP,
    HISTORY_BUTTON,
    HOME_HERO_DESCRIPTION,
    HOME_HERO_TITLE,
    HOME_LIVE_STATUS,
    HOME_LOGO,
    HOME_TITLE,
    ROOM_CARD_HEIGHT,
    ROOM_CARD_LEFT,
    ROOM_CARD_RIGHT,
    SELECTED_DATE,
    home_card_rect,
    home_date_chip_rect,
)
from .theme import (
    BLUE,
    BORDER,
    CONTROL,
    CONTROL_STRONG,
    DANGER,
    DISABLED,
    HEADING_BLUE,
    INK,
    MUTED,
    PURPLE,
    SUCCESS,
    TEXT_SECONDARY,
    WHITE,
    Canvas,
    draw_calendar_icon,
    draw_refresh_icon,
    draw_room_photo,
    draw_status_bar,
    gradient_rect,
    rounded_rect,
    shadowed_card,
)


def render_home(snapshot: MockSnapshot) -> np.ndarray:
    canvas = Canvas()
    image = canvas.image
    scroll = snapshot.home_scroll

    draw_status_bar(canvas)
    _draw_brand_header(canvas)

    _text_if_visible(
        canvas,
        "성준님, 어디서 공부할까요?",
        (HOME_HERO_TITLE[0], HOME_HERO_TITLE[1] - scroll),
        66,
        INK,
        bold=True,
    )
    _text_if_visible(
        canvas,
        "실시간으로 빈 시간을 확인하고 바로 예약할 수 있어요",
        (HOME_HERO_DESCRIPTION[0], HOME_HERO_DESCRIPTION[1] - scroll),
        37,
        MUTED,
        bold=False,
    )

    for index, date in enumerate(DATES):
        left, top, right, bottom = home_date_chip_rect(
            index, snapshot.selected_date_index
        )
        top -= scroll
        bottom -= scroll
        if bottom <= 250 or top >= BOTTOM_NAV_TOP:
            continue
        active = index == snapshot.selected_date_index
        if active:
            gradient_rect(image, (left, top, right, bottom), radius=48)
        else:
            rounded_rect(image, (left, top, right, bottom), CONTROL, 48)
        color = WHITE if active else (76, 63, 58)
        sub_color = (230, 220, 214) if active else MUTED
        canvas.text(date["top"], ((left + right) // 2, top + 52), 32, sub_color, bold=True, anchor="mm")
        canvas.text(date["bottom"], ((left + right) // 2, top + 126), 57, color, bold=True, anchor="mm")

    selected_date = DATES[snapshot.selected_date_index]
    meta_y = SELECTED_DATE[1] - scroll
    if 250 < meta_y < BOTTOM_NAV_TOP:
        draw_calendar_icon(image, (84, meta_y + 28), INK, 52)
        canvas.text(selected_date["label"], (132, meta_y + 30), 38, INK, bold=True, anchor="la")
        cv2.line(image, (550, meta_y + 17), (565, meta_y + 32), INK, 5, cv2.LINE_AA)
        cv2.line(image, (565, meta_y + 32), (580, meta_y + 17), INK, 5, cv2.LINE_AA)
        live_y = HOME_LIVE_STATUS[1] - scroll + 30
        cv2.circle(image, (830, live_y), 12, (130, 120, 255), -1, cv2.LINE_AA)
        cv2.circle(image, (830, live_y), 22, (220, 210, 255), 7, cv2.LINE_AA)
        canvas.text("실시간 현황", (860, live_y), 31, MUTED, bold=True, anchor="la")

    for index, room in enumerate(ROOMS):
        left, top, right, bottom = home_card_rect(index)
        screen_top = top - scroll
        screen_bottom = bottom - scroll
        if screen_bottom <= 250 or screen_top >= BOTTOM_NAV_TOP:
            continue
        shadowed_card(image, (left, screen_top, right, screen_bottom), radius=55)
        card = _render_room_card(index, snapshot.home_time_scroll)
        clip_top = max(0, 250 - screen_top)
        clip_bottom = min(ROOM_CARD_HEIGHT, BOTTOM_NAV_TOP - screen_top)
        if clip_bottom > clip_top:
            image[screen_top + clip_top:screen_top + clip_bottom, left:right] = card[
                clip_top:clip_bottom, :right - left
            ]

    _draw_bottom_navigation(canvas)
    return canvas.finish()


def _draw_brand_header(canvas: Canvas) -> None:
    image = canvas.image
    cv2.rectangle(image, (0, 82), (1080, 265), WHITE, -1)
    gradient_rect(image, HOME_LOGO, radius=36)
    canvas.text("SSUTODAY", ((HOME_LOGO[0] + HOME_LOGO[2]) // 2, 169), 20, WHITE, bold=True, anchor="mm")
    canvas.text("스터디룸 예약", (HOME_TITLE[0], 168), 48, HEADING_BLUE, bold=True, anchor="la")
    rounded_rect(image, HISTORY_BUTTON, CONTROL_STRONG, 42)
    draw_refresh_icon(image, ((HISTORY_BUTTON[0] + HISTORY_BUTTON[2]) // 2, 166), TEXT_SECONDARY, 56)


def _render_room_card(room_index: int, time_scroll: int) -> np.ndarray:
    width = ROOM_CARD_RIGHT - ROOM_CARD_LEFT
    card = Canvas(width=width, height=ROOM_CARD_HEIGHT)
    image = card.image
    room = ROOMS[room_index]

    rounded_rect(image, (0, 0, width - 1, ROOM_CARD_HEIGHT - 1), WHITE, 55, border=BORDER, border_width=2)
    draw_room_photo(image, (40, 40, 210, 210), room_index)
    _pill(card, (250, 45, 405, 112), room["capacity"], BLUE, (246, 241, 238))
    location_width = min(370, 120 + len(room["location"]) * 29)
    _pill(card, (425, 45, 425 + location_width, 112), room["location"], TEXT_SECONDARY, CONTROL_STRONG)
    status_color = SUCCESS if room["status"] == "여유" else (61, 107, 255)
    status_bg = (241, 250, 232) if room["status"] == "여유" else (234, 240, 255)
    _pill(card, (width - 165, 60, width - 45, 127), room["status"], status_color, status_bg)
    card.text(room["name"], (250, 150), 49, INK, bold=True, anchor="la")

    track_left = 40 - time_scroll
    slot_width = 43
    gap = 8
    bar_bottom = 330
    for slot in range(32):
        left = track_left + slot * (slot_width + gap)
        right = left + slot_width
        if right < 25 or left > width - 25:
            continue
        booked = slot in BOOKED_SLOTS_BY_ROOM[room_index]
        height = 72 if booked else 34
        color = (161, 141, 255) if booked else CONTROL_STRONG
        rounded_rect(image, (left, bar_bottom - height, right, bar_bottom), color, 13)

    marker_position = CURRENT_SLOT + CURRENT_MINUTE_FRACTION
    marker_x = int(track_left + marker_position * (slot_width + gap))
    if 20 <= marker_x <= width - 20:
        cv2.line(image, (marker_x, 218), (marker_x, 338), (138, 126, 255), 6, cv2.LINE_AA)
        cv2.circle(image, (marker_x, 218), 11, (138, 126, 255), -1, cv2.LINE_AA)

    for tick_index, tick in enumerate(HOUR_TICKS):
        x = track_left + tick_index * 2 * (slot_width + gap)
        if 5 <= x <= width - 5:
            card.text(tick, (x, 365), 28, DISABLED, bold=True, anchor="la")
    return card.finish()


def _pill(
    canvas: Canvas,
    bounds: tuple[int, int, int, int],
    label: str,
    foreground: tuple[int, int, int],
    background: tuple[int, int, int],
) -> None:
    rounded_rect(canvas.image, bounds, background, 30)
    canvas.text(
        label,
        ((bounds[0] + bounds[2]) // 2, (bounds[1] + bounds[3]) // 2),
        31,
        foreground,
        bold=True,
        anchor="mm",
    )


def _draw_bottom_navigation(canvas: Canvas) -> None:
    image = canvas.image
    cv2.rectangle(image, (0, BOTTOM_NAV_TOP), (1080, 2280), WHITE, -1)
    cv2.line(image, (0, BOTTOM_NAV_TOP), (1080, BOTTOM_NAV_TOP), BORDER, 2, cv2.LINE_AA)

    # Home icon.
    home_x, icon_y = 235, 2110
    cv2.polylines(image, [np.array([[200, 2110], [235, 2076], [270, 2110]])], False, DISABLED, 9, cv2.LINE_AA)
    cv2.rectangle(image, (207, 2105), (263, 2162), DISABLED, 8, cv2.LINE_AA)

    # Primary reservation button.
    gradient_rect(image, (465, 1995, 615, 2180), radius=50)
    draw_calendar_icon(image, (540, 2085), WHITE, 74)

    # User icon.
    cv2.circle(image, (845, 2093), 22, DISABLED, 8, cv2.LINE_AA)
    cv2.ellipse(image, (845, 2150), (38, 44), 0, 185, 355, DISABLED, 8, cv2.LINE_AA)


def _text_if_visible(
    canvas: Canvas,
    value: str,
    origin: tuple[int, int],
    size: int,
    color: tuple[int, int, int],
    *,
    bold: bool,
) -> None:
    if 250 <= origin[1] <= BOTTOM_NAV_TOP:
        canvas.text(value, origin, size, color, bold=bold, anchor="la")
