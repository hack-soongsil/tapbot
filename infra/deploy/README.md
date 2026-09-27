# Deployment configuration

Provider 및 환경별 release 설정은 이 디렉터리 아래에서 관리합니다. 현재는 특정
cloud/runtime를 전제로 하지 않으며, 기본 container 실행 예시는
`../docker/compose.yaml`에 있습니다.

새 배포 대상은 `infra/deploy/<provider>/<environment>/` 형태로 추가합니다. manifest,
release packaging, rollout/rollback script는 여기에 두고 애플리케이션 source
directory에는 추가하지 않습니다. 실제 credential과 `.env` 파일은 commit하지 않고
배포 플랫폼의 secret store를 사용합니다.
