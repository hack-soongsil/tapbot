"""Small cross-domain read model for backend health and event inspection."""

from __future__ import annotations

from dataclasses import asdict

from tapbot.android.device_registry import AndroidDeviceRegistry
from tapbot.events import EventLog
from tapbot.robot.service import RobotService
from tapbot.vision.service import VisionService


class SystemService:
    def __init__(
        self,
        robot: RobotService,
        vision: VisionService,
        android: AndroidDeviceRegistry,
        events: EventLog,
    ) -> None:
        self.robot = robot
        self.vision = vision
        self.android = android
        self.events = events

    def status(self) -> dict[str, object]:
        robot_status = self.robot.status()
        snapshot = self.vision.worker.latest_frame()
        default_id = self.android.default_device_id
        android_service = (
            None if default_id is None else self.android.get(default_id).debug_service
        )
        return {
            "robot": type(self.robot.controller).__name__,
            "robot_connected": robot_status["connected"],
            "robot_mode": robot_status["mode"],
            "robot_busy": robot_status["busy"],
            "camera_opened": self.vision.camera.is_opened(),
            "camera_error": self.vision.worker.error,
            "camera_frame_id": None if snapshot is None else snapshot.frame_id,
            "camera_source_id": str(
                getattr(
                    self.vision.camera,
                    "id",
                    getattr(
                        self.vision.camera,
                        "source",
                        type(self.vision.camera).__name__,
                    ),
                )
            ),
            "camera_source_type": getattr(self.vision.camera, "source_type", "physical"),
            "robot_queue_depth": robot_status["queue_depth"],
            "workspace": robot_status["workspace"],
            "calibration_profile": self.vision.active_calibration_name,
            "vision_detectors": self.vision.detector_names,
            "android_configured": bool(self.android.list()),
            "android_macro_status": (
                None if android_service is None else android_service.macro_status
            ),
        }

    def logs(self, after_id: int = 0) -> dict[str, object]:
        return {"entries": [asdict(entry) for entry in self.events.entries(after_id=after_id)]}
