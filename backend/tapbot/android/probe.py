"""Conservative HTTP identification of TapBot Android Agents."""

from __future__ import annotations

from collections.abc import Callable, Mapping
import ipaddress
from time import monotonic
from typing import Any

from tapbot.android.client import AndroidAgentClient
from tapbot.android.models import DiscoveredAndroidAgent, DiscoveredPeer


StatusFetcher = Callable[[str, str, float], Mapping[str, Any]]


class TapBotAgentProbe:
    """Probe only the canonical status endpoint on one known tailnet peer."""

    def __init__(
        self,
        *,
        port: int = 8765,
        timeout_sec: float = 2.0,
        fetch_status: StatusFetcher | None = None,
    ) -> None:
        if not 1 <= port <= 65535:
            raise ValueError("Android Agent port must be between 1 and 65535")
        if timeout_sec <= 0:
            raise ValueError("probe timeout must be positive")
        self.port = port
        self.timeout_sec = timeout_sec
        self._fetch_status = fetch_status or _fetch_status

    def probe(
        self,
        peer: DiscoveredPeer,
        token: str,
    ) -> DiscoveredAndroidAgent | None:
        if not peer.online or not token:
            return None
        deadline = monotonic() + self.timeout_sec
        for host in peer.connection_hosts:
            remaining = deadline - monotonic()
            if remaining <= 0:
                return None
            endpoint = _endpoint(host, self.port)
            try:
                status = self._fetch_status(endpoint, token, remaining)
            except Exception:
                # Discovery/status requests are safe to retry on the next refresh.
                # Input actions continue to use the no-retry AndroidAgentClient path.
                continue
            if _is_tapbot_status(status, expected_port=self.port):
                return DiscoveredAndroidAgent(peer, endpoint, dict(status))
        return None


def _fetch_status(
    endpoint: str,
    token: str,
    timeout_sec: float,
) -> Mapping[str, Any]:
    return AndroidAgentClient(endpoint, token, timeout=timeout_sec).status()


def _endpoint(host: str, port: int) -> str:
    try:
        parsed = ipaddress.ip_address(host)
    except ValueError:
        formatted = host.rstrip(".")
    else:
        formatted = f"[{parsed}]" if parsed.version == 6 else str(parsed)
    return f"http://{formatted}:{port}"


def _is_tapbot_status(
    value: Mapping[str, Any],
    *,
    expected_port: int,
) -> bool:
    device = value.get("device")
    return (
        value.get("ok") is True
        and isinstance(value.get("agent_version"), str)
        and bool(str(value["agent_version"]).strip())
        and value.get("coordinate_mapping")
        == "screenshot_px_equals_logical_screen_px"
        and value.get("server_port") == expected_port
        and isinstance(value.get("capture_ready"), bool)
        and isinstance(value.get("accessibility_enabled"), bool)
        and isinstance(device, Mapping)
        and _positive_int(device.get("width"))
        and _positive_int(device.get("height"))
    )


def _positive_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0
