from types import SimpleNamespace
from itertools import count
from unittest.mock import Mock

import pytest

from tapbot.android.client import AndroidActionResult, AndroidAgentApiError, AndroidUiBounds
from tapbot.android.sequence import AndroidSequencePort
from tapbot.events import EventLog
from tapbot.macro.sequence_models import SequenceDefinition, SequenceStep
from tapbot.macro.sequence import SequenceTargetPending
from tests.fakes.sequence import SnapshotQueue, ui_node, ui_tree


def make_port(*trees, native=False):
    client = Mock()
    client.status.return_value = {"accessibility_enabled": True, "remote_control_enabled": True,
                                  "device": {"width": 1080, "height": 2400, "rotation": 0},
                                  "capabilities": {"ui_element_click": native}}
    client.click_element.return_value = AndroidActionResult("request", "action", "click_element", "dispatched")
    controller = Mock()
    controller.tap.return_value = SimpleNamespace(state="completed", to_dict=lambda: {"state": "completed"})
    port = AndroidSequencePort(SimpleNamespace(
        client=client, controller=controller, ui_tree_provider=SnapshotQueue(*trees),
        macro_status="IDLE", device_id="phone", event_log=EventLog(),
    ))
    return port


def step(**changes):
    return SequenceStep.model_validate({"id": "click", "label": "Click", "kind": "element",
                                       "selector": {"text": "Next"}, **changes})


def definition(value):
    return SequenceDefinition(id="test", name="Test", screen_width=1080, screen_height=2400, steps=(value,))


def test_element_is_resolved_again_from_fresh_geometry_and_avoids_footer():
    target = ui_node("n0.0", text="Next", parent_id="n0", clickable=True,
                     bounds=AndroidUiBounds(50, 1800, 1030, 2300))
    footer = ui_node("n0.1", parent_id="n0", clickable=True,
                     bounds=AndroidUiBounds(0, 2050, 1080, 2400))
    port = make_port(ui_tree(target, footer))
    value = step()
    port.execute(value, definition(value))
    args = port.service.controller.tap.call_args.args
    assert args == (540, 1925)
    assert port.service.ui_tree_provider.invalidated == 1


def test_ambiguous_and_truncated_targets_dispatch_nothing():
    target = ui_node("n0.0", parent_id="n0", text="Next", clickable=True,
                     bounds=AndroidUiBounds(10, 10, 200, 100))
    duplicate = ui_node("n0.1", parent_id="n0", text="Next", clickable=True,
                        bounds=AndroidUiBounds(300, 10, 500, 100))
    for tree in (ui_tree(target, duplicate), ui_tree(target, truncated=True)):
        port = make_port(tree)
        value = step()
        with pytest.raises(ValueError):
            port.execute(value, definition(value))
        port.service.controller.tap.assert_not_called()
        port.service.client.click_element.assert_not_called()


def test_offscreen_native_click_uses_selector_and_screen_guard():
    port = make_port(ui_tree(ui_node("n0.0", text="Next", visible_to_user=False)), native=True)
    value = step(package_name="com.ssutoday", required_text="Next")
    port.execute(value, definition(value))
    port.service.client.click_element.assert_called_once_with(
        {"text": "Next"}, package_name="com.ssutoday", required_text="Next")
    port.service.controller.tap.assert_not_called()


def test_changed_coordinate_geometry_is_rejected_before_input():
    port = make_port(ui_tree())
    port.service.client.status.return_value["device"]["rotation"] = 90
    value = step(kind="point", x=10, y=20, selector=None)
    with pytest.raises(ValueError, match="좌표"):
        port.prepare(definition(value))
    port.service.controller.tap.assert_not_called()


def test_optional_confirmation_present_pauses_absent_proceeds_without_input():
    value = step(kind="checkpoint", selector={"content_description": "Review"}, required_text="Done")
    port = make_port(
        ui_tree(ui_node("n0.0", content_description="Review", clickable=True)),
        ui_tree(ui_node("n0.0", text="Done")),
    )
    assert port.execute(value, definition(value)) == {"awaiting_user": True}
    assert port.execute(value, definition(value)) == {"awaiting_user": False}
    port.service.controller.tap.assert_not_called()
    port.service.client.click_element.assert_not_called()


def timeline_tree(target_bounds=None):
    webview = ui_node("n0.0", parent_id="n0", class_name="android.webkit.WebView")
    buttons = []
    for index in range(32):
        bounds = (AndroidUiBounds(66 + index * 186, 1314, 240 + index * 186, 1437)
                  if index < 5 else AndroidUiBounds(1080, 1314, 1080, 1437))
        if index == 15 and target_bounds is not None:
            bounds = target_bounds
        buttons.append(ui_node(f"n0.0.{index}", parent_id="n0.0", clickable=True,
                               visible_to_user=index < 5 or (index == 15 and target_bounds is not None),
                               bounds=bounds))
    labels = [ui_node(f"n0.0.{32 + index}", parent_id="n0.0", text=f"{6 + index:02}:00")
              for index in range(16)]
    return ui_tree(webview, *buttons, *labels)


@pytest.mark.parametrize("transient_tree_error", [False, True])
def test_webview_time_click_waits_for_scroll_inertia_and_uses_final_bounds(monkeypatch, transient_tree_error):
    ticks = count(0, .1)
    monkeypatch.setattr("tapbot.android.sequence.monotonic", lambda: next(ticks))
    monkeypatch.setattr("tapbot.android.sequence.sleep", lambda seconds: None)
    initial = timeline_tree()
    moving = timeline_tree(AndroidUiBounds(210, 1314, 390, 1437))
    settled = timeline_tree(AndroidUiBounds(610, 1314, 790, 1437))
    port = make_port(initial, native=True)
    def swipe(*args, **kwargs):
        pending = [AndroidAgentApiError("Not ready", code="ui_tree_unavailable", request_id="read")] if transient_tree_error else []
        port.service.ui_tree_provider.trees = [*pending, moving, settled]
        return SimpleNamespace(state="completed")
    port.service.controller.swipe.side_effect = swipe
    value = step(selector={"time_slot": "13:30"})
    port.execute(value, definition(value))
    assert port.service.controller.swipe.call_count == 3
    port.service.controller.tap.assert_called_once_with(700, 1375.5, duration_ms=70)
    port.service.client.click_element.assert_not_called()


def test_webview_card_uses_unobscured_touch_instead_of_acknowledged_native_action():
    webview = ui_node("n0.0", parent_id="n0", class_name="android.webkit.WebView")
    target = ui_node("n0.0.0", text="Next", parent_id="n0.0", clickable=True,
                     bounds=AndroidUiBounds(50, 1800, 1030, 2300))
    footer = ui_node("n0.0.1", parent_id="n0.0", clickable=True,
                     bounds=AndroidUiBounds(0, 2050, 1080, 2400))
    port = make_port(ui_tree(webview, target, footer), native=True)
    value = step()
    port.execute(value, definition(value))
    port.service.controller.tap.assert_called_once_with(540, 1925, duration_ms=70)
    port.service.client.click_element.assert_not_called()


def test_range_guard_reports_actual_selection_and_never_submits_wrong_range():
    port = make_port(ui_tree(ui_node("n0.0", text="12:00 ~ 12:30")), native=True)
    value = step(required_text="12:00 ~ 14:00")
    with pytest.raises(ValueError, match="현재 선택된 시간은 '12:00 ~ 12:30'"):
        port.execute(value, definition(value))
    port.service.controller.tap.assert_not_called()
    port.service.client.click_element.assert_not_called()


def test_time_preset_requires_agent_with_fresh_tree_before_any_input():
    port = make_port(timeline_tree(), native=True)
    value = step(selector={"time_slot": "13:30"})
    with pytest.raises(ValueError, match="0.4.1"):
        port.prepare(definition(value))
    port.service.controller.tap.assert_not_called()
    port.service.controller.swipe.assert_not_called()
    port.service.client.status.return_value["capabilities"]["ui_tree_fresh"] = True
    port.prepare(definition(value))


@pytest.mark.parametrize("kind", ["element", "checkpoint"])
def test_unavailable_tree_waits_before_dispatching_any_input(kind):
    unavailable = AndroidAgentApiError("Not ready", code="ui_tree_unavailable", request_id="read")
    target = ui_node("n0.0", parent_id="n0", text="Next", clickable=True,
                     bounds=AndroidUiBounds(10, 10, 200, 100))
    port = make_port(unavailable, ui_tree(target))
    value = step(kind=kind)
    with pytest.raises(SequenceTargetPending):
        port.execute(value, definition(value))
    port.service.controller.tap.assert_not_called()
    port.service.client.click_element.assert_not_called()
    port.execute(value, definition(value))
    assert port.service.controller.tap.call_count == (1 if kind == "element" else 0)


def test_open_room_step_can_restart_from_its_detail_screen_without_extra_tap():
    port = make_port(ui_tree(ui_node("n0.0", text="스터디룸 2C"),
                             ui_node("n0.1", text="초기화", clickable=True)))
    value = step(selector={"text": "스터디룸 2C"}, package_name="com.ssutoday")
    assert port.execute(value, definition(value))["skipped"] is True
    port.service.controller.tap.assert_not_called()
    wrong_room = step(selector={"text": "스터디룸 2A"}, package_name="com.ssutoday")
    with pytest.raises(SequenceTargetPending):
        port.execute(wrong_room, definition(wrong_room))
    port.service.controller.tap.assert_not_called()


def test_cancelled_scroll_stops_the_batch_before_any_slot_click(monkeypatch):
    ticks = count(0, .1)
    monkeypatch.setattr("tapbot.android.sequence.monotonic", lambda: next(ticks))
    monkeypatch.setattr("tapbot.android.sequence.sleep", lambda seconds: None)
    port = make_port(timeline_tree(), native=True)
    port.service.controller.swipe.return_value = SimpleNamespace(state="cancelled")
    value = step(selector={"time_slot": "13:30"})
    with pytest.raises(RuntimeError, match="불확실"):
        port.execute(value, definition(value))
    port.service.controller.swipe.assert_called_once()
    port.service.controller.tap.assert_not_called()
