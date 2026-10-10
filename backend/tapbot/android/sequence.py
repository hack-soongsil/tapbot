"""Adapt authored click targets to fresh Android geometry and accessibility."""

from __future__ import annotations

import re
from time import monotonic, sleep

from tapbot.android.client import AndroidAgentApiError, AndroidUiNode, AndroidUiTree
from tapbot.android.service import AndroidService
from tapbot.macro.sequence import SequenceConflictError, SequenceTargetPending
from tapbot.macro.sequence_models import SequenceDefinition, SequenceStep
from tapbot.ui_resolution.accessibility import AccessibilityUiResolver
from tapbot.ui_resolution.models import UiSelector
from tapbot.ui_resolution.time_slots import find_time_slot, plan_time_slot_scrolls
from tapbot.ui_resolution.click_point import unobscured_click_point


class AndroidSequencePort:
    def __init__(self, service: AndroidService) -> None:
        self.service = service
        self.resolver = AccessibilityUiResolver()

    def prepare(self, definition: SequenceDefinition) -> None:
        if self.service.macro_status == "RUNNING":
            raise SequenceConflictError("기존 매크로를 중지한 뒤 순서 매크로를 실행하세요.")
        status = self.service.client.status()
        if not status.get("accessibility_enabled") or not status.get("remote_control_enabled"):
            raise ValueError("휴대폰의 접근성과 Remote Control을 켜세요.")
        capabilities = status.get("capabilities", {})
        if (any(step.selector and step.selector.time_slot for step in definition.steps)
                and not (isinstance(capabilities, dict) and capabilities.get("ui_tree_fresh") is True)):
            raise ValueError("시간표 좌표 갱신을 지원하는 Agent 0.4.1로 업데이트하세요.")
        self._check_geometry(status, definition)

    @staticmethod
    def _check_geometry(status: dict, definition: SequenceDefinition) -> None:
        if not any(step.kind == "point" for step in definition.steps):
            return
        device = status.get("device", {})
        geometry = (device.get("width"), device.get("height"), device.get("rotation"))
        expected = (definition.screen_width, definition.screen_height, definition.rotation)
        if geometry != expected:
            raise ValueError("화면 크기 또는 방향이 바뀌었습니다. 좌표를 다시 지정하세요.")

    def execute(self, step: SequenceStep, definition: SequenceDefinition) -> dict[str, object]:
        if step.kind == "checkpoint":
            return self._checkpoint(step)
        if step.kind == "element":
            tree = self._ready_tree()
            self._screen_guard(step, tree)
            assert step.selector is not None
            if self._room_is_open(step, tree):
                return {"device_id": self.service.device_id, "step_id": step.id,
                        "skipped": True, "reason": "선택한 스터디룸의 시간 선택 화면이 이미 열려 있습니다."}
            status = self.service.client.status()
            capabilities = status.get("capabilities", {})
            # WebView may acknowledge ACTION_CLICK without selecting an offscreen
            # target, or target a card center hidden by a fixed footer. Use fresh
            # unobscured touch geometry there; retain native actions for native UI.
            native_click = (isinstance(capabilities, dict)
                            and capabilities.get("ui_element_click") is True
                            and not any(node.class_name == "android.webkit.WebView" for node in tree.nodes))
            selector_data = step.selector.model_dump(exclude_none=True)
            if step.selector.time_slot:
                node, slots = find_time_slot(tree, step.selector.time_slot)
                if native_click:
                    return self._native_click(step, {"node_path": node.node_id})
                tree, node, slots = self._settled_time_slot(step, tree)
                seen: set[tuple[int, int, int, int]] = set()
                scrolls_remaining = 12
                for _ in range(12):
                    if node.visible_to_user and node.bounds.width >= 100:
                        x, y = node.bounds.center
                        break
                    visible = [(index, slot) for index, slot in enumerate(slots) if slot.visible_to_user and slot.bounds.width >= 100]
                    if not visible:
                        raise ValueError("시간 선택 칸을 화면에 표시할 수 없습니다.")
                    key = (visible[0][0], visible[-1][0], visible[0][1].bounds.left, visible[-1][1].bounds.right)
                    if key in seen:
                        raise ValueError("시간 선택 화면이 이동하지 않습니다. Agent를 업데이트하세요.")
                    seen.add(key)
                    if scrolls_remaining <= 0:
                        raise ValueError("시간 선택 칸을 화면에 표시하지 못했습니다.")
                    moves = plan_time_slot_scrolls(tree, node, slots)[:scrolls_remaining]
                    for start_x, start_y, end_x, end_y in moves:
                        result = self.service.controller.swipe(start_x, start_y, end_x, end_y, duration_ms=450)
                        if result.state != "completed":
                            raise RuntimeError("시간 선택 화면 이동 결과가 불확실합니다.")
                        self.service.ui_tree_provider.invalidate()
                        scrolls_remaining -= 1
                    tree, node, slots = self._settled_time_slot(step, None)
                else:
                    raise ValueError("시간 선택 칸을 화면에 표시하지 못했습니다.")
                return self._tap(step, x, y)
            if native_click:
                return self._native_click(step, selector_data)
            selector = UiSelector(**selector_data, clickable=True)
            resolved = self.resolver.resolve(tree, selector)
            if resolved.status != "resolved" or resolved.element is None:
                if resolved.status == "ambiguous":
                    raise ValueError(f"{step.label}: 동일한 요소가 여러 개입니다.")
                raise SequenceTargetPending(f"{step.label}: 요소를 찾을 수 없습니다.")
            x, y = unobscured_click_point(tree, resolved.element)
        else:
            self._check_geometry(self.service.client.status(), definition)
            assert step.x is not None and step.y is not None
            x, y = step.x, step.y
        return self._tap(step, x, y)

    @staticmethod
    def _screen_guard(step: SequenceStep, tree: AndroidUiTree) -> None:
        if tree.truncated:
            raise ValueError(f"{step.label}: UI Tree가 잘려 대상을 확인할 수 없습니다.")
        if step.package_name and tree.package_name != step.package_name:
            raise SequenceTargetPending(f"{step.label}: 저장한 앱의 화면이 아닙니다.")
        if step.required_text and not any(node.text == step.required_text for node in tree.nodes):
            actual = next((node.text for node in tree.nodes
                           if node.text and re.fullmatch(r"\d{2}:\d{2}\s*~\s*\d{2}:\d{2}", node.text)), None)
            detail = f" 현재 선택된 시간은 '{actual}'입니다." if actual else ""
            raise SequenceTargetPending(f"{step.label}: 필요한 화면 '{step.required_text}'이 없습니다.{detail}")

    def _settled_time_slot(
        self, step: SequenceStep, tree: AndroidUiTree | None,
    ) -> tuple[AndroidUiTree, AndroidUiNode, tuple[AndroidUiNode, ...]]:
        """A completed swipe can still be followed by scrolling inertia.

        Read only until the timeline geometry stays still; dispatch no input
        while it moves, and reject a timeline that never settles.
        """
        assert step.selector and step.selector.time_slot
        deadline = monotonic() + 3
        previous = None
        stable_since = monotonic()
        while True:
            if tree is None:
                try:
                    tree = self.service.ui_tree_provider.snapshot(max_age_ms=0)
                except AndroidAgentApiError as error:
                    if error.code != "ui_tree_unavailable":
                        raise
                    previous = None
                    if monotonic() >= deadline:
                        raise ValueError(f"{step.label}: 현재 시간표의 UI Tree를 읽지 못했습니다.") from error
                    sleep(.1)
                    continue
            self._screen_guard(step, tree)
            node, slots = find_time_slot(tree, step.selector.time_slot)
            geometry = tuple((slot.node_id, slot.bounds, slot.visible_to_user) for slot in slots)
            now = monotonic()
            if geometry != previous:
                previous, stable_since = geometry, now
            elif now - stable_since >= .35:
                return tree, node, slots
            if now >= deadline:
                raise ValueError(f"{step.label}: 시간표가 계속 움직여 클릭을 중단했습니다.")
            sleep(.1)
            tree = None

    def _ready_tree(self) -> AndroidUiTree:
        try:
            return self.service.ui_tree_provider.snapshot(max_age_ms=0)
        except AndroidAgentApiError as error:
            if error.code != "ui_tree_unavailable":
                raise
            raise SequenceTargetPending("현재 화면의 UI Tree를 기다리는 중입니다.") from error

    @staticmethod
    def _room_is_open(step: SequenceStep, tree: AndroidUiTree) -> bool:
        selector = step.selector
        return bool(
            tree.package_name == "com.ssutoday"
            and selector and selector.text and selector.text.startswith("스터디룸 ")
            and any(node.text == selector.text and node.visible_to_user for node in tree.nodes)
            and any(node.text == "초기화" and node.visible_to_user for node in tree.nodes)
        )

    def _checkpoint(self, step: SequenceStep) -> dict[str, object]:
        if step.selector is None and step.required_text is None:
            return {"awaiting_user": True}
        tree = self._ready_tree()
        if tree.truncated:
            raise ValueError(f"{step.label}: UI Tree가 잘려 확인할 수 없습니다.")
        if step.package_name and tree.package_name != step.package_name:
            raise ValueError(f"{step.label}: 저장한 앱의 화면이 아닙니다.")
        selector = step.selector
        if selector and any(
            not node.password and node.visible_to_user
            and (selector.text is None or node.text == selector.text)
            and (selector.view_id is None or node.view_id_resource_name == selector.view_id)
            and (selector.content_description is None or node.content_description == selector.content_description)
            for node in tree.nodes
        ):
            return {"awaiting_user": True}
        if step.required_text is None or any(node.text == step.required_text for node in tree.nodes):
            return {"awaiting_user": False}
        return {"pending_confirmation": True}

    def _native_click(self, step: SequenceStep, selector: dict[str, object]) -> dict[str, object]:
        result = self.service.client.click_element(selector, package_name=step.package_name, required_text=step.required_text)
        if result.state not in {"completed", "dispatched"}:
            raise RuntimeError(f"{step.label}: 입력 상태 {result.state}")
        self.service.ui_tree_provider.invalidate()
        payload = {"device_id": self.service.device_id, "step_id": step.id, "method": "accessibility_action",
                   "result": {"state": result.state, "action_id": result.action_id, "command": result.command}}
        self.service.event_log.add(f"프리셋 UI 클릭: {step.label}", event_type="macro.sequence.click", category="macro", status="success", payload=payload)
        return payload

    def _tap(self, step: SequenceStep, x: float, y: float) -> dict[str, object]:
        result = self.service.controller.tap(x, y, duration_ms=step.duration_ms)
        if result.state not in {"completed", "dispatched"}:
            raise RuntimeError(f"{step.label}: 입력 상태 {result.state}")
        self.service.ui_tree_provider.invalidate()
        payload = {"device_id": self.service.device_id, "step_id": step.id, "x": x, "y": y, "result": result.to_dict()}
        self.service.event_log.add(
            f"순서 매크로 클릭: {step.label}", event_type="macro.sequence.tap",
            category="macro", status="success", payload=payload,
        )
        return payload
