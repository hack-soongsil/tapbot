"""Deterministic graph interpreter used beneath the existing macro lifecycle."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
import time
from uuid import uuid4

from tapbot.macro.graph_models import (
    GraphExecutionContext,
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

    def __post_init__(self) -> None:
        if self.max_steps < 1:
            raise ValueError("max_steps must be positive")
        if self.execution_timeout_sec <= 0:
            raise ValueError("execution_timeout_sec must be positive")
        if self.retry_limit < 0:
            raise ValueError("retry_limit must not be negative")
        if self.repeat_limit < 0:
            raise ValueError("repeat_limit must not be negative")


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
        context: GraphExecutionContext | None = None,
        cancelled: Callable[[], bool] | None = None,
        on_node_start: Callable[[MacroNode, GraphRuntime], None] | None = None,
        on_trace: Callable[[GraphNodeTrace, GraphRuntime], None] | None = None,
        on_edge: Callable[[MacroEdge, GraphRuntime], None] | None = None,
    ) -> GraphRunResult:
        self.validator.validate_or_raise(definition)
        snapshot = definition.snapshot()
        node_by_id = {node.id: node for node in snapshot.nodes}
        outgoing = _outgoing(snapshot.edges)
        started_monotonic = self.monotonic()
        execution_context = context or GraphExecutionContext()
        assert_json_value(execution_context.variables, name="initial variables")
        execution_context.variables = dict(execution_context.variables)
        execution_context.control_state = {}
        execution_context.started_at = self.now()
        execution_context.trace_id = (
            execution_context.trace_id or f"graph-{uuid4().hex[:12]}"
        )
        execution_context.monotonic = self.monotonic
        execution_context.started_monotonic = started_monotonic
        execution_context.sleep = execution_context.sleep or self.sleep

        runtime = GraphRuntime(
            definition_id=snapshot.id,
            definition_version=snapshot.version,
            current_node_id=snapshot.entry_node_id,
            state=GraphRuntimeStatus.RUNNING,
            variables=execution_context.variables,
            started_at=execution_context.started_at,
        )
        traces: list[GraphNodeTrace] = []
        retry_counts: dict[str, int] = defaultdict(int)
        repeat_counts: dict[str, int] = defaultdict(int)

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

    @staticmethod
    def _store_output(
        context: GraphExecutionContext,
        runtime: GraphRuntime,
        node: MacroNode,
        result: NodeResult,
    ) -> None:
        if not result.output:
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
    exact = [edge for edge in candidates if edge.condition == result.status.value]
    eligible = exact or [edge for edge in candidates if edge.condition is None]
    if len(eligible) > 1:
        raise RuntimeError("graph produced an ambiguous next edge")
    return eligible[0] if eligible else None


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
