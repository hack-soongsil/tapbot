"""Structured UI recognition providers and resolvers."""

from tapbot.ui_resolution.accessibility import (
    AccessibilityUiResolver,
    AccessibilityStateClassifier,
    AccessibilityStateRule,
    AndroidAccessibilityUiTreeProvider,
)
from tapbot.ui_resolution.models import (
    AmbiguousUiElementError,
    ResolvedUiElement,
    StructuredStateClassification,
    UiResolutionResult,
    UiSelector,
    UiTreeProvider,
)
from tapbot.ui_resolution.resolver import HybridTargetResolver
from tapbot.ui_resolution.visual import ResolvedTarget, TargetResolver

__all__ = [
    "AccessibilityUiResolver",
    "AccessibilityStateClassifier",
    "AccessibilityStateRule",
    "AmbiguousUiElementError",
    "AndroidAccessibilityUiTreeProvider",
    "HybridTargetResolver",
    "ResolvedTarget",
    "ResolvedUiElement",
    "StructuredStateClassification",
    "UiResolutionResult",
    "UiSelector",
    "UiTreeProvider",
    "TargetResolver",
]
