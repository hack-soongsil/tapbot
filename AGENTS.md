# Agent Guidelines

## Development server ports

- Port `8000` is reserved for the user's TapBot backend. Agents must not start
  validation or preview servers on port `8000`.
- Port `5173` is reserved for the user's frontend when available. Agents should
  avoid occupying it during validation.
- For agent-run manual verification, use dedicated ports such as backend
  `18000` and frontend `15173`:

  ```powershell
  npm run dev -- --backend-port 18000 --frontend-port 15173
  ```

- If those validation ports are occupied, choose other free non-default ports.
  Do not stop or replace a user-owned process merely to claim a preferred port.
- Stop all agent-started development servers after verification unless the user
  explicitly asks to leave them running.

## Branch and ownership workflow

- Refactor and feature work targets the `impl` branch unless the user says
  otherwise.
- Keep domain implementation inside `backend/tapbot/<domain>/` and matching
  tests inside `backend/tests/<domain>/`.
- Backend production domains are limited to `android`, `macro`, `model`,
  `ui_resolution`, `robot`, and `vision`. Do not reintroduce top-level
  `camera`, `screen`, `device`, `core`, `simulation`, or `ui` packages.
- Android screenshots, gestures, and logical input belong to `android/`;
  physical camera acquisition and calibration belong to `vision/`.
- Treat `backend/tapbot/app.py`, `instances.py`, and `config.py` as shared
  boundaries. Changes there should be limited to bootstrap, wiring, lifecycle,
  and settings respectively.
- Test-only fakes belong in `backend/tests/fakes/` or `backend/tests/helpers/`,
  never in the production package.
- Infrastructure ownership covers `infra/` and `.github/workflows/`. Keep
  reusable CI/CD, container, and deployment logic there; root `scripts/` is
  reserved for local developer workflows.
- Application owners should coordinate changes to CI validation or artifacts
  with the infrastructure owner instead of embedding automation in a domain.
