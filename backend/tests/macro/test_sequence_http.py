from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tapbot.android.http import AndroidHttpDependencies, create_android_router
from tapbot.events import EventLog
from tapbot.macro.sequence import SequenceService
from tapbot.macro.sequence_http import create_sequence_router
from tests.fakes.sequence import RecordingSequencePort


def test_saved_sequence_runs_and_blocks_manual_input_until_stopped(tmp_path):
    port = RecordingSequencePort()
    sequences = SequenceService(tmp_path, lambda _: port)
    phone = SimpleNamespace(device_id="phone", manual_tap=Mock())
    registry = SimpleNamespace(default_device_id="phone", get=lambda _: SimpleNamespace(debug_service=phone))
    deps = AndroidHttpDependencies(registry, EventLog(), discovery=Mock(), input_operation=sequences.run_input)
    app = FastAPI()
    app.include_router(create_sequence_router(deps, sequences))
    app.include_router(create_android_router(deps))
    value = {"id": "test", "name": "Test", "screen_width": 100, "screen_height": 100,
             "steps": [{"id": "one", "label": "One", "kind": "point", "x": 10, "y": 20, "delay_ms": 600000}]}
    try:
        with TestClient(app) as client:
            assert client.put("/api/macro/sequences/test", json=value).status_code == 200
            assert any(item["id"] == "test" for item in client.get("/api/macro/sequences").json()["sequences"])
            assert client.post("/api/android/phone/sequence/start", json=value).status_code == 200
            assert port.entered.wait(1)
            assert client.post("/api/android/phone/sequence/start", json=value).status_code == 409
            assert client.post("/api/android/phone/tap", json={"x": 1, "y": 2}).status_code == 409
            phone.manual_tap.assert_not_called()
            assert client.post("/api/android/phone/sequence/pause").json()["status"] == "PAUSED"
            assert client.post("/api/android/phone/sequence/resume").json()["status"] == "RUNNING"
            assert client.post("/api/android/phone/sequence/stop").status_code == 200
            assert client.put("/api/macro/sequences/mismatch", json=value).status_code == 422
    finally:
        sequences.close()


def test_preflight_validation_is_reported_as_422(tmp_path):
    port = RecordingSequencePort()
    port.prepare = Mock(side_effect=ValueError("화면 크기가 바뀌었습니다."))
    sequences = SequenceService(tmp_path, lambda _: port)
    deps = AndroidHttpDependencies(Mock(), EventLog(), discovery=Mock())
    app = FastAPI()
    app.include_router(create_sequence_router(deps, sequences))
    with TestClient(app) as client:
        response = client.post("/api/android/phone/sequence/start", json={
            "id": "test", "name": "Test", "screen_width": 100, "screen_height": 100,
            "steps": [{"id": "one", "label": "One", "kind": "point", "x": 10, "y": 20}],
        })
        assert response.status_code == 422
        assert not port.calls
