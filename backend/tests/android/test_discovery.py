import json
import subprocess

import pytest

from tapbot.android.discovery import (
    AndroidDiscoveryService,
    TailscaleDiscoveryError,
    TailscalePeerProvider,
    TailscaleStatusParseError,
    parse_tailscale_status,
)
from tapbot.android.models import DiscoveredAndroidAgent, DiscoveredPeer
from tapbot.events import EventLog


def status_document() -> dict[str, object]:
    return {
        "BackendState": "Running",
        "Self": {
            "ID": "self-id",
            "TailscaleIPs": ["100.64.0.1"],
        },
        "Peer": {
            "nodekey:self": {
                "ID": "self-id",
                "HostName": "backend",
                "TailscaleIPs": ["100.64.0.1"],
                "Online": True,
            },
            "nodekey:phone": {
                "ID": "phone-id",
                "HostName": "galaxy-s21",
                "DNSName": "galaxy-s21.example.ts.net.",
                "TailscaleIPs": ["100.64.0.20", "fd7a:115c:a1e0::20"],
                "Online": True,
            },
            "nodekey:offline": {
                "ID": "offline-id",
                "HostName": "old-phone",
                "TailscaleIPs": ["100.64.0.21"],
                "Online": False,
            },
        },
    }


def test_tailscale_status_json_parses_online_offline_and_excludes_self() -> None:
    peers = parse_tailscale_status(json.dumps(status_document()))

    assert {peer.stable_identity for peer in peers} == {"phone-id", "offline-id"}
    phone = next(peer for peer in peers if peer.stable_identity == "phone-id")
    offline = next(peer for peer in peers if peer.stable_identity == "offline-id")
    assert phone.online is True
    assert phone.display_name == "galaxy-s21.example.ts.net"
    assert phone.connection_hosts == (
        "100.64.0.20",
        "galaxy-s21.example.ts.net",
        "fd7a:115c:a1e0::20",
    )
    assert offline.online is False


def test_tailscale_status_accepts_zero_peers_and_rejects_malformed_json() -> None:
    assert parse_tailscale_status('{"BackendState":"Running","Peer":{}}') == ()
    with pytest.raises(TailscaleStatusParseError, match="malformed JSON"):
        parse_tailscale_status("not-json")
    with pytest.raises(TailscaleStatusParseError, match="Peer"):
        parse_tailscale_status({"Peer": "unexpected"})


def test_tailscale_provider_handles_missing_cli_command_failure_and_logout() -> None:
    def missing(*args: object, **kwargs: object):
        raise FileNotFoundError

    with pytest.raises(TailscaleDiscoveryError, match="not installed"):
        TailscalePeerProvider(runner=missing).peers()

    def failed(*args: object, **kwargs: object):
        return subprocess.CompletedProcess(args=[], returncode=7, stdout="", stderr="private")

    with pytest.raises(TailscaleDiscoveryError, match="exit code 7") as failure:
        TailscalePeerProvider(runner=failed).peers()
    assert "private" not in str(failure.value)

    def logged_out(*args: object, **kwargs: object):
        return subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout='{"BackendState":"NeedsLogin","Peer":{}}',
            stderr="",
        )

    with pytest.raises(TailscaleDiscoveryError, match="not connected"):
        TailscalePeerProvider(runner=logged_out).peers()


class RecordingRegistry:
    def __init__(self) -> None:
        self.merges: list[tuple[tuple[DiscoveredAndroidAgent, ...], str]] = []

    def merge_discovered(
        self,
        agents: tuple[DiscoveredAndroidAgent, ...],
        *,
        token: str,
    ) -> list[dict[str, object]]:
        self.merges.append((agents, token))
        return []


class StaticProvider:
    def __init__(self, peers: tuple[DiscoveredPeer, ...]) -> None:
        self._peers = peers

    def peers(self) -> tuple[DiscoveredPeer, ...]:
        return self._peers


class RecordingProbe:
    def __init__(self) -> None:
        self.probed: list[str] = []

    def probe(
        self,
        peer: DiscoveredPeer,
        token: str,
    ) -> DiscoveredAndroidAgent:
        self.probed.append(peer.stable_identity)
        return DiscoveredAndroidAgent(peer, "http://100.64.0.20:8765", {"ok": True})


def test_discovery_service_probes_only_online_peers_and_reports_counts() -> None:
    online = DiscoveredPeer("phone", "phone", None, ("100.64.0.20",), True)
    offline = DiscoveredPeer("offline", "old", None, ("100.64.0.21",), False)
    registry = RecordingRegistry()
    probe = RecordingProbe()
    service = AndroidDiscoveryService(
        registry,  # type: ignore[arg-type]
        EventLog(),
        enabled=True,
        provider_name="tailscale",
        peer_provider=StaticProvider((online, offline)),
        probe=probe,
        token="secret",
    )

    status = service.refresh()

    assert probe.probed == ["phone"]
    assert len(registry.merges) == 1
    assert registry.merges[0][1] == "secret"
    assert status["tailscale_available"] is True
    assert status["discovered_peer_count"] == 2
    assert status["discovered_agent_count"] == 1
    assert status["last_error"] is None


def test_discovery_without_token_is_available_but_does_not_probe() -> None:
    peer = DiscoveredPeer("phone", "phone", None, ("100.64.0.20",), True)
    probe = RecordingProbe()
    service = AndroidDiscoveryService(
        RecordingRegistry(),  # type: ignore[arg-type]
        EventLog(),
        enabled=True,
        provider_name="tailscale",
        peer_provider=StaticProvider((peer,)),
        probe=probe,
        token=None,
    )

    status = service.refresh()

    assert probe.probed == []
    assert status["tailscale_available"] is True
    assert status["last_error"] == "TAPBOT_ANDROID_AGENT_TOKEN is required for discovery"
