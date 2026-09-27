"""User-facing diagnostic graph nodes."""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
import json

from tapbot.macro.graph_models import GraphExecutionContext, JsonObject, NodeResult


_LEVELS = frozenset({"debug", "info", "warning", "error"})


class DebugPrintNode:
    """Emit a structured user-debug record through the normal node trace."""

    output_handles = frozenset({"exec_out"})

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        errors: list[str] = []
        if not isinstance(config.get("message", ""), str):
            errors.append("message must be a string")
        if config.get("level", "info") not in _LEVELS:
            errors.append("level must be debug, info, warning, or error")
        return tuple(errors)

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        level = config.get("level", "info")
        assert isinstance(level, str)
        if "value" in context.input_values:
            message = _serialize(context.input_values["value"])
            source = "value"
        else:
            configured = config.get("message", "")
            assert isinstance(configured, str)
            message = configured
            source = "message"
        return NodeResult.success(
            {
                "user_debug": {
                    "level": level,
                    "message": message,
                    "source": source,
                }
            },
            next_handle="exec_out",
        )


def _serialize(value: object) -> str:
    if isinstance(value, str):
        return value
    if is_dataclass(value) and not isinstance(value, type):
        value = asdict(value)
    try:
        return json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )
    except (TypeError, ValueError):
        return str(value)
