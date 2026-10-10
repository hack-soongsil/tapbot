"""Persistent click sequences and one cancellable background run per device."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from threading import Condition, RLock, Thread
from time import monotonic
from typing import Protocol
from uuid import uuid4

from tapbot.macro.sequence_models import SequenceDefinition, SequenceStep


class SequenceConflictError(RuntimeError):
    pass


class SequenceTargetPending(ValueError):
    """A fresh read found no ready target; no click has been dispatched."""


class SequencePort(Protocol):
    def prepare(self, definition: SequenceDefinition) -> None: ...
    def execute(self, step: SequenceStep, definition: SequenceDefinition) -> dict[str, object]: ...


class SequenceRunner:
    def __init__(self, port: SequencePort) -> None:
        self.port = port
        self._input_lock = RLock()
        self._gate = Condition(RLock())
        self._thread: Thread | None = None
        self._status = "IDLE"
        self._definition: SequenceDefinition | None = None
        self._run_id: str | None = None
        self._completed = 0
        self._step_id: str | None = None
        self._result: dict[str, object] | None = None
        self._error: str | None = None
        self._outcome_unknown = False
        self._pause_reason: str | None = None

    @property
    def active(self) -> bool:
        with self._gate:
            return self._status in {"RUNNING", "PAUSED", "STOPPING"}

    def snapshot(self) -> dict[str, object]:
        with self._gate:
            definition = self._definition
            count = len(definition.steps) if definition else 0
            return {
                "status": self._status, "run_id": self._run_id,
                "sequence_id": definition.id if definition else None,
                "step_id": self._step_id, "completed_steps": self._completed,
                "total_steps": count * definition.repeat_count if definition else 0,
                "iteration": min(self._completed // count + 1, definition.repeat_count) if count else 0,
                "repeat_count": definition.repeat_count if definition else 0,
                "last_result": self._result, "error": self._error,
                "outcome_unknown": self._outcome_unknown,
                "pause_reason": self._pause_reason,
            }

    def start(self, definition: SequenceDefinition) -> dict[str, object]:
        if self.active:
            raise SequenceConflictError("이 기기에서 매크로가 이미 실행 중입니다.")
        with self._input_lock, self._gate:
            if self.active:
                raise SequenceConflictError("이 기기에서 매크로가 이미 실행 중입니다.")
            self.port.prepare(definition)
            self._definition = definition
            self._run_id = uuid4().hex
            self._completed = 0
            self._step_id = None
            self._result = None
            self._error = None
            self._outcome_unknown = False
            self._pause_reason = None
            self._status = "RUNNING"
            self._thread = Thread(target=self._run, args=(definition,), daemon=True, name="tapbot-sequence")
            self._thread.start()
            return self.snapshot()

    def command(self, command: str) -> dict[str, object]:
        with self._gate:
            if command == "pause" and self._status == "RUNNING":
                self._status = "PAUSED"
            elif command == "resume" and self._status == "PAUSED":
                self._status = "RUNNING"
                self._pause_reason = None
            elif command == "stop" and self.active:
                self._status = "STOPPING"
            self._gate.notify_all()
            return self.snapshot()

    def close(self) -> None:
        self.command("stop")
        thread = self._thread
        if thread:
            thread.join(timeout=15)

    def _wait(self, seconds: float = 0) -> bool:
        """Pause freezes remaining delay; stop interrupts even long waits."""
        with self._gate:
            remaining = seconds
            while True:
                if self._status == "STOPPING":
                    self._status = "STOPPED"
                    return False
                if self._status == "PAUSED":
                    self._gate.wait()
                    continue
                if remaining <= 0:
                    return True
                started = monotonic()
                self._gate.wait(timeout=remaining)
                remaining -= monotonic() - started

    def _run(self, definition: SequenceDefinition) -> None:
        try:
            for _ in range(definition.repeat_count):
                for step in definition.steps:
                    if not self._wait():
                        return
                    with self._gate:
                        self._step_id = step.id
                    result = self._execute_ready(step, definition)
                    if result is None:
                        return
                    remaining = step.timeout_ms / 1000
                    while step.kind == "checkpoint" and (result.get("awaiting_user") or result.get("pending_confirmation")):
                        if result.get("awaiting_user"):
                            with self._gate:
                                if self._status == "STOPPING":
                                    self._status = "STOPPED"
                                    return
                                self._pause_reason = step.label
                                self._status = "PAUSED"
                                self._result = result
                            if not self._wait():
                                return
                            remaining = step.timeout_ms / 1000
                        else:
                            if remaining <= 0:
                                raise ValueError(f"{step.label}: '{step.required_text}' 화면이 나타나지 않았습니다.")
                            delay = min(.2, remaining)
                            if not self._wait(delay):
                                return
                            remaining -= delay
                        # Recheck the screen after the user resumes; no input is dispatched.
                        started = monotonic()
                        result = (self._execute_ready(step, definition)
                                  if step.selector or step.required_text else {"awaiting_user": False})
                        if result is None:
                            return
                        remaining -= monotonic() - started
                    with self._gate:
                        self._result = result
                        self._completed += 1
                    if not self._wait(step.delay_ms / 1000):
                        return
            with self._gate:
                self._status = "COMPLETED"
                self._step_id = None
        except Exception as error:
            with self._gate:
                self._status = "ERROR"
                self._error = str(error)
                self._outcome_unknown = bool(getattr(error, "outcome_unknown", False))

    def _execute_ready(
        self, step: SequenceStep, definition: SequenceDefinition,
    ) -> dict[str, object] | None:
        remaining = step.timeout_ms / 1000
        while True:
            # Only readiness reads may be repeated. A dispatched input is never
            # retried, and pause/stop can interrupt waiting for the next screen.
            with self._input_lock:
                if not self._wait():
                    return None
                started = monotonic()
                try:
                    return self.port.execute(step, definition)
                except SequenceTargetPending as error:
                    reason = str(error)
            remaining -= monotonic() - started
            if remaining <= 0:
                raise ValueError(reason)
            delay = min(.2, remaining)
            if not self._wait(delay):
                return None
            remaining -= delay


class SequenceService:
    def __init__(self, directory: Path, port_factory: Callable[[str], SequencePort]) -> None:
        self.directory = directory
        self.port_factory = port_factory
        self._lock = RLock()
        self._runners: dict[str, SequenceRunner] = {}

    def list(self) -> list[SequenceDefinition]:
        with self._lock:
            paths = (*sorted((Path(__file__).parent / "presets").glob("*.json")),
                     *sorted(self.directory.glob("*.json")))
            definitions = {}
            for path in paths:
                value = SequenceDefinition.model_validate_json(path.read_text(encoding="utf-8"))
                definitions[value.id] = value
            return list(definitions.values())

    def save(self, definition: SequenceDefinition) -> SequenceDefinition:
        with self._lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            destination = self.directory / f"{definition.id}.json"
            temporary = destination.with_suffix(".tmp")
            temporary.write_text(definition.model_dump_json(indent=2), encoding="utf-8")
            temporary.replace(destination)
        return definition

    def runner(self, device_id: str) -> SequenceRunner:
        with self._lock:
            if device_id not in self._runners:
                self._runners[device_id] = SequenceRunner(self.port_factory(device_id))
            return self._runners[device_id]

    def require_input_available(self, device_id: str) -> None:
        with self._lock:
            runner = self._runners.get(device_id)
        if runner and runner.active:
            raise SequenceConflictError("순서 매크로를 중지한 뒤 직접 조작하세요.")

    def run_input(self, device_id: str, operation: Callable[[], object]) -> object:
        self.require_input_available(device_id)
        runner = self.runner(device_id)
        with runner._input_lock:
            self.require_input_available(device_id)
            return operation()

    def close(self) -> None:
        with self._lock:
            runners = tuple(self._runners.values())
        for runner in runners:
            runner.close()
