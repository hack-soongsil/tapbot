from tapbot.ui_resolution.screens import (
    ScreenRecognizer,
    validate_screen_element_reference,
)


def node(
    node_id: str,
    *,
    text: str | None = None,
    description: str | None = None,
    bounds: tuple[int, int, int, int] = (0, 0, 100, 50),
    class_name: str = "android.widget.Button",
    enabled: bool = True,
    clickable: bool = True,
    visible: bool = True,
    parent_id: str | None = None,
):
    return {
        "node_id": node_id,
        "parent_id": parent_id,
        "class_name": class_name,
        "text": text,
        "content_description": description,
        "view_id_resource_name": None,
        "bounds": dict(zip(("left", "top", "right", "bottom"), bounds, strict=True)),
        "clickable": clickable,
        "enabled": enabled,
        "visible_to_user": visible,
    }


def home_tree(date_text: str = "금 25"):
    quick_dates = [date_text, "토 26", "일 27", "월 28", "화 29"]
    return {"nodes": [
        node("history-parent", description="예약 내역", bounds=(800, 80, 1020, 170), class_name="android.view.View"),
        node("history-button", description="예약 내역", bounds=(800, 80, 1020, 170), parent_id="history-parent"),
        *(node(f"quick-{index}", text=text, bounds=(20 + index * 190, 300, 170 + index * 190, 390)) for index, text in enumerate(quick_dates)),
        node("picker", text="2026년 9월 27일(일)", bounds=(100, 180, 900, 260)),
        node("notice", description="공지", bounds=(0, 1800, 300, 1900)),
        node("reservation", description="예약", bounds=(300, 1800, 700, 1900)),
        node("my", description="마이", bounds=(700, 1800, 1080, 1900)),
    ]}


def detail_tree(cta: str = "시간을 선택하세요"):
    nodes = [
        node("guidance", text="한 칸은 30분입니다. 예약된 시간은 선택할 수 없어요", class_name="android.widget.TextView"),
        node("back", bounds=(55, 107, 168, 223)),
        node("picker", text="2026년 9월 27일(일)", bounds=(200, 120, 900, 210)),
        node("reset", text="초기화", bounds=(820, 300, 1020, 380)),
        node("cta", text=cta, bounds=(80, 1700, 1000, 1820), enabled=cta != "시간을 선택하세요"),
        node("decoration", bounds=(10, 420, 30, 440), clickable=False),
    ]
    nodes.extend(
        node(
            f"slot-{index}",
            bounds=(
                50 + (index % 4) * 240,
                500 + (index // 4) * 100,
                220 + (index % 4) * 240,
                570 + (index // 4) * 100,
            ),
            enabled=index % 2 == 0,
            visible=index != 3,
        )
        for index in range(32)
    )
    return {"nodes": nodes}


def test_recognizes_home_and_deduplicates_accessibility_button() -> None:
    recognition = ScreenRecognizer().recognize(home_tree())

    assert recognition is not None
    assert recognition.screen_id == "reservation_home"
    assert [item.semantic_id for item in recognition.elements].count("reservation_history") == 1
    assert len(recognition.elements) == 10
    assert next(item for item in recognition.elements if item.semantic_id == "reservation_history").class_name == "android.widget.Button"


def test_dynamic_home_dates_keep_semantic_ids() -> None:
    first = ScreenRecognizer().recognize(home_tree("일 27"))
    second = ScreenRecognizer().recognize(home_tree("수 30"))

    assert first is not None and second is not None
    assert next(item for item in first.elements if item.semantic_id.startswith("quick_date")).semantic_id == "quick_date[0]"
    assert next(item for item in second.elements if item.semantic_id.startswith("quick_date")).semantic_id == "quick_date[0]"


def test_detail_slots_remain_semantic_when_disabled_and_cta_text_changes() -> None:
    before = ScreenRecognizer().recognize(detail_tree("시간을 선택하세요"))
    after = ScreenRecognizer().recognize(detail_tree("이 시간으로 예약하기"))

    assert before is not None and after is not None
    assert before.screen_id == "reservation_detail"
    slots = [item for item in before.elements if item.semantic_id.startswith("time_slot")]
    assert len(slots) == 32
    assert any(not slot.enabled and not slot.tappable for slot in slots)
    assert slots[3].metadata == {
        "enabled": False,
        "visible": False,
        "family": "time_slot",
        "index": 3,
        "time": "07:30",
        "state": "reserved",
        "selected": False,
    }
    assert slots[6].metadata["index"] == 6
    assert slots[6].metadata["enabled"] is True
    assert slots[6].metadata["visible"] is True
    assert next(item for item in before.elements if item.semantic_id == "reserve_cta").enabled is False
    assert next(item for item in after.elements if item.semantic_id == "reserve_cta").semantic_id == "reserve_cta"


def test_study_room_detail_template_validates_semantic_collections() -> None:
    assert validate_screen_element_reference(
        "study_room_detail", "time_slot", {"index": 3}
    ) == ()
    assert validate_screen_element_reference(
        "study_room_detail", "room_feature", {"index": 1}
    ) == ()
    assert validate_screen_element_reference(
        "study_room_detail", "time_slot", {}
    ) == ("params.index must be a non-negative integer",)


def test_study_room_list_template_validates_index_and_name_collections() -> None:
    assert validate_screen_element_reference(
        "study_room_list", "date_chip", {"index": 1}
    ) == ()
    assert validate_screen_element_reference(
        "study_room_list", "room_card", {"index": 2}
    ) == ()
    assert validate_screen_element_reference(
        "study_room_list", "room_card_by_name", {"name": "스터디룸 2B"}
    ) == ()
    assert validate_screen_element_reference(
        "study_room_list", "room_card_by_name", {"name": ""}
    ) == ("params.name must be a non-empty string",)
