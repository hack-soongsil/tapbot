"""Shared helpers for TapBot CI entrypoints."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Mapping, Sequence


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def executable(name: str) -> str:
    """Return the platform-specific executable name when it is available."""

    candidates = [name]
    if os.name == "nt":
        candidates.insert(0, f"{name}.cmd")
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return candidates[0]


def run(
    command: Sequence[str | Path],
    *,
    cwd: Path = REPOSITORY_ROOT,
    env: Mapping[str, str] | None = None,
) -> None:
    """Run one validation command without printing environment variables."""

    rendered = [str(part) for part in command]
    print(f"[{cwd}] {' '.join(rendered)}", flush=True)
    subprocess.run(rendered, cwd=cwd, env=env, check=True)


def artifact_directory(value: str | None) -> Path | None:
    if value is None:
        return None
    path = Path(value)
    if not path.is_absolute():
        path = REPOSITORY_ROOT / path
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def python_environment() -> dict[str, str]:
    """Make the source-layout package importable without an editable install."""

    environment = os.environ.copy()
    backend = str(REPOSITORY_ROOT / "backend")
    current = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = (
        backend if not current else os.pathsep.join((backend, current))
    )
    return environment


PYTHON = sys.executable
