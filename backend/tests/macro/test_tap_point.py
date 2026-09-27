import math
import random

import pytest

from tapbot.macro import (
    TapBounds,
    TapPointSampler,
    TapPointSamplingPolicy,
)


def test_samples_stay_inside_edge_inset_safe_bounds() -> None:
    sampler = TapPointSampler(seed=42)
    bounds = TapBounds(100, 200, 300, 260)

    samples = [sampler.sample_with_trace(bounds) for _ in range(1_000)]

    assert samples[0].safe_bounds == TapBounds(130, 209, 270, 251)
    assert all(sample.safe_bounds is not None for sample in samples)
    assert all(sample.safe_bounds.contains(sample.point) for sample in samples if sample.safe_bounds)
    assert all(bounds.contains(sample.point) for sample in samples)


@pytest.mark.parametrize(
    "bounds",
    [
        (0, 0, 0, 10),
        (0, 0, 10, 0),
        (10, 0, 0, 10),
        (0, 10, 10, 0),
        (math.nan, 0, 10, 10),
        (0, 0, math.inf, 10),
    ],
)
def test_invalid_bounds_are_rejected(bounds: tuple[float, float, float, float]) -> None:
    with pytest.raises(ValueError):
        TapBounds(*bounds)


def test_seeded_sampling_is_deterministic_and_seed_specific() -> None:
    bounds = TapBounds(10, 20, 210, 120)
    first = TapPointSampler(seed=123)
    second = TapPointSampler(seed=123)
    different = TapPointSampler(seed=321)

    first_points = [first.sample(bounds) for _ in range(8)]
    second_points = [second.sample(bounds) for _ in range(8)]
    different_points = [different.sample(bounds) for _ in range(8)]

    assert first_points == second_points
    assert first_points != different_points


def test_rng_can_be_injected_per_sample() -> None:
    sampler = TapPointSampler(seed=1)
    bounds = TapBounds(0, 0, 100, 100)

    point = sampler.sample(bounds, rng=random.Random(99))
    repeated = sampler.sample(bounds, rng=random.Random(99))

    assert point == repeated


def test_disabled_randomization_uses_exact_original_center() -> None:
    sampler = TapPointSampler(TapPointSamplingPolicy(enabled=False), seed=42)

    sample = sampler.sample_with_trace(TapBounds(10, 20, 90, 60))

    assert sample.point.x == 50
    assert sample.point.y == 40
    assert sample.mode == "center-disabled"
    assert sample.randomization_enabled is False


def test_tiny_element_uses_small_jitter_without_collapsing_safe_bounds() -> None:
    bounds = TapBounds(5, 7, 9, 10)
    sample = TapPointSampler(seed=42).sample_with_trace(bounds)

    assert sample.mode == "small-element-jitter"
    assert sample.safe_bounds is not None
    assert sample.safe_bounds.width > 0
    assert sample.safe_bounds.height > 0
    assert sample.safe_bounds.contains(sample.point)


class RecordingRng:
    def __init__(self) -> None:
        self.sigmas: list[float] = []

    def gauss(self, mu: float, sigma: float) -> float:
        self.sigmas.append(sigma)
        return mu


def test_huge_element_caps_gaussian_jitter() -> None:
    rng = RecordingRng()
    sampler = TapPointSampler(rng=rng)

    sample = sampler.sample_with_trace(TapBounds(0, 0, 10_000, 5_000))

    assert sample.mode == "gaussian"
    assert rng.sigmas == [48.0, 48.0]


class OutsideRng:
    def __init__(self) -> None:
        self.calls = 0

    def gauss(self, mu: float, sigma: float) -> float:
        self.calls += 1
        return mu + 1_000_000


def test_max_attempts_fall_back_to_safe_center() -> None:
    rng = OutsideRng()
    sampler = TapPointSampler(
        TapPointSamplingPolicy(max_attempts=3),
        rng=rng,
    )

    sample = sampler.sample_with_trace(TapBounds(0, 0, 100, 100))

    assert sample.mode == "center-fallback"
    assert sample.safe_bounds is not None
    assert sample.point == sample.safe_bounds.center
    assert rng.calls == 6


def test_distribution_is_center_weighted() -> None:
    sampler = TapPointSampler(seed=2026)
    bounds = TapBounds(0, 0, 200, 100)
    points = [sampler.sample(bounds) for _ in range(1_000)]
    center = bounds.center

    mean_x = sum(point.x for point in points) / len(points)
    mean_y = sum(point.y for point in points) / len(points)
    central = sum(
        abs(point.x - center.x) <= 20 and abs(point.y - center.y) <= 10
        for point in points
    )
    outer = sum(
        abs(point.x - center.x) >= 50 or abs(point.y - center.y) >= 25
        for point in points
    )

    assert mean_x == pytest.approx(center.x, abs=3)
    assert mean_y == pytest.approx(center.y, abs=2)
    assert central > outer
