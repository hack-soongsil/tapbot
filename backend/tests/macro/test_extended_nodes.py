import pytest

from tapbot.macro import (
    GraphElement,
    GraphEngine,
    GraphExecutionContext,
    GraphRuntimeStatus,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    NodeResult,
    TapBounds,
    create_default_node_registry,
)
from tapbot.macro.area_sampling import AreaPointSampler
from tapbot.macro.node_registry import NodeRegistry


class Actions:
    def __init__(self) -> None:
        self.taps: list[tuple[float, float, int]] = []
        self.drags: list[tuple[float, float, float, float, int]] = []

    def tap_screen(self, x, y, *, duration_ms):
        self.taps.append((x, y, duration_ms))
        return {"ok": True}

    def swipe(self, x1, y1, x2, y2, *, duration_ms):
        self.drags.append((x1, y1, x2, y2, duration_ms))
        return {"ok": True}

    def back(self):
        return {"ok": True}

    def home(self):
        return {"ok": True}


class Ui:
    def __init__(self, *, exists: bool = True, screen: str = "study_room_list") -> None:
        self.exists = exists
        self.screen = screen

    def read_ui_tree(self):
        return {"screen_width": 1000, "screen_height": 2000, "nodes": []}

    def screen_size(self):
        return 1000, 2000

    def find_element(self, selector):
        return GraphElement("stable", TapBounds(100, 200, 300, 400), "Button") if self.exists else None

    def current_state(self):
        return "ready"

    def resolve_screen_element(self, screen_id, element_id, params):
        if screen_id != self.screen:
            raise RuntimeError("screen mismatch")
        suffix = f"[{params['index']}]" if element_id in {"date_chip", "time_slot"} else ""
        return GraphElement(f"{element_id}{suffix}", TapBounds(20, 40, 120, 140))


def graph(nodes, edges=(), entry="one"):
    return MacroDefinition("extended", "Extended", 1, tuple(nodes), tuple(edges), entry)


def run_single(node: MacroNode, *, ui: Ui | None = None, seed: int = 42):
    actions = Actions()
    registry = create_default_node_registry(area_point_sampler=AreaPointSampler(seed=seed))
    result = GraphEngine(registry).run(
        graph((node,)),
        context=GraphExecutionContext(actions=actions, ui=ui or Ui()),
    )
    return actions, result


def test_click_point_supports_normalized_coordinates() -> None:
    actions, result = run_single(MacroNode("one", "click_point", {
        "x": 0.25, "y": 0.5, "coordinate_space": "normalized", "duration_ms": 80,
    }))

    assert result.runtime.state is GraphRuntimeStatus.COMPLETED
    assert actions.taps == [(250.0, 1000.0, 80)]


def test_drag_point_resolves_start_and_end() -> None:
    actions, _ = run_single(MacroNode("one", "drag_point", {
        "start": {"x": 10, "y": 20}, "end": {"x": 30, "y": 40},
        "coordinate_space": "pixel", "duration_ms": 500,
    }))

    assert actions.drags == [(10.0, 20.0, 30.0, 40.0, 500)]


def test_random_click_uniform_and_normal_are_seeded_and_inside_area() -> None:
    configs = (
        {"type": "uniform"},
        {"type": "normal", "center_x": 0.5, "center_y": 0.5, "sigma_x": 0.18, "sigma_y": 0.18, "clip": True},
    )
    points = []
    for sampling in configs:
        actions, _ = run_single(MacroNode("one", "random_click_area", {
            "area": {"left": 10, "top": 20, "right": 110, "bottom": 220},
            "coordinate_space": "pixel", "sampling": sampling, "duration_ms": 70,
        }))
        x, y, _ = actions.taps[0]
        assert 10 <= x <= 110 and 20 <= y <= 220
        points.append((x, y))
    assert points[0] != points[1]


def test_random_drag_samples_start_and_end_independently() -> None:
    actions, _ = run_single(MacroNode("one", "random_drag_area", {
        "start_area": {"left": 0, "top": 0, "right": 100, "bottom": 100},
        "end_area": {"left": 400, "top": 500, "right": 600, "bottom": 700},
        "coordinate_space": "pixel",
        "start_sampling": {"type": "uniform"},
        "end_sampling": {"type": "normal"},
        "duration_ms": 450,
    }))

    x1, y1, x2, y2, _ = actions.drags[0]
    assert 0 <= x1 <= 100 and 0 <= y1 <= 100
    assert 400 <= x2 <= 600 and 500 <= y2 <= 700


def test_click_element_resolves_each_execution_and_uses_center() -> None:
    actions, result = run_single(MacroNode("one", "click_element", {
        "selector": {"content_description": "예약"},
        "resolve": {"strategy": "best_match", "require_enabled": True, "require_visible": True},
        "click": {"mode": "center", "duration_ms": 90},
    }))

    assert actions.taps == [(200.0, 300.0, 90)]
    assert result.runtime.variables["one"]["element_id"] == "stable"


@pytest.mark.parametrize("mode", ["uniform", "normal"])
def test_click_element_supports_internal_random_sampling_modes(mode: str) -> None:
    actions, result = run_single(MacroNode("one", "click_element", {
        "selector": {"text": "Button", "ui_tree_path": "n0.0.1"},
        "click": {"mode": mode},
    }))

    x, y, duration = actions.taps[0]
    assert 100 <= x <= 300
    assert 200 <= y <= 400
    assert (x, y) != (200, 300)
    assert duration == 70
    assert result.runtime.variables["one"]["sampling"] == mode


def test_click_element_applies_hidden_safe_defaults_and_preserves_path_hint() -> None:
    class CapturingUi(Ui):
        selector = None
        options = None

        def find_element(self, selector, **options):
            self.selector = selector
            self.options = options
            return GraphElement("stable", TapBounds(100, 200, 300, 400), "Button")

    ui = CapturingUi()
    run_single(MacroNode("one", "click_element", {
        "selector": {"text": "Button", "ui_tree_path": "n0.0.1"},
        "click": {"mode": "center"},
    }), ui=ui)

    assert ui.selector == {
        "text": "Button",
        "ui_tree_path": "n0.0.1",
        "clickable": True,
        "enabled": True,
        "visible_to_user": True,
    }
    assert ui.options == {
        "strategy": "best_match",
        "require_enabled": True,
        "require_visible": True,
    }


def test_element_exists_does_not_implicitly_filter_disabled_elements() -> None:
    class CapturingUi(Ui):
        options = None

        def find_element(self, selector, **options):
            self.options = options
            return GraphElement("disabled", TapBounds(1, 2, 3, 4))

    ui = CapturingUi()
    _, result = run_single(MacroNode("one", "element_exists", {
        "selector": {"text": "예약 처리 중", "enabled": False},
    }), ui=ui)

    assert result.runtime.variables["one"]["value"] is True
    assert ui.options == {
        "strategy": "first",
        "require_enabled": False,
        "require_visible": False,
    }


def test_find_screen_element_returns_semantic_collection_element() -> None:
    actions, result = run_single(MacroNode("one", "find_screen_element", {
        "screen_id": "reservation_home", "element_id": "quick_date",
        "params": {"index": 2},
    }))

    assert actions.taps == []
    assert result.runtime.variables["one"]["element_id"] == "date_chip[2]"
    assert result.runtime.variables["one"]["found"] is True


class IndexRecorder:
    output_handles = frozenset()

    def __init__(self, values: list[int]) -> None:
        self.values = values

    def validate(self, config):
        return ()

    def execute(self, context, config):
        self.values.append(context.variables["i"])
        return NodeResult.success()


def test_for_loop_updates_index_and_runs_body_exact_count() -> None:
    values: list[int] = []
    defaults = create_default_node_registry()
    registry = NodeRegistry({
        "for_loop": defaults.get("for_loop"),
        "record_index": IndexRecorder(values),
        "stop": defaults.get("stop"),
    })
    definition = graph(
        (
            MacroNode("one", "for_loop", {"start": 0, "end": 5, "step": 1, "inclusive_end": False, "index_variable": "i"}),
            MacroNode("body", "record_index"),
            MacroNode("done", "stop"),
        ),
        (
            MacroEdge("loop", "one", "body", "loop"),
            MacroEdge("completed", "one", "done", "completed"),
        ),
    )

    result = GraphEngine(registry).run(definition)

    assert values == [0, 1, 2, 3, 4]
    assert result.runtime.state is GraphRuntimeStatus.STOPPED


class Recorder:
    output_handles = frozenset()

    def __init__(self, calls: list[str]) -> None:
        self.calls = calls

    def validate(self, config):
        return ()

    def execute(self, context, config):
        self.calls.append(config["value"])
        return NodeResult.success()


def test_sequence_runs_each_subtree_in_order() -> None:
    calls: list[str] = []
    defaults = create_default_node_registry()
    registry = NodeRegistry({"sequence": defaults.get("sequence"), "record": Recorder(calls)})
    definition = graph(
        (
            MacroNode("one", "sequence", {"outputs": 3}),
            MacroNode("a", "record", {"value": "a"}),
            MacroNode("b", "record", {"value": "b"}),
            MacroNode("c", "record", {"value": "c"}),
        ),
        (
            MacroEdge("a", "one", "a", "then_0"),
            MacroEdge("b", "one", "b", "then_1"),
            MacroEdge("c", "one", "c", "then_2"),
        ),
    )

    result = GraphEngine(registry).run(definition)

    assert calls == ["a", "b", "c"]
    assert result.runtime.state is GraphRuntimeStatus.COMPLETED


def test_extended_branch_condition_types() -> None:
    defaults = create_default_node_registry()
    definition = graph((MacroNode("one", "branch", {
        "condition": {"type": "variable_not_equals", "variable": "state", "value": "done"}
    }),))

    result = GraphEngine(NodeRegistry({"branch": defaults.get("branch")})).run(
        definition, context=GraphExecutionContext(variables={"state": "running"})
    )

    assert result.runtime.last_result is not None
    assert result.runtime.last_result.next_handle == "true"
