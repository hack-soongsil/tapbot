from pathlib import Path
import subprocess

import pytest

from infra.scripts.google_drive_upload import DriveUploadResult
from infra.scripts.publish_android import (
    AndroidVersion,
    PublishError,
    PublishOptions,
    generate_artifact_name,
    parse_android_version,
    publish_android,
    read_git_short_hash,
    resolve_apk,
)


def test_filename_generation_uses_version_and_short_commit() -> None:
    assert (
        generate_artifact_name("0.3.0", "BC0D1E0")
        == "tapbot-agent-v0.3.0-bc0d1e0.apk"
    )
    assert generate_artifact_name("0.3.0", None) == "tapbot-agent-v0.3.0.apk"
    assert generate_artifact_name(None, "bc0d1e0") == "tapbot-agent-bc0d1e0.apk"
    assert generate_artifact_name(None, None) == "tapbot-agent.apk"


def test_version_parser_reads_gradle_kotlin_metadata() -> None:
    version = parse_android_version(
        'defaultConfig {\n  versionCode = 4\n  versionName = "0.3.0"\n}'
    )

    assert version == AndroidVersion(name="0.3.0", code=4)
    assert parse_android_version("defaultConfig {}") == AndroidVersion(None, None)


def test_git_short_hash_is_validated(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def completed(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess([], 0, stdout="bc0d1e0\n", stderr="")

    monkeypatch.setattr(subprocess, "run", completed)
    assert read_git_short_hash(tmp_path) == "bc0d1e0"

    def malformed(*_args: object, **_kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess([], 0, stdout="not-a-hash\n", stderr="")

    monkeypatch.setattr(subprocess, "run", malformed)
    assert read_git_short_hash(tmp_path) is None


def test_missing_apk_fails_before_upload(tmp_path: Path) -> None:
    with pytest.raises(PublishError, match="no debug APK"):
        resolve_apk(tmp_path)
    with pytest.raises(PublishError, match="APK does not exist"):
        resolve_apk(tmp_path, Path("custom.apk"))


def test_apk_discovery_accepts_a_changed_debug_output_path(tmp_path: Path) -> None:
    apk = tmp_path / "android-agent/app/build/outputs/apk/demo/debug/agent-demo.apk"
    apk.parent.mkdir(parents=True)
    apk.write_bytes(b"apk")

    assert resolve_apk(tmp_path) == apk.resolve()


def test_no_build_publish_uses_existing_apk_and_mocked_drive(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    build_file = tmp_path / "android-agent/app/build.gradle.kts"
    build_file.parent.mkdir(parents=True)
    build_file.write_text(
        'versionCode = 4\nversionName = "0.3.0"\n',
        encoding="utf-8",
    )
    apk = tmp_path / "android-agent/app/build/outputs/apk/debug/app-debug.apk"
    apk.parent.mkdir(parents=True)
    apk.write_bytes(b"apk")
    monkeypatch.setattr(
        "infra.scripts.publish_android.read_git_short_hash",
        lambda _root: "bc0d1e0",
    )
    upload_calls: list[tuple[Path, str, str]] = []

    def uploader(
        path: Path,
        *,
        artifact_name: str,
        folder_id: str,
    ) -> DriveUploadResult:
        upload_calls.append((path, artifact_name, folder_id))
        return DriveUploadResult(artifact_name, "file-id")

    result = publish_android(
        PublishOptions(
            repository_root=tmp_path,
            folder_id="target-folder",
            build=False,
        ),
        uploader=uploader,
    )

    assert result.file_id == "file-id"
    assert upload_calls == [
        (apk.resolve(), "tapbot-agent-v0.3.0-bc0d1e0.apk", "target-folder")
    ]


def test_test_flag_is_rejected_when_build_is_disabled(tmp_path: Path) -> None:
    with pytest.raises(PublishError, match="--test"):
        publish_android(
            PublishOptions(repository_root=tmp_path, build=False, run_tests=True),
            uploader=lambda *_args, **_kwargs: DriveUploadResult("x", "y"),
        )


def test_build_failure_never_calls_drive_upload(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    upload_called = False

    def failed_build(*_args: object, **_kwargs: object) -> None:
        raise PublishError("Gradle failed")

    def uploader(*_args: object, **_kwargs: object) -> DriveUploadResult:
        nonlocal upload_called
        upload_called = True
        return DriveUploadResult("x", "y")

    monkeypatch.setattr("infra.scripts.publish_android.build_android", failed_build)
    with pytest.raises(PublishError, match="Gradle failed"):
        publish_android(PublishOptions(repository_root=tmp_path), uploader=uploader)
    assert upload_called is False
