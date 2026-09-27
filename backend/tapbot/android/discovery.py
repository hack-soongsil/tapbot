"""Tailscale peer discovery and bounded Android Agent probing."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import ipaddress
import json
import subprocess
from threading import Event, Lock, Thread
from typing import Any, Protocol

from tapbot.android.device_registry import AndroidDeviceRegistry
from tapbot.android.models import (
    AndroidDiscoveryStatus,
    DiscoveredAndroidAgent,
    DiscoveredPeer,
)
from tapbot.android.probe import TapBotAgentProbe
from tapbot.events import EventLog


class PeerProvider(Protocol):
    def peers(self) -> tuple[DiscoveredPeer, ...]: ...


class AgentProbe(Protocol):
    def probe(
        self,
        peer: DiscoveredPeer,
        token: str,
    ) -> DiscoveredAndroidAgent | None: ...


class TailscaleDiscoveryError(RuntimeError):
    def __init__(self, message: str, *, tailscale_available: bool) -> None:
        super().__init__(message)
        self.tailscale_available = tailscale_available


class TailscaleStatusParseError(TailscaleDiscoveryError):
    def __init__(self, message: str) -> None:
        super().__init__(message, tailscale_available=True)


CommandRunner = Callable[..., subprocess.CompletedProcess[str]]


class TailscalePeerProvider:
    """Read peers from the local Tailscale CLI without retaining raw output."""

    def __init__(
        self,
        *,
        timeout_sec: float = 2.0,
        command: Sequence[str] = ("tailscale", "status", "--json"),
        runner: CommandRunner = subprocess.run,
    ) -> None:
        if timeout_sec <= 0:
            raise ValueError("Tailscale discovery timeout must be positive")
        if not command:
            raise ValueError("Tailscale command must not be empty")
        self.timeout_sec = timeout_sec
        self.command = tuple(command)
        self._runner = runner

    def peers(self) -> tuple[DiscoveredPeer, ...]:
        try:
            result = self._runner(
                self.command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=self.timeout_sec,
                check=False,
            )
        except FileNotFoundError as error:
            raise TailscaleDiscoveryError(
                "Tailscale CLI is not installed",
                tailscale_available=False,
            ) from error
        except subprocess.TimeoutExpired as error:
            raise TailscaleDiscoveryError(
                "Tailscale status command timed out",
                tailscale_available=False,
            ) from error
        except OSError as error:
            raise TailscaleDiscoveryError(
                "Tailscale status command could not be started",
                tailscale_available=False,
            ) from error
        if result.returncode != 0:
            raise TailscaleDiscoveryError(
                f"Tailscale status command failed with exit code {result.returncode}",
                tailscale_available=False,
            )
        document = _load_status_document(result.stdout)
        backend_state = document.get("BackendState")
        if isinstance(backend_state, str) and backend_state.lower() != "running":
            raise TailscaleDiscoveryError(
                "Tailscale is not connected to a tailnet",
                tailscale_available=False,
            )
        return parse_tailscale_status(document)


def parse_tailscale_status(
    value: str | Mapping[str, Any],
) -> tuple[DiscoveredPeer, ...]:
    """Parse the unstable CLI schema behind one narrow, tested boundary."""

    document = _load_status_document(value) if isinstance(value, str) else value
    if not isinstance(document, Mapping):
        raise TailscaleStatusParseError("Tailscale status must be a JSON object")
    raw_peers = document.get("Peer", {})
    if isinstance(raw_peers, Mapping):
        entries = tuple(raw_peers.items())
    elif isinstance(raw_peers, list):
        entries = tuple((str(index), item) for index, item in enumerate(raw_peers))
    else:
        raise TailscaleStatusParseError("Tailscale status Peer must be an object or list")

    local_ids, local_addresses = _local_identity(document.get("Self"))
    peers: list[DiscoveredPeer] = []
    seen: set[str] = set()
    for key, raw in entries:
        if not isinstance(raw, Mapping):
            continue
        stable_identity = _stable_identity(raw, fallback=str(key))
        addresses = _addresses(raw.get("TailscaleIPs"))
        if (
            stable_identity in local_ids
            or bool(set(addresses) & local_addresses)
            or stable_identity in seen
        ):
            continue
        dns_name = _optional_text(raw.get("DNSName"))
        host_name = _optional_text(raw.get("HostName"))
        if not addresses and dns_name is None:
            continue
        seen.add(stable_identity)
        peers.append(
            DiscoveredPeer(
                stable_identity=stable_identity,
                host_name=host_name,
                dns_name=None if dns_name is None else dns_name.rstrip("."),
                addresses=addresses,
                online=raw.get("Online") is True,
            )
        )
    peers.sort(key=lambda item: (item.display_name.lower(), item.stable_identity))
    return tuple(peers)


class AndroidDiscoveryService:
    """Refresh Tailscale discovery without owning Android device resources."""

    def __init__(
        self,
        registry: AndroidDeviceRegistry,
        event_log: EventLog,
        *,
        enabled: bool,
        provider_name: str,
        peer_provider: PeerProvider,
        probe: AgentProbe,
        token: str | None,
        interval_sec: float = 30.0,
        max_concurrency: int = 8,
    ) -> None:
        if interval_sec <= 0:
            raise ValueError("discovery interval must be positive")
        if not 1 <= max_concurrency <= 64:
            raise ValueError("discovery max_concurrency must be between 1 and 64")
        self.registry = registry
        self.event_log = event_log
        self.enabled = enabled
        self.provider_name = provider_name
        self.peer_provider = peer_provider
        self.probe = probe
        self._token = token
        self.interval_sec = interval_sec
        self.max_concurrency = max_concurrency
        self._state_lock = Lock()
        self._refresh_lock = Lock()
        self._stop = Event()
        self._thread: Thread | None = None
        self._status = AndroidDiscoveryStatus(
            enabled=enabled,
            provider=provider_name,
            tailscale_available=False,
            last_refresh=None,
            discovered_peer_count=0,
            discovered_agent_count=0,
            last_error=None if enabled else "Android discovery is disabled",
        )

    def start(self) -> None:
        if not self.enabled or (self._thread is not None and self._thread.is_alive()):
            return
        self._stop.clear()
        self._thread = Thread(
            target=self._run,
            name="tapbot-android-discovery",
            daemon=True,
        )
        self._thread.start()

    def stop(self, *, timeout: float = 3.0) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout)
        self._thread = None

    def status(self) -> dict[str, object]:
        with self._state_lock:
            return self._status.to_dict()

    def refresh(self) -> dict[str, object]:
        if not self.enabled:
            return self.status()
        with self._refresh_lock:
            refreshed_at = _now()
            try:
                peers = self.peer_provider.peers()
            except TailscaleDiscoveryError as error:
                self._set_status(
                    tailscale_available=error.tailscale_available,
                    last_refresh=refreshed_at,
                    peer_count=0,
                    agent_count=0,
                    error=str(error),
                )
                return self.status()
            except Exception:
                self._set_status(
                    tailscale_available=False,
                    last_refresh=refreshed_at,
                    peer_count=0,
                    agent_count=0,
                    error="Tailscale discovery failed unexpectedly",
                )
                return self.status()

            if not self._token:
                self._set_status(
                    tailscale_available=True,
                    last_refresh=refreshed_at,
                    peer_count=len(peers),
                    agent_count=0,
                    error="TAPBOT_ANDROID_AGENT_TOKEN is required for discovery",
                )
                return self.status()

            online = tuple(peer for peer in peers if peer.online)
            agents = self._probe_all(online)
            self.registry.merge_discovered(agents, token=self._token)
            self._set_status(
                tailscale_available=True,
                last_refresh=refreshed_at,
                peer_count=len(peers),
                agent_count=len(agents),
                error=None,
            )
            self.event_log.add(
                f"Android discovery refreshed: {len(agents)} agent(s)",
                event_type="android.discovery.refreshed",
                category="android",
                status="success",
                payload={
                    "peer_count": len(peers),
                    "agent_count": len(agents),
                },
            )
            return self.status()

    def _probe_all(
        self,
        peers: tuple[DiscoveredPeer, ...],
    ) -> tuple[DiscoveredAndroidAgent, ...]:
        if not peers or self._token is None or self._stop.is_set():
            return ()
        agents: list[DiscoveredAndroidAgent] = []
        pool = ThreadPoolExecutor(
            max_workers=min(self.max_concurrency, len(peers)),
            thread_name_prefix="android-discovery-probe",
        )
        try:
            futures = {
                pool.submit(self.probe.probe, peer, self._token): peer
                for peer in peers
            }
            for future in as_completed(futures):
                if self._stop.is_set():
                    break
                try:
                    agent = future.result()
                except Exception:
                    agent = None
                if agent is not None:
                    agents.append(agent)
        finally:
            pool.shutdown(
                wait=not self._stop.is_set(),
                cancel_futures=self._stop.is_set(),
            )
        agents.sort(key=lambda item: item.peer.stable_identity)
        return tuple(agents)

    def _set_status(
        self,
        *,
        tailscale_available: bool,
        last_refresh: str,
        peer_count: int,
        agent_count: int,
        error: str | None,
    ) -> None:
        with self._state_lock:
            self._status = AndroidDiscoveryStatus(
                enabled=self.enabled,
                provider=self.provider_name,
                tailscale_available=tailscale_available,
                last_refresh=last_refresh,
                discovered_peer_count=peer_count,
                discovered_agent_count=agent_count,
                last_error=error,
            )

    def _run(self) -> None:
        while not self._stop.is_set():
            self.refresh()
            if self._stop.wait(self.interval_sec):
                return


def _load_status_document(value: str) -> Mapping[str, Any]:
    try:
        document = json.loads(value)
    except (TypeError, json.JSONDecodeError) as error:
        raise TailscaleStatusParseError("Tailscale status returned malformed JSON") from error
    if not isinstance(document, Mapping):
        raise TailscaleStatusParseError("Tailscale status must be a JSON object")
    return document


def _stable_identity(value: Mapping[str, Any], *, fallback: str) -> str:
    for key in ("ID", "NodeID", "PublicKey"):
        candidate = value.get(key)
        if isinstance(candidate, (str, int)) and str(candidate).strip():
            return str(candidate).strip()
    return fallback


def _addresses(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    addresses: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        try:
            address = str(ipaddress.ip_address(item))
        except ValueError:
            continue
        addresses.append(address)
    return tuple(dict.fromkeys(addresses))


def _local_identity(value: object) -> tuple[set[str], set[str]]:
    if not isinstance(value, Mapping):
        return set(), set()
    identities = {
        str(candidate).strip()
        for key in ("ID", "NodeID", "PublicKey")
        if isinstance((candidate := value.get(key)), (str, int))
        and str(candidate).strip()
    }
    return identities, set(_addresses(value.get("TailscaleIPs")))


def _optional_text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
