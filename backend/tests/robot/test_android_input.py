from tapbot.android.gesture import PointerGesture, PointerPoint
from tapbot.robot.android_input import RobotTapController
from tests.fakes import FakeRobotController


class DoubleMapper:
    def screen_to_robot(self, x: float, y: float) -> tuple[float, float]:
        return x * 2, y * 2


class Point:
    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y


class PointMapper:
    def screen_to_robot(self, x: float, y: float) -> Point:
        return Point(x + 1, y + 2)


def test_robot_controller_is_swappable_behind_same_contract() -> None:
    robot = FakeRobotController()
    controller = RobotTapController(robot, DoubleMapper())

    result = controller.tap(10, 20)

    assert robot.commands == [("tap", 20, 40)]
    assert result.metadata["backend"] == "robot_tap"


def test_robot_adapter_accepts_existing_calibration_point_shape() -> None:
    robot = FakeRobotController()

    RobotTapController(robot, PointMapper()).tap(10, 20)

    assert robot.commands == [("tap", 11, 22)]


def test_robot_pointer_gesture_follows_trajectory_with_pen_lifecycle() -> None:
    robot = FakeRobotController()
    controller = RobotTapController(robot, DoubleMapper())
    gesture = PointerGesture.from_points(
        (PointerPoint(1, 2, 0), PointerPoint(3, 4, 100)),
        started_at_ms=0,
    )

    result = controller.execute_gesture(gesture)

    assert result.command == "gesture"
    assert robot.commands == [
        ("move_to", 2, 4),
        ("pen_down",),
        ("move_to", 6, 8),
        ("pen_up",),
    ]
