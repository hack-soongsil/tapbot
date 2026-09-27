import asyncio
from pathlib import Path
import numpy as np

from tapbot.config import (
    AndroidSettings,
    ModelSettings,
    PathSettings,
    RobotSettings,
    TapBotConfig,
)
from tapbot.instances import create_instances
from tapbot.android.discovery import TailscaleDiscoveryError
from tapbot.model.client import HttpModelClient
from tests.fakes import FakeRobotController


class FakeCamera:
    source = "instances-camera"

    def __init__(self) -> None:
        self.opened = False
        self.close_count = 0

    def open(self) -> None:
        self.opened = True

    def close(self) -> None:
        self.opened = False
        self.close_count += 1

    def is_opened(self) -> bool:
        return self.opened

    def read_frame(self) -> np.ndarray:
        return np.zeros((8, 12, 3), dtype=np.uint8)


def test_composition_root_exposes_one_process_scoped_graph(tmp_path: Path) -> None:
    camera = FakeCamera()
    robot = FakeRobotController()
    config = TapBotConfig(
        android=AndroidSettings(
            capture_dir=tmp_path / "captures",
            discovery_enabled=False,
        ),
        robot=RobotSettings(dry_run=True),
        model=ModelSettings(endpoint="http://model.test/decide"),
        paths=PathSettings(
            calibration_file=tmp_path / "calibrations.json",
            macro_trace_dir=tmp_path / "traces",
        ),
    )

    instances = create_instances(config, robot=robot, camera=camera)

    assert instances.robot_service.controller is robot
    assert instances.vision_service.camera is camera
    assert instances.system_service.robot is instances.robot_service
    assert instances.system_service.vision is instances.vision_service
    assert instances.android_http.registry is instances.android_registry
    assert isinstance(instances.model_client, HttpModelClient)
    assert instances.model_service is not None
    assert instances.model_service.client is instances.model_client


def test_lifecycle_is_idempotent_and_releases_background_worker(tmp_path: Path) -> None:
    camera = FakeCamera()
    instances = create_instances(
        TapBotConfig(
            android=AndroidSettings(discovery_enabled=False),
            robot=RobotSettings(dry_run=True),
            paths=PathSettings(calibration_file=tmp_path / "calibrations.json"),
        ),
        robot=FakeRobotController(),
        camera=camera,
    )

    async def exercise() -> None:
        await instances.start()
        await instances.start()
        for _ in range(50):
            if instances.vision_service.worker.latest_frame() is not None:
                break
            await asyncio.sleep(0.01)
        await instances.stop()
        await instances.stop()

    asyncio.run(exercise())

    assert instances.robot_service.dispatcher._thread is None
    assert instances.vision_service.worker._thread is None
    assert camera.opened is False
    assert camera.close_count >= 1


class MissingTailscaleProvider:
    def peers(self):
        raise TailscaleDiscoveryError(
            "Tailscale CLI is not installed",
            tailscale_available=False,
        )


def test_missing_tailscale_does_not_fail_application_lifecycle(tmp_path: Path) -> None:
    instances = create_instances(
        TapBotConfig(
            android=AndroidSettings(
                discovery_enabled=True,
                discovery_token="secret",
                discovery_interval_sec=60,
            ),
            robot=RobotSettings(dry_run=True),
            paths=PathSettings(calibration_file=tmp_path / "calibrations.json"),
        ),
        robot=FakeRobotController(),
        camera=FakeCamera(),
        android_peer_provider=MissingTailscaleProvider(),
    )

    async def exercise() -> None:
        await instances.start()
        for _ in range(50):
            if instances.android_discovery.status()["last_refresh"] is not None:
                break
            await asyncio.sleep(0.01)
        await instances.stop()

    asyncio.run(exercise())

    status = instances.android_discovery.status()
    assert status["tailscale_available"] is False
    assert status["last_error"] == "Tailscale CLI is not installed"
    assert instances.android_discovery._thread is None
