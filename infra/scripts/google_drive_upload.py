"""Narrow Google Drive upload boundary for Android APK artifacts."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any


DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
APK_MIME_TYPE = "application/vnd.android.package-archive"


class DriveUploadError(RuntimeError):
    """A safe, user-facing Google Drive authentication or upload failure."""


@dataclass(frozen=True, slots=True)
class DriveUploadResult:
    name: str
    file_id: str
    web_view_link: str | None = None


def upload_apk(
    apk_path: Path,
    *,
    artifact_name: str,
    folder_id: str,
    service: Any | None = None,
    media_factory: Callable[..., Any] | None = None,
) -> DriveUploadResult:
    """Create a new Drive file without listing, replacing, or deleting artifacts."""

    if not apk_path.is_file():
        raise FileNotFoundError(f"APK does not exist: {apk_path}")
    if not folder_id.strip():
        raise DriveUploadError("Google Drive folder ID must not be empty")

    if service is None or media_factory is None:
        built_service, built_media_factory = _google_client()
        service = service or built_service
        media_factory = media_factory or built_media_factory

    metadata = {
        "name": artifact_name,
        "parents": [folder_id],
        "mimeType": APK_MIME_TYPE,
    }
    media = media_factory(
        str(apk_path),
        mimetype=APK_MIME_TYPE,
        resumable=True,
    )
    try:
        response = (
            service.files()
            .create(
                body=metadata,
                media_body=media,
                fields="id,name,webViewLink",
                supportsAllDrives=True,
            )
            .execute()
        )
    except Exception as error:
        status = getattr(getattr(error, "resp", None), "status", None)
        if status in {401, 403}:
            message = (
                "Google Drive authentication failed or the target folder is not "
                "shared with this credential"
            )
        elif status == 404:
            message = "Google Drive target folder was not found or is inaccessible"
        else:
            message = "Google Drive APK upload failed"
        raise DriveUploadError(message) from error

    if not isinstance(response, Mapping):
        raise DriveUploadError("Google Drive returned an invalid upload response")
    file_id = response.get("id")
    response_name = response.get("name")
    web_view_link = response.get("webViewLink")
    if not isinstance(file_id, str) or not file_id:
        raise DriveUploadError("Google Drive upload response did not include a file ID")
    return DriveUploadResult(
        name=response_name if isinstance(response_name, str) else artifact_name,
        file_id=file_id,
        web_view_link=web_view_link if isinstance(web_view_link, str) else None,
    )


def _google_client() -> tuple[Any, Callable[..., Any]]:
    configured_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if configured_path and not Path(configured_path).expanduser().is_file():
        raise DriveUploadError(
            "GOOGLE_APPLICATION_CREDENTIALS points to a file that does not exist"
        )
    try:
        import google.auth
        from google.auth.exceptions import DefaultCredentialsError
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError as error:
        raise DriveUploadError(
            'Google Drive dependencies are missing. Install with: pip install -e ".[publish]"'
        ) from error

    try:
        credentials, _ = google.auth.default(scopes=[DRIVE_FILE_SCOPE])
    except DefaultCredentialsError as error:
        raise DriveUploadError(
            "Google credentials were not found. Set GOOGLE_APPLICATION_CREDENTIALS "
            "or configure Application Default Credentials."
        ) from error

    service = build(
        "drive",
        "v3",
        credentials=credentials,
        cache_discovery=False,
    )
    return service, MediaFileUpload
