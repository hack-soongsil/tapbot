import pytest

from tapbot.macro import (
    GraphValidationError,
    GraphValidator,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    create_default_node_registry,
)


def definition(
    nodes: tuple[MacroNode, ...],
    edges: tuple[MacroEdge, ...] = (),
    *,
    entry: str = "one",
) -> MacroDefinition:
    return MacroDefinition("graph", "Graph", 1, nodes, edges, entry)


def test_validator_rejects_duplicate_nodes_and_missing_entry() -> None:
    validator = GraphValidator(create_default_node_registry())
    graph = definition(
        (
            MacroNode("one", "wait", {"duration_ms": 0}),
            MacroNode("one", "stop"),
        ),
        entry="missing",
    )

    report = validator.validate(graph)

    assert report.valid is False
    assert any("duplicate node ids" in error for error in report.errors)
    assert "entry node does not exist" in report.errors


def test_validator_rejects_unsupported_type_invalid_config_and_dangling_edge() -> None:
    validator = GraphValidator(create_default_node_registry())
    graph = definition(
        (
            MacroNode("one", "tap_point", {"x": 1}),
            MacroNode("unknown", "launch_missiles"),
        ),
        (MacroEdge("edge", "one", "missing"),),
    )

    with pytest.raises(GraphValidationError) as caught:
        validator.validate_or_raise(graph)

    message = str(caught.value)
    assert "y must be a number" in message
    assert "unsupported type" in message
    assert "target 'missing' does not exist" in message


def test_validator_checks_branch_handles_and_ambiguous_routes() -> None:
    validator = GraphValidator(create_default_node_registry())
    graph = definition(
        (
            MacroNode("one", "branch", {"variable": "ready"}),
            MacroNode("yes", "stop"),
            MacroNode("no", "stop"),
        ),
        (
            MacroEdge("bad", "one", "yes", "maybe"),
            MacroEdge("first", "one", "yes", "true"),
            MacroEdge("second", "one", "no", "true"),
        ),
    )

    report = validator.validate(graph)

    assert any("invalid source handle 'maybe'" in error for error in report.errors)
    assert any("ambiguous outgoing edges" in error for error in report.errors)


def test_validator_warns_about_unreachable_nodes_without_rejecting_graph() -> None:
    validator = GraphValidator(create_default_node_registry())
    graph = definition(
        (
            MacroNode("one", "stop"),
            MacroNode("orphan", "stop"),
        )
    )

    report = validator.validate(graph)

    assert report.valid is True
    assert report.warnings == ("unreachable nodes: orphan",)
