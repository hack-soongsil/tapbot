import pytest

from tapbot.macro import (
    EventEntryNodeIds,
    GraphValidationError,
    GraphValidator,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    ScreenDefinition,
    create_default_node_registry,
)
from tapbot.macro.ports import PortType, ports_for


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
    assert report.warnings == (
        "unreachable nodes: orphan",
        "nodes without exec connections: orphan",
    )


def test_validator_requires_exact_screen_event_entries_and_rejects_incoming_edges() -> None:
    graph = MacroDefinition(
        "screen", "Screen", 1,
        (
            MacroNode("enter", "screen_enter"),
            MacroNode("update", "screen_update", {"interval_ms": 1_000, "skip_if_running": True}),
            MacroNode("exit", "screen_exit"),
        ),
        (MacroEdge("bad", "exit", "enter"),),
        None,
        screen=ScreenDefinition("reservation_home", {"text": "예약"}),
        event_entry_node_ids=EventEntryNodeIds("enter", "update", "exit"),
    )

    report = GraphValidator(create_default_node_registry()).validate(graph)

    assert any("cannot have incoming edges" in error for error in report.errors)


@pytest.mark.parametrize(
    ("element_id", "params", "expected"),
    (
        ("time_slot", {}, "params.index must be a non-negative integer"),
        ("room_card_by_name", {"name": ""}, "params.name must be a non-empty string"),
    ),
)
def test_find_screen_element_validates_manifest_required_params(
    element_id: str,
    params: dict[str, object],
    expected: str,
) -> None:
    screen_id = (
        "study_room_detail" if element_id == "time_slot" else "study_room_list"
    )
    graph = definition((MacroNode("one", "find_screen_element", {
        "screen_id": screen_id,
        "element_id": element_id,
        "params": params,
    }),))

    report = GraphValidator(create_default_node_registry()).validate(graph)

    assert any(expected in error for error in report.errors)


def test_find_screen_element_ports_follow_the_selected_parameter_schema() -> None:
    indexed = ports_for("find_screen_element", {
        "screen_id": "study_room_detail",
        "element_id": "time_slot",
    })
    named = ports_for("find_screen_element", {
        "screen_id": "study_room_list",
        "element_id": "room_card_by_name",
    })
    plain = ports_for("find_screen_element", {
        "screen_id": "study_room_detail",
        "element_id": "reserve_cta",
    })

    assert indexed.inputs == {"exec_in": PortType.EXEC, "index": PortType.INT}
    assert named.inputs == {"exec_in": PortType.EXEC, "name": PortType.STRING}
    assert plain.inputs == {"exec_in": PortType.EXEC}


_EMPTY_CLICK_SELECTOR = {
    "text": "",
    "ui_tree_path": None,
    "clickable": True,
    "enabled": True,
    "visible_to_user": True,
}


def test_click_element_accepts_connected_element_with_empty_selector() -> None:
    graph = definition(
        (
            MacroNode("one", "find_element", {"selector": {"text": "예약"}}),
            MacroNode("click", "click_element", {"selector": _EMPTY_CLICK_SELECTOR}),
        ),
        (
            MacroEdge(
                "exec", "one", "click", source_handle="exec_out",
                target_handle="exec_in", kind="exec",
            ),
            MacroEdge(
                "element", "one", "click", source_handle="element",
                target_handle="element", kind="data",
            ),
        ),
    )

    report = GraphValidator(create_default_node_registry()).validate(graph)

    assert report.valid is True


def test_click_element_still_rejects_malformed_selector_when_element_is_connected() -> None:
    graph = definition(
        (
            MacroNode("one", "find_element", {"selector": {"text": "예약"}}),
            MacroNode("click", "click_element", {"selector": {"text": 7}}),
        ),
        (MacroEdge(
            "element", "one", "click", source_handle="element",
            target_handle="element", kind="data",
        ),),
    )

    report = GraphValidator(create_default_node_registry()).validate(graph)

    assert report.valid is False
    assert "node 'click': selector.text must be a string" in report.errors
    assert not any("requires element input or selector fallback" in error for error in report.errors)


@pytest.mark.parametrize("selector", (
    {"text": "예약"},
    {"semantic_id": "reserve_cta"},
))
def test_click_element_accepts_usable_selector_fallback_without_element_input(
    selector: dict[str, object],
) -> None:
    graph = definition((MacroNode("one", "click_element", {"selector": selector}),))

    report = GraphValidator(create_default_node_registry()).validate(graph)

    assert report.valid is True


def test_click_element_requires_input_or_usable_selector_fallback() -> None:
    graph = definition((MacroNode(
        "one", "click_element", {"selector": _EMPTY_CLICK_SELECTOR},
    ),))

    report = GraphValidator(create_default_node_registry()).validate(graph)

    assert report.valid is False
    assert report.errors == (
        "node 'one': click_element requires element input or selector fallback",
    )


def test_find_screen_element_to_click_element_graph_is_valid() -> None:
    graph = definition(
        (
            MacroNode("one", "find_screen_element", {
                "screen_id": "study_room_detail",
                "element_id": "reserve_cta",
                "params": {},
            }),
            MacroNode("click", "click_element", {"selector": _EMPTY_CLICK_SELECTOR}),
        ),
        (
            MacroEdge(
                "exec", "one", "click", source_handle="exec_out",
                target_handle="exec_in", kind="exec",
            ),
            MacroEdge(
                "element", "one", "click", source_handle="element",
                target_handle="element", kind="data",
            ),
        ),
    )

    report = GraphValidator(create_default_node_registry()).validate(graph)

    assert report.valid is True
