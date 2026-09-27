from tapbot.macro import (
    GraphEngine,
    GraphExecutionContext,
    GraphRuntimeStatus,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    create_default_node_registry,
)


class ExistingUi:
    def find_element(self, selector, **_options):
        return object() if selector.get("text") == "ready" else None


def test_debug_print_uses_configured_message_without_data_input() -> None:
    definition = MacroDefinition(
        "debug",
        "Debug",
        1,
        (MacroNode("print", "debug_print", {"message": "hello", "level": "warning"}),),
        (),
        "print",
    )

    result = GraphEngine(create_default_node_registry()).run(definition)

    assert result.runtime.state is GraphRuntimeStatus.COMPLETED
    assert result.traces[0].output_summary["user_debug"] == {
        "level": "warning",
        "message": "hello",
        "source": "message",
    }
    assert result.runtime.variables == {}


def test_debug_print_serializes_connected_typed_value_instead_of_message() -> None:
    definition = MacroDefinition(
        "wired-debug",
        "Wired debug",
        1,
        (
            MacroNode("exists", "element_exists", {"selector": {"text": "ready"}}),
            MacroNode("print", "debug_print", {"message": "fallback", "level": "info"}),
        ),
        (
            MacroEdge(
                "exec",
                "exists",
                "print",
                source_handle="exec_out",
                target_handle="exec_in",
                kind="exec",
            ),
            MacroEdge(
                "value",
                "exists",
                "print",
                source_handle="result",
                target_handle="value",
                kind="data",
            ),
        ),
        "exists",
    )

    result = GraphEngine(create_default_node_registry()).run(
        definition,
        context=GraphExecutionContext(ui=ExistingUi()),  # type: ignore[arg-type]
    )

    assert result.runtime.state is GraphRuntimeStatus.COMPLETED
    assert result.traces[-1].output_summary["user_debug"] == {
        "level": "info",
        "message": "true",
        "source": "value",
    }


def test_debug_print_rejects_unknown_level() -> None:
    report = GraphEngine(create_default_node_registry()).validator.validate(
        MacroDefinition(
            "bad-debug",
            "Bad debug",
            1,
            (MacroNode("print", "debug_print", {"message": "x", "level": "fatal"}),),
            (),
            "print",
        )
    )

    assert "level must be debug, info, warning, or error" in report.errors[0]
