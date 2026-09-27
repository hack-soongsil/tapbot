"""Install, validate, test, and optionally package the Python backend."""

from __future__ import annotations

import argparse

from common import PYTHON, REPOSITORY_ROOT, artifact_directory, python_environment, run


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-install",
        action="store_true",
        help="Use the current environment instead of installing backend test dependencies.",
    )
    parser.add_argument(
        "--artifact-dir",
        help="Build a backend wheel into this directory after validation.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.skip_install:
        run([PYTHON, "-m", "pip", "install", "-e", ".[test]"])

    environment = python_environment()
    run(
        [PYTHON, "-m", "compileall", "-q", "backend/tapbot"],
        env=environment,
    )
    run(
        [
            PYTHON,
            "-c",
            (
                "import tapbot.app, tapbot.android.service, tapbot.macro.service, "
                "tapbot.robot.service, tapbot.vision.service"
            ),
        ],
        env=environment,
    )
    run([PYTHON, "-m", "pytest"], env=environment)

    artifacts = artifact_directory(args.artifact_dir)
    if artifacts is not None:
        run(
            [
                PYTHON,
                "-m",
                "pip",
                "wheel",
                ".",
                "--no-deps",
                "--wheel-dir",
                artifacts,
            ]
        )


if __name__ == "__main__":
    main()
