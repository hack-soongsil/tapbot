"""Test-only robot controller."""

from tapbot.robot.controller import RobotController


class FakeRobotController(RobotController):
    def __init__(self) -> None:
        self.commands: list[tuple[str, *tuple[float, ...]]] = []

    @property
    def is_connected(self) -> bool:
        return True

    def home(self) -> None:
        self.commands.append(("home",))

    def move_to(self, x: float, y: float) -> None:
        self.commands.append(("move_to", x, y))

    def tap(self, x: float, y: float) -> None:
        self.commands.append(("tap", x, y))

    def pen_down(self) -> None:
        self.commands.append(("pen_down",))

    def pen_up(self) -> None:
        self.commands.append(("pen_up",))

    def emergency_stop(self) -> None:
        self.commands.append(("emergency_stop",))

    def clear(self) -> None:
        self.commands.clear()
