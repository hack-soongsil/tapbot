"""Screen renderer dispatcher."""

from __future__ import annotations

import numpy as np

from .interactions import MockSnapshot
from .render_detail import render_detail
from .render_home import render_home
from .render_success import render_success


def render_screen(snapshot: MockSnapshot) -> np.ndarray:
    if snapshot.screen == "home":
        return render_home(snapshot)
    if snapshot.screen == "success":
        return render_success(snapshot)
    return render_detail(snapshot, confirm=snapshot.screen == "confirm")
