import pytest

from tapbot.android.models import DiscoveredPeer
from tapbot.android.probe import TapBotAgentProbe


def valid_status() -> dict[str, object]:
    return {
        "ok": True,
        "request_id": "request-1",
        "agent_version": "0.3.0",
        "coordinate_mapping": "screenshot_px_equals_logical_screen_px",
        "server_port": 8765,
        "capture_ready": True,
        "accessibility_enabled": True,
        "remote_control_enabled": True,
        "stream_running": True,
        "device": {"width": 1080, "height": 2400, "rotation": 0},
    }


def peer(*, online: bool = True) -> DiscoveredPeer:
    return DiscoveredPeer(
        "phone-id",
        "galaxy",
        "galaxy.example.ts.net",
        ("100.64.0.20",),
        online,
    )


def test_valid_tapbot_agent_probe_uses_authenticated_canonical_status() -> None:
    calls: list[tuple[str, str, float]] = []

    def fetch(endpoint: str, token: str, timeout: float) -> dict[str, object]:
        calls.append((endpoint, token, timeout))
        return valid_status()

    result = TapBotAgentProbe(timeout_sec=1.5, fetch_status=fetch).probe(
        peer(),
        "secret",
    )

    assert result is not None
    assert result.endpoint == "http://100.64.0.20:8765"
    assert calls[0][0:2] == ("http://100.64.0.20:8765", "secret")
    assert calls[0][2] == pytest.approx(1.5, abs=0.01)


def test_non_tapbot_http_service_is_rejected() -> None:
    probe = TapBotAgentProbe(fetch_status=lambda *_: {"ok": True, "service": "other"})

    assert probe.probe(peer(), "secret") is None


def test_timeout_and_offline_peer_are_not_agents() -> None:
    calls = 0

    def timeout(*args: object) -> dict[str, object]:
        nonlocal calls
        calls += 1
        raise TimeoutError

    probe = TapBotAgentProbe(fetch_status=timeout)

    assert probe.probe(peer(), "secret") is None
    attempted_online_hosts = calls
    assert attempted_online_hosts == 2
    assert probe.probe(peer(online=False), "secret") is None
    assert calls == attempted_online_hosts
