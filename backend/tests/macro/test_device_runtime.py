from __future__ import annotations

from pathlib import Path
import time

from tapbot.macro.binding import DeviceMacroBinding, DeviceMacroBindingRepository
from tapbot.macro.graph_engine import GraphEngine
from tapbot.macro.graph_models import (
    GraphExecutionContext,
    EventEntryNodeIds,
    MacroDefinition,
    MacroEdge,
    MacroNode,
    NodeResult,
    ScreenDefinition,
)
from tapbot.macro.graph_store import FileMacroDefinitionStore
from tapbot.macro.graph_validator import GraphValidator
from tapbot.macro.node_registry import NodeRegistry, create_default_node_registry
from tapbot.macro.repository import MacroRepository
from tapbot.macro.runtime_manager import DeviceRuntimeStatus, RuntimeManager
from tapbot.ui_resolution.screens import DEFAULT_SSUTODAY_SCREENS
from tests.ui_resolution.test_screens import detail_tree, home_tree


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


def test_debug_print_is_published_as_structured_user_event(tmp_path: Path) -> None:
    registry = create_default_node_registry()
    repository = MacroRepository(FileMacroDefinitionStore(
        tmp_path / "debug-macros", validator=GraphValidator(registry)
    ))
    repository.create(MacroDefinition(
        id="debug",
        name="Debug",
        version=1,
        nodes=(MacroNode(
            "print",
            "debug_print",
            {"message": "slot selected", "level": "info"},
        ),),
        edges=(),
        entry_node_id="print",
    ))
    bindings = DeviceMacroBindingRepository(tmp_path / "debug-bindings.json")
    bindings.set(DeviceMacroBinding("phone", "debug"))
    manager = RuntimeManager(
        repository,
        bindings,
        engine_factory=lambda _device_id: GraphEngine(registry),
        context_factory=lambda device_id, _binding: GraphExecutionContext(
            device_id=device_id
        ),
    )

    manager.start("phone")
    deadline = time.monotonic() + 1
    debug_event = None
    while time.monotonic() < deadline:
        debug_event = next((
            event for event in manager.events.history("phone")
            if event.type == "macro.user_debug"
        ), None)
        if debug_event is not None:
            break
        time.sleep(0.01)

    assert debug_event is not None
    assert debug_event.node_id == "print"
    assert debug_event.runtime_id
    assert debug_event.macro_id == "debug"
    assert debug_event.payload == {
        "screen_id": None,
        "level": "info",
        "message": "slot selected",
    }
    manager.close()


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


class CyclingUi:
    def __init__(self) -> None:
        self.snapshots = [home_tree(), home_tree("수 30"), detail_tree()]
        self.index = 0

    def read_ui_tree(self):
        selected = self.snapshots[min(self.index, len(self.snapshots) - 1)]
        self.index += 1
        return selected

    def find_element(self, selector):
        return None

    def current_state(self):
        return "unknown"


def screen_definition(screen_id: str) -> MacroDefinition:
    screen = next(item for item in DEFAULT_SSUTODAY_SCREENS if item.id == screen_id)
    return MacroDefinition(
        id=f"{screen_id}-graph",
        name=screen_id,
        version=1,
        nodes=(
            MacroNode("enter", "screen_enter"),
            MacroNode("update", "screen_update", {"interval_ms": 1, "skip_if_running": True}),
            MacroNode("exit", "screen_exit"),
        ),
        edges=(),
        entry_node_id=None,
        metadata={"workflow_id": "ssutoday"},
        screen=ScreenDefinition(screen.id, screen.match),
        event_entry_node_ids=EventEntryNodeIds("enter", "update", "exit"),
    )


def test_screen_runtime_refreshes_tree_and_orders_exit_before_next_enter(tmp_path: Path) -> None:
    registry = create_default_node_registry()
    repository = MacroRepository(FileMacroDefinitionStore(
        tmp_path / "screens", validator=GraphValidator(registry)
    ))
    repository.create(screen_definition("reservation_home"))
    repository.create(screen_definition("reservation_detail"))
    bindings = DeviceMacroBindingRepository(tmp_path / "screen-bindings.json")
    bindings.set(DeviceMacroBinding("phone", "reservation_home-graph"))
    ui = CyclingUi()
    manager = RuntimeManager(
        repository,
        bindings,
        engine_factory=lambda _device_id: GraphEngine(registry),
        context_factory=lambda device_id, _binding: GraphExecutionContext(
            device_id=device_id, ui=ui
        ),
        screen_refresh_interval_sec=0.01,
    )

    manager.start("phone")
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        transitions = [
            (event.type, event.payload.get("screen_id"))
            for event in manager.events.history("phone")
            if event.type.startswith("macro.screen.")
        ]
        if ("macro.screen.enter", "reservation_detail") in transitions:
            break
        time.sleep(0.01)
    manager.stop("phone")

    assert transitions[:4] == [
        ("macro.screen.enter", "reservation_home"),
        ("macro.screen.update", "reservation_home"),
        ("macro.screen.exit", "reservation_home"),
        ("macro.screen.enter", "reservation_detail"),
    ]
