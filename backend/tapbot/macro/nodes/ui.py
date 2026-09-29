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
from tapbot.macro.errors import MacroExecutionError
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
            return NodeResult.success(
                {"found": False},
                next_handle="exec_out",
                data_outputs={"found": False, "result": False},
                fallback_handles=("missing",),
            )
        context.last_resolved_element = element
        return NodeResult.success(
            _element_output(element),
            next_handle="exec_out",
            data_outputs={"found": True, "result": True, "element": element},
            fallback_handles=("found",),
        )


class FindScreenElementNode:
    output_handles = frozenset({"exec_out"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        from tapbot.ui_resolution.screens import validate_screen_element_reference

        params = config.get("params", {})
        if not isinstance(params, dict):
            return ("params must be an object",)
        return tuple(
            error for error in validate_screen_element_reference(
                config.get("screen_id"),
                config.get("element_id"),
                params,
            )
            if not error.startswith(("params.index", "params.name"))
        )

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        ui = _require_ui(context)
        resolver = getattr(ui, "resolve_screen_element", None)
        if not callable(resolver):
            raise RuntimeError("UI port does not support semantic screen elements")
        screen_id = config.get("screen_id")
        element_id = config.get("element_id")
        assert isinstance(screen_id, str) and isinstance(element_id, str)
        params_value = config.get("params", {})
        assert isinstance(params_value, dict)
        params = dict(params_value)
        if "index" in context.input_values:
            index = context.input_values["index"]
            if isinstance(index, bool) or not isinstance(index, int) or index < 0:
                raise MacroExecutionError(
                    "screen element index data input must be a non-negative int",
                    code="PORT_TYPE_MISMATCH",
                    port="index",
                    expected="non-negative int",
                    value=index,
                    hint="index 입력에 0 이상의 정수를 연결하세요.",
                )
            params["index"] = index
        if "name" in context.input_values:
            name = context.input_values["name"]
            if not isinstance(name, str) or not name.strip():
                raise MacroExecutionError(
                    "screen element name data input must be a non-empty string",
                    code="INPUT_TYPE_MISMATCH",
                    port="name",
                    expected="non-empty string",
                    value=name,
                    hint="name 입력에 찾을 엘리먼트의 이름이나 시각을 연결하세요.",
                )
            params["name"] = name.strip()
        try:
            element = resolver(screen_id, element_id, params)
        except RuntimeError as error:
            context.last_resolved_element = None
            message = str(error)
            if config.get("required") is True:
                mismatch = message.startswith("screen mismatch:")
                default_code = "SCREEN_MISMATCH" if mismatch else "ELEMENT_NOT_FOUND"
                configured_code = config.get(
                    "screen_mismatch_code" if mismatch else "missing_error_code",
                    default_code,
                )
                code = configured_code if isinstance(configured_code, str) else default_code
                raise MacroExecutionError(
                    "현재 화면이 예상과 다릅니다."
                    if mismatch else "화면에서 필요한 엘리먼트를 찾을 수 없습니다.",
                    code=code,
                    port="element",
                    expected=f"{screen_id}/{element_id}",
                    actual="screen mismatch" if mismatch else "missing",
                    hint=(
                        "이전 화면 전환이 완료되었는지 확인하세요."
                        if mismatch else "입력값과 현재 화면의 엘리먼트 상태를 확인하세요."
                    ),
                    details={
                        "screen_id": screen_id,
                        "element_id": element_id,
                        "params": params,
                    },
                ) from error
            return NodeResult.success(
                {"found": False, "reason": message},
                next_handle="exec_out",
                data_outputs={"found": False},
            )
        context.last_resolved_element = element
        return NodeResult.success(
            {
                **_element_output(element),
                "screen_id": screen_id,
                "semantic_element_id": element_id,
            },
            next_handle="exec_out",
            data_outputs={"found": True, "element": element},
        )


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
        "metadata": dict(element.metadata),
    }


def _tree_size(tree: object) -> int | None:
    nodes = getattr(tree, "nodes", None)
    if isinstance(nodes, Sized):
        return len(nodes)
    if isinstance(tree, Sized) and not isinstance(tree, str | bytes):
        return len(tree)
    return None
