"""Deterministic injectable sampling for random point/drag macro nodes."""

from __future__ import annotations

from dataclasses import dataclass
import math
import random
from typing import Protocol

from tapbot.macro.tap_point import TapPoint


class AreaRandomSource(Protocol):
    def uniform(self, a: float, b: float) -> float: ...
    def gauss(self, mu: float, sigma: float) -> float: ...


@dataclass(frozen=True, slots=True)
class SamplingArea:
    left: float
    top: float
    right: float
    bottom: float

    def __post_init__(self) -> None:
        values = (self.left, self.top, self.right, self.bottom)
        if any(not math.isfinite(value) for value in values):
            raise ValueError("sampling area values must be finite")
        if self.left >= self.right or self.top >= self.bottom:
            raise ValueError("sampling area must have positive width and height")

    @property
    def width(self) -> float:
        return self.right - self.left

    @property
    def height(self) -> float:
        return self.bottom - self.top


class AreaPointSampler:
    def __init__(
        self,
        rng: AreaRandomSource | None = None,
        *,
        seed: int | None = None,
    ) -> None:
        if rng is not None and seed is not None:
            raise ValueError("provide rng or seed, not both")
        self.rng = rng or random.Random(seed)

    def sample(self, area: SamplingArea, sampling: dict[str, object]) -> TapPoint:
        sampling_type = sampling.get("type", "uniform")
        if sampling_type == "uniform":
            return TapPoint(
                self.rng.uniform(area.left, area.right),
                self.rng.uniform(area.top, area.bottom),
            )
        if sampling_type != "normal":
            raise ValueError(f"unsupported area sampling type: {sampling_type}")
        center_x = _ratio(sampling, "center_x", 0.5)
        center_y = _ratio(sampling, "center_y", 0.5)
        sigma_x = _positive_ratio(sampling, "sigma_x", 0.18)
        sigma_y = _positive_ratio(sampling, "sigma_y", 0.18)
        attempts = sampling.get("max_resample_attempts", 16)
        if isinstance(attempts, bool) or not isinstance(attempts, int) or attempts < 1:
            raise ValueError("max_resample_attempts must be a positive integer")
        mean_x = area.left + center_x * area.width
        mean_y = area.top + center_y * area.height
        last = TapPoint(mean_x, mean_y)
        for _ in range(attempts):
            last = TapPoint(
                self.rng.gauss(mean_x, sigma_x * area.width),
                self.rng.gauss(mean_y, sigma_y * area.height),
            )
            if area.left <= last.x <= area.right and area.top <= last.y <= area.bottom:
                return last
        return TapPoint(
            min(area.right, max(area.left, last.x)),
            min(area.bottom, max(area.top, last.y)),
        )


def validate_sampling(sampling: object, *, name: str = "sampling") -> tuple[str, ...]:
    if not isinstance(sampling, dict):
        return (f"{name} must be an object",)
    sampling_type = sampling.get("type", "uniform")
    if sampling_type not in {"uniform", "normal"}:
        return (f"{name}.type must be uniform or normal",)
    if sampling_type == "uniform":
        return ()
    errors: list[str] = []
    for key, default in (("center_x", 0.5), ("center_y", 0.5)):
        value = sampling.get(key, default)
        if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= 1:
            errors.append(f"{name}.{key} must be between 0 and 1")
    for key, default in (("sigma_x", 0.18), ("sigma_y", 0.18)):
        value = sampling.get(key, default)
        if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
            errors.append(f"{name}.{key} must be positive")
    attempts = sampling.get("max_resample_attempts", 16)
    if isinstance(attempts, bool) or not isinstance(attempts, int) or attempts < 1:
        errors.append(f"{name}.max_resample_attempts must be a positive integer")
    return tuple(errors)


def _ratio(config: dict[str, object], key: str, default: float) -> float:
    value = config.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int | float) or not 0 <= value <= 1:
        raise ValueError(f"{key} must be between 0 and 1")
    return float(value)


def _positive_ratio(config: dict[str, object], key: str, default: float) -> float:
    value = config.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
        raise ValueError(f"{key} must be positive")
    return float(value)
