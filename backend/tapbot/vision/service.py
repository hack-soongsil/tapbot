"""Camera, calibration, and reusable detector application services."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime, timezone
import itertools
import math
from threading import Event, Lock, Thread
from time import perf_counter

import cv2
import numpy as np
from numpy.typing import NDArray

from tapbot.vision.camera.manager import CameraManager
from tapbot.vision.camera.source import CameraError, CameraSource
from tapbot.events import EventLog
from tapbot.robot.models import WorkspaceBounds
from tapbot.vision.calibration import (
    Calibration,
    CalibrationError,
    CalibrationNotFoundError,
    CalibrationStore,
    Point2D,
    RobotWorkArea,
)
from tapbot.vision.detector import Detector, VisionPipeline
from tapbot.vision.models import (
    CalibrationInput,
    CalibrationNotConfiguredError,
    CameraFrameSnapshot,
    CameraSwitchUnsupportedError,
    CameraUnavailableError,
    VisionResourceNotFoundError,
    VisionRunInput,
    VisionValidationError,
)


class CameraFrameWorker:
    """Capture and JPEG-encode robot-camera frames off the HTTP event loop."""

    def __init__(
        self,
        camera: CameraSource,
        event_log: EventLog,
        *,
        fps: float = 20.0,
        encoder: Callable[[str, NDArray[np.uint8]], tuple[bool, NDArray[np.uint8]]] = cv2.imencode,
    ) -> None:
        if fps <= 0:
            raise ValueError("fps must be positive")
        self.camera = camera
        self._event_log = event_log
        self._frame_interval = 1 / fps
        self._encoder = encoder
        self._stop = Event()
        self._lock = Lock()
        self._thread: Thread | None = None
        self._frame: NDArray[np.uint8] | None = None
        self._snapshot: CameraFrameSnapshot | None = None
        self._frame_ids = itertools.count(1)
        self._frozen_frames: dict[int, NDArray[np.uint8]] = {}
        self._error: str | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = Thread(target=self._run, name="tapbot-camera-capture", daemon=True)
        self._thread.start()

    def stop(self, *, timeout: float = 2.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout)
        self.camera.close()
        self._thread = None

    def latest_frame(self) -> CameraFrameSnapshot | None:
        with self._lock:
            return self._snapshot

    def freeze_latest_frame(self) -> CameraFrameSnapshot | None:
        with self._lock:
            if self._snapshot is None or self._frame is None:
                return None
            self._frozen_frames[self._snapshot.frame_id] = self._frame.copy()
            while len(self._frozen_frames) > 8:
                del self._frozen_frames[next(iter(self._frozen_frames))]
            return self._snapshot

    def frozen_bgr_frame(self, frame_id: int) -> NDArray[np.uint8] | None:
        with self._lock:
            frame = self._frozen_frames.get(frame_id)
            return None if frame is None else frame.copy()

    @property
    def error(self) -> str | None:
        with self._lock:
            return self._error

    def clear(self) -> None:
        with self._lock:
            self._frame = None
            self._snapshot = None
            self._frozen_frames.clear()
            self._error = None

    def _run(self) -> None:
        try:
            self.camera.open()
            self._event_log.add(f"Camera opened: {self._source_id()!r}")
            while not self._stop.is_set():
                started = perf_counter()
                try:
                    read = getattr(self.camera, "read_frame_with_metadata", None)
                    if callable(read):
                        frame, source_id, metadata = read()
                    else:
                        frame = self.camera.read_frame()
                        source_id = self._source_id()
                        metadata_getter = getattr(self.camera, "get_metadata", None)
                        metadata = dict(metadata_getter()) if callable(metadata_getter) else {}
                    success, encoded = self._encoder(".jpg", frame)
                    if not success:
                        raise CameraError("Failed to encode camera frame as JPEG")
                    height, width = frame.shape[:2]
                    snapshot = CameraFrameSnapshot(
                        next(self._frame_ids),
                        datetime.now(timezone.utc).isoformat(),
                        width,
                        height,
                        encoded.tobytes(),
                        str(source_id),
                        dict(metadata),
                    )
                    with self._lock:
                        self._frame = frame.copy()
                        self._snapshot = snapshot
                        self._error = None
                    self._event_log.add(
                        f"Camera frame {snapshot.frame_id} captured",
                        level="debug",
                        event_type="camera.frame",
                        category="camera",
                        status="success",
                        trace_id=f"frame-{snapshot.frame_id}",
                        payload={"frame_id": snapshot.frame_id, "captured_at": snapshot.captured_at, "width": width, "height": height, "source_id": str(source_id)},
                    )
                except CameraError as error:
                    with self._lock:
                        self._error = str(error)
                    self._event_log.add(f"Camera error: {error}", level="error", event_type="camera.error", category="camera", status="error", payload={"error": str(error)})
                self._stop.wait(max(0.0, self._frame_interval - (perf_counter() - started)))
        except Exception as error:
            with self._lock:
                self._error = str(error)
            self._event_log.add(f"Camera open error: {error}", level="error")
        finally:
            self.camera.close()

    def _source_id(self) -> str:
        return str(getattr(self.camera, "id", getattr(self.camera, "source", type(self.camera).__name__)))


class VisionService:
    """Transport-independent robot-camera, calibration, and detector use cases."""

    def __init__(
        self,
        camera: CameraSource,
        worker: CameraFrameWorker,
        event_log: EventLog,
        detectors: Sequence[Detector],
        calibration_store: CalibrationStore,
        bounds: WorkspaceBounds,
        *,
        camera_manager: CameraManager | None = None,
    ) -> None:
        self.camera = camera
        self.camera_manager = camera_manager
        self.event_log = event_log
        self.detectors = tuple(detectors)
        self.calibration_store = calibration_store
        self.bounds = bounds
        self.worker = worker
        self._calibration_lock = Lock()
        self._frame_lock = Lock()
        self._result_lock = Lock()
        self._saved_frames: dict[int, CameraFrameSnapshot] = {}
        self._result_images: dict[int, bytes] = {}
        self._result_ids = itertools.count(1)
        try:
            self._active_calibration: Calibration | None = calibration_store.load()
            event_log.add(f"Loaded calibration profile: {self._active_calibration.profile_name}")
        except CalibrationNotFoundError:
            self._active_calibration = None
        except CalibrationError as error:
            self._active_calibration = None
            event_log.add(f"Calibration load error: {error}", level="error")

    def start(self) -> None:
        self.worker.start()

    def stop(self) -> None:
        self.worker.stop()

    @property
    def active_calibration_name(self) -> str | None:
        with self._calibration_lock:
            return None if self._active_calibration is None else self._active_calibration.profile_name

    @property
    def detector_names(self) -> list[str]:
        return [type(detector).__name__ for detector in self.detectors]

    def camera_sources(self, *, refresh: bool = False) -> dict[str, object]:
        if self.camera_manager is not None:
            descriptors = self.camera_manager.list_sources(refresh=refresh)
            return {"active_id": self.camera_manager.active_source_id, "sources": [item.to_dict() for item in descriptors]}
        source_id = self._source_id()
        getter = getattr(self.camera, "get_metadata", None)
        metadata = getter() if callable(getter) else {"width": 0, "height": 0, "fps": 0, "type": "physical", "name": type(self.camera).__name__}
        return {"active_id": source_id, "sources": [{"id": source_id, "name": str(metadata.get("name", type(self.camera).__name__)), "type": str(metadata.get("type", "physical")), "available": self.camera.is_opened(), "metadata": metadata}]}

    def camera_status(self) -> dict[str, object]:
        snapshot = self.worker.latest_frame()
        if self.camera_manager is not None:
            result = self.camera_manager.status()
        else:
            opened = self.camera.is_opened()
            result = {"source_id": self._source_id(), "name": getattr(self.camera, "name", type(self.camera).__name__), "type": getattr(self.camera, "source_type", "physical"), "opened": opened, "connected": opened, "state": "connected" if opened else "disconnected", "error": None, "metadata": None, "discovery_completed": False}
        if self.worker.error is not None:
            result.update(state="error", connected=False, error=self.worker.error)
        result["frame_id"] = None if snapshot is None else snapshot.frame_id
        return result

    def select_camera_source(self, source_id: str) -> dict[str, object]:
        if self.camera_manager is None:
            raise CameraSwitchUnsupportedError("The injected camera source cannot be switched")
        self.worker.stop()
        self.worker.clear()
        try:
            self.camera_manager.select(source_id)
        except Exception:
            self.worker.start()
            raise
        self.worker.start()
        self.event_log.add(f"Camera source selected: {source_id}", event_type="camera.source", category="camera", status="success", payload={"source_id": source_id})
        return {"active_id": self.camera_manager.active_source_id, "metadata": self.camera_manager.get_metadata()}

    def reconnect_camera(self) -> dict[str, object]:
        if self.camera_manager is None:
            raise CameraSwitchUnsupportedError("The injected camera source cannot be reconnected")
        self.worker.stop()
        self.worker.clear()
        try:
            self.camera_manager.reconnect()
        except Exception:
            self.worker.start()
            raise
        self.worker.start()
        self.event_log.add(f"Camera source reconnected: {self.camera_manager.active_source_id}", event_type="camera.reconnect", category="camera", status="success", payload={"source_id": self.camera_manager.active_source_id})
        return self.camera_manager.status()

    def camera_frame(self, *, freeze: bool = False) -> CameraFrameSnapshot:
        snapshot = self.worker.freeze_latest_frame() if freeze else self.worker.latest_frame()
        if snapshot is None:
            raise CameraUnavailableError(self.worker.error or "Camera frame is not available yet")
        return snapshot

    def calibration_profiles(self) -> dict[str, object]:
        return {"profiles": self.calibration_store.list_profiles(), "active_profile": self.active_calibration_name}

    def get_calibration(self, profile: str | None = None) -> dict[str, object]:
        if profile is not None:
            return self._calibration_response(self.calibration_store.load(profile))
        with self._calibration_lock:
            calibration = self._active_calibration
        return {"configured": False, "calibration": None} if calibration is None else self._calibration_response(calibration)

    def save_calibration(self, value: CalibrationInput) -> dict[str, object]:
        calibration = self._build_calibration(value)
        self.calibration_store.save(calibration)
        with self._calibration_lock:
            self._active_calibration = calibration
        self.event_log.add(f"Calibration saved: {calibration.profile_name}")
        return self._calibration_response(calibration)

    def activate_calibration(self, profile: str) -> dict[str, object]:
        calibration = self.calibration_store.load(profile)
        self.calibration_store.save(calibration)
        with self._calibration_lock:
            self._active_calibration = calibration
        self.event_log.add(f"Calibration activated: {calibration.profile_name}")
        return self._calibration_response(calibration)

    def transform(self, operation: str, x: float, y: float) -> dict[str, object]:
        calibration = self._current_calibration()
        methods = {"screen-to-robot": ("robot", calibration.screen_to_robot), "robot-to-screen": ("screen", calibration.robot_to_screen), "camera-to-robot": ("robot", calibration.camera_to_robot)}
        key, method = methods[operation]
        point = method(x, y)
        self.event_log.add(f"Calibration transform {operation}: ({point.x}, {point.y})")
        return {key: {"x": point.x, "y": point.y}}

    def vision_capabilities(self) -> dict[str, object]:
        return {"detectors": [self._descriptor(item) for item in self.detectors], "max_saved_frames": 8}

    def vision_frames(self) -> dict[str, object]:
        with self._frame_lock:
            frames = list(self._saved_frames.values())
        return {"frames": [self._frame_metadata(frame) for frame in reversed(frames)]}

    def save_vision_frame(self) -> dict[str, object]:
        snapshot = self.camera_frame(freeze=True)
        with self._frame_lock:
            self._saved_frames[snapshot.frame_id] = snapshot
            while len(self._saved_frames) > 8:
                del self._saved_frames[next(iter(self._saved_frames))]
        self.event_log.add(f"Vision frame saved: {snapshot.frame_id}")
        return {"frame": self._frame_metadata(snapshot)}

    def raw_vision_frame(self, frame_id: int) -> bytes:
        with self._frame_lock:
            snapshot = self._saved_frames.get(frame_id)
        if snapshot is None:
            raise VisionResourceNotFoundError("Saved vision frame not found")
        return snapshot.jpeg

    def run_vision(self, value: VisionRunInput) -> dict[str, object]:
        if not math.isfinite(value.confidence_threshold) or not 0 <= value.confidence_threshold <= 1:
            raise VisionValidationError("confidence_threshold must be between 0 and 1")
        with self._frame_lock:
            snapshot = self._saved_frames.get(value.frame_id)
        frame = self.worker.frozen_bgr_frame(value.frame_id)
        if snapshot is None or frame is None:
            raise VisionResourceNotFoundError("Saved vision frame not found")
        descriptors = [(item, self._descriptor(item)) for item in self.detectors]
        available = {descriptor["type"] for _, descriptor in descriptors}
        selected = available if value.detector_types is None else set(value.detector_types)
        unknown = selected - available
        if unknown:
            raise VisionValidationError(f"Unknown detector types: {', '.join(sorted(unknown))}")
        started = perf_counter()
        result = VisionPipeline([item for item, descriptor in descriptors if descriptor["type"] in selected]).process(frame)
        detections = tuple(item for item in result.detections if item.confidence >= value.confidence_threshold)
        success, encoded = cv2.imencode(".jpg", result.image)
        if not success:
            raise VisionValidationError("Could not encode vision frame")
        result_id = next(self._result_ids)
        with self._result_lock:
            self._result_images[result_id] = encoded.tobytes()
            while len(self._result_images) > 12:
                del self._result_images[next(iter(self._result_images))]
        names = {descriptor["type"]: descriptor["name"] for _, descriptor in descriptors}
        values: list[dict[str, object]] = []
        for index, detection in enumerate(detections, start=1):
            item = detection.to_dict()
            item.update(id=f"result-{result_id}-detection-{index}", detector_name=names.get(detection.detector_type, detection.detector_type))
            values.append(item)
        height, width = result.image.shape[:2]
        self.event_log.add(f"Vision detected {len(values)} objects", event_type="vision.detected", category="vision", status="success", trace_id=f"frame-{value.frame_id}", latency_ms=(perf_counter() - started) * 1000, payload={"frame_id": value.frame_id, "result_id": result_id, "detector_types": sorted(selected), "confidence_threshold": value.confidence_threshold, "detections": values})
        return {"result_id": result_id, "frame": self._frame_metadata(snapshot), "image": {"width": width, "height": height}, "detector_types": sorted(selected), "confidence_threshold": value.confidence_threshold, "detections": values}

    def vision_result_image(self, result_id: int) -> bytes:
        with self._result_lock:
            image = self._result_images.get(result_id)
        if image is None:
            raise VisionResourceNotFoundError("Vision result not found")
        return image

    def _current_calibration(self) -> Calibration:
        with self._calibration_lock:
            calibration = self._active_calibration
        if calibration is None:
            raise CalibrationNotConfiguredError("Calibration is not configured")
        return calibration

    def _build_calibration(self, value: CalibrationInput) -> Calibration:
        if len(value.camera_corners) != 4 or len(value.robot_points) != 4:
            raise VisionValidationError("Exactly four camera corners and robot points are required")
        if (value.camera_width is None) != (value.camera_height is None):
            raise VisionValidationError("camera_width and camera_height must be supplied together")
        resolution = None if value.camera_width is None else (value.camera_width, value.camera_height)  # type: ignore[arg-type]
        return Calibration(value.profile_name, tuple(Point2D(p.x, p.y) for p in value.camera_corners), tuple(Point2D(p.x, p.y) for p in value.robot_points), value.screen_width, value.screen_height, RobotWorkArea(self.bounds.min_x, self.bounds.max_x, self.bounds.min_y, self.bounds.max_y), camera_resolution=resolution)  # type: ignore[arg-type]

    @staticmethod
    def _calibration_response(calibration: Calibration) -> dict[str, object]:
        return {"configured": True, "calibration": calibration.to_dict()}

    @staticmethod
    def _descriptor(detector: Detector) -> dict[str, str]:
        return {"type": str(getattr(detector, "detector_type", type(detector).__name__)), "name": type(detector).__name__}

    @staticmethod
    def _frame_metadata(snapshot: CameraFrameSnapshot) -> dict[str, object]:
        return {"frame_id": snapshot.frame_id, "captured_at": snapshot.captured_at, "width": snapshot.width, "height": snapshot.height, "source_id": snapshot.source_id}

    def _source_id(self) -> str:
        return str(getattr(self.camera, "id", getattr(self.camera, "source", type(self.camera).__name__)))
