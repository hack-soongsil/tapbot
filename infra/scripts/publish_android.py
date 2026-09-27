"""Build the Android Agent debug APK and publish it to Google Drive."""

from __future__ import annotations

import argparse
from collections.abc import Callable, Sequence
from dataclasses import dataclass
import os
from pathlib import Path
import re
import subprocess
import sys

try:
    from .google_drive_upload import DriveUploadError, DriveUploadResult, upload_apk
except ImportError:  # Direct script execution: python infra/scripts/publish_android.py
    from google_drive_upload import DriveUploadError, DriveUploadResult, upload_apk


DEFAULT_FOLDER_ID = "1yLW1u4_cV4QuHXOCX9-llmKKCZlkzBA2"
DEFAULT_APK = Path("android-agent/app/build/outputs/apk/debug/app-debug.apk")
ANDROID_BUILD_FILE = Path("android-agent/app/build.gradle.kts")
_VERSION_NAME = re.compile(r'\bversionName\s*=\s*["\']([^"\']+)["\']')
_VERSION_CODE = re.compile(r"\bversionCode\s*=\s*(\d+)")
_GIT_HASH = re.compile(r"^[0-9a-fA-F]{7,40}$")


class PublishError(RuntimeError):
    """A user-actionable local build or metadata failure."""


@dataclass(frozen=True, slots=True)
class AndroidVersion:
    name: str | None
    code: int | None


@dataclass(frozen=True, slots=True)
class PublishOptions:
    repository_root: Path
    folder_id: str = DEFAULT_FOLDER_ID
    apk: Path | None = None
    build: bool = True
    run_tests: bool = False
    include_commit: bool = True


Uploader = Callable[..., DriveUploadResult]


def find_repository_root(start: Path | None = None) -> Path:
    current = (start or Path(__file__)).resolve()
    if current.is_file():
        current = current.parent
    for candidate in (current, *current.parents):
        if (candidate / "package.json").is_file() and (
            candidate / "android-agent"
        ).is_dir():
            return candidate
    raise PublishError("Could not locate the TapBot repository root")


def parse_android_version(content: str) -> AndroidVersion:
    name_match = _VERSION_NAME.search(content)
    code_match = _VERSION_CODE.search(content)
    return AndroidVersion(
        name=name_match.group(1).strip() if name_match else None,
        code=int(code_match.group(1)) if code_match else None,
    )


def read_android_version(repository_root: Path) -> AndroidVersion:
    path = repository_root / ANDROID_BUILD_FILE
    try:
        return parse_android_version(path.read_text(encoding="utf-8"))
    except OSError:
        return AndroidVersion(None, None)


def generate_artifact_name(
    version_name: str | None,
    short_commit: str | None,
) -> str:
    parts = ["tapbot-agent"]
    if version_name:
        safe_version = re.sub(r"[^0-9A-Za-z._-]+", "-", version_name).strip("-")
        if safe_version:
            parts.append(f"v{safe_version}")
    if short_commit:
        if not _GIT_HASH.fullmatch(short_commit):
            raise ValueError("Git commit hash must contain 7 to 40 hexadecimal characters")
        parts.append(short_commit.lower())
    return "-".join(parts) + ".apk"


def read_git_short_hash(repository_root: Path) -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=repository_root,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except (FileNotFoundError, OSError, subprocess.CalledProcessError):
        return None
    value = result.stdout.strip()
    return value.lower() if _GIT_HASH.fullmatch(value) else None


def gradle_command(repository_root: Path, *, run_tests: bool) -> list[str]:
    android_root = repository_root / "android-agent"
    wrapper = android_root / ("gradlew.bat" if os.name == "nt" else "gradlew")
    if not wrapper.is_file():
        raise PublishError(f"Gradle wrapper does not exist: {wrapper}")
    tasks = ["test", "assembleDebug"] if run_tests else ["assembleDebug"]
    if os.name == "nt":
        return [str(wrapper), *tasks]
    return [str(wrapper), *tasks]


def build_android(
    repository_root: Path,
    *,
    run_tests: bool,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> None:
    command = gradle_command(repository_root, run_tests=run_tests)
    print(f"[build] {' '.join(command)}", flush=True)
    try:
        runner(
            command,
            cwd=repository_root / "android-agent",
            check=True,
        )
    except subprocess.CalledProcessError as error:
        raise PublishError(
            f"Android Gradle build failed with exit code {error.returncode}"
        ) from error
    except OSError as error:
        raise PublishError(f"Android Gradle build could not start: {error}") from error


def resolve_apk(repository_root: Path, requested: Path | None = None) -> Path:
    if requested is not None:
        candidate = requested if requested.is_absolute() else repository_root / requested
    else:
        candidate = repository_root / DEFAULT_APK
    candidate = candidate.resolve()
    if candidate.is_file():
        return candidate
    if requested is not None:
        raise PublishError(f"APK does not exist: {candidate}")

    outputs_directory = repository_root / "android-agent/app/build/outputs/apk"
    alternatives = sorted(
        path.resolve()
        for path in outputs_directory.rglob("*.apk")
        if "androidTest" not in path.parts
        and "androidTest" not in path.name
        and ("debug" in path.parts or "debug" in path.stem.lower())
    )
    if len(alternatives) == 1:
        return alternatives[0]
    if alternatives:
        names = ", ".join(path.name for path in alternatives)
        raise PublishError(f"Multiple debug APKs were found; select one with --apk: {names}")
    raise PublishError(
        "Gradle completed but no debug APK was found under "
        f"{outputs_directory}"
    )


def publish_android(
    options: PublishOptions,
    *,
    uploader: Uploader = upload_apk,
) -> DriveUploadResult:
    root = options.repository_root.resolve()
    if options.run_tests and not options.build:
        raise PublishError("--test cannot be combined with --no-build")
    if options.build:
        build_android(root, run_tests=options.run_tests)

    apk = resolve_apk(root, options.apk)
    version = read_android_version(root)
    if version.name is None:
        print("[warning] Android versionName could not be read; using fallback name.")
    commit = read_git_short_hash(root) if options.include_commit else None
    if options.include_commit and commit is None:
        print("[warning] Git commit hash is unavailable; omitting it from the name.")
    artifact_name = generate_artifact_name(version.name, commit)

    print(f"[artifact] APK: {apk}")
    print(
        f"[artifact] Android version: {version.name or 'unknown'} "
        f"(code {version.code if version.code is not None else 'unknown'})"
    )
    print(f"[artifact] Upload name: {artifact_name}")
    print(f"[upload] Google Drive folder: {options.folder_id}")
    result = uploader(
        apk,
        artifact_name=artifact_name,
        folder_id=options.folder_id,
    )
    print(f"[uploaded] File: {result.name}")
    print(f"[uploaded] File ID: {result.file_id}")
    print(f"[uploaded] Folder ID: {options.folder_id}")
    if result.web_view_link:
        print(f"[uploaded] Drive URL: {result.web_view_link}")
    return result


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--test",
        action="store_true",
        help="Run Gradle tests before assembling the debug APK.",
    )
    parser.add_argument(
        "--no-build",
        action="store_true",
        help="Upload an existing APK without invoking Gradle.",
    )
    parser.add_argument(
        "--apk",
        type=Path,
        help="APK path relative to the repository root, or an absolute path.",
    )
    parser.add_argument(
        "--folder-id",
        default=DEFAULT_FOLDER_ID,
        help="Override the target Google Drive folder ID.",
    )
    parser.add_argument(
        "--no-commit",
        action="store_true",
        help="Omit the Git commit hash from the uploaded artifact name.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    apk: Path | None = args.apk
    options: PublishOptions | None = None
    try:
        options = PublishOptions(
            repository_root=find_repository_root(),
            folder_id=args.folder_id,
            apk=apk,
            build=not args.no_build,
            run_tests=args.test,
            include_commit=not args.no_commit,
        )
        publish_android(options)
    except DriveUploadError as error:
        try:
            artifact = resolve_apk(options.repository_root, apk) if options else None
        except PublishError:
            artifact = None
        print(f"[error] Upload failed: {error}", file=sys.stderr)
        if artifact is not None:
            print(f"[error] Built APK remains at: {artifact}", file=sys.stderr)
        return 1
    except PublishError as error:
        print(f"[error] {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
