"""Accessibility UI Tree generated from the same state and geometry as pixels."""

from __future__ import annotations

from typing import Any

from .fixtures import (
    CURRENT_SLOT,
    DATES,
    PACKAGE_NAME,
    ROOMS,
    SLOT_COUNT,
    SLOT_TIMES,
    USAGE_RULES,
    slot_end_time,
    slot_state,
)
from .interactions import MockSnapshot
from .layout import (
    BOTTOM_NAV_TOP,
    CONFIRM_CANCEL,
    CONFIRM_DIALOG,
    CONFIRM_SUBMIT,
    DETAIL_AMENITIES_TOP,
    DETAIL_BACK,
    DETAIL_CTA,
    DETAIL_DATE_BUTTON,
    DETAIL_GUIDANCE,
    DETAIL_HERO,
    DETAIL_LEGEND,
    DETAIL_LIVE_STATUS,
    DETAIL_RESET,
    DETAIL_RULES,
    DETAIL_SLOT_GAP,
    DETAIL_SLOT_LEFT,
    DETAIL_SLOT_WIDTH,
    DETAIL_SUMMARY,
    DETAIL_TIMELINE_VIEW,
    DETAIL_TITLE,
    HEIGHT,
    HISTORY_BUTTON,
    HOME_HERO_DESCRIPTION,
    HOME_HERO_TITLE,
    HOME_LIVE_STATUS,
    HOME_LOGO,
    HOME_TITLE,
    HOME_VIEW_BOTTOM,
    ROOM_CARD_LEFT,
    ROOM_CARD_RIGHT,
    SCREEN_VIEWPORT,
    SELECTED_DATE,
    WIDTH,
    detail_slot_rect,
    home_card_rect,
    home_date_chip_rect,
    intersects,
    translate_y,
)


def screen_nodes(snapshot: MockSnapshot) -> list[dict[str, Any]]:
    if snapshot.screen == "home":
        return _home_nodes(snapshot)
    if snapshot.screen == "success":
        return _success_nodes(snapshot)
    nodes = _detail_nodes(snapshot)
    if snapshot.screen == "confirm":
        nodes.extend(_confirm_nodes(snapshot))
    return nodes


def build_ui_tree(snapshot: MockSnapshot) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    nodes = screen_nodes(snapshot)
    root = node(
        "root",
        bounds=(0, 0, WIDTH, HEIGHT),
        class_name="android.widget.FrameLayout",
        clickable=False,
        children=nodes,
    )
    flat_nodes = [without_children(root), *(without_children(item) for item in nodes)]
    return root, flat_nodes


def _home_nodes(snapshot: MockSnapshot) -> list[dict[str, Any]]:
    scroll = snapshot.home_scroll
    selected_date = DATES[snapshot.selected_date_index]
    nodes = [
        node("home-scroll", bounds=(0, 82, WIDTH, HOME_VIEW_BOTTOM), class_name="android.widget.ScrollView", clickable=False, scrollable=True),
        node("app-icon", bounds=HOME_LOGO, description="SSUTODAY", class_name="android.widget.ImageView", clickable=False),
        node("header-title", bounds=HOME_TITLE, text="스터디룸 예약", class_name="android.widget.TextView", clickable=False),
        node("history-button", bounds=HISTORY_BUTTON, description="예약 내역"),
        node("hero-headline", bounds=translate_y(HOME_HERO_TITLE, -scroll), text="성준님, 어디서 공부할까요?", class_name="android.widget.TextView", clickable=False, visible=_home_visible(translate_y(HOME_HERO_TITLE, -scroll))),
        node("hero-description", bounds=translate_y(HOME_HERO_DESCRIPTION, -scroll), text="실시간으로 빈 시간을 확인하고 바로 예약할 수 있어요", class_name="android.widget.TextView", clickable=False, visible=_home_visible(translate_y(HOME_HERO_DESCRIPTION, -scroll))),
    ]
    for index, date in enumerate(DATES):
        bounds = translate_y(
            home_date_chip_rect(index, snapshot.selected_date_index), -scroll
        )
        nodes.append(node(
            f"date-chip-{index}",
            bounds=bounds,
            text=f"{date['top']} {date['bottom']}",
            selected=index == snapshot.selected_date_index,
            visible=_home_visible(bounds),
            metadata={
                "semantic_family": "date_chip",
                "index": index,
                "day_label": date["top"],
                "day_number": date["bottom"],
                "full_date": date["full_date"],
            },
        ))
    selected_bounds = translate_y(SELECTED_DATE, -scroll)
    live_bounds = translate_y(HOME_LIVE_STATUS, -scroll)
    nodes.extend((
        node("selected-date", bounds=selected_bounds, text=selected_date["label"], visible=_home_visible(selected_bounds)),
        node("live-status", bounds=live_bounds, text="실시간 현황", class_name="android.widget.TextView", clickable=False, visible=_home_visible(live_bounds)),
    ))
    for index, room in enumerate(ROOMS):
        world_card = home_card_rect(index)
        card = translate_y(world_card, -scroll)
        visible = _home_visible(card)
        metadata = {
            "semantic_family": "room_card",
            "index": index,
            "room_id": room["id"],
            "room_name": room["name"],
            "capacity": room["capacity"],
            "location": room["location"],
            "status": room["status"],
        }
        top = card[1]
        nodes.extend((
            node(
                f"room-card-{index}",
                bounds=card,
                description=f"{room['name']} {room['capacity']} {room['location']} {room['status']}",
                visible=visible,
                metadata=metadata,
            ),
            node(f"room-card-{index}-thumbnail", bounds=(90, top + 40, 260, top + 210), description=f"{room['name']} 사진", class_name="android.widget.ImageView", clickable=False, visible=visible),
            node(f"room-card-{index}-capacity", bounds=(300, top + 45, 455, top + 112), text=room["capacity"], class_name="android.widget.TextView", clickable=False, visible=visible),
            node(f"room-card-{index}-location", bounds=(475, top + 45, 780, top + 112), text=room["location"], class_name="android.widget.TextView", clickable=False, visible=visible),
            node(f"room-card-{index}-status", bounds=(865, top + 60, 985, top + 127), text=room["status"], class_name="android.widget.TextView", clickable=False, visible=visible),
            node(f"room-card-{index}-name", bounds=(300, top + 120, 780, top + 200), text=room["name"], class_name="android.widget.TextView", clickable=False, visible=visible),
            node(f"room-card-{index}-availability", bounds=(90, top + 215, 985, top + 390), description=f"{room['name']} 시간대별 예약 현황", class_name="android.view.View", clickable=False, visible=visible, metadata={"horizontal_scroll": snapshot.home_time_scroll}),
        ))
    nodes.extend((
        node("bottom-home", bounds=(0, BOTTOM_NAV_TOP, 470, HEIGHT), description="공지"),
        node("bottom-booking", bounds=(470, 1966, 620, 2200), description="예약", selected=True),
        node("bottom-me", bounds=(620, BOTTOM_NAV_TOP, WIDTH, HEIGHT), description="마이"),
    ))
    return nodes


def _detail_nodes(snapshot: MockSnapshot) -> list[dict[str, Any]]:
    scroll = snapshot.detail_scroll
    room = ROOMS[snapshot.selected_room_index]
    date = DATES[snapshot.selected_date_index]
    hero = translate_y(DETAIL_HERO, -scroll)
    title = translate_y(DETAIL_TITLE, -scroll)
    nodes = [
        node("detail-scroll", bounds=(0, 0, WIDTH, HEIGHT), class_name="android.widget.ScrollView", clickable=False, scrollable=True),
        node("room-hero-image", bounds=hero, description="스터디룸 내부 사진", class_name="android.widget.ImageView", clickable=False, visible=intersects(hero, SCREEN_VIEWPORT)),
        node("back-button", bounds=DETAIL_BACK),
        node("room-name", bounds=title, text=room["name"], class_name="android.widget.TextView", clickable=False, visible=intersects(title, SCREEN_VIEWPORT)),
    ]
    amenity_left = 55
    for index, amenity in enumerate(room["amenities"]):
        width = 75 + len(amenity) * 33
        bounds = translate_y((amenity_left, DETAIL_AMENITIES_TOP, amenity_left + width, 815), -scroll)
        nodes.append(node(f"feature-{index}", bounds=bounds, text=amenity, class_name="android.widget.TextView", clickable=False, visible=intersects(bounds, SCREEN_VIEWPORT), metadata={"semantic_family": "room_feature", "index": index}))
        amenity_left += width + 20
    date_bounds = translate_y(DETAIL_DATE_BUTTON, -scroll)
    live_bounds = translate_y(DETAIL_LIVE_STATUS, -scroll)
    guide_bounds = translate_y(DETAIL_GUIDANCE, -scroll)
    nodes.extend((
        node("selected-date", bounds=date_bounds, text=date["label"], visible=intersects(date_bounds, SCREEN_VIEWPORT)),
        node("live-status", bounds=live_bounds, text="실시간", class_name="android.widget.TextView", clickable=False, visible=intersects(live_bounds, SCREEN_VIEWPORT)),
        node("slot-guidance", bounds=guide_bounds, text="한 칸은 30분입니다. 예약된 시간은 선택할 수 없어요", class_name="android.widget.TextView", clickable=False, visible=intersects(guide_bounds, SCREEN_VIEWPORT)),
    ))
    for index in range(SLOT_COUNT):
        state = slot_state(snapshot.selected_room_index, snapshot.selected_date_index, index, snapshot.selection)
        world_bounds = detail_slot_rect(
            index, snapshot.detail_time_scroll, state
        )
        bounds = translate_y(world_bounds, -scroll)
        selected = state == "selected"
        enabled = state in {"available", "current", "selected"}
        visible = intersects(bounds, SCREEN_VIEWPORT) and intersects(world_bounds, DETAIL_TIMELINE_VIEW)
        nodes.append(node(
            f"slot-{index}",
            parent_id="timeline-track",
            bounds=bounds,
            text="",
            enabled=enabled,
            selected=selected,
            visible=visible,
            metadata={
                "semantic_family": "time_slot",
                "index": index,
                "time": SLOT_TIMES[index],
                "start_time": SLOT_TIMES[index],
                "end_time": slot_end_time(index),
                "state": state,
                "booked": state in {"booked", "mine"},
                "mine": state == "mine",
                "selected": selected,
                "enabled": enabled,
                "visible": visible,
            },
        ))
    marker_x = DETAIL_SLOT_LEFT + CURRENT_SLOT * (DETAIL_SLOT_WIDTH + DETAIL_SLOT_GAP) - snapshot.detail_time_scroll
    marker = translate_y((marker_x - 4, 1015, marker_x + 4, 1258), -scroll)
    nodes.append(node("current-time-marker", bounds=marker, class_name="android.view.View", clickable=False, visible=intersects(marker, SCREEN_VIEWPORT)))
    legend = translate_y(DETAIL_LEGEND, -scroll)
    for index, (semantic_id, text) in enumerate((
        ("legend-reserved", "예약됨"), ("legend-available", "빈 시간"), ("legend-selected", "선택"),
    )):
        bounds = (55 + index * 275, legend[1], 260 + index * 275, legend[3])
        nodes.append(node(semantic_id, bounds=bounds, text=text, class_name="android.widget.TextView", clickable=False, visible=intersects(bounds, SCREEN_VIEWPORT)))
    summary_bounds = translate_y(DETAIL_SUMMARY, -scroll)
    reset_bounds = translate_y(DETAIL_RESET, -scroll)
    summary = "시간대를 선택하세요"
    if snapshot.selection:
        summary = f"{SLOT_TIMES[snapshot.selection[0]]} ~ {slot_end_time(snapshot.selection[1])}"
    nodes.extend((
        node("selection-summary", bounds=summary_bounds, text=summary, class_name="android.view.View", clickable=False, visible=intersects(summary_bounds, SCREEN_VIEWPORT), metadata={"selected_slot_index": snapshot.selection[0] if snapshot.selection else None, "selected_slot_end_index": snapshot.selection[1] if snapshot.selection else None, "selected_time": SLOT_TIMES[snapshot.selection[0]] if snapshot.selection else None}),
        node("reset-selection", bounds=reset_bounds, text="초기화", visible=intersects(reset_bounds, SCREEN_VIEWPORT)),
        node("usage-rules-title", bounds=translate_y((95, 1750, 320, 1810), -scroll), text="이용 규칙", class_name="android.widget.TextView", clickable=False),
        node("usage-rules", bounds=translate_y(DETAIL_RULES, -scroll), text="\n".join(USAGE_RULES), class_name="android.widget.TextView", clickable=False, visible=intersects(translate_y(DETAIL_RULES, -scroll), SCREEN_VIEWPORT)),
    ))
    state = "submitting" if snapshot.submitting else "ready" if snapshot.selection else "idle"
    cta_text = "예약 처리 중" if snapshot.submitting else "이 시간으로 예약하기" if snapshot.selection else "시간을 선택하세요"
    nodes.append(node(
        "reserve-cta",
        bounds=DETAIL_CTA,
        text=cta_text,
        enabled=state == "ready",
        metadata={
            "state": state,
            "text": cta_text,
            "selected_slot_index": snapshot.selection[0] if snapshot.selection else None,
            "selected_slot_end_index": snapshot.selection[1] if snapshot.selection else None,
            "selected_time": SLOT_TIMES[snapshot.selection[0]] if snapshot.selection else None,
        },
    ))
    return nodes


def _confirm_nodes(snapshot: MockSnapshot) -> list[dict[str, Any]]:
    room = ROOMS[snapshot.selected_room_index]
    date = DATES[snapshot.selected_date_index]
    selection = snapshot.selection or (0, 0)
    return [
        node("confirm-dialog", bounds=CONFIRM_DIALOG, class_name="android.app.Dialog", clickable=False),
        node("confirm-title", bounds=(185, 930, 895, 1040), text="이 시간으로 예약할까요?", class_name="android.widget.TextView", clickable=False),
        node("confirm-room", bounds=(190, 1080, 890, 1160), text=room["name"], class_name="android.widget.TextView", clickable=False),
        node("confirm-date", bounds=(190, 1170, 890, 1250), text=date["full_date"], class_name="android.widget.TextView", clickable=False),
        node("confirm-time", bounds=(190, 1260, 890, 1340), text=f"{SLOT_TIMES[selection[0]]} ~ {slot_end_time(selection[1])}", class_name="android.widget.TextView", clickable=False),
        node("confirm-cancel", bounds=CONFIRM_CANCEL, text="취소"),
        node("confirm-reservation", bounds=CONFIRM_SUBMIT, text="예약 확정"),
    ]


def _success_nodes(snapshot: MockSnapshot) -> list[dict[str, Any]]:
    room = ROOMS[snapshot.selected_room_index]
    date = DATES[snapshot.selected_date_index]
    selection = snapshot.selection or (0, 0)
    return [
        node("success-title", bounds=(250, 690, 830, 810), text="예약 성공", class_name="android.widget.TextView", clickable=False),
        node("success-room", bounds=(350, 925, 930, 1010), text=room["name"], class_name="android.widget.TextView", clickable=False),
        node("success-date", bounds=(150, 1180, 930, 1270), text=date["label"], class_name="android.widget.TextView", clickable=False),
        node("success-time", bounds=(150, 1290, 930, 1380), text=f"{SLOT_TIMES[selection[0]]} ~ {slot_end_time(selection[1])}", class_name="android.widget.TextView", clickable=False),
        node("success-history", bounds=(95, 1670, 985, 1810), text="예약 내역 보기"),
        node("complete-home", bounds=(95, 1845, 985, 1985), text="예약 화면으로"),
    ]


def node(
    node_id: str,
    *,
    bounds: tuple[int, int, int, int],
    text: str | None = None,
    description: str | None = None,
    class_name: str = "android.widget.Button",
    enabled: bool = True,
    selected: bool = False,
    clickable: bool | None = None,
    scrollable: bool = False,
    visible: bool = True,
    metadata: dict[str, Any] | None = None,
    parent_id: str | None = "root",
    children: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    children = children or []
    is_clickable = class_name == "android.widget.Button" if clickable is None else clickable
    return {
        "id": node_id,
        "node_id": node_id,
        "parent_id": None if node_id == "root" else parent_id,
        "depth": 0 if node_id == "root" else 1,
        "class_name": class_name,
        "text": text,
        "content_description": description,
        "view_id_resource_name": f"{PACKAGE_NAME}:id/{node_id}",
        "package_name": PACKAGE_NAME,
        "bounds": dict(zip(("left", "top", "right", "bottom"), bounds, strict=True)),
        "clickable": is_clickable,
        "enabled": enabled,
        "focusable": is_clickable,
        "focused": False,
        "selected": selected,
        "checked": False,
        "checkable": False,
        "scrollable": scrollable,
        "editable": False,
        "visible_to_user": visible,
        "visible": visible,
        "password": False,
        "child_count": len(children),
        "metadata": metadata or {},
        "children": children,
    }


def without_children(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if key != "children"}


def _home_visible(bounds: tuple[int, int, int, int]) -> bool:
    return intersects(bounds, (0, 250, WIDTH, HOME_VIEW_BOTTOM))
