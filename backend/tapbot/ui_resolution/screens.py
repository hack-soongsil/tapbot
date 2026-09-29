"""Rule-based screen recognition and semantic SSUTODAY UI extraction."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
import re
from typing import Any, Protocol


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
                {"text": "예약이 완료되었습니다"},
                {"text": "예약 화면으로 돌아가기"},
            ]
        },
    ),
    ScreenRule(
        "study_room_detail",
        {
            "all": [
                {"text_regex": r"^스터디룸 .+$"},
                {"text": DETAIL_GUIDANCE},
                {"text": "초기화"},
                {"text_regex": DATE_PICKER_PATTERN.pattern},
            ]
        },
    ),
    ScreenRule(
        "study_room_list",
        {
            "all": [
                {"text": "스터디룸 예약"},
                {"text_regex": r"^스터디룸 .+$"},
                {"content_description": "예약"},
            ]
        },
    ),
    ScreenRule(
        "reservation_detail",
        {
            "all": [
                {"text": DETAIL_GUIDANCE},
                {"text": "초기화"},
                {"text_regex": DATE_PICKER_PATTERN.pattern},
            ]
        },
    ),
    ScreenRule(
        "reservation_home",
        {
            "all": [
                {"content_description": "예약 내역"},
                {"content_description": "공지"},
                {"content_description": "예약"},
                {"content_description": "마이"},
                {"text_regex": QUICK_DATE_PATTERN.pattern, "min_count": 1},
            ]
        },
    ),
)

SCREEN_ELEMENT_TEMPLATES: dict[str, dict[str, JsonObject]] = {
    "study_room_list": {
        "header_title": {"label": "화면 제목", "kind": "element"},
        "history_button": {"label": "최근 내역", "kind": "element"},
        "reservation_history": {"label": "예약 내역", "kind": "element"},
        "hero_headline": {"label": "환영 문구", "kind": "element"},
        "hero_description": {"label": "화면 설명", "kind": "element"},
        "date_chip": {"label": "날짜 카드", "kind": "collection", "required_params": ["index"]},
        "selected_date_chip": {"label": "선택 날짜 카드", "kind": "element"},
        "selected_date_label": {"label": "선택 날짜", "kind": "element"},
        "selected_date_dropdown": {"label": "날짜 드롭다운", "kind": "element"},
        "live_status_indicator": {"label": "실시간 현황", "kind": "element"},
        "room_card": {"label": "스터디룸 카드", "kind": "collection", "required_params": ["index"]},
        "room_card_by_name": {"label": "이름으로 스터디룸 카드", "kind": "collection", "required_params": ["name"]},
        "bottom_tab_home": {"label": "Home 탭", "kind": "element"},
        "bottom_tab_booking": {"label": "Booking 탭", "kind": "element"},
        "bottom_tab_me": {"label": "Me 탭", "kind": "element"},
        "date_picker": {"label": "날짜 선택", "kind": "element"},
    },
    "reservation_home": {
        "reservation_history": {"label": "예약 내역", "kind": "element"},
        "quick_date": {"label": "빠른 날짜", "kind": "collection", "required_params": ["index"]},
        "date_picker": {"label": "날짜 선택", "kind": "element"},
        "nav_notice": {"label": "공지 탭", "kind": "element"},
        "nav_reservation": {"label": "예약 탭", "kind": "element"},
        "nav_my": {"label": "마이 탭", "kind": "element"},
    },
    "reservation_detail": {
        "back": {"label": "뒤로가기", "kind": "element"},
        "date_picker": {"label": "날짜 선택", "kind": "element"},
        "time_slot": {"label": "시간 슬롯", "kind": "collection", "required_params": ["index"]},
        "reset_selection": {"label": "선택 초기화", "kind": "element"},
        "reserve_cta": {"label": "예약 CTA", "kind": "element"},
    },
    "study_room_detail": {
        "back": {"label": "뒤로가기", "kind": "element"},
        "back_button": {"label": "뒤로가기 버튼", "kind": "element"},
        "room_hero_image": {"label": "스터디룸 대표 이미지", "kind": "element"},
        "room_name": {"label": "스터디룸 이름", "kind": "element"},
        "room_feature": {"label": "방 특징", "kind": "collection", "required_params": ["index"]},
        "selected_date_label": {"label": "선택 날짜", "kind": "element"},
        "live_status_indicator": {"label": "실시간 상태", "kind": "element"},
        "slot_guidance": {"label": "시간 슬롯 안내", "kind": "element"},
        "time_slot": {"label": "시간 슬롯", "kind": "collection", "required_params": ["index"]},
        "current_time_marker": {"label": "현재 시간 표시", "kind": "element"},
        "legend_reserved": {"label": "예약됨 범례", "kind": "element"},
        "legend_available": {"label": "빈 시간 범례", "kind": "element"},
        "legend_selected": {"label": "선택 범례", "kind": "element"},
        "selection_summary": {"label": "선택 상태", "kind": "element"},
        "reset_selection": {"label": "선택 초기화", "kind": "element"},
        "usage_rules": {"label": "이용 규칙", "kind": "element"},
        "reserve_cta": {"label": "예약 CTA", "kind": "element"},
    },
    "study_room_complete": {},
}


def validate_screen_element_reference(
    screen_id: object,
    element_id: object,
    params: object,
) -> tuple[str, ...]:
    if not isinstance(screen_id, str) or screen_id not in SCREEN_ELEMENT_TEMPLATES:
        return ("screen_id does not reference a known screen template",)
    templates = SCREEN_ELEMENT_TEMPLATES[screen_id]
    if not isinstance(element_id, str) or element_id not in templates:
        return ("element_id does not exist in the selected screen template",)
    if not isinstance(params, dict):
        return ("params must be an object",)
    errors: list[str] = []
    for key in templates[element_id].get("required_params", []):
        value = params.get(key)
        if key == "name":
            if not isinstance(value, str) or not value.strip():
                errors.append(f"params.{key} must be a non-empty string")
        elif isinstance(value, bool) or not isinstance(value, int) or value < 0:
            errors.append(f"params.{key} must be a non-negative integer")
    return tuple(errors)


class ScreenRecognizer:
    """Evaluate JSON-compatible AND/OR element signatures against a UI tree."""

    def __init__(self, screens: Iterable[ScreenRuleLike] = DEFAULT_SSUTODAY_SCREENS) -> None:
        self.screens = tuple(screens)

    def recognize(self, ui_tree: object) -> ScreenRecognition | None:
        nodes = _nodes(ui_tree)
        for screen in self.screens:
            matcher = screen.match or _default_match(screen.id)
            if _matches_expression(nodes, matcher):
                return ScreenRecognition(
                    screen.id,
                    extract_ssutoday_elements(screen.id, nodes),
                    _screen_context(screen.id, nodes),
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
    if screen_id == "study_room_list":
        return _list_elements(nodes)
    if screen_id == "reservation_home":
        return _home_elements(nodes)
    if screen_id in {"reservation_detail", "study_room_detail"}:
        return _detail_elements(nodes, start_minutes=8 * 60 if screen_id == "study_room_detail" else 6 * 60)
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
        ),
        key=lambda node: int(node.node_id.rsplit("-", 1)[1]),
    )
    for fallback_index, node in enumerate(date_chips):
        index = node.metadata.get("index", fallback_index)
        if isinstance(index, bool) or not isinstance(index, int):
            index = fallback_index
        full_date = node.metadata.get("full_date")
        if not isinstance(full_date, str):
            full_date = _mock_date_for_index(index)
        metadata = {
            "family": "date_chip",
            "index": index,
            "full_date": full_date,
            "selected": node.selected,
            "day_label": node.metadata.get("day_label"),
            "day_number": node.metadata.get("day_number"),
        }
        result.append(_element(
            f"date_chip[{index}]",
            node,
            {"semantic_family": "date_chip", "index": index},
            metadata=metadata,
        ))
        if node.selected:
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
        ),
        key=lambda node: int(node.node_id.rsplit("-", 1)[1]),
    )
    for node in room_cards:
        index = int(node.node_id.rsplit("-", 1)[1])
        parts = (node.content_description or "").split("|")
        room_name = parts[0] if len(parts) == 4 else f"스터디룸 {index}"
        metadata = {
            "family": "room_card",
            "index": index,
            "room_id": node.metadata.get("room_id", _room_id_from_name(room_name)),
            "room_name": room_name,
            "capacity": node.metadata.get("capacity", parts[1] if len(parts) == 4 else None),
            "location": node.metadata.get("location", parts[2] if len(parts) == 4 else None),
            "status": node.metadata.get("status", parts[3] if len(parts) == 4 else None),
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

    for semantic_id, node_id, description in (
        ("bottom_tab_home", "bottom-home", "홈"),
        ("bottom_tab_booking", "bottom-booking", "예약"),
        ("bottom_tab_me", "bottom-me", "마이"),
    ):
        candidates = _dedupe_same_bounds(
            node for node in nodes
            if node.node_id == node_id and node.content_description == description
        )
        if candidates:
            result.append(_element(
                semantic_id, candidates[0], {"content_description": description}
            ))

    return tuple(result)


def _home_elements(nodes: tuple[_Node, ...]) -> tuple[SemanticUiElement, ...]:
    result: list[SemanticUiElement] = []
    history = _dedupe_same_bounds(
        node for node in nodes if node.content_description == "예약 내역"
    )
    if history:
        result.append(_element("reservation_history", history[0], {
            "content_description": "예약 내역",
            "class_name": "android.widget.Button",
        }))

    quick_dates = _dedupe_same_bounds(
        node for node in nodes if QUICK_DATE_PATTERN.fullmatch(node.text or "")
    )
    for index, node in enumerate(sorted(quick_dates, key=_visual_order)):
        result.append(_element(
            f"quick_date[{index}]",
            node,
            {"text_regex": QUICK_DATE_PATTERN.pattern, "index": index},
            metadata={"family": "quick_date", "index": index},
        ))

    date_nodes = _dedupe_same_bounds(
        node for node in nodes if DATE_PICKER_PATTERN.fullmatch(node.text or "")
    )
    if date_nodes:
        result.append(_element(
            "date_picker",
            date_nodes[0],
            {"text_regex": DATE_PICKER_PATTERN.pattern},
        ))
    for semantic_id, label in (
        ("nav_notice", "공지"),
        ("nav_reservation", "예약"),
        ("nav_my", "마이"),
    ):
        candidates = _dedupe_same_bounds(
            node for node in nodes if node.content_description == label
        )
        if candidates:
            result.append(_element(
                semantic_id,
                candidates[0],
                {"content_description": label},
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
        node for node in nodes if re.fullmatch(r"스터디룸 .+", node.text or "")
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
    mock_slots = [node for node in nodes if re.fullmatch(r"slot-[0-9]+", node.node_id)]
    slots = _dedupe_same_bounds(mock_slots or (
        node for node in nodes
        if node.class_name == "android.widget.Button"
        and not node.text
        and not node.content_description
        and node.clickable
        and node.bounds not in reserved_bounds
        and node.bounds.top >= 200
        and node.bounds.bottom <= slot_bottom
    ))
    for index, node in enumerate(sorted(slots, key=_visual_order)):
        slot_index = node.metadata.get("index", index)
        if isinstance(slot_index, bool) or not isinstance(slot_index, int):
            slot_index = index
        minutes = start_minutes + slot_index * 30
        selected = node.selected
        state = node.metadata.get("state")
        if not isinstance(state, str):
            state = "selected" if selected else "available" if node.enabled else "reserved"
        result.append(_element(
            f"time_slot[{slot_index}]",
            node,
            {
                "class_name": "android.widget.Button",
                "semantic_family": "time_slot",
                "index": slot_index,
            },
            metadata={
                "family": "time_slot",
                "index": slot_index,
                "time": f"{minutes // 60:02d}:{minutes % 60:02d}",
                "state": state,
                "selected": selected,
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
        selected_slot_index = selected_slots[0].metadata.get("index")
        if isinstance(selected_slot_index, int) and not isinstance(selected_slot_index, bool):
            minutes = start_minutes + selected_slot_index * 30
            selected_time = f"{minutes // 60:02d}:{minutes % 60:02d}"
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
            "시간을 선택하세요": "NO_SELECTION",
            "이 시간으로 예약하기": "SELECTED",
            "예약 처리 중": "SUBMITTING",
        }.get(state_text, "UNKNOWN")
        result.append(_element(
            "reserve_cta",
            cta[0],
            {"text_regex": "^(시간을 선택하세요|이 시간으로 예약하기|예약 처리 중)$"},
            metadata={
                "state": cta_state,
                "state_text": state_text,
                "selected_slot_index": selected_slot_index,
                "selected_time": selected_time,
            },
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


def _semantic_priority(node: _Node) -> tuple[int, int, int]:
    return (
        1 if node.class_name == "android.widget.Button" else 0,
        1 if node.content_description or node.text else 0,
        1 if node.clickable else 0,
    )


def _visual_order(node: _Node) -> tuple[int, int, int, int]:
    return (node.bounds.top, node.bounds.left, node.bounds.bottom, node.bounds.right)


def _default_match(screen_id: str) -> JsonObject:
    for screen in DEFAULT_SSUTODAY_SCREENS:
        if screen.id == screen_id:
            return screen.match
    return {}


def _screen_context(screen_id: str, nodes: tuple[_Node, ...]) -> JsonObject:
    if screen_id == "study_room_list":
        date_label = next(
            (
                node.text for node in nodes
                if node.node_id == "selected-date"
                and DATE_PICKER_PATTERN.fullmatch(node.text or "")
            ),
            None,
        )
        return {"selected_date": _date_label_to_iso(date_label)}
    if screen_id not in {"study_room_detail", "study_room_complete"}:
        return {}
    detail_text = next(
        (node.text for node in nodes if (node.text or "").startswith("스터디룸 ")),
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
        time_match = re.search(r"[0-9]{2}:[0-9]{2}$", detail_text)
        if date_match:
            context["date"] = date_match.group()
        if time_match:
            context["time"] = time_match.group()
    return context


def _date_label_to_iso(label: str | None) -> str | None:
    match = re.fullmatch(
        r"([0-9]{4})년 ([0-9]{1,2})월 ([0-9]{1,2})일\([월화수목금토일]\)",
        label or "",
    )
    if match is None:
        return None
    year, month, day = (int(value) for value in match.groups())
    return f"{year:04d}-{month:02d}-{day:02d}"


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
