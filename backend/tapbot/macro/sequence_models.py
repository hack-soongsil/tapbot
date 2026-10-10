"""User-authored ordered click maps, independent of device transports."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ElementSelector(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)
    view_id: str | None = Field(default=None, min_length=1, max_length=500)
    text: str | None = Field(default=None, min_length=1, max_length=1000)
    content_description: str | None = Field(default=None, min_length=1, max_length=1000)
    time_slot: str | None = Field(default=None, pattern=r"^(0[6-9]|1[0-9]|2[01]):(00|30)$")

    @model_validator(mode="after")
    def identifying_field(self) -> ElementSelector:
        if not (self.view_id or self.text or self.content_description or self.time_slot):
            raise ValueError("UI 요소의 ID, 텍스트 또는 설명이 필요합니다.")
        return self


class BookingRange(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    start_time: str = Field(pattern=r"^(0[6-9]|1[0-9]|2[01]):(00|30)$")
    end_time: str = Field(pattern=r"^((0[6-9]|1[0-9]|2[01]):(00|30)|22:00)$")

    @model_validator(mode="after")
    def forward_range(self) -> BookingRange:
        if self.start_time >= self.end_time:
            raise ValueError("예약 종료 시각은 시작 시각보다 늦어야 합니다.")
        return self


class SequenceStep(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    kind: Literal["point", "element", "checkpoint"]
    x: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    y: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    selector: ElementSelector | None = None
    package_name: str | None = Field(default=None, min_length=1, max_length=300)
    required_text: str | None = Field(default=None, min_length=1, max_length=1000)
    duration_ms: int = Field(default=70, ge=1, le=10000, strict=True)
    delay_ms: int = Field(default=500, ge=0, le=600000, strict=True)
    timeout_ms: int = Field(default=10000, ge=100, le=60000, strict=True)

    @model_validator(mode="after")
    def target(self) -> SequenceStep:
        if self.kind == "point" and (self.x is None or self.y is None or self.selector is not None):
            raise ValueError("좌표 클릭에는 X와 Y만 지정하세요.")
        if self.kind == "element" and (self.selector is None or self.x is not None or self.y is not None):
            raise ValueError("UI 클릭에는 요소 선택자를 지정하세요.")
        if self.kind == "checkpoint" and (self.x is not None or self.y is not None or (self.selector and self.selector.time_slot)):
            raise ValueError("확인 대기에는 좌표나 시간 칸을 지정할 수 없습니다.")
        return self


class SequenceDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$")
    name: str = Field(min_length=1, max_length=200)
    version: Literal[1] = 1
    screen_width: int = Field(ge=1, le=20000, strict=True)
    screen_height: int = Field(ge=1, le=20000, strict=True)
    rotation: Literal[0, 90, 180, 270] = 0
    repeat_count: int = Field(default=1, ge=1, le=1000, strict=True)
    steps: tuple[SequenceStep, ...] = Field(min_length=1, max_length=200)
    booking_ranges: tuple[BookingRange, BookingRange] | None = None

    @model_validator(mode="after")
    def points_and_ids(self) -> SequenceDefinition:
        if len({step.id for step in self.steps}) != len(self.steps):
            raise ValueError("클릭 단계의 ID가 중복되었습니다.")
        for step in self.steps:
            if step.kind == "point" and (
                step.x is None or step.y is None
                or step.x > self.screen_width - 1 or step.y > self.screen_height - 1
            ):
                raise ValueError(f"{step.label}: 클릭 좌표가 화면 밖입니다.")
        if self.booking_ranges:
            by_id = {step.id: step for step in self.steps}
            for number, booking in enumerate(self.booking_ranges, 1):
                hour, minute = map(int, booking.end_time.split(":"))
                last = hour * 60 + minute - 30
                last_slot = f"{last // 60:02}:{last % 60:02}"
                for key, slot in (("start", booking.start_time), ("end", last_slot)):
                    step = by_id.get(f"{key}-{number}")
                    if not step or step.kind != "element" or not step.selector or step.selector.time_slot != slot:
                        raise ValueError(f"{number}번째 예약 시각과 클릭 단계가 일치하지 않습니다.")
                for key in ("submit", "confirm"):
                    step = by_id.get(f"{key}-{number}")
                    if not step or step.required_text != f"{booking.start_time} ~ {booking.end_time}":
                        raise ValueError(f"{number}번째 예약 시각과 확인 단계가 일치하지 않습니다.")
        return self
