from datetime import datetime, timezone

from tapbot.macro import (
    GraphElement,
    GraphEngine,
    GraphExecutionContext,
    GraphRunLimits,
    GraphRuntimeStatus,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    NodeRegistry,
    NodeResult,
    NodeStatus,
    TapBounds,
    TapPointSampler,
    create_default_node_registry,
)


NOW = datetime(2026, 9, 27, tzinfo=timezone.utc)


class RecordHandler:
    output_handles = frozenset()

    def __init__(self, calls: list[str]) -> None:
        self.calls = calls

    def validate(self, config):
        return () if isinstance(config.get("value"), str) else ("value required",)

    def execute(self, context, config):
        value = config["value"]
        assert isinstance(value, str)
        self.calls.append(value)
        return NodeResult.success({"value": value})


class RetryForeverHandler:
    output_handles = frozenset()

    def validate(self, config):
        return ()

    def execute(self, context, config):
        return NodeResult(NodeStatus.RETRY)


class RepeatForeverHandler:
    output_handles = frozenset({"repeat"})

    def validate(self, config):
        return ()

    def execute(self, context, config):
        return NodeResult.success(next_handle="repeat")


def graph(
    nodes: tuple[MacroNode, ...],
    edges: tuple[MacroEdge, ...] = (),
    *,
    entry: str = "one",
) -> MacroDefinition:
    return MacroDefinition("test", "Test graph", 1, nodes, edges, entry)


def engine(registry: NodeRegistry, **limit_overrides: object) -> GraphEngine:
    return GraphEngine(
        registry,
        limits=GraphRunLimits(**limit_overrides),  # type: ignore[arg-type]
        now=lambda: NOW,
    )


def test_linear_graph_runs_in_edge_order_and_records_trace() -> None:
    calls: list[str] = []
    registry = NodeRegistry({"record": RecordHandler(calls)})
    definition = graph(
        (
            MacroNode(
                "one",
                "record",
                {"value": "first", "agent_token": "do-not-trace"},
            ),
            MacroNode("two", "record", {"value": "second"}),
        ),
        (MacroEdge("next", "one", "two"),),
    )

    result = engine(registry).run(definition)

    assert calls == ["first", "second"]
    assert result.runtime.state is GraphRuntimeStatus.COMPLETED
    assert result.runtime.step_count == 2
    assert [trace.node_id for trace in result.traces] == ["one", "two"]
    assert result.traces[0].input_summary["agent_token"] == "<redacted>"
    assert result.runtime.variables["two"] == {"value": "second"}


def test_branch_graph_uses_named_source_handle() -> None:
    calls: list[str] = []
    defaults = create_default_node_registry()
    registry = NodeRegistry(
        {"branch": defaults.get("branch"), "record": RecordHandler(calls)}
    )
    definition = graph(
        (
            MacroNode("one", "branch", {"variable": "ready"}),
            MacroNode("yes", "record", {"value": "yes"}),
            MacroNode("no", "record", {"value": "no"}),
        ),
        (
            MacroEdge("true", "one", "yes", "true"),
            MacroEdge("false", "one", "no", "false"),
        ),
    )

    result = engine(registry).run(
        definition,
        context=GraphExecutionContext(variables={"ready": True}),
    )

    assert result.runtime.state is GraphRuntimeStatus.COMPLETED
    assert calls == ["yes"]
    assert [trace.node_id for trace in result.traces] == ["one", "yes"]


def test_retry_limit_stops_handler_that_never_succeeds() -> None:
    definition = graph((MacroNode("one", "retry_forever"),))

    result = engine(
        NodeRegistry({"retry_forever": RetryForeverHandler()}),
        retry_limit=2,
    ).run(definition)

    assert result.runtime.state is GraphRuntimeStatus.ERROR
    assert result.runtime.step_count == 3
    assert result.runtime.error == "retry limit exceeded at node 'one'"


def test_repeat_limit_stops_control_flow_loop() -> None:
    definition = graph(
        (MacroNode("one", "repeat_forever"),),
        (MacroEdge("loop", "one", "one", "repeat"),),
    )

    result = engine(
        NodeRegistry({"repeat_forever": RepeatForeverHandler()}),
        repeat_limit=2,
    ).run(definition)

    assert result.runtime.state is GraphRuntimeStatus.ERROR
    assert result.runtime.step_count == 3
    assert result.runtime.error == "repeat limit exceeded at node 'one'"


def test_cancellation_is_checked_before_node_execution() -> None:
    calls: list[str] = []
    definition = graph((MacroNode("one", "record", {"value": "never"}),))

    result = engine(NodeRegistry({"record": RecordHandler(calls)})).run(
        definition,
        cancelled=lambda: True,
    )

    assert result.runtime.state is GraphRuntimeStatus.CANCELLED
    assert result.runtime.step_count == 0
    assert calls == []


def test_max_step_guard_stops_an_unbounded_cycle() -> None:
    calls: list[str] = []
    definition = graph(
        (MacroNode("one", "record", {"value": "loop"}),),
        (MacroEdge("loop", "one", "one"),),
    )

    result = engine(
        NodeRegistry({"record": RecordHandler(calls)}),
        max_steps=3,
    ).run(definition)

    assert result.runtime.state is GraphRuntimeStatus.ERROR
    assert result.runtime.step_count == 3
    assert result.runtime.error == "maximum graph step count 3 exceeded"


class AdvancingClock:
    def __init__(self) -> None:
        self.value = 0.0

    def __call__(self) -> float:
        value = self.value
        self.value += 0.6
        return value


def test_execution_timeout_is_checked_after_node_returns() -> None:
    calls: list[str] = []
    clock = AdvancingClock()
    definition = graph((MacroNode("one", "record", {"value": "ran"}),))
    runner = GraphEngine(
        NodeRegistry({"record": RecordHandler(calls)}),
        limits=GraphRunLimits(execution_timeout_sec=1),
        monotonic=clock,
        now=lambda: NOW,
    )

    result = runner.run(definition)

    assert calls == ["ran"]
    assert result.runtime.state is GraphRuntimeStatus.ERROR
    assert result.runtime.error == "graph execution timeout exceeded"
    assert result.traces[0].status is NodeStatus.FAILURE


class FakeActions:
    def __init__(self) -> None:
        self.taps: list[tuple[float, float, int]] = []

    def tap_screen(self, x, y, *, duration_ms):
        self.taps.append((x, y, duration_ms))
        return {"status": "completed"}

    def swipe(self, *args, **kwargs):
        raise AssertionError("swipe not expected")

    def back(self):
        raise AssertionError("back not expected")

    def home(self):
        raise AssertionError("home not expected")


class FakeUi:
    def read_ui_tree(self):
        return []

    def find_element(self, selector):
        return GraphElement("login", TapBounds(10, 20, 110, 60), "Login")

    def current_state(self):
        return "ready"


def _run_seeded_tap(seed: int):
    actions = FakeActions()
    registry = create_default_node_registry(
        tap_point_sampler=TapPointSampler(seed=seed)
    )
    definition = graph(
        (
            MacroNode(
                "one",
                "tap_element",
                {"selector": {"text": "Login"}, "duration_ms": 80},
            ),
        )
    )
    result = engine(registry).run(
        definition,
        context=GraphExecutionContext(actions=actions, ui=FakeUi()),
    )
    return actions, result


def test_tap_element_uses_seeded_safe_sampler_once_for_trace_and_execution() -> None:
    first_actions, first = _run_seeded_tap(42)
    second_actions, second = _run_seeded_tap(42)

    assert first.runtime.state is GraphRuntimeStatus.COMPLETED
    assert first_actions.taps == second_actions.taps
    x, y, duration = first_actions.taps[0]
    output = first.runtime.variables["one"]
    assert isinstance(output, dict)
    assert output["tap_point"] == [x, y]
    assert output["safe_bounds"] == [25.0, 26.0, 95.0, 54.0]
    assert (x, y) != (60, 40)
    assert duration == 80
    assert first.traces[0].output_summary["tap_point"] == [x, y]
