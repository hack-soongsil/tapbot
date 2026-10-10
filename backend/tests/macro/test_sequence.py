from time import monotonic, sleep

import pytest
from pydantic import ValidationError

from tapbot.android.client import AndroidAgentTransportError
from tapbot.macro.sequence import SequenceConflictError, SequenceRunner, SequenceService
from tapbot.macro.sequence_models import SequenceDefinition
from tests.fakes.sequence import DeferredSequencePort, RecordingSequencePort


def definition(**changes):
    return SequenceDefinition.model_validate({**dict(
        id="test", name="Test", screen_width=100, screen_height=100,
        repeat_count=2, steps=[
            dict(id="one", label="One", kind="point", x=10, y=20, delay_ms=0),
            dict(id="two", label="Two", kind="element", selector={"text": "Next"}, delay_ms=0),
        ]), **changes})


def wait_status(runner, status):
    deadline = monotonic() + 2
    while runner.snapshot()["status"] != status and monotonic() < deadline:
        sleep(.005)
    assert runner.snapshot()["status"] == status


def test_runs_ordered_steps_and_repeats():
    port = RecordingSequencePort()
    runner = SequenceRunner(port)
    try:
        runner.start(definition())
        wait_status(runner, "COMPLETED")
        assert port.calls == ["one", "two", "one", "two"]
        assert runner.snapshot()["completed_steps"] == 4
    finally:
        runner.close()


def test_manual_checkpoint_stops_input_until_resume_and_can_stop(tmp_path):
    port = RecordingSequencePort(checkpoint=True)
    service = SequenceService(tmp_path, lambda _: port)
    runner = service.runner("phone")
    value = definition(repeat_count=1, steps=[
        dict(id="check", label="Check phone", kind="checkpoint", delay_ms=0),
        dict(id="next", label="Next", kind="point", x=10, y=20, delay_ms=0),
    ])
    try:
        runner.start(value)
        wait_status(runner, "PAUSED")
        assert runner.snapshot()["pause_reason"] == "Check phone"
        assert port.calls == ["check"]
        with pytest.raises(SequenceConflictError):
            runner.start(value)
        with pytest.raises(SequenceConflictError):
            service.run_input("phone", lambda: pytest.fail("manual input dispatched"))
        runner.command("resume")
        wait_status(runner, "COMPLETED")
        assert port.calls == ["check", "next"]
        runner.start(value)
        wait_status(runner, "PAUSED")
        runner.command("stop")
        wait_status(runner, "STOPPED")
        assert port.calls == ["check", "next", "check"]
    finally:
        service.close()


def test_optional_checkpoint_rechecks_without_clicking_after_resume():
    port = RecordingSequencePort(checkpoint=True)
    runner = SequenceRunner(port)
    value = definition(repeat_count=1, steps=[dict(
        id="check", label="Check phone", kind="checkpoint",
        selector={"text": "Check"}, delay_ms=0,
    )])
    try:
        runner.start(value)
        wait_status(runner, "PAUSED")
        port.checkpoint = False
        runner.command("resume")
        wait_status(runner, "COMPLETED")
        assert port.calls == ["check", "check"]
        assert runner.snapshot()["completed_steps"] == 1
    finally:
        runner.close()


def test_stop_interrupts_delay_and_pause_holds_next_step():
    port = RecordingSequencePort()
    runner = SequenceRunner(port)
    value = definition(repeat_count=1, steps=[
        dict(id="one", label="One", kind="point", x=10, y=20, delay_ms=600000),
        dict(id="two", label="Two", kind="point", x=30, y=40, delay_ms=0),
    ])
    try:
        runner.start(value)
        assert port.entered.wait(1)
        runner.command("pause")
        assert runner.snapshot()["status"] == "PAUSED"
        runner.command("stop")
        wait_status(runner, "STOPPED")
        assert port.calls == ["one"]
    finally:
        runner.close()


def test_uncertain_input_is_never_retried():
    error = AndroidAgentTransportError("lost response", outcome_unknown=True)
    port = RecordingSequencePort(error=error)
    runner = SequenceRunner(port)
    try:
        runner.start(definition())
        wait_status(runner, "ERROR")
        assert port.calls == ["one"]
        assert runner.snapshot()["outcome_unknown"] is True
        runner.command("resume")
        assert runner.snapshot()["status"] == "ERROR"
    finally:
        runner.close()


def test_stop_interrupts_pending_screen_confirmation():
    port = RecordingSequencePort(pending=True)
    runner = SequenceRunner(port)
    value = definition(repeat_count=1, steps=[dict(
        id="check", label="Wait for screen", kind="checkpoint", required_text="Done", timeout_ms=60000,
    )])
    try:
        runner.start(value)
        assert port.entered.wait(1)
        runner.command("stop")
        wait_status(runner, "STOPPED")
        assert runner.snapshot()["completed_steps"] == 0
    finally:
        runner.close()


def test_loading_target_waits_without_input_then_dispatches_once():
    port = DeferredSequencePort()
    runner = SequenceRunner(port)
    value = definition(repeat_count=1, steps=[dict(
        id="next", label="Next", kind="element", selector={"text": "Next"}, delay_ms=0,
    )])
    try:
        runner.start(value)
        assert port.entered.wait(1)
        runner.command("pause")
        port.ready.set()
        assert port.calls == []
        runner.command("resume")
        wait_status(runner, "COMPLETED")
        assert port.calls == ["next"]
        assert port.attempts >= 2
    finally:
        runner.close()


@pytest.mark.parametrize("cancel", [True, False])
def test_loading_target_can_stop_or_timeout_without_input(cancel):
    port = DeferredSequencePort()
    runner = SequenceRunner(port)
    value = definition(repeat_count=1, steps=[dict(
        id="next", label="Next", kind="element", selector={"text": "Next"}, delay_ms=0,
        timeout_ms=60000 if cancel else 100,
    )])
    try:
        runner.start(value)
        assert port.entered.wait(1)
        if cancel:
            runner.command("stop")
        wait_status(runner, "STOPPED" if cancel else "ERROR")
        assert port.calls == []
        assert runner.snapshot()["completed_steps"] == 0
        if not cancel:
            assert runner.snapshot()["error"] == "Next screen is loading"
    finally:
        runner.close()


def test_saved_presets_and_bookings_validate(tmp_path):
    service = SequenceService(tmp_path, lambda _: RecordingSequencePort())
    value = service.save(definition())
    reloaded = SequenceService(tmp_path, lambda _: RecordingSequencePort()).list()
    assert value in reloaded
    preset = next(item for item in reloaded if item.booking_ranges)
    assert preset.steps[-1].selector.text == "예약 화면으로"
    broken = preset.model_dump()
    broken["booking_ranges"][1]["start_time"] = "15:00"
    with pytest.raises(ValidationError):
        SequenceDefinition.model_validate(broken)
    with pytest.raises(ValidationError):
        definition(steps=[dict(id="outside", label="Outside", kind="point", x=100, y=20)])
