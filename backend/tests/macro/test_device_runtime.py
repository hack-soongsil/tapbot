from __future__ import annotations

from pathlib import Path

from tapbot.macro.binding import DeviceMacroBinding, DeviceMacroBindingRepository
from tapbot.macro.graph_engine import GraphEngine
from tapbot.macro.graph_models import (
    GraphExecutionContext,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    NodeResult,
)
from tapbot.macro.graph_store import FileMacroDefinitionStore
from tapbot.macro.graph_validator import GraphValidator
from tapbot.macro.node_registry import NodeRegistry
from tapbot.macro.repository import MacroRepository
from tapbot.macro.runtime_manager import DeviceRuntimeStatus, RuntimeManager


class RecordDevice:
    output_handles = frozenset()

    def validate(self, config):
        return ()

    def execute(self, context, config):
        context.variables[config["key"]] = context.device_id
        return NodeResult.success()


def definition(version: int = 1) -> MacroDefinition:
    return MacroDefinition(
        id="shared",
        name="Shared",
        version=version,
        nodes=(
            MacroNode("first", "record", {"key": "first"}),
            MacroNode("second", "record", {"key": "second"}),
        ),
        edges=(MacroEdge("next", "first", "second"),),
        entry_node_id="first",
    )


def setup(tmp_path: Path):
    registry = NodeRegistry({"record": RecordDevice()})
    validator = GraphValidator(registry)
    repository = MacroRepository(
        FileMacroDefinitionStore(tmp_path / "macros", validator=validator)
    )
    repository.create(definition())
    bindings = DeviceMacroBindingRepository(tmp_path / "bindings.json")
    for device_id in ("a", "b"):
        bindings.set(DeviceMacroBinding(device_id, "shared"))
    manager = RuntimeManager(
        repository,
        bindings,
        engine_factory=lambda _device_id: GraphEngine(registry),
        context_factory=lambda device_id, _binding: GraphExecutionContext(
            device_id=device_id
        ),
    )
    return repository, bindings, manager


def test_binding_persists_across_repository_restart(tmp_path: Path) -> None:
    path = tmp_path / "bindings.json"
    first = DeviceMacroBindingRepository(path)
    first.set(DeviceMacroBinding("phone", "shared", config={"variables": {"x": 1}}))

    restored = DeviceMacroBindingRepository(path).get("phone")

    assert restored is not None
    assert restored.macro_definition_id == "shared"
    assert restored.config == {"variables": {"x": 1}}


def test_macro_duplicate_is_a_new_version_one_definition(tmp_path: Path) -> None:
    repository, _bindings, manager = setup(tmp_path)

    copy = repository.duplicate("shared", new_id="phone-a", name="Phone A")

    assert copy.id == "phone-a"
    assert copy.name == "Phone A"
    assert copy.version == 1
    assert copy.nodes == definition().nodes
    manager.close()


def test_definition_update_bumps_version_and_runtime_keeps_snapshot(tmp_path: Path) -> None:
    repository, _bindings, manager = setup(tmp_path)
    first_step = manager.step("a")
    assert first_step.state is DeviceRuntimeStatus.PAUSED
    assert first_step.definition_version == 1

    updated = repository.save(definition())

    assert updated.version == 2
    assert manager.current("a").definition_version == 1
    manager.stop("a")


def test_same_definition_has_isolated_device_runtimes(tmp_path: Path) -> None:
    _repository, _bindings, manager = setup(tmp_path)

    a = manager.step("a")
    b = manager.step("b")

    assert a.state is DeviceRuntimeStatus.PAUSED
    assert b.state is DeviceRuntimeStatus.PAUSED
    assert a.variables == {"first": "a"}
    assert b.variables == {"first": "b"}
    assert a.trace is not b.trace
    a_events = manager.events.history("a")
    b_events = manager.events.history("b")
    assert [event.type for event in a_events[:2]] == [
        "macro.runtime.started",
        "macro.node.started",
    ]
    assert "macro.variable.changed" in [event.type for event in a_events]
    assert "macro.node.completed" in [event.type for event in a_events]
    assert all(event.device_id == "a" for event in a_events)
    assert all(event.device_id == "b" for event in b_events)
    manager.stop("a")
    assert manager.current("b").state is DeviceRuntimeStatus.PAUSED
    manager.stop("b")


def test_one_active_runtime_per_device_and_offline_pause(tmp_path: Path) -> None:
    _repository, _bindings, manager = setup(tmp_path)
    manager.step("a")

    try:
        manager.start("a")
    except RuntimeError as error:
        assert "active" in str(error)
    else:
        raise AssertionError("second runtime should be rejected")

    manager.resume("a")
    manager.handle_device_disconnect("a")
    current = manager.current("a")
    assert current.state in {DeviceRuntimeStatus.PAUSED, DeviceRuntimeStatus.COMPLETED}
    manager.close()
