import pytest

from tapbot.macro import (
    FunctionPortDefinition,
    GraphElement,
    GraphEngine,
    GraphExecutionContext,
    GraphRuntimeStatus,
    GraphValidationError,
    MacroDefinition,
    MacroEdge,
    MacroFunctionDefinition,
    MacroNode,
    TapBounds,
    create_default_node_registry,
)


class Ui:
    def find_element(self, selector, **options):
        return GraphElement("result", TapBounds(0, 0, 10, 10))


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


def find_function(function_id="check", called_function_id=None):
    middle = MacroNode("exists", "element_exists", {"selector": {"text": "ok"}})
    if called_function_id is not None:
        middle = MacroNode("nested", "call_function", {"function_id": called_function_id})
    return MacroFunctionDefinition(
        function_id,
        function_id.title(),
        (FunctionPortDefinition("index", "int"),),
        (FunctionPortDefinition("success", "bool"),),
        (
            MacroNode("fn-entry", "function_entry"),
            middle,
            MacroNode("fn-return", "function_return"),
        ),
        (
            exec_edge("entry-next", "fn-entry", middle.id),
            exec_edge("to-return", middle.id, "fn-return"),
            data_edge("result", middle.id, "result", "fn-return", "success"),
        ),
        "fn-entry",
        "fn-return",
    )


def test_function_schema_round_trip_and_call_signature_sync() -> None:
    function = find_function()
    definition = MacroDefinition(
        "macro", "Macro", 1,
        (MacroNode("call", "call_function", {"function_id": "check"}),),
        (),
        "call",
        functions=(function,),
    )

    restored = MacroDefinition.from_json(definition.to_json())

    assert restored.functions[0].inputs[0].type == "int"
    assert restored.functions[0].outputs[0].type == "bool"
    assert restored.nodes[0].config["inputs"] == [{"id": "index", "type": "int"}]
    assert restored.nodes[0].config["outputs"] == [{"id": "success", "type": "bool"}]


def test_function_call_returns_data_and_keeps_local_scope_isolated() -> None:
    function = find_function()
    graph = MacroDefinition(
        "macro", "Macro", 1,
        (
            MacroNode("loop", "for_loop", {
                "start": 0, "end": 1, "step": 1,
                "inclusive_end": False, "index_variable": "outer_index",
            }),
            MacroNode("call", "call_function", {"function_id": "check"}),
            MacroNode("branch", "branch", {}),
            MacroNode("yes", "stop"),
            MacroNode("done", "stop"),
        ),
        (
            exec_edge("loop-call", "loop", "call", "loop"),
            data_edge("index", "loop", "index", "call", "index"),
            exec_edge("call-branch", "call", "branch"),
            data_edge("success", "call", "success", "branch", "condition"),
            exec_edge("yes", "branch", "yes", "true"),
            exec_edge("done", "loop", "done", "completed"),
        ),
        "loop",
        functions=(function,),
    )
    context = GraphExecutionContext(ui=Ui(), variables={"global_like": "kept"})

    result = GraphEngine(create_default_node_registry()).run(graph, context=context)

    assert result.runtime.state is GraphRuntimeStatus.STOPPED
    assert [trace.node_id for trace in result.traces] == ["loop", "call", "branch", "yes"]
    assert context.node_outputs["call"]["success"] is True
    assert context.variables["global_like"] == "kept"
    assert context.variables["outer_index"] == 0
    assert "exists" not in context.variables
    assert "fn-entry" not in context.variables


def test_recursive_function_call_is_rejected() -> None:
    first = find_function("first", "second")
    second = find_function("second", "first")
    graph = MacroDefinition(
        "macro", "Macro", 1,
        (MacroNode("call", "call_function", {"function_id": "first"}),),
        (),
        "call",
        functions=(first, second),
    )

    with pytest.raises(GraphValidationError, match="recursive function calls"):
        GraphEngine(create_default_node_registry()).run(graph)
