import pytest

from tapbot.macro import (
    GraphElement,
    GraphEngine,
    GraphExecutionContext,
    GraphRuntimeStatus,
    GraphValidationError,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    TapBounds,
    create_default_node_registry,
)
from tapbot.macro.errors import MacroExecutionError


class Actions:
    def __init__(self) -> None:
        self.taps: list[tuple[float, float, int]] = []

    def tap_screen(self, x, y, *, duration_ms):
        self.taps.append((x, y, duration_ms))
        return {"ok": True}

    def swipe(self, x1, y1, x2, y2, *, duration_ms):
        return {"ok": True}

    def back(self):
        return {"ok": True}

    def home(self):
        return {"ok": True}


class Ui:
    def __init__(self, element: GraphElement | None = None) -> None:
        self.element = element
        self.screen_indexes: list[int] = []
        self.find_calls = 0

    def find_element(self, selector, **options):
        self.find_calls += 1
        return self.element

    def resolve_screen_element(self, screen_id, element_id, params):
        assert screen_id == "study_room_list"
        assert element_id == "date_chip"
        self.screen_indexes.append(params["index"])
        return GraphElement(f"date_chip[{params['index']}]", TapBounds(10, 20, 30, 40))

    def read_ui_tree(self):
        return {"nodes": []}

    def current_state(self):
        return "ready"

    def screen_size(self):
        return 1000, 2000


def definition(nodes, edges, entry="start"):
    return MacroDefinition("typed", "Typed", 1, tuple(nodes), tuple(edges), entry)


def exec_edge(edge_id, source, target, handle="exec_out"):
    return MacroEdge(
        edge_id, source, target,
        source_handle=handle,
        target_handle="exec_in",
        kind="exec",
    )


def data_edge(edge_id, source, source_handle, target, target_handle):
    return MacroEdge(
        edge_id, source, target,
        source_handle=source_handle,
        target_handle=target_handle,
        kind="data",
    )


def test_element_exists_result_drives_branch_condition() -> None:
    ui = Ui(GraphElement("reserve", TapBounds(0, 0, 100, 100)))
    graph = definition(
        (
            MacroNode("start", "element_exists", {"selector": {"text": "Reserve"}}),
            MacroNode("branch", "branch", {}),
            MacroNode("yes", "stop"),
            MacroNode("no", "stop"),
        ),
        (
            exec_edge("next", "start", "branch"),
            data_edge("condition", "start", "result", "branch", "condition"),
            exec_edge("yes-edge", "branch", "yes", "true"),
            exec_edge("no-edge", "branch", "no", "false"),
        ),
    )

    context = GraphExecutionContext(ui=ui)
    result = GraphEngine(create_default_node_registry()).run(graph, context=context)

    assert [trace.node_id for trace in result.traces] == ["start", "branch", "yes"]
    assert context.node_outputs["start"]["result"] is True


def test_for_index_drives_find_screen_element_collection_index() -> None:
    ui = Ui()
    actions = Actions()
    graph = definition(
        (
            MacroNode("start", "for_loop", {
                "start": 0, "end": 3, "step": 1,
                "inclusive_end": False, "index_variable": "i",
            }),
            MacroNode("find", "find_screen_element", {
                "screen_id": "reservation_home",
                "element_id": "quick_date",
                "params": {},
            }),
            MacroNode("done", "stop"),
        ),
        (
            exec_edge("loop", "start", "find", "loop"),
            data_edge("index", "start", "index", "find", "index"),
            exec_edge("completed", "start", "done", "completed"),
        ),
    )

    result = GraphEngine(create_default_node_registry()).run(
        graph,
        context=GraphExecutionContext(ui=ui, actions=actions),
    )

    assert result.runtime.state is GraphRuntimeStatus.STOPPED
    assert ui.screen_indexes == [0, 1, 2]
    assert len(actions.taps) == 0


def test_for_index_overrides_time_slot_literal_index() -> None:
    class SlotUi(Ui):
        def resolve_screen_element(self, screen_id, element_id, params):
            assert screen_id == "study_room_detail"
            assert element_id == "time_slot"
            self.screen_indexes.append(params["index"])
            return GraphElement(
                f"time_slot[{params['index']}]",
                TapBounds(10, 20, 30, 40),
                metadata={"index": params["index"], "enabled": True, "visible": True},
            )

    ui = SlotUi()
    graph = definition(
        (
            MacroNode("start", "for_loop", {
                "start": 6, "end": 8, "step": 1,
                "inclusive_end": False, "index_variable": "i",
            }),
            MacroNode("find", "find_screen_element", {
                "screen_id": "reservation_detail",
                "element_id": "time_slot",
                "params": {"index": 99},
            }),
            MacroNode("done", "stop"),
        ),
        (
            exec_edge("loop", "start", "find", "loop"),
            data_edge("index", "start", "index", "find", "index"),
            exec_edge("completed", "start", "done", "completed"),
        ),
    )

    result = GraphEngine(create_default_node_registry()).run(
        graph,
        context=GraphExecutionContext(ui=ui),
    )

    assert result.runtime.state is GraphRuntimeStatus.STOPPED
    assert ui.screen_indexes == [6, 7]


def test_find_element_reference_drives_click_element_with_legacy_empty_selector() -> None:
    element = GraphElement("stable", TapBounds(100, 200, 300, 400), "Reserve")
    ui = Ui(element)
    actions = Actions()
    graph = definition(
        (
            MacroNode("start", "find_element", {"selector": {"text": "Reserve"}}),
            MacroNode("click", "click_element", {
                "selector": {
                    "text": "",
                    "ui_tree_path": None,
                    "clickable": True,
                    "enabled": True,
                    "visible_to_user": True,
                },
                "resolve": {"strategy": "best_match"},
                "click": {"duration_ms": 80},
            }),
        ),
        (
            exec_edge("next", "start", "click"),
            data_edge("element", "start", "element", "click", "element"),
        ),
    )

    GraphEngine(create_default_node_registry()).run(
        graph,
        context=GraphExecutionContext(ui=ui, actions=actions),
    )

    assert actions.taps == [(200.0, 300.0, 80)]


def test_find_screen_element_reference_drives_click_element() -> None:
    ui = Ui()
    actions = Actions()
    graph = definition(
        (
            MacroNode("start", "find_screen_element", {
                "screen_id": "reservation_home",
                "element_id": "quick_date",
                "params": {"index": 2},
            }),
            MacroNode("click", "click_element", {"sampling_mode": "center"}),
        ),
        (
            exec_edge("next", "start", "click"),
            data_edge("element", "start", "element", "click", "element"),
        ),
    )

    GraphEngine(create_default_node_registry()).run(
        graph,
        context=GraphExecutionContext(ui=ui, actions=actions),
    )

    assert ui.screen_indexes == [2]
    assert actions.taps == [(20.0, 30.0, 70)]


def test_disabled_screen_element_is_found_with_metadata_but_click_fails() -> None:
    class DisabledSlotUi(Ui):
        def resolve_screen_element(self, screen_id, element_id, params):
            assert screen_id == "study_room_detail"
            assert element_id == "time_slot"
            assert params["index"] == 6
            return GraphElement(
                "time_slot[6]",
                TapBounds(10, 20, 30, 40),
                metadata={"index": 6, "enabled": False, "visible": True, "state": "reserved"},
            )

    ui = DisabledSlotUi()
    actions = Actions()
    graph = definition(
        (
            MacroNode("start", "find_screen_element", {
                "screen_id": "reservation_detail",
                "element_id": "time_slot",
                "params": {"index": 6},
            }),
            MacroNode("click", "click_element", {
                "sampling_mode": "center",
                "selector": {"text": "이 fallback은 호출되면 안 됨"},
            }),
        ),
        (
            exec_edge("next", "start", "click"),
            data_edge("element", "start", "element", "click", "element"),
        ),
    )
    context = GraphExecutionContext(ui=ui, actions=actions)

    result = GraphEngine(create_default_node_registry()).run(graph, context=context)

    assert context.node_outputs["start"]["found"] is True
    element = context.node_outputs["start"]["element"]
    assert isinstance(element, GraphElement)
    semantic_metadata = dict(element.metadata)
    resolved_at = semantic_metadata.pop("resolved_at_monotonic")
    assert isinstance(resolved_at, float)
    assert semantic_metadata == {
        "index": 6,
        "enabled": False,
        "visible": True,
        "state": "reserved",
        "screen_id": "study_room_detail",
        "semantic_id": "time_slot",
        "params": {"index": 6},
        "node_id": "start",
    }
    assert result.runtime.variables["start"]["metadata"] == element.metadata
    assert result.runtime.state is GraphRuntimeStatus.ERROR
    assert result.runtime.error == "대상 엘리먼트가 비활성 상태입니다."
    payload = result.traces[-1].error_payload
    assert payload["code"] == "ELEMENT_DISABLED"
    assert payload["summary"] == "대상 엘리먼트가 비활성 상태입니다."
    assert payload["port"] == "element"
    assert payload["port_id"] == "element"
    assert payload["expected"] == "enabled"
    assert payload["actual"] == "disabled"
    assert payload["actual_type"] == "element"
    assert payload["actual_value"]["element_id"] == "time_slot[6]"
    assert result.traces[-1].input_summary["element"]["metadata"]["enabled"] is False
    assert result.traces[-1].resolved_inputs["element"]["element_id"] == "time_slot[6]"
    assert result.traces[-1].input_sources["element"]["source_node_id"] == "start"
    assert payload["source_node_id"] == "start"
    assert payload["source_port_id"] == "element"
    assert payload["element"]["element_id"] == "time_slot[6]"
    assert payload["element"]["semantic_id"] == "time_slot"
    assert payload["element"]["index"] == 6
    assert payload["element"]["bounds"] == [10, 20, 30, 40]
    assert payload["element"]["metadata"]["state"] == "reserved"
    assert payload["details"] == {
        "semantic_id": "time_slot",
        "params": {"index": 6},
        "bounds": [10, 20, 30, 40],
        "enabled": False,
        "visible": True,
        "screen_id": "study_room_detail",
        "ui_tree_request_id": None,
        "state": "reserved",
    }
    assert payload["hint"]
    assert ui.find_calls == 0
    assert actions.taps == []


def test_hidden_screen_element_fails_without_tapping() -> None:
    class HiddenUi(Ui):
        def resolve_screen_element(self, screen_id, element_id, params):
            return GraphElement(
                "time_slot[3]", TapBounds(10, 20, 30, 40),
                metadata={"enabled": True, "visible": False, "state": "hidden"},
            )

    ui = HiddenUi()
    actions = Actions()
    graph = _find_and_click_graph(index=3)

    result = GraphEngine(create_default_node_registry()).run(
        graph, context=GraphExecutionContext(ui=ui, actions=actions),
    )

    assert result.runtime.state is GraphRuntimeStatus.ERROR
    assert result.traces[-1].error_payload["code"] == "ELEMENT_NOT_VISIBLE"
    assert actions.taps == []


def test_zero_bounds_fail_with_structured_error_without_tapping() -> None:
    invalid_bounds = object.__new__(TapBounds)
    for name, value in (
        ("left", 10.0), ("top", 20.0), ("right", 10.0), ("bottom", 20.0),
    ):
        object.__setattr__(invalid_bounds, name, value)

    class InvalidBoundsUi(Ui):
        def resolve_screen_element(self, screen_id, element_id, params):
            return GraphElement(
                "time_slot[4]", invalid_bounds,
                metadata={"enabled": True, "visible": True},
            )

    ui = InvalidBoundsUi()
    actions = Actions()
    result = GraphEngine(create_default_node_registry()).run(
        _find_and_click_graph(index=4),
        context=GraphExecutionContext(ui=ui, actions=actions),
    )

    assert result.runtime.state is GraphRuntimeStatus.ERROR
    assert result.traces[-1].error_payload["code"] == "ELEMENT_BOUNDS_INVALID"
    assert actions.taps == []


def test_stale_element_is_re_resolved_once_and_uses_latest_bounds() -> None:
    class StaleUi(Ui):
        def __init__(self):
            super().__init__()
            self.resolve_calls = 0

        def current_ui_tree_request_id(self):
            return "tree-new"

        def resolve_screen_element(self, screen_id, element_id, params):
            self.resolve_calls += 1
            if self.resolve_calls == 1:
                return GraphElement(
                    "time_slot[5]", TapBounds(10, 20, 30, 40),
                    metadata={
                        "enabled": True, "visible": True,
                        "ui_tree_request_id": "tree-old",
                    },
                )
            return GraphElement(
                "time_slot[5]", TapBounds(100, 200, 300, 400),
                metadata={
                    "enabled": True, "visible": True,
                    "ui_tree_request_id": "tree-new",
                },
            )

    ui = StaleUi()
    actions = Actions()
    result = GraphEngine(create_default_node_registry()).run(
        _find_and_click_graph(index=5),
        context=GraphExecutionContext(ui=ui, actions=actions),
    )

    assert result.runtime.state is GraphRuntimeStatus.COMPLETED
    assert ui.resolve_calls == 2
    assert actions.taps == [(200.0, 300.0, 70)]


def test_click_point_is_clamped_to_current_screen_bounds() -> None:
    class OffscreenUi(Ui):
        def resolve_screen_element(self, screen_id, element_id, params):
            return GraphElement(
                "time_slot[8]",
                TapBounds(900, 1_900, 1_100, 2_100),
                metadata={"enabled": True, "visible": True},
            )

    actions = Actions()
    result = GraphEngine(create_default_node_registry()).run(
        _find_and_click_graph(index=8),
        context=GraphExecutionContext(ui=OffscreenUi(), actions=actions),
    )

    assert result.runtime.state is GraphRuntimeStatus.COMPLETED
    assert actions.taps == [(999.0, 1_999.0, 70)]


def test_stale_element_re_resolve_failure_is_structured_and_not_retried() -> None:
    class MissingStaleUi(Ui):
        def __init__(self):
            super().__init__()
            self.resolve_calls = 0

        def current_ui_tree_request_id(self):
            return "tree-new"

        def resolve_screen_element(self, screen_id, element_id, params):
            self.resolve_calls += 1
            if self.resolve_calls == 1:
                return GraphElement(
                    "time_slot[7]", TapBounds(10, 20, 30, 40),
                    metadata={
                        "enabled": True, "visible": True,
                        "ui_tree_request_id": "tree-old",
                    },
                )
            raise RuntimeError("missing from refreshed tree")

    ui = MissingStaleUi()
    actions = Actions()
    result = GraphEngine(create_default_node_registry()).run(
        _find_and_click_graph(index=7),
        context=GraphExecutionContext(ui=ui, actions=actions),
    )

    assert result.runtime.state is GraphRuntimeStatus.ERROR
    assert result.traces[-1].error_payload["code"] == "STALE_ELEMENT"
    assert ui.resolve_calls == 2
    assert actions.taps == []


def test_click_element_runtime_without_input_or_selector_returns_required_input_missing() -> None:
    actions = Actions()
    handler = create_default_node_registry().get("click_element")

    with pytest.raises(MacroExecutionError) as caught:
        handler.execute(GraphExecutionContext(ui=Ui(), actions=actions), {})

    assert caught.value.payload["code"] == "REQUIRED_INPUT_MISSING"
    assert actions.taps == []


def _find_and_click_graph(*, index: int) -> MacroDefinition:
    return definition(
        (
            MacroNode("start", "find_screen_element", {
                "screen_id": "study_room_detail", "element_id": "time_slot",
                "params": {"index": index},
            }),
            MacroNode("click", "click_element", {"sampling_mode": "center"}),
        ),
        (
            exec_edge("next", "start", "click"),
            data_edge("element", "start", "element", "click", "element"),
        ),
    )


def test_find_screen_element_found_output_drives_branch() -> None:
    ui = Ui()
    graph = definition(
        (
            MacroNode("start", "find_screen_element", {
                "screen_id": "reservation_home",
                "element_id": "quick_date",
                "params": {"index": 1},
            }),
            MacroNode("branch", "branch", {}),
            MacroNode("yes", "stop"),
            MacroNode("no", "stop"),
        ),
        (
            exec_edge("next", "start", "branch"),
            data_edge("found", "start", "found", "branch", "condition"),
            exec_edge("yes-edge", "branch", "yes", "true"),
            exec_edge("no-edge", "branch", "no", "false"),
        ),
    )

    result = GraphEngine(create_default_node_registry()).run(
        graph,
        context=GraphExecutionContext(ui=ui),
    )

    assert [trace.node_id for trace in result.traces] == ["start", "branch", "yes"]


def test_validator_rejects_data_type_mismatch() -> None:
    graph = definition(
        (
            MacroNode("start", "for_loop", {
                "start": 0, "end": 1, "step": 1,
                "inclusive_end": False, "index_variable": "i",
            }),
            MacroNode("branch", "branch", {}),
        ),
        (
            data_edge("bad", "start", "index", "branch", "condition"),
            exec_edge("next", "start", "branch", "loop"),
        ),
    )

    with pytest.raises(GraphValidationError, match="int -> bool"):
        GraphEngine(create_default_node_registry()).run(graph)


def test_kindless_edge_remains_an_exec_edge() -> None:
    graph = definition(
        (MacroNode("start", "wait", {"duration_ms": 0}), MacroNode("done", "stop")),
        (MacroEdge("legacy", "start", "done"),),
    )

    result = GraphEngine(create_default_node_registry()).run(graph)

    assert [trace.node_id for trace in result.traces] == ["start", "done"]
