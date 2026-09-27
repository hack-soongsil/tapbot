"""FastAPI bootstrap for the pre-composed TapBot application graph."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from tapbot.android.http import create_android_router
from tapbot.config import load_cli_config
from tapbot.system_http import create_system_router
from tapbot.instances import ApplicationInstances, create_instances
from tapbot.macro.http import create_macro_router
from tapbot.robot.http import create_robot_router
from tapbot.vision.http import create_vision_router


def create_app(instances: ApplicationInstances) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await instances.start()
        try:
            yield
        finally:
            await instances.stop()

    application = FastAPI(title="TapBot API", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[
            "X-Frame-Id",
            "X-Frame-Timestamp",
            "X-Frame-Width",
            "X-Frame-Height",
            "X-Frame-Frozen",
            "X-Preview-Width",
            "X-Preview-Height",
            "X-Center-Robot-X",
            "X-Center-Robot-Y",
            "X-Screen-Width",
            "X-Screen-Height",
            "X-Rotation",
            "X-Captured-At",
        ],
    )

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(
        _: Request,
        error: RequestValidationError,
    ) -> JSONResponse:
        instances.event_log.add(f"Request validation error: {error}", level="error")
        return JSONResponse(status_code=422, content={"detail": error.errors()})

    application.include_router(create_system_router(instances.system_service))
    application.include_router(create_android_router(instances.android_http))
    application.include_router(create_macro_router(instances.android_http))
    application.include_router(create_robot_router(instances.robot_service))
    application.include_router(create_vision_router(instances.vision_service))

    application.state.instances = instances
    application.state.robot = instances.robot_controller
    application.state.camera = instances.camera
    application.state.camera_manager = instances.camera_manager
    application.state.bounds = instances.robot_service.bounds
    application.state.event_log = instances.event_log
    application.state.dispatcher = instances.robot_service.dispatcher
    application.state.camera_worker = instances.vision_service.worker
    application.state.calibration_store = instances.vision_service.calibration_store
    application.state.vision_detectors = instances.vision_service.detectors
    application.state.android_debug_service = instances.default_android_service
    application.state.android_registry = instances.android_registry
    application.state.robot_service = instances.robot_service
    application.state.vision_service = instances.vision_service
    application.state.system_service = instances.system_service
    return application


def main() -> None:
    config = load_cli_config()
    application = create_app(create_instances(config))
    uvicorn.run(
        application,
        host=config.backend.host,
        port=config.backend.port,
    )


if __name__ == "__main__":  # pragma: no cover
    main()
