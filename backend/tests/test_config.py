import json
from pathlib import Path

import pytest

from tapbot.config import load_cli_config, load_config


def test_load_config_parses_typed_runtime_settings() -> None:
    config = load_config(
        {
            "TAPBOT_DRY_RUN": "true",
            "TAPBOT_BACKEND_HOST": "0.0.0.0",
            "TAPBOT_BACKEND_PORT": "18000",
            "TAPBOT_CAMERA_SOURCE": "opencv:2",
            "TAPBOT_CAMERA_FPS": "12.5",
            "TAPBOT_WORKSPACE_WIDTH": "320",
            "TAPBOT_MODEL_ENDPOINT": "http://model.test/decide",
        }
    )

    assert config.backend.host == "0.0.0.0"
    assert config.backend.port == 18000
    assert config.robot.dry_run is True
    assert config.robot.workspace_width == 320
    assert config.camera.source == "opencv:2"
    assert config.camera.fps == 12.5
    assert config.model.endpoint == "http://model.test/decide"


def test_android_tokens_are_overridden_and_redacted(
    tmp_path: Path,
) -> None:
    path = tmp_path / "devices.json"
    path.write_text(
        json.dumps(
            {
                "default_device_id": "phone",
                "devices": [
                    {
                        "id": "phone",
                        "name": "Phone",
                        "base_url": "http://phone:8765",
                        "token": "file-secret",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    config = load_config(
        {
            "TAPBOT_DRY_RUN": "true",
            "TAPBOT_ANDROID_DEVICES_CONFIG": str(path),
            "TAPBOT_ANDROID_DEVICE_PHONE_TOKEN": "environment-secret",
            "TAPBOT_MODEL_API_TOKEN": "model-secret",
        }
    )

    assert config.android.devices[0].token == "environment-secret"
    rendered = repr(config)
    assert "environment-secret" not in rendered
    assert "file-secret" not in rendered
    assert "model-secret" not in rendered


def test_invalid_or_partial_hardware_configuration_is_rejected() -> None:
    with pytest.raises(ValueError, match="SERIAL"):
        load_config({})
    with pytest.raises(ValueError, match="requires a token"):
        load_config(
            {
                "TAPBOT_DRY_RUN": "true",
                "TAPBOT_ANDROID_AGENT_URL": "http://phone:8765",
            }
        )

    discovery_only = load_config(
        {
            "TAPBOT_ANDROID_AGENT_TOKEN": "discovery-secret",
            "TAPBOT_ANDROID_DISCOVERY_INTERVAL_SEC": "25",
            "TAPBOT_ANDROID_DISCOVERY_TIMEOUT_SEC": "1.5",
            "TAPBOT_ANDROID_AGENT_PORT": "8765",
            "TAPBOT_DRY_RUN": "true",
        }
    )
    assert discovery_only.android.devices == ()
    assert discovery_only.android.discovery_enabled is True
    assert discovery_only.android.discovery_token == "discovery-secret"
    assert discovery_only.android.discovery_interval_sec == 25
    assert discovery_only.android.discovery_timeout_sec == 1.5
    assert "discovery-secret" not in repr(discovery_only.android)
    with pytest.raises(ValueError, match="port"):
        load_config(
            {
                "TAPBOT_DRY_RUN": "true",
                "TAPBOT_BACKEND_PORT": "70000",
            }
        )


def test_cli_values_override_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAPBOT_DRY_RUN", "true")
    monkeypatch.setenv("TAPBOT_BACKEND_PORT", "9000")
    config = load_cli_config(
        [
            "--port",
            "18000",
            "--camera-source",
            "3",
            "--workspace-width",
            "450",
        ]
    )

    assert config.backend.port == 18000
    assert config.camera.source == 3
    assert config.robot.workspace_width == 450
