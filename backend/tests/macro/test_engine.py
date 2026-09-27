import pytest

from tapbot.macro import MacroEngine, MacroLifecycleError, MacroStatus
from tests.macro.helpers import StubCoordinator


def test_engine_lifecycle_and_paused_single_step() -> None:
    engine = MacroEngine(StubCoordinator(), macro_id="macro-test")

    assert engine.start().status is MacroStatus.RUNNING
    assert engine.pause().status is MacroStatus.PAUSED
    result = engine.step()

    assert result.trace.step == 1
    assert engine.current_state().status is MacroStatus.PAUSED
    assert engine.current_state().step_index == 1
    assert engine.start().status is MacroStatus.RUNNING
    assert engine.stop().status is MacroStatus.STOPPED
    with pytest.raises(MacroLifecycleError, match="Cannot step"):
        engine.step()


def test_engine_error_resets_to_idle() -> None:
    coordinator = StubCoordinator(RuntimeError("observation failed"))
    engine = MacroEngine(coordinator, macro_id="macro-test")

    with pytest.raises(RuntimeError, match="observation failed"):
        engine.step()
    assert engine.current_state().status is MacroStatus.ERROR
    assert engine.current_state().error == "observation failed"

    snapshot = engine.reset()
    assert snapshot.status is MacroStatus.IDLE
    assert snapshot.error is None
    assert engine.trace.steps == []


def test_synchronous_runtime_loop_honors_max_steps() -> None:
    engine = MacroEngine(StubCoordinator(), macro_id="macro-test")

    results = engine.run(max_steps=2)

    assert len(results) == 2
    assert engine.current_state().status is MacroStatus.RUNNING
    assert engine.current_state().step_index == 2
