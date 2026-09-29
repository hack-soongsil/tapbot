import json
from pathlib import Path
import time

import cv2
from fastapi.testclient import TestClient
import numpy as np

from scripts.mock_android_agent import HEIGHT, WIDTH, create_app
from scripts.mock_ssutoday.layout import (
    CONFIRM_SUBMIT,
    DETAIL_BACK,
    DETAIL_CTA,
    DETAIL_DEFAULT_TIME_SCROLL,
    DETAIL_RESET,
    DETAIL_TIMELINE_VIEW,
    detail_slot_rect,
    home_card_rect,
    home_date_chip_rect,
    translate_y,
)
from tapbot.ui_resolution.screens import ScreenRecognizer


TOKEN = "test-token"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
FIXTURE_DIR = Path(__file__).resolve().parents[3] / "ssutoday"


def center(bounds: tuple[int, int, int, int]) -> tuple[int, int]:
    left, top, right, bottom = bounds
    return ((left + right) // 2, (top + bottom) // 2)


def tap(client: TestClient, bounds: tuple[int, int, int, int]) -> None:
    x, y = center(bounds)
    client.post("/api/tap", headers=HEADERS, json={"x": x, "y": y})


def open_room_2c(client: TestClient) -> None:
    client.post(
        "/api/swipe",
        headers=HEADERS,
        json={"x1": 540, "y1": 1750, "x2": 540, "y2": 1100, "duration_ms": 450},
    )
    tap(client, translate_y(home_card_rect(2), -420))


def test_mock_agent_requires_its_bearer_token() -> None:
    client = TestClient(create_app(token=TOKEN))

    assert client.get("/api/status").status_code == 401
    assert client.get("/api/status", headers=HEADERS).status_code == 200


def test_mock_agent_exposes_capture_resolution_and_device_status() -> None:
    client = TestClient(create_app(token=TOKEN))

    status = client.get("/api/status", headers=HEADERS)
    screenshot = client.get("/api/screenshot", headers=HEADERS)
    image = cv2.imdecode(np.frombuffer(screenshot.content, np.uint8), cv2.IMREAD_COLOR)

    assert status.json()["mock"] == {"screen": "home", "screens": 4}
    assert status.json()["coordinate_mapping"] == "screenshot_px_equals_logical_screen_px"
    assert status.json()["display"]["logical_width"] == WIDTH == 1080
    assert status.json()["display"]["logical_height"] == HEIGHT == 2280
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
    assert next(
        element for element in initial.elements
        if element.semantic_id == "room_name[1]"
    ).text == "스터디룸 2B"
    assert next(
        element for element in initial.elements
        if element.semantic_id == "room_availability[1]"
    ).metadata["room_id"] == "room_2b"

    tap(client, home_date_chip_rect(1))
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
        json={"x1": 540, "y1": 1750, "x2": 540, "y2": 1100, "duration_ms": 450},
    )
    scrolled = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert scrolled is not None
    room_2c = next(
        element for element in scrolled.elements
        if element.semantic_id == "room_card[2]"
    )
    assert room_2c.visible is True

    tap(client, translate_y(home_card_rect(1), -420))
    detail = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert detail is not None and detail.screen_id == "study_room_detail"
    assert detail.context == {
        "room_id": "room_2b",
        "room_name": "스터디룸 2B",
        "selected_date": "2026-09-28",
    }


def test_mock_agent_runs_main_detail_confirm_success_flow() -> None:
    client = TestClient(create_app(token=TOKEN))
    recognizer = ScreenRecognizer()

    assert recognizer.recognize(
        client.get("/api/ui-tree", headers=HEADERS).json()
    ).screen_id == "study_room_list"  # type: ignore[union-attr]

    open_room_2c(client)
    detail = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert detail is not None and detail.screen_id == "study_room_detail"
    assert detail.context == {
        "room_id": "room_2c",
        "room_name": "스터디룸 2C",
        "selected_date": "2026-09-29",
    }
    assert {
        "room_hero_image",
        "room_name",
        "room_feature[0]",
        "time_slot[7]",
        "selection_summary",
        "reset_selection",
        "usage_rules",
        "reserve_cta",
    } <= {element.semantic_id for element in detail.elements}

    tap(client, detail_slot_rect(7, DETAIL_DEFAULT_TIME_SCROLL))
    selected = client.get("/api/ui-tree", headers=HEADERS).json()
    cta = next(node for node in selected["nodes"] if node["node_id"] == "reserve-cta")
    assert cta["enabled"] is True
    assert cta["metadata"] == {
        "state": "ready",
        "text": "이 시간으로 예약하기",
        "selected_slot_index": 7,
        "selected_slot_end_index": 7,
        "selected_time": "09:30",
    }

    tap(client, DETAIL_CTA)
    confirm = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert confirm is not None and confirm.screen_id == "study_room_confirm"
    assert {
        "title", "room_name", "date", "time_range", "cancel", "confirm_reservation",
    } <= {element.semantic_id for element in confirm.elements}

    tap(client, CONFIRM_SUBMIT)
    submitting = client.get("/api/ui-tree", headers=HEADERS).json()
    submitting_cta = next(
        node for node in submitting["nodes"] if node["node_id"] == "reserve-cta"
    )
    assert submitting_cta["text"] == "예약 처리 중"
    assert submitting_cta["enabled"] is False

    time.sleep(0.85)
    complete = client.get("/api/ui-tree", headers=HEADERS).json()
    assert complete["window_title"] == "SSUTODAY Mock - success"
    complete_recognition = recognizer.recognize(complete)
    assert complete_recognition is not None
    assert complete_recognition.screen_id == "study_room_complete"
    assert complete_recognition.context == {
        "room_id": "room_2c",
        "room_name": "스터디룸 2C",
        "date": "2026-09-29",
        "time": "09:30",
        "time_range": "09:30 ~ 10:00",
    }
    assert {
        "success_title", "room_name", "date", "time_range", "back_to_reservation",
    } <= {element.semantic_id for element in complete_recognition.elements}

    client.post("/api/back", headers=HEADERS)
    assert client.get("/api/status", headers=HEADERS).json()["mock"]["screen"] == "detail"
    client.post("/api/home", headers=HEADERS)
    assert client.get("/api/status", headers=HEADERS).json()["mock"]["screen"] == "home"
    open_room_2c(client)
    tap(client, DETAIL_BACK)
    back_target = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert back_target is not None and back_target.screen_id == "study_room_list"


def test_detail_has_32_slots_states_horizontal_scroll_reset_and_vertical_scroll() -> None:
    client = TestClient(create_app(token=TOKEN))
    recognizer = ScreenRecognizer()
    open_room_2c(client)

    initial = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert initial is not None
    slots = [item for item in initial.elements if item.semantic_id.startswith("time_slot[")]
    assert len(slots) == 32
    assert slots[7].metadata | {"enabled": slots[7].enabled} == {
        "enabled": True,
        "visible": True,
        "family": "time_slot",
        "index": 7,
        "time": "09:30",
        "start_time": "09:30",
        "end_time": "10:00",
        "state": "current",
        "booked": False,
        "selected": False,
    }
    by_time = next(
        item for item in initial.elements
        if item.semantic_id == "time_slot_by_time[18:30]"
    )
    assert by_time.metadata["index"] == 25
    assert by_time.metadata["start_time"] == "18:30"
    assert by_time.metadata["end_time"] == "19:00"
    assert by_time.visible is False
    assert slots[8].metadata["state"] == "booked"
    assert slots[8].enabled is False
    reserve_cta = next(item for item in initial.elements if item.semantic_id == "reserve_cta")
    assert reserve_cta.enabled is False
    assert reserve_cta.metadata["state"] == "idle"
    assert reserve_cta.metadata["text"] == "시간을 선택하세요"

    reserved_node = next(
        node for node in client.get("/api/ui-tree", headers=HEADERS).json()["nodes"]
        if node["node_id"] == "slot-8"
    )
    assert reserved_node["clickable"] is True
    assert reserved_node["enabled"] is False

    tap(client, detail_slot_rect(8, DETAIL_DEFAULT_TIME_SCROLL))
    unchanged = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert unchanged is not None
    assert next(
        item for item in unchanged.elements if item.semantic_id == "reserve_cta"
    ).enabled is False

    tap(client, detail_slot_rect(7, DETAIL_DEFAULT_TIME_SCROLL))
    tap(client, DETAIL_RESET)
    reset = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert reset is not None
    assert next(
        item for item in reset.elements if item.semantic_id == "reserve_cta"
    ).metadata["state"] == "idle"

    for _ in range(4):
        client.post(
            "/api/swipe",
            headers=HEADERS,
            json={
                "x1": 980,
                "y1": center(DETAIL_TIMELINE_VIEW)[1],
                "x2": 80,
                "y2": center(DETAIL_TIMELINE_VIEW)[1],
                "duration_ms": 450,
            },
        )
    horizontal = recognizer.recognize(client.get("/api/ui-tree", headers=HEADERS).json())
    assert horizontal is not None
    assert next(
        item for item in horizontal.elements
        if item.semantic_id == "time_slot_by_time[18:30]"
    ).visible is True

    client.post(
        "/api/swipe",
        headers=HEADERS,
        json={"x1": 540, "y1": 1850, "x2": 540, "y2": 650, "duration_ms": 450},
    )
    scrolled_tree = client.get("/api/ui-tree", headers=HEADERS).json()
    room_name = next(node for node in scrolled_tree["nodes"] if node["node_id"] == "room-name")
    usage_rules = next(node for node in scrolled_tree["nodes"] if node["node_id"] == "usage-rules")
    assert room_name["visible_to_user"] is False
    assert usage_rules["visible_to_user"] is True


def test_mock_pixels_and_ui_tree_share_the_same_selected_state() -> None:
    client = TestClient(create_app(token=TOKEN))
    open_room_2c(client)
    slot_bounds = detail_slot_rect(7, DETAIL_DEFAULT_TIME_SCROLL)
    tap(client, slot_bounds)

    tree = client.get("/api/ui-tree", headers=HEADERS).json()
    selected_node = next(node for node in tree["nodes"] if node["node_id"] == "slot-7")
    screenshot = client.get("/api/screenshot", headers=HEADERS)
    image = cv2.imdecode(np.frombuffer(screenshot.content, np.uint8), cv2.IMREAD_COLOR)
    x, y = center(slot_bounds)

    assert selected_node["selected"] is True
    assert selected_node["metadata"]["state"] == "selected"
    assert image is not None
    assert int(image[y, x, 0]) > int(image[y, x, 2])


def _perceptual_mae(reference: np.ndarray, mock: np.ndarray) -> float:
    normalized = cv2.resize(reference, (WIDTH, HEIGHT), interpolation=cv2.INTER_AREA)
    reference_signature = cv2.resize(normalized, (32, 64), interpolation=cv2.INTER_AREA)
    mock_signature = cv2.resize(mock, (32, 64), interpolation=cv2.INTER_AREA)
    return float(np.mean(
        np.abs(reference_signature.astype(np.int16) - mock_signature.astype(np.int16))
    ))


def test_fixture_and_mock_have_comparable_large_scale_structure() -> None:
    fixture = cv2.imread(str(FIXTURE_DIR / "main.png"), cv2.IMREAD_COLOR)
    if fixture is None:
        fixture = cv2.imread("/ssutoday/main.png", cv2.IMREAD_COLOR)
    assert fixture is not None

    client = TestClient(create_app(token=TOKEN))
    screenshot = client.get("/api/screenshot", headers=HEADERS)
    mock = cv2.imdecode(np.frombuffer(screenshot.content, np.uint8), cv2.IMREAD_COLOR)
    assert mock is not None

    assert _perceptual_mae(fixture, mock) < 85

    detail_fixture = cv2.imread(str(FIXTURE_DIR / "reservation.jpg"), cv2.IMREAD_COLOR)
    if detail_fixture is None:
        detail_fixture = cv2.imread("/ssutoday/reservation.jpg", cv2.IMREAD_COLOR)
    assert detail_fixture is not None
    open_room_2c(client)
    detail_response = client.get("/api/screenshot", headers=HEADERS)
    detail_mock = cv2.imdecode(
        np.frombuffer(detail_response.content, np.uint8), cv2.IMREAD_COLOR
    )
    assert detail_mock is not None
    assert _perceptual_mae(detail_fixture, detail_mock) < 85


def test_mock_uses_ground_truth_resolution_and_key_ui_tree_bounds() -> None:
    main_fixture = json.loads(
        (FIXTURE_DIR / "main.json").read_text(encoding="utf-8")
    )
    detail_fixture = json.loads(
        (FIXTURE_DIR / "reservation.json").read_text(encoding="utf-8")
    )
    assert (main_fixture["screen_width"], main_fixture["screen_height"]) == (WIDTH, HEIGHT)
    assert (detail_fixture["screen_width"], detail_fixture["screen_height"]) == (WIDTH, HEIGHT)

    client = TestClient(create_app(token=TOKEN))
    home = client.get("/api/ui-tree", headers=HEADERS).json()
    mock_logo = next(node for node in home["nodes"] if node["node_id"] == "app-icon")
    fixture_logo = next(
        node for node in main_fixture["nodes"]
        if node.get("content_description") == "SSUTODAY"
    )
    assert mock_logo["bounds"] == fixture_logo["bounds"]

    fixture_date_bounds = [
        node["bounds"]
        for node in main_fixture["nodes"]
        if node.get("class_name") == "android.widget.Button"
        and 470 <= node["bounds"]["top"] <= 490
    ]
    mock_date_bounds = [
        next(node for node in home["nodes"] if node["node_id"] == f"date-chip-{index}")["bounds"]
        for index in range(5)
    ]
    assert mock_date_bounds == fixture_date_bounds

    open_room_2c(client)
    detail = client.get("/api/ui-tree", headers=HEADERS).json()
    mock_back = next(node for node in detail["nodes"] if node["node_id"] == "back-button")
    fixture_back = next(
        node for node in detail_fixture["nodes"]
        if node.get("class_name") == "android.widget.Button"
        and node["bounds"] == {"left": 55, "top": 107, "right": 168, "bottom": 223}
    )
    assert mock_back["bounds"] == fixture_back["bounds"]
