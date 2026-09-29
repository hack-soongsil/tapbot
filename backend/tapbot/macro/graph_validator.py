"""Structural and handler-config validation for macro definitions."""

from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass
import math

from tapbot.macro.graph_models import (
    MacroDefinition,
    MacroEdge,
    MacroFunctionDefinition,
    NodeStatus,
    assert_json_value,
)
from tapbot.macro.node_registry import NodeRegistry
from tapbot.macro.ports import PortType, ports_for
from tapbot.macro.nodes.variable import default_matches_type


_EVENT_NODE_TYPES = {
    "enter": "screen_enter",
    "update": "screen_update",
    "exit": "screen_exit",
}


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
        entry_ids = definition.entry_node_ids
        if not entry_ids:
            errors.append("entry node does not exist")
        for entry_id in entry_ids:
            if entry_id not in node_by_id:
                errors.append(
                    "entry node does not exist"
                    if definition.entry_node_id == entry_id
                    else f"entry node {entry_id!r} does not exist"
                )

        if definition.screen_event_entry_node_ids is not None:
            referenced_event_nodes: set[str] = set()
            for screen_id, entries in definition.screen_event_entry_node_ids.items():
                if not screen_id:
                    errors.append("screen id must not be empty")
                    continue
                for kind, node_type in _EVENT_NODE_TYPES.items():
                    matching = [
                        node
                        for node in definition.nodes
                        if node.type == node_type
                        and node.config.get("screen_id") == screen_id
                        and node.config.get("event") == kind
                    ]
                    if len(matching) != 1:
                        errors.append(
                            f"screen {screen_id!r} must contain exactly one "
                            f"{node_type} node"
                        )
                    entry_id = entries.get(kind)
                    if entry_id is None:
                        errors.append(
                            f"screen {screen_id!r} is missing {kind} event entry"
                        )
                    elif entry_id in node_by_id:
                        referenced_event_nodes.add(entry_id)
                        entry_node = node_by_id[entry_id]
                        if entry_node.type != node_type:
                            errors.append(
                                f"screen {screen_id!r} {kind} event entry must "
                                f"reference a {node_type} node"
                            )
                        if (
                            entry_node.config.get("screen_id") != screen_id
                            or entry_node.config.get("event") != kind
                        ):
                            errors.append(
                                f"event node {entry_id!r} must identify {screen_id}.{kind}"
                            )
            for node in definition.nodes:
                if node.type in _EVENT_NODE_TYPES.values() and node.id not in referenced_event_nodes:
                    errors.append(
                        f"event node {node.id!r} is not a registered "
                        "screen event entry"
                    )
        elif definition.screen is not None:
            if not definition.screen.id:
                errors.append("screen id must not be empty")
            entries = definition.event_entry_node_ids
            for kind, node_type in _EVENT_NODE_TYPES.items():
                matching = [node for node in definition.nodes if node.type == node_type]
                if len(matching) != 1:
                    errors.append(
                        f"screen graph must contain exactly one {node_type} node"
                    )
                entry_id = None if entries is None else entries.get(kind)
                if entry_id is None:
                    errors.append(f"screen graph is missing {kind} event entry")
                elif entry_id in node_by_id and node_by_id[entry_id].type != node_type:
                    errors.append(
                        f"{kind} event entry must reference a {node_type} node"
                    )

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
        data_targets: set[tuple[str, str]] = set()
        wired_inputs: dict[str, set[str]] = defaultdict(set)
        for edge in definition.edges:
            if edge.effective_kind not in {"exec", "data"}:
                errors.append(f"edge {edge.id!r} kind must be exec or data")
                continue
            if edge.source not in node_by_id:
                errors.append(
                    f"edge {edge.id!r} source {edge.source!r} does not exist"
                )
                continue
            if edge.target not in node_by_id:
                errors.append(
                    f"edge {edge.id!r} target {edge.target!r} does not exist"
                )
            elif node_by_id[edge.target].type in _EVENT_NODE_TYPES.values():
                errors.append(
                    f"event node {edge.target!r} cannot have incoming edges"
                )
            if edge.condition is not None and edge.condition not in {
                status.value for status in NodeStatus
            }:
                errors.append(
                    f"edge {edge.id!r} has invalid condition {edge.condition!r}"
                )
            if edge.target not in node_by_id:
                continue
            source = node_by_id[edge.source]
            target = node_by_id[edge.target]
            try:
                source_handler = self.registry.get(source.type)
                target_handler = self.registry.get(target.type)
            except KeyError:
                continue
            source_ports = ports_for(
                source.type,
                source.config,
                legacy_output_handles=source_handler.output_handles,
            )
            target_ports = ports_for(
                target.type,
                target.config,
                legacy_output_handles=target_handler.output_handles,
            )
            if edge.effective_kind == "data":
                if edge.condition is not None:
                    errors.append(f"data edge {edge.id!r} cannot have a condition")
                if edge.source_handle is None or edge.target_handle is None:
                    errors.append(
                        f"data edge {edge.id!r} requires source_handle and target_handle"
                    )
                    continue
                source_type = source_ports.outputs.get(edge.source_handle)
                target_type = target_ports.inputs.get(edge.target_handle)
                if source_type is None:
                    errors.append(
                        f"edge {edge.id!r} has invalid data source handle "
                        f"{edge.source_handle!r} for {source.type!r}"
                    )
                if target_type is None:
                    errors.append(
                        f"edge {edge.id!r} has invalid data target handle "
                        f"{edge.target_handle!r} for {target.type!r}"
                    )
                if source_type is PortType.EXEC or target_type is PortType.EXEC:
                    errors.append(f"data edge {edge.id!r} cannot connect exec ports")
                elif (
                    source_type is not None
                    and target_type is not None
                    and source_type != target_type
                    and source_type is not PortType.ANY
                    and target_type is not PortType.ANY
                ):
                    errors.append(
                        f"data edge {edge.id!r} type mismatch: "
                        f"{source_type.value} -> {target_type.value}"
                    )
                target_key = (edge.target, edge.target_handle)
                if target_key in data_targets:
                    errors.append(
                        f"data input {edge.target}.{edge.target_handle} has multiple sources"
                    )
                data_targets.add(target_key)
                wired_inputs[edge.target].add(edge.target_handle)
                continue

            if edge.target_handle is not None:
                target_type = target_ports.inputs.get(edge.target_handle)
                if target_type is not PortType.EXEC:
                    errors.append(
                        f"exec edge {edge.id!r} has invalid target handle "
                        f"{edge.target_handle!r} for {target.type!r}"
                    )
            if edge.source_handle is not None:
                source_type = source_ports.outputs.get(edge.source_handle)
                legacy_find_handle = (
                    edge.kind is None
                    and source.type == "find_element"
                    and edge.source_handle == "found"
                )
                if source_type is not PortType.EXEC and not legacy_find_handle:
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

        for node in definition.nodes:
            inputs = wired_inputs.get(node.id, set())
            if node.type == "branch" and "condition" not in inputs:
                condition = node.config.get("condition")
                fallback = condition if isinstance(condition, dict) else node.config
                if not isinstance(fallback.get("variable"), str) or not fallback.get("variable"):
                    errors.append(
                        f"node {node.id!r}: branch requires condition input or variable fallback"
                    )
            if node.type == "click_element" and "element" not in inputs:
                selector = node.config.get("selector")
                if not isinstance(selector, dict) or not selector:
                    errors.append(
                        f"node {node.id!r}: click_element requires element input or selector fallback"
                    )
            if node.type == "find_screen_element" and "index" not in inputs:
                from tapbot.ui_resolution.screens import validate_screen_element_reference

                params = node.config.get("params", {})
                for message in validate_screen_element_reference(
                    node.config.get("screen_id"),
                    node.config.get("element_id"),
                    params,
                ):
                    if message.startswith("params.index"):
                        errors.append(f"node {node.id!r}: {message}")
            if node.type == "function_return":
                raw_outputs = node.config.get("outputs", [])
                if isinstance(raw_outputs, list):
                    for port in raw_outputs:
                        if not isinstance(port, dict):
                            continue
                        required = port.get("required")
                        optional = port.get("optional")
                        is_required = required is True or (
                            required is None and optional is False
                        )
                        if not is_required:
                            continue
                        port_id = port.get("id")
                        if isinstance(port_id, str) and port_id not in inputs:
                            errors.append(
                                f"node {node.id!r}: required function output "
                                f"{port_id!r} is not connected"
                            )

        exec_edges = tuple(
            edge for edge in definition.edges if edge.effective_kind == "exec"
        )

        valid_entries = tuple(entry for entry in entry_ids if entry in node_by_id)
        if valid_entries:
            reachable: set[str] = set()
            for entry_id in valid_entries:
                reachable.update(self._reachable(exec_edges, entry_id))
            unreachable = sorted(set(node_by_id) - reachable)
            if unreachable:
                warnings.append(f"unreachable nodes: {', '.join(unreachable)}")
        connected = {edge.source for edge in exec_edges} | {
            edge.target for edge in exec_edges
        } | set(entry_ids)
        disconnected = sorted(set(node_by_id) - connected)
        if disconnected:
            warnings.append(f"nodes without exec connections: {', '.join(disconnected)}")
        function_errors, function_warnings = self._validate_functions(definition)
        errors.extend(function_errors)
        warnings.extend(function_warnings)
        errors.extend(self._validate_variables(definition))
        return GraphValidationReport(tuple(errors), tuple(warnings))

    def validate_or_raise(self, definition: MacroDefinition) -> None:
        self.validate(definition).raise_for_errors()

    @staticmethod
    def _reachable(
        edges: tuple[MacroEdge, ...],
        entry_node_id: str,
    ) -> set[str]:
        outgoing: dict[str, list[str]] = defaultdict(list)
        for edge in edges:
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

    def _validate_functions(
        self,
        definition: MacroDefinition,
    ) -> tuple[list[str], list[str]]:
        errors: list[str] = []
        warnings: list[str] = []
        counts = Counter(function.id for function in definition.functions)
        for function_id, count in counts.items():
            if count > 1:
                errors.append(f"duplicate function id: {function_id}")
        functions = {function.id: function for function in definition.functions}
        for function in definition.functions:
            errors.extend(self._function_signature_errors(function))
            nodes = {node.id: node for node in function.nodes}
            if nodes.get(function.entry_node_id) is None:
                errors.append(
                    f"function {function.id!r}: entry node does not exist"
                )
            elif nodes[function.entry_node_id].type != "function_entry":
                errors.append(
                    f"function {function.id!r}: entry_node_id must reference function_entry"
                )
            if nodes.get(function.return_node_id) is None:
                errors.append(
                    f"function {function.id!r}: return node does not exist"
                )
            elif nodes[function.return_node_id].type != "function_return":
                errors.append(
                    f"function {function.id!r}: return_node_id must reference function_return"
                )
            if sum(node.type == "function_entry" for node in function.nodes) != 1:
                errors.append(
                    f"function {function.id!r}: must contain exactly one function_entry"
                )
            if sum(node.type == "function_return" for node in function.nodes) != 1:
                errors.append(
                    f"function {function.id!r}: must contain exactly one function_return"
                )
            if function.entry_node_id in {
                edge.target for edge in function.edges
            }:
                errors.append(
                    f"function {function.id!r}: function_entry cannot have incoming edges"
                )
            subgraph = MacroDefinition(
                id=f"{definition.id}::function::{function.id}",
                name=function.name,
                version=definition.version,
                nodes=function.nodes,
                edges=function.edges,
                entry_node_id=function.entry_node_id,
                variables=definition.variables,
            )
            report = GraphValidator(self.registry).validate(subgraph)
            errors.extend(
                f"function {function.id!r}: {message}"
                for message in report.errors
                if "referenced function" not in message
            )
            warnings.extend(
                f"function {function.id!r}: {message}" for message in report.warnings
            )

        owners: dict[str, tuple] = {"<main>": definition.nodes}
        owners.update({function.id: function.nodes for function in definition.functions})
        graph: dict[str, set[str]] = {function.id: set() for function in definition.functions}
        for owner, nodes in owners.items():
            for node in nodes:
                if node.type != "call_function":
                    continue
                target = node.config.get("function_id")
                if not isinstance(target, str) or target not in functions:
                    errors.append(
                        f"{('macro' if owner == '<main>' else f'function {owner!r}')} "
                        f"node {node.id!r}: referenced function {target!r} does not exist"
                    )
                elif owner != "<main>":
                    graph[owner].add(target)
        cycle = _function_cycle(graph)
        if cycle:
            errors.append(
                "recursive function calls are not allowed: " + " -> ".join(cycle)
            )
        return errors, warnings

    @staticmethod
    def _validate_variables(definition: MacroDefinition) -> list[str]:
        errors: list[str] = []
        counts = Counter(variable.name for variable in definition.variables)
        duplicates = sorted(name for name, count in counts.items() if count > 1)
        if duplicates:
            errors.append("duplicate variable names: " + ", ".join(duplicates))
        variables = {variable.name: variable for variable in definition.variables}
        for variable in definition.variables:
            if variable.default is None:
                if variable.type != "element":
                    errors.append(
                        f"variable {variable.name!r}: default is required for {variable.type}"
                    )
            elif not default_matches_type(variable.default, variable.type):
                errors.append(
                    f"variable {variable.name!r}: default must match type {variable.type}"
                )
        for node in definition.nodes:
            if node.type not in {"set_variable", "get_variable"}:
                continue
            name = node.config.get("name")
            variable = variables.get(name) if isinstance(name, str) else None
            if variable is None:
                errors.append(
                    f"node {node.id!r}: referenced variable {name!r} does not exist"
                )
                continue
            if node.config.get("type") != variable.type:
                errors.append(
                    f"node {node.id!r}: variable port type must be {variable.type}"
                )
        return errors

    @staticmethod
    def _function_signature_errors(function: MacroFunctionDefinition) -> list[str]:
        errors: list[str] = []
        if not function.id:
            errors.append("function id must not be empty")
        if not function.name:
            errors.append(f"function {function.id!r}: name must not be empty")
        for kind, ports in (("input", function.inputs), ("output", function.outputs)):
            counts = Counter(port.id for port in ports)
            duplicates = sorted(port_id for port_id, count in counts.items() if count > 1)
            if duplicates:
                errors.append(
                    f"function {function.id!r}: duplicate {kind} ports: "
                    + ", ".join(duplicates)
                )
            for port in ports:
                if (
                    kind == "output"
                    and port.has_default
                    and not _function_default_matches_type(
                        port.default,
                        port.type,
                    )
                ):
                    errors.append(
                        f"function {function.id!r}: {kind} port {port.id!r} "
                        f"default must match type {port.type}"
                    )
        return errors


def _function_default_matches_type(value: object, port_type: str) -> bool:
    if port_type == "any":
        return True
    if value is None:
        return port_type in {"position", "rect", "element"}
    return default_matches_type(value, port_type)


def _function_cycle(graph: dict[str, set[str]]) -> tuple[str, ...]:
    visiting: set[str] = set()
    visited: set[str] = set()
    path: list[str] = []

    def visit(node: str) -> tuple[str, ...]:
        if node in visiting:
            start = path.index(node)
            return tuple((*path[start:], node))
        if node in visited:
            return ()
        visiting.add(node)
        path.append(node)
        for target in sorted(graph.get(node, ())):
            cycle = visit(target)
            if cycle:
                return cycle
        path.pop()
        visiting.remove(node)
        visited.add(node)
        return ()

    for node in sorted(graph):
        cycle = visit(node)
        if cycle:
            return cycle
    return ()
