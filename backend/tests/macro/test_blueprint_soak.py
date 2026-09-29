from __future__ import annotations

from dataclasses import dataclass, replace
import os
from pathlib import Path
import time
from typing import Any

from fastapi.testclient import TestClient
import pytest

from backend.tests.macro.test_ssutoday_reservation_e2e import (
    HEADERS,
    TOKEN,
    MockAgentActions,
    MockAgentUi,
    reservation_macro,
)
from scripts.mock_android_agent import create_app
from tapbot.macro.binding import (
    DeviceMacroBinding,
    DeviceMacroBindingRepository,
)
from tapbot.macro.events import MacroEventBroker, MacroRuntimeEvent
from tapbot.macro.graph_engine import GraphEngine
from tapbot.macro.graph_models import (
    EventEntryNodeIds,
    GraphExecutionContext,
    MacroDefinition,
)
from tapbot.macro.graph_store import FileMacroDefinitionStore
from tapbot.macro.graph_validator import GraphValidator
from tapbot.macro.node_registry import create_default_node_registry
from tapbot.macro.repository import MacroRepository
from tapbot.macro.runtime_manager import (
    DeviceRuntimeSnapshot,
    DeviceRuntimeStatus,
    RuntimeManager,
)
from tapbot.ui_resolution.screens import ScreenRecognizer


DEVICE_ID = "soak-phone"
NORMAL_INPUTS = {
    "roomName": "스터디룸 2C",
    "startTime": "18:30",
    "endTime": "19:30",
}
ALTERNATE_INPUTS = {
    "roomName": "스터디룸 2A",
    "startTime": "17:30",
    "endTime": "18:30",
}
TERMINAL_STATES = {
    DeviceRuntimeStatus.COMPLETED,
    DeviceRuntimeStatus.ERROR,
    DeviceRuntimeStatus.STOPPED,
}


@dataclass(slots=True)
class SoakHarness:
    root: Path
    client: TestClient
    actions: MockAgentActions
    ui: MockAgentUi
    repository: MacroRepository
    bindings: DeviceMacroBindingRepository
    events: MacroEventBroker
    manager: RuntimeManager

    @classmethod
    def create(cls, root: Path) -> SoakHarness:
        client = TestClient(create_app(token=TOKEN))
        actions = MockAgentActions(client)
        ui = MockAgentUi(client)
        registry = create_default_node_registry()
        repository = MacroRepository(
            FileMacroDefinitionStore(
                root / "macros",
                validator=GraphValidator(registry),
            )
        )
        repository.create(reservation_macro())
        bindings = DeviceMacroBindingRepository(root / "bindings.json")
        bindings.set(DeviceMacroBinding(DEVICE_ID, reservation_macro().id))
        events = MacroEventBroker(max_events_per_device=20_000)
        manager = RuntimeManager(
            repository,
            bindings,
            engine_factory=lambda _device_id: GraphEngine(registry),
            context_factory=lambda device_id, _binding: GraphExecutionContext(
                device_id=device_id,
                actions=actions,
                ui=ui,
            ),
            event_broker=events,
        )
        return cls(
            root,
            client,
            actions,
            ui,
            repository,
            bindings,
            events,
            manager,
        )

    def reset(self) -> DeviceRuntimeSnapshot:
        idle = self.manager.reset(DEVICE_ID)
        response = self.client.post("/api/home", headers=HEADERS)
        response.raise_for_status()
        _assert_clean_idle(idle)
        return idle

    def run(
        self,
        inputs: dict[str, object],
        *,
        timeout_sec: float = 4.0,
    ) -> DeviceRuntimeSnapshot:
        self.manager.start(DEVICE_ID, initial_variables=inputs)
        return _wait_for_terminal(self.manager, timeout_sec=timeout_sec)

    def reload_definition(self) -> None:
        before = self.repository.get(reservation_macro().id)
        serialized = before.to_json()
        restored = MacroDefinition.from_json(serialized)
        assert _definition_shape(restored) == _definition_shape(before)

        saved = self.repository.save(restored)
        reloaded_repository = MacroRepository(
            FileMacroDefinitionStore(
                self.root / "macros",
                validator=self.repository.store.validator,
            )
        )
        reloaded = reloaded_repository.get(saved.id)
        assert reloaded.version == before.version + 1
        assert _definition_shape(reloaded) == _definition_shape(before)
        self.repository = reloaded_repository
        self.manager.repository = reloaded_repository

    def close(self) -> None:
        self.manager.close()
        self.client.close()


@dataclass(slots=True)
class ReconnectedOverlay:
    runtime_id: str | None
    current_graph_id: str
    current_graph_path: tuple[str, ...]
    current_function_id: str | None
    current_node_id: str | None
    current_edge_id: str | None
    node_states: dict[str, object]
    trace: list[tuple[int, str, str, str]]

    @classmethod
    def from_snapshot(cls, snapshot: DeviceRuntimeSnapshot) -> ReconnectedOverlay:
        return cls(
            runtime_id=snapshot.runtime_id,
            current_graph_id=snapshot.current_graph_id,
            current_graph_path=snapshot.current_graph_path,
            current_function_id=snapshot.current_function_id,
            current_node_id=snapshot.current_node_id,
            current_edge_id=snapshot.current_edge_id,
            node_states=dict(snapshot.node_states),
            trace=[
                (trace.step, trace.graph_id, trace.node_id, trace.status.value)
                for trace in snapshot.trace
            ],
        )

    def apply(self, event: MacroRuntimeEvent) -> None:
        if event.runtime_id != self.runtime_id:
            return
        graph_id = event.payload.get("graph_id")
        graph_path = event.payload.get("graph_path")
        function_id = event.payload.get("function_id")
        if event.type == "macro.edge.traversed":
            self.current_edge_id = event.edge_id
            self._set_graph_context(graph_id, graph_path, function_id)
            return
        if event.type == "macro.node.started":
            assert event.node_id is not None
            self.current_node_id = event.node_id
            self.current_edge_id = None
            self._set_graph_context(graph_id, graph_path, function_id)
            self.node_states[f"{graph_id}::{event.node_id}"] = "running"
            return
        if event.type not in {"macro.node.completed", "macro.node.failed"}:
            return
        assert event.node_id is not None and isinstance(graph_id, str)
        status = event.payload["status"]
        self.current_node_id = event.node_id
        self.current_edge_id = None
        self._set_graph_context(graph_id, graph_path, function_id)
        self.node_states[f"{graph_id}::{event.node_id}"] = (
            "failure" if status == "failure" else "success"
        )
        step = event.payload["step"]
        trace_identity = (step, graph_id, event.node_id, status)
        if trace_identity not in self.trace:
            self.trace.append(trace_identity)

    def _set_graph_context(
        self,
        graph_id: object,
        graph_path: object,
        function_id: object,
    ) -> None:
        if isinstance(graph_id, str):
            self.current_graph_id = graph_id
        if isinstance(graph_path, list) and all(
            isinstance(item, str) for item in graph_path
        ):
            self.current_graph_path = tuple(graph_path)
        self.current_function_id = (
            function_id if isinstance(function_id, str) else None
        )


def _wait_for_terminal(
    manager: RuntimeManager,
    *,
    timeout_sec: float,
) -> DeviceRuntimeSnapshot:
    deadline = time.monotonic() + timeout_sec
    snapshot = manager.current(DEVICE_ID)
    while snapshot.state not in TERMINAL_STATES and time.monotonic() < deadline:
        time.sleep(0.01)
        snapshot = manager.current(DEVICE_ID)
    assert snapshot.state in TERMINAL_STATES
    return snapshot


def _wait_for_event(
    harness: SoakHarness,
    predicate,
    *,
    timeout_sec: float = 2.0,
) -> MacroRuntimeEvent:
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        event = next(
            (
                item
                for item in harness.events.history(DEVICE_ID)
                if predicate(item)
            ),
            None,
        )
        if event is not None:
            return event
        time.sleep(0.005)
    raise AssertionError("runtime event was not published before timeout")


def _definition_shape(definition: MacroDefinition) -> dict[str, Any]:
    value = definition.to_dict()
    value.pop("version", None)
    return value


def _assert_clean_idle(snapshot: DeviceRuntimeSnapshot) -> None:
    assert snapshot.state is DeviceRuntimeStatus.IDLE
    assert snapshot.runtime_id is None
    assert snapshot.current_node_id is None
    assert snapshot.current_edge_id is None
    assert snapshot.current_graph_id == "main"
    assert snapshot.current_graph_path == ("main",)
    assert snapshot.current_function_id is None
    assert snapshot.node_states == {}
    assert snapshot.trace == ()
    assert snapshot.variables == {}
    assert snapshot.error is None


def _assert_successful_run(
    harness: SoakHarness,
    snapshot: DeviceRuntimeSnapshot,
    inputs: dict[str, object],
    seen_runtime_ids: set[str],
) -> None:
    assert snapshot.state is DeviceRuntimeStatus.COMPLETED
    assert snapshot.runtime_id is not None
    assert snapshot.runtime_id not in seen_runtime_ids
    seen_runtime_ids.add(snapshot.runtime_id)
    assert snapshot.error is None
    assert snapshot.current_edge_id is None
    assert snapshot.variables == {
        **inputs,
        "call-open": {"function_id": "open-study-room"},
        "call-range": {"function_id": "select-time-range"},
        "call-submit": {"function_id": "submit-reservation"},
    }
    assert snapshot.step_count == len(snapshot.trace)
    assert [trace.step for trace in snapshot.trace] == list(
        range(1, len(snapshot.trace) + 1)
    )
    identities = [(trace.graph_id, trace.node_id) for trace in snapshot.trace]
    assert len(identities) == len(set(identities))
    assert all(state == "success" for state in snapshot.node_states.values())
    assert (
        "function:select-time-range",
        "branch-start-found",
    ) in identities

    function_inputs = {
        "function:open-study-room": {"roomName": inputs["roomName"]},
        "function:select-time-range": {
            "startTime": inputs["startTime"],
            "endTime": inputs["endTime"],
        },
        "function:submit-reservation": {},
    }
    for trace in snapshot.trace:
        if trace.graph_id in function_inputs:
            assert trace.function_input_summary == function_inputs[trace.graph_id]

    runtime_events = [
        event for event in harness.events.history(DEVICE_ID)
        if event.runtime_id == snapshot.runtime_id
    ]
    started_events = [
        event for event in runtime_events
        if event.type == "macro.runtime.started"
    ]
    assert len(started_events) == 1
    assert started_events[0].payload["entry_node_id"] == "call-open"
    assert started_events[0].payload["event_entry_node_ids"] == {
        "enter": "call-open",
    }
    assert sum(event.type == "macro.runtime.completed" for event in runtime_events) == 1
    completed_steps = [
        event.payload["step"]
        for event in runtime_events
        if event.type in {"macro.node.completed", "macro.node.failed"}
    ]
    assert completed_steps == list(range(1, len(completed_steps) + 1))

    tree = harness.client.get("/api/ui-tree", headers=HEADERS).json()
    recognition = ScreenRecognizer().recognize(tree)
    assert recognition is not None
    assert recognition.screen_id == "study_room_complete"
    assert recognition.context["room_name"] == inputs["roomName"]
    assert recognition.context["time_range"] == (
        f"{inputs['startTime']} ~ {inputs['endTime']}"
    )


def _exercise_repeated_runs(root: Path, iterations: int) -> None:
    harness = SoakHarness.create(root)
    runtime_ids: set[str] = set()
    try:
        for iteration in range(iterations):
            harness.reset()
            if iteration == iterations // 2:
                harness.reload_definition()
            inputs = NORMAL_INPUTS if iteration % 2 == 0 else ALTERNATE_INPUTS
            snapshot = harness.run(inputs)
            _assert_successful_run(harness, snapshot, inputs, runtime_ids)
        assert len(runtime_ids) == iterations
    finally:
        harness.close()


def test_blueprint_regression_smoke_repeats_without_state_leakage(
    tmp_path: Path,
) -> None:
    _exercise_repeated_runs(tmp_path, 3)


@pytest.mark.blueprint_soak
@pytest.mark.skipif(
    os.getenv("TAPBOT_RUN_BLUEPRINT_SOAK") != "1",
    reason="set TAPBOT_RUN_BLUEPRINT_SOAK=1 to run the 30-iteration soak",
)
def test_blueprint_soak_runs_thirty_times_without_state_leakage(
    tmp_path: Path,
) -> None:
    iterations = int(os.getenv("TAPBOT_BLUEPRINT_SOAK_ITERATIONS", "30"))
    assert iterations >= 30
    _exercise_repeated_runs(tmp_path, iterations)


@pytest.mark.parametrize(
    ("inputs", "error_code"),
    (
        ({**NORMAL_INPUTS, "startTime": "18:00", "endTime": "18:30"}, "SLOT_RESERVED"),
        (NORMAL_INPUTS, "CTA_DISABLED"),
        ({**NORMAL_INPUTS, "roomName": "없는 스터디룸"}, "ROOM_NOT_FOUND"),
    ),
)
def test_blueprint_recovers_after_controlled_runtime_error(
    tmp_path: Path,
    inputs: dict[str, object],
    error_code: str,
) -> None:
    harness = SoakHarness.create(tmp_path)
    runtime_ids: set[str] = set()
    try:
        harness.reset()
        if error_code == "CTA_DISABLED":
            base = reservation_macro()
            harness.repository.save(replace(
                base,
                entry_node_id="call-submit",
                event_entry_node_ids=EventEntryNodeIds(enter="call-submit"),
            ))
            room = harness.ui.resolve_screen_element(
                "study_room_list",
                "room_card_by_name",
                {"name": NORMAL_INPUTS["roomName"]},
            )
            center = room.bounds.center
            harness.actions.tap_screen(center.x, center.y, duration_ms=70)
            assert harness.ui.current_state() == "study_room_detail"
        failed = harness.run(inputs)
        assert failed.state is DeviceRuntimeStatus.ERROR
        assert failed.runtime_id is not None
        runtime_ids.add(failed.runtime_id)
        assert failed.error is not None
        failure = next(
            trace
            for trace in failed.trace
            if trace.error_payload is not None
            and trace.error_payload["code"] == error_code
        )
        assert failure.error_payload is not None
        assert failure.error_payload["graph_path"]
        assert any(state == "failure" for state in failed.node_states.values())

        harness.reset()
        if error_code == "CTA_DISABLED":
            harness.repository.save(reservation_macro())
        recovered = harness.run(NORMAL_INPUTS)
        _assert_successful_run(
            harness,
            recovered,
            NORMAL_INPUTS,
            runtime_ids,
        )
    finally:
        harness.close()


def test_runtime_snapshot_recovers_overlay_after_event_stream_reconnect(
    tmp_path: Path,
) -> None:
    harness = SoakHarness.create(tmp_path)
    try:
        harness.reset()
        harness.manager.start(DEVICE_ID, initial_variables=NORMAL_INPUTS)
        marker = _wait_for_event(
            harness,
            lambda event: event.type == "macro.node.started"
            and event.node_id == "wait-submit",
        )
        disconnected_snapshot = harness.manager.current(DEVICE_ID)
        assert disconnected_snapshot.state is DeviceRuntimeStatus.RUNNING
        assert disconnected_snapshot.current_graph_id == "function:submit-reservation"
        assert disconnected_snapshot.current_graph_path == (
            "main",
            "submit-reservation",
        )
        assert disconnected_snapshot.current_node_id == "wait-submit"

        overlay = ReconnectedOverlay.from_snapshot(disconnected_snapshot)
        final = _wait_for_terminal(harness.manager, timeout_sec=4.0)
        missed_events = harness.events.history(
            DEVICE_ID,
            after_event_id=marker.event_id,
        )
        assert missed_events
        for event in missed_events:
            overlay.apply(event)

        assert overlay.runtime_id == final.runtime_id
        assert overlay.current_graph_id == final.current_graph_id
        assert overlay.current_graph_path == final.current_graph_path
        assert overlay.current_function_id == final.current_function_id
        assert overlay.current_node_id == final.current_node_id
        assert overlay.current_edge_id == final.current_edge_id
        assert overlay.node_states == final.node_states
        assert overlay.trace == [
            (trace.step, trace.graph_id, trace.node_id, trace.status.value)
            for trace in final.trace
        ]
    finally:
        harness.close()
