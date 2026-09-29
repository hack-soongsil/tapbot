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
from tapbot.macro.nodes.function import FunctionReturnNode


class Ui:
    def find_element(self, selector, **options):
        return GraphElement("result", TapBounds(0, 0, 10, 10))


class FailingUi:
    def find_element(self, selector, **options):
        raise RuntimeError("device lookup failed")


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


def find_function(function_id="check", called_function_id=None, *, has_input=True):
    middle = MacroNode("exists", "element_exists", {"selector": {"text": "ok"}})
    result_handle = "result"
    if called_function_id is not None:
        middle = MacroNode("nested", "call_function", {
            "function_id": called_function_id,
            "inputs": [{"id": "index", "type": "int"}] if has_input else [],
            "outputs": [{"id": "success", "type": "bool"}],
        })
        result_handle = "success"
    return MacroFunctionDefinition(
        function_id,
        function_id.title(),
        (FunctionPortDefinition("index", "int"),) if has_input else (),
        (FunctionPortDefinition("success", "bool"),),
        (
            MacroNode("fn-entry", "function_entry"),
            middle,
            MacroNode("fn-return", "function_return"),
        ),
        (
            exec_edge("entry-next", "fn-entry", middle.id),
            exec_edge("to-return", middle.id, "fn-return"),
            data_edge("result", middle.id, result_handle, "fn-return", "success"),
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


def test_function_output_policy_round_trips_required_and_default() -> None:
    function = MacroFunctionDefinition(
        "choice", "Choice", (),
        (
            FunctionPortDefinition("label", "string", default="fallback"),
            FunctionPortDefinition("success", "bool", required=True),
        ),
        (
            MacroNode("fn-entry", "function_entry"),
            MacroNode("fn-return", "function_return"),
        ),
        (exec_edge("return", "fn-entry", "fn-return"),),
        "fn-entry", "fn-return",
    )

    restored = MacroFunctionDefinition.from_dict(function.to_dict())

    assert restored.outputs[0].default == "fallback"
    assert restored.outputs[0].required is False
    assert restored.outputs[1].required is True
    assert restored.nodes[1].config["outputs"] == [
        {"id": "label", "type": "string", "default": "fallback"},
        {"id": "success", "type": "bool", "required": True},
    ]
    assert FunctionPortDefinition.from_dict({
        "id": "optional", "type": "string", "optional": True,
    }).required is False
    assert FunctionPortDefinition.from_dict({
        "id": "required", "type": "string", "optional": False,
    }).required is True
    nullable = FunctionPortDefinition.from_dict({
        "id": "position", "type": "position", "default": None,
    })
    assert nullable.has_default is True
    assert nullable.to_dict()["default"] is None


@pytest.mark.parametrize(("port_type", "expected"), (
    ("bool", False),
    ("int", 0),
    ("float", 0.0),
    ("string", ""),
    ("position", None),
    ("rect", None),
    ("element", None),
))
def test_unconnected_optional_function_outputs_use_type_defaults(
    port_type: str,
    expected: object,
) -> None:
    result = FunctionReturnNode().execute(
        GraphExecutionContext(),
        {"outputs": [{"id": "value", "type": port_type}]},
    )

    assert result.data_outputs == {"value": expected}


def test_optional_function_output_uses_explicit_default() -> None:
    result = FunctionReturnNode().execute(
        GraphExecutionContext(),
        {"outputs": [{
            "id": "retries", "type": "int", "default": 3,
        }]},
    )

    assert result.data_outputs == {"retries": 3}


def test_required_function_output_is_rejected_by_validation_and_runtime() -> None:
    function = MacroFunctionDefinition(
        "required", "Required", (),
        (FunctionPortDefinition("success", "bool", required=True),),
        (
            MacroNode("fn-entry", "function_entry"),
            MacroNode("fn-return", "function_return"),
        ),
        (exec_edge("return", "fn-entry", "fn-return"),),
        "fn-entry", "fn-return",
    )
    graph = MacroDefinition(
        "macro", "Macro", 1,
        (MacroNode("call", "call_function", {"function_id": "required"}),),
        (), "call", functions=(function,),
    )

    with pytest.raises(GraphValidationError, match="required function output 'success'"):
        GraphEngine(create_default_node_registry()).run(graph)
    with pytest.raises(RuntimeError, match="function output 'success' was not provided"):
        FunctionReturnNode().execute(
            GraphExecutionContext(),
            {"outputs": [{"id": "success", "type": "bool", "required": True}]},
        )


def test_function_output_default_must_match_declared_type() -> None:
    function = MacroFunctionDefinition(
        "invalid", "Invalid", (),
        (FunctionPortDefinition("success", "bool", default="yes"),),
        (
            MacroNode("fn-entry", "function_entry"),
            MacroNode("fn-return", "function_return"),
        ),
        (exec_edge("return", "fn-entry", "fn-return"),),
        "fn-entry", "fn-return",
    )
    graph = MacroDefinition(
        "macro", "Macro", 1,
        (MacroNode("call", "call_function", {"function_id": "invalid"}),),
        (), "call", functions=(function,),
    )

    with pytest.raises(GraphValidationError, match="default must match type bool"):
        GraphEngine(create_default_node_registry()).run(graph)


def test_call_function_does_not_require_callers_to_use_return_data() -> None:
    function = MacroFunctionDefinition(
        "optional", "Optional", (),
        (FunctionPortDefinition("success", "bool"),),
        (
            MacroNode("fn-entry", "function_entry"),
            MacroNode("fn-return", "function_return"),
        ),
        (exec_edge("return", "fn-entry", "fn-return"),),
        "fn-entry", "fn-return",
    )
    graph = MacroDefinition(
        "macro", "Macro", 1,
        (
            MacroNode("call", "call_function", {"function_id": "optional"}),
            MacroNode("done", "stop"),
        ),
        (exec_edge("done", "call", "done"),),
        "call", functions=(function,),
    )
    context = GraphExecutionContext()

    result = GraphEngine(create_default_node_registry()).run(graph, context=context)

    assert result.runtime.state is GraphRuntimeStatus.STOPPED
    assert context.node_outputs["call"] == {"success": False}


def test_function_return_rejects_connected_value_with_wrong_type() -> None:
    with pytest.raises(RuntimeError, match="expected bool, got str"):
        FunctionReturnNode().execute(
            GraphExecutionContext(input_values={"success": "yes"}),
            {"outputs": [{"id": "success", "type": "bool"}]},
        )


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
    assert [trace.node_id for trace in result.traces] == [
        "loop", "fn-entry", "exists", "fn-return", "call", "branch", "yes",
    ]
    assert result.traces[2].graph_path == ("main", "check")
    assert [trace.step for trace in result.traces] == list(range(1, 8))
    assert context.node_outputs["call"]["success"] is True
    assert context.variables["global_like"] == "kept"
    assert context.variables["outer_index"] == 0
    assert "exists" not in context.variables
    assert "fn-entry" not in context.variables


def test_nested_function_forwards_node_trace_and_edge_callbacks_with_graph_context() -> None:
    inner = find_function("inner", has_input=False)
    outer = find_function("outer", "inner", has_input=False)
    graph = MacroDefinition(
        "macro", "Macro", 1,
        (MacroNode("call", "call_function", {"function_id": "outer"}),),
        (), "call", functions=(outer, inner),
    )
    starts: list[tuple[str, str, tuple[str, ...], int]] = []
    traces: list[tuple[str, str, tuple[str, ...], int]] = []
    edges: list[tuple[str, str, tuple[str, ...], int]] = []

    result = GraphEngine(create_default_node_registry()).run(
        graph,
        context=GraphExecutionContext(ui=Ui()),
        on_node_start=lambda node, runtime: starts.append((
            node.id, runtime.graph_id, runtime.graph_path, runtime.call_depth,
        )),
        on_trace=lambda trace, _runtime: traces.append((
            trace.node_id, trace.graph_id, trace.graph_path, trace.call_depth,
        )),
        on_edge=lambda edge, runtime: edges.append((
            edge.id, runtime.graph_id, runtime.graph_path, runtime.call_depth,
        )),
    )

    assert result.runtime.state is GraphRuntimeStatus.COMPLETED
    assert starts[0] == ("call", "main", ("main",), 0)
    assert ("nested", "function:outer", ("main", "outer"), 1) in starts
    assert ("exists", "function:inner", ("main", "outer", "inner"), 2) in starts
    assert ("exists", "function:inner", ("main", "outer", "inner"), 2) in traces
    assert ("entry-next", "function:inner", ("main", "outer", "inner"), 2) in edges
    assert [trace.step for trace in result.traces] == list(range(1, len(result.traces) + 1))
    assert any(trace.graph_id == "function:outer" for trace in result.traces)
    assert any(trace.graph_id == "function:inner" for trace in result.traces)
    assert result.traces[-1].node_id == "call"


def test_nested_function_failure_marks_child_and_parent_call_nodes() -> None:
    inner = find_function("inner", has_input=False)
    outer = find_function("outer", "inner", has_input=False)
    graph = MacroDefinition(
        "macro", "Macro", 1,
        (MacroNode("call", "call_function", {"function_id": "outer"}),),
        (), "call", functions=(outer, inner),
    )
    published = []

    result = GraphEngine(create_default_node_registry()).run(
        graph,
        context=GraphExecutionContext(ui=FailingUi()),
        on_trace=lambda trace, _runtime: published.append(trace),
    )

    assert result.runtime.state is GraphRuntimeStatus.ERROR
    failures = [trace for trace in published if trace.status.value == "failure"]
    assert [(trace.graph_id, trace.node_id) for trace in failures] == [
        ("function:inner", "exists"),
        ("function:outer", "nested"),
        ("main", "call"),
    ]
    origin = failures[0].to_dict()
    assert origin["graph_path"] == ["main", "outer", "inner"]
    assert origin["call_depth"] == 2
    assert failures[-1].error_payload["cause"]["graph_id"] == "function:inner"


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
