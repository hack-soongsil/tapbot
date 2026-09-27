"""Structural and handler-config validation for macro definitions."""

from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass
import math

from tapbot.macro.graph_models import MacroDefinition, NodeStatus, assert_json_value
from tapbot.macro.node_registry import NodeRegistry


@dataclass(frozen=True, slots=True)
class GraphValidationReport:
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()

    @property
    def valid(self) -> bool:
        return not self.errors

    def raise_for_errors(self) -> None:
        if self.errors:
            raise GraphValidationError(self.errors)


class GraphValidationError(ValueError):
    def __init__(self, errors: tuple[str, ...] | list[str]) -> None:
        self.errors = tuple(errors)
        super().__init__("invalid macro graph: " + "; ".join(self.errors))


class GraphValidator:
    def __init__(self, registry: NodeRegistry) -> None:
        self.registry = registry

    def validate(self, definition: MacroDefinition) -> GraphValidationReport:
        errors: list[str] = []
        warnings: list[str] = []
        if not definition.id:
            errors.append("macro id must not be empty")
        if not definition.name:
            errors.append("macro name must not be empty")
        if definition.version < 1:
            errors.append("macro version must be >= 1")
        if not isinstance(definition.metadata, dict):
            errors.append("macro metadata must be an object")
        else:
            try:
                assert_json_value(definition.metadata, name="macro metadata")
            except ValueError as error:
                errors.append(str(error))

        node_counts = Counter(node.id for node in definition.nodes)
        duplicate_nodes = sorted(
            node_id for node_id, count in node_counts.items() if count > 1
        )
        if duplicate_nodes:
            errors.append(f"duplicate node ids: {', '.join(duplicate_nodes)}")
        node_by_id = {node.id: node for node in definition.nodes if node.id}
        if any(not node.id for node in definition.nodes):
            errors.append("node id must not be empty")
        if definition.entry_node_id not in node_by_id:
            errors.append("entry node does not exist")

        for node in definition.nodes:
            if not node.type:
                errors.append(f"node {node.id!r} type must not be empty")
                continue
            if node.position is not None and (
                not math.isfinite(node.position.x)
                or not math.isfinite(node.position.y)
            ):
                errors.append(f"node {node.id!r} position must be finite")
            if not isinstance(node.config, dict):
                errors.append(f"node {node.id!r} config must be an object")
                continue
            try:
                assert_json_value(node.config, name=f"node {node.id!r} config")
            except ValueError as error:
                errors.append(str(error))
                continue
            try:
                handler = self.registry.get(node.type)
            except KeyError:
                errors.append(
                    f"node {node.id!r} has unsupported type {node.type!r}"
                )
                continue
            errors.extend(
                f"node {node.id!r}: {message}"
                for message in handler.validate(node.config)
            )

        edge_counts = Counter(edge.id for edge in definition.edges)
        duplicate_edges = sorted(
            edge_id for edge_id, count in edge_counts.items() if count > 1
        )
        if duplicate_edges:
            errors.append(f"duplicate edge ids: {', '.join(duplicate_edges)}")
        if any(not edge.id for edge in definition.edges):
            errors.append("edge id must not be empty")

        routes: set[tuple[str, str | None, str | None]] = set()
        for edge in definition.edges:
            if edge.source not in node_by_id:
                errors.append(
                    f"edge {edge.id!r} source {edge.source!r} does not exist"
                )
                continue
            if edge.target not in node_by_id:
                errors.append(
                    f"edge {edge.id!r} target {edge.target!r} does not exist"
                )
            if edge.condition is not None and edge.condition not in {
                status.value for status in NodeStatus
            }:
                errors.append(
                    f"edge {edge.id!r} has invalid condition {edge.condition!r}"
                )
            source = node_by_id[edge.source]
            try:
                handles = self.registry.get(source.type).output_handles
            except KeyError:
                handles = frozenset()
            if edge.source_handle is not None and edge.source_handle not in handles:
                errors.append(
                    f"edge {edge.id!r} has invalid source handle "
                    f"{edge.source_handle!r} for {source.type!r}"
                )
            route = (edge.source, edge.source_handle, edge.condition)
            if route in routes:
                errors.append(
                    f"node {edge.source!r} has ambiguous outgoing edges for "
                    f"handle={edge.source_handle!r}, condition={edge.condition!r}"
                )
            routes.add(route)

        if definition.entry_node_id in node_by_id:
            reachable = self._reachable(definition, definition.entry_node_id)
            unreachable = sorted(set(node_by_id) - reachable)
            if unreachable:
                warnings.append(f"unreachable nodes: {', '.join(unreachable)}")
        return GraphValidationReport(tuple(errors), tuple(warnings))

    def validate_or_raise(self, definition: MacroDefinition) -> None:
        self.validate(definition).raise_for_errors()

    @staticmethod
    def _reachable(
        definition: MacroDefinition,
        entry_node_id: str,
    ) -> set[str]:
        outgoing: dict[str, list[str]] = defaultdict(list)
        for edge in definition.edges:
            outgoing[edge.source].append(edge.target)
        visited: set[str] = set()
        queue = deque([entry_node_id])
        while queue:
            node_id = queue.popleft()
            if node_id in visited:
                continue
            visited.add(node_id)
            queue.extend(outgoing[node_id])
        return visited
