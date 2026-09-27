import json
from pathlib import Path

import pytest

from tapbot.config import load_cli_config, load_config


def test_load_config_parses_typed_runtime_settings() -> None:
    config = load_config(
        {
            "TAPBOT_DRY_RUN": "true",
            "TAPBOT_BACKEND_HOST": "0.0.0.0",
            "TAPBOT_BACKEND_PORT": "28880",
            "TAPBOT_CAMERA_SOURCE": "opencv:2",
            "TAPBOT_CAMERA_FPS": "12.5",
            "TAPBOT_WORKSPACE_WIDTH": "320",
            "TAPBOT_MODEL_ENDPOINT": "http://model.test/decide",
            "TAPBOT_TAP_RANDOMIZATION_ENABLED": "false",
            "TAPBOT_TAP_EDGE_INSET_RATIO": "0.2",
            "TAPBOT_TAP_SIGMA_RATIO": "0.1",
            "TAPBOT_TAP_MIN_JITTER_PX": "2",
            "TAPBOT_TAP_MAX_JITTER_PX": "36",
            "TAPBOT_TAP_MAX_ATTEMPTS": "5",
            "TAPBOT_MACRO_DEFINITION_DIR": "runtime/macros",
            "TAPBOT_MACRO_BINDINGS_FILE": "runtime/bindings.json",
        }
    )

    assert config.backend.host == "0.0.0.0"
    assert config.backend.port == 28880
    assert config.robot.dry_run is True
    assert config.robot.workspace_width == 320
    assert config.camera.source == "opencv:2"
    assert config.camera.fps == 12.5
    assert config.model.endpoint == "http://model.test/decide"
    assert config.tap_point.randomization_enabled is False
    assert config.tap_point.edge_inset_ratio == 0.2
    assert config.tap_point.sigma_ratio == 0.1
    assert config.tap_point.min_jitter_px == 2
    assert config.tap_point.max_jitter_px == 36
    assert config.tap_point.max_attempts == 5
    assert config.paths.macro_definition_dir == Path("runtime/macros")
    assert config.paths.macro_bindings_file == Path("runtime/bindings.json")


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
    with pytest.raises(ValueError, match="inset"):
        load_config(
            {
                "TAPBOT_DRY_RUN": "true",
                "TAPBOT_TAP_EDGE_INSET_RATIO": "0.5",
            }
        )


def test_cli_values_override_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TAPBOT_DRY_RUN", "true")
    monkeypatch.setenv("TAPBOT_BACKEND_PORT", "9000")
    config = load_cli_config(
        [
            "--port",
            "28880",
            "--camera-source",
            "3",
            "--workspace-width",
            "450",
        ]
    )

    assert config.backend.port == 28880
    assert config.camera.source == 3
    assert config.robot.workspace_width == 450
