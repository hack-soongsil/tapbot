"""Screen-aware Enter/Update/Exit dispatch for macro graphs."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from threading import Lock
import time

from tapbot.macro.graph_models import MacroDefinition
from tapbot.ui_resolution.screens import ScreenRecognition, ScreenRecognizer


@dataclass(frozen=True, slots=True)
class ScreenLifecycleEvent:
    screen_id: str
    kind: str
    entry_node_id: str
    recognition: ScreenRecognition | None = None


LifecycleExecutor = Callable[[MacroDefinition, ScreenLifecycleEvent, object], None]


class ScreenLifecycleDispatcher:
    """Recognize snapshots and invoke screen graph entry points in strict order."""

    def __init__(
        self,
        definitions: Iterable[MacroDefinition],
        execute: LifecycleExecutor,
        *,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        screen_definitions = tuple(
            definition for definition in definitions if definition.screen is not None
        )
        self._definitions = {
            definition.screen.id: definition
            for definition in screen_definitions
            if definition.screen is not None
        }
        if len(self._definitions) != len(screen_definitions):
            raise ValueError("screen ids must be unique within a lifecycle runtime")
        self._recognizer = ScreenRecognizer(
            definition.screen
            for definition in screen_definitions
            if definition.screen is not None
        )
        self._execute = execute
        self._monotonic = monotonic
        self._tick_lock = Lock()
        self._active_screen_id: str | None = None
        self._last_update_at: dict[str, float] = {}

    @property
    def active_screen_id(self) -> str | None:
        return self._active_screen_id

    def refresh(self, ui_tree: object) -> tuple[ScreenLifecycleEvent, ...]:
        # A slow Update owns the tick. Concurrent refreshes are intentionally skipped.
        if not self._tick_lock.acquire(blocking=False):
            return ()
        try:
            recognition = self._recognizer.recognize(ui_tree)
            next_screen_id = None if recognition is None else recognition.screen_id
            previous = self._active_screen_id
            events: list[ScreenLifecycleEvent] = []

            if previous is None and next_screen_id is not None:
                self._active_screen_id = next_screen_id
                event = self._event(next_screen_id, "enter", recognition)
                if event is not None:
                    self._dispatch(event, ui_tree)
                    events.append(event)
                return tuple(events)

            if previous == next_screen_id:
                if previous is None:
                    return ()
                now = self._monotonic()
                interval = self._update_interval(self._definitions[previous]) / 1_000
                if now - self._last_update_at.get(previous, float("-inf")) < interval:
                    return ()
                self._last_update_at[previous] = now
                event = self._event(previous, "update", recognition)
                if event is not None:
                    self._dispatch(event, ui_tree)
                    events.append(event)
                return tuple(events)

            if previous is not None:
                event = self._event(previous, "exit", None)
                if event is not None:
                    self._dispatch(event, ui_tree)
                    events.append(event)

            self._active_screen_id = next_screen_id
            if next_screen_id is not None:
                event = self._event(next_screen_id, "enter", recognition)
                if event is not None:
                    self._dispatch(event, ui_tree)
                    events.append(event)
            return tuple(events)
        finally:
            self._tick_lock.release()

    def _event(
        self,
        screen_id: str,
        kind: str,
        recognition: ScreenRecognition | None,
    ) -> ScreenLifecycleEvent | None:
        definition = self._definitions[screen_id]
        entry = definition.entry_for(kind)
        return None if entry is None else ScreenLifecycleEvent(
            screen_id,
            kind,
            entry,
            recognition,
        )

    def _dispatch(self, event: ScreenLifecycleEvent, ui_tree: object) -> None:
        self._execute(self._definitions[event.screen_id], event, ui_tree)

    @staticmethod
    def _update_interval(definition: MacroDefinition) -> int:
        entry = definition.entry_for("update")
        node = next((node for node in definition.nodes if node.id == entry), None)
        value = 1_000 if node is None else node.config.get("interval_ms", 1_000)
        return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else 1_000
