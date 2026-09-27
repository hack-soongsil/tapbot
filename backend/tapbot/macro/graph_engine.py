"""Deterministic graph interpreter used beneath the existing macro lifecycle."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
import time
from uuid import uuid4

from tapbot.macro.graph_models import (
    GraphExecutionContext,
    GraphElement,
    GraphNodeTrace,
    GraphRunResult,
    GraphRuntime,
    GraphRuntimeStatus,
    JsonObject,
    JsonValue,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    NodeResult,
    NodeStatus,
    assert_json_value,
    utc_now,
)
from tapbot.macro.graph_validator import GraphValidator
from tapbot.macro.node_registry import NodeRegistry


@dataclass(frozen=True, slots=True)
class GraphRunLimits:
    max_steps: int = 1_000
    execution_timeout_sec: float = 300.0
    retry_limit: int = 3
    repeat_limit: int = 100
    max_call_depth: int = 16

    def __post_init__(self) -> None:
        if self.max_steps < 1:
            raise ValueError("max_steps must be positive")
        if self.execution_timeout_sec <= 0:
            raise ValueError("execution_timeout_sec must be positive")
        if self.retry_limit < 0:
            raise ValueError("retry_limit must not be negative")
        if self.repeat_limit < 0:
            raise ValueError("repeat_limit must not be negative")
        if self.max_call_depth < 1:
            raise ValueError("max_call_depth must be positive")


class GraphEngine:
    """Interpret a validated definition; lifecycle remains owned by MacroEngine."""

    def __init__(
        self,
        registry: NodeRegistry,
        *,
        limits: GraphRunLimits | None = None,
        monotonic: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = utc_now,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.registry = registry
        self.validator = GraphValidator(registry)
        self.limits = limits or GraphRunLimits()
        self.monotonic = monotonic
        self.now = now
        self.sleep = sleep

    def run(
        self,
        definition: MacroDefinition,
        *,
        entry_node_id: str | None = None,
        context: GraphExecutionContext | None = None,
        cancelled: Callable[[], bool] | None = None,
        on_node_start: Callable[[MacroNode, GraphRuntime], None] | None = None,
        on_trace: Callable[[GraphNodeTrace, GraphRuntime], None] | None = None,
        on_edge: Callable[[MacroEdge, GraphRuntime], None] | None = None,
        _call_stack: tuple[str, ...] = (),
    ) -> GraphRunResult:
        self.validator.validate_or_raise(definition)
        snapshot = definition.snapshot()
        selected_entry = entry_node_id or snapshot.entry_for("enter")
        if selected_entry is None or selected_entry not in {
            node.id for node in snapshot.nodes
        }:
            raise ValueError("selected graph entry node does not exist")
        node_by_id = {node.id: node for node in snapshot.nodes}
        outgoing = _outgoing(snapshot.edges)
        data_incoming = _data_incoming(snapshot.edges)
        started_monotonic = self.monotonic()
        execution_context = context or GraphExecutionContext()
        _assert_runtime_variables(execution_context.variables)
        execution_context.variables = dict(execution_context.variables)
        for variable in snapshot.variables:
            if variable.name not in execution_context.variables and variable.default is not None:
                default = deepcopy(variable.default)
                execution_context.variables[variable.name] = (
                    float(default)
                    if variable.type == "float" and isinstance(default, int)
                    else default
                )
        execution_context.control_state = {}
        execution_context.input_values = {}
        execution_context.node_outputs = {}
        execution_context.started_at = self.now()
        execution_context.trace_id = (
            execution_context.trace_id or f"graph-{uuid4().hex[:12]}"
        )
        execution_context.monotonic = self.monotonic
        execution_context.started_monotonic = started_monotonic
        execution_context.sleep = execution_context.sleep or self.sleep
        execution_context.call_stack = _call_stack
        execution_context.function_invoker = lambda function_id, arguments: self._invoke_function(
            snapshot,
            function_id,
            arguments,
            parent=execution_context,
            cancelled=cancelled,
            call_stack=_call_stack,
        )

        runtime = GraphRuntime(
            definition_id=snapshot.id,
            definition_version=snapshot.version,
            current_node_id=selected_entry,
            state=GraphRuntimeStatus.RUNNING,
            variables=execution_context.variables,
            started_at=execution_context.started_at,
        )
        traces: list[GraphNodeTrace] = []
        retry_counts: dict[str, int] = defaultdict(int)
        repeat_counts: dict[str, int] = defaultdict(int)
        continuations: list[tuple[str, str | None]] = []

        def ensure_active() -> None:
            if cancelled is not None and cancelled():
                raise _GraphCancelled("graph execution was cancelled")
            if self.monotonic() - started_monotonic >= self.limits.execution_timeout_sec:
                raise _GraphTimedOut("graph execution timeout exceeded")

        execution_context.ensure_active = ensure_active

        while runtime.state is GraphRuntimeStatus.RUNNING:
            try:
                ensure_active()
            except _GraphCancelled as error:
                _finish(runtime, GraphRuntimeStatus.CANCELLED, self.now(), str(error))
                break
            except _GraphTimedOut as error:
                _finish(runtime, GraphRuntimeStatus.ERROR, self.now(), str(error))
                break
            if runtime.step_count >= self.limits.max_steps:
                _finish(
                    runtime,
                    GraphRuntimeStatus.ERROR,
                    self.now(),
                    f"maximum graph step count {self.limits.max_steps} exceeded",
                )
                break

            node_id = runtime.current_node_id
            assert node_id is not None
            node = node_by_id[node_id]
            execution_context.current_node_id = node.id
            started_at = self.now()
            if on_node_start is not None:
                on_node_start(node, runtime)
            try:
                _refresh_variable_sources(
                    node.id,
                    data_incoming,
                    node_by_id,
                    execution_context,
                    self.registry,
                )
                execution_context.input_values = _resolve_data_inputs(
                    node.id,
                    data_incoming,
                    execution_context.node_outputs,
                )
                result = self.registry.get(node.type).execute(
                    execution_context,
                    node.config,
                )
                if not isinstance(result, NodeResult):
                    raise TypeError("node handler must return NodeResult")
                if not isinstance(result.status, NodeStatus):
                    raise TypeError("node result status must be NodeStatus")
                if not isinstance(result.output, dict):
                    raise TypeError("node result output must be an object")
                if not isinstance(result.data_outputs, dict):
                    raise TypeError("node data outputs must be an object")
                assert_json_value(result.output, name=f"node {node.id!r} output")
                ensure_active()
            except _GraphCancelled as error:
                result = NodeResult(NodeStatus.STOPPED, error=str(error))
                traces.append(_trace(node, started_at, self.now(), result))
                runtime.step_count += 1
                runtime.last_result = result
                _finish(runtime, GraphRuntimeStatus.CANCELLED, self.now(), str(error))
                _notify(on_trace, traces[-1], runtime)
                break
            except _GraphTimedOut as error:
                result = NodeResult(NodeStatus.FAILURE, error=str(error))
                traces.append(_trace(node, started_at, self.now(), result))
                runtime.step_count += 1
                runtime.last_result = result
                _finish(runtime, GraphRuntimeStatus.ERROR, self.now(), str(error))
                _notify(on_trace, traces[-1], runtime)
                break
            except Exception as error:
                result = NodeResult(NodeStatus.FAILURE, error=str(error))
                traces.append(_trace(node, started_at, self.now(), result))
                runtime.step_count += 1
                runtime.last_result = result
                _finish(runtime, GraphRuntimeStatus.ERROR, self.now(), str(error))
                _notify(on_trace, traces[-1], runtime)
                break

            runtime.step_count += 1
            runtime.last_result = result
            traces.append(_trace(node, started_at, self.now(), result))
            execution_context.node_outputs[node.id] = dict(result.data_outputs)
            self._store_output(execution_context, runtime, node, result)

            if result.status is NodeStatus.STOPPED:
                _finish(runtime, GraphRuntimeStatus.STOPPED, self.now())
                _notify(on_trace, traces[-1], runtime)
                break
            if (
                result.status is NodeStatus.RETRY
                or result.next_handle == "retry"
            ):
                retry_counts[node.id] += 1
                if retry_counts[node.id] > self.limits.retry_limit:
                    _finish(
                        runtime,
                        GraphRuntimeStatus.ERROR,
                        self.now(),
                        f"retry limit exceeded at node {node.id!r}",
                    )
                    _notify(on_trace, traces[-1], runtime)
                    break
                if result.status is NodeStatus.RETRY:
                    _notify(on_trace, traces[-1], runtime)
                    continue
            else:
                retry_counts[node.id] = 0

            if result.next_handle == "repeat":
                repeat_counts[node.id] += 1
                if repeat_counts[node.id] > self.limits.repeat_limit:
                    _finish(
                        runtime,
                        GraphRuntimeStatus.ERROR,
                        self.now(),
                        f"repeat limit exceeded at node {node.id!r}",
                    )
                    _notify(on_trace, traces[-1], runtime)
                    break

            if node.type == "sequence" and result.next_handle == "then_0":
                outputs = node.config.get("outputs", 2)
                assert isinstance(outputs, int) and not isinstance(outputs, bool)
                continuations.extend(
                    (node.id, f"then_{index}")
                    for index in range(outputs - 1, 0, -1)
                )
            if node.type == "for_loop" and result.next_handle == "loop":
                continuations.append((node.id, None))

            try:
                edge = _select_edge(outgoing.get(node.id, ()), result)
            except RuntimeError as error:
                _finish(runtime, GraphRuntimeStatus.ERROR, self.now(), str(error))
                _notify(on_trace, traces[-1], runtime)
                break
            if edge is None:
                if result.status is NodeStatus.FAILURE:
                    _finish(
                        runtime,
                        GraphRuntimeStatus.ERROR,
                        self.now(),
                        result.error or f"node {node.id!r} failed",
                    )
                elif continuations:
                    source_node_id, next_handle = continuations.pop()
                    if next_handle is None:
                        runtime.current_node_id = source_node_id
                        _notify(on_trace, traces[-1], runtime)
                        continue
                    try:
                        continuation_edge = _select_edge(
                            outgoing.get(source_node_id, ()),
                            NodeResult.success(next_handle=next_handle),
                        )
                    except RuntimeError as error:
                        _finish(runtime, GraphRuntimeStatus.ERROR, self.now(), str(error))
                        _notify(on_trace, traces[-1], runtime)
                        break
                    if continuation_edge is None:
                        _finish(
                            runtime,
                            GraphRuntimeStatus.ERROR,
                            self.now(),
                            f"continuation handle {next_handle!r} is not connected",
                        )
                        _notify(on_trace, traces[-1], runtime)
                        break
                    runtime.current_node_id = continuation_edge.target
                    _notify(on_trace, traces[-1], runtime)
                    if on_edge is not None:
                        on_edge(continuation_edge, runtime)
                    continue
                else:
                    _finish(runtime, GraphRuntimeStatus.COMPLETED, self.now())
                _notify(on_trace, traces[-1], runtime)
                break
            runtime.current_node_id = edge.target
            _notify(on_trace, traces[-1], runtime)
            if on_edge is not None:
                on_edge(edge, runtime)

        return GraphRunResult(snapshot, runtime, tuple(traces))

    execute = run

    def _invoke_function(
        self,
        definition: MacroDefinition,
        function_id: str,
        arguments: dict[str, object],
        *,
        parent: GraphExecutionContext,
        cancelled: Callable[[], bool] | None,
        call_stack: tuple[str, ...],
    ) -> dict[str, object]:
        function = next(
            (candidate for candidate in definition.functions if candidate.id == function_id),
            None,
        )
        if function is None:
            raise RuntimeError(f"function {function_id!r} does not exist")
        if function_id in call_stack:
            chain = " -> ".join((*call_stack, function_id))
            raise RuntimeError(f"recursive function call is not allowed: {chain}")
        if len(call_stack) >= self.limits.max_call_depth:
            raise RuntimeError(
                f"maximum function call depth {self.limits.max_call_depth} exceeded"
            )
        child_definition = MacroDefinition(
            id=f"{definition.id}::function::{function.id}",
            name=function.name,
            version=definition.version,
            nodes=function.nodes,
            edges=function.edges,
            entry_node_id=function.entry_node_id,
            functions=definition.functions,
            variables=definition.variables,
        )
        child = GraphExecutionContext(
            device_id=parent.device_id,
            variables={},
            last_observation=parent.last_observation,
            last_resolved_element=parent.last_resolved_element,
            last_action_result=parent.last_action_result,
            trace_id=parent.trace_id,
            actions=parent.actions,
            ui=parent.ui,
            function_inputs=dict(arguments),
            sleep=parent.sleep,
        )
        result = self.run(
            child_definition,
            entry_node_id=function.entry_node_id,
            context=child,
            cancelled=cancelled,
            _call_stack=(*call_stack, function_id),
        )
        if result.runtime.state is not GraphRuntimeStatus.COMPLETED:
            raise RuntimeError(
                result.runtime.error
                or f"function {function_id!r} did not complete successfully"
            )
        returned = child.node_outputs.get(function.return_node_id)
        if returned is None:
            raise RuntimeError(f"function {function_id!r} did not reach its return node")
        return {
            port.id: returned[port.id]
            for port in function.outputs
            if port.id in returned
        }

    @staticmethod
    def _store_output(
        context: GraphExecutionContext,
        runtime: GraphRuntime,
        node: MacroNode,
        result: NodeResult,
    ) -> None:
        if not result.output or node.type in {"debug_print", "set_variable", "get_variable"}:
            return
        destination = node.config.get("save_as", node.id)
        if not isinstance(destination, str) or not destination:
            destination = node.id
        context.variables[destination] = dict(result.output)
        runtime.variables = context.variables


class _GraphCancelled(RuntimeError):
    pass


class _GraphTimedOut(RuntimeError):
    pass


def _outgoing(edges: tuple[MacroEdge, ...]) -> dict[str, tuple[MacroEdge, ...]]:
    grouped: dict[str, list[MacroEdge]] = defaultdict(list)
    for edge in edges:
        if edge.effective_kind == "exec":
            grouped[edge.source].append(edge)
    return {
        source: tuple(sorted(items, key=lambda edge: edge.id))
        for source, items in grouped.items()
    }


def _select_edge(
    edges: tuple[MacroEdge, ...],
    result: NodeResult,
) -> MacroEdge | None:
    candidates = [
        edge
        for edge in edges
        if edge.source_handle == result.next_handle
    ]
    # Older definitions encoded a normal execution output as a missing handle.
    # Continue to run those graphs while all newly saved graphs use exec_out.
    if not candidates and result.next_handle == "exec_out":
        candidates = [edge for edge in edges if edge.source_handle is None]
    if not candidates:
        for handle in result.fallback_handles:
            candidates = [edge for edge in edges if edge.source_handle == handle]
            if candidates:
                break
    exact = [edge for edge in candidates if edge.condition == result.status.value]
    eligible = exact or [edge for edge in candidates if edge.condition is None]
    if len(eligible) > 1:
        raise RuntimeError("graph produced an ambiguous next edge")
    return eligible[0] if eligible else None


def _data_incoming(edges: tuple[MacroEdge, ...]) -> dict[str, tuple[MacroEdge, ...]]:
    grouped: dict[str, list[MacroEdge]] = defaultdict(list)
    for edge in edges:
        if edge.effective_kind == "data":
            grouped[edge.target].append(edge)
    return {target: tuple(items) for target, items in grouped.items()}


def _resolve_data_inputs(
    node_id: str,
    incoming: dict[str, tuple[MacroEdge, ...]],
    outputs: dict[str, dict[str, object]],
) -> dict[str, object]:
    resolved: dict[str, object] = {}
    for edge in incoming.get(node_id, ()):
        assert edge.source_handle is not None
        assert edge.target_handle is not None
        source_values = outputs.get(edge.source)
        if source_values is None:
            raise RuntimeError(
                f"data source node {edge.source!r} has not executed before {node_id!r}"
            )
        if edge.source_handle not in source_values:
            raise RuntimeError(
                f"data output {edge.source}.{edge.source_handle} is unavailable"
            )
        resolved[edge.target_handle] = source_values[edge.source_handle]
    return resolved


def _refresh_variable_sources(
    node_id: str,
    incoming: dict[str, tuple[MacroEdge, ...]],
    nodes: dict[str, MacroNode],
    context: GraphExecutionContext,
    registry: NodeRegistry,
) -> None:
    """Evaluate pure Get Variable nodes at the moment their value is consumed."""

    for edge in incoming.get(node_id, ()):
        source = nodes.get(edge.source)
        if source is None or source.type != "get_variable":
            continue
        previous_inputs = context.input_values
        try:
            context.input_values = {}
            result = registry.get(source.type).execute(context, source.config)
        finally:
            context.input_values = previous_inputs
        if result.status is not NodeStatus.SUCCESS:
            raise RuntimeError(result.error or f"variable source {source.id!r} failed")
        context.node_outputs[source.id] = dict(result.data_outputs)


def _trace(
    node: MacroNode,
    started_at: datetime,
    completed_at: datetime,
    result: NodeResult,
) -> GraphNodeTrace:
    return GraphNodeTrace(
        node_id=node.id,
        node_type=node.type,
        started_at=started_at,
        completed_at=completed_at,
        status=result.status,
        input_summary=_summarize(node.config),
        output_summary=_summarize(result.output),
        error=result.error,
    )


def _finish(
    runtime: GraphRuntime,
    state: GraphRuntimeStatus,
    completed_at: datetime,
    error: str | None = None,
) -> None:
    runtime.state = state
    runtime.completed_at = completed_at
    runtime.error = error


def _notify(
    callback: Callable[[GraphNodeTrace, GraphRuntime], None] | None,
    trace: GraphNodeTrace,
    runtime: GraphRuntime,
) -> None:
    if callback is not None:
        callback(trace, runtime)


def _summarize(value: object, *, depth: int = 0) -> JsonObject:
    summarized = _summarize_value(value, depth=depth)
    return summarized if isinstance(summarized, dict) else {"value": summarized}


def _summarize_value(value: object, *, depth: int) -> JsonValue:
    if depth >= 5:
        return "<max-depth>"
    if isinstance(value, dict):
        result: JsonObject = {}
        for key, item in value.items():
            name = str(key)
            if any(
                secret in name.lower()
                for secret in ("token", "secret", "password", "authorization")
            ):
                result[name] = "<redacted>"
            else:
                result[name] = _summarize_value(item, depth=depth + 1)
        return result
    if isinstance(value, list | tuple):
        return [
            _summarize_value(item, depth=depth + 1)
            for item in value[:50]
        ]
    if isinstance(value, bytes | bytearray | memoryview):
        return f"<binary:{len(value)} bytes>"
    if isinstance(value, str):
        return value if len(value) <= 500 else value[:500] + "…"
    if value is None or isinstance(value, bool | int | float):
        return value
    return f"<{type(value).__name__}>"


def _assert_runtime_variables(variables: dict[str, object]) -> None:
    for name, value in variables.items():
        if isinstance(value, GraphElement):
            continue
        assert_json_value(value, name=f"initial variable {name!r}")
