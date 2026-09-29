"""SSUTODAY drawing primitives and visual tokens."""

from __future__ import annotations

from functools import lru_cache
import os
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .fixtures import HEIGHT, WIDTH


Color = tuple[int, int, int]  # OpenCV BGR
Anchor = Literal["la", "ma", "ra", "mm"]

WHITE: Color = (255, 255, 255)
INK: Color = (34, 18, 15)
HEADING_BLUE: Color = (102, 58, 20)
TEXT_SECONDARY: Color = (102, 85, 79)
MUTED: Color = (156, 143, 138)
DISABLED: Color = (198, 186, 182)
CONTROL: Color = (250, 247, 244)
CONTROL_STRONG: Color = (248, 243, 242)
BORDER: Color = (244, 238, 237)
BLUE: Color = (255, 124, 79)
PURPLE: Color = (255, 92, 155)
DANGER: Color = (99, 77, 255)
SUCCESS: Color = (122, 185, 31)
ORANGE: Color = (61, 107, 255)


class Canvas:
    def __init__(self, *, color: Color = WHITE, width: int = WIDTH, height: int = HEIGHT) -> None:
        self.image = np.full((height, width, 3), color, dtype=np.uint8)
        self._labels: list[
            tuple[str, tuple[int, int], int, Color, bool, Anchor, int | None]
        ] = []

    def text(
        self,
        value: str,
        origin: tuple[int, int],
        size: int,
        color: Color = INK,
        *,
        bold: bool = False,
        anchor: Anchor = "la",
        max_width: int | None = None,
    ) -> None:
        self._labels.append((value, origin, size, color, bold, anchor, max_width))

    def finish(self) -> np.ndarray:
        if not self._labels:
            return self.image
        pil_image = Image.fromarray(cv2.cvtColor(self.image, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(pil_image)
        for value, origin, size, color, bold, anchor, max_width in self._labels:
            font = unicode_font(size, bold)
            lines = wrap_text(draw, value, font, max_width) if max_width else [value]
            line_height = int(size * 1.42)
            for line_index, line in enumerate(lines):
                draw.text(
                    (origin[0], origin[1] + line_index * line_height),
                    line,
                    font=font,
                    fill=tuple(reversed(color)),
                    anchor=anchor,
                )
        self.image[:] = cv2.cvtColor(np.asarray(pil_image), cv2.COLOR_RGB2BGR)
        return self.image


@lru_cache(maxsize=96)
def unicode_font(size: int, bold: bool) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    windows_fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    candidates = (
        windows_fonts / ("malgunbd.ttf" if bold else "malgun.ttf"),
        Path(
            "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"
            if bold else "/usr/share/fonts/truetype/nanum/NanumGothic.ttf"
        ),
        Path(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
            if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        ),
    )
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def wrap_text(
    draw: ImageDraw.ImageDraw,
    value: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int | None,
) -> list[str]:
    if max_width is None:
        return [value]
    lines: list[str] = []
    for paragraph in value.splitlines() or [""]:
        current = ""
        for character in paragraph:
            candidate = current + character
            if current and draw.textbbox((0, 0), candidate, font=font)[2] > max_width:
                lines.append(current)
                current = character
            else:
                current = candidate
        lines.append(current)
    return lines


def rounded_rect(
    image: np.ndarray,
    bounds: tuple[int, int, int, int],
    color: Color,
    radius: int,
    *,
    border: Color | None = None,
    border_width: int = 1,
) -> None:
    left, top, right, bottom = bounds
    if right <= 0 or bottom <= 0 or left >= image.shape[1] or top >= image.shape[0]:
        return
    left = max(0, left)
    top = max(0, top)
    right = min(image.shape[1] - 1, right)
    bottom = min(image.shape[0] - 1, bottom)
    radius = max(1, min(radius, (right - left) // 2, (bottom - top) // 2))

    def fill(
        inner_left: int,
        inner_top: int,
        inner_right: int,
        inner_bottom: int,
        inner_color: Color | int,
        inner_radius: int,
    ) -> None:
        cv2.rectangle(
            image,
            (inner_left + inner_radius, inner_top),
            (inner_right - inner_radius, inner_bottom),
            inner_color,
            -1,
            cv2.LINE_AA,
        )
        cv2.rectangle(
            image,
            (inner_left, inner_top + inner_radius),
            (inner_right, inner_bottom - inner_radius),
            inner_color,
            -1,
            cv2.LINE_AA,
        )
        for center in (
            (inner_left + inner_radius, inner_top + inner_radius),
            (inner_right - inner_radius, inner_top + inner_radius),
            (inner_left + inner_radius, inner_bottom - inner_radius),
            (inner_right - inner_radius, inner_bottom - inner_radius),
        ):
            cv2.circle(image, center, inner_radius, inner_color, -1, cv2.LINE_AA)

    if border is None:
        fill(left, top, right, bottom, color, radius)
        return
    fill(left, top, right, bottom, border, radius)
    inset = max(1, border_width)
    if right - left > inset * 2 and bottom - top > inset * 2:
        fill(
            left + inset,
            top + inset,
            right - inset,
            bottom - inset,
            color,
            max(1, radius - inset),
        )


def shadowed_card(
    image: np.ndarray,
    bounds: tuple[int, int, int, int],
    *,
    radius: int = 55,
) -> None:
    left, top, right, bottom = bounds
    rounded_rect(image, (left + 3, top + 12, right + 3, bottom + 18), (238, 232, 231), radius)
    rounded_rect(image, bounds, WHITE, radius, border=BORDER, border_width=2)


def gradient_rect(
    image: np.ndarray,
    bounds: tuple[int, int, int, int],
    start: Color = BLUE,
    end: Color = PURPLE,
    *,
    radius: int = 30,
) -> None:
    left, top, right, bottom = bounds
    width = max(1, right - left)
    height = max(1, bottom - top)
    gradient = np.zeros((height, width, 3), dtype=np.uint8)
    for x in range(width):
        ratio = x / max(1, width - 1)
        gradient[:, x] = tuple(
            int(first * (1 - ratio) + second * ratio)
            for first, second in zip(start, end, strict=True)
        )
    mask = np.zeros((height, width), dtype=np.uint8)
    rounded_rect(mask, (0, 0, width - 1, height - 1), 255, radius)  # type: ignore[arg-type]
    clip_left = max(0, left)
    clip_top = max(0, top)
    clip_right = min(image.shape[1], right)
    clip_bottom = min(image.shape[0], bottom)
    if clip_right <= clip_left or clip_bottom <= clip_top:
        return
    gradient_left = clip_left - left
    gradient_top = clip_top - top
    gradient_right = gradient_left + clip_right - clip_left
    gradient_bottom = gradient_top + clip_bottom - clip_top
    clipped_gradient = gradient[
        gradient_top:gradient_bottom, gradient_left:gradient_right
    ]
    clipped_mask = mask[
        gradient_top:gradient_bottom, gradient_left:gradient_right
    ]
    target = image[clip_top:clip_bottom, clip_left:clip_right]
    target[clipped_mask > 0] = clipped_gradient[clipped_mask > 0]


def striped_rect(
    image: np.ndarray,
    bounds: tuple[int, int, int, int],
    *,
    mine: bool = False,
    radius: int = 24,
) -> None:
    base = (255, 225, 236) if mine else (230, 225, 255)
    stripe = (255, 191, 216) if mine else (218, 191, 255)
    border = (255, 170, 201) if mine else (191, 179, 255)
    left, top, right, bottom = bounds
    width = max(1, right - left)
    height = max(1, bottom - top)
    local = np.zeros((height, width, 3), dtype=np.uint8)
    rounded_rect(
        local,
        (0, 0, width - 1, height - 1),
        base,
        radius,
        border=border,
        border_width=4,
    )
    stripe_layer = local.copy()
    for start in range(-height, width + height, 32):
        cv2.line(
            stripe_layer,
            (start, height),
            (start + height, 0),
            stripe,
            9,
            cv2.LINE_AA,
        )
    inner_mask = np.zeros((height, width), dtype=np.uint8)
    rounded_rect(
        inner_mask,
        (4, 4, width - 5, height - 5),
        255,
        max(1, radius - 4),
    )  # type: ignore[arg-type]
    local[inner_mask > 0] = stripe_layer[inner_mask > 0]

    clip_left = max(0, left)
    clip_top = max(0, top)
    clip_right = min(image.shape[1], right)
    clip_bottom = min(image.shape[0], bottom)
    if clip_right <= clip_left or clip_bottom <= clip_top:
        return
    source_left = clip_left - left
    source_top = clip_top - top
    source_right = source_left + clip_right - clip_left
    source_bottom = source_top + clip_bottom - clip_top
    source = local[source_top:source_bottom, source_left:source_right]
    target = image[clip_top:clip_bottom, clip_left:clip_right]
    outer_mask = np.any(source != 0, axis=2)
    target[outer_mask] = source[outer_mask]


def draw_status_bar(canvas: Canvas, *, time_label: str = "9:29") -> None:
    canvas.text(time_label, (125, 55), 42, (0, 0, 0), bold=True, anchor="ma")
    image = canvas.image
    for index, height in enumerate((15, 24, 34, 44)):
        left = 790 + index * 18
        rounded_rect(image, (left, 65 - height, left + 12, 65), (0, 0, 0), 4)
    canvas.text("LTE", (875, 55), 37, (0, 0, 0), bold=True, anchor="ma")
    rounded_rect(image, (966, 24, 1038, 68), (0, 0, 0), 11)
    canvas.text("83", (1002, 47), 31, WHITE, bold=True, anchor="mm")
    rounded_rect(image, (1041, 37, 1049, 56), (196, 196, 196), 3)


def draw_calendar_icon(image: np.ndarray, center: tuple[int, int], color: Color, size: int = 42) -> None:
    x, y = center
    left, top = x - size // 2, y - size // 2
    right, bottom = x + size // 2, y + size // 2
    rounded_rect(image, (left, top, right, bottom), WHITE, 7, border=color, border_width=4)
    cv2.line(image, (left, top + 12), (right, top + 12), color, 4, cv2.LINE_AA)
    cv2.line(image, (left + 11, top - 5), (left + 11, top + 7), color, 4, cv2.LINE_AA)
    cv2.line(image, (right - 11, top - 5), (right - 11, top + 7), color, 4, cv2.LINE_AA)


def draw_refresh_icon(image: np.ndarray, center: tuple[int, int], color: Color, size: int = 46) -> None:
    x, y = center
    cv2.ellipse(image, (x, y), (size // 2, size // 2), 0, 30, 320, color, 5, cv2.LINE_AA)
    cv2.line(image, (x - size // 2, y - 3), (x - size // 2 + 5, y - 18), color, 5, cv2.LINE_AA)
    cv2.line(image, (x - size // 2, y - 3), (x - size // 2 + 17, y), color, 5, cv2.LINE_AA)


def draw_back_icon(image: np.ndarray, center: tuple[int, int], color: Color) -> None:
    x, y = center
    cv2.line(image, (x + 14, y - 24), (x - 12, y), color, 7, cv2.LINE_AA)
    cv2.line(image, (x - 12, y), (x + 14, y + 24), color, 7, cv2.LINE_AA)


def draw_room_photo(
    image: np.ndarray,
    bounds: tuple[int, int, int, int],
    variant: int,
    *,
    radius: int | None = None,
) -> None:
    """Render a deterministic room illustration without copying capture pixels."""

    left, top, right, bottom = bounds
    width, height = right - left, bottom - top
    if width <= 0 or height <= 0:
        return
    region = np.zeros((height, width, 3), dtype=np.uint8)
    wall_colors = ((226, 226, 222), (219, 231, 226), (225, 224, 219))
    region[:] = wall_colors[variant % len(wall_colors)]
    cv2.rectangle(region, (0, int(height * 0.68)), (width, height), (207, 207, 203), -1)
    cv2.rectangle(region, (int(width * 0.05), int(height * 0.08)), (int(width * 0.42), int(height * 0.48)), (207, 222, 226), -1)
    cv2.line(region, (int(width * 0.24), int(height * 0.08)), (int(width * 0.24), int(height * 0.48)), (154, 164, 166), max(2, width // 100))
    table = np.array([
        [int(width * 0.16), int(height * 0.52)],
        [int(width * 0.82), int(height * 0.48)],
        [int(width * 0.96), int(height * 0.73)],
        [int(width * 0.05), int(height * 0.76)],
    ], dtype=np.int32)
    cv2.fillConvexPoly(region, table, (201, 218, 226), cv2.LINE_AA)
    cv2.polylines(region, [table], True, (169, 186, 195), max(2, width // 80), cv2.LINE_AA)
    for ratio in (0.18, 0.4, 0.67, 0.85):
        cx = int(width * ratio)
        cy = int(height * (0.78 if ratio < 0.6 else 0.72))
        cv2.ellipse(region, (cx, cy), (max(6, width // 11), max(8, height // 10)), 0, 0, 360, (112, 142, 162), -1, cv2.LINE_AA)
    mask = np.zeros((height, width), dtype=np.uint8)
    rounded_rect(
        mask,
        (0, 0, width - 1, height - 1),
        255,
        radius if radius is not None else max(8, min(width, height) // 7),
    )  # type: ignore[arg-type]
    target = image[top:bottom, left:right]
    target[mask > 0] = region[mask > 0]
