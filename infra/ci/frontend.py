"""Install, check, test, build, and optionally package the React frontend."""

from __future__ import annotations

import argparse
import shutil

from common import REPOSITORY_ROOT, artifact_directory, executable, run


FRONTEND_ROOT = REPOSITORY_ROOT / "frontend"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-install",
        action="store_true",
        help="Use the existing node_modules instead of running npm ci.",
    )
    parser.add_argument(
        "--artifact-dir",
        help="Package frontend/dist into this directory after validation.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    npm = executable("npm")
    if not args.skip_install:
        run([npm, "ci"], cwd=FRONTEND_ROOT)

    for script in ("lint", "typecheck", "test", "build"):
        run([npm, "run", script], cwd=FRONTEND_ROOT)

    artifacts = artifact_directory(args.artifact_dir)
    if artifacts is not None:
        archive = artifacts / "tapbot-frontend"
        shutil.make_archive(str(archive), "zip", FRONTEND_ROOT / "dist")
        print(f"Created {archive.with_suffix('.zip')}", flush=True)


if __name__ == "__main__":
    main()
