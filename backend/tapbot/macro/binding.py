"""Persistent device-to-definition bindings."""

from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
from threading import RLock
from uuid import uuid4

from tapbot.macro.graph_models import JsonObject, assert_json_value


@dataclass(frozen=True, slots=True)
class DeviceMacroBinding:
    device_id: str
    macro_definition_id: str
    enabled: bool = True
    config: JsonObject = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.device_id or not self.macro_definition_id:
            raise ValueError("device_id and macro_definition_id are required")
        assert_json_value(self.config, name="binding config")

    def to_dict(self) -> JsonObject:
        return {
            "device_id": self.device_id,
            "macro_definition_id": self.macro_definition_id,
            "enabled": self.enabled,
            "config": json.loads(json.dumps(self.config)),
        }

    @classmethod
    def from_dict(cls, value: object) -> DeviceMacroBinding:
        if not isinstance(value, dict):
            raise ValueError("binding must be an object")
        enabled = value.get("enabled", True)
        config = value.get("config", {})
        if not isinstance(enabled, bool):
            raise ValueError("binding enabled must be a boolean")
        if not isinstance(config, dict):
            raise ValueError("binding config must be an object")
        return cls(
            device_id=str(value.get("device_id", "")),
            macro_definition_id=str(value.get("macro_definition_id", "")),
            enabled=enabled,
            config=dict(config),
        )


class DeviceMacroBindingRepository:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = RLock()
        self._bindings = self._load()

    def list(self) -> tuple[DeviceMacroBinding, ...]:
        with self._lock:
            return tuple(self._bindings[key] for key in sorted(self._bindings))

    def get(self, device_id: str) -> DeviceMacroBinding | None:
        with self._lock:
            return self._bindings.get(device_id)

    def set(self, binding: DeviceMacroBinding) -> DeviceMacroBinding:
        with self._lock:
            self._bindings[binding.device_id] = binding
            self._persist()
            return binding

    def delete(self, device_id: str) -> bool:
        with self._lock:
            removed = self._bindings.pop(device_id, None) is not None
            if removed:
                self._persist()
            return removed

    def count_for_macro(self, macro_id: str) -> int:
        return sum(item.macro_definition_id == macro_id for item in self.list())

    def _load(self) -> dict[str, DeviceMacroBinding]:
        if not self.path.exists():
            return {}
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        items = payload.get("bindings", []) if isinstance(payload, dict) else []
        bindings = (DeviceMacroBinding.from_dict(item) for item in items)
        return {item.device_id: item for item in bindings}

    def _persist(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.{uuid4().hex}.tmp")
        payload = {"version": 1, "bindings": [item.to_dict() for item in self.list()]}
        try:
            temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
            temporary.replace(self.path)
        finally:
            temporary.unlink(missing_ok=True)
