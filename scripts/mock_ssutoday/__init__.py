"""High-fidelity, deterministic SSUTODAY Android mock implementation."""

from .fixtures import HEIGHT, WIDTH
from .interactions import MockSsutodayState
from .render import render_screen
from .ui_tree import build_ui_tree

__all__ = ["HEIGHT", "WIDTH", "MockSsutodayState", "build_ui_tree", "render_screen"]
