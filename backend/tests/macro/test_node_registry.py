import pytest

from tapbot.macro import (
    GraphExecutionContext,
    NodeRegistry,
    NodeResult,
    create_default_node_registry,
)


class Handler:
    output_handles = frozenset()

    def validate(self, config):
        return ()

    def execute(self, context: GraphExecutionContext, config):
        return NodeResult.success()


def test_registry_dispatches_without_engine_type_branching() -> None:
    handler = Handler()
    registry = NodeRegistry({"custom": handler})

    assert registry.get("custom") is handler
    assert registry.node_types == frozenset({"custom"})


def test_registry_rejects_duplicates_and_unknown_types() -> None:
    registry = NodeRegistry({"custom": Handler()})

    with pytest.raises(ValueError, match="already registered"):
        registry.register("custom", Handler())
    with pytest.raises(KeyError, match="unsupported"):
        registry.get("missing")


def test_default_registry_contains_initial_node_scope() -> None:
    registry = create_default_node_registry()

    assert registry.node_types == frozenset(
        {
            "screen_enter", "screen_update", "screen_exit",
            "function_entry", "function_return", "call_function",
            "set_variable", "get_variable",
            "debug_print",
            "click_point", "drag_point", "random_click_area", "random_drag_area",
            "click_element", "find_screen_element", "for_loop", "sequence",
            "tap_element", "tap_point", "swipe", "back", "home", "wait",
            "find_element", "require_element", "read_ui_tree",
            "element_exists", "element_text_equals", "state_equals",
            "branch", "retry", "repeat", "timeout", "stop",
            "wait_for_element", "wait_for_state", "assert_element",
        }
    )
