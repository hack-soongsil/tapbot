"""Macro runtime loop and lifecycle, independent from web frameworks."""

from __future__ import annotations

from pathlib import Path
from threading import Lock, RLock
from typing import Protocol

from tapbot.macro.models import MacroStateSnapshot, MacroStatus, MacroStepResult
from tapbot.macro.state import MacroRuntimeState
from tapbot.macro.trace import MacroTrace


class StepCoordinator(Protocol):
    def step(self, step_number: int, *, execute: bool = True) -> MacroStepResult: ...


class MacroEngine:
    """Own lifecycle and trace state around an injected one-step coordinator."""

    def __init__(
        self,
        coordinator: StepCoordinator,
        *,
        macro_id: str = "macro",
        device_id: str | None = None,
        state: MacroRuntimeState | None = None,
    ) -> None:
        if not macro_id:
            raise ValueError("macro_id must not be empty")
        self.coordinator = coordinator
        self.macro_id = macro_id
        self.state = state or MacroRuntimeState()
        self.trace = MacroTrace(device_id=device_id)
        self._lock = RLock()
        self._step_lock = Lock()

    @property
    def status(self) -> MacroStatus:
        with self._lock:
            return self.state.status

    def current_state(self) -> MacroStateSnapshot:
        with self._lock:
            return self.state.snapshot(self.macro_id)

    def start(self) -> MacroStateSnapshot:
        with self._lock:
            self.state.start()
            return self.state.snapshot(self.macro_id)

    def pause(self) -> MacroStateSnapshot:
        with self._lock:
            self.state.pause()
            return self.state.snapshot(self.macro_id)

    def stop(self, path: str | Path | None = None) -> MacroStateSnapshot:
        with self._lock:
            self.state.stop()
            self.trace.finish()
            if path is not None:
                self.trace.save(path)
            return self.state.snapshot(self.macro_id)

    def reset(self) -> MacroStateSnapshot:
        with self._step_lock:
            with self._lock:
                device_id = self.trace.device_id
                self.state.reset()
                self.trace = MacroTrace(device_id=device_id)
                return self.state.snapshot(self.macro_id)

    def step(self, *, execute: bool = True) -> MacroStepResult:
        with self._step_lock:
            with self._lock:
                self.state.assert_step_allowed()
                step_number = self.state.step_index + 1
            try:
                result = self.coordinator.step(step_number, execute=execute)
            except Exception as error:
                with self._lock:
                    self.state.fail(error)
                raise
            with self._lock:
                self.trace.append(result.trace)
                self.state.record_step(result)
            return result

    def run(
        self,
        *,
        max_steps: int | None = None,
        execute: bool = True,
    ) -> tuple[MacroStepResult, ...]:
        """Run synchronously until paused/stopped/error/terminal or max_steps."""

        if max_steps is not None and max_steps < 1:
            raise ValueError("max_steps must be positive")
        if self.status is MacroStatus.IDLE:
            self.start()

        results: list[MacroStepResult] = []
        while self.status is MacroStatus.RUNNING:
            result = self.step(execute=execute)
            results.append(result)
            if result.terminal:
                self.stop()
                break
            if max_steps is not None and len(results) >= max_steps:
                break
        return tuple(results)

    def finish(self, path: str | Path | None = None) -> MacroTrace:
        """Compatibility helper for callers that only need to finalize a trace."""

        with self._lock:
            self.trace.finish()
            if path is not None:
                self.trace.save(path)
            return self.trace
