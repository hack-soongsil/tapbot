"""Typed TapBot runtime configuration loaded from backend-only environment data."""

from __future__ import annotations

import argparse
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
import json
import math
import os
from pathlib import Path
import re

from tapbot.android.models import AndroidDeviceConfig


@dataclass(frozen=True, slots=True)
class BackendSettings:
    host: str = "127.0.0.1"
    port: int = 18880


@dataclass(frozen=True, slots=True)
class AndroidSettings:
    devices: tuple[AndroidDeviceConfig, ...] = ()
    default_device_id: str | None = None
    devices_config_path: Path | None = None
    capture_dir: Path = Path("tapbot-captures/android")
    discovery_enabled: bool = True
    discovery_provider: str = "tailscale"
    agent_port: int = 8765
    discovery_interval_sec: float = 30.0
    discovery_timeout_sec: float = 2.0
    discovery_max_concurrency: int = 8
    discovery_token: str | None = field(default=None, repr=False)


@dataclass(frozen=True, slots=True)
class RobotSettings:
    transport: str = "serial"
    serial_port: str | None = None
    baud_rate: int = 115200
    wifi_host: str | None = None
    wifi_port: int = 23
    feed_rate: float = 1000.0
    workspace_width: float = 300.0
    workspace_height: float = 300.0
    tap_dwell_ms: int = 150
    servo_down_command: str = "M3"
    servo_up_command: str = "M5"
    dry_run: bool = False


@dataclass(frozen=True, slots=True)
class CameraSettings:
    source: int | str = 0
    discovery_max_index: int | None = 4
    fps: float = 20.0


@dataclass(frozen=True, slots=True)
class ModelSettings:
    endpoint: str | None = None
    model_name: str | None = None
    api_token: str | None = field(default=None, repr=False)


@dataclass(frozen=True, slots=True)
class TapPointSettings:
    randomization_enabled: bool = True
    edge_inset_ratio: float = 0.15
    sigma_ratio: float = 0.15
    min_jitter_px: float = 1.0
    max_jitter_px: float = 48.0
    max_attempts: int = 8

    def __post_init__(self) -> None:
        if not isinstance(self.randomization_enabled, bool):
            raise ValueError("tap randomization enabled must be a boolean")
        if (
            not math.isfinite(self.edge_inset_ratio)
            or not 0 <= self.edge_inset_ratio < 0.5
        ):
            raise ValueError("tap edge inset ratio must be between 0 and 0.5")
        if not math.isfinite(self.sigma_ratio) or self.sigma_ratio <= 0:
            raise ValueError("tap sigma ratio must be positive and finite")
        if not math.isfinite(self.min_jitter_px) or self.min_jitter_px <= 0:
            raise ValueError("tap minimum jitter must be positive and finite")
        if (
            not math.isfinite(self.max_jitter_px)
            or self.max_jitter_px < self.min_jitter_px
        ):
            raise ValueError("tap maximum jitter must be >= minimum jitter")
        if (
            isinstance(self.max_attempts, bool)
            or not isinstance(self.max_attempts, int)
            or self.max_attempts <= 0
        ):
            raise ValueError("tap max attempts must be a positive integer")


@dataclass(frozen=True, slots=True)
class PathSettings:
    calibration_file: Path = Path("tapbot-calibrations.json")
    macro_trace_dir: Path = Path("tapbot-captures/android")
    macro_definition_dir: Path = Path("tapbot-data/macros")
    macro_bindings_file: Path = Path("tapbot-data/device-macro-bindings.json")


@dataclass(frozen=True, slots=True)
class TapBotConfig:
    backend: BackendSettings = BackendSettings()
    android: AndroidSettings = AndroidSettings()
    robot: RobotSettings = RobotSettings()
    camera: CameraSettings = CameraSettings()
    model: ModelSettings = ModelSettings()
    tap_point: TapPointSettings = TapPointSettings()
    paths: PathSettings = PathSettings()

    def __post_init__(self) -> None:
        if not 1 <= self.backend.port <= 65535:
            raise ValueError("backend port must be between 1 and 65535")
        if self.camera.fps <= 0:
            raise ValueError("camera fps must be positive")
        if self.robot.transport not in {"serial", "wifi"}:
            raise ValueError("robot transport must be 'serial' or 'wifi'")
        if self.robot.baud_rate <= 0:
            raise ValueError("robot baud rate must be positive")
        if self.robot.workspace_width <= 0 or self.robot.workspace_height <= 0:
            raise ValueError("robot workspace dimensions must be positive")
        if not self.robot.dry_run and self.robot.transport == "serial" and not self.robot.serial_port:
            raise ValueError("TAPBOT_GRBL_SERIAL_PORT is required unless dry-run is enabled")
        if not self.robot.dry_run and self.robot.transport == "wifi" and not self.robot.wifi_host:
            raise ValueError("TAPBOT_GRBL_WIFI_HOST is required for Wi-Fi transport")
        enabled_ids = {item.id for item in self.android.devices if item.enabled}
        if self.android.default_device_id is not None and self.android.default_device_id not in enabled_ids:
            raise ValueError("default Android device must reference an enabled device")
        if self.android.discovery_provider != "tailscale":
            raise ValueError("TAPBOT_ANDROID_DISCOVERY_PROVIDER must be 'tailscale'")
        if not 1 <= self.android.agent_port <= 65535:
            raise ValueError("Android Agent port must be between 1 and 65535")
        if self.android.discovery_interval_sec <= 0:
            raise ValueError("Android discovery interval must be positive")
        if self.android.discovery_timeout_sec <= 0:
            raise ValueError("Android discovery timeout must be positive")
        if not 1 <= self.android.discovery_max_concurrency <= 64:
            raise ValueError("Android discovery max concurrency must be between 1 and 64")


def load_config(environ: Mapping[str, str] | None = None) -> TapBotConfig:
    """Read and validate configuration without mutating process environment."""

    env = os.environ if environ is None else environ
    android = _android_settings(env)
    robot = RobotSettings(
        transport=_text(env, "TAPBOT_GRBL_TRANSPORT", "serial").lower(),
        serial_port=_optional(env, "TAPBOT_GRBL_SERIAL_PORT"),
        baud_rate=_integer(env, "TAPBOT_GRBL_BAUD_RATE", 115200),
        wifi_host=_optional(env, "TAPBOT_GRBL_WIFI_HOST"),
        wifi_port=_integer(env, "TAPBOT_GRBL_WIFI_PORT", 23),
        feed_rate=_number(env, "TAPBOT_GRBL_FEED_RATE", 1000.0),
        workspace_width=_number(env, "TAPBOT_WORKSPACE_WIDTH", 300.0),
        workspace_height=_number(env, "TAPBOT_WORKSPACE_HEIGHT", 300.0),
        tap_dwell_ms=_integer(env, "TAPBOT_TAP_DWELL_MS", 150),
        servo_down_command=_text(env, "TAPBOT_SERVO_DOWN_COMMAND", "M3"),
        servo_up_command=_text(env, "TAPBOT_SERVO_UP_COMMAND", "M5"),
        dry_run=_boolean(env, "TAPBOT_DRY_RUN", False),
    )
    return TapBotConfig(
        backend=BackendSettings(
            host=_text(env, "TAPBOT_BACKEND_HOST", "127.0.0.1"),
            port=_integer(env, "TAPBOT_BACKEND_PORT", 18880),
        ),
        android=android,
        robot=robot,
        camera=CameraSettings(
            source=_camera_source(_text(env, "TAPBOT_CAMERA_SOURCE", "0")),
            discovery_max_index=_optional_integer(env, "TAPBOT_CAMERA_MAX_INDEX", 4),
            fps=_number(env, "TAPBOT_CAMERA_FPS", 20.0),
        ),
        model=ModelSettings(
            endpoint=_optional(env, "TAPBOT_MODEL_ENDPOINT"),
            model_name=_optional(env, "TAPBOT_MODEL_NAME"),
            api_token=_optional(env, "TAPBOT_MODEL_API_TOKEN"),
        ),
        tap_point=TapPointSettings(
            randomization_enabled=_boolean(
                env,
                "TAPBOT_TAP_RANDOMIZATION_ENABLED",
                True,
            ),
            edge_inset_ratio=_number(
                env,
                "TAPBOT_TAP_EDGE_INSET_RATIO",
                0.15,
            ),
            sigma_ratio=_number(env, "TAPBOT_TAP_SIGMA_RATIO", 0.15),
            min_jitter_px=_number(env, "TAPBOT_TAP_MIN_JITTER_PX", 1.0),
            max_jitter_px=_number(env, "TAPBOT_TAP_MAX_JITTER_PX", 48.0),
            max_attempts=_integer(env, "TAPBOT_TAP_MAX_ATTEMPTS", 8),
        ),
        paths=PathSettings(
            calibration_file=Path(_text(env, "TAPBOT_CALIBRATION_FILE", "tapbot-calibrations.json")),
            macro_trace_dir=Path(_text(env, "TAPBOT_MACRO_TRACE_DIR", str(android.capture_dir))),
            macro_definition_dir=Path(
                _text(env, "TAPBOT_MACRO_DEFINITION_DIR", "tapbot-data/macros")
            ),
            macro_bindings_file=Path(
                _text(
                    env,
                    "TAPBOT_MACRO_BINDINGS_FILE",
                    "tapbot-data/device-macro-bindings.json",
                )
            ),
        ),
    )


def load_cli_config(argv: Sequence[str] | None = None) -> TapBotConfig:
    """Apply explicit command-line overrides on top of environment settings."""

    parser = argparse.ArgumentParser(description="Run the TapBot API server")
    parser.add_argument("--camera-source", "--camera", type=_camera_source)
    parser.add_argument("--camera-max-index", type=int)
    parser.add_argument("--camera-fps", type=float)
    parser.add_argument("--serial-port")
    parser.add_argument("--baud-rate", type=int)
    parser.add_argument("--feed-rate", type=float)
    parser.add_argument("--workspace-width", type=float)
    parser.add_argument("--workspace-height", type=float)
    parser.add_argument("--tap-dwell-ms", type=int)
    parser.add_argument("--servo-down-command")
    parser.add_argument("--servo-up-command")
    parser.add_argument("--dry-run", action="store_true", default=None)
    parser.add_argument("--calibration-file")
    parser.add_argument("--host")
    parser.add_argument("--port", type=int)
    args = parser.parse_args(argv)

    # Load once without validating the serial requirement so --dry-run can be
    # the value that satisfies it.
    env = dict(os.environ)
    if args.dry_run:
        env["TAPBOT_DRY_RUN"] = "true"
    if args.serial_port is not None:
        env["TAPBOT_GRBL_SERIAL_PORT"] = args.serial_port
    config = load_config(env)
    robot = replace(
        config.robot,
        baud_rate=args.baud_rate if args.baud_rate is not None else config.robot.baud_rate,
        feed_rate=args.feed_rate if args.feed_rate is not None else config.robot.feed_rate,
        workspace_width=args.workspace_width if args.workspace_width is not None else config.robot.workspace_width,
        workspace_height=args.workspace_height if args.workspace_height is not None else config.robot.workspace_height,
        tap_dwell_ms=args.tap_dwell_ms if args.tap_dwell_ms is not None else config.robot.tap_dwell_ms,
        servo_down_command=args.servo_down_command or config.robot.servo_down_command,
        servo_up_command=args.servo_up_command or config.robot.servo_up_command,
    )
    return replace(
        config,
        backend=replace(config.backend, host=args.host or config.backend.host, port=args.port if args.port is not None else config.backend.port),
        robot=robot,
        camera=replace(config.camera, source=args.camera_source if args.camera_source is not None else config.camera.source, discovery_max_index=args.camera_max_index if args.camera_max_index is not None else config.camera.discovery_max_index, fps=args.camera_fps if args.camera_fps is not None else config.camera.fps),
        paths=replace(config.paths, calibration_file=Path(args.calibration_file) if args.calibration_file else config.paths.calibration_file),
    )


def _android_settings(env: Mapping[str, str]) -> AndroidSettings:
    capture_dir = Path(_text(env, "TAPBOT_ANDROID_CAPTURE_DIR", "tapbot-captures/android"))
    token = _optional(env, "TAPBOT_ANDROID_AGENT_TOKEN")
    config_value = _optional(env, "TAPBOT_ANDROID_DEVICES_CONFIG")
    if config_value is not None:
        path = Path(config_value)
        devices, default_id = _load_android_devices(path, env)
    else:
        path = None
        url = _optional(env, "TAPBOT_ANDROID_AGENT_URL")
        if url is not None and token is None:
            raise ValueError("Android Agent URL requires a token")
        devices = (
            ()
            if url is None
            else (AndroidDeviceConfig("default", "Android Device", url, token or ""),)
        )
        default_id = "default" if devices else None
    return AndroidSettings(
        devices=devices,
        default_device_id=default_id,
        devices_config_path=path,
        capture_dir=capture_dir,
        discovery_enabled=_boolean(env, "TAPBOT_ANDROID_DISCOVERY_ENABLED", True),
        discovery_provider=_text(
            env,
            "TAPBOT_ANDROID_DISCOVERY_PROVIDER",
            "tailscale",
        ).lower(),
        agent_port=_integer(env, "TAPBOT_ANDROID_AGENT_PORT", 8765),
        discovery_interval_sec=_number(
            env,
            "TAPBOT_ANDROID_DISCOVERY_INTERVAL_SEC",
            30.0,
        ),
        discovery_timeout_sec=_number(
            env,
            "TAPBOT_ANDROID_DISCOVERY_TIMEOUT_SEC",
            2.0,
        ),
        discovery_max_concurrency=_integer(
            env,
            "TAPBOT_ANDROID_DISCOVERY_MAX_CONCURRENCY",
            8,
        ),
        discovery_token=token,
    )


def _load_android_devices(path: Path, env: Mapping[str, str]) -> tuple[tuple[AndroidDeviceConfig, ...], str | None]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read Android devices config: {path}") from error
    if not isinstance(document, dict) or not isinstance(document.get("devices"), list):
        raise ValueError("Android devices config must contain a devices array")
    raw_default = document.get("default_device_id")
    if raw_default is not None and not isinstance(raw_default, str):
        raise ValueError("default_device_id must be a string")
    devices: list[AndroidDeviceConfig] = []
    seen: set[str] = set()
    for raw in document["devices"]:
        if not isinstance(raw, dict):
            raise ValueError("Each Android device config must be an object")
        device_id = _required(raw, "id")
        if device_id in seen:
            raise ValueError(f"Duplicate Android device id: {device_id}")
        seen.add(device_id)
        enabled = raw.get("enabled", True)
        if not isinstance(enabled, bool):
            raise ValueError(f"Android device {device_id!r} enabled must be a boolean")
        suffix = re.sub(r"[^A-Za-z0-9]", "_", device_id).upper()
        token = env.get(f"TAPBOT_ANDROID_DEVICE_{suffix}_TOKEN", "").strip()
        if not token:
            raw_token = raw.get("token")
            token = raw_token.strip() if isinstance(raw_token, str) else ""
        if enabled and not token:
            raise ValueError("Android device config field 'token' must be a non-empty string")
        devices.append(AndroidDeviceConfig(device_id, _required(raw, "name"), _required(raw, "base_url"), token or "disabled", enabled))
    return tuple(devices), raw_default


def _required(value: dict[str, object], key: str) -> str:
    item = value.get(key)
    if not isinstance(item, str) or not item.strip():
        raise ValueError(f"Android device config field {key!r} must be a non-empty string")
    return item.strip()


def _text(env: Mapping[str, str], name: str, default: str) -> str:
    value = env.get(name, default).strip()
    if not value:
        raise ValueError(f"{name} must not be empty")
    return value


def _optional(env: Mapping[str, str], name: str) -> str | None:
    return env.get(name, "").strip() or None


def _integer(env: Mapping[str, str], name: str, default: int) -> int:
    try:
        return int(env.get(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be an integer") from error


def _optional_integer(env: Mapping[str, str], name: str, default: int | None) -> int | None:
    value = env.get(name)
    if value is None:
        return default
    if value.strip().lower() in {"none", "off", "disabled"}:
        return None
    return _integer(env, name, 0)


def _number(env: Mapping[str, str], name: str, default: float) -> float:
    try:
        return float(env.get(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be numeric") from error


def _boolean(env: Mapping[str, str], name: str, default: bool) -> bool:
    value = env.get(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean")


def _camera_source(value: str) -> int | str:
    try:
        return int(value)
    except ValueError:
        return value
