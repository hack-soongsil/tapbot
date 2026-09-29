from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import time
from typing import Any

import cv2
from fastapi.testclient import TestClient
import numpy as np

from scripts.mock_android_agent import HEIGHT, WIDTH, create_app
from scripts.mock_ssutoday.fixtures import (
    END_HOUR,
    SLOT_COUNT,
    SLOT_MINUTES,
    SLOT_TIMES,
    START_HOUR,
    slot_end_time,
)
from scripts.mock_ssutoday.layout import (
    CONFIRM_SUBMIT,
    DETAIL_CTA,
    DETAIL_DEFAULT_TIME_SCROLL,
    DETAIL_RESET,
    detail_slot_rect,
    home_card_rect,
    home_date_chip_rect,
    translate_y,
)
from tapbot.ui_resolution.screens import ScreenRecognition, ScreenRecognizer


TOKEN = "ssutoday-contract"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
FIXTURE_DIR = Path(__file__).resolve().parents[3] / "ssutoday"
FIXTURE_SHA256 = {
    "main.png": "b3575d91ddc49a64b89ca9da0aa7c055fceba28afbdcc057a3851bcad5862e3c",
    "main.json": "f3dc535aef8093daa1b26ee5f44b28dcfd1062641416d6d7aaa759937fd07381",
    # The supplied detail capture is JPEG despite the specification's PNG name.
    "reservation.jpg": "4e583e41e2c8ab7f082e05a76c41bc39b17ac21a051ba074fc2323b2659b6eba",
    "reservation.json": "223b8a80e7b0139bb41278ae8418299d9dd171e02d1990adfb372e50797e938b",
}
FIXTURE_IMAGE_SIZES = {
    "main.png": (2532, 1170),
    "reservation.jpg": (1536, 710),
}
REQUIRED_MOCK_NODE_FIELDS = {
    "id",
    "node_id",
    "bounds",
    "class_name",
    "clickable",
    "enabled",
    "visible",
    "visible_to_user",
    "selected",
    "text",
    "content_description",
    "metadata",
}


@dataclass(frozen=True, slots=True)
class ContractSnapshot:
    image: np.ndarray
    tree: dict[str, Any]
    recognition: ScreenRecognition


def _load_json(name: str) -> dict[str, Any]:
    return json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))


def _load_normalized_fixture_image(name: str) -> np.ndarray:
    """Map encoded capture pixels onto the UI Tree's logical display space."""

    image = cv2.imread(str(FIXTURE_DIR / name), cv2.IMREAD_COLOR)
    assert image is not None
    assert image.shape[:2] == FIXTURE_IMAGE_SIZES[name]
    return cv2.resize(image, (WIDTH, HEIGHT), interpolation=cv2.INTER_AREA)


def _perceptual_metrics(
    expected: np.ndarray,
    actual: np.ndarray,
) -> tuple[float, float]:
    # A small, blurred thumbnail catches structural/layout drift while staying
    # tolerant of JPEG encoding and the mock's procedural room imagery/fonts.
    thumbnail_size = (54, 114)
    expected_small = cv2.resize(
        expected, thumbnail_size, interpolation=cv2.INTER_AREA
    )
    actual_small = cv2.resize(actual, thumbnail_size, interpolation=cv2.INTER_AREA)
    expected_small = cv2.GaussianBlur(expected_small, (9, 9), 0)
    actual_small = cv2.GaussianBlur(actual_small, (9, 9), 0)
    distance = float(
        np.abs(expected_small.astype(np.float32) - actual_small.astype(np.float32)).mean()
        / 255.0
    )
    expected_gray = cv2.cvtColor(expected_small, cv2.COLOR_BGR2GRAY).astype(np.float32)
    actual_gray = cv2.cvtColor(actual_small, cv2.COLOR_BGR2GRAY).astype(np.float32)
    correlation = float(np.corrcoef(expected_gray.ravel(), actual_gray.ravel())[0, 1])
    return distance, correlation


def _bounds(node: dict[str, Any]) -> tuple[int, int, int, int]:
    value = node["bounds"]
    return (value["left"], value["top"], value["right"], value["bottom"])


def _center(bounds: tuple[int, int, int, int]) -> tuple[int, int]:
    left, top, right, bottom = bounds
    return ((left + right) // 2, (top + bottom) // 2)


def _tap(client: TestClient, bounds: tuple[int, int, int, int]) -> None:
    x, y = _center(bounds)
    response = client.post("/api/tap", headers=HEADERS, json={"x": x, "y": y})
    assert response.status_code == 200


def _node(tree: dict[str, Any], node_id: str) -> dict[str, Any]:
    return next(node for node in tree["nodes"] if node["node_id"] == node_id)


def _semantic(
    snapshot: ContractSnapshot,
    semantic_id: str,
):
    return next(
        element for element in snapshot.recognition.elements
        if element.semantic_id == semantic_id
    )


def _assert_semantic_mirrors_fixture_node(
    semantic: Any,
    raw: dict[str, Any],
) -> None:
    assert semantic.bounds.to_list() == list(_bounds(raw))
    assert semantic.class_name == raw["class_name"]
    assert semantic.text == raw.get("text")
    assert semantic.content_description == raw.get("content_description")
    assert semantic.enabled == raw["enabled"]
    assert semantic.visible == raw["visible_to_user"]
    assert (semantic.role == "button") == raw["clickable"]


def _crop(
    image: np.ndarray,
    bounds: tuple[int, int, int, int],
) -> np.ndarray:
    left, top, right, bottom = bounds
    return image[max(0, top):min(HEIGHT, bottom), max(0, left):min(WIDTH, right)]


def _capture(client: TestClient) -> ContractSnapshot:
    tree_response = client.get("/api/ui-tree", headers=HEADERS)
    screenshot_response = client.get("/api/screenshot", headers=HEADERS)
    assert tree_response.status_code == screenshot_response.status_code == 200
    tree = tree_response.json()
    image = cv2.imdecode(
        np.frombuffer(screenshot_response.content, np.uint8), cv2.IMREAD_COLOR
    )
    recognition = ScreenRecognizer().recognize(tree)
    assert image is not None and image.shape == (HEIGHT, WIDTH, 3)
    assert recognition is not None
    assert (tree["screen_width"], tree["screen_height"]) == (WIDTH, HEIGHT)
    _assert_mock_node_schema_and_visual_bounds(tree, image)
    return ContractSnapshot(image=image, tree=tree, recognition=recognition)


def _assert_mock_node_schema_and_visual_bounds(
    tree: dict[str, Any],
    image: np.ndarray,
) -> None:
    for node in tree["nodes"]:
        assert REQUIRED_MOCK_NODE_FIELDS <= node.keys()
        assert node["id"] == node["node_id"]
        assert node["visible"] == node["visible_to_user"]
        if not node["clickable"] or not node["visible"]:
            continue
        left, top, right, bottom = _bounds(node)
        assert right > left and bottom > top
        assert right > 0 and bottom > 0 and left < WIDTH and top < HEIGHT
        component_pixels = _crop(image, (left, top, right, bottom))
        assert component_pixels.size > 0
        assert float(component_pixels.std()) > 0.5, node["node_id"]


def _assert_slot_geometry(
    snapshot: ContractSnapshot,
    index: int,
    state: str,
) -> None:
    raw = _node(snapshot.tree, f"slot-{index}")
    expected = detail_slot_rect(index, DETAIL_DEFAULT_TIME_SCROLL, state)
    assert _bounds(raw) == expected
    semantic = _semantic(snapshot, f"time_slot[{index}]")
    assert semantic.bounds.to_list() == list(expected)
    assert semantic.metadata["state"] == state
    assert semantic.metadata["selected"] == (state == "selected")


def _assert_complete_slot_contract(snapshot: ContractSnapshot) -> None:
    slots = [
        node for node in snapshot.tree["nodes"]
        if re.fullmatch(r"slot-[0-9]+", node["node_id"])
    ]
    assert len(slots) == SLOT_COUNT == 32
    for index, raw in enumerate(slots):
        metadata = raw["metadata"]
        state = metadata["state"]
        assert state in {
            "available",
            "booked",
            "mine",
            "past",
            "current",
            "selected",
        }
        assert raw["class_name"] == "android.widget.Button"
        assert raw["clickable"] is True
        assert raw["selected"] == metadata["selected"]
        assert raw["enabled"] == metadata["enabled"]
        assert raw["visible"] == metadata["visible"]
        assert metadata["booked"] == (state in {"booked", "mine"})
        assert metadata["mine"] == (state == "mine")
        assert metadata["selected"] == (state == "selected")
        assert metadata["enabled"] == (
            state in {"available", "current", "selected"}
        )
        assert metadata == {
            "semantic_family": "time_slot",
            "index": index,
            "time": SLOT_TIMES[index],
            "start_time": SLOT_TIMES[index],
            "end_time": slot_end_time(index),
            "state": state,
            "booked": metadata["booked"],
            "mine": metadata["mine"],
            "selected": metadata["selected"],
            "enabled": metadata["enabled"],
            "visible": metadata["visible"],
        }
        semantic = _semantic(snapshot, f"time_slot[{index}]")
        assert semantic.metadata["index"] == index
        assert semantic.metadata["start_time"] == SLOT_TIMES[index]
        assert semantic.metadata["end_time"] == slot_end_time(index)
        assert semantic.metadata["state"] == state
        assert semantic.metadata["enabled"] == raw["enabled"]
        assert semantic.metadata["visible"] == raw["visible"]


def _open_room_2c(client: TestClient) -> None:
    response = client.post(
        "/api/swipe",
        headers=HEADERS,
        json={"x1": 540, "y1": 1750, "x2": 540, "y2": 1100, "duration_ms": 450},
    )
    assert response.status_code == 200
    _tap(client, translate_y(home_card_rect(2), -420))


def test_ground_truth_fixture_fingerprint_and_interactive_mapping_contract() -> None:
    for name, expected in FIXTURE_SHA256.items():
        assert hashlib.sha256((FIXTURE_DIR / name).read_bytes()).hexdigest() == expected

    main = _load_json("main.json")
    detail = _load_json("reservation.json")
    assert (main["screen_width"], main["screen_height"]) == (WIDTH, HEIGHT)
    assert (detail["screen_width"], detail["screen_height"]) == (WIDTH, HEIGHT)
    assert (START_HOUR, END_HOUR, SLOT_MINUTES) == (6, 22, 30)
    assert SLOT_TIMES[0] == "06:00"
    assert SLOT_TIMES[-1] == "21:30"
    assert slot_end_time(SLOT_COUNT - 1) == "22:00"

    recognizer = ScreenRecognizer()
    main_result = recognizer.recognize(main)
    detail_result = recognizer.recognize(detail)
    assert main_result is not None and main_result.screen_id == "study_room_list"
    assert detail_result is not None and detail_result.screen_id == "study_room_detail"

    main_elements = {element.semantic_id: element for element in main_result.elements}
    assert {
        "history_button",
        "date_picker",
        "selected_date_chip",
        "bottom_tab_home",
        "bottom_tab_booking",
        "bottom_tab_me",
        *(f"date_chip[{index}]" for index in range(5)),
    } <= main_elements.keys()
    assert main_result.context == {"selected_date": "2026-09-27"}

    fixture_date_buttons = [
        node for node in main["nodes"]
        if node.get("class_name") == "android.widget.Button"
        and re.fullmatch(r"[월화수목금토일] [0-9]{1,2}", node.get("text") or "")
    ]
    assert len(fixture_date_buttons) == 5
    for index, raw in enumerate(fixture_date_buttons):
        _assert_semantic_mirrors_fixture_node(
            main_elements[f"date_chip[{index}]"], raw
        )

    history = next(
        node for node in main["nodes"]
        if node.get("class_name") == "android.widget.Button"
        and node.get("content_description") == "예약 내역"
    )
    date_picker = next(
        node for node in main["nodes"]
        if node.get("class_name") == "android.widget.Button"
        and re.fullmatch(r"2026년 .+", node.get("text") or "")
    )
    _assert_semantic_mirrors_fixture_node(main_elements["history_button"], history)
    _assert_semantic_mirrors_fixture_node(main_elements["date_picker"], date_picker)
    for semantic_id, description in (
        ("bottom_tab_home", "공지"),
        ("bottom_tab_booking", "예약"),
        ("bottom_tab_me", "마이"),
    ):
        raw = next(
            node for node in main["nodes"]
            if node.get("class_name") == "android.view.View"
            and node.get("content_description") == description
        )
        _assert_semantic_mirrors_fixture_node(main_elements[semantic_id], raw)

    # main.json was captured while its async room list still showed the loading
    # placeholder. Loaded room-card geometry is therefore covered by main.png
    # and the A/C mock states below without mutating the supplied fixture.
    assert any(
        node.get("text") == "스터디룸 현황을 불러오는 중"
        for node in main["nodes"]
    )

    detail_elements = {element.semantic_id: element for element in detail_result.elements}
    assert {
        "back",
        "date_picker",
        "reset_selection",
        "reserve_cta",
        *(f"time_slot[{index}]" for index in range(32)),
    } <= detail_elements.keys()
    fixture_slots = [
        node for node in detail["nodes"]
        if node.get("class_name") == "android.widget.Button"
        and not node.get("text")
        and not node.get("content_description")
        and node["bounds"]["top"] >= 1000
    ]
    assert len(fixture_slots) == 32
    for index, raw in enumerate(fixture_slots):
        _assert_semantic_mirrors_fixture_node(
            detail_elements[f"time_slot[{index}]"], raw
        )

    detail_raw_by_semantic = {
        "back": next(
            node for node in detail["nodes"]
            if node.get("class_name") == "android.widget.Button"
            and node["bounds"] == {"left": 55, "top": 107, "right": 168, "bottom": 223}
        ),
        "date_picker": next(
            node for node in detail["nodes"]
            if node.get("class_name") == "android.widget.Button"
            and re.fullmatch(r"2026년 .+", node.get("text") or "")
        ),
        "reset_selection": next(
            node for node in detail["nodes"] if node.get("text") == "초기화"
        ),
        "reserve_cta": next(
            node for node in detail["nodes"] if node.get("text") == "시간을 선택하세요"
        ),
    }
    for semantic_id, raw in detail_raw_by_semantic.items():
        _assert_semantic_mirrors_fixture_node(detail_elements[semantic_id], raw)


def test_mock_visual_regression_against_capture_fixtures() -> None:
    client = TestClient(create_app(token=TOKEN))

    main = _capture(client)
    expected_main = _load_normalized_fixture_image("main.png")
    main_distance, main_correlation = _perceptual_metrics(
        expected_main, main.image
    )
    assert main_distance < 0.045
    assert main_correlation > 0.76

    # Region thresholds make a header/card shift fail even when the mostly
    # white whole-screen background would otherwise hide the regression.
    main_header_distance, _ = _perceptual_metrics(
        _crop(expected_main, (0, 0, WIDTH, 790)),
        _crop(main.image, (0, 0, WIDTH, 790)),
    )
    main_cards_distance, _ = _perceptual_metrics(
        _crop(expected_main, (0, 790, WIDTH, 1984)),
        _crop(main.image, (0, 790, WIDTH, 1984)),
    )
    assert main_header_distance < 0.075
    assert main_cards_distance < 0.06

    _open_room_2c(client)
    detail = _capture(client)
    expected_detail = _load_normalized_fixture_image("reservation.jpg")
    detail_distance, detail_correlation = _perceptual_metrics(
        expected_detail, detail.image
    )
    assert detail_distance < 0.085
    assert detail_correlation > 0.68

    # The source hero is a real photo while the mock is intentionally
    # procedural, so the tighter crop contract targets the interactive area.
    detail_controls_distance, _ = _perceptual_metrics(
        _crop(expected_detail, (0, 735, WIDTH, 1500)),
        _crop(detail.image, (0, 735, WIDTH, 1500)),
    )
    detail_lower_distance, _ = _perceptual_metrics(
        _crop(expected_detail, (0, 1350, WIDTH, HEIGHT)),
        _crop(detail.image, (0, 1350, WIDTH, HEIGHT)),
    )
    assert detail_controls_distance < 0.05
    assert detail_lower_distance < 0.055


def test_a_to_j_visual_tree_and_semantic_state_contract() -> None:
    client = TestClient(create_app(token=TOKEN))

    # A. Initial Main
    initial = _capture(client)
    assert initial.recognition.screen_id == "study_room_list"
    assert len([
        item for item in initial.recognition.elements
        if re.fullmatch(r"room_card\[[0-9]+\]", item.semantic_id)
    ]) == 3
    assert len([
        item for item in initial.recognition.elements
        if re.fullmatch(r"date_chip\[[0-9]+\]", item.semantic_id)
    ]) == 5
    assert _node(initial.tree, "date-chip-2")["selected"] is True
    assert _semantic(initial, "selected_date_chip").metadata["index"] == 2

    # B. Date change
    _tap(client, home_date_chip_rect(1))
    changed_date = _capture(client)
    assert changed_date.recognition.context == {"selected_date": "2026-09-28"}
    assert _node(changed_date.tree, "date-chip-1")["selected"] is True
    assert _node(changed_date.tree, "date-chip-2")["selected"] is False
    date_region = (240, 465, 640, 680)
    assert np.mean(np.abs(
        _crop(initial.image, date_region).astype(np.int16)
        - _crop(changed_date.image, date_region).astype(np.int16)
    )) > 5

    # C. Enter room 2C
    _open_room_2c(client)
    detail = _capture(client)
    assert detail.recognition.screen_id == "study_room_detail"
    assert detail.recognition.context == {
        "room_id": "room_2c",
        "room_name": "스터디룸 2C",
        "selected_date": "2026-09-28",
    }
    assert len([
        item for item in detail.recognition.elements
        if re.fullmatch(r"time_slot\[[0-9]+\]", item.semantic_id)
    ]) == 32
    _assert_complete_slot_contract(detail)
    _assert_slot_geometry(detail, 7, "available")
    _assert_slot_geometry(detail, 8, "booked")

    # D. Select an available slot
    available_bounds = detail_slot_rect(7, DETAIL_DEFAULT_TIME_SCROLL, "available")
    _tap(client, available_bounds)
    selected = _capture(client)
    _assert_slot_geometry(selected, 7, "selected")
    assert _node(selected.tree, "slot-7")["selected"] is True
    assert _node(selected.tree, "reserve-cta")["enabled"] is True
    assert _semantic(selected, "reserve_cta").metadata["state"] == "ready"
    selected_union = detail_slot_rect(7, DETAIL_DEFAULT_TIME_SCROLL, "selected")
    assert np.mean(np.abs(
        _crop(detail.image, selected_union).astype(np.int16)
        - _crop(selected.image, selected_union).astype(np.int16)
    )) > 5
    assert np.mean(np.abs(
        _crop(detail.image, DETAIL_CTA).astype(np.int16)
        - _crop(selected.image, DETAIL_CTA).astype(np.int16)
    )) > 5

    # E. A booked slot is inert in pixels, tree, and semantics.
    booked_bounds = detail_slot_rect(8, DETAIL_DEFAULT_TIME_SCROLL, "booked")
    _tap(client, booked_bounds)
    booked_attempt = _capture(client)
    assert np.array_equal(selected.image, booked_attempt.image)
    _assert_slot_geometry(booked_attempt, 8, "booked")
    assert _node(booked_attempt.tree, "slot-7")["selected"] is True

    # F. Reset
    _tap(client, DETAIL_RESET)
    reset = _capture(client)
    _assert_slot_geometry(reset, 7, "available")
    assert _node(reset.tree, "slot-7")["selected"] is False
    assert _node(reset.tree, "reserve-cta")["enabled"] is False
    assert _semantic(reset, "reserve_cta").metadata["state"] == "idle"
    assert np.array_equal(detail.image, reset.image)

    # G. CTA opens the source-style confirmation dialog.
    _tap(client, available_bounds)
    _tap(client, DETAIL_CTA)
    confirm = _capture(client)
    assert confirm.recognition.screen_id == "study_room_confirm"
    assert {
        "title", "room_name", "date", "time_range", "cancel", "confirm_reservation",
    } <= {item.semantic_id for item in confirm.recognition.elements}

    # H. Confirm transitions through the submitting detail state.
    _tap(client, CONFIRM_SUBMIT)
    submitting = _capture(client)
    assert submitting.recognition.screen_id == "study_room_detail"
    assert _node(submitting.tree, "reserve-cta")["text"] == "예약 처리 중"
    assert _node(submitting.tree, "reserve-cta")["enabled"] is False
    assert _semantic(submitting, "reserve_cta").metadata["state"] == "submitting"
    assert not np.array_equal(
        _crop(selected.image, DETAIL_CTA),
        _crop(submitting.image, DETAIL_CTA),
    )

    # I. Success
    time.sleep(0.85)
    success = _capture(client)
    assert success.recognition.screen_id == "study_room_complete"
    assert success.recognition.context == {
        "room_id": "room_2c",
        "room_name": "스터디룸 2C",
        "date": "2026-09-28",
        "time": "09:30",
        "time_range": "09:30 ~ 10:00",
    }

    # J. Back restores the same selected detail state.
    response = client.post("/api/back", headers=HEADERS)
    assert response.status_code == 200
    returned = _capture(client)
    assert returned.recognition.screen_id == "study_room_detail"
    _assert_slot_geometry(returned, 7, "selected")
    assert _node(returned.tree, "reserve-cta")["enabled"] is True
    assert _semantic(returned, "reserve_cta").metadata["state"] == "ready"
    assert np.array_equal(selected.image, returned.image)
