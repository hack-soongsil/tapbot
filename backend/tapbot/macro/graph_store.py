"""Config-rooted JSON persistence for macro definitions."""

from __future__ import annotations

from pathlib import Path
import re
from uuid import uuid4

from tapbot.macro.graph_models import MacroDefinition
from tapbot.macro.graph_validator import GraphValidator


_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class FileMacroDefinitionStore:
    """Persist definitions below an injected root without owning app config."""

    def __init__(
        self,
        root: str | Path,
        *,
        validator: GraphValidator | None = None,
    ) -> None:
        self.root = Path(root)
        self.validator = validator

    def save(self, definition: MacroDefinition) -> Path:
        if self.validator is not None:
            self.validator.validate_or_raise(definition)
        destination = self._path(definition.id)
        self.root.mkdir(parents=True, exist_ok=True)
        temporary = self.root / f".{definition.id}.{uuid4().hex}.tmp"
        try:
            temporary.write_text(definition.to_json() + "\n", encoding="utf-8")
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        return destination

    def load(self, definition_id: str) -> MacroDefinition:
        definition = MacroDefinition.from_json(
            self._path(definition_id).read_text(encoding="utf-8")
        )
        if self.validator is not None:
            self.validator.validate_or_raise(definition)
        return definition

    def list(self) -> tuple[MacroDefinition, ...]:
        if not self.root.exists():
            return ()
        return tuple(
            self.load(path.stem)
            for path in sorted(self.root.glob("*.json"), key=lambda item: item.name)
        )

    def delete(self, definition_id: str) -> bool:
        path = self._path(definition_id)
        if not path.exists():
            return False
        path.unlink()
        return True

    def _path(self, definition_id: str) -> Path:
        if not _SAFE_ID.fullmatch(definition_id) or definition_id in {".", ".."}:
            raise ValueError("macro id is not safe for file storage")
        return self.root / f"{definition_id}.json"
