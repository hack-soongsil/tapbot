"""Deterministic ports and accessibility snapshots for sequence tests."""

from threading import Event

from tapbot.android.client import AndroidUiBounds, AndroidUiNode, AndroidUiTree
from tapbot.macro.sequence import SequenceTargetPending


class RecordingSequencePort:
    def __init__(self, *, error=None, checkpoint=False, pending=False):
        self.calls = []
        self.error = error
        self.checkpoint = checkpoint
        self.pending = pending
        self.entered = Event()

    def prepare(self, definition):
        pass

    def execute(self, step, definition):
        self.calls.append(step.id)
        self.entered.set()
        if self.error:
            raise self.error
        return {"awaiting_user": self.checkpoint and step.kind == "checkpoint", "pending_confirmation": self.pending}


class DeferredSequencePort(RecordingSequencePort):
    def __init__(self):
        super().__init__()
        self.ready = Event()
        self.attempts = 0

    def execute(self, step, definition):
        self.attempts += 1
        self.entered.set()
        if not self.ready.is_set():
            raise SequenceTargetPending("Next screen is loading")
        return super().execute(step, definition)


def ui_node(node_id="n0", **overrides):
    values = dict(node_id=node_id, parent_id=None, depth=node_id.count("."),
                  class_name="android.widget.Button", text=None, content_description=None,
                  view_id_resource_name=None, package_name="com.ssutoday",
                  bounds=AndroidUiBounds(0, 0, 1080, 2400), clickable=False,
                  enabled=True, focusable=False, focused=False, selected=False,
                  checked=False, checkable=False, scrollable=False, editable=False,
                  visible_to_user=True, password=False, child_count=0)
    return AndroidUiNode(**(values | overrides))


def ui_tree(*nodes, **overrides):
    root = ui_node()
    values = dict(request_id="tree", captured_at="2026-10-10T00:00:00Z",
                  package_name="com.ssutoday", window_title=None, rotation=0,
                  screen_width=1080, screen_height=2400, root=root,
                  nodes=(root, *nodes), truncated=False)
    return AndroidUiTree(**(values | overrides))


class SnapshotQueue:
    def __init__(self, *trees):
        self.trees = list(trees)
        self.invalidated = 0

    def snapshot(self, *, max_age_ms=0):
        assert max_age_ms == 0
        if len(self.trees) > 1:
            value = self.trees.pop(0)
        else:
            value = self.trees[0]
        if isinstance(value, Exception):
            raise value
        return value

    def invalidate(self):
        self.invalidated += 1
