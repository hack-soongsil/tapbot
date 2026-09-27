"""FastAPI transport adapter for camera, calibration, and vision use cases."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import cv2
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from tapbot.vision.camera.manager import CameraSourceNotFoundError
from tapbot.vision.camera.source import CameraError
from tapbot.vision.calibration import CalibrationError, CalibrationNotFoundError
from tapbot.vision.models import (
    CalibrationInput,
    CalibrationNotConfiguredError,
    CameraFrameSnapshot,
    CameraSwitchUnsupportedError,
    CameraUnavailableError,
    PointInput,
    VisionResourceNotFoundError,
    VisionRunInput,
    VisionValidationError,
)
from tapbot.vision.service import VisionService


@dataclass(frozen=True, slots=True)
class CoordinateRequest:
    x: float
    y: float


@dataclass(frozen=True, slots=True)
class CameraSourceSelectionRequest:
    source_id: str


@dataclass(frozen=True, slots=True)
class CalibrationRequest:
    profile_name: str
    camera_corners: list[CoordinateRequest]
    robot_points: list[CoordinateRequest]
    screen_width: float
    screen_height: float
    camera_width: int | None = None
    camera_height: int | None = None
    frame_id: int | None = None


@dataclass(frozen=True, slots=True)
class VisionRunRequest:
    frame_id: int
    detector_types: list[str] | None = None
    confidence_threshold: float = 0.0


def _frame_response(snapshot: CameraFrameSnapshot) -> Response:
    return Response(snapshot.jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Frame-Id": str(snapshot.frame_id), "X-Frame-Timestamp": snapshot.captured_at, "X-Frame-Width": str(snapshot.width), "X-Frame-Height": str(snapshot.height)})


def create_vision_router(service: VisionService) -> APIRouter:
    router = APIRouter(tags=["vision"])

    async def call(operation, *, not_found: bool = False):
        try:
            return await asyncio.to_thread(operation)
        except CameraSwitchUnsupportedError as error:
            raise HTTPException(409, str(error)) from error
        except CameraSourceNotFoundError as error:
            raise HTTPException(404, str(error)) from error
        except CameraUnavailableError as error:
            raise HTTPException(503, str(error)) from error
        except VisionResourceNotFoundError as error:
            raise HTTPException(404, str(error)) from error
        except CalibrationNotConfiguredError as error:
            raise HTTPException(409, str(error)) from error
        except CalibrationNotFoundError as error:
            raise HTTPException(404, str(error)) from error
        except VisionValidationError as error:
            raise HTTPException(422, str(error)) from error
        except (CalibrationError, ValueError, cv2.error) as error:
            raise HTTPException(404 if not_found else 422, str(error)) from error
        except CameraError as error:
            raise HTTPException(503, str(error)) from error
        except OSError as error:
            raise HTTPException(500, str(error)) from error

    @router.get("/api/camera/sources")
    async def camera_sources(refresh: bool = False) -> dict[str, object]: return await call(lambda: service.camera_sources(refresh=refresh))
    @router.get("/api/camera/status")
    async def camera_status() -> dict[str, object]: return service.camera_status()
    @router.post("/api/camera/source", include_in_schema=False)
    @router.post("/api/camera/select")
    async def select_camera(value: CameraSourceSelectionRequest) -> dict[str, object]:
        try:
            return await asyncio.to_thread(service.select_camera_source, value.source_id)
        except CameraSwitchUnsupportedError as error:
            raise HTTPException(409, str(error)) from error
        except CameraSourceNotFoundError as error:
            raise HTTPException(404, str(error)) from error
        except CameraError as error:
            raise HTTPException(422, str(error)) from error
    @router.post("/api/camera/reconnect")
    async def reconnect_camera() -> dict[str, object]: return await call(service.reconnect_camera)
    @router.get("/api/camera/frame")
    async def camera_frame() -> Response: return _frame_response(await call(service.camera_frame))
    @router.post("/api/camera/freeze")
    async def freeze_camera() -> Response:
        response = _frame_response(await call(lambda: service.camera_frame(freeze=True)))
        response.headers["X-Frame-Frozen"] = "true"
        return response

    @router.get("/api/calibration/profiles")
    async def calibration_profiles() -> dict[str, object]: return await call(service.calibration_profiles)
    @router.get("/api/calibration")
    async def get_calibration(profile: str | None = None) -> dict[str, object]: return await call(lambda: service.get_calibration(profile), not_found=profile is not None)
    @router.post("/api/calibration")
    async def save_calibration(value: CalibrationRequest) -> dict[str, object]:
        domain = CalibrationInput(value.profile_name, tuple(PointInput(p.x, p.y) for p in value.camera_corners), tuple(PointInput(p.x, p.y) for p in value.robot_points), value.screen_width, value.screen_height, value.camera_width, value.camera_height, value.frame_id)
        return await call(lambda: service.save_calibration(domain))
    @router.post("/api/calibration/activate")
    async def activate_calibration(profile: str) -> dict[str, object]: return await call(lambda: service.activate_calibration(profile), not_found=True)
    @router.post("/api/calibration/screen-to-robot")
    async def screen_to_robot(value: CoordinateRequest) -> dict[str, object]: return await call(lambda: service.transform("screen-to-robot", value.x, value.y))
    @router.post("/api/calibration/robot-to-screen")
    async def robot_to_screen(value: CoordinateRequest) -> dict[str, object]: return await call(lambda: service.transform("robot-to-screen", value.x, value.y))
    @router.post("/api/calibration/camera-to-robot")
    async def camera_to_robot(value: CoordinateRequest) -> dict[str, object]: return await call(lambda: service.transform("camera-to-robot", value.x, value.y))

    @router.get("/api/vision/capabilities")
    async def capabilities() -> dict[str, object]: return service.vision_capabilities()
    @router.get("/api/vision/frames")
    async def frames() -> dict[str, object]: return service.vision_frames()
    @router.post("/api/vision/frames")
    async def save_frame() -> dict[str, object]: return await call(service.save_vision_frame)
    @router.get("/api/vision/frames/{frame_id}/raw")
    async def raw_frame(frame_id: int) -> Response: return Response(await call(lambda: service.raw_vision_frame(frame_id)), media_type="image/jpeg", headers={"Cache-Control": "no-store"})
    @router.post("/api/vision/run")
    async def run_vision(value: VisionRunRequest) -> dict[str, object]:
        domain = VisionRunInput(value.frame_id, None if value.detector_types is None else tuple(value.detector_types), value.confidence_threshold)
        return await call(lambda: service.run_vision(domain))
    @router.get("/api/vision/results/{result_id}/image")
    async def result_image(result_id: int) -> Response: return Response(await call(lambda: service.vision_result_image(result_id)), media_type="image/jpeg", headers={"Cache-Control": "no-store"})
    return router
