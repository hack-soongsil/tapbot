"""Choose a touch region without overlapping unrelated clickable elements."""

from tapbot.android.client import AndroidUiTree
from tapbot.ui_resolution.models import ResolvedUiElement


def unobscured_click_point(tree: AndroidUiTree, element: ResolvedUiElement) -> tuple[float, float]:
    target_id = str(element.metadata["node_id"])
    by_id = {node.node_id: node for node in tree.nodes}

    def ancestor_of(ancestor: str, child: str) -> bool:
        seen: set[str] = set()
        while child in by_id and child not in seen:
            if child == ancestor:
                return True
            seen.add(child)
            child = by_id[child].parent_id or ""
        return False

    bounds = element.bbox
    regions = [(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height)]
    for node in tree.nodes:
        if not node.visible_to_user or not node.clickable or not node.enabled:
            continue
        if ancestor_of(target_id, node.node_id) or ancestor_of(node.node_id, target_id):
            continue
        obstruction = node.bounds
        remaining = []
        for left, top, right, bottom in regions:
            x1, y1 = max(left, obstruction.left), max(top, obstruction.top)
            x2, y2 = min(right, obstruction.right), min(bottom, obstruction.bottom)
            if x1 >= x2 or y1 >= y2:
                remaining.append((left, top, right, bottom))
                continue
            remaining.extend((l, t, r, b) for l, t, r, b in (
                (left, top, right, y1), (left, y2, right, bottom),
                (left, y1, x1, y2), (x2, y1, right, y2),
            ) if r - l >= 12 and b - t >= 12)
        regions = remaining
    if not regions:
        raise ValueError("클릭 대상이 다른 요소에 가려져 있습니다. Agent 업데이트 또는 화면 이동이 필요합니다.")
    left, top, right, bottom = max(regions, key=lambda region: (region[2] - region[0]) * (region[3] - region[1]))
    return (left + right) / 2, (top + bottom) / 2
