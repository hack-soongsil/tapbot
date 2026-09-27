"""Test-only in-memory GRBL transport."""

from collections import deque
from threading import Lock

from tapbot.robot.transport import (
    Transport,
    TransportConnectionError,
    TransportError,
    TransportTimeoutError,
)


class FakeTransport(Transport):
    def __init__(
        self,
        responses: list[str | BaseException] | None = None,
        *,
        auto_ok: bool = False,
    ) -> None:
        self.sent_lines: list[str] = []
        self.realtime_writes: list[bytes] = []
        self._responses: deque[str | BaseException] = deque(responses or [])
        self._connected = False
        self._auto_ok = auto_ok
        self._lock = Lock()

    def connect(self) -> None:
        self._connected = True

    def send_line(self, command: str) -> None:
        self._require_connected()
        if "\n" in command or "\r" in command:
            raise TransportError("send_line accepts exactly one command without a newline")
        with self._lock:
            self.sent_lines.append(command)
            if self._auto_ok:
                self._responses.append("ok")

    def read_line(self) -> str:
        self._require_connected()
        with self._lock:
            if not self._responses:
                raise TransportTimeoutError("Fake transport has no queued response")
            response = self._responses.popleft()
        if isinstance(response, BaseException):
            raise response
        return response

    def send_realtime(self, data: bytes) -> None:
        self._require_connected()
        if not data:
            raise TransportError("Realtime data must not be empty")
        with self._lock:
            self.realtime_writes.append(bytes(data))

    def close(self) -> None:
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    def queue_response(self, *responses: str | BaseException) -> None:
        with self._lock:
            self._responses.extend(responses)

    def _require_connected(self) -> None:
        if not self._connected:
            raise TransportConnectionError("Fake transport is not connected")
