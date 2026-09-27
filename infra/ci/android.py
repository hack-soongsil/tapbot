"""Run Android Agent unit tests, build its debug APK, and collect the artifact."""

from __future__ import annotations

import argparse
import os
import shutil

from common import REPOSITORY_ROOT, artifact_directory, run


ANDROID_ROOT = REPOSITORY_ROOT / "android-agent"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--artifact-dir",
        help="Copy the debug APK into this directory after validation.",
    )
    return parser.parse_args()


def gradle_command() -> list[str]:
    if os.name == "nt":
        return [str(ANDROID_ROOT / "gradlew.bat")]
    return ["bash", str(ANDROID_ROOT / "gradlew")]


def main() -> None:
    args = parse_args()
    wrapper = gradle_command()
    run([*wrapper, "--no-daemon", "testDebugUnitTest", "assembleDebug"], cwd=ANDROID_ROOT)

    artifacts = artifact_directory(args.artifact_dir)
    if artifacts is not None:
        apk = ANDROID_ROOT / "app/build/outputs/apk/debug/app-debug.apk"
        if not apk.is_file():
            raise FileNotFoundError(f"Gradle succeeded but did not create {apk}")
        destination = artifacts / "tapbot-android-agent-debug.apk"
        shutil.copy2(apk, destination)
        print(f"Created {destination}", flush=True)


if __name__ == "__main__":
    main()
