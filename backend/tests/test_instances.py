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
from tapbot.instances import _AndroidGraphUi, create_instances
from tapbot.android.discovery import TailscaleDiscoveryError
from tapbot.model.client import HttpModelClient
from tests.fakes import FakeRobotController


class FakeCamera:
    source = "instances-camera"

    def __init__(self) -> None:
        self.opened = False
        self.open_count = 0
        self.close_count = 0

    def open(self) -> None:
        self.opened = True
        self.open_count += 1

    def close(self) -> None:
        self.opened = False
        self.close_count += 1

    def is_opened(self) -> bool:
        return self.opened

    def read_frame(self) -> np.ndarray:
        return np.zeros((8, 12, 3), dtype=np.uint8)


class StaticUiTreeProvider:
    def __init__(self, tree: object) -> None:
        self.tree = tree

    def snapshot(self, *, max_age_ms: int):
        return self.tree


class StaticAndroidContext:
    def __init__(self, tree: object) -> None:
        self.ui_tree_provider = StaticUiTreeProvider(tree)


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
        assert instances.vision_service.worker._thread is None
        assert camera.opened is False
        assert camera.open_count == 0

        frame = await asyncio.to_thread(instances.vision_service.camera_frame)
        assert frame.width == 12
        assert camera.opened is True
        instances.vision_service.release_camera()
        assert camera.opened is False

        await instances.stop()
        await instances.stop()

    asyncio.run(exercise())

    assert instances.robot_service.dispatcher._thread is None
    assert instances.vision_service.worker._thread is None
    assert camera.opened is False
    assert camera.open_count == 1
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


def test_semantic_slot_resolution_returns_disabled_and_hidden_state_metadata() -> None:
    def ui_node(
        node_id: str,
        *,
        text: str | None = None,
        bounds: tuple[int, int, int, int],
        enabled: bool = True,
        visible: bool = True,
        class_name: str = "android.widget.Button",
    ) -> dict[str, object]:
        return {
            "node_id": node_id,
            "parent_id": None,
            "class_name": class_name,
            "text": text,
            "content_description": None,
            "view_id_resource_name": None,
            "bounds": dict(zip(("left", "top", "right", "bottom"), bounds, strict=True)),
            "clickable": True,
            "enabled": enabled,
            "visible_to_user": visible,
        }

    tree = {"nodes": [
        ui_node(
            "guidance",
            text="한 칸은 30분입니다. 예약된 시간은 선택할 수 없어요",
            bounds=(20, 220, 900, 280),
            class_name="android.widget.TextView",
        ),
        ui_node("date", text="2026년 9월 28일(월)", bounds=(100, 120, 900, 200)),
        ui_node("reset", text="초기화", bounds=(800, 300, 1000, 380)),
        ui_node("slot-disabled", bounds=(50, 500, 220, 570), enabled=False),
        ui_node("slot-hidden", bounds=(290, 500, 460, 570), visible=False),
        ui_node("cta", text="시간을 선택하세요", bounds=(80, 1700, 1000, 1820), enabled=False),
    ]}
    resolver = _AndroidGraphUi(StaticAndroidContext(tree))  # type: ignore[arg-type]

    disabled = resolver.resolve_screen_element(
        "reservation_detail", "time_slot", {"index": 0}
    )
    hidden = resolver.resolve_screen_element(
        "reservation_detail", "time_slot", {"index": 1}
    )

    assert disabled.id == "time_slot[0]"
    assert disabled.metadata["index"] == 0
    assert disabled.metadata["enabled"] is False
    assert disabled.metadata["visible"] is True
    assert hidden.id == "time_slot[1]"
    assert hidden.metadata["enabled"] is True
    assert hidden.metadata["visible"] is False


def test_time_slot_resolves_by_half_hour_name_through_canonical_screen_alias() -> None:
    def slot_node(index: int) -> dict[str, object]:
        return {
            "node_id": f"slot-{index}",
            "parent_id": None,
            "class_name": "android.widget.Button",
            "text": None,
            "content_description": None,
            "view_id_resource_name": None,
            "bounds": {
                "left": 20 + index * 10, "top": 500,
                "right": 28 + index * 10, "bottom": 550,
            },
            "clickable": True,
            "enabled": True,
            "visible_to_user": index < 8,
            "metadata": {"index": index},
        }

    tree = {"nodes": [
        {
            **slot_node(0),
            "node_id": "guidance",
            "class_name": "android.widget.TextView",
            "text": "한 칸은 30분입니다. 예약된 시간은 선택할 수 없어요",
            "clickable": False,
        },
        {**slot_node(0), "node_id": "date", "text": "2026년 9월 29일(화)"},
        {**slot_node(0), "node_id": "reset", "text": "초기화"},
        {**slot_node(0), "node_id": "cta", "text": "시간을 선택하세요", "enabled": False},
        *(slot_node(index) for index in range(32)),
    ]}
    resolver = _AndroidGraphUi(StaticAndroidContext(tree))  # type: ignore[arg-type]

    slot = resolver.resolve_screen_element(
        "study_room_detail", "time_slot_by_time", {"name": "18:30"}
    )

    assert slot.id == "time_slot_by_time[18:30]"
    assert slot.metadata["index"] == 25
    assert slot.metadata["start_time"] == "18:30"
    assert slot.metadata["end_time"] == "19:00"


def test_study_room_card_resolves_by_index_and_name() -> None:
    def node(
        node_id: str,
        *,
        text: str | None = None,
        description: str | None = None,
        bounds: tuple[int, int, int, int],
    ) -> dict[str, object]:
        return {
            "node_id": node_id,
            "parent_id": None,
            "class_name": "android.widget.Button",
            "text": text,
            "content_description": description,
            "view_id_resource_name": None,
            "bounds": dict(zip(
                ("left", "top", "right", "bottom"), bounds, strict=True
            )),
            "clickable": True,
            "enabled": True,
            "visible_to_user": True,
        }

    tree = {"nodes": [
        node("header", text="스터디룸 예약", bounds=(20, 40, 300, 100)),
        node(
            "accessibility-card-a",
            description="스터디룸 2A 10인실 2층 교수연구실 옆 보통",
            bounds=(20, 120, 1000, 340),
        ),
        node(
            "room-name", text="스터디룸 2B", bounds=(100, 400, 500, 470)
        ),
        node(
            "accessibility-card-b",
            description="스터디룸 2B 10인실 2층 중앙 여유",
            bounds=(20, 350, 1000, 700),
        ),
        node("bottom-booking", description="예약", bounds=(300, 1800, 700, 1900)),
    ]}
    resolver = _AndroidGraphUi(StaticAndroidContext(tree))  # type: ignore[arg-type]

    by_index = resolver.resolve_screen_element(
        "study_room_list", "room_card", {"index": 1}
    )
    by_name = resolver.resolve_screen_element(
        "study_room_list", "room_card_by_name", {"name": "스터디룸 2B"}
    )

    assert by_index.id == "room_card[1]"
    assert by_name.id == "room_card_by_name[스터디룸 2B]"
    assert by_name.metadata["room_id"] == "room_2b"
    assert by_name.metadata["status"] == "여유"
