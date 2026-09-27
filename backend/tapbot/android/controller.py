"""Logical Android input controller backed by Android Agent primitives."""

from __future__ import annotations

from tapbot.android.client import AndroidActionResult, AndroidAgentClient
from tapbot.android.gesture import PointerGesture
from tapbot.android.input import AndroidInputController, AndroidInputResult


class AndroidRemoteController(AndroidInputController):
    def __init__(self, client: AndroidAgentClient) -> None:
        self.client = client

    def execute_gesture(self, gesture: PointerGesture) -> AndroidInputResult:
        return self._result(self.client.gesture(gesture))

    def tap(self, x: float, y: float, *, duration_ms: int = 70) -> AndroidInputResult:
        return self._with_command(super().tap(x, y, duration_ms=duration_ms), "tap")

    def swipe(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        *,
        duration_ms: int = 450,
    ) -> AndroidInputResult:
        return self._with_command(
            super().swipe(x1, y1, x2, y2, duration_ms=duration_ms),
            "swipe",
        )

    def back(self) -> AndroidInputResult:
        return self._result(self.client.back())

    def home(self) -> AndroidInputResult:
        return self._result(self.client.home())

    @staticmethod
    def _result(result: AndroidActionResult) -> AndroidInputResult:
        return AndroidInputResult(
            command=result.command,
            state=result.state,
            action_id=result.action_id,
            metadata={"request_id": result.request_id, "backend": "android_remote"},
        )

    @staticmethod
    def _with_command(result: AndroidInputResult, command: str) -> AndroidInputResult:
        return AndroidInputResult(
            command=command,
            state=result.state,
            action_id=result.action_id,
            metadata=result.metadata,
        )
