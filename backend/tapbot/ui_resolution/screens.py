"""Rule-based screen recognition and semantic SSUTODAY UI extraction."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, timedelta
import re
from typing import Any, Protocol

from tapbot.ui_resolution.semantic_manifest import (
    canonical_element_id,
    canonical_screen_id,
    screen_element_templates,
)


JsonObject = dict[str, Any]


class ScreenRuleLike(Protocol):
    id: str
    match: JsonObject


@dataclass(frozen=True, slots=True)
class ScreenRule:
    id: str
    match: JsonObject


QUICK_DATE_PATTERN = re.compile(r"^(월|화|수|목|금|토|일) [0-9]{1,2}$")
DATE_PICKER_PATTERN = re.compile(
    r"^[0-9]{4}년 [0-9]{1,2}월 [0-9]{1,2}일\([월화수목금토일]\)$"
)
RESERVE_CTA_TEXTS = frozenset({
    "시간을 선택하세요",
    "이 시간으로 예약하기",
    "예약 처리 중",
})
DETAIL_GUIDANCE = "한 칸은 30분입니다. 예약된 시간은 선택할 수 없어요"
ROOM_STATUS_LABELS = ("예약 가능", "예약 마감", "여유", "보통", "혼잡", "만석")


@dataclass(frozen=True, slots=True)
class SemanticBounds:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return max(0, self.right - self.left)

    @property
    def height(self) -> int:
        return max(0, self.bottom - self.top)

    def to_list(self) -> list[int]:
        return [self.left, self.top, self.right, self.bottom]


@dataclass(frozen=True, slots=True)
class SemanticUiElement:
    semantic_id: str
    role: str
    bounds: SemanticBounds
    enabled: bool
    visible: bool
    selector: JsonObject
    text: str | None = None
    content_description: str | None = None
    class_name: str | None = None
    metadata: JsonObject = field(default_factory=dict)

    @property
    def tappable(self) -> bool:
        return self.enabled and self.visible and self.role == "button"


@dataclass(frozen=True, slots=True)
class ScreenRecognition:
    screen_id: str
    elements: tuple[SemanticUiElement, ...]
    context: JsonObject = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class _Node:
    node_id: str
    parent_id: str | None
    class_name: str | None
    text: str | None
    content_description: str | None
    view_id: str | None
    bounds: SemanticBounds
    clickable: bool
    enabled: bool
    visible: bool
    selected: bool
    metadata: JsonObject


DEFAULT_SSUTODAY_SCREENS = (
    ScreenRule(
        "study_room_complete",
        {
            "all": [
                {"any": [
                    {"text": "예약 성공"},
                    {"text": "예약이 완료되었습니다"},
                ]},
                {"any": [
                    {"text": "예약 화면으로"},
                    {"text": "예약 화면으로 돌아가기"},
                ]},
            ]
        },
    ),
    ScreenRule(
        "study_room_confirm",
        {
            "all": [
                {"any": [
                    {"text": "예약 확인"},
                    {"text": "이 시간으로 예약할까요?"},
                ]},
                {"any": [
                    {"text": "예약하기"},
                    {"text": "예약 확정"},
                ]},
                {"text": "취소"},
            ]
        },
    ),
    ScreenRule(
        "study_room_detail",
        {
            "any": [
                {"all": [
                    {"text_regex": r"^스터디룸 .+$"},
                    {"text": DETAIL_GUIDANCE},
                    {"text": "초기화"},
                    {"text_regex": DATE_PICKER_PATTERN.pattern},
                ]},
                {"all": [
                    {"text": DETAIL_GUIDANCE},
                    {"text": "초기화"},
                    {"text_regex": DATE_PICKER_PATTERN.pattern},
                ]},
            ]
        },
    ),
    ScreenRule(
        "study_room_list",
        {
            "any": [
                {"all": [
                    {"text": "스터디룸 예약"},
                    {"text_regex": r"^스터디룸 .+$"},
                    {"content_description": "예약"},
                ]},
                {"all": [
                    {"content_description": "예약 내역"},
                    {"content_description": "공지"},
                    {"content_description": "예약"},
                    {"content_description": "마이"},
                    {"text_regex": QUICK_DATE_PATTERN.pattern, "min_count": 1},
                ]},
            ]
        },
    ),
)

SCREEN_ELEMENT_TEMPLATES = screen_element_templates()


def validate_screen_element_reference(
    screen_id: object,
    element_id: object,
    params: object,
) -> tuple[str, ...]:
    if not isinstance(screen_id, str):
        return ("screen_id does not reference a known screen template",)
    canonical_screen = canonical_screen_id(screen_id)
    if canonical_screen not in SCREEN_ELEMENT_TEMPLATES:
        return ("screen_id does not reference a known screen template",)
    if not isinstance(element_id, str):
        return ("element_id does not exist in the selected screen template",)
    canonical_element = canonical_element_id(canonical_screen, element_id)
    templates = SCREEN_ELEMENT_TEMPLATES[canonical_screen]
    if canonical_element not in templates:
        return ("element_id does not exist in the selected screen template",)
    if not isinstance(params, dict):
        return ("params must be an object",)
    errors: list[str] = []
    template = templates[canonical_element]
    for key in template.get("required_params", []):
        value = params.get(key)
        if key == "name":
            if not isinstance(value, str) or not value.strip():
                errors.append(f"params.{key} must be a non-empty string")
            elif canonical_element == "time_slot_by_time" and _time_slot_index(value) is None:
                errors.append(
                    "params.name must be a half-hour time between 06:00 and 21:30"
                )
            elif (
                canonical_element == "time_slot_by_end_time"
                and _time_slot_end_index(value) is None
            ):
                errors.append(
                    "params.name must be a half-hour time between 06:30 and 22:00"
                )
        elif isinstance(value, bool) or not isinstance(value, int) or value < 0:
            errors.append(f"params.{key} must be a non-negative integer")
        elif isinstance(template.get("max_index"), int) and value > template["max_index"]:
            errors.append(
                f"params.index must be between 0 and {template['max_index']}"
            )
    return tuple(errors)


def screen_element_semantic_id(
    screen_id: str,
    element_id: str,
    params: Mapping[str, object],
) -> str:
    errors = validate_screen_element_reference(screen_id, element_id, dict(params))
    if errors:
        raise ValueError("; ".join(errors))
    canonical_screen = canonical_screen_id(screen_id)
    canonical_element = canonical_element_id(canonical_screen, element_id)
    required = SCREEN_ELEMENT_TEMPLATES[canonical_screen][canonical_element].get(
        "required_params", []
    )
    if "index" in required:
        return f"{canonical_element}[{params['index']}]"
    if "name" in required:
        return f"{canonical_element}[{str(params['name']).strip()}]"
    return canonical_element


class ScreenRecognizer:
    """Evaluate JSON-compatible AND/OR element signatures against a UI tree."""

    def __init__(self, screens: Iterable[ScreenRuleLike] = DEFAULT_SSUTODAY_SCREENS) -> None:
        self.screens = tuple(screens)

    def recognize(self, ui_tree: object) -> ScreenRecognition | None:
        nodes = _nodes(ui_tree)
        for screen in self.screens:
            matcher = screen.match or _default_match(screen.id)
            if _matches_expression(nodes, matcher):
                screen_id = canonical_screen_id(screen.id)
                return ScreenRecognition(
                    screen_id,
                    extract_ssutoday_elements(screen_id, nodes),
                    _screen_context(screen_id, nodes),
                )
        return None


def extract_ssutoday_elements(
    screen_id: str,
    ui_tree_or_nodes: object,
) -> tuple[SemanticUiElement, ...]:
    nodes = (
        tuple(ui_tree_or_nodes)
        if isinstance(ui_tree_or_nodes, tuple)
        and all(isinstance(item, _Node) for item in ui_tree_or_nodes)
        else _nodes(ui_tree_or_nodes)
    )
    canonical_id = canonical_screen_id(screen_id)
    if canonical_id == "study_room_list":
        return _list_elements(nodes)
    if canonical_id == "study_room_detail":
        return _detail_elements(nodes, start_minutes=6 * 60)
    if canonical_id == "study_room_confirm":
        return _confirm_elements(nodes)
    if canonical_id == "study_room_complete":
        return _success_elements(nodes)
    return ()


def _list_elements(nodes: tuple[_Node, ...]) -> tuple[SemanticUiElement, ...]:
    result: list[SemanticUiElement] = []

    def add_text(semantic_id: str, value: str) -> None:
        candidates = _dedupe_same_bounds(node for node in nodes if node.text == value)
        if candidates:
            result.append(_element(semantic_id, candidates[0], {"text": value}))

    add_text("header_title", "스터디룸 예약")
    add_text("hero_headline", "성준님, 어디서 공부할까요?")
    add_text("hero_description", "실시간으로 빈 시간을 확인하고 바로 예약할 수 있어요")

    history = _dedupe_same_bounds(
        node for node in nodes if node.content_description == "예약 내역"
    )
    if history:
        for semantic_id in ("history_button", "reservation_history"):
            result.append(_element(
                semantic_id,
                history[0],
                {"content_description": "예약 내역"},
            ))

    date_chips = sorted(
        (
            node for node in nodes
            if re.fullmatch(r"date-chip-[0-9]+", node.node_id)
            or _semantic_family(node) == "date_chip"
        ),
        key=_semantic_collection_order,
    )
    fixture_date_chips = not date_chips
    if fixture_date_chips:
        date_chips = sorted(
            _dedupe_same_bounds(
                node for node in nodes
                if node.class_name == "android.widget.Button"
                and QUICK_DATE_PATTERN.fullmatch(node.text or "")
            ),
            key=lambda node: (
                node.bounds.left,
                node.bounds.top,
                node.bounds.right,
                node.bounds.bottom,
            ),
        )
    selected_date_label = next(
        (
            node.text for node in nodes
            if DATE_PICKER_PATTERN.fullmatch(node.text or "")
        ),
        None,
    )
    selected_date_iso = _date_label_to_iso(selected_date_label)
    selected_day = (
        date.fromisoformat(selected_date_iso).day if selected_date_iso else None
    )
    selected_chip_index = next(
        (
            index for index, node in enumerate(date_chips)
            if _quick_date_day(node.text) == selected_day
        ),
        None,
    )
    for fallback_index, node in enumerate(date_chips):
        index = _semantic_collection_index(node, fallback=fallback_index)
        assert index is not None
        full_date = node.metadata.get("full_date")
        if not isinstance(full_date, str):
            if selected_date_iso is not None and selected_chip_index is not None:
                full_date = (
                    date.fromisoformat(selected_date_iso)
                    + timedelta(days=index - selected_chip_index)
                ).isoformat()
            else:
                full_date = _mock_date_for_index(index)
        is_selected = node.selected or (
            fixture_date_chips and index == selected_chip_index
        )
        day_parts = (node.text or "").split()
        metadata = {
            "family": "date_chip",
            "index": index,
            "full_date": full_date,
            "selected": is_selected,
            "day_label": node.metadata.get("day_label") or (
                day_parts[0] if len(day_parts) == 2 else None
            ),
            "day_number": node.metadata.get("day_number") or (
                day_parts[1] if len(day_parts) == 2 else None
            ),
        }
        result.append(_element(
            f"date_chip[{index}]",
            node,
            {"semantic_family": "date_chip", "index": index},
            metadata=metadata,
        ))
        if is_selected:
            result.append(_element(
                "selected_date_chip",
                node,
                {"semantic_family": "date_chip", "selected": True},
                metadata=metadata,
            ))

    selected_dates = _dedupe_same_bounds(
        node for node in nodes if DATE_PICKER_PATTERN.fullmatch(node.text or "")
    )
    if selected_dates:
        for semantic_id in (
            "selected_date_label", "selected_date_dropdown", "date_picker",
        ):
            result.append(_element(
                semantic_id,
                selected_dates[0],
                {"text_regex": DATE_PICKER_PATTERN.pattern},
            ))

    live = _dedupe_same_bounds(node for node in nodes if node.text == "실시간 현황")
    if live:
        result.append(_element(
            "live_status_indicator", live[0], {"text": "실시간 현황"}
        ))

    room_cards = sorted(
        (
            node for node in nodes
            if re.fullmatch(r"room-card-[0-9]+", node.node_id)
            or _semantic_family(node) in {"room_card", "room_card_by_name"}
            or _looks_like_room_card(node)
        ),
        key=_semantic_collection_order,
    )
    for fallback_index, node in enumerate(room_cards):
        index = _semantic_collection_index(node, fallback=fallback_index)
        assert index is not None
        room_name, capacity, location, status = _room_card_values(
            node, nodes, fallback_name=f"스터디룸 {index}"
        )
        metadata = {
            "family": "room_card",
            "index": index,
            "room_id": node.metadata.get("room_id", _room_id_from_name(room_name)),
            "room_name": room_name,
            "capacity": capacity,
            "location": location,
            "status": status,
        }
        result.append(_element(
            f"room_card[{index}]",
            node,
            {"semantic_family": "room_card", "index": index},
            metadata=metadata,
        ))
        result.append(_element(
            f"room_card_by_name[{room_name}]",
            node,
            {"semantic_family": "room_card_by_name", "name": room_name},
            metadata={**metadata, "family": "room_card_by_name", "name": room_name},
        ))
        part_specs = (
            ("room_name", room_name, "text"),
            ("room_status", metadata.get("status"), "text"),
            ("room_capacity", metadata.get("capacity"), "text"),
            ("room_location", metadata.get("location"), "text"),
            ("room_availability", f"{room_name} 시간대별 예약 현황", "description"),
        )
        for family, value, source in part_specs:
            if not isinstance(value, str) or not value:
                continue
            candidates = _dedupe_same_bounds(
                candidate for candidate in nodes
                if _bounds_within(candidate.bounds, node.bounds)
                and (
                    candidate.text == value if source == "text"
                    else candidate.content_description == value
                )
            )
            if candidates:
                result.append(_element(
                    f"{family}[{index}]",
                    candidates[0],
                    {"semantic_family": family, "index": index},
                    metadata={**metadata, "family": family, "index": index},
                ))

    for semantic_id, node_id, description in (
        ("bottom_tab_home", "bottom-home", "공지"),
        ("bottom_tab_booking", "bottom-booking", "예약"),
        ("bottom_tab_me", "bottom-me", "마이"),
    ):
        candidates = _dedupe_same_bounds(
            node for node in nodes
            if node.content_description == description
            and (
                node.node_id == node_id
                or node.class_name in {"android.view.View", "android.widget.Button"}
            )
        )
        if candidates:
            result.append(_element(
                semantic_id, candidates[0], {"content_description": description}
            ))

    return tuple(result)


def _detail_elements(
    nodes: tuple[_Node, ...],
    *,
    start_minutes: int,
) -> tuple[SemanticUiElement, ...]:
    result: list[SemanticUiElement] = []
    back = [
        node for node in nodes
        if node.class_name == "android.widget.Button"
        and not node.text
        and not node.content_description
        and node.bounds.left <= 80
        and node.bounds.top <= 140
        and node.bounds.right <= 200
        and node.bounds.bottom <= 260
    ]
    if back:
        back_node = min(back, key=lambda node: node.bounds.left + node.bounds.top)
        result.append(_element(
            "back", back_node,
            {
                "class_name": "android.widget.Button",
                "screen_region": "top_left",
            },
            metadata={"fallback": "top-left bounds until content-description is available"},
        ))
        result.append(_element(
            "back_button", back_node,
            {"class_name": "android.widget.Button", "screen_region": "top_left"},
        ))

    hero_images = _dedupe_same_bounds(
        node for node in nodes
        if node.node_id == "room-hero-image"
        or node.content_description == "스터디룸 내부 사진"
    )
    if hero_images:
        result.append(_element(
            "room_hero_image", hero_images[0],
            {"content_description": "스터디룸 내부 사진"},
        ))

    room_names = _dedupe_same_bounds(
        node for node in nodes if _room_id_from_name(node.text) is not None
    )
    if room_names:
        result.append(_element("room_name", room_names[0], {
            "text_regex": r"^스터디룸 .+$",
        }))

    feature_labels = {"콘센트 6구", "칠판"}
    features = sorted(
        _dedupe_same_bounds(node for node in nodes if node.text in feature_labels),
        key=_visual_order,
    )
    for index, node in enumerate(features):
        result.append(_element(
            f"room_feature[{index}]", node,
            {"semantic_family": "room_feature", "index": index},
            metadata={"family": "room_feature", "index": index, "label": node.text},
        ))

    date_nodes = _dedupe_same_bounds(
        node for node in nodes if DATE_PICKER_PATTERN.fullmatch(node.text or "")
    )
    if date_nodes:
        result.append(_element(
            "date_picker", date_nodes[0], {"text_regex": DATE_PICKER_PATTERN.pattern}
        ))
        result.append(_element(
            "selected_date_label", date_nodes[0],
            {"text_regex": DATE_PICKER_PATTERN.pattern},
        ))

    live = _dedupe_same_bounds(node for node in nodes if node.text == "실시간")
    if live:
        result.append(_element("live_status_indicator", live[0], {"text": "실시간"}))

    guidance = _dedupe_same_bounds(node for node in nodes if node.text == DETAIL_GUIDANCE)
    if guidance:
        result.append(_element("slot_guidance", guidance[0], {"text": DETAIL_GUIDANCE}))

    current_markers = _dedupe_same_bounds(
        node for node in nodes if node.node_id == "current-time-marker"
    )
    if current_markers:
        result.append(_element(
            "current_time_marker", current_markers[0],
            {"semantic_id": "current_time_marker"},
        ))

    reserved_bounds = {element.bounds for element in result}
    cta = _dedupe_same_bounds(node for node in nodes if node.text in RESERVE_CTA_TEXTS)
    slot_bottom = min((node.bounds.top for node in cta), default=float("inf"))
    semantic_slots = [
        node for node in nodes
        if re.fullmatch(r"slot-[0-9]+", node.node_id)
        or _semantic_family(node) in {"time_slot", "time_slot_by_time"}
    ]
    tree_slots = _indexed_time_slot_siblings(nodes)
    tree_slot_indices = {
        node.node_id: index for index, node in enumerate(tree_slots)
    }
    slots = (
        _dedupe_same_bounds(semantic_slots)
        if semantic_slots
        else tree_slots
        if tree_slots
        else _dedupe_same_bounds(
            node for node in nodes
            if node.class_name == "android.widget.Button"
            and not node.text
            and not node.content_description
            and node.clickable
            and node.bounds not in reserved_bounds
            and node.bounds.top >= 200
            and node.bounds.bottom <= slot_bottom
        )
    )
    ordered_slots = (
        tree_slots if tree_slots and not semantic_slots
        else sorted(slots, key=_semantic_collection_order)
    )
    for index, node in enumerate(ordered_slots):
        slot_index = _semantic_collection_index(node)
        if slot_index is None:
            slot_index = tree_slot_indices.get(node.node_id)
        if slot_index is None:
            slot_index = index
        assert slot_index is not None
        start_time = node.metadata.get(
            "start_time", node.metadata.get("time", node.metadata.get("name"))
        )
        time_index = _time_slot_index(start_time) if isinstance(start_time, str) else None
        if time_index is None:
            minutes = start_minutes + slot_index * 30
            start_time = _format_minutes(minutes)
        elif (
            _semantic_collection_index(node) is None
            and node.node_id not in tree_slot_indices
        ):
            slot_index = time_index
        start_value = _parse_time_minutes(start_time)
        end_time = node.metadata.get("end_time")
        if not isinstance(end_time, str):
            end_time = _format_minutes(start_value + 30)
        selected = node.selected
        state = node.metadata.get("state")
        if not isinstance(state, str):
            state = "selected" if selected else "available" if node.enabled else "reserved"
        booked_value = node.metadata.get("booked")
        booked = (
            booked_value if isinstance(booked_value, bool)
            else state.lower() in {"reserved", "booked"}
        )
        metadata = {
            "family": "time_slot",
            "index": slot_index,
            "time": start_time,
            "start_time": start_time,
            "end_time": end_time,
            "state": state,
            "booked": booked,
            "selected": selected,
        }
        result.append(_element(
            f"time_slot[{slot_index}]", node,
            {
                "class_name": "android.widget.Button",
                "semantic_family": "time_slot",
                "index": slot_index,
            },
            metadata=metadata,
        ))
        result.append(_element(
            f"time_slot_by_time[{start_time}]", node,
            {
                "class_name": "android.widget.Button",
                "semantic_family": "time_slot_by_time",
                "name": start_time,
            },
            metadata={
                **metadata,
                "family": "time_slot_by_time",
                "name": start_time,
            },
        ))
        result.append(_element(
            f"time_slot_by_end_time[{end_time}]", node,
            {
                "class_name": "android.widget.Button",
                "semantic_family": "time_slot_by_end_time",
                "name": end_time,
            },
            metadata={
                **metadata,
                "family": "time_slot_by_end_time",
                "name": end_time,
            },
        ))

    reset = _dedupe_same_bounds(node for node in nodes if node.text == "초기화")
    if reset:
        result.append(_element("reset_selection", reset[0], {"text": "초기화"}))

    for semantic_id, label in (
        ("legend_reserved", "예약됨"),
        ("legend_available", "빈 시간"),
        ("legend_selected", "선택"),
    ):
        legends = _dedupe_same_bounds(node for node in nodes if node.text == label)
        if legends:
            result.append(_element(semantic_id, legends[0], {"text": label}))

    summaries = _dedupe_same_bounds(
        node for node in nodes
        if node.node_id == "selection-summary"
        or node.text == "시간대를 선택하세요"
        or re.fullmatch(r"[0-9]{2}:[0-9]{2} - [0-9]{2}:[0-9]{2}", node.text or "")
    )
    selected_slots = [node for node in slots if node.selected]
    selected_slot_index = None
    selected_time = None
    if selected_slots:
        selected_node = selected_slots[0]
        selected_slot_index = _semantic_collection_index(selected_node)
        if selected_slot_index is None:
            selected_slot_index = tree_slot_indices.get(selected_node.node_id)
        if selected_slot_index is None:
            selected_slot_index = ordered_slots.index(selected_node)
        selected_time = selected_node.metadata.get(
            "start_time", selected_node.metadata.get("time")
        )
        if not isinstance(selected_time, str):
            selected_time = _format_minutes(start_minutes + selected_slot_index * 30)
    if summaries:
        result.append(_element(
            "selection_summary", summaries[0], {"text": summaries[0].text or ""},
            metadata={
                "selected_slot_index": selected_slot_index,
                "selected_time": selected_time,
            },
        ))

    rules = _dedupe_same_bounds(
        node for node in nodes if node.node_id == "usage-rules" or node.text == "이용 규칙"
    )
    if rules:
        result.append(_element("usage_rules", rules[-1], {
            "text": rules[-1].text or "",
        }))
    if cta:
        state_text = cta[0].text or ""
        cta_state = {
            "시간을 선택하세요": "idle",
            "이 시간으로 예약하기": "ready",
            "예약 처리 중": "submitting",
        }.get(state_text, "idle")
        result.append(_element(
            "reserve_cta",
            cta[0],
            {"text_regex": "^(시간을 선택하세요|이 시간으로 예약하기|예약 처리 중)$"},
            metadata={
                "state": cta_state,
                "text": state_text,
                "selected_slot_index": selected_slot_index,
                "selected_time": selected_time,
            },
        ))
    return tuple(result)


def _confirm_elements(nodes: tuple[_Node, ...]) -> tuple[SemanticUiElement, ...]:
    result: list[SemanticUiElement] = []
    specs = (
        ("title", lambda node: node.node_id == "confirm-title" or node.text in {"예약 확인", "이 시간으로 예약할까요?"}),
        ("room_name", lambda node: node.node_id == "confirm-room" or bool(re.fullmatch(r"스터디룸 .+", node.text or ""))),
        ("date", lambda node: node.node_id == "confirm-date" or bool(DATE_PICKER_PATTERN.fullmatch(node.text or ""))),
        ("time_range", lambda node: node.node_id == "confirm-time" or bool(re.fullmatch(r"[0-9]{2}:[0-9]{2} - [0-9]{2}:[0-9]{2}", node.text or ""))),
        ("cancel", lambda node: node.node_id == "confirm-cancel" or node.text == "취소"),
        ("confirm_reservation", lambda node: node.node_id == "confirm-reservation" or node.text in {"예약하기", "예약 확정"}),
    )
    for semantic_id, matches in specs:
        candidates = _dedupe_same_bounds(node for node in nodes if matches(node))
        if candidates:
            result.append(_element(
                semantic_id, candidates[0], {"semantic_id": semantic_id}
            ))
    return tuple(result)


def _success_elements(nodes: tuple[_Node, ...]) -> tuple[SemanticUiElement, ...]:
    result: list[SemanticUiElement] = []
    title = _dedupe_same_bounds(
        node for node in nodes
        if node.node_id in {"complete-title", "success-title"}
        or node.text in {"예약이 완료되었습니다", "예약 성공"}
    )
    if title:
        result.append(_element(
            "success_title", title[0], {"text": title[0].text or "예약 성공"}
        ))
    detail = next(
        (node for node in nodes if node.node_id == "complete-detail"), None
    )
    if detail is not None:
        parts = [part.strip() for part in (detail.text or "").split(" · ")]
        for semantic_id, index in (("room_name", 0), ("date", 1), ("time_range", 2)):
            if len(parts) > index:
                result.append(_element(
                    semantic_id, detail,
                    {"semantic_id": semantic_id},
                    metadata={"value": parts[index]},
                ))
    else:
        for semantic_id, node_ids in (
            ("room_name", {"success-room"}),
            ("date", {"success-date"}),
            ("time_range", {"success-time"}),
        ):
            candidates = _dedupe_same_bounds(
                node for node in nodes if node.node_id in node_ids
            )
            if candidates:
                result.append(_element(
                    semantic_id,
                    candidates[0],
                    {"semantic_id": semantic_id},
                    metadata={"value": candidates[0].text},
                ))
    back = _dedupe_same_bounds(
        node for node in nodes
        if node.node_id == "complete-home"
        or node.text in {"예약 화면으로", "예약 화면으로 돌아가기"}
    )
    if back:
        result.append(_element(
            "back_to_reservation", back[0], {"text": back[0].text or "예약 화면으로"}
        ))
    return tuple(result)


def _element(
    semantic_id: str,
    node: _Node,
    selector: JsonObject,
    *,
    metadata: JsonObject | None = None,
) -> SemanticUiElement:
    role = (
        "button" if node.clickable
        else "image" if node.class_name == "android.widget.ImageView"
        else "text"
    )
    return SemanticUiElement(
        semantic_id=semantic_id,
        role=role,
        bounds=node.bounds,
        enabled=node.enabled,
        visible=node.visible,
        selector={"semantic_id": semantic_id, **selector},
        text=node.text,
        content_description=node.content_description,
        class_name=node.class_name,
        metadata={
            "enabled": node.enabled,
            "visible": node.visible,
            **(metadata or {}),
        },
    )


def _dedupe_same_bounds(nodes: Iterable[_Node]) -> list[_Node]:
    selected: dict[tuple[int, int, int, int], _Node] = {}
    for node in nodes:
        key = (node.bounds.left, node.bounds.top, node.bounds.right, node.bounds.bottom)
        current = selected.get(key)
        if current is None or _semantic_priority(node) > _semantic_priority(current):
            selected[key] = node
    return list(selected.values())


def _bounds_within(bounds: SemanticBounds, container: SemanticBounds) -> bool:
    return (
        bounds.left >= container.left
        and bounds.top >= container.top
        and bounds.right <= container.right
        and bounds.bottom <= container.bottom
    )


def _semantic_priority(node: _Node) -> tuple[int, int, int]:
    return (
        1 if node.class_name == "android.widget.Button" else 0,
        1 if node.content_description or node.text else 0,
        1 if node.clickable else 0,
    )


def _visual_order(node: _Node) -> tuple[int, int, int, int]:
    return (node.bounds.top, node.bounds.left, node.bounds.bottom, node.bounds.right)


def _default_match(screen_id: str) -> JsonObject:
    screen_id = canonical_screen_id(screen_id)
    for screen in DEFAULT_SSUTODAY_SCREENS:
        if screen.id == screen_id:
            return screen.match
    return {}


def _screen_context(screen_id: str, nodes: tuple[_Node, ...]) -> JsonObject:
    canonical_id = canonical_screen_id(screen_id)
    if canonical_id == "study_room_list":
        date_label = next(
            (
                node.text for node in nodes
                if node.node_id == "selected-date"
                and DATE_PICKER_PATTERN.fullmatch(node.text or "")
            ),
            None,
        )
        if date_label is None:
            date_label = next(
                (
                    node.text for node in nodes
                    if DATE_PICKER_PATTERN.fullmatch(node.text or "")
                ),
                None,
            )
        return {"selected_date": _date_label_to_iso(date_label)}
    if canonical_id not in {
        "study_room_detail", "study_room_confirm", "study_room_complete",
    }:
        return {}
    if canonical_id == "study_room_complete":
        room = next(
            (
                node.text for node in nodes
                if node.node_id == "success-room"
                and re.fullmatch(r"스터디룸 .+", node.text or "")
            ),
            None,
        )
        date_label = next(
            (node.text for node in nodes if node.node_id == "success-date"), None
        )
        time_range = next(
            (node.text for node in nodes if node.node_id == "success-time"), None
        )
        if room is not None:
            context: JsonObject = {
                "room_id": _room_id_from_name(room),
                "room_name": room,
            }
            if isinstance(date_label, str):
                context["date"] = _date_label_to_iso(date_label) or date_label
            if isinstance(time_range, str):
                context["time"] = re.split(r"\s*[~-]\s*", time_range)[0]
                context["time_range"] = time_range
            return context
    detail_text = next(
        (node.text for node in nodes if _room_id_from_name(node.text) is not None),
        None,
    )
    room = detail_text.split(" · ", 1)[0] if detail_text else None
    date_label = next(
        (node.text for node in nodes if DATE_PICKER_PATTERN.fullmatch(node.text or "")),
        None,
    )
    context: JsonObject = {
        "room_id": _room_id_from_name(room),
        "room_name": room,
    }
    if date_label:
        context["selected_date"] = _date_label_to_iso(date_label)
    elif detail_text:
        date_match = re.search(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", detail_text)
        time_range_match = re.search(
            r"([0-9]{2}:[0-9]{2}) - ([0-9]{2}:[0-9]{2})$", detail_text
        )
        time_match = re.search(r"[0-9]{2}:[0-9]{2}$", detail_text)
        if date_match:
            context["date"] = date_match.group()
        if time_range_match:
            context["time"] = time_range_match.group(1)
            context["time_range"] = time_range_match.group()
        elif time_match:
            context["time"] = time_match.group()
    return context


def _semantic_family(node: _Node) -> str | None:
    value = node.metadata.get("semantic_family", node.metadata.get("family"))
    if isinstance(value, str):
        return value
    semantic_id = node.metadata.get("semantic_id")
    if not isinstance(semantic_id, str):
        return None
    return semantic_id.split("[", 1)[0]


def _semantic_collection_index(node: _Node, *, fallback: int | None = None) -> int | None:
    index = node.metadata.get("index")
    if isinstance(index, int) and not isinstance(index, bool):
        return index
    semantic_id = node.metadata.get("semantic_id")
    if isinstance(semantic_id, str):
        match = re.search(r"\[([0-9]+)\]$", semantic_id)
        if match is not None:
            return int(match.group(1))
    match = re.search(r"(?:date-chip|room-card|slot)-([0-9]+)$", node.node_id)
    if match is not None:
        return int(match.group(1))
    return fallback


def _semantic_collection_order(node: _Node) -> tuple[int, int, int, int]:
    index = _semantic_collection_index(node)
    if index is not None:
        return (index, node.bounds.top, node.bounds.left, node.bounds.right)
    visual = _visual_order(node)
    return (10_000 + visual[0], visual[1], visual[2], visual[3])


def _indexed_time_slot_siblings(nodes: tuple[_Node, ...]) -> list[_Node]:
    groups: dict[str, dict[int, _Node]] = {}
    for node in nodes:
        if (
            node.class_name != "android.widget.Button"
            or node.text
            or node.content_description
        ):
            continue
        match = re.search(r"(?:^|\.)([0-9]+)$", node.node_id)
        if match is None:
            continue
        parent_key = node.parent_id or node.node_id.rsplit(".", 1)[0]
        groups.setdefault(parent_key, {})[int(match.group(1))] = node
    for group in groups.values():
        if all(index in group for index in range(32)):
            return [group[index] for index in range(32)]
    return []


def _looks_like_room_card(node: _Node) -> bool:
    return (
        node.clickable
        and re.match(r"^스터디룸\s+\S+", node.content_description or "") is not None
    )


def _room_card_values(
    node: _Node,
    nodes: tuple[_Node, ...],
    *,
    fallback_name: str,
) -> tuple[str, str | None, str | None, str | None]:
    description = (node.content_description or "").strip()
    parts = description.split("|")
    nested_texts = [
        candidate.text
        for candidate in nodes
        if candidate is not node
        and candidate.text
        and _bounds_within(candidate.bounds, node.bounds)
    ]

    name_match = re.match(r"^(스터디룸\s+\S+)", description)
    capacity_match = re.search(r"\b[0-9]+인실\b", description)
    description_status = next(
        (label for label in ROOM_STATUS_LABELS if description.endswith(label)), None
    )
    description_location = None
    if capacity_match is not None:
        description_location = description[capacity_match.end():].strip()
        if description_status and description_location.endswith(description_status):
            description_location = description_location[:-len(description_status)].strip()

    metadata_name = node.metadata.get("room_name", node.metadata.get("name"))
    room_name = (
        metadata_name if isinstance(metadata_name, str) and metadata_name
        else parts[0] if len(parts) == 4
        else name_match.group(1) if name_match is not None
        else next(
            (text for text in nested_texts if re.fullmatch(r"스터디룸 .+", text)),
            fallback_name,
        )
    )

    def metadata_text(key: str) -> str | None:
        value = node.metadata.get(key)
        return value if isinstance(value, str) and value else None

    capacity = (
        metadata_text("capacity")
        or (parts[1] if len(parts) == 4 else None)
        or (capacity_match.group() if capacity_match is not None else None)
        or next((text for text in nested_texts if re.fullmatch(r"[0-9]+인실", text)), None)
    )
    location = (
        metadata_text("location")
        or (parts[2] if len(parts) == 4 else None)
        or description_location
        or next((text for text in nested_texts if re.match(r"^[0-9]+층", text)), None)
    )
    status = (
        metadata_text("status")
        or (parts[3] if len(parts) == 4 else None)
        or description_status
        or next((text for text in nested_texts if text in ROOM_STATUS_LABELS), None)
    )
    return room_name, capacity, location, status


def _date_label_to_iso(label: str | None) -> str | None:
    match = re.fullmatch(
        r"([0-9]{4})년 ([0-9]{1,2})월 ([0-9]{1,2})일\([월화수목금토일]\)",
        label or "",
    )
    if match is None:
        return None
    year, month, day = (int(value) for value in match.groups())
    return f"{year:04d}-{month:02d}-{day:02d}"


def _quick_date_day(label: str | None) -> int | None:
    match = QUICK_DATE_PATTERN.fullmatch(label or "")
    return int(match.group().split()[1]) if match else None


def _parse_time_minutes(value: str) -> int:
    hour, minute = (int(part) for part in value.split(":"))
    return hour * 60 + minute


def _format_minutes(value: int) -> str:
    return f"{value // 60:02d}:{value % 60:02d}"


def _time_slot_index(value: str) -> int | None:
    if not re.fullmatch(r"[0-9]{2}:[0-9]{2}", value):
        return None
    minutes = _parse_time_minutes(value)
    start = 6 * 60
    if minutes < start or minutes > 21 * 60 + 30 or (minutes - start) % 30:
        return None
    return (minutes - start) // 30


def _time_slot_end_index(value: str) -> int | None:
    if not re.fullmatch(r"[0-9]{2}:[0-9]{2}", value):
        return None
    minutes = _parse_time_minutes(value)
    start = 6 * 60 + 30
    if minutes < start or minutes > 22 * 60 or (minutes - start) % 30:
        return None
    return (minutes - start) // 30


def _room_id_from_name(room_name: object) -> str | None:
    if not isinstance(room_name, str):
        return None
    match = re.fullmatch(r"스터디룸 ([0-9]+)([A-Za-z])", room_name)
    if match is None:
        return None
    return f"room_{match.group(1)}{match.group(2).lower()}"


def _mock_date_for_index(index: int) -> str | None:
    dates = (
        "2026-09-27", "2026-09-28", "2026-09-29",
        "2026-09-30", "2026-10-01",
    )
    return dates[index] if 0 <= index < len(dates) else None


def _matches_expression(nodes: tuple[_Node, ...], expression: Mapping[str, Any]) -> bool:
    if "all" in expression:
        children = expression["all"]
        return isinstance(children, list) and all(
            isinstance(child, Mapping) and _matches_expression(nodes, child)
            for child in children
        )
    if "any" in expression:
        children = expression["any"]
        return isinstance(children, list) and any(
            isinstance(child, Mapping) and _matches_expression(nodes, child)
            for child in children
        )
    if "not" in expression:
        child = expression["not"]
        return isinstance(child, Mapping) and not _matches_expression(nodes, child)
    if not any(
        key in expression
        for key in (
            "text", "text_regex", "content_description", "class_name", "view_id",
            "clickable", "enabled", "visible",
        )
    ):
        return False
    matched = [node for node in nodes if _matches_node(node, expression)]
    minimum = expression.get("min_count", 1)
    maximum = expression.get("max_count")
    if not isinstance(minimum, int) or isinstance(minimum, bool):
        return False
    return len(matched) >= minimum and (
        maximum is None or isinstance(maximum, int) and len(matched) <= maximum
    )


def _matches_node(node: _Node, expression: Mapping[str, Any]) -> bool:
    fields = {
        "text": node.text,
        "content_description": node.content_description,
        "class_name": node.class_name,
        "view_id": node.view_id,
    }
    for name, actual in fields.items():
        expected = expression.get(name)
        if expected is not None and actual != expected:
            return False
    pattern = expression.get("text_regex")
    if pattern is not None:
        if not isinstance(pattern, str) or re.fullmatch(pattern, node.text or "") is None:
            return False
    for name, actual in (
        ("clickable", node.clickable),
        ("enabled", node.enabled),
        ("visible", node.visible),
    ):
        expected = expression.get(name)
        if expected is not None and actual is not expected:
            return False
    return True


def _nodes(ui_tree: object) -> tuple[_Node, ...]:
    raw_nodes = (
        ui_tree.get("nodes", [])
        if isinstance(ui_tree, Mapping)
        else getattr(ui_tree, "nodes", ())
    )
    result: list[_Node] = []
    for raw in raw_nodes:
        getter = raw.get if isinstance(raw, Mapping) else lambda key, default=None: getattr(raw, key, default)
        raw_bounds = getter("bounds", {})
        bound = raw_bounds.get if isinstance(raw_bounds, Mapping) else lambda key, default=0: getattr(raw_bounds, key, default)
        result.append(_Node(
            node_id=str(getter("node_id", "")),
            parent_id=getter("parent_id"),
            class_name=getter("class_name"),
            text=getter("text"),
            content_description=getter("content_description"),
            view_id=getter("view_id_resource_name", getter("view_id")),
            bounds=SemanticBounds(
                int(bound("left", 0)), int(bound("top", 0)),
                int(bound("right", 0)), int(bound("bottom", 0)),
            ),
            clickable=bool(getter("clickable", False)),
            enabled=bool(getter("enabled", True)),
            visible=bool(getter("visible_to_user", getter("visible", True))),
            selected=bool(getter("selected", False)),
            metadata=(
                dict(getter("metadata", {}))
                if isinstance(getter("metadata", {}), Mapping)
                else {}
            ),
        ))
    return tuple(result)
