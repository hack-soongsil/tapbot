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
    MacroVariableDefinition,
    TapBounds,
    create_default_node_registry,
)


class Ui:
    def find_element(self, selector, **options):
        return GraphElement("found", TapBounds(0, 0, 10, 10))


def exec_edge(edge_id, source, target, handle="exec_out"):
    return MacroEdge(
        edge_id, source, target,
        source_handle=handle, target_handle="exec_in", kind="exec",
    )


def data_edge(edge_id, source, source_handle, target, target_handle):
    return MacroEdge(
        edge_id, source, target,
        source_handle=source_handle, target_handle=target_handle, kind="data",
    )


def test_for_index_can_be_stored_in_int_variable() -> None:
    graph = MacroDefinition(
        "variables", "Variables", 1,
        (
            MacroNode("loop", "for_loop", {
                "start": 0, "end": 3, "step": 1,
                "inclusive_end": False, "index_variable": "i",
            }),
            MacroNode("set", "set_variable", {"name": "count", "type": "bool"}),
            MacroNode("done", "stop"),
        ),
        (
            exec_edge("loop-set", "loop", "set", "loop"),
            data_edge("index-value", "loop", "index", "set", "value"),
            exec_edge("done", "loop", "done", "completed"),
        ),
        "loop",
        variables=(MacroVariableDefinition("count", "int", 0),),
    )
    context = GraphExecutionContext()

    result = GraphEngine(create_default_node_registry()).run(graph, context=context)

    assert result.runtime.state is GraphRuntimeStatus.STOPPED
    assert context.variables["count"] == 2
    assert context.node_outputs["set"]["value"] == 2


def test_get_variable_is_read_lazily_after_set_and_drives_branch() -> None:
    graph = MacroDefinition(
        "bool-variable", "Bool Variable", 1,
        (
            MacroNode("exists", "element_exists", {"selector": {"text": "Reserve"}}),
            MacroNode("set", "set_variable", {"name": "ready"}),
            MacroNode("get", "get_variable", {"name": "ready"}),
            MacroNode("branch", "branch", {}),
            MacroNode("yes", "stop"),
            MacroNode("no", "stop"),
        ),
        (
            exec_edge("exists-set", "exists", "set"),
            data_edge("exists-value", "exists", "result", "set", "value"),
            exec_edge("set-branch", "set", "branch"),
            data_edge("get-value", "get", "value", "branch", "condition"),
            exec_edge("yes", "branch", "yes", "true"),
            exec_edge("no", "branch", "no", "false"),
        ),
        "exists",
        variables=(MacroVariableDefinition("ready", "bool", False),),
    )
    context = GraphExecutionContext(ui=Ui())

    result = GraphEngine(create_default_node_registry()).run(graph, context=context)

    assert [trace.node_id for trace in result.traces] == ["exists", "set", "branch", "yes"]
    assert context.variables["ready"] is True
    assert context.node_outputs["get"]["value"] is True


def test_variable_definition_round_trip_and_type_mismatch_validation() -> None:
    graph = MacroDefinition(
        "invalid", "Invalid", 1,
        (
            MacroNode("loop", "for_loop", {
                "start": 0, "end": 1, "step": 1,
                "inclusive_end": False, "index_variable": "i",
            }),
            MacroNode("set", "set_variable", {"name": "flag"}),
        ),
        (
            exec_edge("next", "loop", "set", "loop"),
            data_edge("bad", "loop", "index", "set", "value"),
        ),
        "loop",
        variables=(MacroVariableDefinition("flag", "bool", False),),
    )

    restored = MacroDefinition.from_json(graph.to_json())
    assert restored.variables == (MacroVariableDefinition("flag", "bool", False),)
    with pytest.raises(GraphValidationError, match="type mismatch: int -> bool"):
        GraphEngine(create_default_node_registry()).run(restored)


def test_undefined_variable_reference_is_rejected() -> None:
    graph = MacroDefinition(
        "undefined", "Undefined", 1,
        (MacroNode("get", "get_variable", {"name": "missing", "type": "int"}),),
        (),
        "get",
    )

    with pytest.raises(GraphValidationError, match="referenced variable 'missing' does not exist"):
        GraphEngine(create_default_node_registry()).run(graph)
