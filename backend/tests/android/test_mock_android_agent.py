import time

import cv2
from fastapi.testclient import TestClient
import numpy as np

from scripts.mock_android_agent import HEIGHT, WIDTH, create_app
from tapbot.ui_resolution.screens import ScreenRecognizer


TOKEN = "test-token"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


def open_room_2c(client: TestClient) -> None:
    client.post(
        "/api/swipe",
        headers=HEADERS,
        json={"x1": 210, "y1": 620, "x2": 210, "y2": 340, "duration_ms": 450},
    )
    client.post("/api/tap", headers=HEADERS, json={"x": 210, "y": 606})


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


def test_study_room_list_date_cards_room_cards_and_scroll() -> None:
    client = TestClient(create_app(token=TOKEN))
    recognizer = ScreenRecognizer()

    initial_tree = client.get("/api/ui-tree", headers=HEADERS).json()
    initial = recognizer.recognize(initial_tree)
    assert initial is not None and initial.screen_id == "study_room_list"
    assert initial.context == {"selected_date": "2026-09-29"}

    date_chips = [
        element for element in initial.elements
        if element.semantic_id.startswith("date_chip[")
    ]
    room_cards = [
        element for element in initial.elements
        if element.semantic_id.startswith("room_card[")
    ]
    assert len(date_chips) == 5
    assert len(room_cards) == 3
    assert date_chips[2].metadata == {
        "enabled": True,
        "visible": True,
        "family": "date_chip",
        "index": 2,
        "full_date": "2026-09-29",
        "selected": True,
        "day_label": "화",
        "day_number": "29",
    }
    room_2b = next(
        element for element in initial.elements
        if element.semantic_id == "room_card_by_name[스터디룸 2B]"
    )
    assert room_2b.metadata["room_id"] == "room_2b"
    assert room_2b.metadata["capacity"] == "10인실"
    assert room_2b.metadata["location"] == "2층 중앙"

    client.post("/api/tap", headers=HEADERS, json={"x": 136, "y": 240})
    changed = client.get("/api/ui-tree", headers=HEADERS).json()
    selected_date = next(
        node for node in changed["nodes"] if node["node_id"] == "selected-date"
    )
    selected_chip = next(
        node for node in changed["nodes"] if node["node_id"] == "date-chip-1"
    )
    assert selected_date["text"] == "2026년 9월 28일(월)"
    assert selected_chip["selected"] is True

    client.post(
        "/api/swipe",
        headers=HEADERS,
        json={"x1": 210, "y1": 620, "x2": 210, "y2": 340, "duration_ms": 450},
    )
    scrolled = recognizer.recognize(
        client.get("/api/ui-tree", headers=HEADERS).json()
    )
    assert scrolled is not None
    room_2c = next(
        element for element in scrolled.elements
        if element.semantic_id == "room_card[2]"
    )
    assert room_2c.visible is True

    client.post("/api/tap", headers=HEADERS, json={"x": 210, "y": 388})
    detail = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert detail is not None and detail.screen_id == "study_room_detail"
    assert detail.context == {
        "room_id": "room_2b",
        "room_name": "스터디룸 2B",
        "selected_date": "2026-09-28",
    }


def test_mock_agent_moves_through_three_screens_and_supports_navigation() -> None:
    client = TestClient(create_app(token=TOKEN))
    recognizer = ScreenRecognizer()

    home = client.get("/api/ui-tree", headers=HEADERS).json()
    assert recognizer.recognize(home).screen_id == "study_room_list"  # type: ignore[union-attr]

    open_room_2c(client)
    detail = client.get("/api/ui-tree", headers=HEADERS).json()
    detail_recognition = recognizer.recognize(detail)
    assert detail_recognition is not None
    assert detail_recognition.screen_id == "study_room_detail"
    assert detail_recognition.context == {
        "room_id": "room_2c",
        "room_name": "스터디룸 2C",
        "selected_date": "2026-09-29",
    }
    semantic_ids = {element.semantic_id for element in detail_recognition.elements}
    assert {
        "room_hero_image",
        "room_name",
        "room_feature[0]",
        "room_feature[1]",
        "time_slot[3]",
        "selection_summary",
        "reset_selection",
        "usage_rules",
        "reserve_cta",
    } <= semantic_ids

    client.post("/api/tap", headers=HEADERS, json={"x": 189, "y": 418})
    selected = client.get("/api/ui-tree", headers=HEADERS).json()
    cta = next(node for node in selected["nodes"] if node["node_id"] == "reserve-cta")
    assert cta["enabled"] is True
    assert cta["metadata"] == {
        "state": "SELECTED",
        "enabled": True,
        "selected_slot_index": 3,
        "selected_time": "09:30",
    }

    client.post("/api/tap", headers=HEADERS, json={"x": 210, "y": 720})
    submitting = client.get("/api/ui-tree", headers=HEADERS).json()
    submitting_cta = next(
        node for node in submitting["nodes"] if node["node_id"] == "reserve-cta"
    )
    assert submitting_cta["text"] == "예약 처리 중"
    assert submitting_cta["enabled"] is False

    time.sleep(0.45)
    complete = client.get("/api/ui-tree", headers=HEADERS).json()
    assert complete["window_title"] == "TapBot Mock - complete"
    complete_recognition = recognizer.recognize(complete)
    assert complete_recognition is not None
    assert complete_recognition.screen_id == "study_room_complete"
    assert complete_recognition.context == {
        "room_id": "room_2c",
        "room_name": "스터디룸 2C",
        "date": "2026-09-29",
        "time": "09:30",
    }
    assert any(
        node["text"] == "스터디룸 2C · 2026-09-29 · 09:30"
        for node in complete["nodes"]
    )

    client.post("/api/back", headers=HEADERS)
    assert client.get("/api/status", headers=HEADERS).json()["mock"]["screen"] == "detail"
    client.post("/api/home", headers=HEADERS)
    assert client.get("/api/status", headers=HEADERS).json()["mock"]["screen"] == "home"
    client.post("/api/tap", headers=HEADERS, json={"x": 210, "y": 450})
    client.post("/api/tap", headers=HEADERS, json={"x": 42, "y": 68})
    back_target = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert back_target is not None and back_target.screen_id == "study_room_list"


def test_detail_reserved_reset_and_scroll_semantics() -> None:
    client = TestClient(create_app(token=TOKEN))
    recognizer = ScreenRecognizer()
    open_room_2c(client)

    initial = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert initial is not None
    slots = [item for item in initial.elements if item.semantic_id.startswith("time_slot")]
    assert len(slots) == 8
    assert slots[3].metadata | {"enabled": slots[3].enabled} == {
        "enabled": True,
        "visible": True,
        "family": "time_slot",
        "index": 3,
        "time": "09:30",
        "state": "available",
        "selected": False,
    }
    assert slots[4].metadata["state"] == "reserved"
    assert slots[4].enabled is False
    current_tree = client.get("/api/ui-tree", headers=HEADERS).json()
    reserved_node = next(
        node for node in current_tree["nodes"] if node["node_id"] == "slot-4"
    )
    assert reserved_node["clickable"] is True
    assert reserved_node["enabled"] is False

    client.post("/api/tap", headers=HEADERS, json={"x": 237, "y": 418})
    unchanged = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert unchanged is not None
    assert next(
        item for item in unchanged.elements if item.semantic_id == "reserve_cta"
    ).enabled is False

    client.post("/api/tap", headers=HEADERS, json={"x": 189, "y": 418})
    client.post("/api/tap", headers=HEADERS, json={"x": 360, "y": 540})
    reset = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert reset is not None
    reset_cta = next(
        item for item in reset.elements if item.semantic_id == "reserve_cta"
    )
    assert reset_cta.metadata["state"] == "NO_SELECTION"

    client.post(
        "/api/swipe",
        headers=HEADERS,
        json={"x1": 210, "y1": 620, "x2": 210, "y2": 390, "duration_ms": 450},
    )
    scrolled_tree = client.get("/api/ui-tree", headers=HEADERS).json()
    room_name = next(
        node for node in scrolled_tree["nodes"] if node["node_id"] == "room-name"
    )
    usage_rules = next(
        node for node in scrolled_tree["nodes"] if node["node_id"] == "usage-rules"
    )
    assert room_name["visible_to_user"] is False
    assert usage_rules["visible_to_user"] is True
