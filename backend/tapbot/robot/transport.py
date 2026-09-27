"""Transport abstraction shared by GRBL connection types."""

from __future__ import annotations

from abc import ABC, abstractmethod


class TransportError(RuntimeError):
    """Base class for transport failures."""


class TransportConnectionError(TransportError):
    """Raised when a transport cannot connect or is used while disconnected."""


class TransportTimeoutError(TransportError):
    """Raised when no complete line arrives before the transport timeout."""


class Transport(ABC):
    """Line-oriented transport with a separate GRBL realtime write path."""

    @abstractmethod
    def connect(self) -> None: ...

    @abstractmethod
    def send_line(self, command: str) -> None: ...

    @abstractmethod
    def read_line(self) -> str: ...

    @abstractmethod
    def send_realtime(self, data: bytes) -> None:
        """Send bytes immediately without a line terminator or command queue."""

    @abstractmethod
    def close(self) -> None: ...

    @property
    @abstractmethod
    def is_connected(self) -> bool: ...
