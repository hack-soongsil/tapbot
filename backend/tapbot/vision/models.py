"""Models shared by the vision application service and HTTP adapter."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class CameraFrameSnapshot:
    frame_id: int
    captured_at: str
    width: int
    height: int
    jpeg: bytes
    source_id: str | None = None
    source_metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PointInput:
    x: float
    y: float


@dataclass(frozen=True, slots=True)
class CalibrationInput:
    profile_name: str
    camera_corners: tuple[PointInput, ...]
    robot_points: tuple[PointInput, ...]
    screen_width: float
    screen_height: float
    camera_width: int | None = None
    camera_height: int | None = None
    frame_id: int | None = None


@dataclass(frozen=True, slots=True)
class VisionRunInput:
    frame_id: int
    detector_types: tuple[str, ...] | None = None
    confidence_threshold: float = 0.0


class CameraUnavailableError(RuntimeError):
    """The capture worker has not produced a usable frame."""


class CameraSwitchUnsupportedError(RuntimeError):
    """The injected source does not support source management."""


class VisionResourceNotFoundError(LookupError):
    """A saved vision frame or result does not exist."""


class VisionValidationError(ValueError):
    """A vision use-case request is invalid."""


class CalibrationNotConfiguredError(RuntimeError):
    """No calibration profile is active."""
