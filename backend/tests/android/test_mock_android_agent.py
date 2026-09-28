import cv2
from fastapi.testclient import TestClient
import numpy as np

from scripts.mock_android_agent import HEIGHT, WIDTH, create_app
from tapbot.ui_resolution.screens import ScreenRecognizer


TOKEN = "test-token"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


def test_mock_agent_requires_its_bearer_token() -> None:
    client = TestClient(create_app(token=TOKEN))

    assert client.get("/api/status").status_code == 401
    assert client.get("/api/status", headers=HEADERS).status_code == 200


def test_mock_agent_exposes_valid_screenshot_and_device_status() -> None:
    client = TestClient(create_app(token=TOKEN))

    status = client.get("/api/status", headers=HEADERS)
    screenshot = client.get("/api/screenshot", headers=HEADERS)
    image = cv2.imdecode(np.frombuffer(screenshot.content, np.uint8), cv2.IMREAD_COLOR)

    assert status.json()["mock"] == {"screen": "home", "screens": 3}
    assert screenshot.headers["x-screen-width"] == str(WIDTH)
    assert screenshot.headers["x-screen-height"] == str(HEIGHT)
    assert image is not None and image.shape == (HEIGHT, WIDTH, 3)


def test_mock_agent_moves_through_three_screens_and_supports_navigation() -> None:
    client = TestClient(create_app(token=TOKEN))
    recognizer = ScreenRecognizer()

    home = client.get("/api/ui-tree", headers=HEADERS).json()
    assert recognizer.recognize(home).screen_id == "reservation_home"  # type: ignore[union-attr]

    client.post("/api/tap", headers=HEADERS, json={"x": 210, "y": 300})
    detail = client.get("/api/ui-tree", headers=HEADERS).json()
    assert recognizer.recognize(detail).screen_id == "reservation_detail"  # type: ignore[union-attr]

    client.post("/api/tap", headers=HEADERS, json={"x": 100, "y": 300})
    selected = client.get("/api/ui-tree", headers=HEADERS).json()
    cta = next(node for node in selected["nodes"] if node["node_id"] == "reserve")
    assert cta["enabled"] is True

    client.post("/api/tap", headers=HEADERS, json={"x": 210, "y": 690})
    complete = client.get("/api/ui-tree", headers=HEADERS).json()
    assert complete["window_title"] == "TapBot Mock - complete"

    client.post("/api/back", headers=HEADERS)
    assert client.get("/api/status", headers=HEADERS).json()["mock"]["screen"] == "detail"
    client.post("/api/home", headers=HEADERS)
    assert client.get("/api/status", headers=HEADERS).json()["mock"]["screen"] == "home"
