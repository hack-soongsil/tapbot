"""Boolean condition nodes."""

from __future__ import annotations

from tapbot.macro.graph_models import GraphExecutionContext, JsonObject, NodeResult
from tapbot.macro.node_registry import collect_errors, required_text, selector_errors


class ElementExistsNode:
    output_handles = frozenset({"true", "false"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return selector_errors(config)

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        selector = config["selector"]
        assert isinstance(selector, dict)
        finder = _require_ui(context).find_element
        try:
            # Existence follows the selector exactly. A disabled element still exists
            # unless the graph explicitly includes enabled=true.
            element = finder(
                selector,
                strategy="first",
                require_enabled=False,
                require_visible=False,
            )
        except TypeError:
            element = finder(selector)
        context.last_resolved_element = element
        exists = element is not None
        return NodeResult.success(
            {"value": exists, "result": exists},
            next_handle="exec_out",
            data_outputs={"result": exists},
            fallback_handles=("true" if exists else "false",),
        )


class ElementTextEqualsNode:
    output_handles = frozenset({"true", "false"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return collect_errors(
            selector_errors(config),
            required_text(config, "text"),
        )

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        element = _find(context, config)
        context.last_resolved_element = element
        expected = config["text"]
        assert isinstance(expected, str)
        matches = element is not None and element.text == expected
        return NodeResult.success(
            {"value": matches, "actual": None if element is None else element.text},
            next_handle="true" if matches else "false",
        )


class StateEqualsNode:
    output_handles = frozenset({"true", "false"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        return required_text(config, "state")

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        ui = _require_ui(context)
        actual = ui.current_state()
        expected = config["state"]
        assert isinstance(expected, str)
        matches = actual == expected
        return NodeResult.success(
            {"value": matches, "actual": actual},
            next_handle="true" if matches else "false",
        )


def _find(context: GraphExecutionContext, config: JsonObject):
    selector = config["selector"]
    assert isinstance(selector, dict)
    return _require_ui(context).find_element(selector)


def _require_ui(context: GraphExecutionContext):
    if context.ui is None:
        raise RuntimeError("this node requires a UI-resolution port")
    return context.ui
