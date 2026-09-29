from __future__ import annotations

import json
from pathlib import Path

from scripts.dev import configure_mock_android


def generated_document(environment: dict[str, str]) -> dict[str, object]:
    path = Path(environment["TAPBOT_ANDROID_DEVICES_CONFIG"])
    return json.loads(path.read_text(encoding="utf-8"))


def test_mock_is_added_without_replacing_single_url_device(tmp_path: Path) -> None:
    environment = {
        "TAPBOT_ANDROID_AGENT_URL": "http://100.64.0.10:8765",
        "TAPBOT_ANDROID_AGENT_TOKEN": "real-token",
    }

    configure_mock_android(
        environment,
        mock_url="http://127.0.0.1:28765",
        mock_token="mock-token",
        config_dir=tmp_path,
    )

    document = generated_document(environment)
    assert document["default_device_id"] == "default"
    assert [device["id"] for device in document["devices"]] == [
        "default",
        "local-mock",
    ]
    assert environment["TAPBOT_ANDROID_DEVICE_DEFAULT_TOKEN"] == "real-token"
    assert environment["TAPBOT_ANDROID_DEVICE_LOCAL_MOCK_TOKEN"] == "mock-token"
    assert "TAPBOT_ANDROID_AGENT_URL" not in environment


def test_mock_is_appended_to_existing_multi_device_config(tmp_path: Path) -> None:
    source = tmp_path / "configured.json"
    source.write_text(
        json.dumps(
            {
                "default_device_id": "phone-a",
                "devices": [
                    {
                        "id": "phone-a",
                        "name": "Phone A",
                        "base_url": "http://phone-a.test:8765",
                        "token": "configured-token",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    generated_dir = tmp_path / "generated"
    generated_dir.mkdir()
    environment = {"TAPBOT_ANDROID_DEVICES_CONFIG": str(source)}

    configure_mock_android(
        environment,
        mock_url="http://127.0.0.1:28765",
        mock_token="mock-token",
        config_dir=generated_dir,
    )

    document = generated_document(environment)
    assert document["default_device_id"] == "phone-a"
    assert [device["id"] for device in document["devices"]] == [
        "phone-a",
        "local-mock",
    ]
