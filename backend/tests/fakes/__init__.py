"""Test-only doubles kept outside the production package."""

from tests.fakes.model import StubModelClient
from tests.fakes.robot import FakeRobotController
from tests.fakes.transport import FakeTransport

__all__ = ["FakeRobotController", "FakeTransport", "StubModelClient"]
