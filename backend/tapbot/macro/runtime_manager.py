"""Thread-safe, per-device graph runtime ownership."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
import json
from threading import Condition, RLock, Thread, current_thread
import time
from uuid import uuid4

from tapbot.macro.binding import DeviceMacroBinding, DeviceMacroBindingRepository
from tapbot.macro.graph_engine import GraphEngine
from tapbot.macro.events import MacroEventBroker
from tapbot.macro.graph_models import (
    GraphExecutionContext,
    GraphElement,
    GraphNodeTrace,
    GraphRuntime,
    GraphRuntimeStatus,
    JsonObject,
    JsonValue,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    NodeStatus,
)
from tapbot.macro.repository import MacroRepository
from tapbot.macro.screen_lifecycle import ScreenLifecycleDispatcher, ScreenLifecycleEvent


class DeviceRuntimeStatus(StrEnum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    STOPPED = "stopped"
    ERROR = "error"


@dataclass(frozen=True, slots=True)
class DeviceRuntimeSnapshot:
    device_id: str
    runtime_id: str | None
    macro_definition_id: str | None
    definition_version: int | None
    current_node_id: str | None
    current_edge_id: str | None
    state: DeviceRuntimeStatus
    active_screen_id: str | None = None
    step_count: int = 0
    variables: JsonObject = field(default_factory=dict)
    trace: tuple[GraphNodeTrace, ...] = ()
    started_at: datetime | None = None
    error: str | None = None

    def to_dict(self) -> JsonObject:
        return {
            "device_id": self.device_id,
            "runtime_id": self.runtime_id,
            "macro_definition_id": self.macro_definition_id,
            "definition_version": self.definition_version,
            "current_node_id": self.current_node_id,
            "current_edge_id": self.current_edge_id,
            "state": self.state.value,
            "active_screen_id": self.active_screen_id,
            "step_count": self.step_count,
            "variables": json.loads(json.dumps(self.variables)),
            "trace": [item.to_dict() for item in self.trace],
            "started_at": None if self.started_at is None else self.started_at.isoformat(),
            "error": self.error,
        }


@dataclass(slots=True)
class _Session:
    device_id: str
    definition: MacroDefinition
    context: GraphExecutionContext
    runtime_id: str = field(default_factory=lambda: f"runtime-{uuid4().hex}")
    condition: Condition = field(default_factory=lambda: Condition(RLock()))
    state: DeviceRuntimeStatus = DeviceRuntimeStatus.RUNNING
    runtime: GraphRuntime | None = None
    traces: list[GraphNodeTrace] = field(default_factory=list)
    pause_requested: bool = False
    stop_requested: bool = False
    step_budget: int | None = None
    thread: Thread | None = None
    error: str | None = None
    current_edge_id: str | None = None
    last_variable_fingerprint: dict[str, str] = field(default_factory=dict)
    active_screen_id: str | None = None


EngineFactory = Callable[[str], GraphEngine]
ContextFactory = Callable[[str, DeviceMacroBinding], GraphExecutionContext]
OnlineCheck = Callable[[str], bool]


class RuntimeManager:
    """Own exactly one isolated active runtime per Android device."""

    def __init__(
        self,
        repository: MacroRepository,
        bindings: DeviceMacroBindingRepository,
        *,
        engine_factory: EngineFactory,
        context_factory: ContextFactory,
        device_online: OnlineCheck | None = None,
        event_broker: MacroEventBroker | None = None,
        screen_refresh_interval_sec: float = 1.0,
    ) -> None:
        if screen_refresh_interval_sec <= 0:
            raise ValueError("screen_refresh_interval_sec must be positive")
        self.repository = repository
        self.bindings = bindings
        self.engine_factory = engine_factory
        self.context_factory = context_factory
        self.device_online = device_online or (lambda _device_id: True)
        self.events = event_broker or MacroEventBroker()
        self.screen_refresh_interval_sec = screen_refresh_interval_sec
        self._sessions: dict[str, _Session] = {}
        self._lock = RLock()

    def start(self, device_id: str) -> DeviceRuntimeSnapshot:
        return self._start(device_id, step_budget=None)

    def pause(self, device_id: str) -> DeviceRuntimeSnapshot:
        session = self._require_session(device_id)
        with session.condition:
            if session.state is not DeviceRuntimeStatus.RUNNING:
                raise RuntimeError("only a running macro can be paused")
            session.pause_requested = True
            session.state = DeviceRuntimeStatus.PAUSED
            session.condition.notify_all()
        self._publish(session, "macro.runtime.paused")
        return self.current(device_id)

    def resume(self, device_id: str) -> DeviceRuntimeSnapshot:
        session = self._require_session(device_id)
        if not self.device_online(device_id):
            raise RuntimeError("device is offline")
        with session.condition:
            if session.state is not DeviceRuntimeStatus.PAUSED:
                raise RuntimeError("only a paused macro can be resumed")
            session.step_budget = None
            session.pause_requested = False
            session.error = None
            session.state = DeviceRuntimeStatus.RUNNING
            session.condition.notify_all()
        self._publish(session, "macro.runtime.resumed")
        return self.current(device_id)

    def stop(self, device_id: str) -> DeviceRuntimeSnapshot:
        session = self._require_session(device_id)
        with session.condition:
            session.stop_requested = True
            session.pause_requested = False
            session.state = DeviceRuntimeStatus.STOPPED
            session.condition.notify_all()
        if session.thread is not None and session.thread is not current_thread():
            session.thread.join(timeout=2)
        return self.current(device_id)

    def reset(self, device_id: str) -> DeviceRuntimeSnapshot:
        with self._lock:
            session = self._sessions.get(device_id)
        if session is not None and session.thread is not None and session.thread.is_alive():
            self.stop(device_id)
        with self._lock:
            self._sessions.pop(device_id, None)
        if session is not None:
            self._publish(session, "macro.runtime.reset")
        return self.current(device_id)

    def step(self, device_id: str, *, timeout_sec: float = 30.0) -> DeviceRuntimeSnapshot:
        with self._lock:
            session = self._sessions.get(device_id)
        if session is None or session.state in {
            DeviceRuntimeStatus.COMPLETED,
            DeviceRuntimeStatus.STOPPED,
            DeviceRuntimeStatus.ERROR,
        }:
            return self._start(device_id, step_budget=1, wait_for_step=timeout_sec)
        with session.condition:
            if session.state is not DeviceRuntimeStatus.PAUSED:
                raise RuntimeError("step is only available for an idle or paused runtime")
            session.step_budget = 1
            session.pause_requested = False
            session.state = DeviceRuntimeStatus.RUNNING
            session.condition.notify_all()
            self._wait_for_step(session, timeout_sec)
        return self.current(device_id)

    def current(self, device_id: str) -> DeviceRuntimeSnapshot:
        with self._lock:
            session = self._sessions.get(device_id)
        if session is None:
            binding = self.bindings.get(device_id)
            return DeviceRuntimeSnapshot(
                device_id=device_id,
                runtime_id=None,
                macro_definition_id=None if binding is None else binding.macro_definition_id,
                definition_version=None,
                current_node_id=None,
                current_edge_id=None,
                state=DeviceRuntimeStatus.IDLE,
            )
        with session.condition:
            runtime = session.runtime
            return DeviceRuntimeSnapshot(
                device_id=device_id,
                runtime_id=session.runtime_id,
                macro_definition_id=session.definition.id,
                definition_version=session.definition.version,
                current_node_id=(
                    session.definition.entry_for("enter")
                    if runtime is None
                    else runtime.current_node_id
                ),
                current_edge_id=session.current_edge_id,
                state=session.state,
                active_screen_id=session.active_screen_id,
                step_count=0 if runtime is None else runtime.step_count,
                variables=_snapshot_variables(session.context.variables),
                trace=tuple(session.traces),
                started_at=None if runtime is None else runtime.started_at,
                error=session.error or (None if runtime is None else runtime.error),
            )

    def handle_device_disconnect(self, device_id: str) -> None:
        with self._lock:
            session = self._sessions.get(device_id)
        if session is None:
            return
        with session.condition:
            if session.state is DeviceRuntimeStatus.RUNNING:
                session.pause_requested = True
                session.state = DeviceRuntimeStatus.PAUSED
                session.error = "device is offline"
                session.condition.notify_all()
        if session.state is DeviceRuntimeStatus.PAUSED:
            self._publish(session, "macro.runtime.paused", payload={"reason": "device_offline"})

    def close(self) -> None:
        with self._lock:
            device_ids = tuple(self._sessions)
        for device_id in device_ids:
            try:
                self.stop(device_id)
            except RuntimeError:
                pass

    def _start(
        self,
        device_id: str,
        *,
        step_budget: int | None,
        wait_for_step: float | None = None,
    ) -> DeviceRuntimeSnapshot:
        binding = self.bindings.get(device_id)
        if binding is None or not binding.enabled:
            raise RuntimeError("device has no enabled macro binding")
        if not self.device_online(device_id):
            raise RuntimeError("device is offline")
        definition = self.repository.get(binding.macro_definition_id).snapshot()
        with self._lock:
            prior = self._sessions.get(device_id)
            if prior is not None and prior.state in {
                DeviceRuntimeStatus.RUNNING,
                DeviceRuntimeStatus.PAUSED,
            }:
                raise RuntimeError("device already has an active macro runtime")
            session = _Session(
                device_id,
                definition,
                self.context_factory(device_id, binding),
                step_budget=step_budget,
            )
            self._sessions[device_id] = session
        self._publish(session, "macro.runtime.started", payload={
            "definition_version": definition.version,
            "entry_node_id": definition.entry_for("enter"),
            "event_entry_node_ids": (
                None
                if definition.event_entry_node_ids is None
                else definition.event_entry_node_ids.to_dict()
            ),
            "screen_event_entry_node_ids": (
                None
                if definition.screen_event_entry_node_ids is None
                else {
                    screen_id: entries.to_dict()
                    for screen_id, entries in definition.screen_event_entry_node_ids.items()
                }
            ),
        })
        session.thread = Thread(
            target=self._run,
            args=(session,),
            name=f"tapbot-macro-{device_id}",
            daemon=True,
        )
        session.thread.start()
        if wait_for_step is not None:
            with session.condition:
                self._wait_for_step(session, wait_for_step)
        return self.current(device_id)

    def _run(self, session: _Session) -> None:
        try:
            if session.definition.has_screen_lifecycle:
                self._run_screen_lifecycle(session)
                return
            result = self.engine_factory(session.device_id).run(
                session.definition,
                context=session.context,
                cancelled=lambda: self._gate(session),
                on_node_start=lambda node, runtime: self._node_started(session, node, runtime),
                on_trace=lambda trace, runtime: self._progress(session, trace, runtime),
                on_edge=lambda edge, runtime: self._edge_traversed(session, edge, runtime),
            )
            with session.condition:
                session.runtime = result.runtime
                if session.stop_requested:
                    session.state = DeviceRuntimeStatus.STOPPED
                elif result.runtime.state is GraphRuntimeStatus.COMPLETED:
                    session.state = DeviceRuntimeStatus.COMPLETED
                elif result.runtime.state is GraphRuntimeStatus.STOPPED:
                    session.state = DeviceRuntimeStatus.STOPPED
                elif result.runtime.state is GraphRuntimeStatus.CANCELLED:
                    session.state = DeviceRuntimeStatus.STOPPED
                else:
                    session.state = DeviceRuntimeStatus.ERROR
                session.error = result.runtime.error
                session.condition.notify_all()
            terminal_type = {
                DeviceRuntimeStatus.COMPLETED: "macro.runtime.completed",
                DeviceRuntimeStatus.STOPPED: "macro.runtime.stopped",
                DeviceRuntimeStatus.ERROR: "macro.runtime.failed",
            }[session.state]
            self._publish(session, terminal_type, payload={"error": session.error})
        except Exception as error:
            with session.condition:
                session.state = DeviceRuntimeStatus.ERROR
                session.error = str(error)
                session.condition.notify_all()
            self._publish(session, "macro.runtime.failed", payload={"error": str(error)})

    def _run_screen_lifecycle(self, session: _Session) -> None:
        definitions = self._screen_definitions(session.definition)
        engine = self.engine_factory(session.device_id)

        def execute(
            definition: MacroDefinition,
            event: ScreenLifecycleEvent,
            ui_tree: object,
        ) -> None:
            session.context.last_observation = ui_tree
            with session.condition:
                session.active_screen_id = event.screen_id
            self._publish(
                session,
                f"macro.screen.{event.kind}",
                node_id=event.entry_node_id,
                payload={"screen_id": event.screen_id},
            )
            result = engine.run(
                definition,
                entry_node_id=event.entry_node_id,
                context=session.context,
                cancelled=lambda: self._gate(session),
                on_node_start=lambda node, runtime: self._node_started(session, node, runtime),
                on_trace=lambda trace, runtime: self._progress(session, trace, runtime),
                on_edge=lambda edge, runtime: self._edge_traversed(session, edge, runtime),
            )
            with session.condition:
                session.runtime = result.runtime
                if result.runtime.state is GraphRuntimeStatus.ERROR:
                    session.state = DeviceRuntimeStatus.ERROR
                    session.error = result.runtime.error

        dispatcher = ScreenLifecycleDispatcher(definitions, execute)
        while True:
            if self._gate(session):
                break
            if session.context.ui is None:
                raise RuntimeError("screen lifecycle requires a UI tree provider")
            ui_tree = session.context.ui.read_ui_tree()
            dispatcher.refresh(ui_tree)
            with session.condition:
                session.active_screen_id = dispatcher.active_screen_id
                if session.state is DeviceRuntimeStatus.ERROR:
                    break
                session.condition.wait(timeout=self.screen_refresh_interval_sec)

        with session.condition:
            if session.state is not DeviceRuntimeStatus.ERROR:
                session.state = DeviceRuntimeStatus.STOPPED
            session.condition.notify_all()
        self._publish(
            session,
            "macro.runtime.failed" if session.state is DeviceRuntimeStatus.ERROR else "macro.runtime.stopped",
            payload={"error": session.error},
        )

    def _screen_definitions(
        self,
        selected: MacroDefinition,
    ) -> tuple[MacroDefinition, ...]:
        if selected.screen_event_entry_node_ids and len(selected.screen_event_entry_node_ids) > 1:
            return (selected,)
        workflow_id = selected.metadata.get("workflow_id")
        candidates = tuple(
            definition.snapshot()
            for definition in self.repository.list()
            if (definition.screen is not None or definition.screen_event_entry_node_ids)
            and (
                workflow_id is None
                or definition.metadata.get("workflow_id") == workflow_id
            )
        )
        return candidates or (selected,)

    @staticmethod
    def _gate(session: _Session) -> bool:
        with session.condition:
            while session.pause_requested and not session.stop_requested:
                session.condition.wait(timeout=0.5)
            return session.stop_requested

    def _progress(
        self,
        session: _Session,
        trace: GraphNodeTrace,
        runtime: GraphRuntime,
    ) -> None:
        with session.condition:
            session.runtime = runtime
            session.traces.append(trace)
            session.current_edge_id = None
            if session.step_budget is not None:
                session.step_budget -= 1
                if session.step_budget <= 0 and runtime.state is GraphRuntimeStatus.RUNNING:
                    session.step_budget = None
                    session.pause_requested = True
                    session.state = DeviceRuntimeStatus.PAUSED
            session.condition.notify_all()
        self._publish_node_output(session, trace)
        fingerprint = {
            key: json.dumps(value, sort_keys=True)
            for key, value in session.context.variables.items()
        }
        changed_keys = sorted(
            key
            for key in set(fingerprint) | set(session.last_variable_fingerprint)
            if fingerprint.get(key) != session.last_variable_fingerprint.get(key)
        )
        if changed_keys:
            self._publish(
                session,
                "macro.variable.changed",
                node_id=trace.node_id,
                payload={"keys": changed_keys},
            )
        session.last_variable_fingerprint = fingerprint
        self._publish(
            session,
            "macro.node.failed" if trace.status is NodeStatus.FAILURE else "macro.node.completed",
            node_id=trace.node_id,
            payload={
                "node_type": trace.node_type,
                "status": trace.status.value,
                "duration_ms": (trace.completed_at - trace.started_at).total_seconds() * 1_000,
                "output": trace.output_summary,
                "error": trace.error,
            },
        )
        if session.state is DeviceRuntimeStatus.PAUSED:
            self._publish(session, "macro.runtime.paused", node_id=trace.node_id)

    def _node_started(
        self,
        session: _Session,
        node: MacroNode,
        runtime: GraphRuntime,
    ) -> None:
        with session.condition:
            session.runtime = runtime
            session.current_edge_id = None
        self._publish(
            session,
            "macro.node.started",
            node_id=node.id,
            payload={"node_type": node.type},
        )

    def _edge_traversed(
        self,
        session: _Session,
        edge: MacroEdge,
        runtime: GraphRuntime,
    ) -> None:
        with session.condition:
            session.runtime = runtime
            session.current_edge_id = edge.id
        self._publish(
            session,
            "macro.edge.traversed",
            edge_id=edge.id,
            payload={"source": edge.source, "target": edge.target},
        )

    def _publish_node_output(self, session: _Session, trace: GraphNodeTrace) -> None:
        output = trace.output_summary
        user_debug = output.get("user_debug")
        if isinstance(user_debug, dict):
            level = user_debug.get("level", "info")
            message = user_debug.get("message", "")
            if isinstance(level, str) and isinstance(message, str):
                self._publish(
                    session,
                    "macro.user_debug",
                    node_id=trace.node_id,
                    payload={
                        "screen_id": session.active_screen_id,
                        "level": level,
                        "message": message,
                    },
                )
        bounds = output.get("bounds")
        tap_point = output.get("tap_point")
        if bounds is not None:
            self._publish(
                session,
                "android.element.resolved",
                node_id=trace.node_id,
                payload={"bounds": bounds, "element_id": output.get("element_id")},
            )
        if tap_point is not None:
            self._publish(
                session,
                "android.tap.planned",
                node_id=trace.node_id,
                payload={
                    "bounds": bounds,
                    "safe_bounds": output.get("safe_bounds"),
                    "tap_point": tap_point,
                    "sampling": output.get("sampling"),
                },
            )
            if trace.status is NodeStatus.SUCCESS:
                self._publish(
                    session,
                    "android.tap.completed",
                    node_id=trace.node_id,
                    payload={"tap_point": tap_point},
                )

    def _publish(
        self,
        session: _Session,
        event_type: str,
        *,
        node_id: str | None = None,
        edge_id: str | None = None,
        payload: JsonObject | None = None,
    ) -> None:
        self.events.publish(
            device_id=session.device_id,
            runtime_id=session.runtime_id,
            macro_id=session.definition.id,
            event_type=event_type,
            node_id=node_id,
            edge_id=edge_id,
            payload=payload,
        )

    @staticmethod
    def _wait_for_step(session: _Session, timeout_sec: float) -> None:
        deadline = time.monotonic() + timeout_sec
        while session.state is DeviceRuntimeStatus.RUNNING:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("macro step did not finish before the timeout")
            session.condition.wait(timeout=remaining)

    def _require_session(self, device_id: str) -> _Session:
        with self._lock:
            session = self._sessions.get(device_id)
        if session is None:
            raise RuntimeError("device has no macro runtime")
        return session


def _snapshot_variables(variables: dict[str, object]) -> JsonObject:
    return {name: _snapshot_variable_value(value) for name, value in variables.items()}


def _snapshot_variable_value(value: object) -> JsonValue:
    if isinstance(value, GraphElement):
        return {
            "runtime_type": "element",
            "id": value.id,
            "text": value.text,
            "bounds": {
                "left": value.bounds.left,
                "top": value.bounds.top,
                "right": value.bounds.right,
                "bottom": value.bounds.bottom,
            },
            "metadata": json.loads(json.dumps(value.metadata)),
        }
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, dict):
        return {str(key): _snapshot_variable_value(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_snapshot_variable_value(item) for item in value]
    return f"<runtime:{type(value).__name__}>"
