import pytest

from tapbot.macro import MacroLifecycleError, MacroRuntimeState, MacroStatus


def test_required_lifecycle_transitions() -> None:
    state = MacroRuntimeState()

    state.start()
    assert state.status is MacroStatus.RUNNING
    state.pause()
    assert state.status is MacroStatus.PAUSED
    state.start()
    assert state.status is MacroStatus.RUNNING
    state.stop()
    assert state.status is MacroStatus.STOPPED


def test_paused_macro_can_stop_and_error_can_reset() -> None:
    state = MacroRuntimeState()
    state.start()
    state.pause()
    state.stop()
    assert state.status is MacroStatus.STOPPED

    state.reset()
    state.fail(TimeoutError("agent timeout"))
    assert state.status is MacroStatus.ERROR
    state.reset()
    assert state.status is MacroStatus.IDLE
    assert state.error is None


def test_invalid_pause_is_rejected() -> None:
    with pytest.raises(MacroLifecycleError, match="Cannot pause"):
        MacroRuntimeState().pause()
