# TapBot Infrastructure

`infra/`는 CI/CD, container, release/deployment automation의 소유 경계입니다.
애플리케이션 구현은 각각 `backend/`, `frontend/`, `android-agent/`에 유지하고,
로컬 개발 실행기는 루트 `scripts/`에 둡니다.

## CI jobs

GitHub Actions workflow는 런타임을 준비한 뒤 `infra/ci/`의 단일 진입점을
호출합니다. 실제 검증 순서와 artifact packaging은 이 스크립트가 소유합니다.

| Job | Trigger paths | Validation | Artifact |
| --- | --- | --- | --- |
| Backend CI | `backend/**`, `pyproject.toml`, `infra/**` | install, compile/import, pytest, wheel | Python wheel |
| Frontend CI | `frontend/**`, `infra/**` | npm ci, lint, typecheck, test, build | `dist` ZIP |
| Android Agent CI | `android-agent/**`, `infra/**` | Gradle unit test, `assembleDebug` | debug APK |

각 workflow는 수동 실행도 지원합니다. `infra/**` 변경은 공통 CI 로직이나
container/deployment 동작에 영향을 줄 수 있으므로 세 workflow를 모두 실행합니다.
artifact 보존 기간은 workflow에서 14일로 관리합니다.

## Local validation

Repository root에서 영역별 검증을 독립적으로 실행할 수 있습니다.

```powershell
node scripts/run-python.cjs infra/ci/backend.py
node scripts/run-python.cjs infra/ci/frontend.py
node scripts/run-python.cjs infra/ci/android.py
```

Windows의 위 명령은 저장소 helper가 Python 3.12를 선택합니다. Linux/macOS와 CI에서는
같은 entrypoint를 `python3 infra/ci/backend.py` 형태로 직접 실행할 수 있습니다.

이미 dependency가 설치된 개발 환경에서는 다음처럼 설치 단계를 생략할 수 있습니다.

```powershell
node scripts/run-python.cjs infra/ci/backend.py --skip-install
node scripts/run-python.cjs infra/ci/frontend.py --skip-install
```

전체 검증은 Windows에서 `node scripts/run-python.cjs infra/ci/all.py`, 그 외
환경에서는 `python3 infra/ci/all.py`로 실행합니다. `--artifact-root artifacts`를
지정하면 CI와 같은 wheel, frontend ZIP, APK를 영역별 하위 디렉터리에 모읍니다.
Android 검증에는 JDK 17과 Android SDK가 필요합니다.

## Manual Android APK publish

Android Agent debug APK는 CI trigger 없이 개발자가 필요할 때 직접 Google Drive에
올립니다. 최초 한 번 Drive 선택 dependency를 설치합니다.

```powershell
node scripts/run-python.cjs -m pip install -e ".[publish]"
```

Google Cloud service account를 사용하는 경우 대상 Drive folder를 service account
email에 업로드 가능한 권한으로 공유하고, repository 밖의 credential JSON 경로만
환경변수로 지정합니다. 기본 대상 folder ID는
`1yLW1u4_cV4QuHXOCX9-llmKKCZlkzBA2`입니다.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secrets\tapbot-drive.json"
npm run android:publish
```

명령은 `assembleDebug`가 성공하고 APK가 실제로 생성된 경우에만 업로드합니다.
파일명은 `tapbot-agent-v{versionName}-{short_commit}.apk`이며 같은 이름도 Drive에 새
파일로 생성해 이전 artifact를 보존합니다. 업로드 실패 시 로컬 APK는 삭제하지 않습니다.
Drive URL은 API 응답에 `webViewLink`가 포함된 경우에만 출력합니다.

추가 옵션:

```powershell
npm run android:publish -- --test
npm run android:publish -- --no-build
npm run android:publish -- --no-build --apk artifacts/app-debug.apk
npm run android:publish -- --folder-id OTHER_FOLDER_ID
npm run android:publish -- --no-commit
```

직접 실행하려면 `python infra/scripts/publish_android.py`를 사용합니다. `--test`는 Gradle
`test assembleDebug`를 실행하며 `--no-build`와 함께 사용할 수 없습니다. `--apk`는
기본 APK 대신 검사하고 업로드할 파일을 선택합니다. 인증은 service account와 외부에서
구성한 Application Default Credentials를 지원하고 Drive 접근 범위는 `drive.file`로
제한합니다. credential JSON, OAuth refresh token, Drive token은 repository에 저장하지
않습니다.

## Containers

`infra/docker/`는 backend와 frontend image 및 로컬 compose 구성을 소유합니다.
기본 compose는 물리 장비 없이 확인할 수 있도록 backend를 dry-run으로 실행하며,
frontend를 `http://localhost:15180`에 노출합니다.

```powershell
docker compose -f infra/docker/compose.yaml up --build
```

운영 환경에서 camera, serial device 또는 Android Agent를 연결할 때는 provider별
deployment 설정에서 device mount/network/config를 명시합니다. 기본 image나 compose에
token과 장비 주소를 넣지 않습니다.

## Deployment flow

1. 세 영역의 독립 CI가 성공해야 합니다.
2. CI가 생성한 wheel, frontend ZIP, APK 또는 검증된 container image를 선택합니다.
3. `infra/deploy/`의 환경별 설정에서 version과 non-secret runtime 값을 지정합니다.
4. 배포 환경의 secret store를 주입하고 rollout/health check를 수행합니다.

현재 provider-specific 배포 대상은 정해져 있지 않습니다. 새 provider 구성은
`infra/deploy/<provider>/` 안에 추가하고 application directory에 두지 않습니다.

## Secrets and configuration

- 실제 secret은 GitHub Actions Secrets/Environments 또는 배포 플랫폼 secret store에 둡니다.
- Android Agent token, model/deployment token, registry credential을 repository나 로그에 남기지 않습니다.
- `infra/deploy/.env.example`에는 이름과 안전한 기본값만 유지합니다.
- frontend에는 backend secret을 전달하지 않습니다.
- 스크립트는 실행 명령만 출력하며 environment 전체를 출력하지 않습니다.

Infra 변경의 기본 ownership은 `infra/`와 `.github/workflows/`입니다. 애플리케이션
팀이 검증 항목을 변경해야 하면 해당 영역 구현과 infra entrypoint 변경을 분리해
검토할 수 있도록 infra 담당자와 조율합니다.
