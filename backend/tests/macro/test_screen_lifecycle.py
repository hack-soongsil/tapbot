from threading import Event, Thread

from tapbot.macro import (
    EventEntryNodeIds,
    MacroDefinition,
    MacroNode,
    ScreenLifecycleDispatcher,
)
from tests.ui_resolution.test_screens import detail_tree, home_tree


def definition(*screen_ids: str) -> MacroDefinition:
    entries = {
        screen_id: EventEntryNodeIds(
            f"{screen_id}-enter",
            f"{screen_id}-update",
            f"{screen_id}-exit",
        )
        for screen_id in screen_ids
    }
    nodes = tuple(
        MacroNode(
            f"{screen_id}-{kind}",
            f"screen_{kind}",
            {
                "screen_id": screen_id,
                "event": kind,
                **(
                    {"interval_ms": 1_000, "skip_if_running": True}
                    if kind == "update" else {}
                ),
            },
        )
        for screen_id in screen_ids
        for kind in ("enter", "update", "exit")
    )
    return MacroDefinition(
        id="reservation-macro",
        name="reservation",
        version=1,
        nodes=nodes,
        edges=(),
        entry_node_id=None,
        screen_event_entry_node_ids=entries,
    )


def test_enter_update_and_transition_order() -> None:
    calls: list[tuple[str, str]] = []
    now = [0.0]
    dispatcher = ScreenLifecycleDispatcher(
        (definition("reservation_home", "reservation_detail"),),
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
