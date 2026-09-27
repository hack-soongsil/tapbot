"""Camera capture, coordinate calibration, and reusable visual detectors."""

from tapbot.vision.canonical import CanonicalVisionPipeline, CanonicalVisionResult
from tapbot.vision.calibration import (
    Calibration,
    CalibrationError,
    CalibrationNotFoundError,
    CalibrationStore,
    CoordinateOutOfBoundsError,
    CoordinateTransformError,
    Point2D,
    RobotWorkArea,
)
from tapbot.vision.detector import (
    BoundingBox,
    ColorButtonConfig,
    ColorButtonDetector,
    Detection,
    Detector,
    VisionPipeline,
    VisionResult,
    draw_debug_overlay,
    save_debug_overlay,
)

__all__ = [
    "BoundingBox",
    "Calibration",
    "CalibrationError",
    "CalibrationNotFoundError",
    "CalibrationStore",
    "CanonicalVisionPipeline",
    "CanonicalVisionResult",
    "ColorButtonConfig",
    "ColorButtonDetector",
    "CoordinateOutOfBoundsError",
    "CoordinateTransformError",
    "Detection",
    "Detector",
    "Point2D",
    "RobotWorkArea",
    "VisionPipeline",
    "VisionResult",
    "draw_debug_overlay",
    "save_debug_overlay",
]
