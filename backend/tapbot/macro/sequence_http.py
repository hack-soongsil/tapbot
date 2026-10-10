"""HTTP routes for authored sequence persistence and background execution."""

from fastapi import APIRouter, HTTPException

from tapbot.android.http import AndroidHttpDependencies
from tapbot.macro.sequence import SequenceService
from tapbot.macro.sequence_models import SequenceDefinition


def create_sequence_router(deps: AndroidHttpDependencies, service: SequenceService) -> APIRouter:
    router = APIRouter(prefix="/api", tags=["macro-sequences"])

    @router.get("/macro/sequences")
    async def list_sequences() -> dict:
        return {"sequences": [value.model_dump(mode="json") for value in service.list()]}

    @router.put("/macro/sequences/{sequence_id}")
    async def save_sequence(sequence_id: str, value: SequenceDefinition) -> dict:
        if sequence_id != value.id:
            raise HTTPException(422, "매크로 ID가 일치하지 않습니다.")
        return (await deps.call(lambda: service.save(value))).model_dump(mode="json")

    @router.get("/android/{device_id}/sequence/runtime")
    async def runtime(device_id: str) -> dict:
        deps.require_service(device_id)
        return service.runner(device_id).snapshot()

    @router.post("/android/{device_id}/sequence/start")
    async def start(device_id: str, value: SequenceDefinition) -> dict:
        deps.require_service(device_id)
        def begin() -> dict:
            try:
                return service.runner(device_id).start(value)
            except ValueError as error:
                raise HTTPException(422, str(error)) from error
        return await deps.call(begin, device_id=device_id)

    @router.post("/android/{device_id}/sequence/{command}")
    async def command(device_id: str, command: str) -> dict:
        deps.require_service(device_id)
        if command not in {"pause", "resume", "stop"}:
            raise HTTPException(404, "알 수 없는 매크로 명령입니다.")
        return service.runner(device_id).command(command)

    return router
