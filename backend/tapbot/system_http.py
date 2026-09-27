"""HTTP adapter for backend-wide read-only status and event APIs."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from tapbot.system_service import SystemService


def create_system_router(service: SystemService) -> APIRouter:
    router = APIRouter(tags=["system"])

    @router.get("/api/status")
    async def status() -> dict[str, object]:
        return service.status()

    @router.get("/api/logs")
    async def logs(after_id: Annotated[int, Query(ge=0)] = 0) -> dict[str, object]:
        return service.logs(after_id)

    return router
