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
    target_handle: str | None = None
    kind: str | None = None

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
            target_handle=_optional_text(
                value.get("target_handle"),
                "edge target_handle",
            ),
            kind=_edge_kind(value.get("kind")),
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
        if self.target_handle is not None:
            result["target_handle"] = self.target_handle
        if self.kind is not None:
            result["kind"] = self.kind
        return result

    @property
    def effective_kind(self) -> str:
        return self.kind or "exec"


@dataclass(frozen=True, slots=True)
class ScreenDefinition:
    id: str
    match: JsonObject = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> ScreenDefinition:
        return cls(
            id=_text(value.get("id", ""), "screen id"),
            match=_json_object(value.get("match", {}), name="screen match"),
        )

    def to_dict(self) -> JsonObject:
        return {"id": self.id, "match": _json_copy(self.match)}


@dataclass(frozen=True, slots=True)
class EventEntryNodeIds:
    enter: str | None = None
    update: str | None = None
    exit: str | None = None

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> EventEntryNodeIds:
        return cls(
            enter=_optional_text(value.get("enter"), "enter event entry"),
            update=_optional_text(value.get("update"), "update event entry"),
            exit=_optional_text(value.get("exit"), "exit event entry"),
        )

    def to_dict(self) -> JsonObject:
        result: JsonObject = {}
        if self.enter is not None:
            result["enter"] = self.enter
        if self.update is not None:
            result["update"] = self.update
        if self.exit is not None:
            result["exit"] = self.exit
        return result

    def get(self, kind: str) -> str | None:
        if kind not in {"enter", "update", "exit"}:
            raise ValueError(f"unknown screen event kind: {kind}")
        return getattr(self, kind)

    @property
    def values(self) -> tuple[str, ...]:
        return tuple(value for value in (self.enter, self.update, self.exit) if value)


@dataclass(frozen=True, slots=True)
class MacroDefinition:
    id: str
    name: str
    version: int
    nodes: tuple[MacroNode, ...]
    edges: tuple[MacroEdge, ...]
    entry_node_id: str | None
    metadata: JsonObject = field(default_factory=dict)
    screen: ScreenDefinition | None = None
    event_entry_node_ids: EventEntryNodeIds | None = None

    def __post_init__(self) -> None:
        if self.event_entry_node_ids is None and self.entry_node_id:
            object.__setattr__(
                self,
                "event_entry_node_ids",
                EventEntryNodeIds(enter=self.entry_node_id),
            )

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> MacroDefinition:
        raw_nodes = value.get("nodes", [])
        raw_edges = value.get("edges", [])
        if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
            raise ValueError("macro nodes and edges must be arrays")
        version = value.get("version", 1)
        if isinstance(version, bool) or not isinstance(version, int):
            raise ValueError("macro version must be an integer")
        raw_entry = value.get("entry_node_id")
        entry_node_id = _optional_text(raw_entry, "entry_node_id")
        raw_event_entries = value.get("event_entry_node_ids")
        event_entries = (
            EventEntryNodeIds(enter=entry_node_id)
            if raw_event_entries is None and entry_node_id
            else None
            if raw_event_entries is None
            else EventEntryNodeIds.from_dict(
                _mapping(raw_event_entries, "event_entry_node_ids")
            )
        )
        raw_screen = value.get("screen")
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
            entry_node_id=entry_node_id,
            metadata=_json_object(value.get("metadata", {}), name="metadata"),
            screen=(
                None
                if raw_screen is None
                else ScreenDefinition.from_dict(_mapping(raw_screen, "screen"))
            ),
            event_entry_node_ids=event_entries,
        )

    @classmethod
    def from_json(cls, payload: str) -> MacroDefinition:
        parsed = json.loads(payload)
        return cls.from_dict(_mapping(parsed, "macro definition"))

    def to_dict(self) -> JsonObject:
        result: JsonObject = {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "nodes": [node.to_dict() for node in self.nodes],
            "edges": [edge.to_dict() for edge in self.edges],
            "metadata": _json_copy(self.metadata),
        }
        if self.entry_node_id is not None:
            result["entry_node_id"] = self.entry_node_id
        if self.screen is not None:
            result["screen"] = self.screen.to_dict()
        if self.event_entry_node_ids is not None:
            result["event_entry_node_ids"] = self.event_entry_node_ids.to_dict()
        return result

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

    def entry_for(self, event_kind: str = "enter") -> str | None:
        if self.event_entry_node_ids is not None:
            selected = self.event_entry_node_ids.get(event_kind)
            if selected is not None:
                return selected
        return self.entry_node_id if event_kind == "enter" else None

    @property
    def entry_node_ids(self) -> tuple[str, ...]:
        if self.event_entry_node_ids is not None:
            values = self.event_entry_node_ids.values
            if values:
                return values
        return () if self.entry_node_id is None else (self.entry_node_id,)


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
    data_outputs: dict[str, object] = field(default_factory=dict)
    fallback_handles: tuple[str, ...] = ()

    @classmethod
    def success(
        cls,
        output: JsonObject | None = None,
        *,
        next_handle: str | None = None,
        data_outputs: dict[str, object] | None = None,
        fallback_handles: tuple[str, ...] = (),
    ) -> NodeResult:
        return cls(
            NodeStatus.SUCCESS,
            output or {},
            next_handle,
            None,
            data_outputs or {},
            fallback_handles,
        )

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

    def find_element(
        self,
        selector: JsonObject,
        *,
        strategy: str = "unique",
        require_enabled: bool = True,
        require_visible: bool = True,
    ) -> GraphElement | None: ...

    def current_state(self) -> str: ...

    def screen_size(self) -> tuple[int, int]: ...

    def resolve_screen_element(
        self,
        screen_id: str,
        element_id: str,
        params: dict[str, object],
    ) -> GraphElement: ...


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
    input_values: dict[str, object] = field(default_factory=dict)
    node_outputs: dict[str, dict[str, object]] = field(default_factory=dict)
    sleep: Callable[[float], None] | None = field(default=None, repr=False)
    ensure_active: Callable[[], None] | None = field(default=None, repr=False)
    monotonic: Callable[[], float] | None = field(default=None, repr=False)
    started_monotonic: float = field(default=0.0, repr=False)

    def check_active(self) -> None:
        if self.ensure_active is not None:
            self.ensure_active()

    def input(self, name: str, default: object = None) -> object:
        return self.input_values.get(name, default)


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


def _edge_kind(value: object) -> str | None:
    kind = _optional_text(value, "edge kind")
    if kind is not None and kind not in {"exec", "data"}:
        raise ValueError("edge kind must be exec or data")
    return kind


def _text(value: object, name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    return value
