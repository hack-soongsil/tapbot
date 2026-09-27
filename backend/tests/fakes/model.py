"""Test-only deterministic model client."""

from collections.abc import Callable
import logging

import numpy as np
from numpy.typing import NDArray

from tapbot.model.client import ModelContext, RawDecision
from tapbot.model.decision import Decision, DecisionParser


logger = logging.getLogger(__name__)


class StubModelClient:
    def __init__(
        self,
        response: RawDecision
        | Callable[[NDArray[np.uint8], ModelContext], RawDecision],
        *,
        provider: str = "test",
        model_name: str = "stub-model",
    ) -> None:
        self._response = response
        self._parser = DecisionParser()
        self.provider = provider
        self.model_name = model_name
        self.connected = True
        self.last_raw_response: RawDecision | None = None
        self.calls: list[tuple[NDArray[np.uint8], dict[str, object]]] = []

    def analyze(
        self,
        image: NDArray[np.uint8],
        context: ModelContext,
    ) -> Decision:
        self.calls.append((image.copy(), dict(context)))
        raw = self._response(image, context) if callable(self._response) else self._response
        self.last_raw_response = raw
        logger.info("Model response: %s", raw)
        decision = self._parser.parse(raw)
        logger.info("Decision parser result: %s", decision.to_dict())
        return decision
