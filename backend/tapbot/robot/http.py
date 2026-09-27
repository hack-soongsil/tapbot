"""FastAPI transport adapter for robot use cases."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from fastapi import APIRouter, HTTPException

from tapbot.robot.models import CoordinateValidationError
from tapbot.robot.service import RobotService


@dataclass(frozen=True, slots=True)
class CoordinateRequest:
    x: float
    y: float


def create_robot_router(service: RobotService) -> APIRouter:
    router = APIRouter(prefix="/api/robot", tags=["robot"])

    async def call(operation):
        try:
            return await asyncio.to_thread(operation)
        except CoordinateValidationError as error:
            raise HTTPException(422, str(error)) from error
        except Exception as error:
            raise HTTPException(500, str(error)) from error

    @router.get("/status")
    async def status() -> dict[str, object]: return service.status()
    @router.post("/move")
    async def move(value: CoordinateRequest) -> dict[str, object]: return await call(lambda: service.move(value.x, value.y))
    @router.post("/tap")
    async def tap(value: CoordinateRequest) -> dict[str, object]: return await call(lambda: service.tap(value.x, value.y))
    @router.post("/home")
    async def home() -> dict[str, object]: return await call(service.home)
    @router.post("/pen/up")
    async def pen_up() -> dict[str, object]: return await call(service.pen_up)
    @router.post("/pen/down")
    async def pen_down() -> dict[str, object]: return await call(service.pen_down)
    @router.post("/stop")
    async def stop() -> dict[str, object]: return await call(service.emergency_stop)
    return router
