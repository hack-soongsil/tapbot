"""Registry-based dispatch for graph node handlers."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Protocol

from tapbot.macro.graph_models import (
    GraphExecutionContext,
    JsonObject,
    NodeResult,
)
from tapbot.macro.tap_point import TapPointSampler
from tapbot.macro.area_sampling import AreaPointSampler


class NodeHandler(Protocol):
    output_handles: frozenset[str]

    def validate(self, config: JsonObject) -> tuple[str, ...]: ...

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult: ...


class NodeRegistry:
    def __init__(
        self,
        handlers: Mapping[str, NodeHandler] | None = None,
    ) -> None:
        self._handlers: dict[str, NodeHandler] = {}
        for node_type, handler in (handlers or {}).items():
            self.register(node_type, handler)

    @property
    def node_types(self) -> frozenset[str]:
        return frozenset(self._handlers)

    def register(self, node_type: str, handler: NodeHandler) -> None:
        if not node_type:
            raise ValueError("node type must not be empty")
        if node_type in self._handlers:
            raise ValueError(f"node type {node_type!r} is already registered")
        self._handlers[node_type] = handler

    def get(self, node_type: str) -> NodeHandler:
        try:
            return self._handlers[node_type]
        except KeyError as error:
            raise KeyError(f"unsupported node type: {node_type}") from error


def create_default_node_registry(
    *,
    tap_point_sampler: TapPointSampler | None = None,
    area_point_sampler: AreaPointSampler | None = None,
) -> NodeRegistry:
    from tapbot.macro.nodes.action import (
        BackNode,
        HomeNode,
        SwipeNode,
        TapElementNode,
        TapPointNode,
        WaitNode,
        ClickPointNode,
        DragPointNode,
        RandomClickAreaNode,
        RandomDragAreaNode,
        ClickElementNode,
    )
    from tapbot.macro.nodes.condition import (
        ElementExistsNode,
        ElementTextEqualsNode,
        StateEqualsNode,
    )
    from tapbot.macro.nodes.control import (
        BranchNode,
        RepeatNode,
        RetryNode,
        StopNode,
        TimeoutNode,
        ForLoopNode,
        SequenceNode,
    )
    from tapbot.macro.nodes.ui import (
        FindElementNode,
        FindScreenElementNode,
        ReadUiTreeNode,
        RequireElementNode,
    )
    from tapbot.macro.nodes.validation import (
        AssertElementNode,
        WaitForElementNode,
        WaitForStateNode,
    )
    from tapbot.macro.nodes.event import ScreenEventNode
    from tapbot.macro.nodes.debug import DebugPrintNode
    from tapbot.macro.nodes.function import (
        CallFunctionNode,
        FunctionEntryNode,
        FunctionReturnNode,
    )
    from tapbot.macro.nodes.variable import GetVariableNode, SetVariableNode

    sampler = (
        tap_point_sampler
        if tap_point_sampler is not None
        else TapPointSampler()
    )
    area_sampler = area_point_sampler or AreaPointSampler()
    return NodeRegistry(
        {
            "screen_enter": ScreenEventNode("enter"),
            "screen_update": ScreenEventNode("update"),
            "screen_exit": ScreenEventNode("exit"),
            "debug_print": DebugPrintNode(),
            "function_entry": FunctionEntryNode(),
            "function_return": FunctionReturnNode(),
            "call_function": CallFunctionNode(),
            "set_variable": SetVariableNode(),
            "get_variable": GetVariableNode(),
            "click_point": ClickPointNode(),
            "drag_point": DragPointNode(),
            "random_click_area": RandomClickAreaNode(area_sampler),
            "random_drag_area": RandomDragAreaNode(area_sampler),
            "click_element": ClickElementNode(area_sampler),
            "find_screen_element": FindScreenElementNode(),
            "tap_element": TapElementNode(sampler),
            "tap_point": TapPointNode(),
            "swipe": SwipeNode(),
            "back": BackNode(),
            "home": HomeNode(),
            "wait": WaitNode(),
            "find_element": FindElementNode(),
            "require_element": RequireElementNode(),
            "read_ui_tree": ReadUiTreeNode(),
            "element_exists": ElementExistsNode(),
            "element_text_equals": ElementTextEqualsNode(),
            "state_equals": StateEqualsNode(),
            "branch": BranchNode(),
            "for_loop": ForLoopNode(),
            "sequence": SequenceNode(),
            "retry": RetryNode(),
            "repeat": RepeatNode(),
            "timeout": TimeoutNode(),
            "stop": StopNode(),
            "wait_for_element": WaitForElementNode(),
            "wait_for_state": WaitForStateNode(),
            "assert_element": AssertElementNode(),
        }
    )


def required_text(config: JsonObject, key: str) -> tuple[str, ...]:
    value = config.get(key)
    if not isinstance(value, str) or not value.strip():
        return (f"{key} must be a non-empty string",)
    return ()


def optional_positive_int(
    config: JsonObject,
    key: str,
    *,
    default: int,
    allow_zero: bool = False,
) -> tuple[str, ...]:
    value = config.get(key, default)
    minimum = 0 if allow_zero else 1
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        return (f"{key} must be an integer >= {minimum}",)
    return ()


def required_number(config: JsonObject, key: str) -> tuple[str, ...]:
    value = config.get(key)
    if isinstance(value, bool) or not isinstance(value, int | float):
        return (f"{key} must be a number",)
    return ()


def selector_errors(config: JsonObject) -> tuple[str, ...]:
    selector = config.get("selector")
    if not isinstance(selector, dict) or not selector:
        return ("selector must be a non-empty object",)
    return selector_format_errors(selector)


_STABLE_SELECTOR_FIELDS = (
    "text",
    "text_contains",
    "text_regex",
    "content_description",
    "content_description_regex",
    "view_id",
    "class_name",
    "semantic_id",
    "semantic_family",
)

_OPTIONAL_SELECTOR_STRING_FIELDS = (
    *_STABLE_SELECTOR_FIELDS,
    "bounds_region",
    "ui_tree_path",
)

_OPTIONAL_SELECTOR_BOOLEAN_FIELDS = (
    "clickable",
    "enabled",
    "visible_to_user",
)


def selector_format_errors(value: object) -> tuple[str, ...]:
    """Validate selector field types without requiring a usable fallback."""

    if not isinstance(value, dict):
        return ("selector must be an object",)
    errors: list[str] = []
    for key in _OPTIONAL_SELECTOR_STRING_FIELDS:
        field = value.get(key)
        if field is not None and not isinstance(field, str):
            errors.append(f"selector.{key} must be a string")
    for key in _OPTIONAL_SELECTOR_BOOLEAN_FIELDS:
        field = value.get(key)
        if field is not None and not isinstance(field, bool):
            errors.append(f"selector.{key} must be a boolean")
    index = value.get("index")
    if index is not None and (
        isinstance(index, bool) or not isinstance(index, int) or index < 0
    ):
        errors.append("selector.index must be a non-negative integer")
    return tuple(errors)


def has_stable_selector(value: object) -> bool:
    """Return whether a selector can identify an element without a data input."""

    return isinstance(value, dict) and any(
        isinstance(value.get(key), str) and bool(value[key].strip())
        for key in _STABLE_SELECTOR_FIELDS
    )


def collect_errors(*groups: Iterable[str]) -> tuple[str, ...]:
    return tuple(error for group in groups for error in group)
