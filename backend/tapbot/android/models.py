"""Transport-neutral Android domain models."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import ipaddress
import re
from typing import Any, Mapping


_DEVICE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class DeviceSource(str, Enum):
    MANUAL = "manual"
    TAILSCALE = "tailscale"


class DeviceConnectionState(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    STALE = "stale"


@dataclass(frozen=True, slots=True)
class AndroidDeviceConfig:
    id: str
    name: str
    base_url: str
    token: str = field(repr=False)
    enabled: bool = True
    source: DeviceSource = DeviceSource.MANUAL
    stable_identity: str | None = None

    def __post_init__(self) -> None:
        if not _DEVICE_ID.fullmatch(self.id):
            raise ValueError(
                "Android device id must start with a lowercase letter or digit and "
                "contain only lowercase letters, digits, '-' or '_'"
            )
        if not self.name.strip():
            raise ValueError(f"Android device {self.id!r} has an empty name")
        if not self.base_url.strip():
            raise ValueError(f"Android device {self.id!r} has an empty base_url")
        if not self.token.strip():
            raise ValueError(f"Android device {self.id!r} has an empty token")
        if self.source is DeviceSource.TAILSCALE and not self.stable_identity:
            raise ValueError("Tailscale devices require a stable identity")


@dataclass(frozen=True, slots=True)
class DiscoveredPeer:
    stable_identity: str
    host_name: str | None
    dns_name: str | None
    addresses: tuple[str, ...]
    online: bool

    def __post_init__(self) -> None:
        if not self.stable_identity:
            raise ValueError("peer stable_identity must not be empty")
        if not self.addresses and not self.dns_name:
            raise ValueError("peer requires an IP address or DNS name")

    @property
    def display_name(self) -> str:
        return self.dns_name or self.host_name or self.addresses[0]

    @property
    def connection_hosts(self) -> tuple[str, ...]:
        ipv4: list[str] = []
        other: list[str] = []
        for address in self.addresses:
            try:
                parsed = ipaddress.ip_address(address)
            except ValueError:
                continue
            (ipv4 if parsed.version == 4 else other).append(str(parsed))
        ordered = [*ipv4]
        if self.dns_name:
            ordered.append(self.dns_name.rstrip("."))
        ordered.extend(other)
        return tuple(dict.fromkeys(ordered))


@dataclass(frozen=True, slots=True)
class DiscoveredAndroidAgent:
    peer: DiscoveredPeer
    endpoint: str
    status: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class AndroidDiscoveryStatus:
    enabled: bool
    provider: str
    tailscale_available: bool
    last_refresh: str | None
    discovered_peer_count: int
    discovered_agent_count: int
    last_error: str | None

    def to_dict(self) -> dict[str, object]:
        return {
            "enabled": self.enabled,
            "provider": self.provider,
            "tailscale_available": self.tailscale_available,
            "last_refresh": self.last_refresh,
            "discovered_peer_count": self.discovered_peer_count,
            "discovered_agent_count": self.discovered_agent_count,
            "last_error": self.last_error,
        }


@dataclass(frozen=True, slots=True)
class EncodedAndroidFrame:
    content: bytes
    frame_id: str
    width: int
    height: int
    rotation: int
    captured_at: str
