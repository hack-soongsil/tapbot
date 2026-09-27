# Infrastructure automation

CI/CD 및 deployment 전용 보조 automation은 이 디렉터리에 둡니다. 검증
entrypoint는 `../ci/`, provider별 배포 절차는 `../deploy/`가 소유합니다.

개발자의 로컬 frontend/backend 실행을 돕는 스크립트는 루트 `scripts/`에 유지하며,
여기로 이동시키지 않습니다.

`publish_android.py`는 예외적으로 개발자가 명시적으로 실행하는 release artifact
automation입니다. Android debug APK 빌드와 Google Drive 업로드만 담당하며 자동 CI
trigger, release signing, Play Store 배포 또는 이전 artifact 삭제는 수행하지 않습니다.
