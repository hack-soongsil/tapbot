# TapBot backend

Python import root는 `tapbot`이고 소스와 테스트는 각각 `backend/tapbot`,
`backend/tests`에 있습니다.

## Boundaries

- `config.py`는 backend runtime 설정을 읽고 타입과 범위를 검증합니다.
- `instances.py`만 concrete client/controller/service를 생성하고 연결합니다.
- `app.py`는 이미 조립된 `ApplicationInstances`를 받아 FastAPI router와 lifecycle을
  등록합니다.
- `events.py`는 여러 domain이 공유하는 안정적인 event record/value object만 제공합니다.
- `system_service.py`, `system_http.py`는 `/api/status`, `/api/logs`에 필요한 application
  전체 read model과 HTTP adapter만 담당합니다.
- 각 domain의 `http.py`는 HTTP 변환만, `service.py`는 transport-independent use case만
  담당합니다.

Production package의 최상위 domain ownership은 다음과 같습니다.

| Domain | Ownership |
| --- | --- |
| `android/` | Android Agent client, screenshot, UI input, gesture, device registry |
| `macro/` | observe-to-execute orchestration과 lifecycle |
| `model/` | model client와 decision parsing |
| `ui_resolution/` | accessibility tree, selector, target resolution |
| `robot/` | GRBL, transport, robot action execution, Android-input robot adapter |
| `vision/` | physical camera, calibration, visual detector/processing |

`camera`, `screen`, `device`, `core`, `simulation`, `ui` 같은 별도 top-level package는
사용하지 않습니다. Android screenshot은 `android/`가 소유하고, physical camera만
`vision/`이 소유합니다.

Android Agent token과 model API token은 repr에서 제외되며 frontend로 전달하지
않습니다. `AndroidDeviceRegistry`는 injected context factory만 사용하므로 client나
service를 자체 생성하지 않습니다.

## Configuration

주요 환경변수는 다음과 같습니다.

- `TAPBOT_BACKEND_HOST`, `TAPBOT_BACKEND_PORT`
- `TAPBOT_ANDROID_AGENT_URL`, `TAPBOT_ANDROID_AGENT_TOKEN`
- `TAPBOT_ANDROID_DEVICES_CONFIG`, `TAPBOT_ANDROID_CAPTURE_DIR`
- `TAPBOT_ANDROID_DISCOVERY_ENABLED`, `TAPBOT_ANDROID_DISCOVERY_PROVIDER`
- `TAPBOT_ANDROID_AGENT_PORT`, `TAPBOT_ANDROID_DISCOVERY_INTERVAL_SEC`
- `TAPBOT_ANDROID_DISCOVERY_TIMEOUT_SEC`, `TAPBOT_ANDROID_DISCOVERY_MAX_CONCURRENCY`
- `TAPBOT_GRBL_TRANSPORT`, `TAPBOT_GRBL_SERIAL_PORT`, `TAPBOT_GRBL_BAUD_RATE`
- `TAPBOT_GRBL_WIFI_HOST`, `TAPBOT_GRBL_WIFI_PORT`
- `TAPBOT_CAMERA_SOURCE`, `TAPBOT_CAMERA_FPS`, `TAPBOT_CAMERA_MAX_INDEX`
- `TAPBOT_MODEL_ENDPOINT`, `TAPBOT_MODEL_NAME`, `TAPBOT_MODEL_API_TOKEN`
- `TAPBOT_TAP_RANDOMIZATION_ENABLED`, `TAPBOT_TAP_EDGE_INSET_RATIO`
- `TAPBOT_TAP_SIGMA_RATIO`, `TAPBOT_TAP_MIN_JITTER_PX`
- `TAPBOT_TAP_MAX_JITTER_PX`, `TAPBOT_TAP_MAX_ATTEMPTS`
- `TAPBOT_CALIBRATION_FILE`, `TAPBOT_MACRO_TRACE_DIR`
- `TAPBOT_MACRO_DEFINITION_DIR`, `TAPBOT_MACRO_BINDINGS_FILE`

Wi-Fi transport 경계는 구성 가능하지만 실제 GRBL Wi-Fi framing은 아직 구현되지 않아
연결 시 명시적인 `NotImplementedError`를 반환합니다.

## Android discovery

Discovery는 기본 활성화되며 host의 `tailscale status --json`에서 같은 tailnet peer를
읽고, online peer의 `http://<address>:8765/api/status`만 제한적으로 확인합니다.
Android Agent status도 인증이 필요하므로 URL 없이 자동 발견할 때는 backend에
`TAPBOT_ANDROID_AGENT_TOKEN`을 설정해야 합니다. 이 token은 frontend나 device API에
노출되지 않습니다.

```powershell
$env:TAPBOT_ANDROID_AGENT_TOKEN = "<Android Agent token>"
npm run dev:dry-run
```

- `GET /api/android/devices`: manual/discovered device 상태
- `POST /api/android/devices/refresh`: 즉시 discovery refresh
- `GET /api/android/discovery/status`: Tailscale 가용성과 마지막 refresh 결과
- `POST /api/android/devices/manual`: runtime manual fallback 등록

Tailscale이 없거나 로그인되지 않았거나 CLI 결과가 유효하지 않아도 backend startup은
계속됩니다. 이 경우 discovery status에만 오류가 기록됩니다. 수동 URL과
`config/android-devices.example.json` 방식은 fallback으로 계속 지원되며, 같은 endpoint가
발견되면 manual 등록이 우선하고 중복 device를 만들지 않습니다.
