from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any

from fastapi.testclient import TestClient
import pytest

from scripts.mock_android_agent import create_app
from tapbot.macro import (
    FunctionPortDefinition,
    GraphElement,
    GraphEngine,
    GraphExecutionContext,
    GraphRuntimeStatus,
    MacroDefinition,
    MacroEdge,
    MacroFunctionDefinition,
    MacroNode,
    MacroVariableDefinition,
    TapBounds,
    create_default_node_registry,
)
from tapbot.ui_resolution.screens import (
    ScreenRecognizer,
    canonical_screen_id,
    screen_element_semantic_id,
)


TOKEN = "reservation-e2e"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


class MockAgentActions:
    def __init__(self, client: TestClient) -> None:
        self.client = client
        self.taps: list[tuple[float, float]] = []
        self.swipes: list[tuple[float, float, float, float]] = []

    def tap_screen(self, x: float, y: float, *, duration_ms: int):
        self.taps.append((x, y))
        response = self.client.post(
            "/api/tap",
            headers=HEADERS,
            json={"x": x, "y": y, "duration_ms": duration_ms},
        )
        response.raise_for_status()
        return response.json()

    def swipe(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        *,
        duration_ms: int,
    ):
        self.swipes.append((x1, y1, x2, y2))
        response = self.client.post(
            "/api/swipe",
            headers=HEADERS,
            json={
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "duration_ms": duration_ms,
            },
        )
        response.raise_for_status()
        return response.json()

    def back(self):
        response = self.client.post("/api/back", headers=HEADERS)
        response.raise_for_status()
        return response.json()

    def home(self):
        response = self.client.post("/api/home", headers=HEADERS)
        response.raise_for_status()
        return response.json()


class MockAgentUi:
    def __init__(self, client: TestClient) -> None:
        self.client = client

    def read_ui_tree(self) -> dict[str, Any]:
        response = self.client.get("/api/ui-tree", headers=HEADERS)
        response.raise_for_status()
        return response.json()

    def screen_size(self) -> tuple[int, int]:
        tree = self.read_ui_tree()
        return tree["screen_width"], tree["screen_height"]

    def current_state(self) -> str:
        recognition = ScreenRecognizer().recognize(self.read_ui_tree())
        return recognition.screen_id if recognition else "unknown"

    def find_element(self, selector, **options):
        del selector, options
        return None

    def resolve_screen_element(
        self,
        screen_id: str,
        element_id: str,
        params: dict[str, object],
    ) -> GraphElement:
        recognition = ScreenRecognizer().recognize(self.read_ui_tree())
        if (
            recognition is None
            or canonical_screen_id(recognition.screen_id)
            != canonical_screen_id(screen_id)
        ):
            actual = "unknown" if recognition is None else recognition.screen_id
            raise RuntimeError(
                f"screen mismatch: expected {screen_id!r}, recognized {actual!r}"
            )
        try:
            semantic_id = screen_element_semantic_id(
                screen_id, element_id, params
            )
        except ValueError as error:
            raise RuntimeError(str(error)) from error
        candidate = next(
            (
                item for item in recognition.elements
                if item.semantic_id == semantic_id
            ),
            None,
        )
        if candidate is None:
            raise RuntimeError(
                f"screen element {screen_id}/{semantic_id} was not found"
            )
        return GraphElement(
            candidate.semantic_id,
            TapBounds(
                candidate.bounds.left,
                candidate.bounds.top,
                candidate.bounds.right,
                candidate.bounds.bottom,
            ),
            candidate.text,
            {"semantic_id": candidate.semantic_id, **candidate.metadata},
        )


def _exec(
    edge_id: str,
    source: str,
    target: str,
    source_handle: str = "exec_out",
) -> MacroEdge:
    return MacroEdge(
        edge_id,
        source,
        target,
        source_handle=source_handle,
        target_handle="exec_in",
        kind="exec",
    )


def _data(
    edge_id: str,
    source: str,
    source_handle: str,
    target: str,
    target_handle: str,
) -> MacroEdge:
    return MacroEdge(
        edge_id,
        source,
        target,
        source_handle=source_handle,
        target_handle=target_handle,
        kind="data",
    )


def _string_port(port_id: str) -> FunctionPortDefinition:
    return FunctionPortDefinition(port_id, "string", required=True)


def _completion_output() -> tuple[FunctionPortDefinition, ...]:
    # Intentionally left unwired at Function Return and unused by callers. This
    # exercises Blueprint's optional-return contract in the real E2E flow.
    return (FunctionPortDefinition("completed", "bool", default=True),)


def _find(
    node_id: str,
    screen_id: str,
    element_id: str,
    *,
    missing_code: str,
    screen_mismatch_code: str = "SCREEN_MISMATCH",
) -> MacroNode:
    return MacroNode(
        node_id,
        "find_screen_element",
        {
            "screen_id": screen_id,
            "element_id": element_id,
            "params": {},
            "required": True,
            "missing_error_code": missing_code,
            "screen_mismatch_code": screen_mismatch_code,
        },
        label=f"Find {element_id}",
    )


def _open_study_room() -> MacroFunctionDefinition:
    nodes = (
        MacroNode("open-entry", "function_entry", label="OpenStudyRoom Entry"),
        _find(
            "find-room",
            "study_room_list",
            "room_card_by_name",
            missing_code="ROOM_NOT_FOUND",
        ),
        MacroNode("click-room", "click_element", label="Open room card"),
        MacroNode("open-return", "function_return", label="OpenStudyRoom Return"),
    )
    edges = (
        _exec("open-find", "open-entry", "find-room"),
        _exec("open-click", "find-room", "click-room"),
        _exec("open-done", "click-room", "open-return"),
        _data("open-name", "open-entry", "roomName", "find-room", "name"),
        _data("open-element", "find-room", "element", "click-room", "element"),
    )
    return MacroFunctionDefinition(
        "open-study-room",
        "OpenStudyRoom",
        (_string_port("roomName"),),
        _completion_output(),
        nodes,
        edges,
        "open-entry",
        "open-return",
    )


def _timeline_swipe(node_id: str) -> MacroNode:
    return MacroNode(
        node_id,
        "drag_point",
        {
            "start": {"x": 980, "y": 1150},
            "end": {"x": 80, "y": 1150},
            "coordinate_space": "pixel",
            "duration_ms": 250,
        },
        label="Scroll time slots",
    )


def _select_time_range() -> MacroFunctionDefinition:
    nodes = (
        MacroNode("range-entry", "function_entry", label="SelectTimeRange Entry"),
        _timeline_swipe("scroll-slots-1"),
        _timeline_swipe("scroll-slots-2"),
        _timeline_swipe("scroll-slots-3"),
        _find(
            "find-start-slot",
            "study_room_detail",
            "time_slot_by_time",
            missing_code="SLOT_NOT_FOUND",
        ),
        MacroNode(
            "branch-start-found",
            "branch",
            label="Start slot is available",
        ),
        MacroNode("click-start-slot", "click_element", label="Select start time"),
        _find(
            "find-end-slot",
            "study_room_detail",
            "time_slot_by_end_time",
            missing_code="SLOT_NOT_FOUND",
        ),
        MacroNode("click-end-slot", "click_element", label="Select end time"),
        MacroNode("range-return", "function_return", label="SelectTimeRange Return"),
    )
    edges = (
        _exec("range-scroll-1", "range-entry", "scroll-slots-1"),
        _exec("range-scroll-2", "scroll-slots-1", "scroll-slots-2"),
        _exec("range-scroll-3", "scroll-slots-2", "scroll-slots-3"),
        _exec("range-find-start", "scroll-slots-3", "find-start-slot"),
        _exec("range-check-start", "find-start-slot", "branch-start-found"),
        _exec(
            "range-click-start",
            "branch-start-found",
            "click-start-slot",
            source_handle="true",
        ),
        _exec("range-find-end", "click-start-slot", "find-end-slot"),
        _exec("range-click-end", "find-end-slot", "click-end-slot"),
        _exec("range-done", "click-end-slot", "range-return"),
        _data("range-start", "range-entry", "startTime", "find-start-slot", "name"),
        _data("range-end", "range-entry", "endTime", "find-end-slot", "name"),
        _data(
            "range-start-found",
            "find-start-slot",
            "found",
            "branch-start-found",
            "condition",
        ),
        _data(
            "range-start-element",
            "find-start-slot",
            "element",
            "click-start-slot",
            "element",
        ),
        _data(
            "range-end-element",
            "find-end-slot",
            "element",
            "click-end-slot",
            "element",
        ),
    )
    return MacroFunctionDefinition(
        "select-time-range",
        "SelectTimeRange",
        (_string_port("startTime"), _string_port("endTime")),
        _completion_output(),
        nodes,
        edges,
        "range-entry",
        "range-return",
    )


def _submit_reservation() -> MacroFunctionDefinition:
    nodes = (
        MacroNode("submit-entry", "function_entry", label="SubmitReservation Entry"),
        _find(
            "find-reserve-cta",
            "study_room_detail",
            "reserve_cta",
            missing_code="CTA_DISABLED",
        ),
        MacroNode("click-reserve-cta", "click_element", label="Submit reservation"),
        _find(
            "find-confirm",
            "study_room_confirm",
            "confirm_reservation",
            missing_code="RESERVATION_FAILED",
        ),
        MacroNode("click-confirm", "click_element", label="Confirm reservation"),
        MacroNode("wait-submit", "wait", {"duration_ms": 900}),
        _find(
            "find-success",
            "study_room_complete",
            "success_title",
            missing_code="RESERVATION_FAILED",
            screen_mismatch_code="RESERVATION_FAILED",
        ),
        MacroNode("submit-return", "function_return", label="SubmitReservation Return"),
    )
    edges = (
        _exec("submit-find", "submit-entry", "find-reserve-cta"),
        _exec("submit-click", "find-reserve-cta", "click-reserve-cta"),
        _exec("submit-find-confirm", "click-reserve-cta", "find-confirm"),
        _exec("submit-confirm", "find-confirm", "click-confirm"),
        _exec("submit-wait", "click-confirm", "wait-submit"),
        _exec("submit-success", "wait-submit", "find-success"),
        _exec("submit-done", "find-success", "submit-return"),
        _data(
            "submit-cta-element",
            "find-reserve-cta",
            "element",
            "click-reserve-cta",
            "element",
        ),
        _data(
            "submit-confirm-element",
            "find-confirm",
            "element",
            "click-confirm",
            "element",
        ),
    )
    return MacroFunctionDefinition(
        "submit-reservation",
        "SubmitReservation",
        (),
        _completion_output(),
        nodes,
        edges,
        "submit-entry",
        "submit-return",
    )


def reservation_macro() -> MacroDefinition:
    functions = (
        _open_study_room(),
        _select_time_range(),
        _submit_reservation(),
    )
    nodes = (
        MacroNode("get-room", "get_variable", {"name": "roomName", "type": "string"}),
        MacroNode("get-start", "get_variable", {"name": "startTime", "type": "string"}),
        MacroNode("get-end", "get_variable", {"name": "endTime", "type": "string"}),
        MacroNode("call-open", "call_function", {"function_id": "open-study-room"}),
        MacroNode("call-range", "call_function", {"function_id": "select-time-range"}),
        MacroNode("call-submit", "call_function", {"function_id": "submit-reservation"}),
    )
    edges = (
        _exec("main-range", "call-open", "call-range"),
        _exec("main-submit", "call-range", "call-submit"),
        _data("main-room", "get-room", "value", "call-open", "roomName"),
        _data("main-start", "get-start", "value", "call-range", "startTime"),
        _data("main-end", "get-end", "value", "call-range", "endTime"),
    )
    variables = (
        MacroVariableDefinition("roomName", "string", "스터디룸 2C", input=True),
        MacroVariableDefinition("startTime", "string", "18:30", input=True),
        MacroVariableDefinition("endTime", "string", "19:30", input=True),
    )
    return MacroDefinition(
        "ssutoday-study-room-reservation",
        "SSUTODAY 스터디룸 예약",
        1,
        nodes,
        edges,
        "call-open",
        functions=functions,
        variables=variables,
    )


@dataclass(slots=True)
class E2eRun:
    client: TestClient
    actions: MockAgentActions
    result: Any
    starts: list[tuple[str, str]]


def run_reservation(
    *,
    room_name: str = "스터디룸 2C",
    start_time: str = "18:30",
    end_time: str = "19:30",
) -> E2eRun:
    client = TestClient(create_app(token=TOKEN))
    actions = MockAgentActions(client)
    ui = MockAgentUi(client)
    starts: list[tuple[str, str]] = []
    result = GraphEngine(create_default_node_registry()).run(
        reservation_macro(),
        context=GraphExecutionContext(
            actions=actions,
            ui=ui,
            variables={
                "roomName": room_name,
                "startTime": start_time,
                "endTime": end_time,
            },
        ),
        on_node_start=lambda node, runtime: starts.append(
            (runtime.graph_id, node.id)
        ),
    )
    return E2eRun(client, actions, result, starts)


def _detail_probe() -> tuple[TestClient, MockAgentActions, MockAgentUi]:
    client = TestClient(create_app(token=TOKEN))
    actions = MockAgentActions(client)
    ui = MockAgentUi(client)
    room = ui.resolve_screen_element(
        "study_room_list",
        "room_card_by_name",
        {"name": "스터디룸 2C"},
    )
    center = room.bounds.center
    actions.tap_screen(center.x, center.y, duration_ms=70)
    assert ui.current_state() == "study_room_detail"
    return client, actions, ui


def _run_probe(
    client: TestClient,
    actions: MockAgentActions,
    ui: MockAgentUi,
    nodes: tuple[MacroNode, ...],
    edges: tuple[MacroEdge, ...] = (),
):
    return GraphEngine(create_default_node_registry()).run(
        MacroDefinition("probe", "Reservation probe", 5, nodes, edges, nodes[0].id),
        context=GraphExecutionContext(actions=actions, ui=ui),
    )


def _find_and_click_probe(
    client: TestClient,
    actions: MockAgentActions,
    ui: MockAgentUi,
    find: MacroNode,
):
    click = MacroNode("click-target", "click_element", label="Click target")
    return _run_probe(
        client,
        actions,
        ui,
        (find, click),
        (
            _exec("probe-exec", find.id, click.id),
            _data("probe-element", find.id, "element", click.id, "element"),
        ),
    )


@pytest.mark.parametrize(
    ("room_name", "start_time", "end_time"),
    (
        ("스터디룸 2C", "18:30", "19:30"),
        ("스터디룸 2A", "17:30", "18:30"),
    ),
)
def test_blueprint_reserves_study_room_through_mock_android_agent(
    room_name: str,
    start_time: str,
    end_time: str,
) -> None:
    run = run_reservation(
        room_name=room_name,
        start_time=start_time,
        end_time=end_time,
    )

    assert run.result.runtime.state is GraphRuntimeStatus.COMPLETED
    tree = run.client.get("/api/ui-tree", headers=HEADERS).json()
    recognition = ScreenRecognizer().recognize(tree)
    assert recognition is not None and recognition.screen_id == "study_room_complete"
    assert recognition.context["room_name"] == room_name
    assert recognition.context["time_range"] == f"{start_time} ~ {end_time}"

    traces = run.result.traces
    for function_id, function_name in (
        ("open-study-room", "OpenStudyRoom"),
        ("select-time-range", "SelectTimeRange"),
        ("submit-reservation", "SubmitReservation"),
    ):
        function_traces = [
            trace for trace in traces if trace.graph_id == f"function:{function_id}"
        ]
        assert function_traces[0].node_type == "function_entry"
        assert function_traces[-1].node_type == "function_return"
        assert all(trace.graph_path_labels == ("Main", function_name) for trace in function_traces)
    assert ("function:select-time-range", "click-start-slot") in run.starts
    assert ("function:select-time-range", "click-end-slot") in run.starts
    assert all(
        "selector" not in node.config
        for function in reservation_macro().functions
        for node in function.nodes
        if node.type == "find_screen_element"
    )


def test_reserved_slot_fails_on_exact_function_node_without_reservation_click() -> None:
    run = run_reservation(start_time="18:00", end_time="18:30")

    assert run.result.runtime.state is GraphRuntimeStatus.ERROR
    failure = next(
        trace for trace in run.result.traces
        if trace.node_id == "click-start-slot" and trace.error_payload is not None
    )
    assert failure.graph_path_labels == ("Main", "SelectTimeRange")
    assert failure.graph_id == "function:select-time-range"
    assert failure.error_payload["code"] == "SLOT_RESERVED"
    assert failure.error_payload["node_id"] == "click-start-slot"
    assert failure.error_payload["element"]["metadata"]["state"] == "booked"
    assert failure.error_payload["element"]["metadata"]["start_time"] == "18:00"
    assert run.client.get("/api/status", headers=HEADERS).json()["mock"]["screen"] == "detail"
    # Only the room card was tapped; a disabled slot and reservation CTA never are.
    assert len(run.actions.taps) == 1


def test_unknown_room_produces_structured_room_not_found_context() -> None:
    run = run_reservation(room_name="없는 스터디룸")

    assert run.result.runtime.state is GraphRuntimeStatus.ERROR
    failure = next(
        trace for trace in run.result.traces
        if trace.node_id == "find-room" and trace.error_payload is not None
    )
    assert failure.error_payload["code"] == "ROOM_NOT_FOUND"
    assert failure.error_payload["graph_path"] == ["Main", "OpenStudyRoom"]
    assert failure.error_payload["input_values"] == {"name": "없는 스터디룸"}
    assert failure.error_payload["details"] == {
        "screen_id": "study_room_list",
        "element_id": "room_card_by_name",
        "params": {"name": "없는 스터디룸"},
    }
    assert run.actions.taps == []


def test_unknown_slot_produces_structured_slot_not_found_context() -> None:
    run = run_reservation(start_time="18:15", end_time="19:30")

    failure = next(
        trace for trace in run.result.traces
        if trace.node_id == "find-start-slot" and trace.error_payload is not None
    )
    assert failure.error_payload["code"] == "SLOT_NOT_FOUND"
    assert failure.error_payload["graph_path"] == ["Main", "SelectTimeRange"]
    assert failure.error_payload["input_values"] == {"name": "18:15"}
    assert failure.error_payload["details"]["params"] == {"name": "18:15"}


def test_past_slot_produces_structured_slot_disabled_context() -> None:
    client, actions, ui = _detail_probe()
    find = _find(
        "find-past-slot",
        "study_room_detail",
        "time_slot_by_time",
        missing_code="SLOT_NOT_FOUND",
    )
    find = MacroNode(
        find.id,
        find.type,
        {**find.config, "params": {"name": "08:00"}},
        label=find.label,
    )

    result = _find_and_click_probe(client, actions, ui, find)

    assert result.runtime.state is GraphRuntimeStatus.ERROR
    payload = result.traces[-1].error_payload
    assert payload is not None and payload["code"] == "SLOT_DISABLED"
    assert payload["element"]["metadata"]["state"] == "past"


def test_unselected_reservation_cta_produces_structured_disabled_context() -> None:
    client, actions, ui = _detail_probe()
    find = _find(
        "find-disabled-cta",
        "study_room_detail",
        "reserve_cta",
        missing_code="CTA_DISABLED",
    )

    result = _find_and_click_probe(client, actions, ui, find)

    payload = result.traces[-1].error_payload
    assert payload is not None and payload["code"] == "CTA_DISABLED"
    metadata = payload["element"]["metadata"]
    assert metadata["semantic_id"] == "reserve_cta"
    assert metadata["enabled"] is False
    assert metadata["state"] == "idle"
    assert metadata["text"] == "시간을 선택하세요"


@pytest.mark.parametrize(
    ("screen_id", "code"),
    (
        ("study_room_detail", "SCREEN_MISMATCH"),
        ("study_room_complete", "RESERVATION_FAILED"),
    ),
)
def test_required_screen_check_uses_scenario_error_code(
    screen_id: str,
    code: str,
) -> None:
    client = TestClient(create_app(token=TOKEN))
    actions = MockAgentActions(client)
    ui = MockAgentUi(client)
    element_id = "room_name" if screen_id == "study_room_detail" else "success_title"
    find = _find(
        "find-required-screen",
        screen_id,
        element_id,
        missing_code=code,
        screen_mismatch_code=code,
    )

    result = _run_probe(client, actions, ui, (find,))

    payload = result.traces[-1].error_payload
    assert payload is not None and payload["code"] == code
    assert payload["details"]["screen_id"] == screen_id
