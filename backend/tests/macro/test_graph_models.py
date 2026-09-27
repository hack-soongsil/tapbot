import json

import pytest

from tapbot.macro import (
    EventEntryNodeIds,
    FileMacroDefinitionStore,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    NodePosition,
)


def test_macro_definition_json_round_trip_preserves_editor_metadata() -> None:
    definition = MacroDefinition(
        id="login",
        name="Login flow",
        version=3,
        nodes=(
            MacroNode(
                "tap",
                "tap_point",
                {"x": 10, "y": 20},
                NodePosition(125.5, 80),
                "Tap login",
            ),
        ),
        edges=(),
        entry_node_id="tap",
        metadata={"owner": "qa"},
    )

    restored = MacroDefinition.from_json(definition.to_json())

    assert restored == definition
    assert restored.nodes[0].position == NodePosition(125.5, 80)
    assert json.loads(restored.to_json())["nodes"][0]["label"] == "Tap login"


def test_snapshot_detaches_mutable_node_config() -> None:
    config = {"x": 10, "y": 20}
    definition = MacroDefinition(
        "id",
        "name",
        1,
        (MacroNode("tap", "tap_point", config),),
        (),
        "tap",
    )

    snapshot = definition.snapshot()
    config["x"] = 999

    assert snapshot.nodes[0].config["x"] == 10


def test_schema_parser_rejects_non_json_config() -> None:
    with pytest.raises(ValueError, match="JSON-compatible"):
        MacroDefinition.from_dict(
            {
                "id": "bad",
                "name": "Bad",
                "version": 1,
                "entry_node_id": "one",
                "nodes": [{"id": "one", "type": "wait", "config": {"x": {1}}}],
                "edges": [],
            }
        )


def test_edge_optional_fields_round_trip() -> None:
    edge = MacroEdge("yes", "branch", "tap", "true", "success")

    assert MacroEdge.from_dict(edge.to_dict()) == edge


def test_typed_data_edge_round_trip_preserves_target_handle_and_kind() -> None:
    edge = MacroEdge(
        "index",
        "for",
        "click",
        source_handle="index",
        target_handle="index",
        kind="data",
    )

    assert MacroEdge.from_dict(edge.to_dict()) == edge
    assert edge.to_dict()["kind"] == "data"


def test_legacy_entry_is_exposed_as_screen_enter_compatibility_entry() -> None:
    definition = MacroDefinition.from_dict({
        "id": "legacy",
        "name": "Legacy",
        "version": 1,
        "entry_node_id": "start",
        "nodes": [{"id": "start", "type": "stop", "config": {}}],
        "edges": [],
    })

    assert definition.entry_for("enter") == "start"
    assert definition.event_entry_node_ids == EventEntryNodeIds(enter="start")
    assert definition.entry_for("update") is None


def test_global_screen_events_migrate_to_screen_scoped_entries_on_save() -> None:
    definition = MacroDefinition.from_dict({
        "id": "legacy-screen",
        "name": "Legacy screen",
        "version": 1,
        "screen": {"id": "reservation_home", "match": {}},
        "event_entry_node_ids": {
            "enter": "enter", "update": "update", "exit": "exit",
        },
        "nodes": [
            {"id": "enter", "type": "screen_enter", "config": {}},
            {"id": "update", "type": "screen_update", "config": {
                "interval_ms": 1000, "skip_if_running": True,
            }},
            {"id": "exit", "type": "screen_exit", "config": {}},
        ],
        "edges": [],
    })

    assert definition.entry_for("enter", screen_id="reservation_home") == "enter"
    assert definition.nodes[0].config == {
        "screen_id": "reservation_home", "event": "enter",
    }
    saved = definition.to_dict()
    assert saved["screen_event_entry_node_ids"] == {
        "reservation_home": {
            "enter": "enter", "update": "update", "exit": "exit",
        }
    }
    assert "event_entry_node_ids" not in saved
    assert "screen" not in saved


def test_legacy_click_screen_element_migrates_to_find_and_click_pair() -> None:
    definition = MacroDefinition.from_dict({
        "id": "legacy-semantic",
        "name": "Legacy semantic click",
        "version": 1,
        "entry_node_id": "semantic",
        "nodes": [
            {
                "id": "semantic",
                "type": "click_screen_element",
                "config": {
                    "screen_id": "reservation_detail",
                    "element_id": "time_slot",
                    "params": {"index": 2},
                    "click": {"mode": "normal", "duration_ms": 90},
                },
                "position": {"x": 100, "y": 200},
            },
            {"id": "done", "type": "stop", "config": {}},
        ],
        "edges": [{
            "id": "next", "source": "semantic", "target": "done",
            "source_handle": "exec_out", "target_handle": "exec_in", "kind": "exec",
        }],
    })

    assert [(node.id, node.type) for node in definition.nodes] == [
        ("semantic", "find_screen_element"),
        ("semantic-click", "click_element"),
        ("done", "stop"),
    ]
    assert definition.nodes[0].config == {
        "screen_id": "reservation_detail",
        "element_id": "time_slot",
        "params": {"index": 2},
    }
    assert definition.nodes[1].config == {
        "sampling_mode": "normal",
        "click": {"duration_ms": 90},
    }
    assert next(edge for edge in definition.edges if edge.id == "next").source == "semantic-click"
    assert any(
        edge.source == "semantic" and edge.target == "semantic-click"
        and edge.source_handle == "element" and edge.target_handle == "element"
        and edge.kind == "data"
        for edge in definition.edges
    )
    assert all(node.type != "click_screen_element" for node in definition.nodes)


def test_file_store_uses_injected_root_and_rejects_path_traversal(tmp_path) -> None:
    definition = MacroDefinition(
        "saved-macro",
        "Saved macro",
        1,
        (MacroNode("wait", "wait", {"duration_ms": 0}),),
        (),
        "wait",
    )
    store = FileMacroDefinitionStore(tmp_path)

    path = store.save(definition)

    assert path == tmp_path / "saved-macro.json"
    assert store.load("saved-macro") == definition
    assert store.list() == (definition,)
    with pytest.raises(ValueError, match="not safe"):
        store.load("../outside")
    assert store.delete("saved-macro") is True
    assert store.delete("saved-macro") is False
