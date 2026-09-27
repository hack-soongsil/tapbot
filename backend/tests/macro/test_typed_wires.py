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

    def find_element(self, selector, **options):
        return self.element

    def resolve_screen_element(self, screen_id, element_id, params):
        assert screen_id == "reservation_home"
        assert element_id == "quick_date"
        self.screen_indexes.append(params["index"])
        return GraphElement(f"quick_date[{params['index']}]", TapBounds(10, 20, 30, 40))

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


def test_find_element_reference_drives_click_element_without_selector() -> None:
    element = GraphElement("stable", TapBounds(100, 200, 300, 400), "Reserve")
    ui = Ui(element)
    actions = Actions()
    graph = definition(
        (
            MacroNode("start", "find_element", {"selector": {"text": "Reserve"}}),
            MacroNode("click", "click_element", {
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
