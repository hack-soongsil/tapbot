import json

import pytest

from tapbot.macro import (
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
