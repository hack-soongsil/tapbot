"""FastAPI transport adapter for the Android domain."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Callable

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse

from tapbot.android.client import AndroidAgentApiError, AndroidAgentTransportError
from tapbot.android.device_registry import AndroidDeviceRegistry
from tapbot.android.discovery import AndroidDiscoveryService
from tapbot.android.models import EncodedAndroidFrame
from tapbot.android.service import AndroidService
from tapbot.events import EventLog
from tapbot.android.gesture import PointerGesture, PointerGestureBoundsError, PointerPoint


@dataclass(frozen=True, slots=True)
class TapRequest:
    x: float
    y: float
    duration_ms: int = 70


@dataclass(frozen=True, slots=True)
class SwipeRequest:
    x1: float
    y1: float
    x2: float
    y2: float
    duration_ms: int = 450


@dataclass(frozen=True, slots=True)
class PointerPointRequest:
    x: float
    y: float
    t_ms: int


@dataclass(frozen=True, slots=True)
class GestureRequest:
    points: list[PointerPointRequest]


@dataclass(frozen=True, slots=True)
class ManualDeviceRequest:
    name: str
    endpoint: str
    token: str | None = None


class AndroidHttpDependencies:
    """Resolve services and consistently map domain/client failures to HTTP."""

    def __init__(
        self,
        registry: AndroidDeviceRegistry,
        event_log: EventLog,
        *,
        discovery: AndroidDiscoveryService,
        manual_token: str | None = None,
    ) -> None:
        self.registry = registry
        self.event_log = event_log
        self.discovery = discovery
        self.manual_token = manual_token

    def require_service(self, device_id: str | None = None) -> AndroidService:
        resolved_id = device_id or self.registry.default_device_id
        if resolved_id is None:
            if self.registry.list():
                raise HTTPException(409, "No default Android device is configured; specify device_id.")
            raise HTTPException(
                503,
                "Android Agent is not configured. Refresh discovery or configure a manual endpoint.",
            )
        try:
            return self.registry.get(resolved_id).debug_service
        except KeyError as error:
            raise HTTPException(404, f"Unknown Android device: {resolved_id}") from error

    async def call(self, operation: Callable[[], Any], *, device_id: str | None = None) -> Any:
        payload = {} if device_id is None else {"device_id": device_id}
        try:
            return await asyncio.to_thread(operation)
        except AndroidAgentApiError as error:
            self.event_log.add(f"Android Agent API error: {error}", level="error", event_type="android.api.error", category="android", status="error", payload={**payload, "code": error.code, "request_id": error.request_id})
            raise HTTPException(error.status or 502, f"{error.code}: {error}") from error
        except AndroidAgentTransportError as error:
            self.event_log.add(f"Android Agent transport error: {error}", level="error", event_type="android.transport.error", category="android", status="error", payload={**payload, "outcome_unknown": error.outcome_unknown})
            raise HTTPException(502, str(error)) from error
        except PointerGestureBoundsError as error:
            raise HTTPException(422, f"point_out_of_bounds: {error}") from error
        except (OSError, ValueError, RuntimeError) as error:
            self.event_log.add(f"Android operation failed: {error}", level="error", event_type="android.operation.error", category="android", status="error", payload=payload)
            raise HTTPException(500, str(error)) from error


def frame_response(frame: EncodedAndroidFrame) -> Response:
    return Response(frame.content, media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Frame-Id": frame.frame_id, "X-Screen-Width": str(frame.width), "X-Screen-Height": str(frame.height), "X-Rotation": str(frame.rotation), "X-Captured-At": frame.captured_at})


def create_android_router(deps: AndroidHttpDependencies) -> APIRouter:
    router = APIRouter(prefix="/api/android", tags=["android"])

    def gesture(value: GestureRequest) -> PointerGesture:
        try:
            return PointerGesture.from_points(tuple(PointerPoint(p.x, p.y, p.t_ms) for p in value.points))
        except (TypeError, ValueError) as error:
            raise HTTPException(422, str(error)) from error

    def duration(value: int) -> None:
        if not 1 <= value <= 10_000:
            raise HTTPException(422, "duration_ms must be between 1 and 10000")

    async def screenshot(device_id: str | None) -> Response:
        service = deps.require_service(device_id)
        return frame_response(await deps.call(service.screenshot, device_id=service.device_id))

    async def ui_tree(device_id: str | None) -> dict[str, object]:
        service = deps.require_service(device_id)
        return await deps.call(service.ui_tree, device_id=service.device_id)

    async def save_screenshot(device_id: str | None) -> dict[str, object]:
        service = deps.require_service(device_id)
        return await deps.call(service.save_screenshot, device_id=service.device_id)

    def stream(device_id: str | None) -> StreamingResponse:
        service = deps.require_service(device_id)
        return StreamingResponse(service.stream(), media_type="multipart/x-mixed-replace; boundary=tapbotframe", headers={"Cache-Control": "no-store"})

    async def tap(device_id: str | None, value: TapRequest) -> dict[str, object]:
        duration(value.duration_ms)
        service = deps.require_service(device_id)
        return await deps.call(lambda: service.manual_tap(value.x, value.y, duration_ms=value.duration_ms), device_id=service.device_id)

    async def swipe(device_id: str | None, value: SwipeRequest) -> dict[str, object]:
        duration(value.duration_ms)
        service = deps.require_service(device_id)
        return await deps.call(lambda: service.manual_swipe(value.x1, value.y1, value.x2, value.y2, duration_ms=value.duration_ms), device_id=service.device_id)

    async def execute_gesture(device_id: str | None, value: GestureRequest) -> dict[str, object]:
        service = deps.require_service(device_id)
        parsed = gesture(value)
        return await deps.call(lambda: service.manual_gesture(parsed), device_id=service.device_id)

    async def primitive(device_id: str | None, name: str) -> dict[str, object]:
        service = deps.require_service(device_id)
        return await deps.call(getattr(service, name), device_id=service.device_id)

    async def vision_frame(device_id: str | None) -> Response:
        service = deps.require_service(device_id)
        frame = await deps.call(service.latest_vision_frame, device_id=service.device_id)
        if frame is None:
            raise HTTPException(404, "No Android vision frame yet")
        return frame_response(frame)

    @router.get("/status")
    async def status() -> dict[str, object]:
        default_id = deps.registry.default_device_id
        if default_id is None:
            configured = bool(deps.registry.list())
            return {
                "configured": configured,
                "connected": False,
                "error": (
                    "Select a device-specific endpoint."
                    if configured
                    else "Refresh Android discovery or configure a manual endpoint."
                ),
                "agent": None,
                "stream": None,
                "macro_status": "IDLE",
            }
        service = deps.require_service(default_id)
        return await deps.call(service.status, device_id=default_id)

    @router.get("/devices")
    async def devices() -> dict[str, object]:
        return {"devices": await asyncio.to_thread(deps.registry.refresh_all), "default_device_id": deps.registry.default_device_id}

    @router.post("/devices/refresh")
    async def refresh_devices() -> dict[str, object]:
        discovery = await asyncio.to_thread(deps.discovery.refresh)
        return {
            "discovery": discovery,
            "devices": deps.registry.summaries(),
            "default_device_id": deps.registry.default_device_id,
        }

    @router.post("/devices/manual", status_code=201)
    async def add_manual_device(value: ManualDeviceRequest) -> dict[str, object]:
        token = value.token.strip() if value.token and value.token.strip() else deps.manual_token
        if not token:
            raise HTTPException(
                422,
                "An Agent token is required. Enter one or configure it on the backend.",
            )
        try:
            device = await asyncio.to_thread(
                deps.registry.register_manual,
                name=value.name,
                endpoint=value.endpoint,
                token=token,
            )
        except ValueError as error:
            status_code = 409 if "Duplicate" in str(error) else 422
            raise HTTPException(status_code, str(error)) from error
        return {"device": device}

    @router.get("/discovery/status")
    async def discovery_status() -> dict[str, object]:
        return deps.discovery.status()

    @router.get("/screenshot")
    async def default_screenshot() -> Response: return await screenshot(None)
    @router.get("/ui-tree")
    async def default_ui_tree() -> dict[str, object]: return await ui_tree(None)
    @router.post("/screenshot/save")
    async def default_save() -> dict[str, object]: return await save_screenshot(None)
    @router.get("/stream")
    async def default_stream() -> StreamingResponse: return stream(None)
    @router.post("/tap")
    async def default_tap(value: TapRequest) -> dict[str, object]: return await tap(None, value)
    @router.post("/swipe")
    async def default_swipe(value: SwipeRequest) -> dict[str, object]: return await swipe(None, value)
    @router.post("/gesture")
    async def default_gesture(value: GestureRequest) -> dict[str, object]: return await execute_gesture(None, value)
    @router.post("/back")
    async def default_back() -> dict[str, object]: return await primitive(None, "back")
    @router.post("/home")
    async def default_home() -> dict[str, object]: return await primitive(None, "home")
    @router.post("/vision/run")
    async def default_run_vision() -> dict[str, object]: return await primitive(None, "run_vision")
    @router.get("/vision/frame")
    async def default_vision_frame() -> Response: return await vision_frame(None)
    @router.get("/debug/state")
    async def default_debug_state() -> dict[str, object]: return await primitive(None, "debug_state")

    @router.get("/{device_id}/status")
    async def device_status(device_id: str) -> dict[str, object]: return await primitive(device_id, "status")
    @router.get("/{device_id}/screenshot")
    async def device_screenshot(device_id: str) -> Response: return await screenshot(device_id)
    @router.get("/{device_id}/ui-tree")
    async def device_ui_tree(device_id: str) -> dict[str, object]: return await ui_tree(device_id)
    @router.post("/{device_id}/screenshot/save")
    async def device_save(device_id: str) -> dict[str, object]: return await save_screenshot(device_id)
    @router.get("/{device_id}/stream")
    async def device_stream(device_id: str) -> StreamingResponse: return stream(device_id)
    @router.post("/{device_id}/tap")
    async def device_tap(device_id: str, value: TapRequest) -> dict[str, object]: return await tap(device_id, value)
    @router.post("/{device_id}/swipe")
    async def device_swipe(device_id: str, value: SwipeRequest) -> dict[str, object]: return await swipe(device_id, value)
    @router.post("/{device_id}/gesture")
    async def device_gesture(device_id: str, value: GestureRequest) -> dict[str, object]: return await execute_gesture(device_id, value)
    @router.post("/{device_id}/back")
    async def device_back(device_id: str) -> dict[str, object]: return await primitive(device_id, "back")
    @router.post("/{device_id}/home")
    async def device_home(device_id: str) -> dict[str, object]: return await primitive(device_id, "home")
    @router.post("/{device_id}/vision/run")
    async def device_run_vision(device_id: str) -> dict[str, object]: return await primitive(device_id, "run_vision")
    @router.get("/{device_id}/vision/frame")
    async def device_vision_frame(device_id: str) -> Response: return await vision_frame(device_id)
    @router.get("/{device_id}/debug/state")
    async def device_debug_state(device_id: str) -> dict[str, object]: return await primitive(device_id, "debug_state")
    return router
