"""Bounded, device-isolated event history for live macro visualization."""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime
import json
from threading import Condition, RLock
from uuid import uuid4

from tapbot.macro.graph_models import JsonObject, utc_now


@dataclass(frozen=True, slots=True)
class MacroRuntimeEvent:
    event_id: str
    device_id: str
    runtime_id: str
    macro_id: str
    type: str
    sequence: int
    timestamp: datetime
    node_id: str | None = None
    edge_id: str | None = None
    payload: JsonObject = field(default_factory=dict)

    def to_dict(self) -> JsonObject:
        return {
            "event_id": self.event_id,
            "device_id": self.device_id,
            "runtime_id": self.runtime_id,
            "macro_id": self.macro_id,
            "type": self.type,
            "sequence": self.sequence,
            "timestamp": self.timestamp.isoformat(),
            "node_id": self.node_id,
            "edge_id": self.edge_id,
            "payload": json.loads(json.dumps(self.payload)),
        }


class MacroEventBroker:
    def __init__(self, *, max_events_per_device: int = 1_000) -> None:
        if max_events_per_device < 1:
            raise ValueError("max_events_per_device must be positive")
        self.max_events_per_device = max_events_per_device
        self._events: dict[str, deque[MacroRuntimeEvent]] = defaultdict(
            lambda: deque(maxlen=max_events_per_device)
        )
        self._sequences: dict[str, int] = defaultdict(int)
        self._condition = Condition(RLock())

    def publish(
        self,
        *,
        device_id: str,
        runtime_id: str,
        macro_id: str,
        event_type: str,
        node_id: str | None = None,
        edge_id: str | None = None,
        payload: JsonObject | None = None,
    ) -> MacroRuntimeEvent:
        with self._condition:
            self._sequences[runtime_id] += 1
            sequence = self._sequences[runtime_id]
            event = MacroRuntimeEvent(
                event_id=f"event-{uuid4().hex}",
                device_id=device_id,
                runtime_id=runtime_id,
                macro_id=macro_id,
                type=event_type,
                sequence=sequence,
                timestamp=utc_now(),
                node_id=node_id,
                edge_id=edge_id,
                payload=payload or {},
            )
            self._events[device_id].append(event)
            self._condition.notify_all()
            return event

    def history(self, device_id: str, *, after_event_id: str | None = None) -> tuple[MacroRuntimeEvent, ...]:
        with self._condition:
            events = tuple(self._events.get(device_id, ()))
        if after_event_id is None:
            return events
        for index, event in enumerate(events):
            if event.event_id == after_event_id:
                return events[index + 1 :]
        # The requested event was truncated or belongs to an old process. The
        # client already fetched a snapshot, so only send retained history.
        return events

    def wait_for_events(
        self,
        device_id: str,
        *,
        after_event_id: str | None,
        timeout_sec: float = 15.0,
    ) -> tuple[MacroRuntimeEvent, ...]:
        with self._condition:
            events = self.history(device_id, after_event_id=after_event_id)
            if events:
                return events
            self._condition.wait(timeout=timeout_sec)
            return self.history(device_id, after_event_id=after_event_id)
