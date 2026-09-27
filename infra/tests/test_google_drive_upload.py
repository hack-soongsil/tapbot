from pathlib import Path

import pytest

from infra.scripts.google_drive_upload import (
    APK_MIME_TYPE,
    DriveUploadError,
    upload_apk,
)


class FakeRequest:
    def __init__(self, response: object = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error

    def execute(self) -> object:
        if self.error is not None:
            raise self.error
        return self.response


class FakeFiles:
    def __init__(self, request: FakeRequest) -> None:
        self.request = request
        self.create_kwargs: dict[str, object] | None = None

    def create(self, **kwargs: object) -> FakeRequest:
        self.create_kwargs = kwargs
        return self.request


class FakeService:
    def __init__(self, request: FakeRequest) -> None:
        self.resource = FakeFiles(request)

    def files(self) -> FakeFiles:
        return self.resource


class FakeHttpError(Exception):
    def __init__(self, status: int) -> None:
        self.resp = type("Response", (), {"status": status})()


def test_upload_creates_a_new_apk_in_the_requested_folder(tmp_path: Path) -> None:
    apk = tmp_path / "app-debug.apk"
    apk.write_bytes(b"apk")
    service = FakeService(
        FakeRequest(
            {
                "id": "drive-file-id",
                "name": "tapbot-agent-v0.3.0-abcdef0.apk",
                "webViewLink": "https://drive.example/file",
            }
        )
    )
    media_calls: list[tuple[str, str, bool]] = []

    def media_factory(path: str, *, mimetype: str, resumable: bool) -> object:
        media_calls.append((path, mimetype, resumable))
        return object()

    result = upload_apk(
        apk,
        artifact_name="tapbot-agent-v0.3.0-abcdef0.apk",
        folder_id="folder-id",
        service=service,
        media_factory=media_factory,
    )

    assert result.file_id == "drive-file-id"
    assert result.web_view_link == "https://drive.example/file"
    assert service.resource.create_kwargs is not None
    assert service.resource.create_kwargs["body"] == {
        "name": "tapbot-agent-v0.3.0-abcdef0.apk",
        "parents": ["folder-id"],
        "mimeType": APK_MIME_TYPE,
    }
    assert service.resource.create_kwargs["supportsAllDrives"] is True
    assert media_calls == [(str(apk), APK_MIME_TYPE, True)]


@pytest.mark.parametrize(
    ("status", "message"),
    [
        (403, "authentication failed"),
        (404, "not found"),
        (500, "upload failed"),
    ],
)
def test_upload_maps_drive_failures_without_dumping_response(
    tmp_path: Path,
    status: int,
    message: str,
) -> None:
    apk = tmp_path / "app-debug.apk"
    apk.write_bytes(b"apk")
    service = FakeService(FakeRequest(error=FakeHttpError(status)))

    with pytest.raises(DriveUploadError, match=message):
        upload_apk(
            apk,
            artifact_name="agent.apk",
            folder_id="folder-id",
            service=service,
            media_factory=lambda *_args, **_kwargs: object(),
        )
