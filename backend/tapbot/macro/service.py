"""Application-facing macro use cases over a replaceable engine instance."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
import re
from threading import RLock
from uuid import uuid4

from tapbot.macro.engine import MacroEngine
from tapbot.macro.models import (
    MacroEvent,
    MacroStateSnapshot,
    MacroStatus,
    MacroStepResult,
)
from tapbot.macro.binding import DeviceMacroBinding, DeviceMacroBindingRepository
from tapbot.macro.graph_models import MacroDefinition
from tapbot.macro.graph_validator import GraphValidator
from tapbot.macro.repository import MacroRepository
from tapbot.macro.runtime_manager import RuntimeManager


MacroEngineFactory = Callable[[str], MacroEngine]
MacroEventSink = Callable[[MacroEvent], None]
TracePathFactory = Callable[[str], str | Path]


class MacroService:
    """Facade used by API adapters without exposing lifecycle business logic."""

    def __init__(
        self,
        engine_factory: MacroEngineFactory,
        *,
        macro_id_factory: Callable[[], str] | None = None,
        trace_path_factory: TracePathFactory | None = None,
        event_sink: MacroEventSink | None = None,
    ) -> None:
        self._engine_factory = engine_factory
        self._macro_id_factory = macro_id_factory or _macro_id
        self._trace_path_factory = trace_path_factory
        self._event_sink = event_sink
        self._lock = RLock()
        self._macro_id = self._macro_id_factory()
        self._engine = self._build_engine(self._macro_id)

    @property
    def macro_id(self) -> str:
        with self._lock:
            return self._macro_id

    def current_state(self) -> MacroStateSnapshot:
        with self._lock:
            return self._engine.current_state()

    def start(self) -> MacroStateSnapshot:
        with self._lock:
            snapshot = self._engine.start()
            self._emit("started")
            return snapshot

    def pause(self) -> MacroStateSnapshot:
        with self._lock:
            snapshot = self._engine.pause()
            self._emit("paused")
            return snapshot

    def stop(self) -> MacroStateSnapshot:
        with self._lock:
            path = (
                None
                if self._trace_path_factory is None
                else Path(self._trace_path_factory(self._macro_id))
            )
            snapshot = self._engine.stop(path)
            payload: dict[str, object] = {}
            if path is not None:
                payload["trace_path"] = str(path)
            self._emit("stopped", payload)
            return snapshot

    def reset(self) -> MacroStateSnapshot:
        with self._lock:
            self._engine.reset()
            self._macro_id = self._macro_id_factory()
            self._engine = self._build_engine(self._macro_id)
            snapshot = self._engine.current_state()
            self._emit("reset")
            return snapshot

    def step(self, *, execute: bool = True) -> MacroStepResult:
        with self._lock:
            try:
                result = self._engine.step(execute=execute)
            except Exception as error:
                self._emit(
                    "step_failed",
                    {"error": str(error)},
                    status="error",
                )
                raise
            trace = result.trace
            self._emit(
                "step",
                {
                    "step": trace.step,
                    "state": trace.state,
                    "status": trace.status,
                    "action": trace.action,
                    "outcome_unknown": (
                        False
                        if result.execution is None
                        else result.execution.outcome_unknown
                    ),
                },
                status=(
                    "error" if trace.status == "execution_failed" else "success"
                ),
            )
            return result

    def run(
        self,
        *,
        max_steps: int | None = None,
        execute: bool = True,
    ) -> tuple[MacroStepResult, ...]:
        with self._lock:
            engine = self._engine
        results = engine.run(max_steps=max_steps, execute=execute)
        with self._lock:
            self._emit("run_completed", {"steps": len(results)})
        return results

    def close(self) -> None:
        with self._lock:
            if self._engine.status in {MacroStatus.RUNNING, MacroStatus.PAUSED}:
                self.stop()

    def _build_engine(self, macro_id: str) -> MacroEngine:
        engine = self._engine_factory(macro_id)
        if engine.macro_id != macro_id:
            raise ValueError("Macro engine factory returned a mismatched macro_id")
        return engine

    def _emit(
        self,
        name: str,
        payload: dict[str, object] | None = None,
        *,
        status: str = "success",
    ) -> None:
        if self._event_sink is None:
            return
        self._event_sink(
            MacroEvent(
                macro_id=self._macro_id,
                name=name,
                status=status,
                payload=payload or {},
            )
        )


def _macro_id() -> str:
    return f"macro-{uuid4().hex[:12]}"


def _validation_issue(message: str) -> dict[str, str]:
    issue = {"message": message}
    node = re.search(r"node '([^']+)'", message)
    edge = re.search(r"edge '([^']+)'", message)
    if node:
        issue["node_id"] = node.group(1)
    if edge:
        issue["edge_id"] = edge.group(1)
    return issue


class MacroManagementService:
    """Definition, binding and per-device runtime use cases."""

    def __init__(
        self,
        repository: MacroRepository,
        bindings: DeviceMacroBindingRepository,
        runtimes: RuntimeManager,
        validator: GraphValidator,
        *,
        device_exists: Callable[[str], bool] | None = None,
    ) -> None:
        self.repository = repository
        self.bindings = bindings
        self.runtimes = runtimes
        self.validator = validator
        self.device_exists = device_exists or (lambda _device_id: True)

    def list_definitions(self) -> tuple[MacroDefinition, ...]:
        return self.repository.list()

    def get_definition(self, macro_id: str) -> MacroDefinition:
        return self.repository.get(macro_id)

    def create_definition(self, definition: MacroDefinition) -> MacroDefinition:
        self.validator.validate_or_raise(definition)
        return self.repository.create(definition)

    def save_definition(self, definition: MacroDefinition) -> MacroDefinition:
        self.validator.validate_or_raise(definition)
        return self.repository.save(definition)

    def delete_definition(self, macro_id: str) -> bool:
        if self.bindings.count_for_macro(macro_id):
            raise RuntimeError("macro definition is still bound to a device")
        return self.repository.delete(macro_id)

    def duplicate_definition(
        self, macro_id: str, *, new_id: str, name: str | None = None
    ) -> MacroDefinition:
        return self.repository.duplicate(macro_id, new_id=new_id, name=name)

    def validate_definition(self, definition: MacroDefinition) -> dict[str, object]:
        result = self.validator.validate(definition)
        return {
            "valid": result.valid,
            "errors": [_validation_issue(message) for message in result.errors],
            "warnings": list(result.warnings),
        }

    def get_binding(self, device_id: str) -> DeviceMacroBinding | None:
        return self.bindings.get(device_id)

    def bind(self, binding: DeviceMacroBinding) -> DeviceMacroBinding:
        if not self.device_exists(binding.device_id):
            raise KeyError(f"Android device {binding.device_id!r} was not found")
        self.repository.get(binding.macro_definition_id)
        return self.bindings.set(binding)

    def unbind(self, device_id: str) -> bool:
        runtime = self.runtimes.current(device_id)
        if runtime.state.value in {"running", "paused"}:
            raise RuntimeError("stop the device macro before removing its binding")
        return self.bindings.delete(device_id)

    def binding_payload(self, device_id: str) -> dict[str, object]:
        binding = self.get_binding(device_id)
        return {
            "binding": None if binding is None else binding.to_dict(),
            "shared_device_count": (
                0
                if binding is None
                else self.bindings.count_for_macro(binding.macro_definition_id)
            ),
        }

    def start(self, device_id: str) -> dict[str, object]:
        return self.runtimes.start(device_id).to_dict()

    def pause(self, device_id: str) -> dict[str, object]:
        return self.runtimes.pause(device_id).to_dict()

    def resume(self, device_id: str) -> dict[str, object]:
        return self.runtimes.resume(device_id).to_dict()

    def stop(self, device_id: str) -> dict[str, object]:
        return self.runtimes.stop(device_id).to_dict()

    def reset(self, device_id: str) -> dict[str, object]:
        return self.runtimes.reset(device_id).to_dict()

    def step(self, device_id: str) -> dict[str, object]:
        return self.runtimes.step(device_id).to_dict()

    def runtime(self, device_id: str) -> dict[str, object]:
        return self.runtimes.current(device_id).to_dict()
