"""Identify SSUTODAY's unnamed half-hour buttons from its timeline structure."""

from math import ceil
from statistics import median

from tapbot.android.client import AndroidUiNode, AndroidUiTree


def find_time_slot(tree: AndroidUiTree, time: str) -> tuple[AndroidUiNode, tuple[AndroidUiNode, ...]]:
    if tree.package_name != "com.ssutoday" or tree.truncated:
        raise ValueError("슈투데이 시간 선택 화면의 전체 UI Tree가 필요합니다.")
    groups: dict[str, list[AndroidUiNode]] = {}
    for node in tree.nodes:
        if node.parent_id:
            groups.setdefault(node.parent_id, []).append(node)
    timelines: list[tuple[AndroidUiNode, ...]] = []
    hours = {f"{hour:02}:00" for hour in range(6, 22)}
    for siblings in groups.values():
        buttons = tuple(node for node in siblings if node.clickable and node.class_name == "android.widget.Button")
        labels = {node.text for node in siblings if node.text}
        if len(buttons) == 32 and labels == hours:
            timelines.append(buttons)
    if len(timelines) != 1:
        raise ValueError("시간 선택 칸을 고유하게 찾을 수 없습니다. 앱의 UI 구조를 확인하세요.")
    hour, minute = map(int, time.split(":"))
    index = (hour - 6) * 2 + minute // 30
    if not 0 <= index < 32 or minute not in (0, 30):
        raise ValueError("시간 선택 범위를 벗어났습니다.")
    node = timelines[0][index]
    if not node.enabled:
        raise ValueError(f"{time} 시간 칸은 선택할 수 없습니다.")
    return node, timelines[0]


def plan_time_slot_scrolls(
    tree: AndroidUiTree, target: AndroidUiNode, slots: tuple[AndroidUiNode, ...],
) -> tuple[tuple[float, float, float, float], ...]:
    """Advance toward a hidden slot using its index and measured slot spacing.

    Limit each batch to three drags, then let the caller read current geometry
    again before touching a slot. Small remaining gaps get a shorter drag.
    """
    visible = [(index, slot) for index, slot in enumerate(slots)
               if slot.visible_to_user and slot.bounds.width >= 100]
    if len(visible) < 2:
        raise ValueError("시간 선택 칸의 간격을 확인할 수 없습니다.")
    pitch = median((right.bounds.center[0] - left.bounds.center[0]) / (right_index - left_index)
                   for (left_index, left), (right_index, right) in zip(visible, visible[1:]))
    if pitch <= 0:
        raise ValueError("시간 선택 칸의 위치가 올바르지 않습니다.")
    index = slots.index(target)
    forward = index > visible[-1][0]
    gap = index - visible[-1][0] if forward else visible[0][0] - index
    remaining = max(1, gap) * pitch
    left, right = tree.screen_width * .15, tree.screen_width * .85
    span = right - left
    y = visible[len(visible) // 2][1].bounds.center[1]
    moves = []
    for _ in range(min(3, ceil(remaining / span))):
        distance = min(span, remaining)
        start, end = (right, right - distance) if forward else (left, left + distance)
        moves.append((start, y, end, y))
        remaining -= distance
    return tuple(moves)
