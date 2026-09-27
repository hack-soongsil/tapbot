"""Android Agent transport, screenshots, UI input, and device registry."""

from tapbot.android.client import (
    AndroidActionResult,
    AndroidAgentApiError,
    AndroidAgentClient,
    AndroidAgentTransportError,
    AndroidScreenshot,
    AndroidUiBounds,
    AndroidUiNode,
    AndroidUiTree,
)
from tapbot.android.controller import AndroidRemoteController
from tapbot.android.geometry import ScreenGeometry, ScreenInsets
from tapbot.android.gesture import (
    PointerGesture,
    PointerGestureBoundsError,
    PointerPoint,
)
from tapbot.android.input import (
    AndroidInputCapabilityError,
    AndroidInputController,
    AndroidInputResult,
)
from tapbot.android.screen import ScreenFrame, ScreenReadError, ScreenSource
from tapbot.android.screen_source import AndroidRemoteScreenSource

__all__ = [
    "AndroidActionResult",
    "AndroidAgentApiError",
    "AndroidAgentClient",
    "AndroidAgentTransportError",
    "AndroidInputCapabilityError",
    "AndroidInputController",
    "AndroidInputResult",
    "AndroidRemoteController",
    "AndroidRemoteScreenSource",
    "AndroidScreenshot",
    "AndroidUiBounds",
    "AndroidUiNode",
    "AndroidUiTree",
    "PointerGesture",
    "PointerGestureBoundsError",
    "PointerPoint",
    "ScreenFrame",
    "ScreenGeometry",
    "ScreenInsets",
    "ScreenReadError",
    "ScreenSource",
]
