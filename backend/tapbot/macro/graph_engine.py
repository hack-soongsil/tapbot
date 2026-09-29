"""Deterministic graph interpreter used beneath the existing macro lifecycle."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import datetime
import logging
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
from tapbot.macro.errors import MacroExecutionError, runtime_error_payload
from tapbot.macro.node_registry import NodeRegistry


logger = logging.getLogger(__name__)


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
        _trace_steps: list[int] | None = None,
        _screen_id: str | None = None,
        _root_definition_id: str | None = None,
        _function_name_stack: tuple[str, ...] = (),
        _caller_node_stack: tuple[str, ...] = (),
    ) -> GraphRunResult:
        self.validator.validate_or_raise(definition)
        snapshot = definition.snapshot()
        selected_entry = entry_node_id or snapshot.entry_for("enter")
        if selected_entry is None or selected_entry not in {
            node.id for node in snapshot.nodes
        }:
            raise ValueError("selected graph entry node does not exist")
        node_by_id = {node.id: node for node in snapshot.nodes}
        trace_steps = _trace_steps if _trace_steps is not None else [0]
        screen_id = (_screen_id or node_by_id[selected_entry].config.get("screen_id")
                     or (snapshot.screen.id if snapshot.screen else None))
        root_definition_id = _root_definition_id or snapshot.id
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
            on_trace=child_trace,
            trace_steps=trace_steps,
            screen_id=screen_id if isinstance(screen_id, str) else None,
            root_definition_id=root_definition_id,
            function_name_stack=_function_name_stack,
            caller_node_stack=_caller_node_stack,
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
        trace_callback = on_trace

        def trace_failure_payload(
            trace: GraphNodeTrace,
            *,
            code: str,
            message: str,
            hint: str,
            details: JsonObject | None = None,
            extra: JsonObject | None = None,
        ) -> JsonObject:
            failed_node = node_by_id.get(trace.node_id)
            payload: JsonObject = dict(runtime_error_payload(
                code=code,
                message=message,
                graph_path=list(trace.graph_path_labels),
                screen_id=trace.screen_id,
                node_id=trace.node_id,
                node_type=trace.node_type,
                node_label=trace.node_label or trace.node_type,
                input_values=trace.resolved_inputs,
                config=_summarize(failed_node.config) if failed_node else {},
                details=details,
                hint=hint,
            ))
            payload.update({
                "active_screen": trace.screen_id,
                "current_step": trace.step,
                "graph_path_ids": list(trace.graph_path),
                "graph_path_labels": list(trace.graph_path_labels),
                "resolved_inputs": trace.resolved_inputs,
                "input_sources": trace.input_sources,
            })
            if extra:
                payload.update(extra)
            return payload

        def publish_trace(trace: GraphNodeTrace, progress: GraphRuntime) -> None:
            if progress.state is GraphRuntimeStatus.ERROR and not trace.error:
                code, message, hint = _runtime_state_error(progress.error)
                trace = replace(
                    trace, status=NodeStatus.FAILURE, error=message,
                    error_payload=trace_failure_payload(
                        trace, code=code, message=message, hint=hint,
                    ),
                )
                traces[-1] = trace
            if trace_callback is not None:
                trace_callback(trace, progress)

        on_trace = publish_trace

        def child_trace(trace: GraphNodeTrace, progress: GraphRuntime) -> None:
            traces.append(trace)
            publish_trace(trace, progress)

        def record(result: NodeResult, error: Exception | None = None) -> None:
            trace_steps[0] += 1
            payload: JsonObject | None = None
            resolved_inputs = _summarize(execution_context.input_values)
            input_sources = _input_sources(node.id, data_incoming)
            function_id = _call_stack[-1] if _call_stack else None
            function_name = _function_name_stack[-1] if _function_name_stack else None
            caller_node_id = _caller_node_stack[-1] if _caller_node_stack else None
            if result.error:
                partial = _error_details(node, result, error)
                port_id = partial.get("port_id") or partial.get("port") or partial.get("target_handle")
                port_id = port_id if isinstance(port_id, str) else None
                expected_type = partial.get("expected_type") or partial.get("expected")
                expected_type = expected_type if isinstance(expected_type, str) else None
                actual_type = partial.get("actual_type") or partial.get("actual")
                actual_type = actual_type if isinstance(actual_type, str) else None
                detail_value = partial.get("details")
                details = detail_value if isinstance(detail_value, dict) else {}
                code = partial.get("code")
                message = partial.get("message")
                hint = partial.get("hint")
                payload = dict(runtime_error_payload(
                    code=code if isinstance(code, str) else "NODE_EXECUTION_FAILED",
                    message=message if isinstance(message, str) else "노드 실행 중 오류가 발생했습니다.",
                    graph_path=["Main", *_function_name_stack],
                    screen_id=screen_id if isinstance(screen_id, str) else None,
                    node_id=node.id,
                    node_type=node.type,
                    node_label=node.label or node.type,
                    port_id=port_id,
                    expected_type=expected_type,
                    actual_type=actual_type,
                    input_values=resolved_inputs,
                    config=_summarize(node.config),
                    details=details,
                    hint=hint if isinstance(hint, str) else None,
                ))
                # Keep extended execution context and legacy aliases while the
                # required v1 keys above stay stable for GUI consumers.
                payload.update({
                    key: value for key, value in partial.items()
                    if key not in {
                        "code", "message", "summary", "graph_path", "screen_id",
                        "node_id", "node_type", "node_label", "port_id",
                        "expected_type", "actual_type", "input_values", "config",
                        "details", "hint",
                    }
                })
                payload.update({
                    "summary": payload["message"],
                    "port": port_id,
                    "expected": expected_type,
                    "actual": partial.get("actual", actual_type),
                    "active_screen": screen_id if isinstance(screen_id, str) else None,
                    "current_step": trace_steps[0],
                    "graph_path_ids": ["main", *_call_stack],
                    "graph_path_labels": ["Main", *_function_name_stack],
                    "function_id": function_id,
                    "function_name": function_name,
                    "caller_node_id": caller_node_id,
                    "function_inputs": _summarize(execution_context.function_inputs),
                    "resolved_inputs": resolved_inputs,
                    "input_sources": input_sources,
                })
                failed_port = port_id
                if isinstance(failed_port, str):
                    source = input_sources.get(failed_port)
                    if isinstance(source, dict):
                        payload.update({
                            "source_node_id": source.get("source_node_id"),
                            "source_port_id": source.get("source_port_id"),
                        })
                elements = _element_contexts(
                    execution_context.input_values,
                    input_sources,
                    node_by_id,
                )
                if elements:
                    payload["elements"] = elements
                    payload["element"] = next(iter(elements.values()))
            traces.append(_trace(
                node, started_at, self.now(), result,
                step=trace_steps[0], graph_path=("main", *_call_stack),
                graph_path_labels=("Main", *_function_name_stack),
                screen_id=screen_id if isinstance(screen_id, str) else None,
                macro_definition_id=root_definition_id,
                inputs=execution_context.input_values,
                input_sources=input_sources,
                function_id=function_id,
                function_name=function_name,
                caller_node_id=caller_node_id,
                function_inputs=execution_context.function_inputs,
                error_payload=payload,
            ))
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
            execution_context.input_values = {}
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
                result = NodeResult(NodeStatus.STOPPED, error="매크로 실행이 취소되었습니다.")
                record(result, error)
                runtime.step_count += 1
                runtime.last_result = result
                _finish(runtime, GraphRuntimeStatus.CANCELLED, self.now(), result.error)
                _notify(on_trace, traces[-1], runtime)
                break
            except _GraphTimedOut as error:
                result = NodeResult(NodeStatus.FAILURE, error="매크로 실행 시간이 초과되었습니다.")
                record(result, error)
                runtime.step_count += 1
                runtime.last_result = result
                _finish(runtime, GraphRuntimeStatus.ERROR, self.now(), result.error)
                _notify(on_trace, traces[-1], runtime)
                break
            except Exception as error:
                expected_error = isinstance(error, (_FunctionExecutionError, MacroExecutionError)) or (
                    isinstance(error, _GraphEdgeError)
                    and isinstance(error.cause, MacroExecutionError)
                )
                if not expected_error:
                    logger.exception(
                        "Macro node execution failed: definition=%s node=%s type=%s",
                        snapshot.id, node.id, node.type,
                    )
                result = NodeResult(
                    NodeStatus.FAILURE,
                    error=_public_error_message(error),
                )
                record(result, error)
                runtime.step_count += 1
                runtime.last_result = result
                _finish(runtime, GraphRuntimeStatus.ERROR, self.now(), result.error)
                _notify(on_trace, traces[-1], runtime)
                break

            runtime.step_count += 1
            runtime.last_result = result
            record(result)
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
                if isinstance(error, _GraphEdgeError):
                    message = "다음 실행 연결을 결정할 수 없습니다."
                    traces[-1] = replace(
                        traces[-1], status=NodeStatus.FAILURE, error=message,
                        error_payload=trace_failure_payload(
                            traces[-1],
                            code="NODE_EXECUTION_FAILED",
                            message=message,
                            hint="노드의 실행 출력 연결이 중복되거나 잘못되었는지 확인하세요.",
                            details=error.details,
                            extra=error.details,
                        ),
                    )
                else:
                    message = "실행 연결 처리 중 오류가 발생했습니다."
                _finish(runtime, GraphRuntimeStatus.ERROR, self.now(), message)
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

        if runtime.state is GraphRuntimeStatus.ERROR and (
            not traces or not traces[-1].error
        ):
            _, public_runtime_error, _ = _runtime_state_error(runtime.error)
            node = node_by_id[runtime.current_node_id or selected_entry]
            started_at = self.now()
            record(NodeResult(NodeStatus.FAILURE, error=public_runtime_error))
            _notify(on_trace, traces[-1], runtime)
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
        on_trace: Callable[[GraphNodeTrace, GraphRuntime], None],
        trace_steps: list[int],
        screen_id: str | None,
        root_definition_id: str,
        function_name_stack: tuple[str, ...],
        caller_node_stack: tuple[str, ...],
    ) -> dict[str, object]:
        function = next(
            (candidate for candidate in definition.functions if candidate.id == function_id),
            None,
        )
        if function is None:
            raise MacroExecutionError(
                "호출할 함수를 찾을 수 없습니다.",
                code="FUNCTION_NOT_FOUND",
                hint="Call Function 노드에서 삭제되거나 변경된 함수를 다시 선택하세요.",
                details={"function_id": function_id},
            )
        if function_id in call_stack:
            chain = " -> ".join((*call_stack, function_id))
            raise MacroExecutionError(
                "재귀 함수 호출은 지원되지 않습니다.",
                code="FUNCTION_EXECUTION_FAILED",
                hint="함수 호출 관계에서 순환 연결을 제거하세요.",
                details={"call_chain": chain},
            )
        if len(call_stack) >= self.limits.max_call_depth:
            raise MacroExecutionError(
                "함수 호출 깊이 제한을 초과했습니다.",
                code="FUNCTION_EXECUTION_FAILED",
                hint="중첩 함수 호출 단계를 줄이세요.",
                details={"max_call_depth": self.limits.max_call_depth},
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
            on_trace=on_trace,
            _trace_steps=trace_steps,
            _screen_id=screen_id,
            _root_definition_id=root_definition_id,
            _function_name_stack=(*function_name_stack, function.name),
            _caller_node_stack=(*caller_node_stack, parent.current_node_id or ""),
        )
        if result.runtime.state is not GraphRuntimeStatus.COMPLETED:
            failed_trace = max(
                (trace for trace in result.traces if trace.error),
                key=lambda trace: len(trace.graph_path),
                default=None,
            )
            if failed_trace is not None:
                raise _FunctionExecutionError(failed_trace)
            raise MacroExecutionError(
                "함수 실행을 완료하지 못했습니다.",
                code="FUNCTION_EXECUTION_FAILED",
                hint="함수 그래프의 실행 흐름과 Return 노드를 확인하세요.",
                details={"function_id": function_id},
            )
        returned = child.node_outputs.get(function.return_node_id)
        if returned is None:
            raise MacroExecutionError(
                "함수가 Return 노드에 도달하지 못했습니다.",
                code="FUNCTION_RETURN_INVALID",
                hint="모든 함수 실행 경로가 Function Return에 연결되는지 확인하세요.",
                details={"function_id": function_id, "return_node_id": function.return_node_id},
            )
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


class _FunctionExecutionError(RuntimeError):
    def __init__(self, origin: GraphNodeTrace) -> None:
        super().__init__(origin.error)
        self.origin = origin


class _GraphEdgeError(RuntimeError):
    def __init__(self, message: str, edge: MacroEdge, cause: Exception | None = None) -> None:
        super().__init__(message)
        self.cause = cause
        self.details: JsonObject = {
            "edge_id": edge.id, "source": edge.source, "target": edge.target,
            "source_handle": edge.source_handle, "target_handle": edge.target_handle,
            "source_node_id": edge.source,
            "source_port_id": edge.source_handle,
            "target_node_id": edge.target,
            "target_port_id": edge.target_handle,
            "port_id": edge.target_handle,
        }


def _public_error_message(error: Exception) -> str:
    if isinstance(error, MacroExecutionError):
        message = error.payload.get("message")
        return message if isinstance(message, str) else "노드 실행에 실패했습니다."
    if isinstance(error, _FunctionExecutionError):
        payload = error.origin.error_payload or {}
        message = payload.get("message")
        return message if isinstance(message, str) else "함수 실행에 실패했습니다."
    if isinstance(error, _GraphTimedOut):
        return "매크로 실행 시간이 초과되었습니다."
    if isinstance(error, _GraphEdgeError):
        if isinstance(error.cause, MacroExecutionError):
            return _public_error_message(error.cause)
        return "데이터 연결을 처리할 수 없습니다."
    return "노드 실행 중 내부 오류가 발생했습니다."


def _error_details(
    node: MacroNode,
    result: NodeResult,
    error: Exception | None,
) -> JsonObject:
    if isinstance(error, MacroExecutionError):
        return _summarize(error.payload)
    if isinstance(error, _GraphEdgeError):
        if isinstance(error.cause, MacroExecutionError):
            payload = _summarize(error.cause.payload)
        else:
            payload = {
                "code": "NODE_EXECUTION_FAILED",
                "message": "데이터 연결을 처리할 수 없습니다.",
                "hint": "연결된 데이터 노드가 먼저 실행되고 출력 핀이 존재하는지 확인하세요.",
                "details": {"exception_type": type(error.cause).__name__} if error.cause else {},
            }
        payload.update(error.details)
        return payload
    if isinstance(error, _FunctionExecutionError):
        origin_payload = error.origin.error_payload or {}
        message = origin_payload.get("message")
        return {
            "code": "NODE_EXECUTION_FAILED",
            "message": message if isinstance(message, str) else "함수 실행에 실패했습니다.",
            "hint": "오류가 발생한 함수 그래프와 노드 입력값을 확인하세요.",
            "details": {
                "origin_node_id": error.origin.node_id,
                "origin_graph_path": list(error.origin.graph_path_labels),
            },
            "cause": error.origin.to_dict(),
        }
    if isinstance(error, _GraphTimedOut):
        return {
            "code": "TIMEOUT",
            "message": "매크로 실행 시간이 초과되었습니다.",
            "hint": "대기 시간과 반복 조건을 확인한 뒤 다시 실행하세요.",
            "details": {},
        }
    if isinstance(error, _GraphCancelled):
        return {
            "code": "EXECUTION_CANCELLED",
            "message": "매크로 실행이 취소되었습니다.",
            "hint": None,
            "details": {},
        }
    if error is not None:
        return {
            "code": "NODE_EXECUTION_FAILED",
            "message": "노드 실행 중 내부 오류가 발생했습니다.",
            "hint": "노드 설정과 입력값을 확인하고, 문제가 반복되면 백엔드 로그를 확인하세요.",
            "details": {"exception_type": type(error).__name__},
        }

    code = "NODE_EXECUTION_FAILED"
    message = result.error or "노드 실행에 실패했습니다."
    hint = "노드 입력값과 설정, 대상 화면 상태를 확인한 뒤 다시 실행하세요."
    if result.next_handle == "timeout" or node.type in {"wait_for_element", "wait_for_state"}:
        code = "TIMEOUT"
        message = "대기 시간이 초과되었습니다."
        hint = "대상이 나타나는 조건과 제한 시간을 확인하세요."
    elif node.type in {"tap_element", "require_element", "assert_element"}:
        code = "ELEMENT_NOT_FOUND"
        message = "대상 엘리먼트를 찾을 수 없습니다."
        hint = "현재 화면과 엘리먼트 선택자를 확인하세요."
    return {"code": code, "message": message, "hint": hint, "details": {}}


def _runtime_state_error(error: str | None) -> tuple[str, str, str]:
    lowered = (error or "").lower()
    if "timeout" in lowered:
        return (
            "TIMEOUT",
            "매크로 실행 시간이 초과되었습니다.",
            "대기 시간과 반복 조건을 확인한 뒤 다시 실행하세요.",
        )
    if "retry limit" in lowered:
        return (
            "NODE_EXECUTION_FAILED",
            "노드 재시도 횟수 제한을 초과했습니다.",
            "재시도 조건과 대상 화면 상태를 확인하세요.",
        )
    if "repeat limit" in lowered or "step count" in lowered:
        return (
            "NODE_EXECUTION_FAILED",
            "그래프 반복 실행 제한을 초과했습니다.",
            "반복 종료 조건과 그래프 연결을 확인하세요.",
        )
    return (
        "NODE_EXECUTION_FAILED",
        "그래프 실행을 완료할 수 없습니다.",
        "그래프 실행 흐름과 연결 상태를 확인하세요.",
    )


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
        raise _GraphEdgeError("graph produced an ambiguous next edge", eligible[0])
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
            raise _GraphEdgeError(
                f"data source node {edge.source!r} has not executed before {node_id!r}", edge
            )
        if edge.source_handle not in source_values:
            raise _GraphEdgeError(
                f"data output {edge.source}.{edge.source_handle} is unavailable", edge
            )
        resolved[edge.target_handle] = source_values[edge.source_handle]
    return resolved


def _input_sources(
    node_id: str,
    incoming: dict[str, tuple[MacroEdge, ...]],
) -> JsonObject:
    sources: JsonObject = {}
    for edge in incoming.get(node_id, ()):
        if edge.target_handle is None:
            continue
        sources[edge.target_handle] = {
            "edge_id": edge.id,
            "source_node_id": edge.source,
            "source_port_id": edge.source_handle,
            "target_port_id": edge.target_handle,
        }
    return sources


def _element_contexts(
    inputs: dict[str, object],
    input_sources: JsonObject,
    nodes: dict[str, MacroNode],
) -> JsonObject:
    contexts: JsonObject = {}
    for port_id, value in inputs.items():
        if not isinstance(value, GraphElement):
            continue
        source = input_sources.get(port_id)
        source_node = None
        if isinstance(source, dict):
            source_id = source.get("source_node_id")
            if isinstance(source_id, str):
                source_node = nodes.get(source_id)
        semantic_id = None
        configured_index = None
        if source_node is not None:
            candidate = source_node.config.get("element_id")
            if isinstance(candidate, str):
                semantic_id = candidate
            params = source_node.config.get("params")
            if isinstance(params, dict):
                configured_index = params.get("index")
        metadata = _summarize(value.metadata)
        index = metadata.get("index", configured_index)
        contexts[port_id] = {
            "element_id": value.id,
            "semantic_id": semantic_id or metadata.get("semantic_id"),
            "index": index,
            "bounds": value.bounds.to_list(),
            "metadata": metadata,
        }
    return contexts


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
        except (RuntimeError, TypeError, ValueError) as error:
            raise _GraphEdgeError(str(error), edge, error) from error
        finally:
            context.input_values = previous_inputs
        if result.status is not NodeStatus.SUCCESS:
            raise _GraphEdgeError(result.error or f"variable source {source.id!r} failed", edge)
        context.node_outputs[source.id] = dict(result.data_outputs)


def _trace(
    node: MacroNode,
    started_at: datetime,
    completed_at: datetime,
    result: NodeResult,
    *,
    step: int,
    graph_path: tuple[str, ...],
    graph_path_labels: tuple[str, ...],
    screen_id: str | None,
    macro_definition_id: str,
    inputs: dict[str, object],
    input_sources: JsonObject,
    function_id: str | None,
    function_name: str | None,
    caller_node_id: str | None,
    function_inputs: dict[str, object],
    error_payload: JsonObject | None,
) -> GraphNodeTrace:
    return GraphNodeTrace(
        node_id=node.id,
        node_type=node.type,
        started_at=started_at,
        completed_at=completed_at,
        status=result.status,
        input_summary=_summarize({**node.config, **inputs}),
        output_summary=_summarize({**result.output, **result.data_outputs}),
        error=result.error,
        step=step,
        graph_path=graph_path,
        graph_path_labels=graph_path_labels,
        screen_id=screen_id,
        macro_definition_id=macro_definition_id,
        error_payload=error_payload,
        node_label=node.label or node.type,
        function_id=function_id,
        function_name=function_name,
        caller_node_id=caller_node_id,
        resolved_inputs=_summarize(inputs),
        input_sources=input_sources,
        function_input_summary=_summarize(function_inputs),
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
    if isinstance(value, GraphElement):
        return _summarize_value({
            "runtime_type": "element", "id": value.id,
            "bounds": value.bounds.to_list(), "metadata": value.metadata,
        }, depth=depth)
    if isinstance(value, dict):
        result: JsonObject = {}
        items = list(value.items())
        for key, item in items[:50]:
            name = str(key)
            if any(
                secret in name.lower()
                for secret in ("token", "secret", "password", "authorization")
            ):
                result[name] = "<redacted>"
            else:
                result[name] = _summarize_value(item, depth=depth + 1)
        if len(items) > 50:
            result["<truncated>"] = f"{len(items) - 50} more fields"
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
