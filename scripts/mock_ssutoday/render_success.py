"""Reservation success screen renderer matching the SSUTODAY source layout."""

from __future__ import annotations

import cv2
import numpy as np

from .fixtures import DATES, ROOMS, SLOT_TIMES, slot_end_time
from .interactions import MockSnapshot
from .theme import (
    BLUE,
    BORDER,
    CONTROL_STRONG,
    INK,
    MUTED,
    PURPLE,
    SUCCESS,
    WHITE,
    Canvas,
    draw_room_photo,
    draw_status_bar,
    gradient_rect,
    rounded_rect,
    shadowed_card,
)


def render_success(snapshot: MockSnapshot) -> np.ndarray:
    canvas = Canvas()
    image = canvas.image
    draw_status_bar(canvas, time_label="9:30")

    # Soft radial-like backdrop.
    for y in range(90, 1050):
        ratio = (y - 90) / 960
        color = tuple(int(start * (1 - ratio) + 255 * ratio) for start in (255, 244, 238))
        image[y:y + 1] = color

    gradient_rect(image, (390, 300, 690, 600), radius=150)
    cv2.line(image, (465, 455), (525, 515), WHITE, 18, cv2.LINE_AA)
    cv2.line(image, (525, 515), (625, 400), WHITE, 18, cv2.LINE_AA)
    canvas.text("RESERVED", (540, 675), 32, BLUE, bold=True, anchor="mm")
    canvas.text("예약 성공", (540, 760), 70, INK, bold=True, anchor="mm")

    card = (95, 850, 985, 1530)
    shadowed_card(image, card, radius=55)
    room = ROOMS[snapshot.selected_room_index]
    draw_room_photo(image, (150, 925, 310, 1085), snapshot.selected_room_index)
    canvas.text(room["name"], (350, 965), 46, INK, bold=True, anchor="la")
    canvas.text(room["location"], (350, 1035), 31, MUTED, bold=True, anchor="la")
    cv2.line(image, (150, 1145), (930, 1145), BORDER, 3, cv2.LINE_AA)

    date = DATES[snapshot.selected_date_index]
    selection = snapshot.selection or (0, 0)
    time_range = f"{SLOT_TIMES[selection[0]]} ~ {slot_end_time(selection[1])}"
    canvas.text("날짜", (150, 1230), 34, MUTED, bold=True, anchor="la")
    canvas.text(date["label"], (930, 1230), 34, INK, bold=True, anchor="ra")
    canvas.text("시간", (150, 1340), 34, MUTED, bold=True, anchor="la")
    canvas.text(time_range, (930, 1340), 36, BLUE, bold=True, anchor="ra")

    gradient_rect(image, (95, 1670, 985, 1810), radius=42)
    rounded_rect(image, (95, 1845, 985, 1985), CONTROL_STRONG, 42)
    canvas.text("예약 내역 보기", (540, 1740), 42, WHITE, bold=True, anchor="mm")
    canvas.text("예약 화면으로", (540, 1915), 42, MUTED, bold=True, anchor="mm")

    # A few deterministic celebratory marks echo the source animation.
    confetti = (
        (275, 420, BLUE), (800, 470, PURPLE), (230, 650, SUCCESS),
        (850, 690, (32, 176, 255)), (735, 300, BLUE), (330, 280, PURPLE),
    )
    for x, y, color in confetti:
        cv2.circle(image, (x, y), 10, color, -1, cv2.LINE_AA)
    return canvas.finish()
