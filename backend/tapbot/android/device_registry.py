"""Manual/discovered Android Agent runtime registry and health state."""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from threading import RLock
from urllib.parse import urlsplit, urlunsplit

from tapbot.android.client import AndroidAgentClient
from tapbot.android.models import (
    AndroidDeviceConfig,
    DeviceConnectionState,
    DeviceSource,
    DiscoveredAndroidAgent,
)
from tapbot.android.service import AndroidService
from tapbot.events import EventLog


@dataclass(frozen=True, slots=True)
class AndroidDeviceContext:
    config: AndroidDeviceConfig
    client: AndroidAgentClient
    debug_service: AndroidService

    @property
    def source(self):
        return self.debug_service.source

    @property
    def controller(self):
        return self.debug_service.controller

    @property
    def ui_tree_provider(self):
        return self.debug_service.ui_tree_provider


AndroidContextFactory = Callable[
    [AndroidDeviceConfig, AndroidAgentClient | None, AndroidService | None],
    AndroidDeviceContext,
]


class AndroidDeviceRegistry:
    """Own one separate Android stack per manual or discovered device."""

    def __init__(
        self,
        event_log: EventLog,
        *,
        context_factory: AndroidContextFactory,
        default_device_id: str | None = None,
    ) -> None:
        self._event_log = event_log
        self._context_factory = context_factory
        self._contexts: dict[str, AndroidDeviceContext] = {}
        self._health: dict[str, dict[str, object]] = {}
        self._lock = RLock()
        self._configured_default = default_device_id

    @property
    def default_device_id(self) -> str | None:
        with self._lock:
            if self._configured_default in self._contexts:
                return self._configured_default
            if len(self._contexts) == 1:
                return next(iter(self._contexts))
            return None

    @property
    def event_log(self) -> EventLog:
        return self._event_log

    def register(
        self,
        config: AndroidDeviceConfig,
        *,
        client: AndroidAgentClient | None = None,
        debug_service: AndroidService | None = None,
    ) -> AndroidDeviceContext | None:
        with self._lock:
            if config.id in self._contexts:
                raise ValueError(f"Duplicate Android device id: {config.id}")
            duplicate = self._find_by_endpoint(config.base_url)
            if duplicate is not None:
                raise ValueError(
                    "Duplicate Android device endpoint: "
                    f"{config.base_url} is already registered as {duplicate.config.id}"
                )
            if not config.enabled:
                return None
        context = self._context_factory(config, client, debug_service)
        with self._lock:
            if config.id in self._contexts:
                raise ValueError(f"Duplicate Android device id: {config.id}")
            self._contexts[config.id] = context
            self._health[config.id] = self._offline_summary(context, error=None)
        return context

    def register_manual(
        self,
        *,
        name: str,
        endpoint: str,
        token: str,
    ) -> dict[str, object]:
        """Register a runtime manual endpoint without exposing its credential."""

        normalized_name = name.strip()
        normalized_endpoint = endpoint.strip().rstrip("/")
        parsed = urlsplit(normalized_endpoint)
        if not normalized_name:
            raise ValueError("Manual device name is required")
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("Manual device endpoint must be a valid HTTP(S) URL")
        if parsed.username or parsed.password:
            raise ValueError("Manual device endpoint must not contain credentials")
        if parsed.query or parsed.fragment:
            raise ValueError("Manual device endpoint must not contain a query or fragment")
        if not token.strip():
            raise ValueError("An Android Agent token is required")

        digest = hashlib.sha256(
            _canonical_endpoint(normalized_endpoint).encode("utf-8")
        ).hexdigest()[:16]
        context = self.register(
            AndroidDeviceConfig(
                id=f"manual-{digest}",
                name=normalized_name,
                base_url=normalized_endpoint,
                token=token,
                source=DeviceSource.MANUAL,
            )
        )
        assert context is not None
        with self._lock:
            return dict(self._health[context.config.id])

    def unregister(self, device_id: str) -> AndroidDeviceContext:
        with self._lock:
            try:
                context = self._contexts.pop(device_id)
            except KeyError as error:
                raise KeyError(device_id) from error
            self._health.pop(device_id, None)
        context.debug_service.close()
        return context

    def get(self, device_id: str) -> AndroidDeviceContext:
        with self._lock:
            try:
                return self._contexts[device_id]
            except KeyError as error:
                raise KeyError(device_id) from error

    def list(self) -> tuple[AndroidDeviceContext, ...]:
        with self._lock:
            return tuple(self._contexts.values())

    def refresh(self, device_id: str) -> dict[str, object]:
        context = self.get(device_id)
        with self._lock:
            was_connected = bool(self._health.get(device_id, {}).get("connected"))
        try:
            status = context.debug_service.status()
            summary = self._summary_from_status(context, status)
        except Exception as error:
            summary = self._offline_summary(context, error=str(error))
        with self._lock:
            if device_id in self._contexts:
                self._health[device_id] = summary
        is_connected = bool(summary["connected"])
        if is_connected != was_connected:
            state = "connected" if is_connected else "disconnected"
            self._event_log.add(
                f"Android device {state}: {context.config.name}",
                event_type=f"android.device.{state}",
                category="android",
                status="success" if is_connected else "warning",
                payload={"device_id": device_id},
            )
        return dict(summary)

    def refresh_all(self) -> list[dict[str, object]]:
        contexts = self.list()
        if contexts:
            with ThreadPoolExecutor(
                max_workers=min(8, len(contexts)),
                thread_name_prefix="android-health",
            ) as pool:
                futures = {
                    pool.submit(self.refresh, context.config.id): context.config.id
                    for context in contexts
                }
                for future in as_completed(futures):
                    try:
                        future.result()
                    except Exception:
                        # refresh() contains errors per device; this is a final guard so
                        # one broken context can never abort the remaining refreshes.
                        pass
        return self.summaries()

    def summaries(self) -> list[dict[str, object]]:
        with self._lock:
            return [dict(self._health[device_id]) for device_id in self._contexts]

    def merge_discovered(
        self,
        agents: tuple[DiscoveredAndroidAgent, ...],
        *,
        token: str,
    ) -> list[dict[str, object]]:
        """Merge successful probes and retain missing discovered devices offline."""

        successful_identities = {agent.peer.stable_identity for agent in agents}
        for agent in agents:
            context = self._find_discovered_match(agent)
            if context is None:
                config = AndroidDeviceConfig(
                    id=self._discovered_device_id(agent.peer.stable_identity),
                    name=agent.peer.display_name,
                    base_url=agent.endpoint,
                    token=token,
                    source=DeviceSource.TAILSCALE,
                    stable_identity=agent.peer.stable_identity,
                )
                context = self.register(config)
                assert context is not None
            elif (
                context.config.source is DeviceSource.TAILSCALE
                and _canonical_endpoint(context.config.base_url)
                != _canonical_endpoint(agent.endpoint)
            ):
                context = self._replace_discovered_context(context, agent, token)
            self._mark_probe_online(context, agent)

        with self._lock:
            discovered = [
                context
                for context in self._contexts.values()
                if context.config.source is DeviceSource.TAILSCALE
            ]
            for context in discovered:
                if context.config.stable_identity not in successful_identities:
                    self._health[context.config.id] = self._offline_summary(
                        context,
                        error="TapBot Agent was not discovered during the latest refresh",
                    )
        return self.summaries()

    def _summary_from_status(
        self,
        context: AndroidDeviceContext,
        status: dict[str, object],
    ) -> dict[str, object]:
        agent = status.get("agent")
        agent = agent if isinstance(agent, dict) else {}
        stream = status.get("stream")
        stream = stream if isinstance(stream, dict) else {}
        device = agent.get("device")
        device = device if isinstance(device, dict) else {}
        connected = bool(status.get("connected"))
        with self._lock:
            previous = self._health.get(context.config.id, {})
        return {
            "id": context.config.id,
            "name": context.config.name,
            "endpoint": context.config.base_url,
            "source": context.config.source.value,
            "connected": connected,
            "connection_state": (
                DeviceConnectionState.ONLINE.value
                if connected
                else DeviceConnectionState.OFFLINE.value
            ),
            "last_seen_at": (
                _now() if connected else previous.get("last_seen_at")
            ),
            "capture_ready": bool(agent.get("capture_ready")),
            "stream_running": bool(stream.get("running", agent.get("stream_running"))),
            "screen_width": _positive_int(stream.get("width", device.get("width"))),
            "screen_height": _positive_int(stream.get("height", device.get("height"))),
            "stream_fps": _nonnegative_float(stream.get("fps")),
            "accessibility_enabled": bool(agent.get("accessibility_enabled")),
            "remote_control_enabled": bool(agent.get("remote_control_enabled")),
            "macro_status": context.debug_service.macro_status,
            "last_error": status.get("error"),
        }

    def _offline_summary(
        self,
        context: AndroidDeviceContext,
        *,
        error: str | None,
    ) -> dict[str, object]:
        with self._lock:
            previous = self._health.get(context.config.id, {})
        return {
            "id": context.config.id,
            "name": context.config.name,
            "endpoint": context.config.base_url,
            "source": context.config.source.value,
            "connected": False,
            "connection_state": DeviceConnectionState.OFFLINE.value,
            "last_seen_at": previous.get("last_seen_at"),
            "capture_ready": False,
            "stream_running": False,
            "screen_width": previous.get("screen_width"),
            "screen_height": previous.get("screen_height"),
            "stream_fps": previous.get("stream_fps"),
            "accessibility_enabled": False,
            "remote_control_enabled": False,
            "macro_status": context.debug_service.macro_status,
            "last_error": error,
        }

    def _find_discovered_match(
        self,
        agent: DiscoveredAndroidAgent,
    ) -> AndroidDeviceContext | None:
        with self._lock:
            for context in self._contexts.values():
                if (
                    context.config.stable_identity == agent.peer.stable_identity
                    or _canonical_endpoint(context.config.base_url)
                    == _canonical_endpoint(agent.endpoint)
                ):
                    return context
        return None

    def _find_by_endpoint(self, endpoint: str) -> AndroidDeviceContext | None:
        canonical = _canonical_endpoint(endpoint)
        for context in self._contexts.values():
            if _canonical_endpoint(context.config.base_url) == canonical:
                return context
        return None

    def _discovered_device_id(self, stable_identity: str) -> str:
        digest = hashlib.sha256(stable_identity.encode("utf-8")).hexdigest()
        with self._lock:
            for length in (12, 16, 24, 32, 64):
                candidate = f"tailscale-{digest[:length]}"
                existing = self._contexts.get(candidate)
                if existing is None or existing.config.stable_identity == stable_identity:
                    return candidate
        raise RuntimeError("Could not allocate a stable Android device id")

    def _replace_discovered_context(
        self,
        previous: AndroidDeviceContext,
        agent: DiscoveredAndroidAgent,
        token: str,
    ) -> AndroidDeviceContext:
        config = AndroidDeviceConfig(
            id=previous.config.id,
            name=agent.peer.display_name,
            base_url=agent.endpoint,
            token=token,
            source=DeviceSource.TAILSCALE,
            stable_identity=agent.peer.stable_identity,
        )
        replacement = self._context_factory(config, None, None)
        with self._lock:
            current = self._contexts.get(previous.config.id)
            if current is not previous:
                replacement.debug_service.close()
                return current or previous
            self._contexts[config.id] = replacement
        previous.debug_service.close()
        return replacement

    def _mark_probe_online(
        self,
        context: AndroidDeviceContext,
        agent: DiscoveredAndroidAgent,
    ) -> None:
        status = agent.status
        device = status.get("device")
        device = device if isinstance(device, dict) else {}
        with self._lock:
            previous = self._health.get(context.config.id, {})
            self._health[context.config.id] = {
                "id": context.config.id,
                "name": context.config.name,
                "endpoint": context.config.base_url,
                "source": context.config.source.value,
                "connected": True,
                "connection_state": DeviceConnectionState.ONLINE.value,
                "last_seen_at": _now(),
                "capture_ready": bool(status.get("capture_ready")),
                "stream_running": bool(status.get("stream_running")),
                "screen_width": _positive_int(device.get("width")),
                "screen_height": _positive_int(device.get("height")),
                "stream_fps": previous.get("stream_fps"),
                "accessibility_enabled": bool(status.get("accessibility_enabled")),
                "remote_control_enabled": bool(
                    status.get("remote_control_enabled")
                ),
                "macro_status": context.debug_service.macro_status,
                "last_error": None,
            }
        if not previous.get("connected"):
            self._event_log.add(
                f"Android device discovered: {context.config.name}",
                event_type="android.device.discovered",
                category="android",
                status="success",
                payload={
                    "device_id": context.config.id,
                    "source": context.config.source.value,
                },
            )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
        return None
    return int(value)


def _nonnegative_float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or value < 0:
        return None
    return float(value)


def _canonical_endpoint(value: str) -> str:
    normalized = value.strip().rstrip("/")
    parsed = urlsplit(normalized)
    if not parsed.scheme or not parsed.netloc:
        return normalized.lower()
    return urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path.rstrip("/"),
            "",
            "",
        )
    )
