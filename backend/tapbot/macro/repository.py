"""Versioned persistence for reusable macro graph definitions."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
from threading import RLock

from tapbot.macro.graph_models import MacroDefinition
from tapbot.macro.graph_store import FileMacroDefinitionStore


class MacroRepository:
    def __init__(self, store: FileMacroDefinitionStore) -> None:
        self.store = store
        self._lock = RLock()

    def list(self) -> tuple[MacroDefinition, ...]:
        with self._lock:
            return tuple(item.snapshot() for item in self.store.list())

    def get(self, macro_id: str) -> MacroDefinition:
        with self._lock:
            try:
                return self.store.load(macro_id).snapshot()
            except FileNotFoundError as error:
                raise KeyError(f"macro definition {macro_id!r} was not found") from error

    def create(self, definition: MacroDefinition) -> MacroDefinition:
        with self._lock:
            if self._exists(definition.id):
                raise ValueError(f"macro definition {definition.id!r} already exists")
            saved = _stamp_updated_at(replace(
                definition.snapshot(),
                version=max(1, definition.version),
            ))
            self.store.save(saved)
            return saved.snapshot()

    def save(self, definition: MacroDefinition) -> MacroDefinition:
        """Create or update, bumping versions for existing definitions."""
        with self._lock:
            if not self._exists(definition.id):
                return self.create(definition)
            current = self.store.load(definition.id)
            saved = _stamp_updated_at(replace(
                definition.snapshot(),
                version=current.version + 1,
            ))
            self.store.save(saved)
            return saved.snapshot()

    def delete(self, macro_id: str) -> bool:
        with self._lock:
            return self.store.delete(macro_id)

    def duplicate(
        self,
        macro_id: str,
        *,
        new_id: str,
        name: str | None = None,
    ) -> MacroDefinition:
        source = self.get(macro_id)
        return self.create(
            replace(source, id=new_id, name=name or f"{source.name} Copy", version=1)
        )

    def _exists(self, macro_id: str) -> bool:
        try:
            self.store.load(macro_id)
        except FileNotFoundError:
            return False
        return True


def _stamp_updated_at(definition: MacroDefinition) -> MacroDefinition:
    return replace(
        definition,
        metadata={
            **definition.metadata,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
