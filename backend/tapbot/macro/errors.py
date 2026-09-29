"""Structured, UI-facing macro runtime diagnostics."""

from __future__ import annotations

from typing import NotRequired, TypedDict

from tapbot.macro.graph_models import GraphElement, JsonObject


_MISSING = object()


class RuntimeErrorPayload(TypedDict):
    """Stable error contract consumed by the runtime inspector and trace UI."""

    code: str
    message: str
    graph_path: list[str]
    screen_id: str | None
    node_id: str
    node_type: str
    node_label: str
    port_id: str | None
    expected_type: str | None
    actual_type: str | None
    input_values: JsonObject
    config: JsonObject
    details: JsonObject
    hint: str | None
    summary: NotRequired[str]


_CODE_ALIASES = {
    "PORT_TYPE_MISMATCH": "INPUT_TYPE_MISMATCH",
    "ELEMENT_INPUT_MISSING": "REQUIRED_INPUT_MISSING",
    "FUNCTION_INPUT_MISSING": "REQUIRED_INPUT_MISSING",
    "FUNCTION_OUTPUT_REQUIRED": "FUNCTION_RETURN_INVALID",
}


def canonical_error_code(code: str) -> str:
    return _CODE_ALIASES.get(code, code)


def is_sensitive_name(name: str) -> bool:
    return any(part in name.lower() for part in ("token", "secret", "password", "authorization"))


def runtime_value_type(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, GraphElement):
        return "element"
    return {str: "string", dict: "object", list: "array"}.get(type(value), type(value).__name__)


def runtime_error_payload(
    *,
    code: str,
    message: str,
    graph_path: list[str],
    screen_id: str | None,
    node_id: str,
    node_type: str,
    node_label: str,
    input_values: JsonObject,
    config: JsonObject,
    port_id: str | None = None,
    expected_type: str | None = None,
    actual_type: str | None = None,
    details: JsonObject | None = None,
    hint: str | None = None,
) -> RuntimeErrorPayload:
    """Build the complete public payload; internal exception text is excluded."""

    return {
        "code": canonical_error_code(code),
        "message": message,
        "graph_path": graph_path,
        "screen_id": screen_id,
        "node_id": node_id,
        "node_type": node_type,
        "node_label": node_label,
        "port_id": port_id,
        "expected_type": expected_type,
        "actual_type": actual_type,
        "input_values": input_values,
        "config": config,
        "details": details or {},
        "hint": hint,
        "summary": message,
    }


class MacroExecutionError(RuntimeError):
    """Expected execution failure with a safe, user-facing diagnostic."""

    def __init__(
        self, message: str, *, code: str, hint: str,
        summary: str | None = None, port: str | None = None,
        expected: str | None = None, actual: str | None = None,
        value: object = _MISSING, sensitive: bool = False,
        details: JsonObject | None = None,
    ) -> None:
        super().__init__(message)
        public_message = summary or message
        actual_type = (
            runtime_value_type(value)
            if value is not _MISSING
            else actual
        )
        self.payload: dict[str, object] = {
            "code": canonical_error_code(code),
            "message": public_message,
            "summary": public_message,
            "hint": hint,
            "port_id": port,
            "expected_type": expected,
            "actual_type": actual_type,
            "details": details or {},
            # Compatibility aliases for traces created before the v1 contract.
            "port": port,
            "expected": expected,
            "actual": actual if actual is not None else actual_type,
        }
        if value is not _MISSING:
            visible_value = "<redacted>" if sensitive or is_sensitive_name(port or "") else value
            self.payload.update({"actual_value": visible_value})
            if port:
                self.payload["input_values"] = {port: visible_value}
                self.payload["inputs"] = {port: visible_value}
            if isinstance(value, GraphElement):
                metadata: JsonObject = dict(value.metadata)
                self.payload["element"] = {
                    "element_id": value.id,
                    "semantic_id": value.metadata.get("semantic_id", value.id),
                    "index": value.metadata.get("index"),
                    "bounds": value.bounds.to_list(),
                    "metadata": metadata,
                }
