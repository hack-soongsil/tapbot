"""FastAPI transport for legacy lifecycle and graph macro management."""

from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

from tapbot.android.http import AndroidHttpDependencies
from tapbot.macro.binding import DeviceMacroBinding
from tapbot.macro.graph_models import MacroDefinition
from tapbot.macro.service import MacroManagementService


def create_macro_router(
    deps: AndroidHttpDependencies,
    management: MacroManagementService | None = None,
) -> APIRouter:
    router = APIRouter(tags=["macro"])

    async def legacy(command: str, device_id: str | None = None) -> dict[str, object]:
        service = deps.require_service(device_id)
        return await deps.call(getattr(service, f"{command}_macro"), device_id=service.device_id)

    async def command(
        command_name: str,
        device_id: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, object]:
        if management is not None and management.get_binding(device_id) is not None:
            try:
                if command_name == "start":
                    raw_variables = (payload or {}).get("variables", {})
                    if not isinstance(raw_variables, dict) or not all(
                        isinstance(key, str) for key in raw_variables
                    ):
                        raise ValueError("runtime variables must be an object")
                    value = await asyncio.to_thread(
                        management.start,
                        device_id,
                        initial_variables=dict(raw_variables),
                    )
                else:
                    value = await asyncio.to_thread(getattr(management, command_name), device_id)
                return {"runtime": value}
            except Exception as error:
                raise _http_error(error) from error
        if command_name == "resume":
            command_name = "start"
        return await legacy(command_name, device_id)

    @router.post("/api/android/macro/start")
    async def start() -> dict[str, object]: return await legacy("start")
    @router.post("/api/android/macro/pause")
    async def pause() -> dict[str, object]: return await legacy("pause")
    @router.post("/api/android/macro/stop")
    async def stop() -> dict[str, object]: return await legacy("stop")
    @router.post("/api/android/macro/reset")
    async def reset() -> dict[str, object]: return await legacy("reset")
    @router.post("/api/android/macro/step")
    async def step() -> dict[str, object]: return await legacy("step")

    def command_endpoint(operation: str):
        async def endpoint(
            device_id: str,
            payload: dict[str, Any] | None = None,
        ) -> dict[str, object]:
            return await command(operation, device_id, payload)
        return endpoint

    for operation in ("start", "pause", "resume", "stop", "reset", "step"):
        router.add_api_route(
            f"/api/android/{{device_id}}/macro/{operation}", command_endpoint(operation),
            methods=["POST"], name=f"device_macro_{operation}",
        )

    if management is None:
        return router

    @router.get("/api/macros")
    async def list_definitions() -> dict[str, object]:
        return {"macros": [item.to_dict() for item in management.list_definitions()]}

    @router.post("/api/macros", status_code=201)
    async def create_definition(payload: dict[str, Any]) -> dict[str, object]:
        try:
            return management.create_definition(MacroDefinition.from_dict(payload)).to_dict()
        except Exception as error:
            raise _http_error(error) from error

    @router.post("/api/macros/validate")
    async def validate_unsaved(payload: dict[str, Any]) -> dict[str, object]:
        try:
            return management.validate_definition(MacroDefinition.from_dict(payload))
        except Exception as error:
            raise _http_error(error) from error

    @router.get("/api/macros/{macro_id}")
    async def get_definition(macro_id: str) -> dict[str, object]:
        try:
            return management.get_definition(macro_id).to_dict()
        except Exception as error:
            raise _http_error(error) from error

    @router.put("/api/macros/{macro_id}")
    async def save_definition(macro_id: str, payload: dict[str, Any]) -> dict[str, object]:
        try:
            definition = MacroDefinition.from_dict(payload)
            if definition.id != macro_id:
                raise ValueError("path macro id does not match payload id")
            return management.save_definition(definition).to_dict()
        except Exception as error:
            raise _http_error(error) from error

    @router.delete("/api/macros/{macro_id}", status_code=204)
    async def delete_definition(macro_id: str) -> Response:
        try:
            if not management.delete_definition(macro_id):
                raise KeyError(f"macro definition {macro_id!r} was not found")
            return Response(status_code=204)
        except Exception as error:
            raise _http_error(error) from error

    @router.post("/api/macros/{macro_id}/validate")
    async def validate_definition(macro_id: str, payload: dict[str, Any] | None = None) -> dict[str, object]:
        try:
            definition = management.get_definition(macro_id) if payload is None else MacroDefinition.from_dict(payload)
            if definition.id != macro_id:
                raise ValueError("path macro id does not match payload id")
            return management.validate_definition(definition)
        except Exception as error:
            raise _http_error(error) from error

    @router.post("/api/macros/{macro_id}/duplicate", status_code=201)
    async def duplicate_definition(macro_id: str, payload: dict[str, Any]) -> dict[str, object]:
        try:
            new_id = str(payload.get("id") or f"macro-{uuid4().hex[:12]}")
            name = payload.get("name")
            return management.duplicate_definition(
                macro_id, new_id=new_id, name=None if name is None else str(name)
            ).to_dict()
        except Exception as error:
            raise _http_error(error) from error

    @router.get("/api/android/{device_id}/macro-binding")
    async def get_binding(device_id: str) -> dict[str, object]:
        return management.binding_payload(device_id)

    @router.put("/api/android/{device_id}/macro-binding")
    async def put_binding(device_id: str, payload: dict[str, Any]) -> dict[str, object]:
        try:
            enabled = payload.get("enabled", True)
            config = payload.get("config", {})
            if not isinstance(enabled, bool):
                raise ValueError("binding enabled must be a boolean")
            if not isinstance(config, dict):
                raise ValueError("binding config must be an object")
            binding = management.bind(DeviceMacroBinding(
                device_id=device_id,
                macro_definition_id=str(payload.get("macro_definition_id", "")),
                enabled=enabled,
                config=dict(config),
            ))
            return {
                "binding": binding.to_dict(),
                "shared_device_count": management.bindings.count_for_macro(binding.macro_definition_id),
            }
        except Exception as error:
            raise _http_error(error) from error

    @router.delete("/api/android/{device_id}/macro-binding", status_code=204)
    async def delete_binding(device_id: str) -> Response:
        try:
            management.unbind(device_id)
            return Response(status_code=204)
        except Exception as error:
            raise _http_error(error) from error

    @router.get("/api/android/{device_id}/macro/runtime")
    async def runtime(device_id: str) -> dict[str, object]:
        return {"runtime": management.runtime(device_id)}

    @router.get("/api/android/{device_id}/macro/events")
    async def events(device_id: str, request: Request) -> StreamingResponse:
        try:
            if not management.device_exists(device_id):
                raise KeyError(f"Android device {device_id!r} was not found")
        except Exception as error:
            raise _http_error(error) from error
        last_event_id = request.headers.get("last-event-id")

        async def stream():
            nonlocal last_event_id
            yield "retry: 2000\n\n"
            while not await request.is_disconnected():
                batch = await asyncio.to_thread(
                    management.runtimes.events.wait_for_events,
                    device_id,
                    after_event_id=last_event_id,
                    timeout_sec=10.0,
                )
                if not batch:
                    yield ": keepalive\n\n"
                    continue
                for event in batch:
                    last_event_id = event.event_id
                    payload = json.dumps(event.to_dict(), ensure_ascii=False)
                    yield f"id: {event.event_id}\nevent: {event.type}\ndata: {payload}\n\n"

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    return router


def _http_error(error: Exception) -> HTTPException:
    if isinstance(error, KeyError):
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, RuntimeError):
        return HTTPException(status_code=409, detail=str(error))
    if isinstance(error, TimeoutError):
        return HTTPException(status_code=504, detail=str(error))
    return HTTPException(status_code=422, detail=str(error))
