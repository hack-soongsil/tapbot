from pathlib import Path

import cv2
import numpy as np

from tapbot.vision.calibration import Point2D
from tapbot.vision.detector import (
    BoundingBox,
    ColorButtonConfig,
    ColorButtonDetector,
    VisionPipeline,
    draw_debug_overlay,
    save_debug_overlay,
)


FIXTURE = Path(__file__).parent / "fixtures" / "green_button.ppm"


def fixture_detector() -> ColorButtonDetector:
    return ColorButtonDetector(
        ColorButtonConfig(min_area=10, morphology_kernel_size=1)
    )


def test_saved_image_detection_is_reproducible() -> None:
    image = cv2.imread(str(FIXTURE), cv2.IMREAD_COLOR)
    assert image is not None
    detector = fixture_detector()

    first = detector.detect(image)
    second = detector.detect(image.copy())

    assert first == second
    assert len(first) == 1
    assert first[0].label == "green_button"
    assert first[0].bbox == BoundingBox(x=5, y=3, width=10, height=6)
    assert first[0].center == Point2D(10, 6)
    assert first[0].detector_type == "opencv_color_contour"
    assert 0.7 < first[0].confidence <= 1


def test_detector_ignores_shapes_below_minimum_area() -> None:
    image = np.zeros((30, 30, 3), dtype=np.uint8)
    image[5:8, 5:8] = (0, 255, 0)

    detections = ColorButtonDetector(
        ColorButtonConfig(min_area=20, morphology_kernel_size=1)
    ).detect(image)

    assert detections == []


def test_pipeline_runs_directly_on_input_without_changing_pixels() -> None:
    image = cv2.imread(str(FIXTURE), cv2.IMREAD_COLOR)
    assert image is not None
    original = image.copy()

    result = VisionPipeline([fixture_detector()]).process(image)

    assert result.image is image
    assert np.array_equal(result.image, original)
    assert len(result.detections) == 1


def test_debug_overlay_draws_bbox_label_and_center(tmp_path: Path) -> None:
    image = cv2.imread(str(FIXTURE), cv2.IMREAD_COLOR)
    assert image is not None
    detections = fixture_detector().detect(image)

    overlay = draw_debug_overlay(image, detections)
    output_path = save_debug_overlay(tmp_path / "overlay.png", image, detections)

    assert not np.array_equal(overlay, image)
    assert output_path.exists()
    assert cv2.imread(str(output_path)) is not None
