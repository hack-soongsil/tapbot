"""Center-weighted safe tap-point sampling for resolved macro targets."""

from __future__ import annotations

from dataclasses import dataclass
import math
import random
from typing import Protocol


class RandomSource(Protocol):
    def gauss(self, mu: float, sigma: float) -> float: ...


@dataclass(frozen=True, slots=True)
class TapBounds:
    left: float
    top: float
    right: float
    bottom: float

    def __post_init__(self) -> None:
        values = (self.left, self.top, self.right, self.bottom)
        if any(not math.isfinite(value) for value in values):
            raise ValueError("tap bounds must be finite")
        if self.right <= self.left or self.bottom <= self.top:
            raise ValueError("tap bounds must have positive width and height")

    @classmethod
    def from_xywh(
        cls,
        x: float,
        y: float,
        width: float,
        height: float,
    ) -> TapBounds:
        if any(not math.isfinite(value) for value in (x, y, width, height)):
            raise ValueError("tap bounds must be finite")
        return cls(x, y, x + width, y + height)

    @property
    def width(self) -> float:
        return self.right - self.left

    @property
    def height(self) -> float:
        return self.bottom - self.top

    @property
    def center(self) -> TapPoint:
        return TapPoint(
            (self.left + self.right) / 2,
            (self.top + self.bottom) / 2,
        )

    def contains(self, point: TapPoint) -> bool:
        return (
            self.left <= point.x <= self.right
            and self.top <= point.y <= self.bottom
        )

    def to_list(self) -> list[float]:
        return [self.left, self.top, self.right, self.bottom]


@dataclass(frozen=True, slots=True)
class TapPoint:
    x: float
    y: float

    def __post_init__(self) -> None:
        if not math.isfinite(self.x) or not math.isfinite(self.y):
            raise ValueError("tap point must be finite")

    def to_list(self) -> list[float]:
        return [self.x, self.y]


@dataclass(frozen=True, slots=True)
class TapPointSamplingPolicy:
    enabled: bool = True
    edge_inset_ratio: float = 0.15
    sigma_x_ratio: float = 0.15
    sigma_y_ratio: float = 0.15
    min_jitter_px: float = 1.0
    max_jitter_px: float = 48.0
    max_attempts: int = 8

    def __post_init__(self) -> None:
        if not isinstance(self.enabled, bool):
            raise ValueError("enabled must be a boolean")
        if (
            not math.isfinite(self.edge_inset_ratio)
            or not 0 <= self.edge_inset_ratio < 0.5
        ):
            raise ValueError("edge_inset_ratio must be between 0 and 0.5")
        for name, value in (
            ("sigma_x_ratio", self.sigma_x_ratio),
            ("sigma_y_ratio", self.sigma_y_ratio),
        ):
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be positive and finite")
        if not math.isfinite(self.min_jitter_px) or self.min_jitter_px <= 0:
            raise ValueError("min_jitter_px must be positive and finite")
        if (
            not math.isfinite(self.max_jitter_px)
            or self.max_jitter_px < self.min_jitter_px
        ):
            raise ValueError("max_jitter_px must be finite and >= min_jitter_px")
        if (
            isinstance(self.max_attempts, bool)
            or not isinstance(self.max_attempts, int)
            or self.max_attempts <= 0
        ):
            raise ValueError("max_attempts must be a positive integer")


@dataclass(frozen=True, slots=True)
class TapPointSample:
    point: TapPoint
    bounds: TapBounds | None
    safe_bounds: TapBounds | None
    mode: str
    randomization_enabled: bool

    def to_trace(self) -> dict[str, object]:
        return {
            "bounds": None if self.bounds is None else self.bounds.to_list(),
            "safe_bounds": (
                None if self.safe_bounds is None else self.safe_bounds.to_list()
            ),
            "tap_point": self.point.to_list(),
            "sampling": self.mode,
            "randomization_enabled": self.randomization_enabled,
        }


class TapPointSampler:
    """Sample one safe point with a private, injectable random source."""

    _SMALL_ELEMENT_PX = 24.0
    _SMALL_SIGMA_MAX_PX = 3.0

    def __init__(
        self,
        policy: TapPointSamplingPolicy | None = None,
        *,
        rng: RandomSource | None = None,
        seed: int | None = None,
    ) -> None:
        if rng is not None and seed is not None:
            raise ValueError("provide either rng or seed, not both")
        self.policy = policy or TapPointSamplingPolicy()
        self._rng = rng if rng is not None else random.Random(seed)

    def sample(
        self,
        bounds: TapBounds,
        *,
        rng: RandomSource | None = None,
    ) -> TapPoint:
        return self.sample_with_trace(bounds, rng=rng).point

    def sample_with_trace(
        self,
        bounds: TapBounds,
        *,
        rng: RandomSource | None = None,
    ) -> TapPointSample:
        safe = self.safe_bounds(bounds)
        if not self.policy.enabled:
            return TapPointSample(
                point=bounds.center,
                bounds=bounds,
                safe_bounds=safe,
                mode="center-disabled",
                randomization_enabled=False,
            )

        small = (
            safe.width < self._SMALL_ELEMENT_PX
            or safe.height < self._SMALL_ELEMENT_PX
        )
        if small:
            sigma_x = self._small_sigma(safe.width)
            sigma_y = self._small_sigma(safe.height)
            mode = "small-element-jitter"
        else:
            sigma_x = min(
                max(safe.width * self.policy.sigma_x_ratio, self.policy.min_jitter_px),
                self.policy.max_jitter_px,
            )
            sigma_y = min(
                max(
                    safe.height * self.policy.sigma_y_ratio,
                    self.policy.min_jitter_px,
                ),
                self.policy.max_jitter_px,
            )
            mode = "gaussian"

        source = rng if rng is not None else self._rng
        center = safe.center
        for _ in range(self.policy.max_attempts):
            x = source.gauss(center.x, sigma_x)
            y = source.gauss(center.y, sigma_y)
            if not math.isfinite(x) or not math.isfinite(y):
                continue
            point = TapPoint(x, y)
            if safe.contains(point):
                return TapPointSample(
                    point=point,
                    bounds=bounds,
                    safe_bounds=safe,
                    mode=mode,
                    randomization_enabled=True,
                )

        return TapPointSample(
            point=center,
            bounds=bounds,
            safe_bounds=safe,
            mode="center-fallback",
            randomization_enabled=True,
        )

    def safe_bounds(self, bounds: TapBounds) -> TapBounds:
        inset_x = self._safe_inset(bounds.width)
        inset_y = self._safe_inset(bounds.height)
        return TapBounds(
            bounds.left + inset_x,
            bounds.top + inset_y,
            bounds.right - inset_x,
            bounds.bottom - inset_y,
        )

    def _safe_inset(self, span: float) -> float:
        requested = span * self.policy.edge_inset_ratio
        minimum_safe_span = min(span, max(2 * self.policy.min_jitter_px, 1.0))
        maximum = max(0.0, (span - minimum_safe_span) / 2)
        return min(requested, maximum)

    def _small_sigma(self, safe_span: float) -> float:
        return min(
            max(self.policy.min_jitter_px, safe_span * 0.1),
            self._SMALL_SIGMA_MAX_PX,
            self.policy.max_jitter_px,
        )
