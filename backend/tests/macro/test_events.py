from __future__ import annotations

from pathlib import Path
import time

from tapbot.macro.binding import DeviceMacroBinding, DeviceMacroBindingRepository
from tapbot.macro.events import MacroEventBroker
from tapbot.macro.graph_engine import GraphEngine
from tapbot.macro.graph_models import GraphExecutionContext, MacroDefinition, MacroNode, NodeResult
from tapbot.macro.graph_store import FileMacroDefinitionStore
from tapbot.macro.graph_validator import GraphValidator
from tapbot.macro.node_registry import NodeRegistry
from tapbot.macro.repository import MacroRepository
from tapbot.macro.runtime_manager import RuntimeManager


def test_event_sequence_and_device_isolation() -> None:
    broker = MacroEventBroker(max_events_per_device=10)
    first = broker.publish(
        device_id="a", runtime_id="run-a", macro_id="macro", event_type="macro.runtime.started"
    )
    second = broker.publish(
        device_id="a", runtime_id="run-a", macro_id="macro", event_type="macro.node.started", node_id="one"
    )
    other = broker.publish(
        device_id="b", runtime_id="run-b", macro_id="macro", event_type="macro.runtime.started"
    )

    assert [event.sequence for event in broker.history("a")] == [1, 2]
    assert broker.history("a", after_event_id=first.event_id) == (second,)
    assert broker.history("b") == (other,)
    assert other.sequence == 1


def test_event_history_is_bounded() -> None:
    broker = MacroEventBroker(max_events_per_device=3)
    for index in range(5):
        broker.publish(
            device_id="a",
            runtime_id="run-a",
            macro_id="macro",
            event_type="macro.node.completed",
            payload={"index": index},
        )

    assert [event.payload["index"] for event in broker.history("a")] == [2, 3, 4]


class TapOutputHandler:
    output_handles = frozenset()

    def validate(self, config):
        return ()

    def execute(self, context, config):
        return NodeResult.success({
            "element_id": "button",
            "bounds": [10, 20, 80, 60],
            "safe_bounds": [20, 26, 70, 54],
            "tap_point": [44, 39],
            "sampling": "gaussian",
            "action_result": {"state": "completed"},
        })


def test_tap_output_uses_same_planned_point_for_live_events(tmp_path: Path) -> None:
    registry = NodeRegistry({"tap": TapOutputHandler()})
    validator = GraphValidator(registry)
    repository = MacroRepository(FileMacroDefinitionStore(tmp_path / "macros", validator=validator))
    repository.create(MacroDefinition(
        id="tap", name="Tap", version=1,
        nodes=(MacroNode("tap", "tap", {}),), edges=(), entry_node_id="tap",
    ))
    bindings = DeviceMacroBindingRepository(tmp_path / "bindings.json")
    bindings.set(DeviceMacroBinding("phone", "tap"))
    manager = RuntimeManager(
        repository,
        bindings,
        engine_factory=lambda _device_id: GraphEngine(registry),
        context_factory=lambda device_id, _binding: GraphExecutionContext(device_id=device_id),
    )

    manager.start("phone")
    for _ in range(100):
        events = manager.events.history("phone")
        if any(event.type == "macro.runtime.completed" for event in events):
            break
        time.sleep(0.001)
    event_types = [event.type for event in events]

    assert event_types.index("macro.node.started") < event_types.index("android.element.resolved")
    assert event_types.index("android.element.resolved") < event_types.index("android.tap.planned")
    assert event_types.index("android.tap.planned") < event_types.index("android.tap.completed")
    assert event_types.index("android.tap.completed") < event_types.index("macro.node.completed")
    planned = next(event for event in events if event.type == "android.tap.planned")
    completed = next(event for event in events if event.type == "android.tap.completed")
    assert planned.payload["tap_point"] == completed.payload["tap_point"] == [44, 39]
