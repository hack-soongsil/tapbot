from threading import Event, Thread

from tapbot.macro import (
    EventEntryNodeIds,
    MacroDefinition,
    MacroNode,
    ScreenDefinition,
    ScreenLifecycleDispatcher,
)
from tapbot.ui_resolution.screens import DEFAULT_SSUTODAY_SCREENS
from tests.ui_resolution.test_screens import detail_tree, home_tree


def definition(screen_id: str) -> MacroDefinition:
    screen = next(item for item in DEFAULT_SSUTODAY_SCREENS if item.id == screen_id)
    return MacroDefinition(
        id=f"{screen_id}-macro",
        name=screen_id,
        version=1,
        nodes=(
            MacroNode("enter", "screen_enter"),
            MacroNode("update", "screen_update", {"interval_ms": 1_000, "skip_if_running": True}),
            MacroNode("exit", "screen_exit"),
        ),
        edges=(),
        entry_node_id=None,
        screen=ScreenDefinition(screen.id, screen.match),
        event_entry_node_ids=EventEntryNodeIds("enter", "update", "exit"),
    )


def test_enter_update_and_transition_order() -> None:
    calls: list[tuple[str, str]] = []
    now = [0.0]
    dispatcher = ScreenLifecycleDispatcher(
        (definition("reservation_home"), definition("reservation_detail")),
        lambda _definition, event, _tree: calls.append((event.kind, event.screen_id)),
        monotonic=lambda: now[0],
    )

    dispatcher.refresh(home_tree())
    dispatcher.refresh(home_tree("수 30"))
    now[0] = 0.5
    dispatcher.refresh(home_tree())
    dispatcher.refresh(detail_tree())
    dispatcher.refresh(detail_tree("이 시간으로 예약하기"))

    assert calls == [
        ("enter", "reservation_home"),
        ("update", "reservation_home"),
        ("exit", "reservation_home"),
        ("enter", "reservation_detail"),
        ("update", "reservation_detail"),
    ]


def test_unknown_screen_exits_without_entering_another_screen() -> None:
    calls: list[str] = []
    dispatcher = ScreenLifecycleDispatcher(
        (definition("reservation_home"),),
        lambda _definition, event, _tree: calls.append(event.kind),
    )

    dispatcher.refresh(home_tree())
    dispatcher.refresh({"nodes": []})

    assert calls == ["enter", "exit"]
    assert dispatcher.active_screen_id is None


def test_screen_update_is_single_flight() -> None:
    started = Event()
    release = Event()
    calls: list[str] = []

    def execute(_definition, event, _tree):
        calls.append(event.kind)
        if event.kind == "update":
            started.set()
            release.wait(timeout=2)

    dispatcher = ScreenLifecycleDispatcher((definition("reservation_home"),), execute)
    dispatcher.refresh(home_tree())
    worker = Thread(target=lambda: dispatcher.refresh(home_tree()))
    worker.start()
    assert started.wait(timeout=1)

    assert dispatcher.refresh(home_tree()) == ()
    release.set()
    worker.join(timeout=1)
    assert calls.count("update") == 1
