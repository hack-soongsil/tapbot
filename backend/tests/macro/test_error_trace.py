import time
import json

from tapbot.macro import (
    EventEntryNodeIds, FunctionPortDefinition, GraphEngine, GraphExecutionContext, GraphRuntimeStatus, MacroDefinition,
    MacroEdge, MacroFunctionDefinition, MacroNode, MacroVariableDefinition, create_default_node_registry,
)
from tapbot.macro.binding import DeviceMacroBinding, DeviceMacroBindingRepository
from tapbot.macro.graph_store import FileMacroDefinitionStore
from tapbot.macro.graph_validator import GraphValidator
from tapbot.macro.repository import MacroRepository
from tapbot.macro.runtime_manager import DeviceRuntimeStatus, RuntimeManager


def edge(id, source, target):
    return MacroEdge(id, source, target, source_handle="exec_out", target_handle="exec_in", kind="exec")


def data_edge(id, source, source_port, target, target_port):
    return MacroEdge(id, source, target, source_handle=source_port, target_handle=target_port, kind="data")


def nested_definition():
    functions = []
    for id, middle in (
        ("reserve", MacroNode("call-slot", "call_function", {"function_id": "slot"})),
        ("slot", MacroNode("failed-delay", "wait", {"duration_ms": 1}, label="Wait for Slot")),
    ):
        functions.append(MacroFunctionDefinition(
            id, id.title(), (), (),
            (MacroNode("entry", "function_entry"), middle, MacroNode("return", "function_return")),
            (edge("next", "entry", middle.id), edge("return", middle.id, "return")),
            "entry", "return",
        ))
    return MacroDefinition(
        "nested", "Nested", 1,
        (MacroNode("call", "call_function", {"function_id": "reserve"}),), (), "call",
        functions=tuple(functions),
    )


def fail_sleep(_seconds):
    raise RuntimeError("slot lookup failed")


def test_nested_failure_preserves_origin_and_publishes_internal_trace():
    published = []
    result = GraphEngine(create_default_node_registry()).run(
        nested_definition(), context=GraphExecutionContext(sleep=fail_sleep),
        on_trace=lambda trace, _runtime: published.append(trace),
    )
    assert result.runtime.state is GraphRuntimeStatus.ERROR
    assert published == list(result.traces)
    assert [trace.step for trace in published] == list(range(1, len(published) + 1))
    origin = next(trace for trace in published if trace.node_id == "failed-delay")
    payload = origin.to_dict()
    assert payload["graph_path"] == ["main", "reserve", "slot"]
    assert payload["graph_path_labels"] == ["Main", "Reserve", "Slot"]
    assert payload["macro_definition_id"] == "nested"
    assert payload["status"] == "failure"
    assert payload["timestamp"]
    assert payload["input_summary"] == {"duration_ms": 1}
    assert payload["output_summary"] == {}
    assert payload["error_payload"]["message"] == "노드 실행 중 내부 오류가 발생했습니다."
    assert payload["error_payload"]["details"] == {"exception_type": "RuntimeError"}
    assert "slot lookup failed" not in json.dumps(payload, ensure_ascii=False)
    assert payload["node_label"] == "Wait for Slot"
    assert payload["function_id"] == "slot"
    assert payload["function_name"] == "Slot"
    assert payload["caller_node_id"] == "call-slot"
    assert payload["active_screen"] is None
    assert payload["resolved_inputs"] == {}
    assert payload["function_inputs"] == {}
    assert payload["error_payload"]["current_step"] == payload["step"]
    assert published[-1].error_payload["cause"] == payload


def test_data_edge_failure_identifies_both_endpoints():
    graph = MacroDefinition(
        "edge-error", "Edge Error", 1,
        (MacroNode("source", "element_exists", {"selector": {"text": "OK"}}),
         MacroNode("consumer", "branch", {})),
        (MacroEdge("value", "source", "consumer", source_handle="result", target_handle="condition", kind="data"),),
        "consumer",
    )
    result = GraphEngine(create_default_node_registry()).run(graph)
    assert result.runtime.state is GraphRuntimeStatus.ERROR
    trace = result.traces[-1].to_dict()
    assert trace["graph_path"] == ["main"]
    assert trace["error_payload"]["edge_id"] == "value"
    assert trace["error_payload"]["source"] == "source"
    assert trace["error_payload"]["target"] == "consumer"


def test_variable_type_mismatch_keeps_the_data_edge_location():
    graph = MacroDefinition(
        "typed", "Typed", 1,
        (MacroNode("source", "get_variable", {"name": "flag", "type": "bool"}),
         MacroNode("consumer", "branch", {})),
        (MacroEdge("value", "source", "consumer", source_handle="value", target_handle="condition", kind="data"),),
        "consumer", variables=(MacroVariableDefinition("flag", "bool", False),),
    )
    result = GraphEngine(create_default_node_registry()).run(
        graph, context=GraphExecutionContext(variables={"flag": "not-a-bool"}),
    )
    trace = result.traces[-1]
    assert "expected bool" in trace.error
    assert trace.error_payload["edge_id"] == "value"
    assert trace.error_payload["source"] == "source"
    assert trace.error_payload["target"] == "consumer"
    assert trace.error_payload["code"] == "INPUT_TYPE_MISMATCH"
    assert trace.error_payload["expected"] == "bool"
    assert trace.error_payload["actual"] == "string"
    assert trace.error_payload["actual_value"] == "not-a-bool"
    assert trace.error_payload["inputs"] == {"value": "not-a-bool"}
    assert trace.error_payload["hint"]


def test_runtime_type_error_captures_resolved_input_and_source_port():
    graph = MacroDefinition(
        "typed-wire", "Typed Wire", 1,
        (
            MacroNode("for_loop-1", "for_loop", {
                "start": 3, "end": 4, "step": 1,
                "inclusive_end": False, "index_variable": "index",
            }, label="Loop Index"),
            MacroNode("branch-1", "branch", {}, label="Check Availability"),
        ),
        (
            MacroEdge("next", "for_loop-1", "branch-1", source_handle="loop", target_handle="exec_in", kind="exec"),
            data_edge("condition", "for_loop-1", "index", "branch-1", "condition"),
        ),
        "for_loop-1",
    )
    engine = GraphEngine(create_default_node_registry())
    # This deliberately malformed persisted graph exercises runtime diagnostics;
    # normal editor validation rejects the incompatible wire before execution.
    engine.validator.validate_or_raise = lambda _definition: None

    result = engine.run(graph)

    trace = result.traces[-1]
    assert trace.node_id == "branch-1"
    assert trace.node_label == "Check Availability"
    assert trace.resolved_inputs == {"condition": 3}
    assert trace.input_sources["condition"] == {
        "edge_id": "condition",
        "source_node_id": "for_loop-1",
        "source_port_id": "index",
        "target_port_id": "condition",
    }
    assert trace.error_payload["port"] == "condition"
    assert trace.error_payload["expected_type"] == "bool"
    assert trace.error_payload["actual_type"] == "int"
    assert trace.error_payload["actual_value"] == 3
    assert trace.error_payload["source_node_id"] == "for_loop-1"
    assert trace.error_payload["source_port_id"] == "index"

    payload = trace.error_payload
    assert payload is not None
    assert payload["code"] == "INPUT_TYPE_MISMATCH"
    assert payload["graph_path"] == ["Main"]
    assert payload["screen_id"] is None
    assert payload["node_id"] == "branch-1"
    assert payload["node_type"] == "branch"
    assert payload["node_label"] == "Check Availability"
    assert payload["port_id"] == "condition"
    assert payload["input_values"] == {"condition": 3}
    assert payload["config"] == {}
    assert isinstance(payload["details"], dict)
    assert payload["hint"]


def test_nested_function_error_keeps_names_caller_and_function_inputs():
    slot = MacroFunctionDefinition(
        "slot", "SelectTimeSlot", (FunctionPortDefinition("index", "int"),), (),
        (
            MacroNode("slot-entry", "function_entry"),
            MacroNode("failed-delay", "wait", {"duration_ms": 1}, label="Wait for Slot"),
            MacroNode("slot-return", "function_return"),
        ),
        (edge("slot-next", "slot-entry", "failed-delay"), edge("slot-return", "failed-delay", "slot-return")),
        "slot-entry", "slot-return",
    )
    reserve = MacroFunctionDefinition(
        "reserve", "ReserveRoom", (FunctionPortDefinition("index", "int"),), (),
        (
            MacroNode("reserve-entry", "function_entry"),
            MacroNode("call-slot", "call_function", {"function_id": "slot"}, label="Call SelectTimeSlot"),
            MacroNode("reserve-return", "function_return"),
        ),
        (
            edge("reserve-next", "reserve-entry", "call-slot"),
            data_edge("reserve-index", "reserve-entry", "index", "call-slot", "index"),
            edge("reserve-return", "call-slot", "reserve-return"),
        ),
        "reserve-entry", "reserve-return",
    )
    graph = MacroDefinition(
        "nested-input", "Nested Input", 1,
        (
            MacroNode("loop", "for_loop", {
                "start": 4, "end": 5, "step": 1,
                "inclusive_end": False, "index_variable": "index",
            }),
            MacroNode("call-reserve", "call_function", {"function_id": "reserve"}),
        ),
        (
            MacroEdge("call", "loop", "call-reserve", source_handle="loop", target_handle="exec_in", kind="exec"),
            data_edge("index", "loop", "index", "call-reserve", "index"),
        ),
        "loop", functions=(reserve, slot),
    )

    result = GraphEngine(create_default_node_registry()).run(
        graph, context=GraphExecutionContext(sleep=fail_sleep),
    )

    origin = next(trace for trace in result.traces if trace.node_id == "failed-delay")
    assert origin.graph_path == ("main", "reserve", "slot")
    assert origin.graph_path_labels == ("Main", "ReserveRoom", "SelectTimeSlot")
    assert origin.function_id == "slot"
    assert origin.function_name == "SelectTimeSlot"
    assert origin.caller_node_id == "call-slot"
    assert origin.function_input_summary == {"index": 4}
    assert origin.error_payload["function_inputs"] == {"index": 4}


def test_error_context_bounds_large_objects_and_does_not_capture_ui_tree():
    large = {f"field-{index}": index for index in range(80)}
    graph = MacroDefinition(
        "bounded", "Bounded", 1,
        (MacroNode("wait", "wait", {
            "duration_ms": 1,
            "details": large,
            "message": "x" * 800,
        }),), (), "wait",
    )
    context = GraphExecutionContext(sleep=fail_sleep, last_observation={"ui-tree-secret": large})

    result = GraphEngine(create_default_node_registry()).run(graph, context=context)
    serialized = result.traces[-1].to_dict()

    assert serialized["input_summary"]["details"]["<truncated>"] == "30 more fields"
    assert len(serialized["input_summary"]["message"]) == 501
    assert "ui-tree-secret" not in json.dumps(serialized)


def test_screen_lifecycle_failure_inherits_screen_through_nested_calls():
    base = nested_definition()
    graph = MacroDefinition(
        base.id, base.name, base.version,
        tuple(MacroNode(kind, f"screen_{kind}", {"screen_id": "reservation_detail", "event": kind})
              for kind in ("enter", "update", "exit")) + base.nodes,
        (edge("start", "enter", "call"),), None,
        functions=base.functions,
        screen_event_entry_node_ids={"reservation_detail": EventEntryNodeIds("enter", "update", "exit")},
    )
    result = GraphEngine(create_default_node_registry()).run(
        graph, entry_node_id="enter", context=GraphExecutionContext(sleep=fail_sleep),
    )
    assert result.runtime.state is GraphRuntimeStatus.ERROR
    assert all(trace.screen_id == "reservation_detail" for trace in result.traces)


def test_runtime_failure_stream_and_snapshot_keep_nested_trace_until_reset(tmp_path):
    registry = create_default_node_registry()
    repository = MacroRepository(FileMacroDefinitionStore(tmp_path / "macros", validator=GraphValidator(registry)))
    repository.create(nested_definition())
    bindings = DeviceMacroBindingRepository(tmp_path / "bindings.json")
    bindings.set(DeviceMacroBinding("phone", "nested"))
    manager = RuntimeManager(
        repository, bindings,
        engine_factory=lambda _device: GraphEngine(registry),
        context_factory=lambda _device, _binding: GraphExecutionContext(sleep=fail_sleep),
    )
    try:
        manager.start("phone")
        deadline = time.monotonic() + 2
        while manager.current("phone").state is DeviceRuntimeStatus.RUNNING and time.monotonic() < deadline:
            time.sleep(0.005)
        snapshot = manager.current("phone")
        assert snapshot.state is DeviceRuntimeStatus.ERROR
        trace = next(item for item in snapshot.trace if item.node_id == "failed-delay")
        event = next(event for event in manager.events.history("phone") if event.type == "macro.node.failed" and event.node_id == "failed-delay")
        assert event.payload["graph_path"] == ["main", "reserve", "slot"]
        assert event.payload["node_label"] == "Wait for Slot"
        assert event.payload["function_id"] == "slot"
        assert event.payload["function_name"] == "Slot"
        assert event.payload["caller_node_id"] == "call-slot"
        assert event.payload["resolved_inputs"] == {}
        assert event.payload["error_payload"] == trace.error_payload
        assert snapshot.step_count == len(snapshot.trace)
        assert manager.current("phone").trace == snapshot.trace
        assert manager.reset("phone").trace == ()
    finally:
        manager.close()
