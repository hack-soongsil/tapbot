"""Build injected FastAPI graphs without putting fakes in production code."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from fastapi import FastAPI

from tapbot.android.client import AndroidAgentClient
from tapbot.android.device_registry import AndroidDeviceRegistry
from tapbot.android.service import AndroidService
from tapbot.app import create_app
from tapbot.vision.camera.manager import CameraManager
from tapbot.vision.camera.source import CameraSource
from tapbot.config import AndroidSettings, CameraSettings, PathSettings, RobotSettings, TapBotConfig
from tapbot.instances import create_instances
from tapbot.robot.controller import RobotController
from tapbot.robot.models import WorkspaceBounds
from tapbot.vision.calibration import CalibrationStore
from tapbot.vision.detector import Detector


def create_test_app(
    *,
    robot: RobotController,
    camera: CameraSource | None = None,
    camera_manager: CameraManager | None = None,
    bounds: WorkspaceBounds | None = None,
    camera_fps: float = 20.0,
    calibration_store: CalibrationStore | None = None,
    vision_detectors: Sequence[Detector] | None = None,
    android_client: AndroidAgentClient | None = None,
    android_debug_service: AndroidService | None = None,
    android_registry: AndroidDeviceRegistry | None = None,
    android_capture_dir: str | Path | None = None,
    android_discovery_token: str | None = None,
) -> FastAPI:
    if camera is not None and camera_manager is not None:
        raise ValueError("Provide either camera or camera_manager, not both")
    if camera_manager is None and camera is None:
        raise ValueError("A camera source or manager must be provided")
    workspace = bounds or WorkspaceBounds()
    capture_dir = Path(android_capture_dir or "tapbot-captures/android")
    config = TapBotConfig(
        android=AndroidSettings(
            capture_dir=capture_dir,
            discovery_enabled=False,
            discovery_token=android_discovery_token,
        ),
        robot=RobotSettings(
            workspace_width=workspace.max_x,
            workspace_height=workspace.max_y,
            dry_run=True,
        ),
        camera=CameraSettings(fps=camera_fps),
        paths=PathSettings(macro_trace_dir=capture_dir),
    )
    instances = create_instances(
        config,
        robot=robot,
        camera=camera,
        camera_manager=camera_manager,
        calibration_store=calibration_store,
        vision_detectors=vision_detectors,
        android_client=android_client,
        android_service=android_debug_service,
        android_registry=android_registry,
    )
    instances.robot_service.bounds = workspace
    instances.vision_service.bounds = workspace
    return create_app(instances)
