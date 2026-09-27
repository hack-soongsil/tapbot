"""UI observation and resolution nodes."""

from __future__ import annotations

from collections.abc import Sized

from tapbot.macro.graph_models import (
    GraphElement,
    GraphExecutionContext,
    JsonObject,
    NodeResult,
    NodeStatus,
)
from tapbot.macro.node_registry import selector_errors


class FindElementNode:
    output_handles = frozenset({"found", "missing"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return selector_errors(config)

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        element = _find(context, config)
        if element is None:
            context.last_resolved_element = None
            return NodeResult.success({"found": False}, next_handle="missing")
        context.last_resolved_element = element
        return NodeResult.success(_element_output(element), next_handle="found")


class RequireElementNode:
    output_handles = frozenset({"found", "missing"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return selector_errors(config)

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        element = _find(context, config)
        if element is None:
            context.last_resolved_element = None
            return NodeResult(
                status=NodeStatus.FAILURE,
                output={"found": False},
                next_handle="missing",
                error="required element was not found",
            )
        context.last_resolved_element = element
        return NodeResult.success(_element_output(element), next_handle="found")


class ReadUiTreeNode:
    output_handles = frozenset()

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return ()

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        del config
        ui = _require_ui(context)
        tree = ui.read_ui_tree()
        context.last_observation = tree
        count = _tree_size(tree)
        return NodeResult.success(
            {"available": tree is not None, "node_count": count}
        )


def _find(
    context: GraphExecutionContext,
    config: JsonObject,
) -> GraphElement | None:
    selector = config["selector"]
    assert isinstance(selector, dict)
    return _require_ui(context).find_element(selector)


def _require_ui(context: GraphExecutionContext):
    if context.ui is None:
        raise RuntimeError("this node requires a UI-resolution port")
    return context.ui


def _element_output(element: GraphElement) -> JsonObject:
    return {
        "found": True,
        "element_id": element.id,
        "bounds": element.bounds.to_list(),
        "text": element.text,
    }


def _tree_size(tree: object) -> int | None:
    nodes = getattr(tree, "nodes", None)
    if isinstance(nodes, Sized):
        return len(nodes)
    if isinstance(tree, Sized) and not isinstance(tree, str | bytes):
        return len(tree)
    return None
