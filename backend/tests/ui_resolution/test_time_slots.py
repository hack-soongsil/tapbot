import pytest

from tapbot.android.client import AndroidUiBounds
from tapbot.ui_resolution.time_slots import find_time_slot, plan_time_slot_scrolls
from tests.fakes.sequence import ui_node, ui_tree


def timeline():
    buttons = [ui_node(f"n0.0.{index}", parent_id="n0.0", clickable=True) for index in range(32)]
    labels = [ui_node(f"n0.0.{32 + index}", parent_id="n0.0", text=f"{6 + index:02}:00") for index in range(16)]
    return ui_tree(*buttons, *labels)


def test_half_hour_time_slots_are_resolved_only_in_matching_contract():
    tree = timeline()
    assert find_time_slot(tree, "12:00")[0].node_id == "n0.0.12"
    assert find_time_slot(tree, "13:30")[0].node_id == "n0.0.15"
    assert find_time_slot(tree, "21:30")[0].node_id == "n0.0.31"
    with pytest.raises(ValueError):
        find_time_slot(ui_tree(*tree.nodes[1:], package_name="another.app"), "12:00")
    with pytest.raises(ValueError):
        find_time_slot(ui_tree(*tree.nodes[1:-1]), "12:00")


@pytest.mark.parametrize("target_index, count", [(5, 1), (12, 2), (31, 3)])
def test_scroll_plan_uses_measured_spacing_and_caps_each_batch(target_index, count):
    slots = tuple(ui_node(f"n0.{index}", clickable=True, visible_to_user=index < 5,
                          bounds=AndroidUiBounds(66 + index * 186, 1314, 240 + index * 186, 1437))
                  for index in range(32))
    tree = ui_tree(*slots)
    moves = plan_time_slot_scrolls(tree, slots[target_index], slots)
    assert len(moves) == count
    assert all(162 <= end_x < start_x <= 918 and start_y == end_y == 1375.5
               for start_x, start_y, end_x, end_y in moves)
    if target_index == 5:
        assert moves[0][0] - moves[0][2] == 186


def test_scroll_plan_can_return_to_an_earlier_slot():
    slots = tuple(ui_node(f"n0.{index}", clickable=True, visible_to_user=index >= 27,
                          bounds=AndroidUiBounds(66 + (index-27) * 186, 1314, 240 + (index-27) * 186, 1437))
                  for index in range(32))
    moves = plan_time_slot_scrolls(ui_tree(*slots), slots[26], slots)
    assert moves == ((162, 1375.5, 348, 1375.5),)
