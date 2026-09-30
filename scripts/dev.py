"""Run the TapBot API and Vite development server together."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
BACKEND_IMPORTS = (
    "fastapi",
    "numpy",
    "cv2",
    "PIL",
    "serial",
    "uvicorn",
)


def load_local_environment() -> None:
    """Load ignored backend secrets without overriding the caller's shell."""

    path = ROOT / ".env.local"
    if not path.is_file():
        return
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise RuntimeError(f"Invalid .env.local line {line_number}")
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip()
        if value.startswith(('"', "'")) and value.endswith(value[:1]):
            value = value[1:-1]
        if not name or not name.replace("_", "").isalnum():
            raise RuntimeError(f"Invalid .env.local key on line {line_number}")
        os.environ.setdefault(name, value)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--mock-android",
        action="store_true",
        help="start a local three-screen Android Agent mock",
    )
    parser.add_argument("--mock-android-port", type=int, default=28765)
    parser.add_argument("--camera-source", default="0")
    parser.add_argument(
        "--serial-port",
        default=os.getenv("TAPBOT_GRBL_SERIAL_PORT"),
        help="GRBL serial port (or set TAPBOT_GRBL_SERIAL_PORT)",
    )
    parser.add_argument("--backend-port", type=int, default=18880)
    parser.add_argument("--frontend-port", type=int, default=15180)
    return parser.parse_args()


def npm_command() -> str:
    executable = "npm.cmd" if os.name == "nt" else "npm"
    resolved = shutil.which(executable)
    if resolved is None:
        raise RuntimeError("npm을 찾을 수 없습니다. Node.js를 먼저 설치해 주세요.")
    return resolved


def bootstrap(npm: str) -> None:
    missing_imports = [
        name for name in BACKEND_IMPORTS if importlib.util.find_spec(name) is None
    ]
    if missing_imports:
        print("[setup] Python 의존성을 설치합니다.", flush=True)
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-e", str(ROOT)],
            cwd=ROOT,
            check=True,
        )

    if not (FRONTEND / "node_modules").is_dir():
        print("[setup] Frontend 의존성을 설치합니다.", flush=True)
        subprocess.run([npm, "ci"], cwd=FRONTEND, check=True)


def process_options() -> dict[str, object]:
    if os.name == "nt":
        # Keep both children in the current console group so Ctrl+C reaches
        # the launcher, Uvicorn, and Vite together on Windows.
        return {}
    return {"start_new_session": True}


def available_port(preferred: int) -> int:
    for port in range(preferred, preferred + 100):
        candidates: list[socket.socket] = []
        try:
            for family, address in (
                (socket.AF_INET, ("127.0.0.1", port)),
                (socket.AF_INET6, ("::1", port)),
            ):
                candidate = socket.socket(family, socket.SOCK_STREAM)
                candidates.append(candidate)
                if family == socket.AF_INET6:
                    candidate.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                candidate.bind(address)
            return port
        except OSError:
            continue
        finally:
            for candidate in candidates:
                candidate.close()
    raise RuntimeError(f"{preferred}번부터 사용 가능한 포트를 찾지 못했습니다.")


def configure_mock_android(
    environment: dict[str, str],
    *,
    mock_url: str,
    mock_token: str,
    config_dir: Path,
) -> None:
    """Add the local mock as a normal device without replacing real devices."""

    devices: list[object] = []
    default_device_id: object = None
    configured_path = environment.get("TAPBOT_ANDROID_DEVICES_CONFIG", "").strip()
    if configured_path:
        source = Path(configured_path)
        if not source.is_absolute():
            source = ROOT / source
        try:
            document = json.loads(source.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(
                f"Could not read Android devices config for local mock: {source}"
            ) from error
        if not isinstance(document, dict) or not isinstance(
            document.get("devices"), list
        ):
            raise RuntimeError("Android devices config must contain a devices array")
        devices.extend(document["devices"])
        default_device_id = document.get("default_device_id")
    else:
        configured_url = environment.get("TAPBOT_ANDROID_AGENT_URL", "").strip()
        if configured_url:
            devices.append(
                {
                    "id": "default",
                    "name": "Android Device",
                    "base_url": configured_url,
                }
            )
            default_device_id = "default"
            configured_token = environment.get(
                "TAPBOT_ANDROID_AGENT_TOKEN", ""
            ).strip()
            if configured_token:
                environment["TAPBOT_ANDROID_DEVICE_DEFAULT_TOKEN"] = configured_token

    configured_ids = {
        item.get("id") for item in devices if isinstance(item, dict)
    }
    if "local-mock" in configured_ids:
        raise RuntimeError(
            "Android device id 'local-mock' is reserved by --mock-android"
        )
    devices.append(
        {
            "id": "local-mock",
            "name": "Local Mock Android",
            "base_url": mock_url,
        }
    )
    if default_device_id is None and len(devices) == 1:
        default_device_id = "local-mock"

    generated_config = config_dir / "android-devices.json"
    generated_config.write_text(
        json.dumps(
            {
                "devices": devices,
                "default_device_id": default_device_id,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    environment.pop("TAPBOT_ANDROID_AGENT_URL", None)
    environment["TAPBOT_ANDROID_DEVICES_CONFIG"] = str(generated_config)
    environment["TAPBOT_ANDROID_DEVICE_LOCAL_MOCK_TOKEN"] = mock_token


def stop_process_tree(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return

    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return

    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)


def main() -> int:
    mock_config_dir: tempfile.TemporaryDirectory[str] | None = None
    try:
        load_local_environment()
        args = parse_args()
        if not args.dry_run and not args.serial_port:
            print(
                "[dev] TAPBOT_GRBL_SERIAL_PORT is not set; starting in safe "
                "dry-run mode.",
                flush=True,
            )
            args.dry_run = True
        npm = npm_command()
        bootstrap(npm)
        backend_port = available_port(args.backend_port)
        if backend_port != args.backend_port:
            raise RuntimeError(
                f"Backend port {args.backend_port} is already in use. "
                "Stop the existing TapBot server before starting another one; "
                "multiple processes cannot safely share a camera device."
            )
        frontend_port = available_port(args.frontend_port)
        mock_android_port = (
            available_port(args.mock_android_port) if args.mock_android else None
        )
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"[dev] 준비 실패: {error}", file=sys.stderr)
        return 1

    backend_command = [
        sys.executable,
        "-m",
        "tapbot.app",
        "--camera-source",
        args.camera_source,
        "--port",
        str(backend_port),
    ]
    if args.dry_run:
        backend_command.append("--dry-run")
    else:
        assert args.serial_port is not None
        backend_command.extend(("--serial-port", args.serial_port))

    backend_environment = os.environ.copy()
    mock_android: subprocess.Popen[bytes] | None = None
    if mock_android_port is not None:
        mock_url = f"http://127.0.0.1:{mock_android_port}"
        mock_token = "tapbot-local-mock"
        mock_config_dir = tempfile.TemporaryDirectory(prefix="tapbot-dev-")
        try:
            configure_mock_android(
                backend_environment,
                mock_url=mock_url,
                mock_token=mock_token,
                config_dir=Path(mock_config_dir.name),
            )
        except RuntimeError as error:
            mock_config_dir.cleanup()
            print(f"[dev] 준비 실패: {error}", file=sys.stderr)
            return 1

    frontend_url = f"http://localhost:{frontend_port}"
    backend_url = f"http://localhost:{backend_port}"
    print(f"[dev] Dashboard: {frontend_url}/debug", flush=True)
    print(f"[dev] Backend API: {backend_url}/docs", flush=True)
    if mock_android_port is not None:
        print(
            f"[dev] Mock Android: http://127.0.0.1:{mock_android_port} "
            "(3 screens)",
            flush=True,
        )
    print("[dev] 종료하려면 Ctrl+C를 누르세요.\n", flush=True)

    options = process_options()
    if mock_android_port is not None:
        mock_android = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "scripts.mock_android_agent",
                "--port",
                str(mock_android_port),
                "--token",
                "tapbot-local-mock",
            ],
            cwd=ROOT,
            **options,
        )
    backend = subprocess.Popen(
        backend_command,
        cwd=ROOT,
        env=backend_environment,
        **options,
    )
    frontend_environment = os.environ.copy()
    frontend_environment["VITE_API_BASE_URL"] = f"{backend_url}/api"
    frontend = subprocess.Popen(
        [
            npm,
            "run",
            "dev",
            "--",
            "--port",
            str(frontend_port),
            "--strictPort",
        ],
        cwd=FRONTEND,
        env=frontend_environment,
        **options,
    )

    try:
        while True:
            backend_code = backend.poll()
            frontend_code = frontend.poll()
            mock_android_code = None if mock_android is None else mock_android.poll()
            if backend_code is not None:
                print(f"[dev] Backend가 종료되었습니다 ({backend_code}).")
                return backend_code
            if frontend_code is not None:
                print(f"[dev] Frontend가 종료되었습니다 ({frontend_code}).")
                return frontend_code
            if mock_android_code is not None:
                print(f"[dev] Mock Android가 종료되었습니다 ({mock_android_code}).")
                return mock_android_code
            time.sleep(0.25)
    except KeyboardInterrupt:
        print("\n[dev] 서버를 종료합니다.")
        return 0
    finally:
        stop_process_tree(frontend)
        stop_process_tree(backend)
        if mock_android is not None:
            stop_process_tree(mock_android)
        if mock_config_dir is not None:
            mock_config_dir.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
