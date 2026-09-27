"""Stable, transport-neutral schema and runtime types for macro graphs."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
import json
from collections.abc import Callable, Mapping
from typing import Any, Protocol, TypeAlias

from tapbot.macro.tap_point import TapBounds


JsonScalar: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True, slots=True)
class NodePosition:
    x: float
    y: float

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> NodePosition:
        return cls(float(value["x"]), float(value["y"]))

    def to_dict(self) -> JsonObject:
        return {"x": self.x, "y": self.y}


@dataclass(frozen=True, slots=True)
class MacroNode:
    id: str
    type: str
    config: JsonObject = field(default_factory=dict)
    position: NodePosition | None = None
    label: str | None = None

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> MacroNode:
        position = value.get("position")
        return cls(
            id=_text(value.get("id", ""), "node id"),
            type=_text(value.get("type", ""), "node type"),
            config=_json_object(value.get("config", {}), name="node config"),
            position=(
                None
                if position is None
                else NodePosition.from_dict(_mapping(position, "node position"))
            ),
            label=_optional_text(value.get("label"), "node label"),
        )

    def to_dict(self) -> JsonObject:
        result: JsonObject = {
            "id": self.id,
            "type": self.type,
            "config": _json_copy(self.config),
        }
        if self.position is not None:
            result["position"] = self.position.to_dict()
        if self.label is not None:
            result["label"] = self.label
        return result


@dataclass(frozen=True, slots=True)
class MacroEdge:
    id: str
    source: str
    target: str
    source_handle: str | None = None
    condition: str | None = None

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> MacroEdge:
        return cls(
            id=_text(value.get("id", ""), "edge id"),
            source=_text(value.get("source", ""), "edge source"),
            target=_text(value.get("target", ""), "edge target"),
            source_handle=_optional_text(
                value.get("source_handle"),
                "edge source_handle",
            ),
            condition=_optional_text(value.get("condition"), "edge condition"),
        )

    def to_dict(self) -> JsonObject:
        result: JsonObject = {
            "id": self.id,
            "source": self.source,
            "target": self.target,
        }
        if self.source_handle is not None:
            result["source_handle"] = self.source_handle
        if self.condition is not None:
            result["condition"] = self.condition
        return result


@dataclass(frozen=True, slots=True)
class MacroDefinition:
    id: str
    name: str
    version: int
    nodes: tuple[MacroNode, ...]
    edges: tuple[MacroEdge, ...]
    entry_node_id: str
    metadata: JsonObject = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> MacroDefinition:
        raw_nodes = value.get("nodes", [])
        raw_edges = value.get("edges", [])
        if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
            raise ValueError("macro nodes and edges must be arrays")
        version = value.get("version", 1)
        if isinstance(version, bool) or not isinstance(version, int):
            raise ValueError("macro version must be an integer")
        return cls(
            id=_text(value.get("id", ""), "macro id"),
            name=_text(value.get("name", ""), "macro name"),
            version=version,
            nodes=tuple(
                MacroNode.from_dict(_mapping(item, "macro node"))
                for item in raw_nodes
            ),
            edges=tuple(
                MacroEdge.from_dict(_mapping(item, "macro edge"))
                for item in raw_edges
            ),
            entry_node_id=_text(
                value.get("entry_node_id", ""),
                "entry_node_id",
            ),
            metadata=_json_object(value.get("metadata", {}), name="metadata"),
        )

    @classmethod
    def from_json(cls, payload: str) -> MacroDefinition:
        parsed = json.loads(payload)
        return cls.from_dict(_mapping(parsed, "macro definition"))

    def to_dict(self) -> JsonObject:
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "nodes": [node.to_dict() for node in self.nodes],
            "edges": [edge.to_dict() for edge in self.edges],
            "entry_node_id": self.entry_node_id,
            "metadata": _json_copy(self.metadata),
        }

    def to_json(self, *, indent: int | None = 2) -> str:
        return json.dumps(
            self.to_dict(),
            ensure_ascii=False,
            indent=indent,
            sort_keys=True,
        )

    def snapshot(self) -> MacroDefinition:
        """Detach a running definition from caller-owned mutable config data."""

        return MacroDefinition.from_dict(self.to_dict())


class NodeStatus(StrEnum):
    SUCCESS = "success"
    FAILURE = "failure"
    RETRY = "retry"
    STOPPED = "stopped"


@dataclass(frozen=True, slots=True)
class NodeResult:
    status: NodeStatus
    output: JsonObject = field(default_factory=dict)
    next_handle: str | None = None
    error: str | None = None

    @classmethod
    def success(
        cls,
        output: JsonObject | None = None,
        *,
        next_handle: str | None = None,
    ) -> NodeResult:
        return cls(NodeStatus.SUCCESS, output or {}, next_handle)

    @classmethod
    def failure(cls, error: str, output: JsonObject | None = None) -> NodeResult:
        return cls(NodeStatus.FAILURE, output or {}, error=error)


class GraphRuntimeStatus(StrEnum):
    IDLE = "idle"
    RUNNING = "running"
    COMPLETED = "completed"
    STOPPED = "stopped"
    CANCELLED = "cancelled"
    ERROR = "error"


@dataclass(slots=True)
class GraphRuntime:
    definition_id: str
    definition_version: int
    current_node_id: str | None
    state: GraphRuntimeStatus = GraphRuntimeStatus.IDLE
    step_count: int = 0
    variables: JsonObject = field(default_factory=dict)
    last_result: NodeResult | None = None
    error: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class GraphElement:
    id: str
    bounds: TapBounds
    text: str | None = None
    metadata: JsonObject = field(default_factory=dict)


class GraphActionPort(Protocol):
    """High-level primitive port implemented by Android or robot adapters."""

    def tap_screen(
        self,
        x: float,
        y: float,
        *,
        duration_ms: int,
    ) -> Mapping[str, object] | None: ...

    def swipe(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        *,
        duration_ms: int,
    ) -> Mapping[str, object] | None: ...

    def back(self) -> Mapping[str, object] | None: ...

    def home(self) -> Mapping[str, object] | None: ...


class GraphUiPort(Protocol):
    """UI-resolution port; transport and accessibility parsing stay outside."""

    def read_ui_tree(self) -> object: ...

    def find_element(self, selector: JsonObject) -> GraphElement | None: ...

    def current_state(self) -> str: ...


@dataclass(slots=True)
class GraphExecutionContext:
    device_id: str | None = None
    variables: JsonObject = field(default_factory=dict)
    last_observation: object | None = None
    last_resolved_element: GraphElement | None = None
    last_action_result: JsonObject | None = None
    started_at: datetime = field(default_factory=utc_now)
    trace_id: str = ""
    actions: GraphActionPort | None = None
    ui: GraphUiPort | None = None
    current_node_id: str | None = None
    control_state: dict[str, int] = field(default_factory=dict)
    sleep: Callable[[float], None] | None = field(default=None, repr=False)
    ensure_active: Callable[[], None] | None = field(default=None, repr=False)
    monotonic: Callable[[], float] | None = field(default=None, repr=False)
    started_monotonic: float = field(default=0.0, repr=False)

    def check_active(self) -> None:
        if self.ensure_active is not None:
            self.ensure_active()


@dataclass(frozen=True, slots=True)
class GraphNodeTrace:
    node_id: str
    node_type: str
    started_at: datetime
    completed_at: datetime
    status: NodeStatus
    input_summary: JsonObject
    output_summary: JsonObject
    error: str | None = None

    def to_dict(self) -> JsonObject:
        return {
            "node_id": self.node_id,
            "node_type": self.node_type,
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat(),
            "status": self.status.value,
            "input_summary": _json_copy(self.input_summary),
            "output_summary": _json_copy(self.output_summary),
            "error": self.error,
        }


@dataclass(frozen=True, slots=True)
class GraphRunResult:
    definition: MacroDefinition
    runtime: GraphRuntime
    traces: tuple[GraphNodeTrace, ...]


def assert_json_value(value: object, *, name: str = "value") -> None:
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be JSON-compatible: {error}") from error


def _mapping(value: object, name: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not all(
        isinstance(key, str) for key in value
    ):
        raise ValueError(f"{name} must be an object with string keys")
    return value


def _json_object(value: object, *, name: str) -> JsonObject:
    mapping = _mapping(value, name)
    assert_json_value(mapping, name=name)
    return _json_copy(mapping)


def _json_copy(value: object) -> Any:
    return json.loads(json.dumps(value, allow_nan=False))


def _optional_text(value: object, name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    return value


def _text(value: object, name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    return value
