# TapBot Web

React, TypeScript, Vite, Palantir Blueprint 기반의 Android Remote 디버그
워크스페이스입니다. `/debug`는 Android Agent가 제공하는 canonical screen을 PC에서
보고 직접 조작하면서 Vision, state classifier, macro 상태를 확인하는 흐름입니다.

## 시작하기

저장소 루트에서 아래 명령을 실행하면 FastAPI Backend와 React 개발 서버가 함께
실행됩니다. 최초 실행 시 누락된 의존성도 자동으로 설치합니다.

```powershell
npm run dev
```

GRBL serial port가 설정되지 않은 개발 환경에서는 안전한 dry-run mode로 실행됩니다.
실제 Robot을 연결할 때만 port를 지정하세요.

```powershell
$env:TAPBOT_GRBL_SERIAL_PORT="COM3"
npm run dev
```

port 설정 여부와 관계없이 dry-run을 강제하려면 `npm run dev:dry-run`을 사용합니다.

터미널에 표시되는 Dashboard 주소의 `/debug`로 접속하세요. 기본 주소는
`http://localhost:15180/debug`이며, 포트가 사용 중이면 다음 빈 포트를 자동으로
선택합니다. `Ctrl+C`를 누르면 두 서버가 함께 종료됩니다.

Backend와 Frontend를 따로 실행하려면 다음 명령을 사용합니다.

```powershell
tapbot-api --camera 0 --serial-port COM3
cd frontend
npm ci
npm run dev
```

## Debug 화면

기본 화면의 Devices 목록에서 같은 tailnet에 자동 발견된 Android Agent를 선택합니다.
사용자는 IP나 URL을 입력할 필요가 없습니다. PC와 Android에서 Tailscale에 로그인하고
Agent를 실행한 뒤 Refresh를 누르면 됩니다. token은 React/Vite 환경으로 전달되지 않으며
PC FastAPI가 인증 proxy 역할을 합니다.

```powershell
$env:TAPBOT_ANDROID_AGENT_TOKEN="ANDROID_AGENT_TOKEN"
npm run dev
```

자동 발견을 사용할 수 없을 때만 Devices의 Advanced에서 이름, endpoint URL, 선택적
token으로 수동 기기를 추가합니다. 이 입력은 backend로만 전송되며 기본 화면에는
endpoint와 네트워크 세부 정보가 표시되지 않습니다.

Blueprint dark theme가 앱 루트에 적용되며 `/debug`에는 다음 영역이 표시됩니다.

- Android/Stream/Macro 상태 Navbar
- MJPEG live stream과 screenshot fallback
- PC Vision detection overlay와 planned tap point
- 연결 준비 시 항상 활성화되는 live-screen click/drag control
- Screenshot, Back, Home control
- Macro Start/Stop/Pause/Reset/Step
- State, detection, decision, action result, event log

Android screenshot은 Android Agent에서 받은 픽셀과 해상도를 그대로 사용합니다.
Robot camera는 `/tools/camera`에서 별도의 raw stream으로 확인합니다.

Robot control, model inspection, raw G-code, calibration 편집용 이전 화면은
제거되었습니다.

## Android Debug API

브라우저는 아래 PC FastAPI endpoint만 사용합니다.

- `GET /api/android/devices`
- `POST /api/android/devices/refresh`
- `GET /api/android/discovery/status`
- `POST /api/android/devices/manual` (Advanced fallback)
- `GET /api/android/{device_id}/status`
- `GET /api/android/{device_id}/screenshot`, `/stream`
- `GET /api/android/{device_id}/ui-tree`
- `POST /api/android/{device_id}/screenshot/save`
- `POST /api/android/{device_id}/tap`, `/swipe`, `/back`, `/home`
- `POST /api/android/{device_id}/gesture`
- `POST /api/android/{device_id}/vision/run`
- `GET /api/android/{device_id}/debug/state`
- `POST /api/android/{device_id}/macro/start`, `/pause`, `/stop`, `/reset`, `/step`

단일 디바이스 환경의 기존 `/api/android/status` 등의 endpoint는 default device
별칭으로 유지됩니다. 저장 screenshot과 macro trace 기본 위치는
`tapbot-captures/android/{device_id}`입니다.
`TAPBOT_ANDROID_CAPTURE_DIR`로 변경할 수 있습니다.

UI tree는 선택된 device에서만 1Hz로 조회하며 Accessibility node 검색과 bounds
overlay에 사용됩니다. 해당 source가 없거나 target이 모호하면 macro resolver는 기존
Vision detection으로 fallback합니다. UI tree 조회를 위해 Android Agent token을
브라우저에 전달하지 않습니다.

Live screen control은 Android Agent의 Accessibility와 Remote Control이 준비되면 별도
토글 없이 항상 활성화됩니다. pointer down/move/up을 브라우저에서 기록하고
pointer-up 시점에만 완성된 trajectory를 backend로 보냅니다. 8px/300ms 미만 입력은
tap으로, 나머지는 gesture로 처리합니다. 경로는 4px 또는 12ms 간격으로 sampling하고
최대 256개 점으로 resample하며 device 전환, pointer cancel, stream disconnect 시 진행
중인 기록을 폐기합니다.

Live viewport는 last-known device geometry를 유지하는 독립 aspect-ratio stage입니다.
stream/screenshot, online/offline 전환은 동일한 image/overlay slot 안에서만 일어나며,
message와 Debug State는 별도 scroll panel에 표시됩니다. Gesture recording 중에는
pointerdown 시점의 stage bounds와 frame geometry를 pointerup까지 고정합니다.

멀티 디바이스 설정은 `TAPBOT_ANDROID_DEVICES_CONFIG`에 JSON 경로를 지정합니다.
`config/android-devices.example.json`을 복사하되 실제 token 파일은 commit하지
마세요. 각 token은 `TAPBOT_ANDROID_DEVICE_<DEVICE_ID>_TOKEN` 환경변수로 덮어쓸 수
있으며 `-`는 `_`로 변환됩니다.

## Robot Camera / Vision API

Robot Camera 화면은 `GET /api/camera/frame`의 JPEG를 주기적으로 가져옵니다. Source
Selector는 다음 API를 사용합니다.

- `GET /api/camera/sources`
- `GET /api/camera/status`
- `POST /api/camera/select`
- `POST /api/camera/reconnect`

물리 카메라, 이미지, 비디오는 같은 source 목록에 표시됩니다.
Windows의 물리 카메라는 환경변수 없이 MSMF와 DirectShow를 순서대로 검사하고 실제
유효 frame을 반환하는 장치만 discovery 결과에 포함합니다. 비활성 IR interface처럼
열리지만 검은 frame만 반환하는 source는 목록에서 제외됩니다.

Vision control은 저장과 실행을 분리합니다.

- Save Frame: `POST /api/vision/frames`
- Run Detection: `POST /api/vision/run`
- Detector 정보: `GET /api/vision/capabilities`
- 저장 frame 목록: `GET /api/vision/frames`

Confidence Threshold는 화면에서 0~100%로 표시하고 Backend 요청에는 0~1 값으로
전달합니다.

Robot camera detection은 저장한 원본 프레임에 detector를 직접 실행합니다. 이미지
crop이나 화면 평면 변환은 수행하지 않습니다. 좌표 보정은 camera/screen 좌표를 robot
좌표로 매핑하는 데만 사용됩니다.

## 환경 변수

Vite는 실행 모드에 맞춰 `.env.development` 또는 `.env.production`을 읽습니다.
로컬 설정은 `.env.example`을 참고해 `.env.local`에 작성하세요.

| 변수                  | 기본값 (development)        | 설명                |
| --------------------- | --------------------------- | ------------------- |
| `VITE_API_BASE_URL`   | `http://localhost:18880/api` | 백엔드 API 기본 URL |
| `VITE_API_TIMEOUT_MS` | `10000`                     | 요청 제한 시간(ms)  |

공통 API 클라이언트는 `src/lib/api-client.ts`에 있으며 timeout, HTTP 오류, 네트워크
오류, JSON 파싱 오류를 `ApiError`로 통일합니다.

## 확인 명령

```bash
npm run lint
npm test
npm run typecheck
npm run build
npm run format:check
```
