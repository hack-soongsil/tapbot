from pathlib import Path

from tapbot.macro import MacroEngine, MacroEvent, MacroService, MacroStatus
from tests.macro.helpers import StubCoordinator


def test_service_facade_preserves_lifecycle_and_trace(tmp_path: Path) -> None:
    ids = iter(("macro-a", "macro-b"))
    events: list[MacroEvent] = []

    def factory(macro_id: str) -> MacroEngine:
        return MacroEngine(
            StubCoordinator(),
            macro_id=macro_id,
            device_id="device-a",
        )

    service = MacroService(
        factory,
        macro_id_factory=lambda: next(ids),
        trace_path_factory=lambda macro_id: tmp_path / macro_id / "trace.json",
        event_sink=events.append,
    )

    assert service.start().status is MacroStatus.RUNNING
    assert service.pause().status is MacroStatus.PAUSED
    service.step()
    assert service.current_state().status is MacroStatus.PAUSED
    assert service.start().status is MacroStatus.RUNNING
    stopped = service.stop()

    assert stopped.status is MacroStatus.STOPPED
    assert (tmp_path / "macro-a" / "trace.json").is_file()
    reset = service.reset()
    assert reset.macro_id == "macro-b"
    assert reset.status is MacroStatus.IDLE
    assert [event.name for event in events] == [
        "started",
        "paused",
        "step",
        "started",
        "stopped",
        "reset",
    ]
