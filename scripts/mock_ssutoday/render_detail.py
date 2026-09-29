"""Pixel renderer for detail, timeline, CTA, and confirmation states."""

from __future__ import annotations

import cv2
import numpy as np

from .fixtures import (
    CURRENT_MINUTE_FRACTION,
    CURRENT_SLOT,
    DATES,
    HOUR_TICKS,
    ROOMS,
    SLOT_COUNT,
    SLOT_TIMES,
    USAGE_RULES,
    slot_end_time,
    slot_state,
)
from .interactions import MockSnapshot
from .layout import (
    CONFIRM_CANCEL,
    CONFIRM_DIALOG,
    CONFIRM_SUBMIT,
    DETAIL_AMENITIES_TOP,
    DETAIL_BACK,
    DETAIL_CTA,
    DETAIL_DATE_BUTTON,
    DETAIL_GUIDANCE,
    DETAIL_HERO,
    DETAIL_LEGEND,
    DETAIL_LIVE_STATUS,
    DETAIL_RESET,
    DETAIL_RULES,
    DETAIL_SLOT_BOTTOM,
    DETAIL_SLOT_GAP,
    DETAIL_SLOT_LEFT,
    DETAIL_SLOT_WIDTH,
    DETAIL_SUMMARY,
    DETAIL_TICK_TOP,
    DETAIL_TIMELINE_VIEW,
    DETAIL_TITLE,
)
from .theme import (
    BLUE,
    BORDER,
    CONTROL_STRONG,
    DANGER,
    DISABLED,
    INK,
    MUTED,
    ORANGE,
    PURPLE,
    TEXT_SECONDARY,
    WHITE,
    Canvas,
    draw_back_icon,
    draw_calendar_icon,
    draw_refresh_icon,
    draw_room_photo,
    draw_status_bar,
    gradient_rect,
    rounded_rect,
    striped_rect,
)


CONTENT_HEIGHT = 3900


def render_detail(snapshot: MockSnapshot, *, confirm: bool = False) -> np.ndarray:
    content = _render_content(snapshot)
    screen = Canvas()
    scroll = snapshot.detail_scroll
    screen.image[:] = content[scroll:scroll + 2280]

    # The native status bar and app back button remain fixed over scrollable content.
    draw_status_bar(screen, time_label="9:30")
    rounded_rect(screen.image, DETAIL_BACK, (250, 250, 250), 40)
    draw_back_icon(
        screen.image,
        ((DETAIL_BACK[0] + DETAIL_BACK[2]) // 2, (DETAIL_BACK[1] + DETAIL_BACK[3]) // 2),
        TEXT_SECONDARY,
    )
    _draw_cta(screen, snapshot)
    if confirm:
        _draw_confirm_dialog(screen, snapshot)
    return screen.finish()


def _render_content(snapshot: MockSnapshot) -> np.ndarray:
    canvas = Canvas(height=CONTENT_HEIGHT)
    image = canvas.image
    room = ROOMS[snapshot.selected_room_index]
    selected_date = DATES[snapshot.selected_date_index]

    draw_room_photo(image, DETAIL_HERO, snapshot.selected_room_index, radius=1)
    # Captured hero fades to white behind the room title.
    for y in range(300, DETAIL_HERO[3]):
        ratio = min(1.0, max(0.0, (y - 300) / 435))
        image[y:y + 1] = cv2.addWeighted(
            image[y:y + 1], 1.0 - ratio * 0.96,
            np.full_like(image[y:y + 1], 255), ratio * 0.96,
            0,
        )
    canvas.text(room["name"], (DETAIL_TITLE[0], 625), 72, INK, bold=True, anchor="la")

    amenity_x = 55
    for amenity in room["amenities"]:
        width = 75 + len(amenity) * 33
        rounded_rect(image, (amenity_x, DETAIL_AMENITIES_TOP, amenity_x + width, 815), CONTROL_STRONG, 32)
        canvas.text(amenity, (amenity_x + width // 2, 775), 34, TEXT_SECONDARY, bold=True, anchor="mm")
        amenity_x += width + 20

    canvas.text(selected_date["label"], (DETAIL_DATE_BUTTON[0], 890), 44, INK, bold=True, anchor="la")
    draw_calendar_icon(image, (530, 890), INK, 48)
    cv2.circle(image, (880, 891), 12, (130, 120, 255), -1, cv2.LINE_AA)
    cv2.circle(image, (880, 891), 23, (225, 215, 255), 7, cv2.LINE_AA)
    canvas.text("실시간", (910, 891), 31, MUTED, bold=True, anchor="la")
    canvas.text(
        "한 칸은 30분입니다. 예약된 시간은 선택할 수 없어요",
        (DETAIL_GUIDANCE[0], 954),
        32,
        MUTED,
        anchor="la",
    )

    _draw_timeline(canvas, snapshot)
    _draw_legend(canvas)
    _draw_summary(canvas, snapshot)
    _draw_rules(canvas)
    return canvas.finish()


def _draw_timeline(canvas: Canvas, snapshot: MockSnapshot) -> None:
    image = canvas.image
    time_scroll = snapshot.detail_time_scroll
    bottom = DETAIL_SLOT_BOTTOM
    for index in range(SLOT_COUNT):
        left = DETAIL_SLOT_LEFT + index * (DETAIL_SLOT_WIDTH + DETAIL_SLOT_GAP) - time_scroll
        right = left + DETAIL_SLOT_WIDTH
        if right < -10 or left > 1090:
            continue
        state = slot_state(
            snapshot.selected_room_index,
            snapshot.selected_date_index,
            index,
            snapshot.selection,
        )
        if state == "selected":
            gradient_rect(image, (left, bottom - 222, right, bottom), radius=25)
        elif state == "booked":
            striped_rect(image, (left, bottom - 176, right, bottom), radius=25)
        elif state == "mine":
            striped_rect(image, (left, bottom - 176, right, bottom), mine=True, radius=25)
        elif state == "past":
            rounded_rect(image, (left, bottom - 112, right, bottom), (238, 238, 238), 24, border=(232, 229, 228), border_width=3)
        else:
            rounded_rect(image, (left, bottom - 112, right, bottom), CONTROL_STRONG, 24, border=BORDER, border_width=3)

    marker_x = int(
        DETAIL_SLOT_LEFT
        + (CURRENT_SLOT + CURRENT_MINUTE_FRACTION) * (DETAIL_SLOT_WIDTH + DETAIL_SLOT_GAP)
        - time_scroll
    )
    if 0 <= marker_x <= 1080:
        cv2.line(image, (marker_x, 1020), (marker_x, 1255), (138, 126, 255), 7, cv2.LINE_AA)
        cv2.circle(image, (marker_x, 1020), 13, (138, 126, 255), -1, cv2.LINE_AA)

    for tick_index, tick in enumerate(HOUR_TICKS):
        x = DETAIL_SLOT_LEFT + tick_index * 2 * (DETAIL_SLOT_WIDTH + DETAIL_SLOT_GAP) - time_scroll
        if -30 <= x <= 1080:
            canvas.text(tick, (x, DETAIL_TICK_TOP), 29, DISABLED, bold=True, anchor="la")


def _draw_legend(canvas: Canvas) -> None:
    image = canvas.image
    items = (
        (55, "예약됨", (230, 225, 255), (191, 179, 255)),
        (330, "빈 시간", CONTROL_STRONG, BORDER),
        (620, "선택", PURPLE, PURPLE),
    )
    for x, label, background, border in items:
        rounded_rect(image, (x, 1366, x + 34, 1400), background, 8, border=border, border_width=3)
        canvas.text(label, (x + 52, 1383), 31, MUTED, bold=True, anchor="la")


def _draw_summary(canvas: Canvas, snapshot: MockSnapshot) -> None:
    image = canvas.image
    rounded_rect(image, DETAIL_SUMMARY, (255, 242, 238), 45, border=(255, 224, 216), border_width=3)
    label = "선택된 시간" if snapshot.selection else "시간 선택"
    summary = "시간대를 선택하세요"
    if snapshot.selection:
        summary = f"{SLOT_TIMES[snapshot.selection[0]]} ~ {slot_end_time(snapshot.selection[1])}"
    canvas.text(label, (90, 1500), 33, BLUE, bold=True, anchor="la")
    canvas.text(summary, (90, 1580), 52, INK, bold=True, anchor="la")

    rounded_rect(image, DETAIL_RESET, WHITE, 45, border=BORDER, border_width=3)
    draw_refresh_icon(image, (919, 1518), MUTED, 58)
    canvas.text("초기화", (919, 1593), 31, MUTED, bold=True, anchor="mm")


def _draw_rules(canvas: Canvas) -> None:
    image = canvas.image
    rounded_rect(image, DETAIL_RULES, (242, 246, 255), 45, border=(214, 226, 255), border_width=3)
    canvas.text("이용 규칙", (95, 1780), 38, ORANGE, bold=True, anchor="la")
    y = 1855
    for rule in USAGE_RULES:
        canvas.text("•", (95, y), 35, (99, 106, 122), bold=True, anchor="la")
        canvas.text(rule, (145, y), 32, (99, 106, 122), bold=False, anchor="la", max_width=800)
        line_count = max(1, (len(rule) + 25) // 26)
        y += 64 * line_count + 14


def _draw_cta(canvas: Canvas, snapshot: MockSnapshot) -> None:
    image = canvas.image
    # White fade keeps scrolled rules readable while matching the fixed source CTA.
    overlay = image[1980:2280].copy()
    for row in range(overlay.shape[0]):
        alpha = min(1.0, row / 100)
        overlay[row:row + 1] = cv2.addWeighted(
            overlay[row:row + 1], 1.0 - alpha,
            np.full_like(overlay[row:row + 1], 255), alpha,
            0,
        )
    image[1980:2280] = overlay

    enabled = snapshot.selection is not None and not snapshot.submitting
    if enabled:
        gradient_rect(image, DETAIL_CTA, radius=42)
    else:
        rounded_rect(image, DETAIL_CTA, (245, 240, 239), 42)
    label = (
        "예약 처리 중" if snapshot.submitting
        else "이 시간으로 예약하기" if snapshot.selection
        else "시간을 선택하세요"
    )
    canvas.text(
        label,
        ((DETAIL_CTA[0] + DETAIL_CTA[2]) // 2, (DETAIL_CTA[1] + DETAIL_CTA[3]) // 2),
        42,
        WHITE if enabled else DISABLED,
        bold=True,
        anchor="mm",
    )


def _draw_confirm_dialog(canvas: Canvas, snapshot: MockSnapshot) -> None:
    image = canvas.image
    dark = np.full_like(image, (34, 25, 20))
    image[:] = cv2.addWeighted(image, 0.58, dark, 0.42, 0)
    rounded_rect(image, CONFIRM_DIALOG, WHITE, 62)
    rounded_rect(image, (440, 720, 640, 920), (255, 244, 238), 50)
    cv2.line(image, (485, 818), (530, 862), BLUE, 13, cv2.LINE_AA)
    cv2.line(image, (530, 862), (605, 775), BLUE, 13, cv2.LINE_AA)
    canvas.text("이 시간으로 예약할까요?", (540, 990), 50, INK, bold=True, anchor="mm")
    rounded_rect(image, (190, 1060, 890, 1375), (251, 248, 247), 38, border=BORDER, border_width=3)
    room = ROOMS[snapshot.selected_room_index]
    date = DATES[snapshot.selected_date_index]
    start, end = snapshot.selection or (0, 0)
    rows = (
        ("스터디룸", room["name"]),
        ("날짜", date["full_date"]),
        ("시간", f"{SLOT_TIMES[start]} ~ {slot_end_time(end)}"),
    )
    for index, (label, value) in enumerate(rows):
        y = 1120 + index * 88
        canvas.text(label, (230, y), 31, MUTED, bold=True, anchor="la")
        canvas.text(value, (850, y), 33, INK, bold=True, anchor="ra")
    rounded_rect(image, CONFIRM_CANCEL, CONTROL_STRONG, 38)
    gradient_rect(image, CONFIRM_SUBMIT, radius=38)
    canvas.text("취소", ((CONFIRM_CANCEL[0] + CONFIRM_CANCEL[2]) // 2, 1515), 38, TEXT_SECONDARY, bold=True, anchor="mm")
    canvas.text("예약 확정", ((CONFIRM_SUBMIT[0] + CONFIRM_SUBMIT[2]) // 2, 1515), 38, WHITE, bold=True, anchor="mm")
