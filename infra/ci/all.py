"""Run all independent TapBot validation entrypoints."""

from __future__ import annotations

import argparse

from common import PYTHON, REPOSITORY_ROOT, run


CI_ROOT = REPOSITORY_ROOT / "infra/ci"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-install",
        action="store_true",
        help="Skip Python and npm dependency installation.",
    )
    parser.add_argument(
        "--artifact-root",
        help="Collect domain artifacts below this directory.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    backend = [PYTHON, CI_ROOT / "backend.py"]
    frontend = [PYTHON, CI_ROOT / "frontend.py"]
    android = [PYTHON, CI_ROOT / "android.py"]
    if args.skip_install:
        backend.append("--skip-install")
        frontend.append("--skip-install")
    if args.artifact_root:
        backend.extend(("--artifact-dir", f"{args.artifact_root}/backend"))
        frontend.extend(("--artifact-dir", f"{args.artifact_root}/frontend"))
        android.extend(("--artifact-dir", f"{args.artifact_root}/android"))

    for command in (backend, frontend, android):
        run(command)


if __name__ == "__main__":
    main()
