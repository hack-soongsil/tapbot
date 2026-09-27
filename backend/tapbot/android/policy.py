"""Default Android classification and accessibility selector policy."""

from __future__ import annotations

from tapbot.macro import (
    DetectionStateClassifier,
    DetectionStateRule,
    MacroStateMachine,
    TapTargetAction,
)
from tapbot.ui_resolution import (
    AccessibilityStateClassifier,
    AccessibilityStateRule,
    UiSelector,
)


def default_classifier() -> DetectionStateClassifier:
    return DetectionStateClassifier(
        (
            DetectionStateRule("home", frozenset({"reservation_button"})),
            DetectionStateRule("reservation", frozenset({"verify_photo_button"})),
            DetectionStateRule("verify_photo", frozenset({"home_button"})),
            DetectionStateRule("confirmation", frozenset({"confirm_button"})),
        )
    )


def default_state_machine() -> MacroStateMachine:
    return MacroStateMachine(
        {
            "home": TapTargetAction("reservation_button"),
            "reservation": TapTargetAction("verify_photo_button"),
            "confirmation": TapTargetAction("confirm_button"),
        },
        terminal_states=("verify_photo",),
    )


def default_ui_selectors() -> dict[str, tuple[UiSelector, ...]]:
    return {
        "reservation_button": (UiSelector(text_contains="예약", clickable=True),),
        "verify_photo_button": (UiSelector(text="사진 인증", clickable=True),),
        "confirm_button": (UiSelector(text="확인", clickable=True),),
        "home_button": (
            UiSelector(content_description="홈", clickable=True),
            UiSelector(text="홈", clickable=True),
        ),
    }


def default_ui_state_classifier() -> AccessibilityStateClassifier:
    selectors = default_ui_selectors()
    return AccessibilityStateClassifier(
        (
            AccessibilityStateRule("home", selectors["reservation_button"]),
            AccessibilityStateRule("reservation", selectors["verify_photo_button"]),
            AccessibilityStateRule("verify_photo", selectors["home_button"]),
            AccessibilityStateRule("confirmation", selectors["confirm_button"]),
        )
    )
