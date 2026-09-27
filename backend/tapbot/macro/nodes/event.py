"""Screen lifecycle graph entry nodes."""

from __future__ import annotations

from tapbot.macro.graph_models import GraphExecutionContext, JsonObject, NodeResult
from tapbot.macro.node_registry import optional_positive_int


class ScreenEventNode:
    """A marker entry node; its outgoing edge starts the event handler graph."""

    output_handles = frozenset({"exec_out"})

    def __init__(self, kind: str) -> None:
        self.kind = kind

    def validate(self, config: JsonObject) -> tuple[str, ...]:
        if self.kind == "update":
            errors = list(optional_positive_int(config, "interval_ms", default=1_000))
            if config.get("skip_if_running", True) is not True:
                errors.append("skip_if_running must be true")
            return tuple(errors)
        return ()

    def execute(
        self,
        context: GraphExecutionContext,
        config: JsonObject,
    ) -> NodeResult:
        return NodeResult.success(
            {"screen_event": self.kind},
            next_handle="exec_out",
        )
