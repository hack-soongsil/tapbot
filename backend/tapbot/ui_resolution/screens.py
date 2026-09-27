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


DEFAULT_SSUTODAY_SCREENS = (
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
        "time_slot": {"label": "30분 시간 슬롯", "kind": "collection", "required_params": ["index"]},
        "reset_selection": {"label": "선택 초기화", "kind": "element"},
        "reserve_cta": {"label": "예약 CTA", "kind": "element"},
    },
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
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
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
    if screen_id == "reservation_home":
        return _home_elements(nodes)
    if screen_id == "reservation_detail":
        return _detail_elements(nodes)
    return ()


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


def _detail_elements(nodes: tuple[_Node, ...]) -> tuple[SemanticUiElement, ...]:
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
        result.append(_element(
            "back",
            min(back, key=lambda node: node.bounds.left + node.bounds.top),
            {
                "class_name": "android.widget.Button",
                "screen_region": "top_left",
            },
            metadata={"fallback": "top-left bounds until content-description is available"},
        ))

    date_nodes = _dedupe_same_bounds(
        node for node in nodes if DATE_PICKER_PATTERN.fullmatch(node.text or "")
    )
    if date_nodes:
        result.append(_element(
            "date_picker", date_nodes[0], {"text_regex": DATE_PICKER_PATTERN.pattern}
        ))

    reserved_bounds = {element.bounds for element in result}
    cta = _dedupe_same_bounds(node for node in nodes if node.text in RESERVE_CTA_TEXTS)
    slot_bottom = min((node.bounds.top for node in cta), default=float("inf"))
    slots = _dedupe_same_bounds(
        node for node in nodes
        if node.class_name == "android.widget.Button"
        and not node.text
        and not node.content_description
        and node.bounds not in reserved_bounds
        and node.bounds.top >= 200
        and node.bounds.bottom <= slot_bottom
    )
    for index, node in enumerate(sorted(slots, key=_visual_order)):
        minutes = 6 * 60 + index * 30
        result.append(_element(
            f"time_slot[{index}]",
            node,
            {
                "class_name": "android.widget.Button",
                "semantic_family": "time_slot",
                "index": index,
            },
            metadata={
                "family": "time_slot",
                "index": index,
                "time": f"{minutes // 60:02d}:{minutes % 60:02d}",
            },
        ))

    reset = _dedupe_same_bounds(node for node in nodes if node.text == "초기화")
    if reset:
        result.append(_element("reset_selection", reset[0], {"text": "초기화"}))
    if cta:
        result.append(_element(
            "reserve_cta",
            cta[0],
            {"text_regex": "^(시간을 선택하세요|이 시간으로 예약하기|예약 처리 중)$"},
            metadata={"state_text": cta[0].text or ""},
        ))
    return tuple(result)


def _element(
    semantic_id: str,
    node: _Node,
    selector: JsonObject,
    *,
    metadata: JsonObject | None = None,
) -> SemanticUiElement:
    return SemanticUiElement(
        semantic_id=semantic_id,
        role="button",
        bounds=node.bounds,
        enabled=node.enabled,
        visible=node.visible,
        selector={"semantic_id": semantic_id, **selector},
        text=node.text,
        content_description=node.content_description,
        class_name=node.class_name,
        metadata=metadata or {},
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
        ))
    return tuple(result)
