"""FastAPI transport adapter for macro lifecycle use cases."""

from __future__ import annotations

from fastapi import APIRouter

from tapbot.android.http import AndroidHttpDependencies


def create_macro_router(deps: AndroidHttpDependencies) -> APIRouter:
    router = APIRouter(prefix="/api/android", tags=["macro"])

    async def invoke(command: str, device_id: str | None = None) -> dict[str, object]:
        service = deps.require_service(device_id)
        return await deps.call(getattr(service, f"{command}_macro"), device_id=service.device_id)

    @router.post("/macro/start")
    async def start() -> dict[str, object]: return await invoke("start")
    @router.post("/macro/pause")
    async def pause() -> dict[str, object]: return await invoke("pause")
    @router.post("/macro/stop")
    async def stop() -> dict[str, object]: return await invoke("stop")
    @router.post("/macro/reset")
    async def reset() -> dict[str, object]: return await invoke("reset")
    @router.post("/macro/step")
    async def step() -> dict[str, object]:
        service = deps.require_service()
        return await deps.call(service.step_macro, device_id=service.device_id)

    @router.post("/{device_id}/macro/start")
    async def device_start(device_id: str) -> dict[str, object]: return await invoke("start", device_id)
    @router.post("/{device_id}/macro/pause")
    async def device_pause(device_id: str) -> dict[str, object]: return await invoke("pause", device_id)
    @router.post("/{device_id}/macro/stop")
    async def device_stop(device_id: str) -> dict[str, object]: return await invoke("stop", device_id)
    @router.post("/{device_id}/macro/reset")
    async def device_reset(device_id: str) -> dict[str, object]: return await invoke("reset", device_id)
    @router.post("/{device_id}/macro/step")
    async def device_step(device_id: str) -> dict[str, object]:
        service = deps.require_service(device_id)
        return await deps.call(service.step_macro, device_id=device_id)
    return router
