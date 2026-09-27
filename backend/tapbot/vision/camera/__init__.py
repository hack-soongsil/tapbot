"""Camera source abstractions and source management."""

from tapbot.vision.camera.descriptors import CameraSourceDescriptor
from tapbot.vision.camera.image_source import ImageCameraSource
from tapbot.vision.camera.manager import CameraManager, CameraSourceNotFoundError
from tapbot.vision.camera.opencv_source import OpenCVCameraSource, create_opencv_capture
from tapbot.vision.camera.source import (
    BGRFrame,
    CameraError,
    CameraMetadata,
    CameraNotOpenError,
    CameraOpenError,
    CameraReadError,
    CameraSource,
    CameraSourceType,
)
from tapbot.vision.camera.video_source import VideoCameraSource

__all__ = [
    "BGRFrame",
    "CameraError",
    "CameraManager",
    "CameraMetadata",
    "CameraNotOpenError",
    "CameraOpenError",
    "CameraReadError",
    "CameraSource",
    "CameraSourceDescriptor",
    "CameraSourceNotFoundError",
    "CameraSourceType",
    "ImageCameraSource",
    "OpenCVCameraSource",
    "create_opencv_capture",
    "VideoCameraSource",
]
