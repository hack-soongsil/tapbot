"""Model client interface and tracing wrapper."""

from __future__ import annotations

import base64
from collections.abc import Mapping
import json
from time import perf_counter
from typing import Protocol, TypeAlias
from urllib import request

import cv2
import numpy as np
from numpy.typing import NDArray

from tapbot.model.decision import Decision, DecisionParser


ModelContext: TypeAlias = Mapping[str, object]
RawDecision: TypeAlias = str | bytes | dict[str, object] | Decision


class ModelClient(Protocol):
    """Local-model interface consumed by the decision engine."""

    def analyze(
        self,
        image: NDArray[np.uint8],
        context: ModelContext,
    ) -> Decision: ...


class TracingModelClient:
    """Capture debug metadata around a ModelClient without changing its contract."""

    def __init__(self, client: ModelClient) -> None:
        self.client = client
        self.provider = str(getattr(client, "provider", type(client).__name__))
        self.model_name = str(getattr(client, "model_name", type(client).__name__))
        self.last_latency_ms: float | None = None
        self.last_raw_response: RawDecision | None = None

    @property
    def connected(self) -> bool:
        return bool(getattr(self.client, "connected", True))

    def analyze(
        self,
        image: NDArray[np.uint8],
        context: ModelContext,
    ) -> Decision:
        started_at = perf_counter()
        try:
            decision = self.client.analyze(image, context)
            self.last_raw_response = getattr(
                self.client, "last_raw_response", decision
            )
            return decision
        except Exception:
            self.last_raw_response = getattr(
                self.client, "last_raw_response", None
            )
            raise
        finally:
            self.last_latency_ms = (perf_counter() - started_at) * 1000


class HttpModelClient:
    """Minimal JSON/HTTP model client configured only by the composition root."""

    provider = "http"

    def __init__(
        self,
        endpoint: str,
        *,
        model_name: str | None = None,
        api_token: str | None = None,
        timeout_s: float = 30.0,
    ) -> None:
        if not endpoint.strip():
            raise ValueError("model endpoint must not be empty")
        self.endpoint = endpoint
        self.model_name = model_name or "default"
        self._api_token = api_token
        self.timeout_s = timeout_s
        self._parser = DecisionParser()

    @property
    def connected(self) -> bool:
        return True

    def analyze(self, image: NDArray[np.uint8], context: ModelContext) -> Decision:
        ok, encoded = cv2.imencode(".jpg", image)
        if not ok:
            raise ValueError("Could not encode model input image")
        payload = json.dumps(
            {
                "model": self.model_name,
                "image_base64": base64.b64encode(encoded.tobytes()).decode("ascii"),
                "context": dict(context),
            }
        ).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self._api_token is not None:
            headers["Authorization"] = f"Bearer {self._api_token}"
        model_request = request.Request(
            self.endpoint,
            data=payload,
            headers=headers,
            method="POST",
        )
        with request.urlopen(model_request, timeout=self.timeout_s) as response:
            document = json.loads(response.read().decode("utf-8"))
        raw = document.get("decision", document) if isinstance(document, dict) else document
        return self._parser.parse(raw)
