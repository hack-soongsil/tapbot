"""Transport-independent facade for configured model analysis."""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np
from numpy.typing import NDArray

from tapbot.model.client import ModelClient
from tapbot.model.decision import Decision


class ModelService:
    def __init__(self, client: ModelClient) -> None:
        self.client = client

    def analyze(
        self,
        image: NDArray[np.uint8],
        context: Mapping[str, object] | None = None,
    ) -> Decision:
        return self.client.analyze(image, dict(context or {}))
