# TapBot

TapBot은 Android Agent에서 화면과 접근성 트리를 받고, FastAPI backend가 macro를
조정하며, React frontend가 상태와 디버그 화면을 제공하는 로봇 제어 프로젝트입니다.

## Repository layout

```text
android-agent/       Android screenshot, UI tree, and input agent
frontend/            React/Vite UI
backend/tapbot/      Python domains and application composition
backend/tests/       Domain-aligned tests and test-only fakes
config/              Checked-in example configuration only
scripts/             Local development launchers
infra/               CI/CD, containers, and deployment automation
.github/workflows/    Thin GitHub Actions entrypoints
```

Backend의 여섯 domain은 `android`, `macro`, `model`, `ui_resolution`, `robot`,
`vision`입니다. Android screenshot/input은 `android`, physical camera/calibration은
`vision`이 소유합니다. 공용 application 경계는 다음 파일로 제한합니다.

- `backend/tapbot/app.py`: FastAPI bootstrap과 router 등록
- `backend/tapbot/instances.py`: application composition root와 lifecycle
- `backend/tapbot/config.py`: 환경변수/CLI 설정 파싱과 검증
- `backend/tapbot/events.py`: domain 간 공유 event value object
- `backend/tapbot/system_service.py`, `system_http.py`: 전체 상태/log read API

## Setup and run

```powershell
npm run setup
npm run dev
```

로봇 없이 실행할 때는 다음 명령을 사용합니다.

```powershell
npm run dev:dry-run
```

Backend만 실행하려면 editable install 후 `tapbot-api --dry-run`을 사용할 수 있습니다.
Android token과 model token은 backend 환경변수 또는 루트의 ignored `.env.local`에만
두고, `frontend/` 환경변수에는 넣지 않습니다.

같은 tailnet의 Android Agent를 자동 발견하려면 host와 Android에 Tailscale로 로그인한
뒤 backend에 `TAPBOT_ANDROID_AGENT_TOKEN`만 설정하면 됩니다. Backend는 port 8765의
canonical status endpoint만 확인하며, 수동 URL/device config도 fallback으로 유지합니다.
상세 설정과 discovery API는 `backend/README.md`를 참고합니다.

## Validation

```powershell
node scripts/run-python.cjs infra/ci/backend.py
node scripts/run-python.cjs infra/ci/frontend.py
node scripts/run-python.cjs infra/ci/android.py
```

각 영역은 독립적으로 검증되며, 설치가 끝난 로컬 환경에서는 backend/frontend
스크립트에 `--skip-install`을 지정할 수 있습니다. CI 구조, artifact, container,
배포 및 secret 관리 방식은 `infra/README.md`를 참고합니다.

일반 pytest 실행은 `hardware` marker를 제외합니다. 실제 장비 테스트는 명시적으로
`-m hardware`를 지정합니다.

개발은 `impl` 브랜치를 기준으로 진행합니다. 새 기능은 해당 domain 안에서 구현하고,
`instances.py`에 최소 wiring을 추가한 뒤 필요한 router만 `app.py`에 등록합니다.
