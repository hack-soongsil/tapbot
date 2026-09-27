"""Thread-safe application event recording shared by domain services."""

from __future__ import annotations

from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import itertools
import logging
from threading import Lock


logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class LogEntry:
    id: int
    timestamp: str
    level: str
    message: str
    event_type: str
    category: str
    status: str
    trace_id: str | None
    latency_ms: float | None
    payload: dict[str, object]


class EventLog:
    """Small thread-safe in-memory backend event log."""

    def __init__(self, capacity: int = 500) -> None:
        self._entries: deque[LogEntry] = deque(maxlen=capacity)
        self._ids = itertools.count(1)
        self._lock = Lock()

    def add(
        self,
        message: str,
        *,
        level: str = "info",
        event_type: str = "system.log",
        category: str = "system",
        status: str | None = None,
        trace_id: str | None = None,
        latency_ms: float | None = None,
        payload: Mapping[str, object] | None = None,
    ) -> LogEntry:
        with self._lock:
            entry = LogEntry(
                id=next(self._ids),
                timestamp=datetime.now(timezone.utc).isoformat(),
                level=level,
                message=message,
                event_type=event_type,
                category=category,
                status=(
                    status
                    if status is not None
                    else (level if level in {"warning", "error"} else "info")
                ),
                trace_id=trace_id,
                latency_ms=latency_ms,
                payload=dict(payload or {}),
            )
            self._entries.append(entry)
        log_method = level if level in {"debug", "info", "warning", "error"} else "info"
        getattr(logger, log_method)("%s", message)
        return entry

    def entries(self, *, after_id: int = 0) -> list[LogEntry]:
        with self._lock:
            return [entry for entry in self._entries if entry.id > after_id]
