"""Robot application-service models."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class WorkspaceBounds:
    min_x: float = 0
    max_x: float = 1000
    min_y: float = 0
    max_y: float = 1000


class CoordinateValidationError(ValueError):
    pass
