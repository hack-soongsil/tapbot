from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
import time

import cv2
from fastapi.testclient import TestClient
import numpy as np

from tapbot.robot.actions import EmergencyStopAction, MoveAction
from tapbot.robot.grbl import (
    GrblRobotConfig,
    GrblRobotController,
    GrblSession,
    GrblSessionConfig,
)
from tests.fakes import FakeRobotController, FakeTransport
from tests.helpers import WorkspaceBounds, create_test_app as create_production_app
from tapbot.events import EventLog
from tapbot.robot.service import RobotCommandDispatcher
from tapbot.vision.calibration import CalibrationStore


def create_app(**kwargs: object):
    kwargs.setdefault("robot", FakeRobotController())
    return create_production_app(**kwargs)  # type: ignore[arg-type]


class FakeCamera:
    source = "fake-camera"

    def __init__(self) -> None:
        self.opened = False
        self.frame = np.full((8, 12, 3), 120, dtype=np.uint8)

    def open(self) -> None:
        self.opened = True

    def read_frame(self) -> np.ndarray:
        return self.frame

    def close(self) -> None:
        self.opened = False

    def is_opened(self) -> bool:
        return self.opened


def make_client() -> tuple[TestClient, FakeRobotController]:
    robot = FakeRobotController()
    app = create_app(robot=robot, camera=FakeCamera(), camera_fps=20)
    return TestClient(app), robot


def wait_for_camera(client: TestClient) -> object:
    for _ in range(50):
        response = client.get(
            "/api/camera/frame", headers={"Origin": "http://localhost:5173"}
        )
        if response.status_code == 200:
            return response
        time.sleep(0.01)
    raise AssertionError("camera frame was not produced")


def test_manual_robot_commands_reach_mock_in_order() -> None:
    client, robot = make_client()
    with client:
        assert client.post("/api/robot/move", json={"x": 10, "y": 20}).status_code == 200
        response = client.post("/api/robot/tap", json={"x": 100, "y": 200})
        assert response.status_code == 200
        assert response.json() == {"ok": True, "action": "TapAction"}
        assert client.post("/api/robot/home").status_code == 200
        assert client.post("/api/robot/stop").status_code == 200

    assert robot.commands == [
        ("move_to", 10.0, 20.0),
        ("tap", 100.0, 200.0),
        ("home",),
        ("emergency_stop",),
    ]


def test_robot_status_and_pen_commands() -> None:
    client, robot = make_client()
    with client:
        initial = client.get("/api/robot/status")
        assert client.post("/api/robot/pen/down").status_code == 200
        assert client.post("/api/robot/pen/up").status_code == 200
        assert client.post("/api/robot/move", json={"x": 25, "y": 50}).status_code == 200
        moved = client.get("/api/robot/status")
        assert client.post("/api/robot/home").status_code == 200
        homed = client.get("/api/robot/status")

    assert initial.json() == {
        "connected": True,
        "busy": False,
        "homed": False,
        "mode": "REAL",
        "position": {"x": 0.0, "y": 0.0},
        "pen": "unknown",
        "last_command": None,
        "workspace": {
            "min_x": 0,
            "max_x": 1000,
            "min_y": 0,
            "max_y": 1000,
        },
        "queue_depth": 0,
    }
    assert moved.json()["position"] == {"x": 25.0, "y": 50.0}
    assert homed.json()["homed"] is True
    assert homed.json()["position"] == {"x": 0.0, "y": 0.0}
    assert robot.commands == [
        ("pen_down",),
        ("pen_up",),
        ("move_to", 25.0, 50.0),
        ("home",),
    ]


def test_backend_rejects_coordinates_outside_workspace() -> None:
    robot = FakeRobotController()
    app = create_app(
        robot=robot,
        camera=FakeCamera(),
        bounds=WorkspaceBounds(max_x=300, max_y=400),
    )
    with TestClient(app) as client:
        response = client.post("/api/robot/tap", json={"x": 301, "y": 200})

    assert response.status_code == 422
    assert "X must be between" in response.json()["detail"]
    assert robot.commands == []


def test_status_and_camera_frame_endpoints() -> None:
    client, _ = make_client()
    with client:
        status = client.get("/api/status")
        frame_response = wait_for_camera(client)

    assert status.status_code == 200
    assert status.json()["robot"] == "FakeRobotController"
    assert status.json()["robot_mode"] == "REAL"
    assert status.json()["robot_connected"] is True
    assert status.json()["calibration_profile"] is None
    assert frame_response.headers["content-type"] == "image/jpeg"
    assert int(frame_response.headers["x-frame-id"]) >= 1
    assert frame_response.headers["x-frame-width"] == "12"
    assert frame_response.headers["x-frame-height"] == "8"
    assert frame_response.headers["cache-control"] == "no-store"
    assert "X-Frame-Id" in frame_response.headers["access-control-expose-headers"]
    decoded = cv2.imdecode(np.frombuffer(frame_response.content, np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == (8, 12, 3)


def test_event_log_contains_user_action_and_execution_result() -> None:
    client, _ = make_client()
    with client:
        client.post("/api/robot/tap", json={"x": 100, "y": 200})
        entries = client.get("/api/logs").json()["entries"]

    messages = [entry["message"] for entry in entries]
    assert any("User command: tap(100.0, 200.0)" in message for message in messages)
    assert any("Action created: TapAction" in message for message in messages)
    assert any("FakeRobotController executed: TapAction" in message for message in messages)


class BlockingRobot(FakeRobotController):
    def __init__(self) -> None:
        super().__init__()
        self.first_move_started = Event()
        self.release_first_move = Event()

    def move_to(self, x: float, y: float) -> None:
        if not self.first_move_started.is_set():
            self.first_move_started.set()
            self.release_first_move.wait(2)
        super().move_to(x, y)


def test_emergency_stop_jumps_ahead_of_queued_normal_commands() -> None:
    robot = BlockingRobot()
    dispatcher = RobotCommandDispatcher(robot, EventLog())
    dispatcher.start()
    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            first = pool.submit(dispatcher.submit, MoveAction(1, 1))
            assert robot.first_move_started.wait(1)
            second = pool.submit(dispatcher.submit, MoveAction(2, 2))
            stop = pool.submit(dispatcher.submit, EmergencyStopAction())
            for _ in range(100):
                if dispatcher.pending_count == 1:
                    break
                time.sleep(0.005)
            assert dispatcher.pending_count == 1
            stop.result(1)
            assert robot.commands == [("emergency_stop",)]
            robot.release_first_move.set()
            first.result(2)
            second.result(2)
    finally:
        dispatcher.shutdown()

    assert robot.commands == [
        ("emergency_stop",),
        ("move_to", 1.0, 1.0),
        ("move_to", 2.0, 2.0),
    ]


def calibration_payload() -> dict[str, object]:
    return {
        "profile_name": "test-phone",
        "camera_corners": [
            {"x": 0, "y": 0},
            {"x": 12, "y": 0},
            {"x": 12, "y": 8},
            {"x": 0, "y": 8},
        ],
        "robot_points": [
            {"x": 10, "y": 20},
            {"x": 210, "y": 20},
            {"x": 210, "y": 420},
            {"x": 10, "y": 420},
        ],
        "screen_width": 1000,
        "screen_height": 2000,
        "camera_width": 12,
        "camera_height": 8,
    }


def test_calibration_api_saves_and_transforms_camera_click(tmp_path: Path) -> None:
    store = CalibrationStore(tmp_path / "calibrations.json")
    app = create_app(camera=FakeCamera(), calibration_store=store)

    with TestClient(app) as client:
        saved = client.post("/api/calibration", json=calibration_payload())
        screen_center = client.post(
            "/api/calibration/screen-to-robot", json={"x": 500, "y": 1000}
        )
        camera_center = client.post(
            "/api/calibration/camera-to-robot", json={"x": 6, "y": 4}
        )

    assert saved.status_code == 200
    assert saved.json()["calibration"]["profile_name"] == "test-phone"
    assert screen_center.json()["robot"] == {"x": 110.0, "y": 220.0}
    assert camera_center.json()["robot"] == {"x": 110.0, "y": 220.0}




def test_existing_calibration_profile_can_be_activated(tmp_path: Path) -> None:
    app = create_app(
        camera=FakeCamera(),
        calibration_store=CalibrationStore(tmp_path / "calibrations.json"),
    )
    first = calibration_payload()
    second = calibration_payload() | {"profile_name": "second-phone"}
    with TestClient(app) as client:
        assert client.post("/api/calibration", json=first).status_code == 200
        assert client.post("/api/calibration", json=second).status_code == 200
        activated = client.post(
            "/api/calibration/activate", params={"profile": "test-phone"}
        )
        profiles = client.get("/api/calibration/profiles")

    assert activated.status_code == 200
    assert activated.json()["calibration"]["profile_name"] == "test-phone"
    assert profiles.json()["active_profile"] == "test-phone"


def test_calibration_api_rejects_out_of_bounds_point(tmp_path: Path) -> None:
    app = create_app(
        camera=FakeCamera(),
        calibration_store=CalibrationStore(tmp_path / "calibrations.json"),
    )
    with TestClient(app) as client:
        assert client.post("/api/calibration", json=calibration_payload()).status_code == 200
        response = client.post(
            "/api/calibration/screen-to-robot", json={"x": 1001, "y": 1000}
        )

    assert response.status_code == 422
    assert "outside the screen" in response.json()["detail"]


def test_saved_calibration_is_loaded_after_app_restart(tmp_path: Path) -> None:
    store = CalibrationStore(tmp_path / "calibrations.json")
    first_app = create_app(camera=FakeCamera(), calibration_store=store)
    with TestClient(first_app) as client:
        client.post("/api/calibration", json=calibration_payload())

    second_app = create_app(camera=FakeCamera(), calibration_store=store)
    with TestClient(second_app) as client:
        loaded = client.get("/api/calibration")
        transformed = client.post(
            "/api/calibration/screen-to-robot", json={"x": 500, "y": 1000}
        )

    assert loaded.json()["configured"] is True
    assert loaded.json()["calibration"]["profile_name"] == "test-phone"
    assert transformed.json()["robot"] == {"x": 110.0, "y": 220.0}


class GreenButtonCamera(FakeCamera):
    def __init__(self) -> None:
        super().__init__()
        self.frame = np.zeros((80, 120, 3), dtype=np.uint8)
        self.frame[30:50, 40:80] = (0, 255, 0)






def test_vision_saved_frame_can_be_filtered_and_replayed(tmp_path: Path) -> None:
    app = create_app(
        camera=GreenButtonCamera(),
        camera_fps=20,
        calibration_store=CalibrationStore(tmp_path / "calibrations.json"),
    )
    calibration = {
        "profile_name": "vision-replay-test",
        "camera_corners": [
            {"x": 0, "y": 0},
            {"x": 120, "y": 0},
            {"x": 120, "y": 80},
            {"x": 0, "y": 80},
        ],
        "robot_points": [
            {"x": 0, "y": 0},
            {"x": 120, "y": 0},
            {"x": 120, "y": 80},
            {"x": 0, "y": 80},
        ],
        "screen_width": 120,
        "screen_height": 80,
        "camera_width": 120,
        "camera_height": 80,
    }

    with TestClient(app) as client:
        wait_for_camera(client)
        assert client.post("/api/calibration", json=calibration).status_code == 200
        capabilities = client.get("/api/vision/capabilities")
        saved = client.post("/api/vision/frames")
        frame_id = saved.json()["frame"]["frame_id"]
        result = client.post(
            "/api/vision/run",
            json={
                "frame_id": frame_id,
                "detector_types": ["opencv_color_contour"],
                "confidence_threshold": 0.5,
            },
        )
        filtered = client.post(
            "/api/vision/run",
            json={"frame_id": frame_id, "confidence_threshold": 1.0},
        )
        frames = client.get("/api/vision/frames")
        raw = client.get(f"/api/vision/frames/{frame_id}/raw")
        result_image = client.get(
            f"/api/vision/results/{result.json()['result_id']}/image"
        )
        unknown = client.post(
            "/api/vision/run",
            json={"frame_id": frame_id, "detector_types": ["not-installed"]},
        )

    assert capabilities.json()["detectors"] == [
        {"type": "opencv_color_contour", "name": "ColorButtonDetector"}
    ]
    assert saved.status_code == 200
    assert saved.json()["frame"]["width"] == 120
    assert frames.json()["frames"][0]["frame_id"] == frame_id
    assert result.status_code == 200
    assert result.json()["image"] == {"width": 120, "height": 80}
    assert result.json()["detections"][0]["detector_name"] == "ColorButtonDetector"
    assert filtered.json()["detections"] == []
    assert raw.headers["content-type"] == "image/jpeg"
    assert result_image.headers["content-type"] == "image/jpeg"
    assert unknown.status_code == 422
    assert "Unknown detector types" in unknown.json()["detail"]




def test_api_can_use_dry_run_grbl_controller(tmp_path: Path) -> None:
    robot = GrblRobotController(
        None,
        GrblRobotConfig(
            feed_rate_mm_per_min=500,
            tap_dwell_ms=100,
            dry_run=True,
        ),
    )
    app = create_app(
        robot=robot,
        camera=FakeCamera(),
        calibration_store=CalibrationStore(tmp_path / "calibrations.json"),
    )

    with TestClient(app) as client:
        status = client.get("/api/status")
        tapped = client.post("/api/robot/tap", json={"x": 100, "y": 200})
        stopped = client.post("/api/robot/stop")

    assert status.json()["robot"] == "GrblRobotController"
    assert status.json()["robot_connected"] is True
    assert tapped.status_code == 200
    assert stopped.status_code == 200
    assert robot.generated_commands == [
        "G90",
        "G1 X100 Y200 F500",
        "M3",
        "G4 P0.1",
        "M5",
        "!",
        "<CTRL-X>",
    ]




def test_grbl_device_error_is_returned_and_recorded_in_backend_log(
    tmp_path: Path,
) -> None:
    transport = FakeTransport(["<Idle|MPos:0,0,0>", "error:2"])
    session = GrblSession(
        transport,
        GrblSessionConfig(wakeup_delay_s=0, command_timeout_s=0.1),
    )
    robot = GrblRobotController(session)
    app = create_app(
        robot=robot,
        camera=FakeCamera(),
        calibration_store=CalibrationStore(tmp_path / "calibrations.json"),
    )

    with TestClient(app) as client:
        response = client.post("/api/robot/move", json={"x": 10, "y": 20})
        logs = client.get("/api/logs").json()["entries"]

    assert response.status_code == 500
    assert "GRBL rejected" in response.json()["detail"]
    assert any(
        "Robot execution error" in entry["message"] and "error:2" in entry["message"]
        for entry in logs
    )
